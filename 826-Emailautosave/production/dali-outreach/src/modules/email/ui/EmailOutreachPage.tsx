import { useEffect, useRef, useState } from 'react';
import '../../../styles/dali-outreach.css';
import './email-ui.css';
import { AuditPanel, ContactPreview, DraftStatus, OutcomeControl } from './EmailWorkflowPanels';
import type {
  EmailAuditReadback,
  EmailDraftView,
  EmailImportPreview,
  EmailUiClient,
  SyntheticEmailOutcome,
} from './types';

const syntheticCsv = [
  'email,firstName,company',
  'ada@alpha.example.test,Ada,Alpha Synthetic',
  'grace@beta.example.test,Grace,Beta Synthetic',
].join('\n');

const CLIENT_BOUNDARY_TIMEOUT_MS = 300;

class ClientTimeoutError extends Error {
  constructor() {
    super('UI_CLIENT_TIMEOUT');
  }
}

interface EmailRouteGuard {
  readonly consumedQueueIntents: Set<string>;
  initialReadbackFailed: boolean;
  readonly pendingOperations: Set<Promise<unknown>>;
  pendingReconciliationKey?: string;
  recoveryRequired: boolean;
}

const emailRouteGuards = new WeakMap<EmailUiClient, EmailRouteGuard>();

function getEmailRouteGuard(client: EmailUiClient): EmailRouteGuard {
  let guard = emailRouteGuards.get(client);
  if (!guard) {
    guard = {
      consumedQueueIntents: new Set(),
      initialReadbackFailed: false,
      pendingOperations: new Set(),
      recoveryRequired: false,
    };
    emailRouteGuards.set(client, guard);
  }
  return guard;
}

const emailClientViewIds = new WeakMap<EmailUiClient, number>();
let nextEmailClientViewId = 1;

function getEmailClientViewId(client: EmailUiClient): number {
  let id = emailClientViewIds.get(client);
  if (id === undefined) {
    id = nextEmailClientViewId;
    nextEmailClientViewId += 1;
    emailClientViewIds.set(client, id);
  }
  return id;
}

function queueIntentKey(draft: EmailDraftView): string {
  const { binding } = draft;
  return [
    draft.draftId,
    binding.schemaVersion,
    binding.contentHash,
    binding.templateVersion,
    binding.variablesVersion,
    binding.targetSetHash,
    binding.expectedStateVersion,
  ].join(':');
}

