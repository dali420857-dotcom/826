import { approvalStillMatches, assertSafeCsvCell, inputLimits } from '../../contracts';
import type { OutreachOperationModule, OutreachSnapshotModule } from '../../contracts';
import type { BridgeHandlerContext, BridgeOperationRegistration } from '../../bridge';
import { createRuntimeStore, type Clock, type OperationOutcome } from '../../runtime-core';
import {
  telegramApprovalResultSchema,
  telegramApprovePayloadSchema,
  telegramCreateMessagePayloadSchema,
  telegramEnqueuePayloadSchema,
  telegramFakeAdapterResultSchema,
  telegramPreviewImportPayloadSchema,
  telegramPreviewResultSchema,
  telegramQueueResultSchema,
  telegramReconcilePayloadSchema,
  telegramReviseMessagePayloadSchema,
  telegramSessionEvidenceSchema,
  telegramSnapshotSchema,
  telegramTargetPreviewResultSchema,
  type TelegramApprovalBinding,
  type TelegramApprovalResult,
  type TelegramApprovePayload,
  type TelegramCreateMessagePayload,
  type TelegramEnqueuePayload,
  type TelegramPreviewImportPayload,
  type TelegramPreviewResult,
  type TelegramQueueResult,
  type TelegramReconcilePayload,
  type TelegramReviseMessagePayload,
  type TelegramSessionEvidence,
  type TelegramSnapshot,
  type TelegramTargetPreviewResult,
} from './schemas';

export interface FakeTelegramAdapterRequest {
  readonly mode: 'fake-local';
  readonly renderedMessage: string;
  readonly targetCount: number;
  readonly signal: AbortSignal;
}

export interface FakeTelegramAdapter {
  enqueue(request: FakeTelegramAdapterRequest): Promise<{
    outcome: OperationOutcome;
    queueReceipt: string;
  }>;
}

export type TelegramBridgeRegistration =
  | BridgeOperationRegistration<'telegram.previewImport', TelegramPreviewImportPayload, TelegramTargetPreviewResult>
  | BridgeOperationRegistration<'telegram.createMessage', TelegramCreateMessagePayload, TelegramPreviewResult>
  | BridgeOperationRegistration<'telegram.reviseMessage', TelegramReviseMessagePayload, TelegramPreviewResult>
  | BridgeOperationRegistration<'telegram.approveMessage', TelegramApprovePayload, TelegramApprovalResult>
  | BridgeOperationRegistration<'telegram.enqueueLocal', TelegramEnqueuePayload, TelegramQueueResult>
  | BridgeOperationRegistration<'telegram.reconcile', TelegramReconcilePayload, TelegramQueueResult>;

export interface TelegramTrace {
  readonly correlationId: string;
  readonly operationId: string;
}

export type TelegramAuditEvent = TelegramTrace &
  { readonly occurredAt: string } &
  (
    | { readonly type: 'telegram.targets-previewed'; readonly targetPreviewId: string; readonly targetCount: number }
    | { readonly type: 'telegram.message-created' | 'telegram.message-revised'; readonly previewId: string }
    | { readonly type: 'telegram.approved'; readonly previewId: string; readonly approvalId: string }
    | { readonly type: 'telegram.queued' | 'telegram.enqueue-unknown' | 'telegram.reconciled'; readonly outcome: OperationOutcome }
  );

export type TelegramEnqueueRequest = TelegramEnqueuePayload & {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly correlationId?: string;
  readonly signal?: AbortSignal;
};

