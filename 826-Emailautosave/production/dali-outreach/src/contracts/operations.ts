import { z } from 'zod';

export const operationNameSchema = z.enum([
  'runtime.readSnapshot',
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
  'data.listWorkItems',
  'data.updateWorkItem',
  'data.readAudit',
]);

export type OperationName = z.infer<typeof operationNameSchema>;

export const bridgeRequestSchema = z.object({
  schemaVersion: z.literal(1),
  correlationId: z.string().min(1).max(128),
  operationId: z.string().min(1).max(128),
  idempotencyKey: z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
  operation: operationNameSchema,
  role: z.enum(['viewer', 'operator', 'approver']),
  payload: z.record(z.string(), z.unknown()),
});

export type BridgeRequest = z.infer<typeof bridgeRequestSchema>;
