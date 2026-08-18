import { describe, expect, it, vi } from 'vitest';
import { createEmailOutreachModule } from '../../../src/modules/email';

const csv = [
  'email,firstName,company',
  'ada@alpha.example.test,Ada,Alpha',
  'grace@beta.example.test,"=HYPERLINK(""https://bad.example"")",Beta',
].join('\n');

function createModule(outcome: 'success' | 'failure' | 'unknown' = 'success') {
  return createEmailOutreachModule({
    clock: { now: () => new Date('2026-08-17T12:00:00.000Z') },
    fakeOutcome: () => outcome,
  });
}

function prepareApprovedDraft(module = createModule()) {
  const preview = module.previewImport({
    source: { kind: 'inline', name: 'synthetic-contacts.csv', content: csv },
  });
  const draft = module.createDraft({
    previewId: preview.previewId,
    targetContactIds: preview.contacts.map((contact) => contact.contactId),
    template: {
      subject: 'Hello {{firstName}}',
      htmlBody: '<img src=x onerror=alert(1)>Welcome {{firstName}} — {{campaign}}',
      templateVersion: 'template-v1',
      variablesVersion: 'variables-v1',
    },
    variables: { campaign: 'synthetic-only' },
  });
  module.approveDraft({ draftId: draft.draftId, binding: draft.binding });
  return { module, preview, draft };
}

