import { describe, expect, it, vi } from 'vitest';
import {
  createTelegramBackend,
  type FakeTelegramAdapter,
  type TelegramApprovalBinding,
  type TelegramBackend,
} from '../../../src/modules/telegram';

const at = (iso: string) => new Date(iso);

function createHarness(options?: {
  sessionState?: 'ready' | 'degraded';
  freshUntil?: string;
  outcomes?: Array<'success' | 'failure' | 'unknown'>;
}) {
  const now = { value: at('2026-08-17T10:00:00.000Z') };
  const outcomes = [...(options?.outcomes ?? ['success'])];
  const adapter: FakeTelegramAdapter = {
    enqueue: vi.fn(async () => ({
      outcome: outcomes.shift() ?? 'success',
      queueReceipt: 'local-receipt-1',
    })),
  };
  const backend = createTelegramBackend({
    clock: { now: () => now.value },
    sessionEvidence: {
      source: 'synthetic-fixture',
      maskedAccount: 'tg-***-0042',
      state: options?.sessionState ?? 'ready',
      observedAt: '2026-08-17T09:59:00.000Z',
      freshUntil: options?.freshUntil ?? '2026-08-17T10:05:00.000Z',
      providerAccess: false,
    },
    fakeAdapter: adapter,
  });
  return { backend, adapter, now };
}

const validImport = {
  csvText: 'target_ref,display_name\nsynthetic:target-1,Alice_One',
} as const;

async function createMessage(backend: TelegramBackend) {
  const targetPreview = await backend.previewImport(validImport);
  return backend.createMessage({
    targetPreviewId: targetPreview.targetPreviewId,
    template: 'Hello {{name}} — https://example.test/a_(b)',
    variables: { name: 'Alice_One' },
    templateVersion: 'template-v1',
    variablesVersion: 'variables-v1',
    expectedStateVersion: 0,
  });
}

