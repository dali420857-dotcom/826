export type Freshness = 'loading' | 'ready' | 'degraded' | 'unavailable' | 'stale';
export type OperationOutcome = 'success' | 'failure' | 'unknown';

export interface SanitizedFailure {
  readonly code: 'DECLARED_FAILURE' | 'EXECUTION_THROWN';
  readonly retryDisposition: 'replay-only';
  readonly stopCondition: 'operator-review-required';
}

export interface Clock {
  now(): Date;
}

export interface RuntimeSnapshot<T = unknown> {
  readonly version: number;
  readonly freshness: Freshness;
  readonly paused: boolean;
  readonly source: 'temporary-runtime-store';
  readonly stateUpdatedAt: string;
  readonly ttlMs: number;
  readonly pauseReason?: string;
  readonly updatedAt?: string;
  readonly freshUntil?: string;
  readonly detail?: string;
  readonly data?: T;
}

export type AuditEvent =
  | {
      readonly sequence: number;
      readonly occurredAt: string;
      readonly type: 'runtime.paused' | 'runtime.resumed' | 'runtime.reset';
      readonly version: number;
    }
  | {
      readonly sequence: number;
      readonly occurredAt: string;
      readonly type: 'operation.completed' | 'operation.reconciled';
      readonly operationId: string;
      readonly idempotencyKey: string;
      readonly outcome: OperationOutcome;
      readonly failure?: SanitizedFailure;
    };

export interface OperationResult<T> {
  readonly outcome: OperationOutcome;
  readonly value: T;
  readonly replayed: boolean;
}

export interface RunOperation<T> {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  execute(): Promise<{ outcome: OperationOutcome; value: T }> | {
    outcome: OperationOutcome;
    value: T;
  };
}

export interface RuntimeStore<TSnapshot = unknown> {
  readSnapshot(): RuntimeSnapshot<TSnapshot>;
  readAudit(): readonly AuditEvent[];
  recordReady(data: TSnapshot): RuntimeSnapshot<TSnapshot>;
  recordDegraded(detail: string): RuntimeSnapshot<TSnapshot>;
  recordUnavailable(detail: string): RuntimeSnapshot<TSnapshot>;
  pause(reason: string): RuntimeSnapshot<TSnapshot>;
  resume(): RuntimeSnapshot<TSnapshot>;
  reset(): RuntimeSnapshot<TSnapshot>;
  runOperation<T>(request: RunOperation<T>): Promise<OperationResult<T>>;
  reconcile<T>(input: {
    idempotencyKey: string;
    outcome: Exclude<OperationOutcome, 'unknown'>;
    value: T;
  }): OperationResult<T>;
}

interface StoredOperation {
  readonly operationId: string;
  readonly payloadHash: string;
  promise: Promise<OperationResult<unknown>>;
  result?: OperationResult<unknown>;
  error?: unknown;
}

