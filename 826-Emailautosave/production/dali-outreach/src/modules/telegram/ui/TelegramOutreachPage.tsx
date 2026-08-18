import { useEffect, useRef, useState } from 'react';
import {
  telegramApprovalResultSchema,
  telegramPreviewResultSchema,
  telegramQueueResultSchema,
  telegramTargetPreviewResultSchema,
  type TelegramApprovalResult,
  type TelegramPreviewResult,
  type TelegramTargetPreviewResult,
} from '..';
import type {
  TelegramUiAuditEvent,
  TelegramUiClient,
  TelegramUiSnapshot,
} from './client';
import './telegram-outreach.css';

export interface TelegramOutreachPageProps {
  readonly client: TelegramUiClient;
}

const initialCsv = 'target_ref,display_name\nsynthetic:prospect_1,合成聯絡人';
const safeErrorMessages = new Map([
  ['APPROVAL_INVALIDATED', '內容批准已失效，請重新預覽與批准。'],
  ['RECONCILIATION_REQUIRED', '結果仍待對帳，禁止重送。'],
  ['TELEGRAM_SESSION_STALE', 'Telegram 工作階段證據已過期。'],
  ['TELEGRAM_SESSION_DEGRADED', 'Telegram 工作階段目前降級。'],
  ['TELEGRAM_UI_READBACK_FAILED', 'Telegram 本機讀回失敗；已封鎖後續操作。'],
]);
const safeAuditTypes = new Set<TelegramUiAuditEvent['type']>([
  'telegram.targets-previewed',
  'telegram.message-created',
  'telegram.message-revised',
  'telegram.approved',
  'telegram.queued',
  'telegram.enqueue-failure',
  'telegram.enqueue-unknown',
  'telegram.reconciled',
  'telegram.paused',
  'telegram.resumed',
]);

const clientCallTimeoutMs = 300;
interface ClientLocks {
  readonly unavailable: boolean;
  readonly reconciliation: boolean;
}
const availableClientLocks: ClientLocks = { unavailable: false, reconciliation: false };
const clientLocks = new WeakMap<TelegramUiClient, ClientLocks>();

class TelegramUiTimeoutError extends Error {
  constructor() {
    super('TELEGRAM_UI_CALL_TIMEOUT');
  }
}

function getClientLocks(client: TelegramUiClient): ClientLocks {
  return clientLocks.get(client) ?? availableClientLocks;
}

function lockClient(client: TelegramUiClient, lock: keyof ClientLocks) {
  clientLocks.set(client, { ...getClientLocks(client), [lock]: true });
}

function unlockClient(client: TelegramUiClient, lock: keyof ClientLocks) {
  const next = { ...getClientLocks(client), [lock]: false };
  if (!next.unavailable && !next.reconciliation) clientLocks.delete(client);
  else clientLocks.set(client, next);
}

function invokeClient<T>(call: () => Promise<T> | T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new TelegramUiTimeoutError());
    }, clientCallTimeoutMs);

    Promise.resolve()
      .then(call)
      .then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

function assertSafeSnapshot(value: TelegramUiSnapshot): TelegramUiSnapshot {
  if (
    !/^tg-\*{3}-\d{4}$/.test(value.maskedAccount) ||
    !['ready', 'degraded', 'stale'].includes(value.sessionState) ||
    value.providerAccess !== false ||
    typeof value.paused !== 'boolean' ||
    typeof value.reconciliationRequired !== 'boolean'
  ) {
    throw new Error('TELEGRAM_UI_SNAPSHOT_INVALID');
  }
  return value;
}

function assertSafeAudit(value: readonly TelegramUiAuditEvent[]): readonly TelegramUiAuditEvent[] {
  if (value.some((event) =>
    !safeAuditTypes.has(event.type) ||
    (event.outcome !== undefined && !['success', 'failure', 'unknown'].includes(event.outcome)))) {
    throw new Error('TELEGRAM_UI_AUDIT_INVALID');
  }
  return value;
}

function presentSafeError(value: unknown): string {
  if (value instanceof Error && safeErrorMessages.has(value.message)) return safeErrorMessages.get(value.message)!;
  return '本機操作已停止；未顯示未受信任的錯誤內容。';
}

