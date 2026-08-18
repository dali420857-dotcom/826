import { z } from 'zod';
import { approvalBindingSchema, inputLimits } from '../../contracts';

const noUnsafeControls = (value: string) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
const templateFields = {
  template: z.string().min(1).max(inputLimits.maxBodyCharacters).refine(noUnsafeControls),
  variables: z
    .record(
      z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
      z.string().max(2_000).refine(noUnsafeControls),
    )
    .refine((value) => Object.keys(value).length <= 50),
  templateVersion: z.string().min(1).max(64),
  variablesVersion: z.string().min(1).max(64),
  expectedStateVersion: z.number().int().nonnegative(),
} as const;

export const telegramApprovalBindingSchema = approvalBindingSchema.strict();

export const telegramPreviewImportPayloadSchema = z
  .object({ csvText: z.string().min(1).max(inputLimits.maxImportBytes) })
  .strict();

export const telegramTargetSchema = z
  .object({
    targetRef: z.string().regex(/^synthetic:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
    displayName: z.string().min(1).max(128).refine(noUnsafeControls),
  })
  .strict();

export const telegramTargetPreviewResultSchema = z
  .object({
    targetPreviewId: z.string().regex(/^tg-targets-[a-f0-9]{16}$/),
    targets: z.array(telegramTargetSchema).min(1).max(inputLimits.maxTargetsPerPreview),
    targetSetHash: z.string().regex(/^[a-f0-9]{64}$/),
    sessionState: z.enum(['ready', 'degraded', 'stale']),
  })
  .strict();

export const telegramCreateMessagePayloadSchema = z
  .object({
    targetPreviewId: z.string().regex(/^tg-targets-[a-f0-9]{16}$/),
    ...templateFields,
  })
  .strict();

export const telegramReviseMessagePayloadSchema = z
  .object({
    previewId: z.string().regex(/^tg-preview-[a-f0-9]{16}$/),
    ...templateFields,
  })
  .strict();

export const telegramPreviewResultSchema = z
  .object({
    previewId: z.string().regex(/^tg-preview-[a-f0-9]{16}$/),
    targetPreviewId: z.string().regex(/^tg-targets-[a-f0-9]{16}$/),
    renderedMessage: z.string().min(1).max(inputLimits.maxBodyCharacters * 2),
    binding: telegramApprovalBindingSchema,
    sessionState: z.enum(['ready', 'degraded', 'stale']),
  })
  .strict();

export const telegramApprovePayloadSchema = z
  .object({
    previewId: z.string().regex(/^tg-preview-[a-f0-9]{16}$/),
    binding: telegramApprovalBindingSchema,
  })
  .strict();

export const telegramApprovalResultSchema = z
  .object({
    approvalId: z.string().regex(/^tg-approval-[a-f0-9]{16}$/),
    previewId: z.string().regex(/^tg-preview-[a-f0-9]{16}$/),
    binding: telegramApprovalBindingSchema,
  })
  .strict();

export const telegramEnqueuePayloadSchema = z
  .object({
    previewId: z.string().regex(/^tg-preview-[a-f0-9]{16}$/),
    approvalId: z.string().regex(/^tg-approval-[a-f0-9]{16}$/),
    binding: telegramApprovalBindingSchema,
  })
  .strict();

export const telegramQueueResultSchema = z
  .object({
    outcome: z.enum(['success', 'failure', 'unknown']),
    value: z.object({ queueReceipt: z.string().min(1).max(128) }).strict(),
    replayed: z.boolean(),
  })
  .strict();

export const telegramFakeAdapterResultSchema = z
  .object({
    outcome: z.enum(['success', 'failure', 'unknown']),
    queueReceipt: z.string().min(1).max(128),
  })
  .strict();

export const telegramReconcilePayloadSchema = z
  .object({
    targetIdempotencyKey: z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/),
    outcome: z.enum(['success', 'failure']),
    queueReceipt: z.string().min(1).max(128),
  })
  .strict();

export const telegramSessionEvidenceSchema = z
  .object({
    source: z.literal('synthetic-fixture'),
    maskedAccount: z.string().regex(/^tg-\*{3}-\d{4}$/),
    state: z.enum(['ready', 'degraded']),
    observedAt: z.string().datetime(),
    freshUntil: z.string().datetime(),
    providerAccess: z.literal(false),
  })
  .strict()
  .refine((value) => new Date(value.freshUntil) > new Date(value.observedAt));

export const telegramSnapshotSchema = z
  .object({
    moduleId: z.literal('telegram'),
    source: z.literal('synthetic-fixture'),
    maskedAccount: z.string().min(5).max(64),
    sessionState: z.enum(['ready', 'degraded', 'stale']),
    providerAccess: z.literal(false),
    targetPreviewCount: z.number().int().nonnegative(),
    messagePreviewCount: z.number().int().nonnegative(),
    approvalCount: z.number().int().nonnegative(),
    queueCount: z.number().int().nonnegative(),
    stateVersion: z.number().int().nonnegative(),
  })
  .strict();

export type TelegramApprovalBinding = z.infer<typeof telegramApprovalBindingSchema>;
export type TelegramPreviewImportPayload = z.infer<typeof telegramPreviewImportPayloadSchema>;
export type TelegramTargetPreviewResult = z.infer<typeof telegramTargetPreviewResultSchema>;
export type TelegramCreateMessagePayload = z.infer<typeof telegramCreateMessagePayloadSchema>;
export type TelegramReviseMessagePayload = z.infer<typeof telegramReviseMessagePayloadSchema>;
export type TelegramPreviewResult = z.infer<typeof telegramPreviewResultSchema>;
export type TelegramApprovePayload = z.infer<typeof telegramApprovePayloadSchema>;
export type TelegramApprovalResult = z.infer<typeof telegramApprovalResultSchema>;
export type TelegramEnqueuePayload = z.infer<typeof telegramEnqueuePayloadSchema>;
export type TelegramQueueResult = z.infer<typeof telegramQueueResultSchema>;
export type TelegramReconcilePayload = z.infer<typeof telegramReconcilePayloadSchema>;
export type TelegramSessionEvidence = z.infer<typeof telegramSessionEvidenceSchema>;
export type TelegramSnapshot = z.infer<typeof telegramSnapshotSchema>;
