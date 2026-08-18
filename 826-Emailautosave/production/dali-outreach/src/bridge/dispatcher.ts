import type { ZodType } from 'zod';
import {
  bridgeRequestSchema,
  type BridgeEnvelope,
  type BridgeErrorCode,
  type BridgeRequest,
  inputLimits,
  operationNameSchema,
  type OperationName,
} from '../contracts';

export interface BridgeConnection {
  readonly remoteAddress: string;
  readonly host: string;
  readonly origin: string;
  readonly processCapability: string;
}

export interface BridgeHandlerContext {
  readonly correlationId: string;
  readonly operationId: string;
  readonly operation: OperationName;
  readonly role: BridgeRequest['role'];
  readonly idempotencyKey?: string;
  readonly signal: AbortSignal;
}

export interface BridgeOperationRegistration<
  Name extends OperationName = OperationName,
  Payload extends Record<string, unknown> = Record<string, unknown>,
  Result = unknown,
> {
  readonly operation: Name;
  readonly roles: readonly BridgeRequest['role'][];
  readonly payloadSchema: ZodType<Payload>;
  readonly resultSchema: ZodType<Result>;
  readonly handler: (
    payload: Payload,
    context: BridgeHandlerContext,
  ) => Promise<Result>;
}

type AnyBridgeOperationRegistration = BridgeOperationRegistration<OperationName, any, any>;

export interface BridgeOperationContract {
  readonly payload: Record<string, unknown>;
  readonly result: unknown;
}

export type BridgeOperationContracts = Partial<Record<OperationName, BridgeOperationContract>>;

export type ContractsFromRegistrations<
  Registrations extends readonly AnyBridgeOperationRegistration[],
> = {
  [Registration in Registrations[number] as Registration['operation']]: Registration extends BridgeOperationRegistration<
    OperationName,
    infer Payload,
    infer Result
  >
    ? { readonly payload: Payload; readonly result: Result }
    : never;
};

export interface BridgeSecurityEvent {
  readonly correlationId: string;
  readonly operationId?: string;
  readonly operation?: OperationName;
  readonly outcome: 'accepted' | 'rejected' | 'failure' | 'timeout';
  readonly code?: BridgeErrorCode;
  readonly safeRetry?: 'do-not-retry' | 'reconcile-first';
  readonly stopCondition?: 'request-rejected' | 'handler-failed' | 'handler-timeout';
}

export interface BridgeDispatcherOptions<
  Registrations extends readonly AnyBridgeOperationRegistration[],
> {
  readonly expectedHost: string;
  readonly allowedOrigins: readonly string[];
  readonly processCapability: string;
  readonly operations: Registrations;
  readonly installedOperations: ReadonlySet<OperationName>;
  readonly handlerTimeoutMs?: number;
  readonly maxConcurrentOperations?: number;
  readonly maxBodyBytes?: number;
  readonly onSecurityEvent?: (event: BridgeSecurityEvent) => void | Promise<void>;
}

export type AnyBridgeDispatcherOptions<
  Registrations extends readonly AnyBridgeOperationRegistration[],
> = BridgeDispatcherOptions<Registrations>;

declare const bridgeResultTypes: unique symbol;

export interface BridgeDispatcher<
  Contracts extends BridgeOperationContracts = BridgeOperationContracts,
> {
  readonly [bridgeResultTypes]?: Contracts;
  request(input: unknown, connection: BridgeConnection): Promise<BridgeEnvelope<unknown>>;
}

