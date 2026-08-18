import { describe, expect, it } from 'vitest';
import {
  approvalStillMatches,
  assertMatchingModuleIds,
  bridgeRequestSchema,
  decideIdempotency,
  phaseZeroRuntimeSchema,
  operationNameSchema,
} from '../src/contracts';

describe('phase-0 contract', () => {
  it('rejects unrelated and arbitrary operations', () => {
    expect(() =>
      bridgeRequestSchema.parse({
        schemaVersion: 1,
        correlationId: 'correlation-1',
        operationId: 'operation-1',
        operation: 'provider.send',
        role: 'operator',
        payload: {},
      }),
    ).toThrow();
  });

  it('rejects unsafe top-level idempotency identifiers', () => {
    const base = {
      schemaVersion: 1 as const,
      correlationId: 'correlation-1',
      operationId: 'operation-1',
      operation: 'email.previewImport' as const,
      role: 'operator' as const,
      payload: {},
    };
    expect(() => bridgeRequestSchema.parse({ ...base, idempotencyKey: 'unsafe-line-break\nkey' })).toThrow();
    expect(() => bridgeRequestSchema.parse({ ...base, idempotencyKey: 'unicode-key-測試-123456' })).toThrow();
  });

  it('rejects active mode and provider adapters', () => {
    expect(() =>
      phaseZeroRuntimeSchema.parse({
        mode: 'active',
        providerAdapters: ['live'],
        liveSend: true,
        allowedOrigins: ['http://127.0.0.1:4173'],
      }),
    ).toThrow();
  });

  it('rejects mismatched module contributions', () => {
    expect(() =>
      assertMatchingModuleIds(
        [{ moduleId: 'email', navItems: [], routes: [] }],
        [],
        [],
      ),
    ).toThrow('MODULE_REGISTRY_MISMATCH');
  });

  it('invalidates approval after any bound content change', () => {
    const approved = {
      schemaVersion: 1 as const,
      contentHash: 'a'.repeat(64),
      templateVersion: 'template-1',
      variablesVersion: 'variables-1',
      targetSetHash: 'b'.repeat(64),
      expectedStateVersion: 3,
    };
    expect(approvalStillMatches(approved, approved)).toBe(true);
    expect(approvalStillMatches(approved, { ...approved, contentHash: 'c'.repeat(64) })).toBe(
      false,
    );
  });

  it('rejects an idempotency key reused with a different payload', () => {
    expect(decideIdempotency({ payloadHash: 'first', operationId: 'op-1' }, 'second')).toEqual({
      status: 'conflict',
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('exposes explicit draft and message revision operations for approval invalidation', () => {
    expect(operationNameSchema.parse('email.createDraft')).toBe('email.createDraft');
    expect(operationNameSchema.parse('email.reviseDraft')).toBe('email.reviseDraft');
    expect(operationNameSchema.parse('telegram.createMessage')).toBe('telegram.createMessage');
    expect(operationNameSchema.parse('telegram.reviseMessage')).toBe('telegram.reviseMessage');
    expect(operationNameSchema.parse('email.reconcile')).toBe('email.reconcile');
    expect(operationNameSchema.parse('telegram.reconcile')).toBe('telegram.reconcile');
    expect(operationNameSchema.parse('data.importBatch')).toBe('data.importBatch');
    expect(operationNameSchema.parse('data.updateWorkItem')).toBe('data.updateWorkItem');
  });
});

describe('process no-egress preload', () => {
  it('blocks non-loopback fetch before a request leaves the process', async () => {
    await expect(fetch('https://example.com')).rejects.toThrow('NO_EGRESS_BLOCKED');
  });
});
