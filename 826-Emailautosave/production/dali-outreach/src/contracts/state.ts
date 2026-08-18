import { z } from 'zod';

export const freshnessSchema = z.enum([
  'loading',
  'ready',
  'degraded',
  'unavailable',
  'stale',
]);

export const operationOutcomeSchema = z.enum(['success', 'failure', 'unknown']);

export const approvalBindingSchema = z.object({
  schemaVersion: z.literal(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  templateVersion: z.string().min(1).max(64),
  variablesVersion: z.string().min(1).max(64),
  targetSetHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedStateVersion: z.number().int().nonnegative(),
});

export type ApprovalBinding = z.infer<typeof approvalBindingSchema>;

export function approvalStillMatches(
  approved: ApprovalBinding,
  current: ApprovalBinding,
): boolean {
  return (
    approved.schemaVersion === current.schemaVersion &&
    approved.contentHash === current.contentHash &&
    approved.templateVersion === current.templateVersion &&
    approved.variablesVersion === current.variablesVersion &&
    approved.targetSetHash === current.targetSetHash &&
    approved.expectedStateVersion === current.expectedStateVersion
  );
}

export type IdempotencyDecision =
  | { status: 'new' }
  | { status: 'duplicate'; operationId: string }
  | { status: 'conflict'; code: 'IDEMPOTENCY_CONFLICT' };

export function decideIdempotency(
  existing: { payloadHash: string; operationId: string } | undefined,
  payloadHash: string,
): IdempotencyDecision {
  if (!existing) return { status: 'new' };
  if (existing.payloadHash === payloadHash) {
    return { status: 'duplicate', operationId: existing.operationId };
  }
  return { status: 'conflict', code: 'IDEMPOTENCY_CONFLICT' };
}
