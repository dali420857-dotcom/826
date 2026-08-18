/// <reference types="node" />

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BridgeEnvelope, OperationName } from '../contracts';
import {
  createBridgeDispatcher,
  type AnyBridgeDispatcherOptions,
  type BridgeOperationRegistration,
} from './dispatcher';

const bridgePath = '/bridge';
const capabilityHeader = 'x-dali-process-capability';

export interface RunningLoopbackBridgeServer {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly endpoint: string;
  readonly ingressTimeoutMs: number;
  readonly maxConnections: number;
  readonly maxBodyReaders: number;
  close(): Promise<void>;
}

export type LoopbackBridgeServerOptions<
  Registrations extends readonly BridgeOperationRegistration<OperationName, any, any>[],
> = Omit<AnyBridgeDispatcherOptions<Registrations>, 'expectedHost'> & {
  readonly ingressTimeoutMs?: number;
  readonly maxConnections?: number;
  readonly maxBodyReaders?: number;
};

function singleHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return typeof value === 'string' ? value : '';
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  envelope: BridgeEnvelope<unknown>,
  origin?: string,
): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  if (origin) response.setHeader('access-control-allow-origin', origin);
  response.end(JSON.stringify(envelope));
}

function invalidEnvelope(): BridgeEnvelope<never> {
  return {
    schemaVersion: 1,
    status: 'error',
    correlationId: 'invalid-request',
    error: {
      code: 'INVALID_REQUEST',
      message: 'Invalid request',
      retryable: false,
    },
  };
}

function unavailableEnvelope(): BridgeEnvelope<never> {
  return {
    schemaVersion: 1,
    status: 'error',
    correlationId: 'invalid-request',
    error: {
      code: 'OPERATION_NOT_ALLOWED',
      message: 'Operation unavailable',
      retryable: false,
    },
  };
}