describe('Telegram synthetic import and message preview', () => {
  it('normalizes formula cells and escapes MarkdownV2, links, and variable content', async () => {
    const { backend, adapter } = createHarness();
    const targets = await backend.previewImport({
      csvText: 'target_ref,display_name\nsynthetic:target-1,=SUM(A1:A2)',
    });
    const preview = await backend.createMessage({
      targetPreviewId: targets.targetPreviewId,
      template: 'Hello {{name}} — https://example.test/a_(b)',
      variables: { name: 'Alice_One' },
      templateVersion: 'template-v1',
      variablesVersion: 'variables-v1',
      expectedStateVersion: 0,
    });

    expect(targets.targets).toEqual([
      { targetRef: 'synthetic:target-1', displayName: "'=SUM(A1:A2)" },
    ]);
    expect(preview.renderedMessage).toBe(
      'Hello Alice\\_One — https://example\\.test/a\\_\\(b\\)',
    );
    expect(preview.binding.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.binding.targetSetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(adapter.enqueue).not.toHaveBeenCalled();
    expect(backend.readAudit()).toEqual([
      expect.objectContaining({ type: 'telegram.targets-previewed', targetCount: 1 }),
      expect.objectContaining({ type: 'telegram.message-created' }),
    ]);
    expect(JSON.stringify(backend.readAudit())).not.toContain('Alice');
    expect(JSON.stringify(backend.readAudit())).not.toContain('example.test');
  });

  it.each([
    ['path traversal', 'target_ref,display_name\n../session,Alice'],
    ['drive path', 'target_ref,display_name\nC:\\session,Alice'],
    ['file URI', 'target_ref,display_name\nfile:///session,Alice'],
    ['control character', 'target_ref,display_name\nsynthetic:target-1,Alice\u0000'],
  ])('rejects %s before creating a preview', async (_name, csvText) => {
    const { backend } = createHarness();
    await expect(backend.previewImport({ csvText })).rejects.toThrow('TELEGRAM_IMPORT_INVALID');
    expect(backend.readAudit()).toEqual([]);
  });

  it('enforces the target cap before storing data', async () => {
    const rows = Array.from(
      { length: 501 },
      (_, index) => `synthetic:target-${index},Target ${index}`,
    );
    const { backend } = createHarness();
    await expect(
      backend.previewImport({ csvText: ['target_ref,display_name', ...rows].join('\n') }),
    ).rejects.toThrow('TELEGRAM_TARGET_LIMIT_EXCEEDED');
  });

  it('replays an identical content-addressed target preview without duplicate state or audit', async () => {
    const { backend } = createHarness();
    const first = await backend.previewImport(validImport);
    const duplicate = await backend.previewImport(validImport);
    expect(duplicate).toEqual(first);
    expect(backend.readSnapshot().targetPreviewCount).toBe(1);
    expect(
      backend.readAudit().filter(({ type }) => type === 'telegram.targets-previewed'),
    ).toHaveLength(1);
  });

  it('does not resolve inherited object properties as template variables', async () => {
    const { backend } = createHarness();
    const targets = await backend.previewImport(validImport);
    await expect(
      backend.createMessage({
        targetPreviewId: targets.targetPreviewId,
        template: 'Hello {{constructor}}',
        variables: {},
        templateVersion: 'template-v1',
        variablesVersion: 'variables-v1',
        expectedStateVersion: 0,
      }),
    ).rejects.toThrow('TELEGRAM_TEMPLATE_VARIABLE_MISSING');
  });
});

describe('Telegram approval and local queue', () => {
  it('requires approval and a revision invalidates the old approval', async () => {
    const { backend, adapter } = createHarness();
    const preview = await createMessage(backend);
    await expect(
      backend.enqueueLocal({
        previewId: preview.previewId,
        approvalId: 'tg-approval-0000000000000000',
        binding: preview.binding,
        operationId: 'operation-1',
        idempotencyKey: 'telegram-key-123456',
      }),
    ).rejects.toThrow('TELEGRAM_APPROVAL_REQUIRED');

    const approval = backend.approveMessage({ previewId: preview.previewId, binding: preview.binding });
    const revised = await backend.reviseMessage({
      previewId: preview.previewId,
      template: 'Changed {{name}}',
      variables: { name: 'Alice_One' },
      templateVersion: 'template-v2',
      variablesVersion: 'variables-v1',
      expectedStateVersion: 0,
    });
    await expect(
      backend.enqueueLocal({
        previewId: revised.previewId,
        approvalId: approval.approvalId,
        binding: revised.binding,
        operationId: 'operation-2',
        idempotencyKey: 'telegram-key-234567',
      }),
    ).rejects.toThrow('APPROVAL_INVALIDATED');
    expect(adapter.enqueue).not.toHaveBeenCalled();
  });

  it('rejects an enqueue binding changed after approval', async () => {
    const { backend, adapter } = createHarness();
    const preview = await createMessage(backend);
    const approval = backend.approveMessage({ previewId: preview.previewId, binding: preview.binding });
    const changed: TelegramApprovalBinding = {
      ...preview.binding,
      variablesVersion: 'variables-v2',
    };
    await expect(
      backend.enqueueLocal({
        previewId: preview.previewId,
        approvalId: approval.approvalId,
        binding: changed,
        operationId: 'operation-2',
        idempotencyKey: 'telegram-key-345678',
      }),
    ).rejects.toThrow('APPROVAL_INVALIDATED');
    expect(adapter.enqueue).not.toHaveBeenCalled();
  });

  it('does not resurrect an old approval after revising away and back', async () => {
    const { backend, adapter } = createHarness();
    const original = await createMessage(backend);
    const oldApproval = backend.approveMessage({
      previewId: original.previewId,
      binding: original.binding,
    });
    const revised = await backend.reviseMessage({
      previewId: original.previewId,
      template: 'Changed {{name}}', variables: { name: 'Alice_One' },
      templateVersion: 'template-v2', variablesVersion: 'variables-v1', expectedStateVersion: 0,
    });
    const reverted = await backend.reviseMessage({
      previewId: original.previewId,
      template: 'Hello {{name}} — https://example.test/a_(b)',
      variables: { name: 'Alice_One' }, templateVersion: 'template-v1',
      variablesVersion: 'variables-v1',
      expectedStateVersion: revised.binding.expectedStateVersion,
    });
    expect(reverted.binding).toMatchObject({
      contentHash: original.binding.contentHash,
      targetSetHash: original.binding.targetSetHash,
      expectedStateVersion: 2,
    });
    await expect(
      backend.enqueueLocal({
        previewId: reverted.previewId, approvalId: oldApproval.approvalId,
        binding: reverted.binding, operationId: 'operation-reverted',
        idempotencyKey: 'telegram-reverted-key-1',
      }),
    ).rejects.toThrow('APPROVAL_INVALIDATED');
    expect(adapter.enqueue).not.toHaveBeenCalled();
  });

  it('atomically advances per-message version and rejects stale or concurrent revisions', async () => {
    const { backend } = createHarness();
    const original = await createMessage(backend);
    const firstRevision = backend.reviseMessage({
      previewId: original.previewId, template: 'First revision', variables: {},
      templateVersion: 'template-v2', variablesVersion: 'variables-v1', expectedStateVersion: 0,
    });
    await expect(
      backend.reviseMessage({
        previewId: original.previewId, template: 'Concurrent revision', variables: {},
        templateVersion: 'template-v3', variablesVersion: 'variables-v1', expectedStateVersion: 0,
      }),
    ).rejects.toThrow('TELEGRAM_REVISION_IN_FLIGHT');
    const revised = await firstRevision;
    expect(revised.binding.expectedStateVersion).toBe(1);
    await expect(
      backend.reviseMessage({
        previewId: original.previewId, template: 'Stale revision', variables: {},
        templateVersion: 'template-v4', variablesVersion: 'variables-v1', expectedStateVersion: 0,
      }),
    ).rejects.toThrow('TELEGRAM_STATE_CONFLICT');
  });

  it('does not reset a revised lifecycle when create is repeated with original content', async () => {
    const { backend } = createHarness();
    const targets = await backend.previewImport(validImport);
    const createInput = {
      targetPreviewId: targets.targetPreviewId,
      template: 'Original', variables: {}, templateVersion: 'template-v1',
      variablesVersion: 'variables-v1', expectedStateVersion: 0,
    } as const;
    const original = await backend.createMessage(createInput);
    backend.approveMessage({ previewId: original.previewId, binding: original.binding });
    await backend.reviseMessage({
      previewId: original.previewId, template: 'Revised', variables: {},
      templateVersion: 'template-v2', variablesVersion: 'variables-v1', expectedStateVersion: 0,
    });
    await expect(backend.createMessage(createInput)).rejects.toThrow(
      'TELEGRAM_MESSAGE_ALREADY_EXISTS',
    );
  });

  it('keeps approvals distinct for previews with identical rendered content', async () => {
    const { backend, adapter } = createHarness();
    const firstTargets = await backend.previewImport(validImport);
    const secondTargets = await backend.previewImport({
      csvText: 'target_ref,display_name\nsynthetic:target-2,Alice_One',
    });
    const messageInput = {
      template: 'Same content', variables: {}, templateVersion: 'template-v1',
      variablesVersion: 'variables-v1', expectedStateVersion: 0,
    } as const;
    const first = await backend.createMessage({
      ...messageInput, targetPreviewId: firstTargets.targetPreviewId,
    });
    const second = await backend.createMessage({
      ...messageInput, targetPreviewId: secondTargets.targetPreviewId,
    });
    const firstApproval = backend.approveMessage({ previewId: first.previewId, binding: first.binding });
    const secondApproval = backend.approveMessage({ previewId: second.previewId, binding: second.binding });
    expect(firstApproval.approvalId).not.toBe(secondApproval.approvalId);
    await expect(
      backend.enqueueLocal({
        previewId: first.previewId, approvalId: firstApproval.approvalId, binding: first.binding,
        operationId: 'operation-first-preview', idempotencyKey: 'telegram-first-preview-1',
      }),
    ).resolves.toMatchObject({ outcome: 'success' });
    expect(adapter.enqueue).toHaveBeenCalledTimes(1);
  });

  it('enqueues approved content once and safely replays duplicates with zero network calls', async () => {
    const { backend, adapter } = createHarness();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const preview = await createMessage(backend);
    const approval = backend.approveMessage({ previewId: preview.previewId, binding: preview.binding });
    const request = {
      previewId: preview.previewId,
      approvalId: approval.approvalId,
      binding: preview.binding,
      operationId: 'operation-1',
      idempotencyKey: 'telegram-key-123456',
    } as const;

    await expect(backend.enqueueLocal(request)).resolves.toMatchObject({
      outcome: 'success', replayed: false, value: { queueReceipt: 'local-receipt-1' },
    });
    await expect(backend.enqueueLocal(request)).resolves.toMatchObject({
      outcome: 'success', replayed: true,
    });
    expect(adapter.enqueue).toHaveBeenCalledTimes(1);
    expect(adapter.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'fake-local', targetCount: 1 }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('returns a deterministic fake failure without leaking message content into audit', async () => {
    const { backend, adapter } = createHarness({ outcomes: ['failure'] });
    const preview = await createMessage(backend);
    const approval = backend.approveMessage({ previewId: preview.previewId, binding: preview.binding });
    await expect(
      backend.enqueueLocal({
        previewId: preview.previewId,
        approvalId: approval.approvalId,
        binding: preview.binding,
        operationId: 'operation-failure',
        idempotencyKey: 'telegram-key-failure-1',
      }),
    ).resolves.toMatchObject({ outcome: 'failure', replayed: false });
    expect(adapter.enqueue).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(backend.readAudit())).not.toContain('Alice');
    expect(JSON.stringify(backend.readAudit())).not.toContain('example.test');
  });

  it('rejects an idempotency conflict without a second adapter call', async () => {
    const { backend, adapter } = createHarness();
    const preview = await createMessage(backend);
    const approval = backend.approveMessage({ previewId: preview.previewId, binding: preview.binding });
    const request = {
      previewId: preview.previewId,
      approvalId: approval.approvalId,
      binding: preview.binding,
      operationId: 'operation-1',
      idempotencyKey: 'telegram-key-123456',
    } as const;
    await backend.enqueueLocal(request);
    await expect(
      backend.enqueueLocal({
        ...request,
        operationId: 'operation-2',
        approvalId: 'tg-approval-1111111111111111',
      }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    expect(adapter.enqueue).toHaveBeenCalledTimes(1);
  });

  it('reserves an approval while enqueue is in flight across different keys', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter: FakeTelegramAdapter = {
      enqueue: vi.fn(async () => {
        await held;
        return { outcome: 'success' as const, queueReceipt: 'held-local-receipt' };
      }),
    };
    const backend = createTelegramBackend({
      clock: { now: () => at('2026-08-17T10:00:00.000Z') },
      sessionEvidence: {
        source: 'synthetic-fixture',
        maskedAccount: 'tg-***-0042',
        state: 'ready',
        observedAt: '2026-08-17T09:59:00.000Z',
        freshUntil: '2026-08-17T10:05:00.000Z',
        providerAccess: false,
      },
      fakeAdapter: adapter,
    });
    const preview = await createMessage(backend);
    const approval = backend.approveMessage({ previewId: preview.previewId, binding: preview.binding });
    const first = backend.enqueueLocal({
      previewId: preview.previewId,
      approvalId: approval.approvalId,
      binding: preview.binding,
      operationId: 'operation-concurrent-1',
      idempotencyKey: 'telegram-concurrent-key-1',
    });
    await vi.waitFor(() => expect(adapter.enqueue).toHaveBeenCalledTimes(1));
    await expect(
      backend.enqueueLocal({
        previewId: preview.previewId,
        approvalId: approval.approvalId,
        binding: preview.binding,
        operationId: 'operation-concurrent-2',
        idempotencyKey: 'telegram-concurrent-key-2',
      }),
    ).rejects.toThrow('TELEGRAM_APPROVAL_IN_FLIGHT');
    release();
    await expect(first).resolves.toMatchObject({ outcome: 'success' });
    expect(adapter.enqueue).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed fake adapter output before committing queue state', async () => {
    const adapter: FakeTelegramAdapter = {
      enqueue: vi.fn(async () =>
        ({ outcome: 'not-real', queueReceipt: 'local' }) as unknown as Awaited<
          ReturnType<FakeTelegramAdapter['enqueue']>
        >,
      ),
    };
    const backend = createTelegramBackend({
      clock: { now: () => at('2026-08-17T10:00:00.000Z') },
      sessionEvidence: {
        source: 'synthetic-fixture', maskedAccount: 'tg-***-0042', state: 'ready',
        observedAt: '2026-08-17T09:59:00.000Z', freshUntil: '2026-08-17T10:05:00.000Z',
        providerAccess: false,
      },
      fakeAdapter: adapter,
    });
    const preview = await createMessage(backend);
    const approval = backend.approveMessage({ previewId: preview.previewId, binding: preview.binding });
    await expect(
      backend.enqueueLocal({
        previewId: preview.previewId, approvalId: approval.approvalId, binding: preview.binding,
        operationId: 'operation-invalid-adapter', idempotencyKey: 'telegram-invalid-adapter-1',
      }),
    ).rejects.toThrow('TELEGRAM_FAKE_ADAPTER_RESULT_INVALID');
    expect(backend.readSnapshot()).toMatchObject({ queueCount: 0, stateVersion: 0 });
    expect(backend.readAudit().some(({ type }) => type === 'telegram.queued')).toBe(false);
  });

  it('caps concurrent fake adapter work across distinct approvals', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const adapter: FakeTelegramAdapter = {
      enqueue: vi.fn(async () => {
        await held;
        return { outcome: 'success' as const, queueReceipt: 'held' };
      }),
    };
    const backend = createTelegramBackend({
      clock: { now: () => at('2026-08-17T10:00:00.000Z') },
      sessionEvidence: {
        source: 'synthetic-fixture', maskedAccount: 'tg-***-0042', state: 'ready',
        observedAt: '2026-08-17T09:59:00.000Z', freshUntil: '2026-08-17T10:05:00.000Z',
        providerAccess: false,
      },
      fakeAdapter: adapter,
    });
    const requests = [];
    for (let index = 0; index < 5; index += 1) {
      const targets = await backend.previewImport({
        csvText: `target_ref,display_name\nsynthetic:target-${index},Target ${index}`,
      });
      const preview = await backend.createMessage({
        targetPreviewId: targets.targetPreviewId, template: `Message ${index}`,
        variables: {}, templateVersion: `template-v${index}`, variablesVersion: 'variables-v1',
        expectedStateVersion: 0,
      });
      const approval = backend.approveMessage({ previewId: preview.previewId, binding: preview.binding });
      requests.push({
        previewId: preview.previewId, approvalId: approval.approvalId, binding: preview.binding,
        operationId: `operation-cap-${index}`, idempotencyKey: `telegram-cap-key-000${index}`,
      });
    }
    const active = requests.slice(0, 4).map((request) => backend.enqueueLocal(request));
    await vi.waitFor(() => expect(adapter.enqueue).toHaveBeenCalledTimes(4));
    await expect(backend.enqueueLocal(requests[4])).rejects.toThrow('TELEGRAM_CONCURRENCY_LIMIT');
    release();
    await expect(Promise.all(active)).resolves.toHaveLength(4);
    expect(adapter.enqueue).toHaveBeenCalledTimes(4);
  });

  it('requires reconciliation after unknown and replays the reconciled result', async () => {
    const { backend, adapter } = createHarness({ outcomes: ['unknown'] });
    const preview = await createMessage(backend);
    const approval = backend.approveMessage({ previewId: preview.previewId, binding: preview.binding });
    const request = {
      previewId: preview.previewId,
      approvalId: approval.approvalId,
      binding: preview.binding,
      operationId: 'operation-unknown',
      idempotencyKey: 'telegram-key-unknown-1',
    } as const;
    await expect(backend.enqueueLocal(request)).resolves.toMatchObject({ outcome: 'unknown' });
    await expect(backend.enqueueLocal(request)).rejects.toThrow('RECONCILIATION_REQUIRED');
    await expect(
      backend.enqueueLocal({
        ...request,
        operationId: 'operation-unknown-new-key',
        idempotencyKey: 'telegram-key-unknown-2',
      }),
    ).rejects.toThrow('RECONCILIATION_REQUIRED');
    backend.reconcileQueue({
      idempotencyKey: request.idempotencyKey,
      outcome: 'failure',
      queueReceipt: 'reconciled-local-receipt',
    });
    await expect(backend.enqueueLocal(request)).resolves.toMatchObject({
      outcome: 'failure', replayed: true, value: { queueReceipt: 'reconciled-local-receipt' },
    });
    await expect(
      backend.enqueueLocal({
        ...request,
        operationId: 'operation-after-reconcile',
        idempotencyKey: 'telegram-key-after-reconcile',
      }),
    ).rejects.toThrow('TELEGRAM_APPROVAL_REQUIRED');
    expect(adapter.enqueue).toHaveBeenCalledTimes(1);
  });

  it('turns abort plus late adapter resolve into unknown without committing queue state', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const adapter: FakeTelegramAdapter = {
      enqueue: vi.fn(async () => {
        await held;
        return { outcome: 'success' as const, queueReceipt: 'late-local-receipt' };
      }),
    };
    const backend = createTelegramBackend({
      clock: { now: () => at('2026-08-17T10:00:00.000Z') },
      sessionEvidence: {
        source: 'synthetic-fixture', maskedAccount: 'tg-***-0042', state: 'ready',
        observedAt: '2026-08-17T09:59:00.000Z', freshUntil: '2026-08-17T10:05:00.000Z',
        providerAccess: false,
      },
      fakeAdapter: adapter,
    });
    const preview = await createMessage(backend);
    const approval = backend.approveMessage({ previewId: preview.previewId, binding: preview.binding });
    const controller = new AbortController();
    const request = {
      previewId: preview.previewId, approvalId: approval.approvalId, binding: preview.binding,
      operationId: 'operation-aborted', idempotencyKey: 'telegram-aborted-key-1',
      correlationId: 'correlation-aborted', signal: controller.signal,
    };
    const pending = backend.enqueueLocal(request);
    await vi.waitFor(() => expect(adapter.enqueue).toHaveBeenCalledTimes(1));
    controller.abort();
    release();
    await expect(pending).resolves.toMatchObject({ outcome: 'unknown' });
    expect(backend.readSnapshot()).toMatchObject({ queueCount: 0, stateVersion: 0 });
    expect(backend.readAudit()).toContainEqual(
      expect.objectContaining({
        type: 'telegram.enqueue-unknown', correlationId: 'correlation-aborted',
        operationId: 'operation-aborted', outcome: 'unknown',
      }),
    );
    await expect(backend.enqueueLocal(request)).rejects.toThrow('RECONCILIATION_REQUIRED');
    backend.reconcileQueue({
      idempotencyKey: request.idempotencyKey, outcome: 'success',
      queueReceipt: 'confirmed-late-receipt', operationId: 'operation-reconcile-aborted',
      correlationId: 'correlation-reconcile-aborted',
    });
    await expect(backend.enqueueLocal(request)).resolves.toMatchObject({
      outcome: 'success', replayed: true,
    });
    await expect(
      backend.enqueueLocal({
        ...request,
        operationId: 'operation-aborted-new-key',
        idempotencyKey: 'telegram-aborted-new-key-1',
      }),
    ).rejects.toThrow('TELEGRAM_APPROVAL_REQUIRED');
  });

  it('keeps an abort-rejecting cooperative adapter reconcilable', async () => {
    const adapter: FakeTelegramAdapter = {
      enqueue: vi.fn(
        async ({ signal }) =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('cooperative abort')));
          }),
      ),
    };
    const backend = createTelegramBackend({
      clock: { now: () => at('2026-08-17T10:00:00.000Z') },
      sessionEvidence: {
        source: 'synthetic-fixture', maskedAccount: 'tg-***-0042', state: 'ready',
        observedAt: '2026-08-17T09:59:00.000Z', freshUntil: '2026-08-17T10:05:00.000Z',
        providerAccess: false,
      },
      fakeAdapter: adapter,
    });
    const preview = await createMessage(backend);
    const approval = backend.approveMessage({ previewId: preview.previewId, binding: preview.binding });
    const controller = new AbortController();
    const request = {
      previewId: preview.previewId, approvalId: approval.approvalId, binding: preview.binding,
      operationId: 'operation-cooperative-abort', idempotencyKey: 'telegram-coop-abort-key-1',
      correlationId: 'correlation-cooperative-abort', signal: controller.signal,
    };
    const pending = backend.enqueueLocal(request);
    await vi.waitFor(() => expect(adapter.enqueue).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).resolves.toMatchObject({ outcome: 'unknown' });
    expect(backend.readSnapshot()).toMatchObject({ queueCount: 0, stateVersion: 0 });
    backend.reconcileQueue({
      idempotencyKey: request.idempotencyKey, outcome: 'failure',
      queueReceipt: 'confirmed-not-queued', operationId: 'operation-coop-reconcile',
      correlationId: 'correlation-coop-reconcile',
    });
    await expect(backend.enqueueLocal(request)).resolves.toMatchObject({
      outcome: 'failure', replayed: true,
    });
  });
});

