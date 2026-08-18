import { describe, expect, it } from 'vitest';
import { createSyntheticEmailUiClient } from '../../../../src/modules/email/ui';

describe('createSyntheticEmailUiClient', () => {
  it('keeps unknown reconciliation local and preserves queue identity', async () => {
    const client = createSyntheticEmailUiClient();
    const preview = await client.previewImport({
      source: { kind: 'inline', name: 'ignored-safe-fixture.csv', content: 'synthetic-only' },
    });
    const draft = await client.createDraft({
      previewId: preview.previewId,
      targetContactIds: preview.contacts.map((contact) => contact.contactId),
      template: {
        subject: 'Hello {{firstName}}',
        htmlBody: 'Synthetic body',
        templateVersion: 'email-ui-template-v1',
        variablesVersion: 'email-ui-variables-v1',
      },
      variables: { campaign: 'local-fixture' },
    });
    await client.approveDraft({ draftId: draft.draftId, binding: draft.binding });
    client.setSyntheticOutcome('unknown');

    const pending = await client.enqueueLocal(draft.draftId);
    const before = pending.result.value;
    await expect(client.reviseDraft({
      draftId: draft.draftId,
      template: draft.template,
      variables: { campaign: 'local-fixture' },
    })).rejects.toThrow('RECONCILIATION_REQUIRED');

    const reconciled = await client.reconcile(pending.targetIdempotencyKey, 'success');
    expect(reconciled.value).toMatchObject({
      queueId: before.queueId,
      binding: before.binding,
      queuedAt: before.queuedAt,
      status: 'queued-local',
    });
    expect(await client.readQueue()).toHaveLength(1);
    expect(await client.readDraft(draft.draftId)).toMatchObject({
      approvalStatus: 'stale',
      binding: { expectedStateVersion: draft.binding.expectedStateVersion + 1 },
    });
  });
});
