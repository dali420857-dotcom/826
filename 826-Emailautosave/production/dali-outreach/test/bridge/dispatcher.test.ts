import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { createBridgeDispatcher } from '../../src/bridge';

const connection = {
  remoteAddress: '127.0.0.1',
  host: '127.0.0.1:4173',
  origin: 'http://127.0.0.1:4173',
  processCapability: 'phase-zero-test-capability',
} as const;

const request = {
  schemaVersion: 1,
  correlationId: 'correlation-1',
  operationId: 'operation-1',
  operation: 'runtime.readSnapshot',
  role: 'viewer',
  payload: {},
} as const;
const readyResultSchema = z.object({ state: z.literal('ready') }).strict();
const installedReadSnapshot = new Set(['runtime.readSnapshot'] as const);

describe('bridge dispatcher', () => {
  it('dispatches a registered operation through a fixed success envelope', async () => {
    const handler = vi.fn(async () => ({ state: 'ready' as const }));
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['viewer'],
          payloadSchema: z.object({}).strict(),
          resultSchema: readyResultSchema,
          handler,
        },
      ],
      installedOperations: installedReadSnapshot,
    });

    await expect(
      dispatcher.request(
        { ...request, idempotencyKey: 'idempotency-key-0001' },
        connection,
      ),
    ).resolves.toEqual({
      schemaVersion: 1,
      status: 'ok',
      correlationId: 'correlation-1',
      data: { state: 'ready' },
    });
    expect(handler).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        correlationId: 'correlation-1',
        operationId: 'operation-1',
        operation: 'runtime.readSnapshot',
        role: 'viewer',
        idempotencyKey: 'idempotency-key-0001',
      }),
    );
  });

  it.each([
    ['non-loopback peer', { remoteAddress: '192.0.2.10' }],
    ['wrong Host', { host: 'localhost:4173' }],
    ['wrong Origin', { origin: 'http://localhost:4173' }],
    ['wrong process capability', { processCapability: 'wrong-capability' }],
  ])('rejects a request with %s before invoking its handler', async (_name, override) => {
    const handler = vi.fn(async () => ({ state: 'ready' as const }));
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['viewer'],
          payloadSchema: z.object({}).strict(),
          resultSchema: readyResultSchema,
          handler,
        },
      ],
      installedOperations: installedReadSnapshot,
    });

    const result = await dispatcher.request(request, { ...connection, ...override });

    expect(result).toEqual({
      schemaVersion: 1,
      status: 'error',
      correlationId: 'correlation-1',
      error: {
        code: 'UNAUTHORIZED',
        message: 'Request not authorized',
        retryable: false,
      },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not reflect an unsafe correlation ID on an unauthorized request', async () => {
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      operations: [],
      installedOperations: new Set(),
    });

    await expect(
      dispatcher.request(
        { ...request, correlationId: 'unauthorized\ncontrol' },
        { ...connection, processCapability: 'wrong-capability' },
      ),
    ).resolves.toMatchObject({
      status: 'error',
      correlationId: 'invalid-request',
      error: { code: 'UNAUTHORIZED' },
    });
  });

  it('rejects malformed and unregistered requests through the same public seam', async () => {
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      operations: [],
      installedOperations: new Set(),
    });

    await expect(
      dispatcher.request({ ...request, unexpected: 'field' }, connection),
    ).resolves.toMatchObject({
      status: 'error',
      error: { code: 'INVALID_REQUEST' },
    });
    await expect(
      dispatcher.request({ ...request, operation: 'runtime.pause' }, connection),
    ).resolves.toMatchObject({
      status: 'error',
      error: { code: 'OPERATION_NOT_ALLOWED' },
    });
  });

  it('derives the role allowlist from the registered operation', async () => {
    const handler = vi.fn(async () => ({ state: 'ready' as const }));
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['operator'],
          payloadSchema: z.object({}).strict(),
          resultSchema: readyResultSchema,
          handler,
        },
      ],
      installedOperations: installedReadSnapshot,
    });

    await expect(dispatcher.request(request, connection)).resolves.toMatchObject({
      status: 'error',
      error: { code: 'OPERATION_NOT_ALLOWED' },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('strictly validates the operation payload before invoking its handler', async () => {
    const handler = vi.fn(async () => ({ state: 'ready' as const }));
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['viewer'],
          payloadSchema: z.object({ pageSize: z.number().int().min(1).max(100) }).strict(),
          resultSchema: readyResultSchema,
          handler,
        },
      ],
      installedOperations: installedReadSnapshot,
    });

    await expect(
      dispatcher.request({ ...request, payload: { pageSize: 101 } }, connection),
    ).resolves.toMatchObject({ status: 'error', error: { code: 'INVALID_REQUEST' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('redacts thrown errors without returning stack, body, or secret text', async () => {
    const events = vi.fn();
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['viewer'],
          payloadSchema: z.object({}).strict(),
          resultSchema: readyResultSchema,
          handler: async () => {
            throw new Error('secret-token body and stack must not escape');
          },
        },
      ],
      installedOperations: installedReadSnapshot,
      onSecurityEvent: events,
    });

    const result = await dispatcher.request(request, connection);
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      status: 'error',
      error: { code: 'INTERNAL_ERROR', message: 'Operation failed', retryable: false },
    });
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain('body');
    expect(events).toHaveBeenCalledWith({
      correlationId: 'correlation-1',
      operationId: 'operation-1',
      operation: 'runtime.readSnapshot',
      outcome: 'failure',
      code: 'INTERNAL_ERROR',
      safeRetry: 'do-not-retry',
      stopCondition: 'handler-failed',
    });
    expect(JSON.stringify(events.mock.calls)).not.toContain('secret-token');
  });

  it('fails closed when configured with a non-loopback Host or Origin', () => {
    expect(() =>
      createBridgeDispatcher({
        expectedHost: 'example.com:4173',
        allowedOrigins: [connection.origin],
        processCapability: connection.processCapability,
        operations: [],
        installedOperations: new Set(),
      }),
    ).toThrow('BRIDGE_LOOPBACK_CONFIGURATION_REQUIRED');
    expect(() =>
      createBridgeDispatcher({
        expectedHost: connection.host,
        allowedOrigins: ['https://example.com'],
        processCapability: connection.processCapability,
        operations: [],
        installedOperations: new Set(),
      }),
    ).toThrow('BRIDGE_LOOPBACK_CONFIGURATION_REQUIRED');
  });

  it('fails closed when the per-process capability is too short', () => {
    expect(() =>
      createBridgeDispatcher({
        expectedHost: connection.host,
        allowedOrigins: [connection.origin],
        processCapability: '',
        operations: [],
        installedOperations: new Set(),
      }),
    ).toThrow('BRIDGE_PROCESS_CAPABILITY_REQUIRED');
  });

  it('rejects registrations that are not derived from the installed operation registry', () => {
    expect(() =>
      createBridgeDispatcher({
        expectedHost: connection.host,
        allowedOrigins: [connection.origin],
        processCapability: connection.processCapability,
        operations: [
          {
            operation: 'runtime.readSnapshot',
            roles: ['viewer'],
            payloadSchema: z.object({}).strict(),
            resultSchema: readyResultSchema,
            handler: async () => ({ state: 'ready' as const }),
          },
        ],
        installedOperations: new Set(),
      }),
    ).toThrow('BRIDGE_OPERATION_REGISTRY_MISMATCH');
  });

  it('rejects provider or live operations outside the phase-zero operation contract', async () => {
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      operations: [],
      installedOperations: new Set(),
    });

    await expect(
      dispatcher.request({ ...request, operation: 'provider.send' }, connection),
    ).resolves.toMatchObject({ status: 'error', error: { code: 'INVALID_REQUEST' } });
  });

  it.each([
    'email.createDraft',
    'email.reviseDraft',
    'telegram.createMessage',
    'telegram.reviseMessage',
  ] as const)(
    'keeps additive phase-zero operation %s behind registry, role, schema, and audit gates',
    async (operation) => {
      const events = vi.fn();
      const handler = vi.fn(async () => ({ saved: true as const }));
      const dispatcher = createBridgeDispatcher({
        expectedHost: connection.host,
        allowedOrigins: [connection.origin],
        processCapability: connection.processCapability,
        operations: [
          {
            operation,
            roles: ['operator'],
            payloadSchema: z.object({ syntheticId: z.string().min(1).max(64) }).strict(),
            resultSchema: z.object({ saved: z.literal(true) }).strict(),
            handler,
          },
        ],
        installedOperations: new Set([operation]),
        onSecurityEvent: events,
      });

      await expect(
        dispatcher.request(
          { ...request, operation, role: 'viewer', payload: { syntheticId: 'fixture-1' } },
          connection,
        ),
      ).resolves.toMatchObject({
        status: 'error',
        error: { code: 'OPERATION_NOT_ALLOWED' },
      });
      expect(events).toHaveBeenCalledWith(
        expect.objectContaining({
          operation,
          outcome: 'rejected',
          code: 'OPERATION_NOT_ALLOWED',
        }),
      );
      expect(handler).not.toHaveBeenCalled();

      await expect(
        dispatcher.request(
          {
            ...request,
            operation,
            role: 'operator',
            idempotencyKey: `idempotency-${operation}-0001`,
            payload: { syntheticId: 'fixture-1' },
          },
          connection,
        ),
      ).resolves.toMatchObject({ status: 'ok', data: { saved: true } });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(events).toHaveBeenCalledWith(
        expect.objectContaining({ operation, outcome: 'accepted' }),
      );
    },
  );

  it.each(['email.reconcile', 'telegram.reconcile'] as const)(
    'enforces operator role, idempotency, and accepted audit for %s',
    async (operation) => {
      const handler = vi.fn(async () => ({ reconciled: true as const }));
      const registration = {
        operation,
        roles: ['viewer', 'operator', 'approver'] as const,
        payloadSchema: z.object({ operationId: z.string().min(1).max(128) }).strict(),
        resultSchema: z.object({ reconciled: z.literal(true) }).strict(),
        handler,
      };
      const create = (onSecurityEvent?: (event: unknown) => void) =>
        createBridgeDispatcher({
          expectedHost: connection.host,
          allowedOrigins: [connection.origin],
          processCapability: connection.processCapability,
          operations: [registration],
          installedOperations: new Set([operation]),
          onSecurityEvent,
        });
      const payload = { operationId: 'unknown-operation-1' };

      await expect(
        create(() => undefined).request(
          {
            ...request,
            operation,
            role: 'viewer',
            idempotencyKey: `idempotency-${operation}-viewer`,
            payload,
          },
          connection,
        ),
      ).resolves.toMatchObject({
        status: 'error',
        error: { code: 'OPERATION_NOT_ALLOWED' },
      });
      await expect(
        create(() => undefined).request(
          { ...request, operation, role: 'operator', payload },
          connection,
        ),
      ).resolves.toMatchObject({
        status: 'error',
        error: { code: 'INVALID_REQUEST', message: 'Idempotency key required' },
      });
      await expect(
        create().request(
          {
            ...request,
            operation,
            role: 'operator',
            idempotencyKey: `idempotency-${operation}-no-audit`,
            payload,
          },
          connection,
        ),
      ).resolves.toMatchObject({
        status: 'error',
        error: { code: 'INTERNAL_ERROR', message: 'Security audit unavailable' },
      });

      const events = vi.fn();
      await expect(
        create(events).request(
          {
            ...request,
            operation,
            role: 'operator',
            idempotencyKey: `idempotency-${operation}-success`,
            payload,
          },
          connection,
        ),
      ).resolves.toMatchObject({ status: 'ok', data: { reconciled: true } });
      expect(events).toHaveBeenCalledWith(
        expect.objectContaining({ operation, outcome: 'accepted' }),
      );
      expect(handler).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['email.previewImport', 'telegram.previewImport'] as const)(
    'treats local preview operation %s as an idempotent audited mutation',
    async (operation) => {
      const handler = vi.fn(async () => ({ previewed: true as const }));
      const registration = {
        operation,
        roles: ['operator'] as const,
        payloadSchema: z.object({ sourceRef: z.string().min(1).max(64) }).strict(),
        resultSchema: z.object({ previewed: z.literal(true) }).strict(),
        handler,
      };
      const create = (onSecurityEvent?: (event: unknown) => void) =>
        createBridgeDispatcher({
          expectedHost: connection.host,
          allowedOrigins: [connection.origin],
          processCapability: connection.processCapability,
          operations: [registration],
          installedOperations: new Set([operation]),
          onSecurityEvent,
        });
      const payload = { sourceRef: 'synthetic-source-1' };

      await expect(
        create(() => undefined).request(
          { ...request, operation, role: 'operator', payload },
          connection,
        ),
      ).resolves.toMatchObject({
        status: 'error',
        error: { code: 'INVALID_REQUEST', message: 'Idempotency key required' },
      });
      await expect(
        create().request(
          {
            ...request,
            operation,
            role: 'operator',
            idempotencyKey: `idempotency-${operation}-no-audit`,
            payload,
          },
          connection,
        ),
      ).resolves.toMatchObject({
        status: 'error',
        error: { code: 'INTERNAL_ERROR', message: 'Security audit unavailable' },
      });

      const events = vi.fn();
      await expect(
        create(events).request(
          {
            ...request,
            operation,
            role: 'operator',
            idempotencyKey: `idempotency-${operation}-success`,
            payload,
          },
          connection,
        ),
      ).resolves.toMatchObject({ status: 'ok', data: { previewed: true } });
      expect(events).toHaveBeenCalledWith(
        expect.objectContaining({ operation, outcome: 'accepted' }),
      );
      expect(handler).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['runtime.pause', 'runtime.resume', 'runtime.reconcile'] as const)(
    'treats runtime control operation %s as an operator-only idempotent audited mutation',
    async (operation) => {
      const handler = vi.fn(async () => ({ changed: true as const }));
      const registration = {
        operation,
        roles: ['viewer', 'operator', 'approver'] as const,
        payloadSchema: z.object({ reference: z.string().min(1).max(128) }).strict(),
        resultSchema: z.object({ changed: z.literal(true) }).strict(),
        handler,
      };
      const create = (onSecurityEvent?: (event: unknown) => void | Promise<void>) =>
        createBridgeDispatcher({
          expectedHost: connection.host,
          allowedOrigins: [connection.origin],
          processCapability: connection.processCapability,
          operations: [registration],
          installedOperations: new Set([operation]),
          onSecurityEvent,
        });
      const payload = { reference: 'runtime-transition-1' };

      await expect(
        create(() => undefined).request(
          {
            ...request,
            operation,
            role: 'viewer',
            idempotencyKey: `idempotency-${operation}-viewer`,
            payload,
          },
          connection,
        ),
      ).resolves.toMatchObject({
        status: 'error',
        error: { code: 'OPERATION_NOT_ALLOWED' },
      });
      await expect(
        create(() => undefined).request(
          { ...request, operation, role: 'operator', payload },
          connection,
        ),
      ).resolves.toMatchObject({
        status: 'error',
        error: { code: 'INVALID_REQUEST', message: 'Idempotency key required' },
      });
      await expect(
        create().request(
          {
            ...request,
            operation,
            role: 'operator',
            idempotencyKey: `idempotency-${operation}-no-audit`,
            payload,
          },
          connection,
        ),
      ).resolves.toMatchObject({
        status: 'error',
        error: { code: 'INTERNAL_ERROR', message: 'Security audit unavailable' },
      });

      const events = vi.fn();
      await expect(
        create(events).request(
          {
            ...request,
            operation,
            role: 'operator',
            idempotencyKey: `idempotency-${operation}-success`,
            payload,
          },
          connection,
        ),
      ).resolves.toMatchObject({ status: 'ok', data: { changed: true } });
      expect(events).toHaveBeenCalledWith(
        expect.objectContaining({ operation, outcome: 'accepted' }),
      );
      expect(handler).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'email.previewImport',
    'telegram.previewImport',
    'email.reconcile',
    'telegram.reconcile',
    'runtime.pause',
    'runtime.resume',
    'runtime.reconcile',
  ] as const)(
    'fails closed without unhandled rejection when async audit rejects for %s',
    async (operation) => {
      const handler = vi.fn(async () => ({ completed: true as const }));
      const dispatcher = createBridgeDispatcher({
        expectedHost: connection.host,
        allowedOrigins: [connection.origin],
        processCapability: connection.processCapability,
        operations: [
          {
            operation,
            roles: ['operator'],
            payloadSchema: z.object({ reference: z.string().min(1).max(128) }).strict(),
            resultSchema: z.object({ completed: z.literal(true) }).strict(),
            handler,
          },
        ],
        installedOperations: new Set([operation]),
        onSecurityEvent: async () => {
          await Promise.resolve();
          throw new Error('async audit unavailable');
        },
      });

      await expect(
        dispatcher.request(
          {
            ...request,
            operation,
            role: 'operator',
            idempotencyKey: `idempotency-${operation}-async-audit`,
            payload: { reference: 'synthetic-reference-1' },
          },
          connection,
        ),
      ).resolves.toMatchObject({
        status: 'error',
        error: { code: 'INTERNAL_ERROR', message: 'Security audit unavailable' },
      });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it.each([
    'email.createDraft',
    'email.reviseDraft',
    'telegram.createMessage',
    'telegram.reviseMessage',
  ] as const)(
    'fails closed for additive mutation %s without idempotency or accepted audit',
    async (operation) => {
      const handler = vi.fn(async () => ({ saved: true as const }));
      const registration = {
        operation,
        roles: ['operator'] as const,
        payloadSchema: z.object({ syntheticId: z.string().min(1).max(64) }).strict(),
        resultSchema: z.object({ saved: z.literal(true) }).strict(),
        handler,
      };
      const create = (onSecurityEvent?: () => void) =>
        createBridgeDispatcher({
          expectedHost: connection.host,
          allowedOrigins: [connection.origin],
          processCapability: connection.processCapability,
          operations: [registration],
          installedOperations: new Set([operation]),
          onSecurityEvent,
        });

      await expect(
        create(() => undefined).request(
          { ...request, operation, role: 'operator', payload: { syntheticId: 'fixture-1' } },
          connection,
        ),
      ).resolves.toMatchObject({
        status: 'error',
        error: { code: 'INVALID_REQUEST', message: 'Idempotency key required' },
      });
      await expect(
        create().request(
          {
            ...request,
            operation,
            role: 'operator',
            idempotencyKey: `idempotency-${operation}-0002`,
            payload: { syntheticId: 'fixture-1' },
          },
          connection,
        ),
      ).resolves.toMatchObject({
        status: 'error',
        error: { code: 'INTERNAL_ERROR', message: 'Security audit unavailable' },
      });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('rejects unsafe identifiers instead of reflecting control characters', async () => {
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['viewer'],
          payloadSchema: z.object({}).strict(),
          resultSchema: readyResultSchema,
          handler: async () => ({ state: 'ready' as const }),
        },
      ],
      installedOperations: installedReadSnapshot,
    });

    await expect(
      dispatcher.request({ ...request, correlationId: 'line\nbreak' }, connection),
    ).resolves.toMatchObject({
      status: 'error',
      correlationId: 'invalid-request',
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('redacts invalid handler results through runtime result validation', async () => {
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['viewer'],
          payloadSchema: z.object({}).strict(),
          resultSchema: readyResultSchema,
          handler: async () => ({ secret: 'must-not-escape' }),
        },
      ],
      installedOperations: installedReadSnapshot,
    });

    const result = await dispatcher.request(request, connection);

    expect(result).toMatchObject({ status: 'error', error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('must-not-escape');
  });

  it('rejects a valid but oversized handler result without returning its content', async () => {
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      maxBodyBytes: 300,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['viewer'],
          payloadSchema: z.object({}).strict(),
          resultSchema: z.object({ text: z.string().max(1_000) }).strict(),
          handler: async () => ({ text: 'sensitive-result'.repeat(50) }),
        },
      ],
      installedOperations: installedReadSnapshot,
    });

    const result = await dispatcher.request(request, connection);

    expect(result).toMatchObject({ status: 'error', error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('sensitive-result');
  });

  it('returns reconciliation-required and aborts a timed-out handler', async () => {
    let observedSignal: AbortSignal | undefined;
    const events = vi.fn();
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      handlerTimeoutMs: 5,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['viewer'],
          payloadSchema: z.object({}).strict(),
          resultSchema: readyResultSchema,
          handler: async (_payload, context) => {
            observedSignal = context.signal;
            return new Promise(() => undefined);
          },
        },
      ],
      installedOperations: installedReadSnapshot,
      onSecurityEvent: events,
    });

    await expect(dispatcher.request(request, connection)).resolves.toMatchObject({
      status: 'error',
      error: { code: 'RECONCILIATION_REQUIRED', retryable: false },
    });
    expect(observedSignal?.aborted).toBe(true);
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'timeout', safeRetry: 'reconcile-first' }),
    );
  });

  it('rejects work above the configured concurrency cap', async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      maxConcurrentOperations: 1,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['viewer'],
          payloadSchema: z.object({}).strict(),
          resultSchema: readyResultSchema,
          handler: async () => {
            await pending;
            return { state: 'ready' as const };
          },
        },
      ],
      installedOperations: installedReadSnapshot,
    });

    const first = dispatcher.request(request, connection);
    await expect(
      dispatcher.request(
        { ...request, correlationId: 'correlation-2', operationId: 'operation-2' },
        connection,
      ),
    ).resolves.toMatchObject({
      status: 'error',
      error: { code: 'OPERATION_NOT_ALLOWED', message: 'Operation unavailable' },
    });
    release?.();
    await expect(first).resolves.toMatchObject({ status: 'ok' });
  });

  it('contains a handler rejection that arrives after timeout and abort', async () => {
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      handlerTimeoutMs: 5,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['viewer'],
          payloadSchema: z.object({}).strict(),
          resultSchema: readyResultSchema,
          handler: async (_payload, context) =>
            new Promise((_resolve, reject) => {
              context.signal.addEventListener('abort', () => {
                setTimeout(() => reject(new Error('late-secret-failure')), 1);
              });
            }),
        },
      ],
      installedOperations: installedReadSnapshot,
    });

    await expect(dispatcher.request(request, connection)).resolves.toMatchObject({
      status: 'error',
      error: { code: 'RECONCILIATION_REQUIRED' },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('fails closed before approval or enqueue when security audit is unavailable', async () => {
    const handler = vi.fn(async () => ({ approved: true as const }));
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      operations: [
        {
          operation: 'email.approveDraft',
          roles: ['approver'],
          payloadSchema: z.object({ draftId: z.string().min(1) }).strict(),
          resultSchema: z.object({ approved: z.literal(true) }).strict(),
          handler,
        },
      ],
      installedOperations: new Set(['email.approveDraft']),
      onSecurityEvent: () => {
        throw new Error('audit unavailable');
      },
    });

    await expect(
      dispatcher.request(
        {
          ...request,
          operation: 'email.approveDraft',
          role: 'approver',
          idempotencyKey: 'idempotency-approve-draft-0001',
          payload: { draftId: 'draft-1' },
        },
        connection,
      ),
    ).resolves.toMatchObject({
      status: 'error',
      error: { code: 'INTERNAL_ERROR', message: 'Security audit unavailable' },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('emits sanitized security events for unauthorized, malformed, and invalid payload rejection', async () => {
    const events = vi.fn();
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['viewer'],
          payloadSchema: z.object({ pageSize: z.number().int().min(1).max(100) }).strict(),
          resultSchema: readyResultSchema,
          handler: async () => ({ state: 'ready' as const }),
        },
      ],
      installedOperations: installedReadSnapshot,
      onSecurityEvent: events,
    });

    await dispatcher.request(request, { ...connection, processCapability: 'wrong-capability' });
    await dispatcher.request({ ...request, unexpected: true }, connection);
    await dispatcher.request({ ...request, payload: { pageSize: 101 } }, connection);

    expect(events.mock.calls.map(([event]) => event.code)).toEqual([
      'UNAUTHORIZED',
      'INVALID_REQUEST',
      'INVALID_REQUEST',
    ]);
    expect(JSON.stringify(events.mock.calls)).not.toContain('wrong-capability');
    expect(JSON.stringify(events.mock.calls)).not.toContain('pageSize');
  });

  it('rejects requests above the configured body cap before handler execution', async () => {
    const handler = vi.fn(async () => ({ state: 'ready' as const }));
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      maxBodyBytes: 300,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['viewer'],
          payloadSchema: z.object({ text: z.string().max(1_000) }).strict(),
          resultSchema: readyResultSchema,
          handler,
        },
      ],
      installedOperations: installedReadSnapshot,
    });

    await expect(
      dispatcher.request({ ...request, payload: { text: 'x'.repeat(500) } }, connection),
    ).resolves.toMatchObject({ status: 'error', error: { code: 'INVALID_REQUEST' } });
    expect(handler).not.toHaveBeenCalled();
  });
});