describe('Telegram masked session evidence', () => {
  it.each([
    ['degraded', '2026-08-17T10:05:00.000Z', 'TELEGRAM_SESSION_DEGRADED'],
    ['ready', '2026-08-17T09:59:59.000Z', 'TELEGRAM_SESSION_STALE'],
  ] as const)('fails closed for a %s session', async (state, freshUntil, error) => {
    const { backend, adapter } = createHarness({ sessionState: state, freshUntil });
    const preview = await createMessage(backend);
    const approval = backend.approveMessage({ previewId: preview.previewId, binding: preview.binding });
    await expect(
      backend.enqueueLocal({
        previewId: preview.previewId,
        approvalId: approval.approvalId,
        binding: preview.binding,
        operationId: 'operation-1',
        idempotencyKey: 'telegram-key-123456',
      }),
    ).rejects.toThrow(error);
    expect(adapter.enqueue).not.toHaveBeenCalled();
    expect(backend.readSnapshot()).toMatchObject({
      maskedAccount: 'tg-***-0042',
      sessionState: state === 'ready' ? 'stale' : 'degraded',
      providerAccess: false,
    });
  });

  it('rejects unmasked or provider-capable session evidence at construction', () => {
    const adapter: FakeTelegramAdapter = {
      enqueue: vi.fn(async () => ({ outcome: 'success' as const, queueReceipt: 'local' })),
    };
    expect(() =>
      createTelegramBackend({
        clock: { now: () => at('2026-08-17T10:00:00.000Z') },
        sessionEvidence: {
          source: 'synthetic-fixture',
          maskedAccount: '@real-account',
          state: 'ready',
          observedAt: '2026-08-17T09:59:00.000Z',
          freshUntil: '2026-08-17T10:05:00.000Z',
          providerAccess: false,
        },
        fakeAdapter: adapter,
      }),
    ).toThrow('TELEGRAM_SESSION_EVIDENCE_INVALID');
  });

  it('rejects future-dated or overlong synthetic session evidence', () => {
    const adapter: FakeTelegramAdapter = {
      enqueue: vi.fn(async () => ({ outcome: 'success' as const, queueReceipt: 'local' })),
    };
    expect(() =>
      createTelegramBackend({
        clock: { now: () => at('2026-08-17T10:00:00.000Z') },
        sessionEvidence: {
          source: 'synthetic-fixture',
          maskedAccount: 'tg-***-0042',
          state: 'ready',
          observedAt: '2026-08-17T10:01:00.000Z',
          freshUntil: '2026-08-17T10:05:00.000Z',
          providerAccess: false,
        },
        fakeAdapter: adapter,
      }),
    ).toThrow('TELEGRAM_SESSION_EVIDENCE_INVALID');
  });

  it('rejects masks that retain user-identifying account fragments', () => {
    const adapter: FakeTelegramAdapter = {
      enqueue: vi.fn(async () => ({ outcome: 'success' as const, queueReceipt: 'local' })),
    };
    expect(() =>
      createTelegramBackend({
        clock: { now: () => at('2026-08-17T10:00:00.000Z') },
        sessionEvidence: {
          source: 'synthetic-fixture', maskedAccount: 'realuser***phone123', state: 'ready',
          observedAt: '2026-08-17T09:59:00.000Z', freshUntil: '2026-08-17T10:05:00.000Z',
          providerAccess: false,
        },
        fakeAdapter: adapter,
      }),
    ).toThrow('TELEGRAM_SESSION_EVIDENCE_INVALID');
  });
});