describe('Email outreach backend', () => {
  it('previews only inline synthetic contacts and masks addresses', () => {
    const module = createModule();
    const preview = module.previewImport({
      source: { kind: 'inline', name: 'synthetic-contacts.csv', content: csv },
    });

    expect(preview.contacts).toHaveLength(2);
    expect(preview.contacts[0]).toMatchObject({ maskedEmail: 'a***@alpha.example.test' });
    expect(preview.contacts[1]?.firstName.startsWith("'=HYPERLINK")).toBe(true);
    expect(JSON.stringify(preview)).not.toContain('ada@alpha.example.test');
    expect(module.readAudit()[0]).toMatchObject({ type: 'email.import.previewed', count: 2 });
    expect(JSON.stringify(module.readAudit())).not.toContain('alpha.example.test');
  });

  it('rejects paths, non-synthetic contacts, oversized and malformed imports', () => {
    const module = createModule();

    expect(() =>
      module.previewImport({
        source: { kind: 'inline', name: '../contacts.csv', content: csv },
      }),
    ).toThrow('INVALID_EMAIL_IMPORT');
    expect(() =>
      module.previewImport({
        source: {
          kind: 'inline',
          name: 'overlong-email.csv',
          content: `email,firstName,company\n${'a'.repeat(65)}@long.example.test,Long,Rows`,
        },
      }),
    ).toThrow('NON_SYNTHETIC_CONTACT');
    expect(() =>
      module.previewImport({
        source: {
          kind: 'inline',
          name: 'contacts.csv',
          content: 'email,firstName,company\nreal@public-domain.net,Real,Public',
        },
      }),
    ).toThrow('NON_SYNTHETIC_CONTACT');
    expect(() =>
      module.previewImport({
        source: {
          kind: 'inline',
          name: 'contacts.csv',
          content: `email,firstName\n${'a'.repeat(1_000_001)}`,
        },
      }),
    ).toThrow('INVALID_EMAIL_IMPORT');
    expect(() =>
      module.previewImport({
        source: { kind: 'inline', name: 'contacts.csv', content: 'wrong,headers\na,b' },
      }),
    ).toThrow('INVALID_EMAIL_IMPORT_HEADERS');
    const tooManyRows = Array.from(
      { length: 2_001 },
      (_, index) => `contact${index}@rows.example.test,Contact ${index},Rows`,
    ).join('\n');
    expect(() =>
      module.previewImport({
        source: {
          kind: 'inline',
          name: 'too-many-contacts.csv',
          content: `email,firstName,company\n${tooManyRows}`,
        },
      }),
    ).toThrow('INVALID_EMAIL_IMPORT');
  });

  it('sanitizes HTML and binds approval to content, versions, targets, and state', () => {
    const { module, draft } = prepareApprovedDraft();

    expect(draft.renderedPreview.htmlBody).not.toContain('<img');
    expect(draft.renderedPreview.htmlBody).toContain('&lt;img');
    expect(draft.renderedPreview.htmlBody).toContain('synthetic-only');
    expect(draft.binding.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(draft.binding.targetSetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(draft.binding.schemaVersion).toBe(1);
    expect(module.readDraft(draft.draftId)?.approvalStatus).toBe('approved');
  });

  it('never enqueues an unapproved or changed draft', async () => {
    const module = createModule();
    const preview = module.previewImport({
      source: { kind: 'inline', name: 'contacts.csv', content: csv },
    });
    const draft = module.createDraft({
      previewId: preview.previewId,
      targetContactIds: [preview.contacts[0]!.contactId],
      template: {
        subject: 'Hello',
        htmlBody: 'Synthetic body',
        templateVersion: 'v1',
        variablesVersion: 'v1',
      },
      variables: {},
    });

    await expect(
      module.enqueueLocal({
        draftId: draft.draftId,
        operationId: 'op-unapproved',
        idempotencyKey: 'email-unapproved-0001',
      }),
    ).rejects.toThrow('APPROVAL_REQUIRED');

    module.approveDraft({ draftId: draft.draftId, binding: draft.binding });
    module.reviseDraft({
      draftId: draft.draftId,
      template: { ...draft.template, subject: 'Changed after approval' },
      variables: {},
    });
    await expect(
      module.enqueueLocal({
        draftId: draft.draftId,
        operationId: 'op-stale',
        idempotencyKey: 'email-stale-approval-0001',
      }),
    ).rejects.toThrow('APPROVAL_STALE');
  });

  it('keeps the approved draft unchanged when a revision is invalid', () => {
    const module = createModule();
    const longName = 'N'.repeat(200);
    const preview = module.previewImport({
      source: {
        kind: 'inline',
        name: 'atomic-contacts.csv',
        content: [
          'email,firstName,company',
          'short@atomic.example.test,Ada,Atomic',
          `long@atomic.example.test,${longName},Atomic`,
        ].join('\n'),
      },
    });
    const draft = module.createDraft({
      previewId: preview.previewId,
      targetContactIds: preview.contacts.map((contact) => contact.contactId),
      template: {
        subject: 'Hello {{firstName}}',
        htmlBody: 'Synthetic body',
        templateVersion: 'atomic-v1',
        variablesVersion: 'atomic-v1',
      },
      variables: {},
    });
    module.approveDraft({ draftId: draft.draftId, binding: draft.binding });
    const auditCount = module.readAudit().length;
    expect(() =>
      module.reviseDraft({
        draftId: draft.draftId,
        template: { ...draft.template, subject: `${'X'.repeat(310)} {{firstName}}` },
        variables: {},
      }),
    ).toThrow('EMAIL_RENDER_LIMIT_EXCEEDED');
    expect(module.readDraft(draft.draftId)).toMatchObject({
      approvalStatus: 'approved',
      template: { subject: draft.template.subject },
    });
    expect(module.readAudit()).toHaveLength(auditCount);
  });

  it('queues locally with duplicate replay and conflicts on a changed payload', async () => {
    const { module, preview, draft } = prepareApprovedDraft();
    const request = {
      draftId: draft.draftId,
      operationId: 'op-success',
      idempotencyKey: 'email-local-queue-0001',
    };

    const first = await module.enqueueLocal(request);
    const duplicate = await module.enqueueLocal({ ...request, operationId: 'op-success-retry' });
    expect(first).toMatchObject({ outcome: 'success', replayed: false });
    expect(duplicate).toMatchObject({ outcome: 'success', replayed: true });
    expect(module.readQueue()).toHaveLength(1);
    expect(module.readQueue()[0]).toMatchObject({ status: 'queued-local' });

    const conflictingDraft = module.createDraft({
      previewId: preview.previewId,
      targetContactIds: preview.contacts.map((contact) => contact.contactId),
      template: { ...draft.template, subject: 'Different semantic payload' },
      variables: { campaign: 'synthetic-only' },
    });
    module.approveDraft({
      draftId: conflictingDraft.draftId,
      binding: conflictingDraft.binding,
    });
    await expect(
      module.enqueueLocal({ ...request, draftId: conflictingDraft.draftId }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  it.each(['failure', 'unknown'] as const)(
    'handles fake %s without provider or network calls',
    async (outcome) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const { module, draft } = prepareApprovedDraft(createModule(outcome));

      const result = await module.enqueueLocal({
        draftId: draft.draftId,
        operationId: `op-${outcome}`,
        idempotencyKey: `email-${outcome}-0000001`,
      });
      expect(result.outcome).toBe(outcome);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(module.readQueue()[0]?.status).toBe(
        outcome === 'unknown' ? 'reconciliation-required' : 'fake-failed',
      );

      if (outcome === 'unknown') {
        await expect(
          module.enqueueLocal({
            draftId: draft.draftId,
            operationId: `op-${outcome}`,
            idempotencyKey: `email-${outcome}-0000001`,
          }),
        ).rejects.toThrow('RECONCILIATION_REQUIRED');
        expect(
          module.reconcile({
            targetIdempotencyKey: `email-${outcome}-0000001`,
            operationId: `reconcile-${outcome}`,
            outcome: 'success',
          }),
        ).toMatchObject({ outcome: 'success' });
        expect(module.readQueue()[0]?.status).toBe('queued-local');
      }
      fetchSpy.mockRestore();
    },
  );

  it('keeps audit output metadata-only and rejects undeclared fields', () => {
    const { module } = prepareApprovedDraft();
    expect(() =>
      module.previewImport({
        source: { kind: 'inline', name: 'contacts.csv', content: csv },
        providerToken: 'must-not-be-accepted',
      }),
    ).toThrow('INVALID_EMAIL_IMPORT');

    const audit = JSON.stringify(module.readAudit());
    expect(audit).not.toContain('Welcome');
    expect(audit).not.toContain('@');
    expect(audit).not.toContain('synthetic-only');
  });

  it('rejects control characters in public operation and idempotency identifiers', async () => {
    const { module, draft } = prepareApprovedDraft();
    await expect(
      module.enqueueLocal({
        draftId: draft.draftId,
        operationId: 'unsafe\noperation',
        idempotencyKey: 'email-safe-key-0000001',
      }),
    ).rejects.toThrow('INVALID_EMAIL_ENQUEUE');
    expect(() =>
      module.reconcile({
        targetIdempotencyKey: 'unsafe\ntarget-key-0001',
        operationId: 'safe-reconcile-operation',
        outcome: 'success',
      }),
    ).toThrow('INVALID_EMAIL_RECONCILIATION');
  });

  it.each(['success', 'failure'] as const)(
    'blocks revise and approve while unknown is pending before %s reconciliation',
    async (reconciledOutcome) => {
      const { module, draft } = prepareApprovedDraft(createModule('unknown'));
      const targetIdempotencyKey = `email-pending-${reconciledOutcome}-0001`;
      await expect(
        module.enqueueLocal({
          draftId: draft.draftId,
          operationId: `pending-${reconciledOutcome}`,
          idempotencyKey: targetIdempotencyKey,
        }),
      ).resolves.toMatchObject({ outcome: 'unknown' });
      const auditCount = module.readAudit().length;

      expect(() =>
        module.reviseDraft({
          draftId: draft.draftId,
          template: { ...draft.template, subject: 'Must stay frozen' },
          variables: { campaign: 'synthetic-only' },
        }),
      ).toThrow('RECONCILIATION_REQUIRED');
      expect(() =>
        module.approveDraft({ draftId: draft.draftId, binding: draft.binding }),
      ).toThrow('RECONCILIATION_REQUIRED');
      expect(module.readAudit()).toHaveLength(auditCount);

      expect(
        module.reconcile({
          targetIdempotencyKey,
          operationId: `resolve-${reconciledOutcome}`,
          outcome: reconciledOutcome,
        }),
      ).toMatchObject({ outcome: reconciledOutcome });
      const revised = module.reviseDraft({
        draftId: draft.draftId,
        template: { ...draft.template, subject: 'Allowed after reconciliation' },
        variables: { campaign: 'synthetic-only' },
      });
      expect(revised.binding.expectedStateVersion).toBe(3);
      expect(() =>
        module.approveDraft({ draftId: draft.draftId, binding: draft.binding }),
      ).toThrow('APPROVAL_BINDING_MISMATCH');
    },
  );
});
