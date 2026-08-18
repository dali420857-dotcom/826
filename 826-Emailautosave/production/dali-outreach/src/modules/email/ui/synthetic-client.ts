import type {
  EmailAuditReadback,
  EmailDraftView,
  EmailImportPreview,
  EmailQueueReadback,
  EmailUiClient,
  SyntheticEmailOutcome,
} from './types';

const fixtureHash = '1'.repeat(64);

export function createSyntheticEmailUiClient(): EmailUiClient {
  let paused = false;
  let outcome: SyntheticEmailOutcome = 'success';
  let draft: EmailDraftView | undefined;
  let sequence = 0;
  let pendingKey: string | undefined;
  const audit: Array<EmailAuditReadback[number]> = [];
  const queue: Array<EmailQueueReadback[number]> = [];
  const record = (type: EmailAuditReadback[number]['type']) => {
    sequence += 1;
    audit.push({ sequence, occurredAt: '2026-08-17T12:00:00.000Z', type, operationId: `browser-fixture-operation-${sequence}`, correlationId: `browser-fixture-correlation-${sequence}` });
  };
  const binding = (version: number) => ({ schemaVersion: 1 as const, contentHash: fixtureHash, templateVersion: `email-ui-template-v${version}`, variablesVersion: `email-ui-variables-v${version}`, targetSetHash: fixtureHash, expectedStateVersion: version });
  const assertActive = () => { if (paused) throw new Error('EMAIL_UI_PAUSED'); };
  const assertNoPending = () => { if (pendingKey) throw new Error('RECONCILIATION_REQUIRED'); };

  return {
    getStatus: () => ({ paused, syntheticOutcome: outcome }),
    pause: () => ({ paused: (paused = true), syntheticOutcome: outcome }),
    resume: () => ({ paused: (paused = false), syntheticOutcome: outcome }),
    setSyntheticOutcome: (next) => ({ paused, syntheticOutcome: (outcome = next) }),
    previewImport: async (): Promise<EmailImportPreview> => {
      assertActive(); record('email.import.previewed');
      return { previewId: 'email-preview-browser-fixture', contacts: [
        { contactId: 'email-contact-browser-ada', maskedEmail: `a***@${'x'.repeat(280)}.example.test`, firstName: 'Ada', company: 'Alpha Synthetic' },
        { contactId: 'email-contact-browser-grace', maskedEmail: 'g***@beta.example.test', firstName: 'Grace', company: 'Beta Synthetic' },
      ] };
    },
    createDraft: async (input): Promise<EmailDraftView> => {
      assertActive();
      draft = { draftId: 'email-draft-browser-fixture', template: input.template, binding: binding(1), renderedPreview: { subject: 'Hello Ada', htmlBody: '&lt;strong&gt;Synthetic body&lt;/strong&gt; Ada — local-fixture' }, targetCount: input.targetContactIds.length, approvalStatus: 'pending' };
      record('email.draft.created'); return draft;
    },
    reviseDraft: async (input): Promise<EmailDraftView> => {
      assertActive(); assertNoPending();
      if (!draft) throw new Error('EMAIL_DRAFT_NOT_FOUND');
      const version = draft.binding.expectedStateVersion + 1;
      draft = { ...draft, template: input.template, binding: binding(version), renderedPreview: { ...draft.renderedPreview, subject: input.template.subject.replace('{{firstName}}', 'Ada') }, approvalStatus: 'stale' };
      record('email.draft.revised'); return draft;
    },
    approveDraft: async (): Promise<EmailDraftView> => {
      assertActive(); assertNoPending();
      if (!draft) throw new Error('EMAIL_DRAFT_NOT_FOUND');
      draft = { ...draft, approvalStatus: 'approved' }; record('email.draft.approved'); return draft;
    },
    enqueueLocal: async () => {
      assertActive(); assertNoPending();
      if (!draft || draft.approvalStatus !== 'approved') throw new Error('EMAIL_APPROVAL_REQUIRED');
      const targetIdempotencyKey = `browser-fixture-idempotency-${sequence + 1}`;
      const status = outcome === 'success' ? 'queued-local' : outcome === 'failure' ? 'fake-failed' : 'reconciliation-required';
      const item = { queueId: `email-queue-browser-${sequence + 1}`, draftId: draft.draftId, targetCount: draft.targetCount, binding: draft.binding, queuedAt: '2026-08-17T12:00:00.000Z', status } as const;
      queue.push(item); if (outcome === 'unknown') pendingKey = targetIdempotencyKey;
      record('email.queue.completed');
      return { targetIdempotencyKey, result: { outcome, value: item, replayed: false } };
    },
    reconcile: async (targetIdempotencyKey, nextOutcome) => {
      if (!draft || !pendingKey || targetIdempotencyKey !== pendingKey) throw new Error('RECONCILIATION_TARGET_NOT_FOUND');
      pendingKey = undefined;
      const nextBinding = binding(draft.binding.expectedStateVersion + 1);
      draft = { ...draft, binding: nextBinding, approvalStatus: 'stale' };
      const existing = queue.at(-1);
      if (!existing) throw new Error('EMAIL_QUEUE_ITEM_NOT_FOUND');
      const item = { ...existing, status: nextOutcome === 'success' ? 'queued-local' as const : 'fake-failed' as const };
      queue.splice(queue.length - 1, 1, item); record('email.queue.reconciled');
      return { outcome: nextOutcome, value: item, replayed: false };
    },
    readDraft: async () => draft,
    readAudit: async () => [...audit],
    readQueue: async () => [...queue],
  };
}
