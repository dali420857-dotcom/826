import type {
  TelegramApprovalResult,
  TelegramPreviewResult,
  TelegramQueueResult,
  TelegramTargetPreviewResult,
} from '..';
import type { TelegramUiAuditEvent, TelegramUiClient, TelegramUiSnapshot } from './client';

/** Browser-safe deterministic client. It has no provider, credential, network, or send capability. */
export class SyntheticTelegramUiClient implements TelegramUiClient {
  private snapshot: TelegramUiSnapshot = {
    maskedAccount: 'tg-***-4821',
    sessionState: 'ready',
    providerAccess: false,
    paused: false,
    reconciliationRequired: false,
  };
  private readonly audit: TelegramUiAuditEvent[] = [];
  private preview?: TelegramPreviewResult;

  async readSnapshot() { return { ...this.snapshot }; }
  async readAudit() { return [...this.audit]; }

  async previewTargets(): Promise<TelegramTargetPreviewResult> {
    this.audit.push({ type: 'telegram.targets-previewed' });
    return {
      targetPreviewId: 'tg-targets-1111111111111111',
      targets: [{ targetRef: 'synthetic:prospect_1', displayName: '合成聯絡人' }],
      targetSetHash: '1'.repeat(64),
      sessionState: 'ready',
    };
  }

  async createMessage(input: Parameters<TelegramUiClient['createMessage']>[0]) {
    this.preview = {
      previewId: 'tg-preview-2222222222222222',
      targetPreviewId: input.targetPreviewId,
      renderedMessage: input.template.replace('{{name}}', input.variables.name ?? ''),
      binding: {
        schemaVersion: 1,
        contentHash: '2'.repeat(64),
        templateVersion: input.templateVersion,
        variablesVersion: input.variablesVersion,
        targetSetHash: '1'.repeat(64),
        expectedStateVersion: input.expectedStateVersion,
      },
      sessionState: 'ready',
    };
    this.audit.push({ type: 'telegram.message-created' });
    return this.preview;
  }

  async reviseMessage(input: Parameters<TelegramUiClient['reviseMessage']>[0]) {
    if (!this.preview || this.preview.previewId !== input.previewId) {
      throw new Error('APPROVAL_INVALIDATED');
    }
    this.preview = {
      ...this.preview,
      renderedMessage: input.template.replace('{{name}}', input.variables.name ?? ''),
      binding: {
        ...this.preview.binding,
        contentHash: '3'.repeat(64),
        templateVersion: input.templateVersion,
        variablesVersion: input.variablesVersion,
        expectedStateVersion: input.expectedStateVersion + 1,
      },
    };
    this.audit.push({ type: 'telegram.message-revised' });
    return this.preview;
  }

  async approveMessage(input: Parameters<TelegramUiClient['approveMessage']>[0]): Promise<TelegramApprovalResult> {
    if (!this.preview || this.preview.previewId !== input.previewId) {
      throw new Error('APPROVAL_INVALIDATED');
    }
    this.audit.push({ type: 'telegram.approved' });
    return {
      approvalId: 'tg-approval-3333333333333333',
      previewId: input.previewId,
      binding: input.binding,
    };
  }

  async enqueueLocal(): Promise<TelegramQueueResult> {
    this.audit.push({ type: 'telegram.queued', outcome: 'success' });
    return {
      outcome: 'success',
      value: { queueReceipt: 'fake-success' },
      replayed: false,
    };
  }

  async reconcile(outcome: 'success' | 'failure'): Promise<TelegramQueueResult> {
    this.snapshot = { ...this.snapshot, reconciliationRequired: false };
    this.audit.push({ type: 'telegram.reconciled', outcome });
    return {
      outcome,
      value: { queueReceipt: `fake-${outcome}` },
      replayed: false,
    };
  }

  async pause() {
    this.snapshot = { ...this.snapshot, paused: true };
    this.audit.push({ type: 'telegram.paused' });
    return this.readSnapshot();
  }

  async resume() {
    this.snapshot = { ...this.snapshot, paused: false };
    this.audit.push({ type: 'telegram.resumed' });
    return this.readSnapshot();
  }
}

