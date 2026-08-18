import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmailUiClient } from '../modules/email/ui';
import type { TelegramUiClient } from '../modules/telegram/ui';
import type { SourceState } from '../shell';
import { outreachAssemblyManifest } from './assemblyManifest';

type PauseState = 'monitoring' | 'paused' | 'unavailable';

interface ModuleReadback {
  readonly pauseState: PauseState;
  readonly auditCount: number | null;
  readonly reconciliationCount: number | null;
  readonly sourceState: SourceState;
}

interface SharedReadback {
  readonly email: ModuleReadback;
  readonly telegram: ModuleReadback;
}

interface SharedMutationGuard {
  readonly pending: Set<Promise<unknown>>;
  desiredPauseState?: PauseState;
  unknown: boolean;
}

const sharedMutationGuards = new WeakMap<object, WeakMap<object, SharedMutationGuard>>();

function getSharedMutationGuard(emailClient: object, telegramClient: object): SharedMutationGuard {
  let byTelegram = sharedMutationGuards.get(emailClient);
  if (!byTelegram) {
    byTelegram = new WeakMap();
    sharedMutationGuards.set(emailClient, byTelegram);
  }
  let guard = byTelegram.get(telegramClient);
  if (!guard) {
    guard = { pending: new Set(), unknown: false };
    byTelegram.set(telegramClient, guard);
  }
  return guard;
}

const unavailable: ModuleReadback = {
  pauseState: 'unavailable',
  auditCount: null,
  reconciliationCount: null,
  sourceState: 'unavailable',
};

const CLIENT_BOUNDARY_TIMEOUT_MS = 300;

