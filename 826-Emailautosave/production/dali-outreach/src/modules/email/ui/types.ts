import type { z } from 'zod';
import type { OperationOutcome, OperationResult } from '../../../runtime-core';
import type { createEmailOutreachModule } from '../email-outreach';
import type {
  approveDraftRequestSchema,
  createDraftRequestSchema,
  importRequestSchema,
  reviseDraftRequestSchema,
} from '../schemas';

type EmailService = ReturnType<typeof createEmailOutreachModule>;

export type SyntheticEmailOutcome = OperationOutcome;
export type EmailImportRequest = z.infer<typeof importRequestSchema>;
export type EmailCreateDraftRequest = z.infer<typeof createDraftRequestSchema>;
export type EmailReviseDraftRequest = z.infer<typeof reviseDraftRequestSchema>;
export type EmailApproveDraftRequest = z.infer<typeof approveDraftRequestSchema>;
export type EmailImportPreview = ReturnType<EmailService['previewImport']>;
export type EmailDraftView = NonNullable<ReturnType<EmailService['readDraft']>>;
export type EmailAuditReadback = ReturnType<EmailService['readAudit']>;
export type EmailQueueReadback = ReturnType<EmailService['readQueue']>;
export type EmailQueueItem = EmailQueueReadback[number];

export interface EmailUiStatus {
  readonly paused: boolean;
  readonly syntheticOutcome: SyntheticEmailOutcome;
}

export interface EmailEnqueueReadback {
  readonly targetIdempotencyKey: string;
  readonly result: OperationResult<EmailQueueItem>;
}

export interface EmailUiClient {
  getStatus(): EmailUiStatus | Promise<EmailUiStatus>;
  pause(): EmailUiStatus | Promise<EmailUiStatus>;
  resume(): EmailUiStatus | Promise<EmailUiStatus>;
  setSyntheticOutcome(outcome: SyntheticEmailOutcome): EmailUiStatus | Promise<EmailUiStatus>;
  previewImport(input: EmailImportRequest): Promise<EmailImportPreview>;
  createDraft(input: EmailCreateDraftRequest): Promise<EmailDraftView>;
  reviseDraft(input: EmailReviseDraftRequest): Promise<EmailDraftView>;
  approveDraft(input: EmailApproveDraftRequest): Promise<EmailDraftView>;
  enqueueLocal(draftId: string): Promise<EmailEnqueueReadback>;
  reconcile(
    targetIdempotencyKey: string,
    outcome: Exclude<SyntheticEmailOutcome, 'unknown'>,
  ): Promise<OperationResult<EmailQueueItem>>;
  readDraft(draftId: string): Promise<EmailDraftView | undefined>;
  readAudit(): Promise<EmailAuditReadback>;
  readQueue(): Promise<EmailQueueReadback>;
}
