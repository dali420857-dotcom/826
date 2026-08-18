import type {
  TelegramApprovalResult,
  TelegramApprovePayload,
  TelegramCreateMessagePayload,
  TelegramEnqueuePayload,
  TelegramPreviewImportPayload,
  TelegramPreviewResult,
  TelegramQueueResult,
  TelegramReconcilePayload,
  TelegramReviseMessagePayload,
  TelegramTargetPreviewResult,
} from '..';

export interface TelegramUiSnapshot {
  readonly maskedAccount: string;
  readonly sessionState: 'ready' | 'degraded' | 'stale';
  readonly providerAccess: false;
  readonly paused: boolean;
  readonly reconciliationRequired: boolean;
}

export interface TelegramUiAuditEvent {
  readonly type:
    | 'telegram.targets-previewed'
    | 'telegram.message-created'
    | 'telegram.message-revised'
    | 'telegram.approved'
    | 'telegram.queued'
    | 'telegram.enqueue-failure'
    | 'telegram.enqueue-unknown'
    | 'telegram.reconciled'
    | 'telegram.paused'
    | 'telegram.resumed';
  readonly outcome?: 'success' | 'failure' | 'unknown';
}

export interface TelegramUiClient {
  readSnapshot(): Promise<TelegramUiSnapshot>;
  readAudit(): Promise<readonly TelegramUiAuditEvent[]>;
  previewTargets(input: TelegramPreviewImportPayload): Promise<TelegramTargetPreviewResult>;
  createMessage(input: TelegramCreateMessagePayload): Promise<TelegramPreviewResult>;
  reviseMessage(input: TelegramReviseMessagePayload): Promise<TelegramPreviewResult>;
  approveMessage(input: TelegramApprovePayload): Promise<TelegramApprovalResult>;
  enqueueLocal(input: TelegramEnqueuePayload): Promise<TelegramQueueResult>;
  reconcile(input: TelegramReconcilePayload['outcome']): Promise<TelegramQueueResult>;
  pause(): Promise<TelegramUiSnapshot>;
  resume(): Promise<TelegramUiSnapshot>;
}
