import type { createEmailOutreachModule } from '../email-outreach';
import type {
  EmailUiClient,
  EmailUiStatus,
  SyntheticEmailOutcome,
} from './types';

type EmailService = ReturnType<typeof createEmailOutreachModule>;

export function createLocalEmailUiClient(
  service: EmailService,
  options: { readonly setSyntheticOutcome: (outcome: SyntheticEmailOutcome) => void },
): EmailUiClient {
  let paused = false;
  let syntheticOutcome: SyntheticEmailOutcome = 'success';
  let sequence = 0;

  const status = (): EmailUiStatus => ({ paused, syntheticOutcome });
  const nextIds = (prefix: string) => {
    sequence += 1;
    const suffix = String(sequence).padStart(4, '0');
    return {
      operationId: `email-ui-${prefix}-operation-${suffix}`,
      correlationId: `email-ui-${prefix}-correlation-${suffix}`,
      idempotencyKey: `email-ui-${prefix}-idempotency-${suffix}`,
    };
  };
  const assertActive = () => {
    if (paused) throw new Error('EMAIL_UI_PAUSED');
  };
  const metadata = (ids: ReturnType<typeof nextIds>) => ({
    operationId: ids.operationId,
    correlationId: ids.correlationId,
  });

  return {
    getStatus: status,
    pause: () => {
      paused = true;
      return status();
    },
    resume: () => {
      paused = false;
      return status();
    },
    setSyntheticOutcome: (outcome) => {
      syntheticOutcome = outcome;
      options.setSyntheticOutcome(outcome);
      return status();
    },
    previewImport: async (input) => {
      assertActive();
      const ids = nextIds('preview');
      return service.previewImport(input, metadata(ids));
    },
    createDraft: async (input) => {
      assertActive();
      const ids = nextIds('create');
      return service.createDraft(input, metadata(ids));
    },
    reviseDraft: async (input) => {
      assertActive();
      const ids = nextIds('revise');
      return service.reviseDraft(input, metadata(ids));
    },
    approveDraft: async (input) => {
      assertActive();
      const ids = nextIds('approve');
      service.approveDraft(input, metadata(ids));
      const draft = service.readDraft(input.draftId);
      if (!draft) throw new Error('EMAIL_DRAFT_NOT_FOUND');
      return draft;
    },
    enqueueLocal: async (draftId) => {
      assertActive();
      const ids = nextIds('enqueue');
      const result = await service.enqueueLocal(
        {
          draftId,
          operationId: ids.operationId,
          idempotencyKey: ids.idempotencyKey,
        },
        { correlationId: ids.correlationId },
      );
      return { targetIdempotencyKey: ids.idempotencyKey, result };
    },
    reconcile: async (targetIdempotencyKey, outcome) => {
      const ids = nextIds('reconcile');
      return service.reconcile(
        { targetIdempotencyKey, operationId: ids.operationId, outcome },
        { correlationId: ids.correlationId },
      );
    },
    readDraft: async (draftId) => service.readDraft(draftId),
    readAudit: async () => service.readAudit(),
    readQueue: async () => service.readQueue(),
  };
}
