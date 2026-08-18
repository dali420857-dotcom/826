import type { z } from 'zod';
import { freshnessSchema, type ModuleId } from '../contracts';

export type SourceState = z.infer<typeof freshnessSchema>;
type SourceFailureState = Exclude<SourceState, 'loading' | 'ready'>;

interface SourceEvidenceBase {
  readonly moduleId: ModuleId;
  readonly source: string;
  readonly observedAt: string;
  readonly ttlMs: number;
}

export type SourceEvidence = SourceEvidenceBase &
  (
    | { readonly state: 'loading' | 'ready' }
    | {
        readonly state: SourceFailureState;
        readonly rootCause: string;
        readonly safeRetry: string;
        readonly stopCondition: string;
      }
  );

export interface SourceSummary {
  readonly state: SourceState;
  readonly readyCount: number;
  readonly totalCount: number;
  readonly sources: readonly SourceEvidence[];
}

const stateCopy: Record<SourceState, string> = {
  loading: '正在讀取資料',
  ready: '資料來源已就緒',
  degraded: '資料來源降級',
  unavailable: '資料來源目前無法使用',
  stale: '資料快照已過期',
};

const severity: Record<SourceState, number> = {
  ready: 0,
  loading: 1,
  stale: 2,
  degraded: 3,
  unavailable: 4,
};

export function createSyntheticSourceEvidence(
  moduleId: ModuleId,
  state: SourceState,
): SourceEvidence {
  const base = {
    moduleId,
    source: 'synthetic-shell-fixture',
    observedAt: '2026-08-17T00:00:00.000Z',
    ttlMs: 60_000,
  } as const;
  if (state === 'ready' || state === 'loading') return { ...base, state };
  return {
    ...base,
    state,
    rootCause: 'fixture-state-injection',
    safeRetry: '重新建立合成快照後再讀取。',
    stopCondition: '狀態未完成對帳前，不允許任何操作。',
  };
}

export function summarizeSourceEvidence(
  moduleIds: readonly ModuleId[],
  evidence: readonly SourceEvidence[],
  now: string,
): SourceSummary {
  const nowMs = Date.parse(now);
  const sources = moduleIds.map((moduleId): SourceEvidence => {
    const candidates = evidence.filter((candidate) => candidate.moduleId === moduleId);
    if (candidates.length > 1) {
      return {
        moduleId,
        state: 'unavailable',
        source: 'conflicting-readback',
        observedAt: now,
        ttlMs: 0,
        rootCause: 'duplicate-module-evidence',
        safeRetry: '移除衝突證據並重新取得唯一快照。',
        stopCondition: '同一模塊存在多筆證據時，不允許任何操作。',
      };
    }
    const source = candidates[0];
    if (!source) {
      return {
        moduleId,
        state: 'unavailable',
        source: 'missing-readback',
        observedAt: now,
        ttlMs: 0,
        rootCause: 'missing-module-evidence',
        safeRetry: '取得該模塊的新快照後再讀取。',
        stopCondition: '缺少來源證據時，不允許任何操作。',
      };
    }
    const observedMs = Date.parse(source.observedAt);
    const invalidFreshnessEvidence =
      !Number.isFinite(nowMs) ||
      !Number.isFinite(observedMs) ||
      !Number.isFinite(source.ttlMs) ||
      source.ttlMs <= 0 ||
      observedMs > nowMs;
    if (invalidFreshnessEvidence) {
      return {
        ...source,
        state: 'unavailable',
        rootCause: `${'rootCause' in source ? `${source.rootCause};` : ''}invalid-source-freshness`,
        safeRetry: '以有效觀測時間與有限正數 TTL 取得新快照。',
        stopCondition: '來源時效證據無效時，不允許任何操作。',
      };
    }
    if (source.state !== 'ready' && source.state !== 'loading') return source;
    if (observedMs + source.ttlMs <= nowMs) {
      return {
        ...source,
        state: 'stale',
        rootCause: 'snapshot-ttl-expired',
        safeRetry: '取得新快照並完成對帳。',
        stopCondition: '過期快照不得作為即時證據。',
      };
    }
    return source;
  });
  const state = sources.reduce<SourceState>(
    (current, source) => (severity[source.state] > severity[current] ? source.state : current),
    'ready',
  );
  return {
    state,
    readyCount: sources.filter((source) => source.state === 'ready').length,
    totalCount: moduleIds.length,
    sources,
  };
}

export function SourceStateBand({ summary }: { summary: SourceSummary }) {
  return (
    <div className={`source-state source-state--${summary.state}`} role="status">
      <span className="source-state__label">資料來源</span>
      <strong>{stateCopy[summary.state]}</strong>
      {summary.sources.map((source) => (
        <span key={source.moduleId}>
          {source.moduleId}: {source.source} · 觀測 {source.observedAt} · TTL {source.ttlMs / 1000} 秒
          {'rootCause' in source
            ? ` · 根因 ${source.rootCause} · 安全重試 ${source.safeRetry} · 停止條件 ${source.stopCondition}`
            : ''}
        </span>
      ))}
    </div>
  );
}
