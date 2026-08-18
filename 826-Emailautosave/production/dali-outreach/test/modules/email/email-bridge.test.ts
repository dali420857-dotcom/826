import { describe, expect, it } from 'vitest';
import { createBridgeDispatcher } from '../../../src/bridge';
import {
  createEmailBridgeRegistrations,
  createEmailOutreachModule,
} from '../../../src/modules/email';

describe('Email bridge registrations', () => {
  it('publishes a typed draft-to-local-queue tracer with role and idempotency gates', async () => {
    let plannedOutcome: 'success' | 'failure' | 'unknown' = 'success';
    let fakeCallCount = 0;
    const service = createEmailOutreachModule({
      clock: { now: () => new Date('2026-08-17T12:00:00.000Z') },
      fakeOutcome: () => {
        fakeCallCount += 1;
        return plannedOutcome;
      },
    });
    const registrations = createEmailBridgeRegistrations(service);
    expect(registrations.map(({ operation }) => operation)).toEqual([
      'email.previewImport',
      'email.createDraft',
      'email.reviseDraft',
      'email.approveDraft',
      'email.enqueueLocal',
      'email.reconcile',
    ]);

    const dispatcher = createBridgeDispatcher({
      expectedHost: '127.0.0.1:4317',
      allowedOrigins: ['http://127.0.0.1:5173'],
      processCapability: 'email-test-process-capability-0001',
      operations: registrations,
      installedOperations: new Set(registrations.map(({ operation }) => operation)),
      onSecurityEvent: () => undefined,
    });
    const connection = {
      remoteAddress: '127.0.0.1',
      host: '127.0.0.1:4317',
      origin: 'http://127.0.0.1:5173',
      processCapability: 'email-test-process-capability-0001',
    };
    let sequence = 0;
    const request = async (
      operation: (typeof registrations)[number]['operation'],
      payload: Record<string, unknown>,
      role: 'operator' | 'approver',
      idempotencyKey?: string,
    ) => {
      sequence += 1;
      return dispatcher.request(
        {
          schemaVersion: 1,
          correlationId: `email-correlation-${sequence}`,
          operationId: `email-operation-${sequence}`,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          operation,
          role,
          payload,
        },
        connection,
      );
    };

    const previewEnvelope = await request(
      'email.previewImport',
      {
        source: {
          kind: 'inline',
          name: 'bridge-contacts.csv',
          content: 'email,firstName,company\nada@bridge.example.test,Ada,Bridge',
        },
      },
      'operator',
      'email-preview-idempotency-0001',
    );
    expect(previewEnvelope.status).toBe('ok');
    if (previewEnvelope.status !== 'ok') throw new Error('preview failed');
    const preview = previewEnvelope.data as {
      previewId: string;
      contacts: readonly { contactId: string }[];
    };
    expect(
      await request(
        'email.previewImport',
        {
          source: {
            kind: 'inline',
            name: 'bridge-contacts.csv',
            content: 'email,firstName,company\nada@bridge.example.test,Ada,Bridge',
          },
        },
        'operator',
        'email-preview-idempotency-0001',
      ),
    ).toMatchObject({ status: 'ok', data: previewEnvelope.data });
    expect(
      await request(
        'email.previewImport',
        {
          source: {
            kind: 'inline',
            name: 'bridge-contacts.csv',
            content: 'email,firstName,company\ngrace@bridge.example.test,Grace,Bridge',
          },
        },
        'operator',
        'email-preview-idempotency-0001',
      ),
    ).toMatchObject({ status: 'error' });
    expect(service.readAudit().filter(({ type }) => type === 'email.import.previewed')).toHaveLength(1);

    const draftPayload = {
      previewId: preview.previewId,
      targetContactIds: [preview.contacts[0]!.contactId],
      template: {
        subject: 'Bridge {{firstName}}',
        htmlBody: 'Synthetic bridge body',
        templateVersion: 'bridge-template-v1',
        variablesVersion: 'bridge-variables-v1',
      },
      variables: {},
    };
    const draftEnvelope = await request(
      'email.createDraft',
      draftPayload,
      'operator',
      'email-create-idempotency-0001',
    );
    expect(draftEnvelope.status).toBe('ok');
    if (draftEnvelope.status !== 'ok') throw new Error(JSON.stringify(draftEnvelope));
    let draft = draftEnvelope.data as {
      draftId: string;
      binding: Record<string, unknown>;
      template: Record<string, unknown>;
    };
    const duplicateDraft = await request(
      'email.createDraft',
      draftPayload,
      'operator',
      'email-create-idempotency-0001',
    );
    expect(duplicateDraft).toMatchObject({ status: 'ok', data: draftEnvelope.data });
    const conflictingCreate = await request(
      'email.createDraft',
      { ...draftPayload, template: { ...draftPayload.template, subject: 'Conflict' } },
      'operator',
      'email-create-idempotency-0001',
    );
    expect(conflictingCreate).toMatchObject({ status: 'error' });
    expect(service.readAudit().filter(({ type }) => type === 'email.draft.created')).toHaveLength(1);

    const revisionPayload = {
      draftId: draft.draftId,
      template: {
        ...draftPayload.template,
        subject: 'Revised {{firstName}}',
        templateVersion: 'bridge-template-v2',
      },
      variables: {},
    };
    const revision = await request(
      'email.reviseDraft',
      revisionPayload,
      'operator',
      'email-revise-idempotency-0001',
    );
    expect(revision.status).toBe('ok');
    if (revision.status !== 'ok') throw new Error('revision failed');
    draft = revision.data as typeof draft;
    expect(
      await request(
        'email.reviseDraft',
        revisionPayload,
        'operator',
        'email-revise-idempotency-0001',
      ),
    ).toMatchObject({ status: 'ok', data: revision.data });
    expect(
      await request(
        'email.reviseDraft',
        {
          ...revisionPayload,
          template: { ...revisionPayload.template, subject: 'Revision conflict' },
        },
        'operator',
        'email-revise-idempotency-0001',
      ),
    ).toMatchObject({ status: 'error' });
    expect(service.readAudit().filter(({ type }) => type === 'email.draft.revised')).toHaveLength(1);
    expect(
      await request(
        'email.createDraft',
        draftPayload,
        'operator',
        'email-create-resurrection-0001',
      ),
    ).toMatchObject({ status: 'error' });
    expect(service.readDraft(draft.draftId)).toMatchObject({
      template: { subject: 'Revised {{firstName}}' },
      binding: { expectedStateVersion: 2 },
    });

    const wrongRole = await request(
      'email.approveDraft',
      { draftId: draft.draftId, binding: draft.binding },
      'operator',
      'email-wrong-role-idempotency-0001',
    );
    expect(wrongRole).toMatchObject({
      status: 'error',
      error: { code: 'OPERATION_NOT_ALLOWED' },
    });

    const approval = await request(
      'email.approveDraft',
      { draftId: draft.draftId, binding: draft.binding },
      'approver',
      'email-approve-idempotency-0001',
    );
    expect(approval).toMatchObject({ status: 'ok', data: { approved: true } });
    if (approval.status !== 'ok') throw new Error('approval failed');
    expect(
      await request(
        'email.approveDraft',
        { draftId: draft.draftId, binding: draft.binding },
        'approver',
        'email-approve-idempotency-0001',
      ),
    ).toMatchObject({ status: 'ok', data: approval.data });
    const changedBinding = {
      ...draft.binding,
      contentHash: `${draft.binding.contentHash === 'a'.repeat(64) ? 'b' : 'a'}${String(
        draft.binding.contentHash,
      ).slice(1)}`,
    };
    expect(
      await request(
        'email.approveDraft',
        { draftId: draft.draftId, binding: changedBinding },
        'approver',
        'email-approve-idempotency-0001',
      ),
    ).toMatchObject({ status: 'error' });
    expect(service.readAudit().filter(({ type }) => type === 'email.draft.approved')).toHaveLength(1);

    const queued = await request(
      'email.enqueueLocal',
      { draftId: draft.draftId },
      'operator',
      'email-bridge-idempotency-0001',
    );
    expect(queued).toMatchObject({
      status: 'ok',
      data: { outcome: 'success', value: { status: 'queued-local' } },
    });

    plannedOutcome = 'failure';
    expect(
      await request(
        'email.enqueueLocal',
        { draftId: draft.draftId },
        'operator',
        'email-bridge-failure-0001',
      ),
    ).toMatchObject({ status: 'ok', data: { outcome: 'failure' } });

    plannedOutcome = 'unknown';
    expect(
      await request(
        'email.enqueueLocal',
        { draftId: draft.draftId },
        'operator',
        'email-bridge-unknown-0001',
      ),
    ).toMatchObject({ status: 'ok', data: { outcome: 'unknown' } });
    const callsAtUnknown = fakeCallCount;
    plannedOutcome = 'success';
    expect(
      await request(
        'email.enqueueLocal',
        { draftId: draft.draftId },
        'operator',
        'email-bridge-bypass-0001',
      ),
    ).toMatchObject({ status: 'error' });
    expect(fakeCallCount).toBe(callsAtUnknown);
    const reconciled = await request(
      'email.reconcile',
      { targetIdempotencyKey: 'email-bridge-unknown-0001', outcome: 'success' },
      'operator',
      'email-reconcile-command-0001',
    );
    expect(reconciled).toMatchObject({
      status: 'ok',
      data: { outcome: 'success', value: { status: 'queued-local' } },
    });
    if (reconciled.status !== 'ok') throw new Error('reconciliation failed');
    expect(
      await request(
        'email.reconcile',
        { targetIdempotencyKey: 'email-bridge-unknown-0001', outcome: 'success' },
        'operator',
        'email-reconcile-command-0001',
      ),
    ).toMatchObject({ status: 'ok', data: reconciled.data });
    expect(
      await request(
        'email.reconcile',
        { targetIdempotencyKey: 'email-bridge-unknown-0001', outcome: 'failure' },
        'operator',
        'email-reconcile-command-0001',
      ),
    ).toMatchObject({ status: 'error' });
    expect(service.readAudit().filter(({ type }) => type === 'email.queue.reconciled')).toHaveLength(1);
    expect(
      await request(
        'email.enqueueLocal',
        { draftId: draft.draftId },
        'operator',
        'email-after-reconcile-0001',
      ),
    ).toMatchObject({ status: 'error' });
    expect(fakeCallCount).toBe(callsAtUnknown);
    expect(service.readAudit().every(({ operationId }) => Boolean(operationId))).toBe(true);
    expect(service.readAudit().every(({ correlationId }) => Boolean(correlationId))).toBe(true);
    expect(JSON.stringify(queued)).not.toContain('ada@bridge.example.test');
  });
});