describe('Telegram frozen module contract adapters', () => {
  it('exposes only the five registered Telegram operations and a masked snapshot', async () => {
    const { backend } = createHarness();
    expect(backend.registrations.map(({ operation }) => operation)).toEqual([
      'telegram.previewImport',
      'telegram.createMessage',
      'telegram.reviseMessage',
      'telegram.approveMessage',
      'telegram.enqueueLocal',
      'telegram.reconcile',
    ]);
    expect([...backend.operationModule.definitions]).toEqual(
      backend.registrations.map(({ operation }) => operation),
    );
    await expect(backend.snapshotModule.readSnapshot({ now: at('2026-08-17T10:00:00.000Z') }))
      .resolves.toMatchObject({ moduleId: 'telegram', maskedAccount: 'tg-***-0042', providerAccess: false });
  });

  it('uses strict payload schemas for every bridge registration', () => {
    const { backend } = createHarness();
    expect(
      backend.registrations[0].payloadSchema.safeParse({ ...validImport, unexpected: true }).success,
    ).toBe(false);
  });

  it('deduplicates create mutations by top-level bridge idempotency key', async () => {
    const { backend } = createHarness();
    const targets = await backend.previewImport(validImport);
    const registration = backend.registrations.find(
      ({ operation }) => operation === 'telegram.createMessage',
    );
    if (!registration || registration.operation !== 'telegram.createMessage') {
      throw new Error('missing registration');
    }
    const payload = {
      targetPreviewId: targets.targetPreviewId,
      template: 'Hello {{name}}',
      variables: { name: 'Alice' },
      templateVersion: 'template-v1',
      variablesVersion: 'variables-v1',
      expectedStateVersion: 0,
    };
    const context = {
      correlationId: 'correlation-1',
      operationId: 'operation-1',
      operation: 'telegram.createMessage' as const,
      role: 'operator' as const,
      idempotencyKey: 'telegram-create-key-1',
      signal: new AbortController().signal,
    };

    const first = await registration.handler(payload, context);
    const duplicate = await registration.handler(payload, {
      ...context,
      operationId: 'operation-2',
    });
    expect(duplicate).toEqual(first);
    expect(backend.readAudit().filter(({ type }) => type === 'telegram.message-created')).toHaveLength(1);
    expect(
      backend.readAudit().find(({ type }) => type === 'telegram.message-created'),
    ).toMatchObject({ correlationId: 'correlation-1', operationId: 'operation-1' });
    await expect(
      registration.handler({ ...payload, templateVersion: 'template-v2' }, context),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  it('requires and honors top-level idempotency for import state mutation', async () => {
    const { backend } = createHarness();
    const registration = backend.registrations.find(
      ({ operation }) => operation === 'telegram.previewImport',
    );
    if (!registration || registration.operation !== 'telegram.previewImport') {
      throw new Error('missing registration');
    }
    const context = {
      correlationId: 'correlation-import-1', operationId: 'operation-import-1',
      operation: 'telegram.previewImport' as const, role: 'operator' as const,
      signal: new AbortController().signal,
    };
    await expect(registration.handler(validImport, context)).rejects.toThrow(
      'TELEGRAM_IDEMPOTENCY_KEY_REQUIRED',
    );
    const first = await registration.handler(validImport, {
      ...context,
      idempotencyKey: 'telegram-import-key-1',
    });
    const duplicate = await registration.handler(validImport, {
      ...context,
      operationId: 'operation-import-2',
      idempotencyKey: 'telegram-import-key-1',
    });
    expect(duplicate).toEqual(first);
    await expect(
      registration.handler(
        { csvText: 'target_ref,display_name\nsynthetic:other,Other' },
        { ...context, idempotencyKey: 'telegram-import-key-1' },
      ),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
});