export function TelegramOutreachPage({ client }: TelegramOutreachPageProps) {
  const [snapshot, setSnapshot] = useState<TelegramUiSnapshot>();
  const [audit, setAudit] = useState<readonly TelegramUiAuditEvent[]>([]);
  const [targets, setTargets] = useState<TelegramTargetPreviewResult>();
  const [preview, setPreview] = useState<TelegramPreviewResult>();
  const [approval, setApproval] = useState<TelegramApprovalResult>();
  const [csvText, setCsvText] = useState(initialCsv);
  const [template, setTemplate] = useState('你好 {{name}}.');
  const [variableValue, setVariableValue] = useState('合成聯絡人');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [approvalInvalidated, setApprovalInvalidated] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [locks, setLocks] = useState<ClientLocks>(() => getClientLocks(client));
  const [unknownLatched, setUnknownLatched] = useState(false);
  const [version, setVersion] = useState(1);
  const clientEpoch = useRef(0);

  const refresh = async (epoch: number) => {
    const [nextSnapshot, nextAudit] = await Promise.all([
      invokeClient(() => client.readSnapshot()),
      invokeClient(() => client.readAudit()),
    ]);
    const safeSnapshot = assertSafeSnapshot(nextSnapshot);
    const safeAudit = assertSafeAudit(nextAudit);
    if (clientEpoch.current !== epoch) return false;
    setSnapshot(safeSnapshot);
    setAudit(safeAudit);
    return true;
  };

  const applyLock = (lock: keyof ClientLocks) => {
    lockClient(client, lock);
    setLocks(getClientLocks(client));
  };

  useEffect(() => {
    const epoch = clientEpoch.current + 1;
    clientEpoch.current = epoch;
    setSnapshot(undefined);
    setAudit([]);
    setError(undefined);
    setBusy(false);
    setNotice(undefined);
    setLocks(getClientLocks(client));
    setUnknownLatched(getClientLocks(client).reconciliation);
    resetWorkflow();
    const effectClient = client;
    void refresh(epoch).catch(() => {
      lockClient(effectClient, 'unavailable');
      if (clientEpoch.current === epoch) {
        setLocks(getClientLocks(effectClient));
        setError('無法安全讀取 Telegram 本機狀態。');
      }
    });
    return () => { if (clientEpoch.current === epoch) clientEpoch.current += 1; };
  }, [client]);

  const run = async <T,>(
    operation: () => Promise<T> | T,
    commit: (value: T) => void,
    options: { readonly clearsReconciliation?: boolean } = {},
  ) => {
    const epoch = clientEpoch.current;
    const operationClient = client;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    let result: T;
    try {
      result = await invokeClient(operation);
    } catch (caught: unknown) {
      const reconciliationFailure = caught instanceof TelegramUiTimeoutError ||
        (caught instanceof Error && caught.message === 'RECONCILIATION_REQUIRED');
      lockClient(operationClient, reconciliationFailure ? 'reconciliation' : 'unavailable');
      if (caught instanceof TelegramUiTimeoutError) lockClient(operationClient, 'unavailable');
      if (clientEpoch.current === epoch) {
        if (reconciliationFailure) {
          setUnknownLatched(true);
          setApproval(undefined);
        } else {
          setApproval(undefined);
        }
        setLocks(getClientLocks(operationClient));
        setError(caught instanceof TelegramUiTimeoutError
          ? safeErrorMessages.get('RECONCILIATION_REQUIRED')
          : presentSafeError(caught));
        setBusy(false);
      }
      return;
    }

    if (clientEpoch.current !== epoch) {
      lockClient(operationClient, 'reconciliation');
      return;
    }
    try {
      const refreshed = await refresh(epoch);
      if (!refreshed || clientEpoch.current !== epoch) {
        lockClient(operationClient, 'reconciliation');
        return;
      }
    } catch {
      lockClient(operationClient, 'unavailable');
      lockClient(operationClient, 'reconciliation');
      if (clientEpoch.current === epoch) {
        setLocks(getClientLocks(operationClient));
        setApproval(undefined);
        setError(presentSafeError(new Error('TELEGRAM_UI_READBACK_FAILED')));
        setBusy(false);
      }
      return;
    }

    if (clientEpoch.current === epoch) {
      try {
        commit(result);
        if (options.clearsReconciliation) {
          unlockClient(client, 'reconciliation');
          setLocks(getClientLocks(client));
        }
      } catch (caught: unknown) {
        applyLock('unavailable');
        setApproval(undefined);
        setError(presentSafeError(caught));
      } finally {
        setBusy(false);
      }
    }
  };

  const recoverReadback = async () => {
    const epoch = clientEpoch.current;
    setBusy(true);
    setError(undefined);
    try {
      await refresh(epoch);
      if (clientEpoch.current === epoch) {
        unlockClient(client, 'unavailable');
        setLocks(getClientLocks(client));
        setError(undefined);
      }
    } catch {
      if (clientEpoch.current === epoch) {
        applyLock('unavailable');
        setError('無法安全讀取 Telegram 本機狀態。');
      }
    } finally {
      if (clientEpoch.current === epoch) setBusy(false);
    }
  };

  function resetWorkflow() {
    setTargets(undefined);
    setPreview(undefined);
    setApproval(undefined);
    setApprovalInvalidated(false);
    setDraftDirty(false);
  }

  if (!snapshot) {
    if (error) return <div className="tg-error" role="alert">{error}<button type="button" disabled={busy} onClick={() => void recoverReadback()}>重試安全讀回</button></div>;
    return <div className="tg-loading" role="status">正在讀取 Telegram synthetic fixture…</div>;
  }

  const blockedBySource = snapshot.sessionState !== 'ready';
  const reconciliationRequired = snapshot.reconciliationRequired || unknownLatched || locks.reconciliation;
  const readbackBlocked = locks.unavailable;
  const mutationsBlocked = busy || blockedBySource || snapshot.paused || reconciliationRequired || readbackBlocked;

  return (
    <section className="tg-page" aria-labelledby="telegram-page-title">
      <header className="tg-page__header">
        <div>
          <p className="tg-eyebrow">TELEGRAM · SYNTHETIC · NO-SEND</p>
          <h2 id="telegram-page-title">Telegram 外聯工作台</h2>
          <p>先預覽、綁定內容批准，再加入本機 fake 佇列。</p>
        </div>
        <div className="tg-session" aria-label="Telegram 工作階段">
          <span className={`tg-state tg-state--${snapshot.sessionState}`}>{snapshot.sessionState}</span>
          <strong>{snapshot.maskedAccount}</strong>
          <small>provider access: {String(snapshot.providerAccess)}</small>
          {snapshot.paused ? <span className="tg-paused">已暫停</span> : null}
          <button
            type="button"
            disabled={busy || reconciliationRequired || readbackBlocked}
            onClick={() => void run(
              () => snapshot.paused ? client.resume() : client.pause(),
              () => undefined,
            )}
          >
            {snapshot.paused ? '恢復 Telegram' : '暫停 Telegram'}
          </button>
        </div>
      </header>

      {blockedBySource ? (
        <div className="tg-stop" role="alert">
          <strong>停止條件：</strong>工作階段為 {snapshot.sessionState}，所有內容變更與入隊操作均已封鎖。
        </div>
      ) : null}
      {reconciliationRequired ? (
        <div className="tg-stop" role="alert">
          <strong>結果未知：</strong>禁止重送。必須先對帳，再建立新的批准。
          <span className="tg-inline-actions">
            <button type="button" disabled={busy || readbackBlocked} onClick={() => void reconcile('success')}>對帳為成功</button>
            <button type="button" disabled={busy || readbackBlocked} onClick={() => void reconcile('failure')}>對帳為失敗</button>
          </span>
        </div>
      ) : null}
      {error ? <div className="tg-error" role="alert">{error}{readbackBlocked ? <button type="button" disabled={busy} onClick={() => void recoverReadback()}>重試安全讀回</button> : null}</div> : null}
      {readbackBlocked && !error ? <div className="tg-error" role="alert">Telegram 本機讀回仍處於鎖定狀態。<button type="button" disabled={busy} onClick={() => void recoverReadback()}>重試安全讀回</button></div> : null}
      {notice ? <div className="tg-notice" role="status" aria-live="polite">{notice}</div> : null}

      <div className="tg-workflow">
        <section className="tg-panel" aria-labelledby="targets-title">
          <span className="tg-step">01</span>
          <h2 id="targets-title">目標預覽</h2>
          <label htmlFor="tg-targets">Synthetic CSV</label>
          <textarea disabled={busy} id="tg-targets" rows={4} value={csvText} onChange={(event) => {
            setCsvText(event.target.value);
            if (targets || preview || approval) {
              resetWorkflow();
              setApprovalInvalidated(true);
            }
          }} />
          <button
            type="button"
            disabled={mutationsBlocked}
            onClick={() => void run(
              () => client.previewTargets({ csvText }),
              (result) => {
                setTargets(telegramTargetPreviewResultSchema.parse(result));
                setPreview(undefined);
                setApproval(undefined);
                setApprovalInvalidated(false);
                setDraftDirty(false);
              })}
          >預覽合成目標</button>
          {targets ? (
            <ul className="tg-target-list" aria-label="合成目標預覽">
              {targets.targets.map((target) => <li key={target.targetRef}><strong>{target.displayName}</strong><span>{target.targetRef}</span></li>)}
            </ul>
          ) : <p className="tg-empty">尚未建立目標預覽。</p>}
        </section>

        <section className="tg-panel" aria-labelledby="message-title">
          <span className="tg-step">02</span>
          <h2 id="message-title">訊息與變數</h2>
          <label htmlFor="tg-template">訊息範本</label>
          <textarea disabled={busy} id="tg-template" rows={4} value={template} onChange={(event) => {
            setTemplate(event.target.value);
            if (preview || approval) {
              setApproval(undefined);
              setApprovalInvalidated(true);
              setDraftDirty(true);
            }
          }} />
          <label htmlFor="tg-variable">變數 name</label>
          <input disabled={busy} id="tg-variable" value={variableValue} onChange={(event) => {
            setVariableValue(event.target.value);
            if (preview || approval) {
              setApproval(undefined);
              setApprovalInvalidated(true);
              setDraftDirty(true);
            }
          }} />
          <div className="tg-actions">
            <button type="button" disabled={mutationsBlocked || !targets} onClick={() => void createMessage()}>建立訊息預覽</button>
            <button type="button" disabled={mutationsBlocked || !preview} onClick={() => void reviseMessage()}>修訂訊息預覽</button>
          </div>
          {approvalInvalidated ? <p className="tg-warning">內容已變更，需重新批准。</p> : null}
          {preview ? <pre className="tg-preview" aria-label="Telegram 訊息預覽">{preview.renderedMessage}</pre> : <p className="tg-empty">尚未渲染訊息。</p>}
        </section>

        <section className="tg-panel" aria-labelledby="approval-title">
          <span className="tg-step">03</span>
          <h2 id="approval-title">批准與本機入隊</h2>
          <p>批准只綁定目前內容 hash、範本版本、變數版本與目標集合。</p>
          <button type="button" disabled={mutationsBlocked || !preview || draftDirty} onClick={() => void approveMessage()}>批准目前內容</button>
          {approval ? <p className="tg-approval">已綁定批准 · {approval.approvalId}</p> : <p className="tg-empty">尚未批准。</p>}
          <button className="tg-primary" type="button" disabled={mutationsBlocked || draftDirty || !approval || !preview} onClick={() => void enqueueLocal()}>加入本機佇列</button>
        </section>
      </div>

      <section className="tg-audit" aria-labelledby="audit-title" aria-label="稽核事件">
        <div><p className="tg-eyebrow">MASKED READBACK</p><h2 id="audit-title">稽核事件</h2></div>
        {audit.length ? <ol>{audit.map((event, index) => <li key={`${index}:${event.type}`}>{event.type}{event.outcome ? ` · ${event.outcome}` : ''}</li>)}</ol> : <p className="tg-empty">尚無本機事件。</p>}
      </section>
    </section>
  );

  async function createMessage() {
    if (!targets) return;
    await run(
      () => client.createMessage({
        targetPreviewId: targets.targetPreviewId,
        template,
        variables: { name: variableValue },
        templateVersion: `ui-template-${version}`,
        variablesVersion: `ui-variables-${version}`,
        expectedStateVersion: 0,
      }),
      (result) => {
        const next = telegramPreviewResultSchema.parse(result);
        setPreview(next);
        setApproval(undefined);
        setApprovalInvalidated(false);
        setDraftDirty(false);
      });
  }

  async function reviseMessage() {
    if (!preview) return;
    await run(() => {
      const nextVersion = version + 1;
      return client.reviseMessage({
        previewId: preview.previewId,
        template,
        variables: { name: variableValue },
        templateVersion: `ui-template-${nextVersion}`,
        variablesVersion: `ui-variables-${nextVersion}`,
        expectedStateVersion: preview.binding.expectedStateVersion,
      });
    }, (result) => {
      const nextVersion = version + 1;
      const next = telegramPreviewResultSchema.parse(result);
      setVersion(nextVersion);
      setPreview(next);
      setApproval(undefined);
      setApprovalInvalidated(true);
      setDraftDirty(false);
    });
  }

  async function approveMessage() {
    if (!preview) return;
    await run(
      () => client.approveMessage({ previewId: preview.previewId, binding: preview.binding }),
      (result) => {
        setApproval(telegramApprovalResultSchema.parse(result));
        setApprovalInvalidated(false);
      });
  }

  async function enqueueLocal() {
    if (!preview || !approval) return;
    await run(
      () => client.enqueueLocal({ previewId: preview.previewId, approvalId: approval.approvalId, binding: approval.binding }),
      (value) => {
        const result = telegramQueueResultSchema.parse(value);
        if (result.outcome === 'unknown') {
          applyLock('reconciliation');
          setUnknownLatched(true);
          setApproval(undefined);
        } else {
          setNotice(result.outcome === 'success' ? '本機佇列已接受；沒有發送真實訊息。' : '本機 fake adapter 回報失敗；沒有發送真實訊息。');
          resetWorkflow();
          setVersion((current) => current + 1);
        }
      });
  }

  async function reconcile(outcome: 'success' | 'failure') {
    await run(
      () => client.reconcile(outcome),
      (value) => {
        const result = telegramQueueResultSchema.parse(value);
        if (result.outcome !== outcome) throw new Error('TELEGRAM_UI_RECONCILIATION_INVALID');
        setUnknownLatched(false);
        resetWorkflow();
        setVersion((current) => current + 1);
      }, { clearsReconciliation: true });
  }
}
