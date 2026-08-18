import { describe, expect, it } from 'vitest';
import { createRuntimeStore } from '../../src/runtime-core';

const at = (iso: string) => new Date(iso);

describe('runtime store freshness and lifecycle', () => {
  it('moves through loading, ready, degraded, unavailable, and stale deterministically', () => {
    const clock = { now: () => at('2026-08-17T10:00:00.000Z') };
    const store = createRuntimeStore({ clock, ttlMs: 60_000 });

    expect(store.readSnapshot().freshness).toBe('loading');
    store.recordReady({ source: 'fixture' });
    expect(store.readSnapshot().freshness).toBe('ready');
    expect(store.readSnapshot()).toMatchObject({
      source: 'temporary-runtime-store',
      ttlMs: 60_000,
      freshUntil: '2026-08-17T10:01:00.000Z',
    });
    store.recordDegraded('fixture warning');
    expect(store.readSnapshot().freshness).toBe('degraded');
    store.recordUnavailable('fixture unavailable');
    expect(store.readSnapshot().freshness).toBe('unavailable');

    clock.now = () => at('2026-08-17T10:01:00.000Z');
    expect(store.readSnapshot().freshness).toBe('stale');
  });

  it('pauses, resumes, versions each state change, and resets for deterministic tests', () => {
    const store = createRuntimeStore({
      clock: { now: () => at('2026-08-17T10:00:00.000Z') },
      ttlMs: 60_000,
    });

    expect(store.pause('maintenance').version).toBe(1);
    expect(store.readSnapshot().paused).toBe(true);
    expect(store.resume().version).toBe(2);
    expect(store.readSnapshot().paused).toBe(false);

    store.reset();
    expect(store.readSnapshot()).toMatchObject({ version: 0, freshness: 'loading', paused: false });
    expect(store.readAudit()).toEqual([
      expect.objectContaining({ type: 'runtime.paused', sequence: 1 }),
      expect.objectContaining({ type: 'runtime.resumed', sequence: 2 }),
      expect.objectContaining({ type: 'runtime.reset', sequence: 3 }),
    ]);
  });

  it('blocks new work while paused but permits cached replay', async () => {
    const store = createRuntimeStore({
      clock: { now: () => at('2026-08-17T10:00:00.000Z') },
      ttlMs: 60_000,
    });
    let executions = 0;
    const request = {
      operationId: 'operation-1',
      idempotencyKey: 'stable-key-123456',
      payloadHash: 'payload-a',
      execute: () => {
        executions += 1;
        return { outcome: 'success' as const, value: 'done' };
      },
    };
    await store.runOperation(request);
    store.pause('safe stop');

    await expect(store.runOperation(request)).resolves.toMatchObject({ replayed: true });
    await expect(
      store.runOperation({ ...request, idempotencyKey: 'new-key-12345678' }),
    ).rejects.toThrow('RUNTIME_PAUSED');
    expect(executions).toBe(1);
  });

  it('does not let pre-reset completion mutate post-reset state', async () => {
    const store = createRuntimeStore({
      clock: { now: () => at('2026-08-17T10:00:00.000Z') },
      ttlMs: 60_000,
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = store.runOperation({
      operationId: 'pre-reset',
      idempotencyKey: 'pre-reset-key-1234',
      payloadHash: 'payload-a',
      execute: async () => {
        await held;
        return { outcome: 'success' as const, value: 'old' };
      },
    });

    store.reset();
    release();
    await pending;

    expect(store.readAudit().map((event) => event.type)).toEqual(['runtime.reset']);
  });
});

describe('runtime store operations', () => {
  it.each(['success', 'failure', 'unknown'] as const)('audits a %s outcome', async (outcome) => {
    const store = createRuntimeStore({
      clock: { now: () => at('2026-08-17T10:00:00.000Z') },
      ttlMs: 60_000,
    });

    await store.runOperation({
      operationId: `operation-${outcome}`,
      idempotencyKey: `key-${outcome}`,
      payloadHash: `hash-${outcome}`,
      execute: () => ({ outcome, value: outcome }),
    });

    expect(store.readAudit().at(-1)).toMatchObject({
      type: 'operation.completed',
      operationId: `operation-${outcome}`,
      outcome,
    });
  });

  it('returns one deterministic result for concurrent duplicates', async () => {
    const store = createRuntimeStore({
      clock: { now: () => at('2026-08-17T10:00:00.000Z') },
      ttlMs: 60_000,
    });
    let executions = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = {
      operationId: 'operation-1',
      idempotencyKey: 'stable-key-123456',
      payloadHash: 'payload-a',
      execute: async () => {
        executions += 1;
        await held;
        return { outcome: 'success' as const, value: 'done' };
      },
    };

    const first = store.runOperation(request);
    const duplicate = store.runOperation(request);
    release();

    expect(await first).toEqual(await duplicate);
    expect(executions).toBe(1);
  });

  it('rejects the same idempotency key when the payload changes', async () => {
    const store = createRuntimeStore({
      clock: { now: () => at('2026-08-17T10:00:00.000Z') },
      ttlMs: 60_000,
    });
    await store.runOperation({
      operationId: 'operation-1',
      idempotencyKey: 'stable-key-123456',
      payloadHash: 'payload-a',
      execute: () => ({ outcome: 'success', value: 'done' }),
    });

    await expect(
      store.runOperation({
        operationId: 'operation-2',
        idempotencyKey: 'stable-key-123456',
        payloadHash: 'payload-b',
        execute: () => ({ outcome: 'success', value: 'wrong' }),
      }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  it('replays thrown execution failures as the same rejection without executing again', async () => {
    const store = createRuntimeStore({
      clock: { now: () => at('2026-08-17T10:00:00.000Z') },
      ttlMs: 60_000,
    });
    let executions = 0;
    const failure = new Error('fixture failed');
    const request = {
      operationId: 'operation-failure',
      idempotencyKey: 'failure-key-123456',
      payloadHash: 'payload-a',
      execute: () => {
        executions += 1;
        throw failure;
      },
    };

    await expect(store.runOperation(request)).rejects.toBe(failure);
    await expect(store.runOperation(request)).rejects.toBe(failure);
    expect(executions).toBe(1);
    expect(store.readAudit().at(-1)).toMatchObject({ outcome: 'failure' });
    expect(store.readAudit().at(-1)).toMatchObject({
      failure: {
        code: 'EXECUTION_THROWN',
        retryDisposition: 'replay-only',
        stopCondition: 'operator-review-required',
      },
    });
  });

  it('blocks retries after an unknown outcome until reconciliation', async () => {
    const store = createRuntimeStore({
      clock: { now: () => at('2026-08-17T10:00:00.000Z') },
      ttlMs: 60_000,
    });
    const request = {
      operationId: 'operation-unknown',
      idempotencyKey: 'unknown-key-123456',
      payloadHash: 'payload-a',
      execute: () => ({ outcome: 'unknown' as const, value: null }),
    };

    await store.runOperation(request);
    await expect(store.runOperation(request)).rejects.toThrow('RECONCILIATION_REQUIRED');

    store.reconcile({
      idempotencyKey: request.idempotencyKey,
      outcome: 'success',
      value: 'confirmed',
    });
    await expect(store.runOperation(request)).resolves.toMatchObject({
      outcome: 'success',
      value: 'confirmed',
      replayed: true,
    });
  });
});
