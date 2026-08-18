import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { createLoopbackBridgeServer } from '../../src/bridge/node';

describe('loopback bridge server', () => {
  it('binds an ephemeral port only on 127.0.0.1 and dispatches the fixed endpoint', async () => {
    const origin = 'http://127.0.0.1:4173';
    const capability = 'phase-zero-server-capability';
    const server = await createLoopbackBridgeServer({
      allowedOrigins: [origin],
      processCapability: capability,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['viewer'],
          payloadSchema: z.object({}).strict(),
          resultSchema: z.object({ state: z.literal('ready') }).strict(),
          handler: async () => ({ state: 'ready' as const }),
        },
      ],
      installedOperations: new Set(['runtime.readSnapshot']),
      ingressTimeoutMs: 250,
      maxConnections: 6,
      maxBodyReaders: 3,
    }).listen();

    try {
      expect(server.host).toBe('127.0.0.1');
      expect(server.endpoint).toBe(`http://127.0.0.1:${server.port}/bridge`);
      expect(server.ingressTimeoutMs).toBe(250);
      expect(server.maxConnections).toBe(6);
      expect(server.maxBodyReaders).toBe(3);

      const response = await fetch(server.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin,
          'x-dali-process-capability': capability,
        },
        body: JSON.stringify({
          schemaVersion: 1,
          correlationId: 'correlation-server',
          operationId: 'operation-server',
          operation: 'runtime.readSnapshot',
          role: 'viewer',
          payload: {},
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        schemaVersion: 1,
        status: 'ok',
        correlationId: 'correlation-server',
        data: { state: 'ready' },
      });
    } finally {
      await server.close();
    }
  });

  it('rejects a request without the per-process capability at the socket boundary', async () => {
    const origin = 'http://127.0.0.1:4173';
    const server = await createLoopbackBridgeServer({
      allowedOrigins: [origin],
      processCapability: 'phase-zero-server-capability',
      operations: [],
      installedOperations: new Set(),
    }).listen();

    try {
      const response = await fetch(server.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        status: 'error',
        error: { code: 'UNAUTHORIZED' },
      });
    } finally {
      await server.close();
    }
  });

  it('rejects wrong Host, Origin, path, oversized body, and unapproved preflight headers', async () => {
    const origin = 'http://127.0.0.1:4173';
    const capability = 'phase-zero-server-capability';
    const server = await createLoopbackBridgeServer({
      allowedOrigins: [origin],
      processCapability: capability,
      maxBodyBytes: 300,
      operations: [],
      installedOperations: new Set(),
    }).listen();
    const post = (host: string, requestOrigin: string, path = '/bridge', body = '{}') =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: '127.0.0.1',
            port: server.port,
            path,
            method: 'POST',
            headers: {
              host,
              origin: requestOrigin,
              'content-type': 'application/json',
              'x-dali-process-capability': capability,
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () =>
              resolve({
                status: response.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf8'),
              }),
            );
          },
        );
        req.on('error', reject);
        req.end(body);
      });

    try {
      await expect(post('localhost', origin)).resolves.toMatchObject({ status: 403 });
      await expect(
        post(`127.0.0.1:${server.port}`, 'http://127.0.0.1:9999'),
      ).resolves.toMatchObject({ status: 403 });
      await expect(
        post(`127.0.0.1:${server.port}`, origin, '/not-bridge'),
      ).resolves.toMatchObject({ status: 404 });
      await expect(
        post(`127.0.0.1:${server.port}`, origin, '/bridge', 'x'.repeat(301)),
      ).resolves.toMatchObject({ status: 400 });

      const rejectedPreflight = await fetch(server.endpoint, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type, x-unapproved-header',
        },
      });
      expect(rejectedPreflight.status).toBe(403);

      const acceptedPreflight = await fetch(server.endpoint, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers':
            'content-type, x-dali-process-capability',
        },
      });
      expect(acceptedPreflight.status).toBe(204);
      expect(acceptedPreflight.headers.get('access-control-allow-origin')).toBe(origin);
    } finally {
      await server.close();
    }
  });

  it('rejects unauthorized headers before waiting for a slow request body', async () => {
    const origin = 'http://127.0.0.1:4173';
    let releaseAudit: (() => void) | undefined;
    const events = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseAudit = resolve;
        }),
    );
    const server = await createLoopbackBridgeServer({
      allowedOrigins: [origin],
      processCapability: 'phase-zero-server-capability',
      ingressTimeoutMs: 500,
      operations: [],
      installedOperations: new Set(),
      onSecurityEvent: events,
    }).listen();

    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: '127.0.0.1',
            port: server.port,
            path: '/bridge',
            method: 'POST',
            headers: {
              origin,
              'content-type': 'application/json',
              'x-dali-process-capability': 'wrong-capability',
            },
          },
          (response) => {
            resolve(response.statusCode ?? 0);
            response.resume();
            req.destroy();
          },
        );
        req.on('error', (error) => {
          if (!req.destroyed) reject(error);
        });
        req.write('{');
      });

      expect(status).toBe(403);
      await vi.waitFor(() => expect(events).toHaveBeenCalled());
      expect(events).toHaveBeenCalledWith({
        correlationId: 'invalid-request',
        outcome: 'rejected',
        code: 'UNAUTHORIZED',
        safeRetry: 'do-not-retry',
        stopCondition: 'request-rejected',
      });
      expect(JSON.stringify(events.mock.calls)).not.toContain('wrong-capability');
      expect(JSON.stringify(events.mock.calls)).not.toContain(origin);
      releaseAudit?.();
    } finally {
      await server.close();
    }
  });

  it('times and closes slow bodies on wrong path, method, and preflight without reading them', async () => {
    const origin = 'http://127.0.0.1:4173';
    const capability = 'phase-zero-server-capability';
    const server = await createLoopbackBridgeServer({
      allowedOrigins: [origin],
      processCapability: capability,
      ingressTimeoutMs: 500,
      operations: [],
      installedOperations: new Set(),
    }).listen();
    const slowStatus = (
      method: string,
      path: string,
      extraHeaders: Record<string, string> = {},
    ) =>
      new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: '127.0.0.1',
            port: server.port,
            path,
            method,
            headers: {
              origin,
              'content-type': 'application/json',
              'x-dali-process-capability': capability,
              ...extraHeaders,
            },
          },
          (response) => {
            resolve(response.statusCode ?? 0);
            response.resume();
            req.destroy();
          },
        );
        req.on('error', (error) => {
          if (!req.destroyed) reject(error);
        });
        req.write('{');
      });

    try {
      await expect(slowStatus('POST', '/wrong-path')).resolves.toBe(404);
      await expect(slowStatus('PUT', '/bridge')).resolves.toBe(400);
      await expect(
        slowStatus('OPTIONS', '/bridge', {
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'x-unapproved-header',
        }),
      ).resolves.toBe(403);
    } finally {
      await server.close();
    }
  });

  it('caps concurrent authenticated body readers before dispatch', async () => {
    const origin = 'http://127.0.0.1:4173';
    const capability = 'phase-zero-server-capability';
    const server = await createLoopbackBridgeServer({
      allowedOrigins: [origin],
      processCapability: capability,
      ingressTimeoutMs: 1_000,
      maxConnections: 4,
      maxBodyReaders: 1,
      operations: [],
      installedOperations: new Set(),
    }).listen();
    const slow = httpRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/bridge',
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'x-dali-process-capability': capability,
      },
    });
    slow.on('error', () => undefined);
    slow.write('{');

    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const response = await fetch(server.endpoint, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'x-dali-process-capability': capability,
        },
        body: '{}',
      });

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        status: 'error',
        error: { code: 'OPERATION_NOT_ALLOWED', message: 'Operation unavailable' },
      });
    } finally {
      slow.destroy();
      await server.close();
    }
  });

  it('releases body-reader capacity after a complete body when accepted audit never settles', async () => {
    const origin = 'http://127.0.0.1:4173';
    const capability = 'phase-zero-server-capability';
    const server = await createLoopbackBridgeServer({
      allowedOrigins: [origin],
      processCapability: capability,
      ingressTimeoutMs: 30,
      maxConnections: 4,
      maxBodyReaders: 1,
      operations: [
        {
          operation: 'runtime.pause',
          roles: ['operator'],
          payloadSchema: z.object({}).strict(),
          resultSchema: z.object({ state: z.literal('paused') }).strict(),
          handler: async () => ({ state: 'paused' as const }),
        },
      ],
      installedOperations: new Set(['runtime.pause']),
      onSecurityEvent: (event) =>
        event.outcome === 'accepted' && event.operationId === 'operation-audit-stall'
          ? new Promise<void>(() => undefined)
          : undefined,
    }).listen();
    const send = (operationId: string) =>
      fetch(server.endpoint, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'x-dali-process-capability': capability,
        },
        body: JSON.stringify({
          schemaVersion: 1,
          correlationId: `correlation-${operationId}`,
          operationId,
          idempotencyKey: `idempotency-${operationId}`,
          operation: 'runtime.pause',
          role: 'operator',
          payload: {},
        }),
      });

    try {
      await expect(send('operation-audit-stall')).rejects.toThrow();

      const admitted = await send('operation-after-audit-stall');
      expect(admitted.status).toBe(200);
      await expect(admitted.json()).resolves.toMatchObject({
        status: 'ok',
        data: { state: 'paused' },
      });
    } finally {
      await server.close();
    }
  });

  it('closes an authenticated request that exceeds the ingress timeout', async () => {
    const origin = 'http://127.0.0.1:4173';
    const capability = 'phase-zero-server-capability';
    const server = await createLoopbackBridgeServer({
      allowedOrigins: [origin],
      processCapability: capability,
      ingressTimeoutMs: 20,
      operations: [],
      installedOperations: new Set(),
    }).listen();

    try {
      const closed = new Promise<boolean>((resolve) => {
        const req = httpRequest({
          hostname: '127.0.0.1',
          port: server.port,
          path: '/bridge',
          method: 'POST',
          headers: {
            origin,
            'content-type': 'application/json',
            'x-dali-process-capability': capability,
          },
        });
        req.on('error', () => resolve(true));
        req.on('close', () => resolve(true));
        req.write('{');
      });

      await expect(closed).resolves.toBe(true);
    } finally {
      await server.close();
    }
  });

  it('maps unknown outcomes to conflict and internal failures to server error', async () => {
    const origin = 'http://127.0.0.1:4173';
    const capability = 'phase-zero-server-capability';
    const server = await createLoopbackBridgeServer({
      allowedOrigins: [origin],
      processCapability: capability,
      handlerTimeoutMs: 5,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['viewer'],
          payloadSchema: z.object({ behavior: z.enum(['timeout', 'failure']) }).strict(),
          resultSchema: z.object({ state: z.literal('ready') }).strict(),
          handler: async (payload) => {
            if (payload.behavior === 'timeout') return new Promise(() => undefined);
            throw new Error('internal secret');
          },
        },
      ],
      installedOperations: new Set(['runtime.readSnapshot']),
    }).listen();
    const send = (behavior: 'timeout' | 'failure', suffix: string) =>
      fetch(server.endpoint, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'x-dali-process-capability': capability,
        },
        body: JSON.stringify({
          schemaVersion: 1,
          correlationId: `correlation-${suffix}`,
          operationId: `operation-${suffix}`,
          operation: 'runtime.readSnapshot',
          role: 'viewer',
          payload: { behavior },
        }),
      });

    try {
      const unknown = await send('timeout', 'timeout');
      expect(unknown.status).toBe(409);
      await expect(unknown.json()).resolves.toMatchObject({
        error: { code: 'RECONCILIATION_REQUIRED' },
      });

      const failure = await send('failure', 'failure');
      expect(failure.status).toBe(500);
      const failureBody = await failure.json();
      expect(failureBody).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
      expect(JSON.stringify(failureBody)).not.toContain('internal secret');
    } finally {
      await server.close();
    }
  });

  it('allows a clean retry after startup configuration failure', async () => {
    const factory = createLoopbackBridgeServer({
      allowedOrigins: ['https://example.com'],
      processCapability: 'phase-zero-server-capability',
      operations: [],
      installedOperations: new Set(),
    });

    await expect(factory.listen()).rejects.toThrow('BRIDGE_LOOPBACK_CONFIGURATION_REQUIRED');
    await expect(factory.listen()).rejects.toThrow('BRIDGE_LOOPBACK_CONFIGURATION_REQUIRED');
  });
});
/// <reference types="node" />

import { request as httpRequest } from 'node:http';