export interface TelegramBackend {
  previewImport(input: TelegramPreviewImportPayload, trace?: TelegramTrace): Promise<TelegramTargetPreviewResult>;
  createMessage(input: TelegramCreateMessagePayload, trace?: TelegramTrace): Promise<TelegramPreviewResult>;
  reviseMessage(input: TelegramReviseMessagePayload, trace?: TelegramTrace): Promise<TelegramPreviewResult>;
  approveMessage(input: TelegramApprovePayload, trace?: TelegramTrace): TelegramApprovalResult;
  enqueueLocal(input: TelegramEnqueueRequest): Promise<TelegramQueueResult>;
  reconcileQueue(input: { idempotencyKey: string; outcome: Exclude<OperationOutcome, 'unknown'>; queueReceipt: string; operationId?: string; correlationId?: string }): TelegramQueueResult;
  readSnapshot(): TelegramSnapshot;
  readAudit(): readonly TelegramAuditEvent[];
  readonly registrations: readonly TelegramBridgeRegistration[];
  readonly snapshotModule: OutreachSnapshotModule<TelegramSnapshot>;
  readonly operationModule: OutreachOperationModule;
}

interface StoredMessage extends TelegramPreviewResult {
  readonly targetCount: number;
  readonly revision: number;
  readonly queueStateVersion: number;
}

interface StoredApproval {
  readonly result: TelegramApprovalResult;
  readonly revision: number;
}

interface PendingUnknown {
  readonly previewId: string;
  readonly approvalId: string;
}