const strictBridgeRequestSchema = bridgeRequestSchema.strict();
const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const phaseZeroOperations: Readonly<Record<OperationName, true>> = Object.freeze({
  'runtime.readSnapshot': true,
  'runtime.pause': true,
  'runtime.resume': true,
  'runtime.reconcile': true,
  'email.previewImport': true,
  'email.createDraft': true,
  'email.reviseDraft': true,
  'email.approveDraft': true,
  'email.enqueueLocal': true,
  'email.reconcile': true,
  'telegram.previewImport': true,
  'telegram.createMessage': true,
  'telegram.reviseMessage': true,
  'telegram.approveMessage': true,
  'telegram.enqueueLocal': true,
  'telegram.reconcile': true,
  'data.previewImport': true,
  'data.importBatch': true,
  'data.listWorkItems': true,
  'data.updateWorkItem': true,
  'data.readAudit': true,
});
const safeIdentifier = /^[A-Za-z0-9._:-]+$/;
export type IdempotentMutationOperation =
  | 'runtime.pause'
  | 'runtime.resume'
  | 'runtime.reconcile'
  | 'email.previewImport'
  | 'email.createDraft'
  | 'email.reviseDraft'
  | 'email.approveDraft'
  | 'email.enqueueLocal'
  | 'email.reconcile'
  | 'telegram.previewImport'
  | 'telegram.createMessage'
  | 'telegram.reviseMessage'
  | 'telegram.approveMessage'
  | 'telegram.enqueueLocal'
  | 'telegram.reconcile'
  | 'data.previewImport'
  | 'data.importBatch'
  | 'data.updateWorkItem';

const mutationOperations = new Set<OperationName>([
  'runtime.pause',
  'runtime.resume',
  'runtime.reconcile',
  'email.previewImport',
  'email.createDraft',
  'email.reviseDraft',
  'email.approveDraft',
  'email.enqueueLocal',
  'email.reconcile',
  'telegram.previewImport',
  'telegram.createMessage',
  'telegram.reviseMessage',
  'telegram.approveMessage',
  'telegram.enqueueLocal',
  'telegram.reconcile',
  'data.previewImport',
  'data.importBatch',
  'data.updateWorkItem',
]);
const roleRank: Readonly<Record<BridgeRequest['role'], number>> = Object.freeze({
  viewer: 0,
  operator: 1,
  approver: 2,
});
const minimumRoleByOperation: Readonly<Partial<Record<OperationName, BridgeRequest['role']>>> =
  Object.freeze({
    'runtime.pause': 'operator',
    'runtime.resume': 'operator',
    'runtime.reconcile': 'operator',
    'email.reconcile': 'operator',
    'telegram.reconcile': 'operator',
  });

function isLoopbackHostHeader(host: string): boolean {
  return /^(?:127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host);
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (hostname === '127.0.0.1' || hostname === '::1') &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === ''
    );
  } catch {
    return false;
  }
}

function safeCorrelationId(input: unknown): string {
  if (
    typeof input === 'object' &&
    input !== null &&
    'correlationId' in input &&
    typeof input.correlationId === 'string' &&
    input.correlationId.length >= 1 &&
    input.correlationId.length <= 128 &&
    safeIdentifier.test(input.correlationId)
  ) {
    return input.correlationId;
  }
  return 'invalid-request';
}

function safeRequestMetadata(input: unknown): {
  operation?: OperationName;
  operationId?: string;
} {
  if (typeof input !== 'object' || input === null) return {};
  const operation =
    'operation' in input ? operationNameSchema.safeParse(input.operation) : undefined;
  const operationId =
    'operationId' in input &&
    typeof input.operationId === 'string' &&
    input.operationId.length >= 1 &&
    input.operationId.length <= 128 &&
    safeIdentifier.test(input.operationId)
      ? input.operationId
      : undefined;
  return {
    operation: operation?.success ? operation.data : undefined,
    operationId,
  };
}

function secureEqual(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

function errorEnvelope(
  correlationId: string,
  code: BridgeErrorCode,
  message: string,
): BridgeEnvelope<never> {
  return {
    schemaVersion: 1,
    status: 'error',
    correlationId,
    error: { code, message, retryable: false },
  };
}

function serializedBytes(value: unknown): number | undefined {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? undefined : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return undefined;
  }
}

export function createBridgeDispatcher<
  const Registrations extends readonly AnyBridgeOperationRegistration[],