function secureEqual(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

function statusForEnvelope(envelope: BridgeEnvelope<unknown>): number {
  if (envelope.status === 'ok') return 200;
  switch (envelope.error.code) {
    case 'INVALID_REQUEST':
      return 400;
    case 'UNAUTHORIZED':
    case 'OPERATION_NOT_ALLOWED':
    case 'RUNTIME_MODE_REJECTED':
      return 403;
    case 'IDEMPOTENCY_CONFLICT':
    case 'APPROVAL_INVALIDATED':
    case 'RECONCILIATION_REQUIRED':
      return 409;
    case 'INTERNAL_ERROR':
      return 500;
  }
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error('BRIDGE_BODY_LIMIT_EXCEEDED');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function createLoopbackBridgeServer<
  const Registrations extends readonly BridgeOperationRegistration<OperationName, any, any>[],
>(options: LoopbackBridgeServerOptions<Registrations>) {
  const ingressTimeoutMs = options.ingressTimeoutMs ?? 5_000;
  const maxConnections = options.maxConnections ?? 8;
  const maxBodyReaders = options.maxBodyReaders ?? 4;
  if (ingressTimeoutMs < 1 || ingressTimeoutMs > 30_000) {
    throw new Error('BRIDGE_INGRESS_TIMEOUT_INVALID');
  }
  if (maxConnections < 1 || maxConnections > 32 || maxBodyReaders < 1 || maxBodyReaders > 8) {
    throw new Error('BRIDGE_INGRESS_CONCURRENCY_INVALID');
  }
  let started = false;
  let activeBodyReaders = 0;
  return {
    async listen(port = 0): Promise<RunningLoopbackBridgeServer> {
      if (started) throw new Error('BRIDGE_SERVER_ALREADY_STARTED');
      started = true;
      let dispatcher!: ReturnType<typeof createBridgeDispatcher<Registrations>>;
      const server = createServer(async (request, response) => {
        request.setTimeout(ingressTimeoutMs, () => request.destroy());
        const drainAndClose = () => {
          request.resume();
          response.setHeader('connection', 'close');
          response.once('finish', () => request.destroy());
        };
        const emitDetached = (event: Parameters<NonNullable<typeof options.onSecurityEvent>>[0]) => {
          void Promise.resolve()
            .then(() => options.onSecurityEvent?.(event))
            .catch(() => undefined);
        };
        const host = singleHeader(request, 'host');
        const origin = singleHeader(request, 'origin');
        const allowedOrigin = options.allowedOrigins.includes(origin) ? origin : undefined;

        if (request.url !== bridgePath) {
          drainAndClose();
          writeJson(response, 404, invalidEnvelope());
          return;
        }
        if (request.method === 'OPTIONS') {
          const requestedHeaders = new Set(
            singleHeader(request, 'access-control-request-headers')
              .toLowerCase()
              .split(',')
              .map((header) => header.trim())
              .filter(Boolean),
          );
          if (
            host !== `127.0.0.1:${(server.address() as AddressInfo).port}` ||
            !allowedOrigin ||
            singleHeader(request, 'access-control-request-method') !== 'POST' ||
            requestedHeaders.size !== 2 ||
            !requestedHeaders.has('content-type') ||
            !requestedHeaders.has(capabilityHeader)
          ) {
            drainAndClose();
            writeJson(response, 403, invalidEnvelope());
            return;
          }
          drainAndClose();
          response.statusCode = 204;
          response.setHeader('access-control-allow-origin', allowedOrigin);
          response.setHeader('access-control-allow-methods', 'POST');
          response.setHeader(
            'access-control-allow-headers',
            `content-type, ${capabilityHeader}`,
          );
          response.setHeader('access-control-max-age', '0');
          response.end();
          return;
        }
        if (
          request.method !== 'POST' ||
          singleHeader(request, 'content-type').split(';', 1)[0] !== 'application/json'
        ) {
          drainAndClose();
          writeJson(response, 400, invalidEnvelope(), allowedOrigin);
          return;
        }

        const expectedHost = `127.0.0.1:${(server.address() as AddressInfo).port}`;
        if (
          request.socket.remoteAddress !== '127.0.0.1' ||
          host !== expectedHost ||
          !allowedOrigin ||
          !secureEqual(singleHeader(request, capabilityHeader), options.processCapability)
        ) {
          drainAndClose();
          writeJson(response, 403, {
            schemaVersion: 1,
            status: 'error',
            correlationId: 'invalid-request',
            error: {
              code: 'UNAUTHORIZED',
              message: 'Request not authorized',
              retryable: false,
            },
          });
          emitDetached({
            correlationId: 'invalid-request',
            outcome: 'rejected',
            code: 'UNAUTHORIZED',
            safeRetry: 'do-not-retry',
            stopCondition: 'request-rejected',
          });
          return;
        }
        if (activeBodyReaders >= maxBodyReaders) {
          drainAndClose();
          writeJson(response, 503, unavailableEnvelope(), allowedOrigin);
          return;
        }

        activeBodyReaders += 1;
        let body: unknown;
        try {
          body = await readBody(request, options.maxBodyBytes ?? 1_000_000);
        } catch {
          writeJson(response, 400, invalidEnvelope(), allowedOrigin);
          return;
        } finally {
          activeBodyReaders -= 1;
        }

        try {
          const result = await dispatcher.request(body, {
            remoteAddress: request.socket.remoteAddress ?? '',
            host,
            origin,
            processCapability: singleHeader(request, capabilityHeader),
          });
          writeJson(response, statusForEnvelope(result), result, allowedOrigin);
        } catch {
          writeJson(response, 400, invalidEnvelope(), allowedOrigin);
        }
      });

      server.requestTimeout = ingressTimeoutMs;
      server.headersTimeout = ingressTimeoutMs;
      server.keepAliveTimeout = Math.min(1_000, ingressTimeoutMs);
      server.timeout = ingressTimeoutMs;
      server.maxConnections = maxConnections;

      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen({ host: '127.0.0.1', port }, () => {
            server.off('error', reject);
            try {
              const address = server.address() as AddressInfo;
              dispatcher = createBridgeDispatcher({
                ...options,
                expectedHost: `127.0.0.1:${address.port}`,
              });
              resolve();
            } catch (error) {
              server.close(() => reject(error));
            }
          });
        });
      } catch (error) {
        started = false;
        throw error;
      }
      const address = server.address() as AddressInfo;

      return {
        host: '127.0.0.1',
        port: address.port,
        endpoint: `http://127.0.0.1:${address.port}${bridgePath}`,
        ingressTimeoutMs,
        maxConnections,
        maxBodyReaders,
        close: () =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      };
    },
  };
}