const unsafeControl = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const markdownV2Reserved = /([_*\[\]()~`>#+=|{}.!\\-])/g;

function parseCsvRow(row: string): string[] {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index];
    if (character === '"') {
      if (quoted && row[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      cells.push(value);
      value = '';
    } else value += character;
  }
  if (quoted) throw new Error('TELEGRAM_IMPORT_INVALID');
  cells.push(value);
  return cells;
}

function parseTargets(csvText: string): TelegramTargetPreviewResult['targets'] {
  if (new TextEncoder().encode(csvText).byteLength > inputLimits.maxImportBytes) {
    throw new Error('TELEGRAM_IMPORT_LIMIT_EXCEEDED');
  }
  const lines = csvText.replace(/\r\n?/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length < 2 || lines.length - 1 > inputLimits.maxImportRows) {
    throw new Error('TELEGRAM_IMPORT_INVALID');
  }
  const header = parseCsvRow(lines[0]);
  if (header.length !== 2 || header[0] !== 'target_ref' || header[1] !== 'display_name') {
    throw new Error('TELEGRAM_IMPORT_INVALID');
  }
  if (lines.length - 1 > inputLimits.maxTargetsPerPreview) {
    throw new Error('TELEGRAM_TARGET_LIMIT_EXCEEDED');
  }
  const seen = new Set<string>();
  return lines.slice(1).map((line) => {
    const cells = parseCsvRow(line);
    if (cells.length !== 2 || cells.some((cell) => unsafeControl.test(cell))) {
      throw new Error('TELEGRAM_IMPORT_INVALID');
    }
    const targetRef = cells[0];
    const displayName = assertSafeCsvCell(cells[1]);
    if (!/^synthetic:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(targetRef) || displayName.length < 1 || displayName.length > 128 || seen.has(targetRef)) {
      throw new Error('TELEGRAM_IMPORT_INVALID');
    }
    seen.add(targetRef);
    return { targetRef, displayName };
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function renderTelegramMessage(template: string, variables: Readonly<Record<string, string>>): string {
  const rendered = template.replace(/{{\s*([A-Za-z][A-Za-z0-9_.-]{0,63})\s*}}/g, (_match, key) => {
    if (!Object.hasOwn(variables, key)) throw new Error('TELEGRAM_TEMPLATE_VARIABLE_MISSING');
    return variables[key];
  });
  if (/{{|}}/.test(rendered) || unsafeControl.test(rendered)) throw new Error('TELEGRAM_TEMPLATE_INVALID');
  return rendered.replace(/\r\n?/g, '\n').replace(markdownV2Reserved, '\\$1');
}

function sessionState(evidence: TelegramSessionEvidence, now: Date): TelegramSnapshot['sessionState'] {
  return now.getTime() >= new Date(evidence.freshUntil).getTime() ? 'stale' : evidence.state;
}

export function createTelegramBackend(options: {
  readonly clock: Clock;
  readonly sessionEvidence: TelegramSessionEvidence;
  readonly fakeAdapter: FakeTelegramAdapter;
}): TelegramBackend {
  const evidenceResult = telegramSessionEvidenceSchema.safeParse(options.sessionEvidence);
  if (!evidenceResult.success) throw new Error('TELEGRAM_SESSION_EVIDENCE_INVALID');
  const evidence = evidenceResult.data;
  const observedAtMs = new Date(evidence.observedAt).getTime();
  const freshUntilMs = new Date(evidence.freshUntil).getTime();
  if (
    observedAtMs > options.clock.now().getTime() ||
    freshUntilMs - observedAtMs > 10 * 60_000
  ) {
    throw new Error('TELEGRAM_SESSION_EVIDENCE_INVALID');
  }
  const runtimeStore = createRuntimeStore<TelegramSnapshot>({ clock: options.clock, ttlMs: 60_000 });
  const targetPreviews = new Map<string, TelegramTargetPreviewResult>();
  const messages = new Map<string, StoredMessage>();
  const approvals = new Map<string, StoredApproval>();
  const approvalsInFlight = new Set<string>();
  const revisionsInFlight = new Set<string>();
  const unknownApprovals = new Set<string>();
  const unknownPreviewIds = new Set<string>();
  const pendingUnknownByKey = new Map<string, PendingUnknown>();
  const bridgeMutations = new Map<
    string,
    { readonly payloadHash: string; readonly promise: Promise<unknown> }
  >();
  const audit: TelegramAuditEvent[] = [];
  let stateVersion = 0;
  let queueCount = 0;
  let activeAdapterOperations = 0;

  const snapshot = (): TelegramSnapshot => ({
    moduleId: 'telegram', source: 'synthetic-fixture', maskedAccount: evidence.maskedAccount,
    sessionState: sessionState(evidence, options.clock.now()), providerAccess: false,
    targetPreviewCount: targetPreviews.size, messagePreviewCount: messages.size,
    approvalCount: approvals.size, queueCount, stateVersion,
  });
  const recordSnapshot = () => {
    const current = snapshot();
    if (current.sessionState === 'ready') runtimeStore.recordReady(current);
    else runtimeStore.recordDegraded(`telegram-session-${current.sessionState}`);
  };
  recordSnapshot();

  const auditTrace = (trace?: TelegramTrace): TelegramTrace =>
    trace ?? { correlationId: 'local-direct', operationId: 'local-direct' };

  const runBridgeMutation = async <T>(input: {
    idempotencyKey: string | undefined;
    operation: string;
    payload: unknown;
    execute: () => Promise<T> | T;
  }): Promise<T> => {
    if (!input.idempotencyKey) throw new Error('TELEGRAM_IDEMPOTENCY_KEY_REQUIRED');
    const payloadHash = await sha256({ operation: input.operation, payload: input.payload });
    const existing = bridgeMutations.get(input.idempotencyKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new Error('IDEMPOTENCY_CONFLICT');
      return existing.promise as Promise<T>;
    }
    const promise = Promise.resolve().then(input.execute);
    bridgeMutations.set(input.idempotencyKey, { payloadHash, promise });
    return promise;
  };

  const previewImport = async (raw: TelegramPreviewImportPayload, trace?: TelegramTrace): Promise<TelegramTargetPreviewResult> => {
    const parsed = telegramPreviewImportPayloadSchema.safeParse(raw);
    if (!parsed.success) throw new Error('TELEGRAM_IMPORT_INVALID');
    const targets = parseTargets(parsed.data.csvText);
    const targetSetHash = await sha256(targets.map(({ targetRef }) => targetRef));
    const targetPreviewId = `tg-targets-${(await sha256(targets)).slice(0, 16)}`;
    const existing = targetPreviews.get(targetPreviewId);
    if (existing) {
      return { ...existing, sessionState: sessionState(evidence, options.clock.now()) };
    }
    const preview = { targetPreviewId, targets, targetSetHash, sessionState: sessionState(evidence, options.clock.now()) };
    targetPreviews.set(targetPreviewId, preview);
    audit.push({ ...auditTrace(trace), type: 'telegram.targets-previewed', occurredAt: options.clock.now().toISOString(), targetPreviewId, targetCount: targets.length });
    recordSnapshot();
    return preview;
  };

  const materializeMessage = async (
    input: Omit<TelegramCreateMessagePayload, 'targetPreviewId'>,
    targetPreview: TelegramTargetPreviewResult,
    previewId?: string,
    revision = 0,
    queueStateVersion = 0,
    bindingStateVersion = input.expectedStateVersion,
  ): Promise<StoredMessage> => {
    const renderedMessage = renderTelegramMessage(input.template, input.variables);
    const contentHash = await sha256(renderedMessage);
    const binding: TelegramApprovalBinding = {
      schemaVersion: 1, contentHash, templateVersion: input.templateVersion, variablesVersion: input.variablesVersion,
      targetSetHash: targetPreview.targetSetHash, expectedStateVersion: bindingStateVersion,
    };
    const id = previewId ?? `tg-preview-${(await sha256({ binding, targetPreviewId: targetPreview.targetPreviewId })).slice(0, 16)}`;
    return { previewId: id, targetPreviewId: targetPreview.targetPreviewId, renderedMessage, binding, sessionState: sessionState(evidence, options.clock.now()), targetCount: targetPreview.targets.length, revision, queueStateVersion };
  };

  const publicMessage = (message: StoredMessage): TelegramPreviewResult => ({
    previewId: message.previewId,
    targetPreviewId: message.targetPreviewId,
    renderedMessage: message.renderedMessage,
    binding: message.binding,
    sessionState: message.sessionState,
  });

  const createMessage = async (raw: TelegramCreateMessagePayload, trace?: TelegramTrace): Promise<TelegramPreviewResult> => {
    const parsed = telegramCreateMessagePayloadSchema.safeParse(raw);
    if (!parsed.success) throw new Error('TELEGRAM_MESSAGE_INVALID');
    const targets = targetPreviews.get(parsed.data.targetPreviewId);
    if (!targets) throw new Error('TELEGRAM_TARGET_PREVIEW_REQUIRED');
    if (parsed.data.expectedStateVersion !== 0) throw new Error('TELEGRAM_STATE_CONFLICT');
    const message = await materializeMessage(parsed.data, targets);
    const existing = messages.get(message.previewId);
    if (existing) {
      if (
        existing.revision === 0 &&
        existing.queueStateVersion === parsed.data.expectedStateVersion &&
        approvalStillMatches(existing.binding, message.binding)
      ) {
        return publicMessage(existing);
      }
      throw new Error('TELEGRAM_MESSAGE_ALREADY_EXISTS');
    }
    messages.set(message.previewId, message);
    audit.push({ ...auditTrace(trace), type: 'telegram.message-created', occurredAt: options.clock.now().toISOString(), previewId: message.previewId });
    recordSnapshot();
    return publicMessage(message);
  };

  const reviseMessage = async (raw: TelegramReviseMessagePayload, trace?: TelegramTrace): Promise<TelegramPreviewResult> => {
    const parsed = telegramReviseMessagePayloadSchema.safeParse(raw);
    if (!parsed.success) throw new Error('TELEGRAM_MESSAGE_INVALID');
    const previous = messages.get(parsed.data.previewId);
    if (!previous) throw new Error('TELEGRAM_MESSAGE_PREVIEW_REQUIRED');
    if (unknownPreviewIds.has(previous.previewId)) throw new Error('RECONCILIATION_REQUIRED');
    const targets = targetPreviews.get(previous.targetPreviewId);
    if (!targets) throw new Error('TELEGRAM_TARGET_PREVIEW_REQUIRED');
    if (parsed.data.expectedStateVersion !== previous.queueStateVersion) throw new Error('TELEGRAM_STATE_CONFLICT');
    if (revisionsInFlight.has(previous.previewId)) throw new Error('TELEGRAM_REVISION_IN_FLIGHT');
    revisionsInFlight.add(previous.previewId);
    try {
      const nextStateVersion = previous.queueStateVersion + 1;
      const message = await materializeMessage(
        parsed.data,
        targets,
        previous.previewId,
        previous.revision + 1,
        nextStateVersion,
        nextStateVersion,
      );
      messages.set(message.previewId, message);
      audit.push({ ...auditTrace(trace), type: 'telegram.message-revised', occurredAt: options.clock.now().toISOString(), previewId: message.previewId });
      recordSnapshot();
      return publicMessage(message);
    } finally {
      revisionsInFlight.delete(previous.previewId);
    }
  };

  const approveMessage = (raw: TelegramApprovePayload, trace?: TelegramTrace): TelegramApprovalResult => {
    const parsed = telegramApprovePayloadSchema.safeParse(raw);
    if (!parsed.success) throw new Error('TELEGRAM_APPROVAL_INVALID');
    const preview = messages.get(parsed.data.previewId);
    if (preview && unknownPreviewIds.has(preview.previewId)) {
      throw new Error('RECONCILIATION_REQUIRED');
    }
    if (!preview || !approvalStillMatches(preview.binding, parsed.data.binding) || parsed.data.binding.expectedStateVersion !== preview.queueStateVersion) {
      throw new Error('APPROVAL_INVALIDATED');
    }
    const approvalId = `tg-approval-${preview.previewId.slice(-8)}${preview.revision
      .toString(16)
      .padStart(4, '0')}${preview.binding.contentHash.slice(0, 4)}`;
    const approval = { approvalId, previewId: preview.previewId, binding: parsed.data.binding };
    approvals.set(approvalId, { result: approval, revision: preview.revision });
    audit.push({ ...auditTrace(trace), type: 'telegram.approved', occurredAt: options.clock.now().toISOString(), previewId: preview.previewId, approvalId });
    recordSnapshot();
    return approval;
  };

  const enqueueLocal = async (raw: TelegramEnqueueRequest): Promise<TelegramQueueResult> => {
    const parsed = telegramEnqueuePayloadSchema.safeParse({
      previewId: raw.previewId,
      approvalId: raw.approvalId,
      binding: raw.binding,
    });
    if (!parsed.success) throw new Error('TELEGRAM_ENQUEUE_INVALID');
    if (
      !/^[A-Za-z0-9._:-]{1,128}$/.test(raw.operationId) ||
      raw.idempotencyKey.length < 16 ||
      raw.idempotencyKey.length > 128 ||
      !/^[A-Za-z0-9._:-]+$/.test(raw.idempotencyKey)
    ) {
      throw new Error('TELEGRAM_ENQUEUE_INVALID');
    }
    const payloadHash = await sha256(parsed.data);
    return runtimeStore.runOperation({
      operationId: raw.operationId, idempotencyKey: raw.idempotencyKey, payloadHash,
      execute: async () => {
        const preview = messages.get(parsed.data.previewId);
        const approval = approvals.get(parsed.data.approvalId);
        if (!preview || !approval || approval.result.previewId !== preview.previewId) throw new Error('TELEGRAM_APPROVAL_REQUIRED');
        if (
          unknownPreviewIds.has(preview.previewId) ||
          unknownApprovals.has(approval.result.approvalId)
        ) {
          throw new Error('RECONCILIATION_REQUIRED');
        }
        if (approval.revision !== preview.revision || !approvalStillMatches(preview.binding, parsed.data.binding) || !approvalStillMatches(approval.result.binding, parsed.data.binding) || parsed.data.binding.expectedStateVersion !== preview.queueStateVersion) {
          throw new Error('APPROVAL_INVALIDATED');
        }
        const currentSession = sessionState(evidence, options.clock.now());
        if (currentSession === 'stale') throw new Error('TELEGRAM_SESSION_STALE');
        if (currentSession === 'degraded') throw new Error('TELEGRAM_SESSION_DEGRADED');
        if (approvalsInFlight.has(approval.result.approvalId)) {
          throw new Error('TELEGRAM_APPROVAL_IN_FLIGHT');
        }
        if (activeAdapterOperations >= inputLimits.maxConcurrentOperations) {
          throw new Error('TELEGRAM_CONCURRENCY_LIMIT');
        }
        approvalsInFlight.add(approval.result.approvalId);
        activeAdapterOperations += 1;
        try {
          const signal = raw.signal ?? new AbortController().signal;
          const recordUnknown = (queueReceipt: string) => {
            unknownApprovals.add(approval.result.approvalId);
            unknownPreviewIds.add(preview.previewId);
            pendingUnknownByKey.set(raw.idempotencyKey, {
              previewId: preview.previewId,
              approvalId: approval.result.approvalId,
            });
            audit.push({
              correlationId: raw.correlationId ?? 'local-direct',
              operationId: raw.operationId,
              type: 'telegram.enqueue-unknown',
              occurredAt: options.clock.now().toISOString(),
              outcome: 'unknown',
            });
            return {
              outcome: 'unknown' as const,
              value: { queueReceipt },
            };
          };
          if (signal.aborted) return recordUnknown('reconciliation-required');
          let adapterOutput: Awaited<ReturnType<FakeTelegramAdapter['enqueue']>>;
          try {
            adapterOutput = await options.fakeAdapter.enqueue({ mode: 'fake-local', renderedMessage: preview.renderedMessage, targetCount: preview.targetCount, signal });
          } catch (error: unknown) {
            if (signal.aborted) return recordUnknown('reconciliation-required');
            throw error;
          }
          if (signal.aborted) return recordUnknown('reconciliation-required');
          const parsedOutput = telegramFakeAdapterResultSchema.safeParse(adapterOutput);
          if (!parsedOutput.success) throw new Error('TELEGRAM_FAKE_ADAPTER_RESULT_INVALID');
          const result = parsedOutput.data;
          if (result.outcome === 'unknown') return recordUnknown(result.queueReceipt);
          queueCount += 1;
          stateVersion += 1;
          messages.set(preview.previewId, {
            ...preview,
            queueStateVersion: preview.queueStateVersion + 1,
          });
          audit.push({ correlationId: raw.correlationId ?? 'local-direct', type: 'telegram.queued', occurredAt: options.clock.now().toISOString(), operationId: raw.operationId, outcome: result.outcome });
          recordSnapshot();
          return { outcome: result.outcome, value: { queueReceipt: result.queueReceipt } };
        } finally {
          approvalsInFlight.delete(approval.result.approvalId);
          activeAdapterOperations -= 1;
        }
      },
    });
  };

  const reconcileQueue = (input: { idempotencyKey: string; outcome: Exclude<OperationOutcome, 'unknown'>; queueReceipt: string; operationId?: string; correlationId?: string }): TelegramQueueResult => {
    if (
      input.idempotencyKey.length < 16 ||
      input.idempotencyKey.length > 128 ||
      !/^[A-Za-z0-9._:-]+$/.test(input.idempotencyKey) ||
      input.queueReceipt.length < 1 ||
      input.queueReceipt.length > 128
    ) {
      throw new Error('TELEGRAM_RECONCILIATION_INVALID');
    }
    const pending = pendingUnknownByKey.get(input.idempotencyKey);
    if (!pending) throw new Error('NO_UNKNOWN_OUTCOME');
    const result = runtimeStore.reconcile({ idempotencyKey: input.idempotencyKey, outcome: input.outcome, value: { queueReceipt: input.queueReceipt } });
    const preview = messages.get(pending.previewId);
    if (input.outcome === 'success' && preview) {
      queueCount += 1;
      stateVersion += 1;
      messages.set(preview.previewId, {
        ...preview,
        queueStateVersion: preview.queueStateVersion + 1,
      });
    }
    approvals.delete(pending.approvalId);
    unknownApprovals.delete(pending.approvalId);
    unknownPreviewIds.delete(pending.previewId);
    pendingUnknownByKey.delete(input.idempotencyKey);
    audit.push({ type: 'telegram.reconciled', occurredAt: options.clock.now().toISOString(), operationId: input.operationId ?? 'local-direct', correlationId: input.correlationId ?? 'local-direct', outcome: input.outcome });
    recordSnapshot();
    return result;
  };

  const registrations = [
    {
      operation: 'telegram.previewImport', roles: ['operator'] as const,
      payloadSchema: telegramPreviewImportPayloadSchema, resultSchema: telegramTargetPreviewResultSchema,
      handler: async (payload: TelegramPreviewImportPayload, context: BridgeHandlerContext) =>
        runBridgeMutation({ idempotencyKey: context.idempotencyKey, operation: context.operation, payload, execute: () => previewImport(payload, context) }),
    },
    {
      operation: 'telegram.createMessage', roles: ['operator'] as const,
      payloadSchema: telegramCreateMessagePayloadSchema, resultSchema: telegramPreviewResultSchema,
      handler: async (payload: TelegramCreateMessagePayload, context: BridgeHandlerContext) =>
        runBridgeMutation({ idempotencyKey: context.idempotencyKey, operation: context.operation, payload, execute: () => createMessage(payload, context) }),
    },
    {
      operation: 'telegram.reviseMessage', roles: ['operator'] as const,
      payloadSchema: telegramReviseMessagePayloadSchema, resultSchema: telegramPreviewResultSchema,
      handler: async (payload: TelegramReviseMessagePayload, context: BridgeHandlerContext) =>
        runBridgeMutation({ idempotencyKey: context.idempotencyKey, operation: context.operation, payload, execute: () => reviseMessage(payload, context) }),
    },
    {
      operation: 'telegram.approveMessage', roles: ['approver'] as const,
      payloadSchema: telegramApprovePayloadSchema, resultSchema: telegramApprovalResultSchema,
      handler: async (payload: TelegramApprovePayload, context: BridgeHandlerContext) =>
        runBridgeMutation({ idempotencyKey: context.idempotencyKey, operation: context.operation, payload, execute: () => approveMessage(payload, context) }),
    },
    {
      operation: 'telegram.enqueueLocal',
      roles: ['operator', 'approver'] as const,
      payloadSchema: telegramEnqueuePayloadSchema,
      resultSchema: telegramQueueResultSchema,
      handler: async (payload: TelegramEnqueuePayload, context: BridgeHandlerContext) => {
        if (!context.idempotencyKey) throw new Error('TELEGRAM_IDEMPOTENCY_KEY_REQUIRED');
        return enqueueLocal({
          ...payload,
          operationId: context.operationId,
          idempotencyKey: context.idempotencyKey,
          correlationId: context.correlationId,
          signal: context.signal,
        });
      },
    },
    {
      operation: 'telegram.reconcile',
      roles: ['operator', 'approver'] as const,
      payloadSchema: telegramReconcilePayloadSchema,
      resultSchema: telegramQueueResultSchema,
      handler: async (payload: TelegramReconcilePayload, context: BridgeHandlerContext) =>
        runBridgeMutation({
          idempotencyKey: context.idempotencyKey,
          operation: context.operation,
          payload,
          execute: () =>
            reconcileQueue({
              idempotencyKey: payload.targetIdempotencyKey,
              outcome: payload.outcome,
              queueReceipt: payload.queueReceipt,
              operationId: context.operationId,
              correlationId: context.correlationId,
            }),
        }),
    },
  ] satisfies readonly TelegramBridgeRegistration[];

  const snapshotModule: OutreachSnapshotModule<TelegramSnapshot> = { moduleId: 'telegram', schemaVersion: 1, schema: telegramSnapshotSchema, readSnapshot: async () => snapshot() };
  const operationModule: OutreachOperationModule = {
    moduleId: 'telegram', definitions: new Set(registrations.map(({ operation }) => operation)),
    createHandlers: () => new Map(registrations.map((registration) => [registration.operation, registration.handler])),
  };

  return { previewImport, createMessage, reviseMessage, approveMessage, enqueueLocal, reconcileQueue, readSnapshot: snapshot, readAudit: () => audit.map((event) => ({ ...event })), registrations, snapshotModule, operationModule };
}