function callClient<T>(operation: () => T | PromiseLike<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new ClientTimeoutError()),
      CLIENT_BOUNDARY_TIMEOUT_MS,
    );
  });

  return Promise.race([
    Promise.resolve().then(operation),
    timeout,
  ]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

function EmailOutreachPageInstance({ client }: { readonly client: EmailUiClient }) {
  const routeGuard = getEmailRouteGuard(client);
  if (routeGuard.pendingOperations.size > 0 || routeGuard.pendingReconciliationKey) {
    routeGuard.recoveryRequired = true;
  }
  const [preview, setPreview] = useState<EmailImportPreview>();
  const [draft, setDraft] = useState<EmailDraftView>();
  const [subject, setSubject] = useState('Hello {{firstName}}');
  const [body, setBody] = useState('<strong>Synthetic body</strong> {{firstName}} — {{campaign}}');
  const [campaign, setCampaign] = useState('local-fixture');
  const [revision, setRevision] = useState(1);
  const [editorDirty, setEditorDirty] = useState(false);
  const [outcome, setOutcome] = useState<SyntheticEmailOutcome>('success');
  const [queueMessage, setQueueMessage] = useState('尚未加入本機佇列');
  const [queueCount, setQueueCount] = useState(0);
  const [pendingKey, setPendingKey] = useState<string | undefined>(routeGuard.pendingReconciliationKey);
  const [recoveryRequired, setRecoveryRequired] = useState(routeGuard.recoveryRequired);
  const [audit, setAudit] = useState<EmailAuditReadback>([]);
  const [paused, setPaused] = useState(true);
  const [statusState, setStatusState] = useState<'loading' | 'available' | 'unavailable'>('loading');
  const [busy, setBusy] = useState(true);
  const runInFlightRef = useRef(false);
  const [error, setError] = useState<string | undefined>(routeGuard.recoveryRequired
    ? '本機操作結果未知；流程保持鎖定並等待對帳。'
    : undefined);

  const setRecoveryLock = (required: boolean) => {
    routeGuard.recoveryRequired = required;
    setRecoveryRequired(required);
  };
  const setPendingReconciliationKey = (key: string | undefined) => {
    routeGuard.pendingReconciliationKey = key;
    setPendingKey(key);
  };
  const callMutation = <T,>(operation: () => T | PromiseLike<T>): Promise<T> => {
    const pending = Promise.resolve().then(operation);
    routeGuard.pendingOperations.add(pending);
    setRecoveryLock(true);
    void pending.then(
      () => { routeGuard.pendingOperations.delete(pending); },
      () => { routeGuard.pendingOperations.delete(pending); },
    );
    return callClient(() => pending);
  };

  useEffect(() => {
    let active = true;
    setBusy(true);
    setStatusState('loading');
    setRecoveryRequired(routeGuard.recoveryRequired);
    setError(routeGuard.recoveryRequired
      ? '本機操作結果未知；流程保持鎖定並等待對帳。'
      : undefined);
    void Promise.all([
      callClient(() => client.getStatus()),
      callClient(() => client.readAudit()),
      callClient(() => client.readQueue()),
    ]).then(
      ([status, initialAudit, initialQueue]) => {
        if (!active) return;
        const canRecoverInitialFailure = routeGuard.initialReadbackFailed
          && routeGuard.pendingOperations.size === 0
          && !routeGuard.pendingReconciliationKey
          && !initialQueue.some((item) => item.status === 'reconciliation-required');
        routeGuard.initialReadbackFailed = false;
        if (canRecoverInitialFailure) setRecoveryLock(false);
        if (initialQueue.some((item) => item.status === 'reconciliation-required')) {
          setRecoveryLock(true);
          setError('本機佇列仍有未知結果；流程保持鎖定並等待對帳。');
        }
        setAudit(initialAudit);
        setQueueCount(initialQueue.length);
        setPaused(status.paused);
        setStatusState('available');
        if (!routeGuard.recoveryRequired) setError(undefined);
        setBusy(false);
      },
      () => {
        if (!active) return;
        routeGuard.initialReadbackFailed = true;
        setRecoveryLock(true);
        setPaused(true);
        setStatusState('unavailable');
        setError('本機狀態不可用；流程已鎖定。');
        setBusy(false);
      },
    );
    return () => { active = false; };
  }, [client, routeGuard]);

  const refresh = async (draftId?: string) => {
    setAudit(await callClient(() => client.readAudit()));
    if (draftId) setDraft(await callClient(() => client.readDraft(draftId)));
  };
  const run = async (task: () => Promise<void>) => {
    if (runInFlightRef.current) return;
    runInFlightRef.current = true;
    setBusy(true); setError(undefined);
    try {
      await task();
      if (routeGuard.pendingOperations.size === 0 && !routeGuard.pendingReconciliationKey) {
        setRecoveryLock(false);
      }
    } catch (caught) {
      setRecoveryLock(true);
      setError(caught instanceof Error && caught.message === 'EMAIL_QUEUE_READBACK_MISMATCH'
        ? '本機讀回不一致；流程已鎖定，請停止並檢查。'
        : caught instanceof Error && caught.message === 'EMAIL_STATUS_UNAVAILABLE'
          ? '本機狀態不可用；流程已鎖定。'
          : caught instanceof ClientTimeoutError
            ? '本機操作逾時；結果未知，流程已鎖定並等待對帳。'
          : '本機操作未完成；請檢查目前狀態後再試。');
    }
    finally {
      runInFlightRef.current = false;
      setBusy(false);
    }
  };
  const template = (version: number) => ({
    subject,
    htmlBody: body,
    templateVersion: `email-ui-template-v${version}`,
    variablesVersion: `email-ui-variables-v${version}`,
  });
  const mutationLocked = Boolean(pendingKey) || recoveryRequired || statusState !== 'available';
  const currentQueueIntentKey = draft ? queueIntentKey(draft) : undefined;
  const queueIntentConsumed = currentQueueIntentKey
    ? routeGuard.consumedQueueIntents.has(currentQueueIntentKey)
    : false;
  const changePauseState = async () => {
    const action = paused ? 'resume' : 'pause';
    await run(async () => {
      try {
        await callMutation(() => client[action]());
        const status = await callClient(() => client.getStatus());
        const expectedPaused = action === 'pause';
        if (status.paused !== expectedPaused) throw new Error('EMAIL_STATUS_MISMATCH');
        setPaused(status.paused);
        setStatusState('available');
      } catch {
        setPaused(true);
        setStatusState('unavailable');
        throw new Error('EMAIL_STATUS_UNAVAILABLE');
      }
    });
  };
  const assertQueueReadback = async (queueId: string, expectedStatus: 'queued-local' | 'fake-failed' | 'reconciliation-required') => {
    const items = await callClient(() => client.readQueue());
    setQueueCount(items.length);
    const item = items.find((candidate) => candidate.queueId === queueId);
    if (!item || item.status !== expectedStatus) {
      setRecoveryLock(true);
      throw new Error('EMAIL_QUEUE_READBACK_MISMATCH');
    }
    setRecoveryLock(expectedStatus === 'reconciliation-required');
    setQueueMessage(item.status === 'queued-local' ? '成功 · queued-local' : item.status === 'fake-failed' ? '失敗 · fake-failed' : '未知 · 需要對帳');
  };

  return (
    <section aria-labelledby="email-workflow-title" className="email-workflow">
      <header className="email-workflow__header">
        <div><p className="eyebrow">EMAIL · SYNTHETIC CONTROL</p><h2 id="email-workflow-title">Email 外聯流程</h2><p>導入、草稿、批准與本機佇列均為 deterministic fixture。</p></div>
        <div className="email-safety"><strong>Monitoring only · synthetic · no-send</strong><span>{statusState === 'unavailable' ? '本機狀態不可用' : statusState === 'loading' ? '正在讀取本機狀態' : paused ? '本機流程已暫停' : '本機流程可操作'}</span></div>
      </header>

      <div aria-live="polite" className="email-notice">{busy ? '處理中…' : error ?? queueMessage}</div>

      <div aria-busy={busy} data-testid="email-workflow-controls">
        <div className="email-actions email-actions--top">
        <button disabled={busy || paused || mutationLocked} onClick={() => void run(async () => {
          const next = await callMutation(() => client.previewImport({ source: { kind: 'inline', name: 'email-ui-fixture.csv', content: syntheticCsv } }));
          setPreview(next); await refresh();
        })} type="button">載入合成聯絡人</button>
        <button disabled={busy || mutationLocked || statusState !== 'available'} onClick={() => void changePauseState()} type="button">{statusState === 'unavailable' ? '狀態不可用' : paused ? '恢復本機流程' : '暫停本機流程'}</button>
        <button disabled type="button">連接郵箱帳號（未啟用）</button>
        <button disabled type="button">正式發送（未啟用）</button>
        </div>

        <div className="email-workflow__grid">
        <ContactPreview preview={preview} />
        <section aria-labelledby="email-draft-title" className="email-panel email-panel--wide">
          <div className="email-panel__heading"><div><span>02</span><h3 id="email-draft-title">範本與批准</h3></div><DraftStatus draft={draft} editorDirty={editorDirty} /></div>
          <div className="email-form-grid">
            <label className="email-field"><span>郵件主旨</span><input disabled={busy || paused || mutationLocked} onChange={(event) => { setSubject(event.target.value); if (draft) setEditorDirty(true); }} value={subject} /></label>
            <label className="email-field"><span>活動變數 campaign</span><input disabled={busy || paused || mutationLocked} onChange={(event) => { setCampaign(event.target.value); if (draft) setEditorDirty(true); }} value={campaign} /></label>
            <label className="email-field email-field--full"><span>郵件內容（會安全編碼）</span><textarea disabled={busy || paused || mutationLocked} onChange={(event) => { setBody(event.target.value); if (draft) setEditorDirty(true); }} rows={4} value={body} /></label>
          </div>
          {draft ? <output className="email-rendered-preview" data-testid="sanitized-preview">{draft.renderedPreview.htmlBody}</output> : null}
          <div className="email-actions">
            <button disabled={busy || paused || !preview || Boolean(draft) || mutationLocked} onClick={() => void run(async () => {
              if (!preview) return;
              const next = await callMutation(() => client.createDraft({ previewId: preview.previewId, targetContactIds: preview.contacts.map((contact) => contact.contactId), template: template(1), variables: { campaign } }));
              setDraft(next); setEditorDirty(false); await refresh();
            })} type="button">建立本機草稿</button>
            <button disabled={busy || paused || !draft || mutationLocked} onClick={() => void run(async () => {
              if (!draft) return;
              const nextVersion = revision + 1;
              const next = await callMutation(() => client.reviseDraft({ draftId: draft.draftId, template: template(nextVersion), variables: { campaign } }));
              setRevision(nextVersion); setDraft(next); setEditorDirty(false); await refresh();
            })} type="button">更新本機草稿</button>
            <button disabled={busy || paused || !draft || editorDirty || draft.approvalStatus === 'approved' || mutationLocked} onClick={() => void run(async () => {
              if (!draft) return;
              const next = await callMutation(() => client.approveDraft({ draftId: draft.draftId, binding: draft.binding }));
              setDraft(next); await refresh();
            })} type="button">批准目前版本</button>
          </div>
        </section>

        <section aria-labelledby="email-queue-title" className="email-panel">
          <div className="email-panel__heading"><div><span>03</span><h3 id="email-queue-title">本機佇列與復原</h3></div><strong>no-send</strong></div>
          <OutcomeControl disabled={busy || paused || mutationLocked} onChange={setOutcome} value={outcome} />
          <div className="email-queue-readback"><span>最新 readback · {queueCount} local records</span><strong>{queueMessage}</strong></div>
          <div className="email-actions">
            <button disabled={busy || paused || editorDirty || draft?.approvalStatus !== 'approved' || mutationLocked || queueIntentConsumed} onClick={() => {
              if (!draft) return;
              const intentKey = queueIntentKey(draft);
              if (routeGuard.consumedQueueIntents.has(intentKey)) {
                setQueueMessage('目前批准版本已處理 · replay-blocked');
                return;
              }
              routeGuard.consumedQueueIntents.add(intentKey);
              void run(async () => {
                await callMutation(() => client.setSyntheticOutcome(outcome));
                const next = await callMutation(() => client.enqueueLocal(draft.draftId));
                if (next.result.outcome === 'unknown') setPendingReconciliationKey(next.targetIdempotencyKey);
                await assertQueueReadback(next.result.value.queueId, next.result.value.status);
                await refresh(draft.draftId);
              });
            }} type="button">加入本機佇列</button>
            <button disabled={busy || !pendingKey} onClick={() => void run(async () => {
              if (!pendingKey) return;
              const reconciled = await callMutation(() => client.reconcile(pendingKey, 'success')); await assertQueueReadback(reconciled.value.queueId, 'queued-local'); setPendingReconciliationKey(undefined); setRecoveryLock(false); setQueueMessage('已對帳 · queued-local'); await refresh(draft?.draftId);
            })} type="button">對帳為成功</button>
            <button disabled={busy || !pendingKey} onClick={() => void run(async () => {
              if (!pendingKey) return;
              const reconciled = await callMutation(() => client.reconcile(pendingKey, 'failure')); await assertQueueReadback(reconciled.value.queueId, 'fake-failed'); setPendingReconciliationKey(undefined); setRecoveryLock(false); setQueueMessage('已對帳 · fake-failed'); await refresh(draft?.draftId);
            })} type="button">對帳為失敗</button>
          </div>
        </section>
        <AuditPanel audit={audit} />
        </div>
      </div>
    </section>
  );
}

export function EmailOutreachPage({ client }: { readonly client: EmailUiClient }) {
  return <EmailOutreachPageInstance client={client} key={getEmailClientViewId(client)} />;
}
