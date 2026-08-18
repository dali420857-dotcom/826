import { z } from 'zod';
import { inputLimits, operationOutcomeSchema } from '../../contracts';

export const dataIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const inlineDataSourceSchema = z
  .object({
    kind: z.literal('inline'),
    name: z
      .string()
      .min(1)
      .max(128)
      .regex(/^(?!.*\.\.)(?!.*[\\/])[A-Za-z0-9][A-Za-z0-9._-]*\.csv$/i),
    content: z.string().min(1).max(inputLimits.maxBodyCharacters),
  })
  .strict();

export const dataPreviewImportRequestSchema = z
  .object({ source: inlineDataSourceSchema })
  .strict();

export const dataPreviewRowSchema = z
  .object({
    rowNumber: z.number().int().positive(),
    customerRef: dataIdentifierSchema.max(64),
    maskedEmail: z.string().min(1).max(320),
    displayName: z.string().min(1).max(200),
    company: z.string().min(1).max(200),
  })
  .strict();

export const dataPreviewSchema = z
  .object({
    previewId: dataIdentifierSchema,
    columns: z.array(z.string().min(1).max(64)).length(4),
    rowCount: z.number().int().nonnegative().max(inputLimits.maxImportRows),
    rows: z.array(dataPreviewRowSchema).max(inputLimits.maxImportRows),
  })
  .strict();

export const dataImportBatchRequestSchema = z
  .object({ previewId: dataIdentifierSchema })
  .strict();

export const workItemStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'blocked',
]);

export const channelStatusSchema = z.enum(['pending', 'done', 'blocked']);

export const customerViewSchema = z
  .object({
    customerId: dataIdentifierSchema,
    customerRef: dataIdentifierSchema.max(64),
    maskedEmail: z.string().min(1).max(320),
    displayName: z.string().min(1).max(200),
    company: z.string().min(1).max(200),
  })
  .strict();

export const workItemSchema = z
  .object({
    workItemId: dataIdentifierSchema,
    batchId: dataIdentifierSchema,
    customerId: dataIdentifierSchema,
    customer: customerViewSchema,
    status: workItemStatusSchema,
    owner: dataIdentifierSchema.max(64).nullable(),
    emailStatus: channelStatusSchema,
    telegramStatus: channelStatusSchema,
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const dataImportBatchResultSchema = z
  .object({
    batchId: dataIdentifierSchema,
    customerCount: z.number().int().nonnegative(),
    workItemCount: z.number().int().nonnegative(),
    items: z.array(workItemSchema),
  })
  .strict();

export const listWorkItemsRequestSchema = z
  .object({
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().positive().max(inputLimits.maxPageSize).default(20),
    status: workItemStatusSchema.optional(),
    owner: dataIdentifierSchema.max(64).optional(),
  })
  .strict();

export const listWorkItemsResultSchema = z
  .object({
    items: z.array(workItemSchema),
    pagination: z
      .object({
        page: z.number().int().positive(),
        pageSize: z.number().int().positive(),
        totalItems: z.number().int().nonnegative(),
        totalPages: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const updateWorkItemRequestSchema = z
  .object({
    workItemId: dataIdentifierSchema,
    expectedVersion: z.number().int().nonnegative(),
    status: workItemStatusSchema.optional(),
    owner: dataIdentifierSchema.max(64).nullable().optional(),
    emailStatus: channelStatusSchema.optional(),
    telegramStatus: channelStatusSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== undefined ||
      value.owner !== undefined ||
      value.emailStatus !== undefined ||
      value.telegramStatus !== undefined,
    'At least one work-item field is required',
  );

export const dataAuditEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    occurredAt: z.string().datetime(),
    type: z.enum([
      'data.import.previewed',
      'data.batch.imported',
      'data.work-item.updated',
    ]),
    count: z.number().int().nonnegative().optional(),
    batchId: dataIdentifierSchema.optional(),
    workItemId: dataIdentifierSchema.optional(),
    operationId: dataIdentifierSchema.optional(),
    correlationId: dataIdentifierSchema.optional(),
    status: workItemStatusSchema.optional(),
    outcome: operationOutcomeSchema.optional(),
  })
  .strict();

export const dataAuditResultSchema = z.array(dataAuditEventSchema);

export type DataPreviewImportRequest = z.infer<typeof dataPreviewImportRequestSchema>;
export type DataPreview = z.infer<typeof dataPreviewSchema>;
export type DataImportBatchRequest = z.infer<typeof dataImportBatchRequestSchema>;
export type WorkItem = z.infer<typeof workItemSchema>;
export type DataImportBatchResult = z.infer<typeof dataImportBatchResultSchema>;
export type ListWorkItemsRequest = z.infer<typeof listWorkItemsRequestSchema>;
export type ListWorkItemsResult = z.infer<typeof listWorkItemsResultSchema>;
export type UpdateWorkItemRequest = z.infer<typeof updateWorkItemRequestSchema>;
export type DataAuditEvent = z.infer<typeof dataAuditEventSchema>;