>(
  options: BridgeDispatcherOptions<Registrations>,
): BridgeDispatcher<ContractsFromRegistrations<Registrations>> {
  const handlerTimeoutMs = options.handlerTimeoutMs ?? 5_000;
  const maxConcurrentOperations =
    options.maxConcurrentOperations ?? inputLimits.maxConcurrentOperations;
  const maxBodyBytes = options.maxBodyBytes ?? inputLimits.maxImportBytes;
  if (handlerTimeoutMs < 1 || handlerTimeoutMs > 30_000) {
    throw new Error('BRIDGE_TIMEOUT_LIMIT_INVALID');
  }
  if (
    maxConcurrentOperations < 1 ||
    maxConcurrentOperations > inputLimits.maxConcurrentOperations
  ) {
    throw new Error('BRIDGE_CONCURRENCY_LIMIT_INVALID');
  }
  if (maxBodyBytes < 1 || maxBodyBytes > inputLimits.maxImportBytes) {
    throw new Error('BRIDGE_BODY_LIMIT_INVALID');
  }
  if (options.processCapability.length < 16 || options.processCapability.length > 256) {
    throw new Error('BRIDGE_PROCESS_CAPABILITY_REQUIRED');
  }
  if (
    !isLoopbackHostHeader(options.expectedHost) ||
    options.allowedOrigins.length === 0 ||
    options.allowedOrigins.some((origin) => !isLoopbackOrigin(origin))
  ) {
    throw new Error('BRIDGE_LOOPBACK_CONFIGURATION_REQUIRED');
  }
  const allowedOrigins = new Set(options.allowedOrigins);
  const registry = new Map<OperationName, AnyBridgeOperationRegistration>();
  for (const registration of options.operations) {
    if (registry.has(registration.operation)) {
      throw new Error('DUPLICATE_BRIDGE_OPERATION');
    }
    registry.set(registration.operation, registration);
  }
  if (
    registry.size !== options.installedOperations.size ||
    [...registry.keys()].some(
      (operation) => !options.installedOperations.has(operation) || !phaseZeroOperations[operation],
    )
  ) {
    throw new Error('BRIDGE_OPERATION_REGISTRY_MISMATCH');
  }

  let activeOperations = 0;
  const emit = async (event: BridgeSecurityEvent): Promise<boolean> => {
    if (!options.onSecurityEvent) return false;
    try {
      await options.onSecurityEvent(event);
      return true;
    } catch {
      return false;
    }
  };

  return {
    async request(input, connection) {
      const correlationId = safeCorrelationId(input);
      const metadata = safeRequestMetadata(input);
      const rejectRequest = async (
        code: BridgeErrorCode,
        message: string,
        safeRetry: BridgeSecurityEvent['safeRetry'] = 'do-not-retry',
      ) => {
        await emit({
          correlationId,
          operationId: metadata.operationId,
          operation: metadata.operation,
          outcome: 'rejected',
          code,
          safeRetry,
          stopCondition: 'request-rejected',
        });
        return errorEnvelope(correlationId, code, message);
      };
      if (
        !loopbackAddresses.has(connection.remoteAddress) ||
        connection.host !== options.expectedHost ||
        !allowedOrigins.has(connection.origin) ||
        !secureEqual(connection.processCapability, options.processCapability)
      ) {
        return rejectRequest('UNAUTHORIZED', 'Request not authorized');
      }

      const parsed = strictBridgeRequestSchema.safeParse(input);
      const requestBytes = serializedBytes(input);
      if (!parsed.success || requestBytes === undefined || requestBytes > maxBodyBytes) {
        return rejectRequest('INVALID_REQUEST', 'Invalid request');
      }
      if (
        !safeIdentifier.test(parsed.data.correlationId) ||
        !safeIdentifier.test(parsed.data.operationId)
      ) {
        return rejectRequest('INVALID_REQUEST', 'Invalid request');
      }

      const registration = registry.get(parsed.data.operation);
      const minimumRole = minimumRoleByOperation[parsed.data.operation];
      if (
        !registration ||
        !registration.roles.includes(parsed.data.role) ||
        (minimumRole !== undefined && roleRank[parsed.data.role] < roleRank[minimumRole])
      ) {
        return rejectRequest('OPERATION_NOT_ALLOWED', 'Operation not allowed');
      }

      const payload = registration.payloadSchema.safeParse(parsed.data.payload);
      const payloadBytes = payload.success ? serializedBytes(payload.data) : undefined;
      if (!payload.success || payloadBytes === undefined || payloadBytes > maxBodyBytes) {
        return rejectRequest('INVALID_REQUEST', 'Invalid request');
      }

      if (mutationOperations.has(parsed.data.operation) && !parsed.data.idempotencyKey) {
        return rejectRequest('INVALID_REQUEST', 'Idempotency key required');
      }

      if (activeOperations >= maxConcurrentOperations) {
        return rejectRequest('OPERATION_NOT_ALLOWED', 'Operation unavailable');
      }

      if (
        mutationOperations.has(parsed.data.operation) &&
        !(await emit({
          correlationId: parsed.data.correlationId,
          operationId: parsed.data.operationId,
          operation: parsed.data.operation,
          outcome: 'accepted',
        }))
      ) {
        return errorEnvelope(
          parsed.data.correlationId,
          'INTERNAL_ERROR',
          'Security audit unavailable',
        );
      }

      activeOperations += 1;
      const controller = new AbortController();
      const timeout = Symbol('bridge-timeout');
      let releaseInFinally = true;
      try {
        const handlerPromise = registration.handler(payload.data, {
          correlationId: parsed.data.correlationId,
          operationId: parsed.data.operationId,
          operation: parsed.data.operation,
          role: parsed.data.role,
          idempotencyKey: parsed.data.idempotencyKey,
          signal: controller.signal,
        });
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let timedResult: Awaited<ReturnType<typeof registration.handler>> | typeof timeout;
        try {
          timedResult = await Promise.race([
            handlerPromise,
            new Promise<typeof timeout>((resolve) => {
              timeoutId = setTimeout(() => resolve(timeout), handlerTimeoutMs);
            }),
          ]);
        } finally {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
        }
        if (timedResult === timeout) {
          controller.abort();
          releaseInFinally = false;
          void handlerPromise.then(
            () => {
              activeOperations -= 1;
            },
            () => {
              activeOperations -= 1;
            },
          );
          await emit({
            correlationId: parsed.data.correlationId,
            operationId: parsed.data.operationId,
            operation: parsed.data.operation,
            outcome: 'timeout',
            code: 'RECONCILIATION_REQUIRED',
            safeRetry: 'reconcile-first',
            stopCondition: 'handler-timeout',
          });
          return errorEnvelope(
            parsed.data.correlationId,
            'RECONCILIATION_REQUIRED',
            'Operation outcome requires reconciliation',
          );
        }
        const result = registration.resultSchema.safeParse(timedResult);
        const resultBytes = result.success ? serializedBytes(result.data) : undefined;
        if (!result.success || resultBytes === undefined || resultBytes > maxBodyBytes) {
          throw new Error('INVALID_HANDLER_RESULT');
        }
        return {
          schemaVersion: 1,
          status: 'ok',
          correlationId: parsed.data.correlationId,
          data: result.data,
        };
      } catch {
        await emit({
          correlationId: parsed.data.correlationId,
          operationId: parsed.data.operationId,
          operation: parsed.data.operation,
          outcome: 'failure',
          code: 'INTERNAL_ERROR',
          safeRetry: 'do-not-retry',
          stopCondition: 'handler-failed',
        });
        return errorEnvelope(
          parsed.data.correlationId,
          'INTERNAL_ERROR',
          'Operation failed',
        );
      } finally {
        if (releaseInFinally) activeOperations -= 1;
      }
    },
  };
}