class ClientTimeoutError extends Error {
  constructor() {
    super('UI_CLIENT_TIMEOUT');
  }
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

export function SharedOperationsPanel({
  emailClient,
  telegramClient,
  onEvidenceChange,
}: {
  readonly emailClient: EmailUiClient;
  readonly telegramClient: TelegramUiClient;
  readonly onEvidenceChange?: (states: Readonly<Record<'email' | 'telegram', SourceState>>) => void;
}) {
  const [readback, setReadback] = useState<SharedReadback>({
    email: { ...unavailable, sourceState: 'loading' },
    telegram: { ...unavailable, sourceState: 'loading' },
  });
  const [busy, setBusy] = useState(true);
  const [locked, setLocked] = useState(false);
  const [notice, setNotice] = useState('正在讀取兩個模塊。');
  const mountedRef = useRef(true);
  const refreshEpochRef = useRef(0);
  const mutationGuard = getSharedMutationGuard(emailClient, telegramClient);
  const clientGenerationRef = useRef(0);
  const clientIdentityRef = useRef({ emailClient, telegramClient });
  if (
    clientIdentityRef.current.emailClient !== emailClient
    || clientIdentityRef.current.telegramClient !== telegramClient
  ) {
    clientIdentityRef.current = { emailClient, telegramClient };
    clientGenerationRef.current += 1;
  }
  const renderClientGeneration = clientGenerationRef.current;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshEpochRef.current += 1;
    };
  }, []);

  const refresh = useCallback(async (announce = true, reconcileUnknown = announce) => {
    if (renderClientGeneration !== clientGenerationRef.current) return undefined;
    const requestEpoch = ++refreshEpochRef.current;
    setBusy(true);
    const [emailResult, telegramResult] = await Promise.allSettled([
      Promise.all([
        callClient(() => emailClient.getStatus()),
        callClient(() => emailClient.readAudit()),
        callClient(() => emailClient.readQueue()),
      ]),
      Promise.all([
        callClient(() => telegramClient.readSnapshot()),
        callClient(() => telegramClient.readAudit()),
      ]),
    ]);

    const email = emailResult.status === 'fulfilled'
      ? {
          pauseState: emailResult.value[0].paused ? 'paused' as const : 'monitoring' as const,
          auditCount: emailResult.value[1].length,
          reconciliationCount: emailResult.value[2].filter(
            (item) => item.status === 'reconciliation-required',
          ).length,
          sourceState: 'ready' as const,
        }
      : unavailable;
    const telegram = telegramResult.status === 'fulfilled'
      ? {
          pauseState: telegramResult.value[0].paused ? 'paused' as const : 'monitoring' as const,
          auditCount: telegramResult.value[1].length,
          reconciliationCount: telegramResult.value[0].reconciliationRequired ? 1 : 0,
          sourceState: telegramResult.value[0].sessionState === 'stale'
            ? 'stale' as const
            : telegramResult.value[0].sessionState === 'ready'
              ? 'ready' as const
              : 'degraded' as const,
        }
      : unavailable;
    const next = { email, telegram };
    const failed = emailResult.status === 'rejected' || telegramResult.status === 'rejected';
    if (
      !mountedRef.current
      || requestEpoch !== refreshEpochRef.current
      || renderClientGeneration !== clientGenerationRef.current
    ) return undefined;
    const desiredState = mutationGuard.desiredPauseState;
    const stateMismatch = desiredState !== undefined && (
      email.pauseState !== desiredState || telegram.pauseState !== desiredState
    );
    if (!failed && !stateMismatch && mutationGuard.pending.size === 0 && (!mutationGuard.unknown || reconcileUnknown)) {
      mutationGuard.desiredPauseState = undefined;
      mutationGuard.unknown = false;
    }
    setReadback(next);
    setLocked(failed || stateMismatch || mutationGuard.pending.size > 0 || mutationGuard.unknown);
    setBusy(false);
    onEvidenceChange?.({ email: email.sourceState, telegram: telegram.sourceState });
    if (failed || announce) {
      setNotice(failed
        ? '讀回不完整；共用變更已鎖定。請修復來源後重新整理。'
        : '兩個模塊已完成本機讀回。');
    }
    return { next, failed };
  }, [emailClient, mutationGuard, onEvidenceChange, renderClientGeneration, telegramClient]);

  useEffect(() => {
    void refresh(false, true);
  }, [refresh]);

  const changePauseState = async (action: 'pause' | 'resume') => {
    const operationClientGeneration = renderClientGeneration;
    if (operationClientGeneration !== clientGenerationRef.current) return;
    setBusy(true);
    setNotice(action === 'pause' ? '正在暫停兩個模塊。' : '正在恢復兩個模塊。');
    const targetState = action === 'pause' ? 'paused' : 'monitoring';
    mutationGuard.desiredPauseState = targetState;
    mutationGuard.unknown = false;
    const emailOperation = Promise.resolve().then(() => emailClient[action]());
    const telegramOperation = Promise.resolve().then(() => telegramClient[action]());
    const operations: Promise<unknown>[] = [emailOperation, telegramOperation];
    operations.forEach((operation) => mutationGuard.pending.add(operation));
    void Promise.allSettled(operations).then(() => {
      operations.forEach((operation) => mutationGuard.pending.delete(operation));
      if (
        mutationGuard.unknown
        && mountedRef.current
        && operationClientGeneration === clientGenerationRef.current
      ) {
        setLocked(true);
        setNotice('逾時操作已結束；結果仍需手動重新整理與對帳。');
      }
    });
    const results = await Promise.allSettled([
      callClient(() => emailOperation),
      callClient(() => telegramOperation),
    ]);
    const timedOutOperations = operations.filter((_operation, index) => {
      const result = results[index];
      return result?.status === 'rejected' && result.reason instanceof ClientTimeoutError;
    });
    if (timedOutOperations.length > 0) mutationGuard.unknown = true;
    if (
      !mountedRef.current
      || operationClientGeneration !== clientGenerationRef.current
    ) return;
    const refreshed = await refresh(false);
    if (!refreshed) return;
    const { next, failed: readbackFailed } = refreshed;
    const stateMismatch =
      next.email.pauseState !== targetState || next.telegram.pauseState !== targetState;
    const partialFailure =
      results.some((result) => result.status === 'rejected') || readbackFailed || stateMismatch;
    setLocked(partialFailure);
    setNotice(partialFailure
      ? '操作只部分完成；已鎖定後續變更，請先重新整理並完成對帳。'
      : action === 'pause'
        ? 'Email 與 Telegram 已暫停。'
        : 'Email 與 Telegram 已恢復。');
  };

  const allPaused = readback.email.pauseState === 'paused' && readback.telegram.pauseState === 'paused';
  const allMonitoring = readback.email.pauseState === 'monitoring' && readback.telegram.pauseState === 'monitoring';
  const formatCount = (value: number | null) => value === null ? 'unavailable' : String(value);

  return (
    <section className="shared-operations" aria-labelledby="shared-operations-title" aria-busy={busy}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">EMAIL + TELEGRAM · LOCAL READBACK</p>
          <h2 id="shared-operations-title">共同營運</h2>
          <p>{outreachAssemblyManifest.modules.length} modules · no-send</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void refresh()}>重新整理讀回</button>
      </div>

      <p className={locked ? 'shared-operations__alert' : ''} aria-live="polite" role="status">
        {notice}
      </p>
      <p>Email：{readback.email.pauseState} · Telegram：{readback.telegram.pauseState}</p>

      <div className="shared-operations__actions">
        <button type="button" disabled={busy || locked || allPaused} onClick={() => void changePauseState('pause')}>
          暫停兩個模塊
        </button>
        <button type="button" disabled={busy || locked || allMonitoring} onClick={() => void changePauseState('resume')}>
          恢復兩個模塊
        </button>
      </div>

      <div className="shared-operations__grid">
        <article>
          <h3>稽核報表</h3>
          <p>Email：{formatCount(readback.email.auditCount)} · Telegram：{formatCount(readback.telegram.auditCount)}</p>
        </article>
        <article>
          <h3>異常與復原</h3>
          <p>Email 待對帳：{formatCount(readback.email.reconciliationCount)}</p>
          <p>Telegram 待對帳：{formatCount(readback.telegram.reconciliationCount)}</p>
        </article>
        <article>
          <h3>排程預覽</h3>
          <ul>
            {outreachAssemblyManifest.schedules.map((schedule) => (
              <li key={schedule.moduleId}>{schedule.label} · disabled</li>
            ))}
          </ul>
        </article>
        <article>
          <h3>安全設定</h3>
          <p>{outreachAssemblyManifest.settings.network} · {outreachAssemblyManifest.settings.data}</p>
          <p>Provider、OAuth、排程與 live-send 未安裝。</p>
        </article>
      </div>
    </section>
  );
}