export function createRuntimeStore<TSnapshot = unknown>(options: {
  readonly clock: Clock;
  readonly ttlMs: number;
}): RuntimeStore<TSnapshot> {
  if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
    throw new Error('INVALID_TTL');
  }

  const now = () => options.clock.now();
  const timestamp = () => now().toISOString();
  const initialSnapshot = (): RuntimeSnapshot<TSnapshot> => ({
    version: 0,
    freshness: 'loading',
    paused: false,
    source: 'temporary-runtime-store',
    stateUpdatedAt: timestamp(),
    ttlMs: options.ttlMs,
  });
  let snapshot = initialSnapshot();
  let auditSequence = 0;
  let generation = 0;
  const audit: AuditEvent[] = [];
  const operations = new Map<string, StoredOperation>();

  const nextVersion = () => snapshot.version + 1;

  const readSnapshot = (): RuntimeSnapshot<TSnapshot> => {
    if (!snapshot.freshUntil || snapshot.freshness === 'loading') return { ...snapshot };
    return now().getTime() >= new Date(snapshot.freshUntil).getTime()
      ? { ...snapshot, freshness: 'stale' }
      : { ...snapshot };
  };

  const auditRuntime = (type: 'runtime.paused' | 'runtime.resumed' | 'runtime.reset') => {
    audit.push({
      sequence: ++auditSequence,
      occurredAt: timestamp(),
      type,
      version: snapshot.version,
    });
  };

  const auditOperation = (
    type: 'operation.completed' | 'operation.reconciled',
    operationId: string,
    idempotencyKey: string,
    outcome: OperationOutcome,
    failureCode: SanitizedFailure['code'] = 'DECLARED_FAILURE',
  ) => {
    const failure: SanitizedFailure | undefined =
      outcome === 'failure'
        ? {
            code: failureCode,
            retryDisposition: 'replay-only',
            stopCondition: 'operator-review-required',
          }
        : undefined;
    audit.push({
      sequence: ++auditSequence,
      occurredAt: timestamp(),
      type,
      operationId,
      idempotencyKey,
      outcome,
      ...(failure ? { failure } : {}),
    });
  };

  const setHealth = (
    freshness: Extract<Freshness, 'ready' | 'degraded' | 'unavailable'>,
    update: Pick<RuntimeSnapshot<TSnapshot>, 'data' | 'detail'>,
  ) => {
    const observedAt = now();
    snapshot = {
      ...snapshot,
      ...update,
      version: nextVersion(),
      freshness,
      stateUpdatedAt: observedAt.toISOString(),
      updatedAt: observedAt.toISOString(),
      freshUntil: new Date(observedAt.getTime() + options.ttlMs).toISOString(),
    };
    return readSnapshot();
  };

  const store: RuntimeStore<TSnapshot> = {
    readSnapshot,
    readAudit: () => audit.map((event) => ({ ...event })),
    recordReady: (data) => setHealth('ready', { data, detail: undefined }),
    recordDegraded: (detail) => setHealth('degraded', { data: snapshot.data, detail }),
    recordUnavailable: (detail) =>
      setHealth('unavailable', { data: snapshot.data, detail }),
    pause: (reason) => {
      snapshot = {
        ...snapshot,
        version: nextVersion(),
        paused: true,
        pauseReason: reason,
        stateUpdatedAt: timestamp(),
      };
      auditRuntime('runtime.paused');
      return readSnapshot();
    },
    resume: () => {
      snapshot = {
        ...snapshot,
        version: nextVersion(),
        paused: false,
        pauseReason: undefined,
        stateUpdatedAt: timestamp(),
      };
      auditRuntime('runtime.resumed');
      return readSnapshot();
    },
    reset: () => {
      generation += 1;
      snapshot = initialSnapshot();
      operations.clear();
      auditRuntime('runtime.reset');
      return readSnapshot();
    },
    runOperation: async <T>(request: RunOperation<T>): Promise<OperationResult<T>> => {
      const existing = operations.get(request.idempotencyKey);
      if (existing) {
        if (existing.payloadHash !== request.payloadHash) {
          throw new Error('IDEMPOTENCY_CONFLICT');
        }
        if (existing.result?.outcome === 'unknown') {
          throw new Error('RECONCILIATION_REQUIRED');
        }
        if (existing.error) throw existing.error;
        if (existing.result) {
          return { ...(existing.result as OperationResult<T>), replayed: true };
        }
        return existing.promise as Promise<OperationResult<T>>;
      }
      if (snapshot.paused) throw new Error('RUNTIME_PAUSED');

      const operationGeneration = generation;
      const entry: StoredOperation = {
        operationId: request.operationId,
        payloadHash: request.payloadHash,
        promise: Promise.resolve({ outcome: 'unknown', value: undefined, replayed: false }),
      };
      entry.promise = (async (): Promise<OperationResult<T>> => {
        try {
          const executed = await request.execute();
          const result: OperationResult<T> = { ...executed, replayed: false };
          if (operationGeneration === generation) {
            entry.result = result;
            auditOperation(
              'operation.completed',
              request.operationId,
              request.idempotencyKey,
              result.outcome,
            );
          }
          return result;
        } catch (error: unknown) {
          if (operationGeneration === generation) {
            entry.error = error;
            auditOperation(
              'operation.completed',
              request.operationId,
              request.idempotencyKey,
              'failure',
              'EXECUTION_THROWN',
            );
          }
          throw error;
        }
      })();
      operations.set(request.idempotencyKey, entry);
      return entry.promise as Promise<OperationResult<T>>;
    },
    reconcile: <T>(input: {
      idempotencyKey: string;
      outcome: Exclude<OperationOutcome, 'unknown'>;
      value: T;
    }): OperationResult<T> => {
      const existing = operations.get(input.idempotencyKey);
      if (!existing || existing.result?.outcome !== 'unknown') {
        throw new Error('NO_UNKNOWN_OUTCOME');
      }
      const result: OperationResult<T> = {
        outcome: input.outcome,
        value: input.value,
        replayed: false,
      };
      existing.result = result;
      existing.promise = Promise.resolve(result);
      auditOperation(
        'operation.reconciled',
        existing.operationId,
        input.idempotencyKey,
        input.outcome,
      );
      return result;
    },
  };

  return store;
}
