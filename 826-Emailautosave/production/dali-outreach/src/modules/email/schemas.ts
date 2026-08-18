import { z } from 'zod';
import { approvalBindingSchema, inputLimits, operationOutcomeSchema } from '../../contracts';

const strictApprovalBindingSchema = approvalBindingSchema.strict();
export const safeIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const safeIdempotencyKeySchema = safeIdentifierSchema.min(16);

export const operationMetadataSchema = z
  .object({
    operationId: safeIdentifierSchema.optional(),
    correlationId: safeIdentifierSchema.optional(),
  })
  .strict();

const inlineSourceSchema = z
  .object({
    kind: z.literal('inline'),
    name: z
      .string()
      .min(1)
      .max(128)
      .regex(/^(?!.*\.\.)(?!.*[\\/])[A-Za-z0-9][A-Za-z0-9._-]*\.csv$/i),
    content: z.string().min(1),
  })
  .strict();

export const importRequestSchema = z
  .object({
    source: inlineSourceSchema,
  })
  .strict();

export const emailTemplateSchema = z
  .object({
    subject: z.string().min(1).max(500),
    htmlBody: z.string().min(1).max(inputLimits.maxBodyCharacters),
    templateVersion: safeIdentifierSchema.max(64),
    variablesVersion: safeIdentifierSchema.max(64),
  })
  .strict();

const variablesSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.string().max(500))
  .refine((value) => Object.keys(value).length <= 50);

export const createDraftRequestSchema = z
  .object({
    previewId: safeIdentifierSchema,
    targetContactIds: z
      .array(safeIdentifierSchema)
      .min(1)
      .max(inputLimits.maxTargetsPerPreview),
    template: emailTemplateSchema,
    variables: variablesSchema,
  })
  .strict();

export const reviseDraftRequestSchema = z
  .object({
    draftId: safeIdentifierSchema,
    template: emailTemplateSchema,
    variables: variablesSchema,
  })
  .strict();

export const approveDraftRequestSchema = z
  .object({
    draftId: safeIdentifierSchema,
    binding: strictApprovalBindingSchema,
  })
  .strict();

export const enqueueRequestSchema = z
  .object({
    draftId: safeIdentifierSchema,
    operationId: safeIdentifierSchema,
    idempotencyKey: safeIdempotencyKeySchema,
  })
  .strict();

export const reconcileRequestSchema = z
  .object({
    targetIdempotencyKey: safeIdempotencyKeySchema,
    operationId: safeIdentifierSchema,
    outcome: z.enum(['success', 'failure']),
  })
  .strict();

export const importPreviewSchema = z
  .object({
    previewId: safeIdentifierSchema,
    contacts: z
      .array(
        z
          .object({
            contactId: safeIdentifierSchema,
            maskedEmail: z.string().min(1).max(320),
            firstName: z.string().max(201),
            company: z.string().max(201),
          })
          .strict(),
      )
      .max(inputLimits.maxImportRows),
  })
  .strict();

export const draftViewSchema = z
  .object({
    draftId: safeIdentifierSchema,
    template: emailTemplateSchema,
    binding: strictApprovalBindingSchema,
    renderedPreview: z
      .object({ subject: z.string().max(500), htmlBody: z.string() })
      .strict(),
    targetCount: z.number().int().min(1).max(inputLimits.maxTargetsPerPreview),
    approvalStatus: z.enum(['pending', 'approved', 'stale']),
  })
  .strict();

export const approvalResultSchema = z
  .object({
    draftId: safeIdentifierSchema,
    approved: z.literal(true),
    binding: strictApprovalBindingSchema,
  })
  .strict();

export const emailQueueItemSchema = z
  .object({
    queueId: safeIdentifierSchema,
    draftId: safeIdentifierSchema,
    targetCount: z.number().int().min(1).max(inputLimits.maxTargetsPerPreview),
    binding: strictApprovalBindingSchema,
    queuedAt: z.string().datetime(),
    status: z.enum(['queued-local', 'fake-failed', 'reconciliation-required']),
  })
  .strict();

export const enqueueResultSchema = z
  .object({
    outcome: operationOutcomeSchema,
    value: emailQueueItemSchema,
    replayed: z.boolean(),
  })
  .strict();
