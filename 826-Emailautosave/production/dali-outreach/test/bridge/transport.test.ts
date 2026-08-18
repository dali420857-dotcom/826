import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createBridgeDispatcher, createBridgeTransport } from '../../src/bridge';

describe('typed bridge transport', () => {
  it('preserves the registered operation result type and fixed envelope at runtime', async () => {
    const connection = {
      remoteAddress: '127.0.0.1',
      host: '127.0.0.1:4173',
      origin: 'http://127.0.0.1:4173',
      processCapability: 'phase-zero-test-capability',
    } as const;
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      operations: [
        {
          operation: 'runtime.readSnapshot',
          roles: ['viewer'],
          payloadSchema: z.object({ pageSize: z.number().int().min(1).max(100) }).strict(),
          resultSchema: z.object({ state: z.literal('ready') }).strict(),
          handler: async () => ({ state: 'ready' as const }),
        },
      ],
      installedOperations: new Set(['runtime.readSnapshot']),
    });
    const transport = createBridgeTransport(dispatcher);

    const result = await transport.request(
      {
        schemaVersion: 1,
        correlationId: 'correlation-transport',
        operationId: 'operation-transport',
        operation: 'runtime.readSnapshot',
        role: 'viewer',
        payload: { pageSize: 25 },
      },
      connection,
    );

    expect(result).toEqual({
      schemaVersion: 1,
      status: 'ok',
      correlationId: 'correlation-transport',
      data: { state: 'ready' },
    });
    if (result.status === 'ok') {
      const state: 'ready' = result.data.state;
      expect(state).toBe('ready');
    }

    if (false) {
      transport.request(
        {
          schemaVersion: 1,
          correlationId: 'compile-only',
          operationId: 'compile-only',
          operation: 'runtime.readSnapshot',
          role: 'viewer',
          // @ts-expect-error operation-specific payload types reject a string page size.
          payload: { pageSize: '25' },
        },
        connection,
      );
    }
  });

  it('infers additive draft payload and result types from its registered operation', async () => {
    const connection = {
      remoteAddress: '127.0.0.1',
      host: '127.0.0.1:4173',
      origin: 'http://127.0.0.1:4173',
      processCapability: 'phase-zero-test-capability',
    } as const;
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      operations: [
        {
          operation: 'email.createDraft',
          roles: ['operator'],
          payloadSchema: z.object({ subject: z.string().min(1).max(200) }).strict(),
          resultSchema: z.object({ draftId: z.string().min(1) }).strict(),
          handler: async () => ({ draftId: 'draft-fixture-1' }),
        },
      ],
      installedOperations: new Set(['email.createDraft']),
      onSecurityEvent: () => undefined,
    });
    const transport = createBridgeTransport(dispatcher);

    const result = await transport.request(
      {
        schemaVersion: 1,
        correlationId: 'correlation-create-draft',
        operationId: 'operation-create-draft',
        operation: 'email.createDraft',
        role: 'operator',
        idempotencyKey: 'idempotency-create-draft-0001',
        payload: { subject: 'Synthetic subject' },
      },
      connection,
    );

    if (result.status === 'ok') {
      const draftId: string = result.data.draftId;
      expect(draftId).toBe('draft-fixture-1');
    }

    if (false) {
      transport.request(
        {
          schemaVersion: 1,
          correlationId: 'compile-only-draft',
          operationId: 'compile-only-draft',
          operation: 'email.createDraft',
          role: 'operator',
          idempotencyKey: 'idempotency-compile-only-0001',
          // @ts-expect-error additive operation keeps its operation-specific payload type.
          payload: { subject: 123 },
        },
        connection,
      );

      transport.request(
        // @ts-expect-error additive mutation operations require a top-level idempotency key.
        {
          schemaVersion: 1,
          correlationId: 'compile-only-missing-idempotency',
          operationId: 'compile-only-missing-idempotency',
          operation: 'email.createDraft',
          role: 'operator',
          payload: { subject: 'Synthetic subject' },
        },
        connection,
      );
    }
  });

  it('types reconcile as an idempotent operator mutation', async () => {
    const connection = {
      remoteAddress: '127.0.0.1',
      host: '127.0.0.1:4173',
      origin: 'http://127.0.0.1:4173',
      processCapability: 'phase-zero-test-capability',
    } as const;
    const dispatcher = createBridgeDispatcher({
      expectedHost: connection.host,
      allowedOrigins: [connection.origin],
      processCapability: connection.processCapability,
      operations: [
        {
          operation: 'telegram.reconcile',
          roles: ['operator'],
          payloadSchema: z.object({ operationId: z.string().min(1) }).strict(),
          resultSchema: z.object({ reconciled: z.literal(true) }).strict(),
          handler: async () => ({ reconciled: true as const }),
        },
      ],
      installedOperations: new Set(['telegram.reconcile']),
      onSecurityEvent: () => undefined,
    });
    const transport = createBridgeTransport(dispatcher);

    const result = await transport.request(
      {
        schemaVersion: 1,
        correlationId: 'correlation-reconcile',
        operationId: 'operation-reconcile',
        operation: 'telegram.reconcile',
        role: 'operator',
        idempotencyKey: 'idempotency-reconcile-0001',
        payload: { operationId: 'unknown-operation-1' },
      },
      connection,
    );
    expect(result).toMatchObject({ status: 'ok', data: { reconciled: true } });

    if (false) {
      transport.request(
        // @ts-expect-error reconcile requires a top-level idempotency key.
        {
          schemaVersion: 1,
          correlationId: 'compile-only-reconcile',
          operationId: 'compile-only-reconcile',
          operation: 'telegram.reconcile',
          role: 'operator',
          payload: { operationId: 'unknown-operation-1' },
        },
        connection,
      );
    }
  });
});
