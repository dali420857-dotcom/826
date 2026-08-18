import { z } from 'zod';
import { bridgeEnvelopeSchema, type BridgeEnvelope, type BridgeRequest, type OperationName } from '../contracts';
import {
  approvalResultSchema,
  draftViewSchema,
  emailQueueItemSchema,
  enqueueResultSchema,
  importPreviewSchema,
} from '../modules/email/schemas';
import type {
  EmailDraftView,
  EmailUiClient,
  EmailUiStatus,
  SyntheticEmailOutcome,
} from '../modules/email/ui';
import {
  telegramApprovalResultSchema,
  telegramPreviewResultSchema,
  telegramQueueResultSchema,
  telegramSnapshotSchema,
  telegramTargetPreviewResultSchema,
} from '../modules/telegram';
import type {
  TelegramUiAuditEvent,
  TelegramUiClient,
  TelegramUiSnapshot,
} from '../modules/telegram/ui';
import {
  dataAuditResultSchema,
  dataImportBatchResultSchema,
  dataPreviewSchema,
  listWorkItemsResultSchema,
  workItemSchema,
} from '../modules/data';
import type { DataUiClient } from '../modules/data';

const safeId = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const runtimeModuleIdSchema = z.enum(['email', 'telegram', 'all']);
const emailStatusSchema = z.object({
  paused: z.boolean(),
  syntheticOutcome: z.enum(['success', 'failure', 'unknown']),
}).strict();
const emailAuditEventSchema = z.object({
  sequence: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  type: z.enum([
    'email.import.previewed',
    'email.draft.created',
    'email.draft.revised',
    'email.draft.approved',
    'email.queue.completed',
    'email.queue.reconciled',
  ]),
  count: z.number().int().nonnegative().optional(),
  draftId: safeId.optional(),
  operationId: safeId.optional(),
  correlationId: safeId.optional(),
  outcome: z.enum(['success', 'failure', 'unknown']).optional(),
}).strict();
const telegramUiAuditEventSchema = z.object({
  type: z.enum([
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
  ]),
  outcome: z.enum(['success', 'failure', 'unknown']).optional(),
}).strict();
const telegramUiSnapshotSchema = telegramSnapshotSchema.pick({
  maskedAccount: true,
  sessionState: true,
  providerAccess: true,
}).extend({
  paused: z.boolean(),
  reconciliationRequired: z.boolean(),
}).strict();

export const runtimeReadSnapshotPayloadSchema = z.object({
  emailDraftId: safeId.optional(),
}).strict();

export const runtimeModuleControlPayloadSchema = z.object({
  moduleId: runtimeModuleIdSchema,
}).strict();

export const runtimeReadbackSchema = z.object({
  mode: z.literal('monitoring-only'),
  source: z.literal('synthetic-fixture'),
  providerAccess: z.literal(false),
  email: z.object({
    status: emailStatusSchema,
    audit: z.array(emailAuditEventSchema),
    queue: z.array(emailQueueItemSchema),
    draft: draftViewSchema.optional(),
  }).strict(),
  telegram: z.object({
    snapshot: telegramUiSnapshotSchema,
    audit: z.array(telegramUiAuditEventSchema),
  }).strict(),
}).strict();

export type RuntimeReadback = z.infer<typeof runtimeReadbackSchema>;
export type RuntimeModuleId = z.infer<typeof runtimeModuleIdSchema>;
type DomainOperation = Exclude<OperationName, `runtime.${string}`>;

export type RuntimeBridgeRequest = Omit<
  BridgeRequest,
  'schemaVersion' | 'correlationId' | 'operationId' | 'operation'
> & { readonly operation: DomainOperation };

export interface RuntimeSnapshotControl {
  readSnapshot(emailDraftId?: string): Promise<RuntimeReadback>;
  pause(
    moduleId: RuntimeModuleId,
    idempotencyKey: string,
  ): Promise<RuntimeReadback>;
  resume(
    moduleId: RuntimeModuleId,
    idempotencyKey: string,
  ): Promise<RuntimeReadback>;
}

export interface RuntimeBridgeExecutor {
  request<Result>(
    request: RuntimeBridgeRequest,
    resultSchema: z.ZodType<Result>,
  ): Promise<BridgeEnvelope<Result>>;
}

const resultSchemas: Partial<Record<OperationName, z.ZodType>> = {
  'email.previewImport': importPreviewSchema,
  'email.createDraft': draftViewSchema,
  'email.reviseDraft': draftViewSchema,
  'email.approveDraft': approvalResultSchema,
  'email.enqueueLocal': enqueueResultSchema,
  'email.reconcile': enqueueResultSchema,
  'telegram.previewImport': telegramTargetPreviewResultSchema,
  'telegram.createMessage': telegramPreviewResultSchema,
  'telegram.reviseMessage': telegramPreviewResultSchema,
  'telegram.approveMessage': telegramApprovalResultSchema,
  'telegram.enqueueLocal': telegramQueueResultSchema,
  'telegram.reconcile': telegramQueueResultSchema,
  'data.previewImport': dataPreviewSchema,
  'data.importBatch': dataImportBatchResultSchema,
  'data.listWorkItems': listWorkItemsResultSchema,
  'data.updateWorkItem': workItemSchema,
  'data.readAudit': dataAuditResultSchema,
};

function assertBridgeEndpoint(endpoint: string): URL {
  const url = new URL(endpoint);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/bridge' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('BRIDGE_LOOPBACK_ENDPOINT_REQUIRED');
  }
  return url;
}

export function createHttpRuntimeBridgeExecutor(options: {
  readonly endpoint: string;
  readonly processCapability: string;
  readonly timeoutMs?: number;
}): RuntimeBridgeExecutor {
  const endpoint = assertBridgeEndpoint(options.endpoint).toString();
  if (!/^[A-Za-z0-9._:-]{16,256}$/.test(options.processCapability)) {
    throw new Error('BRIDGE_PROCESS_CAPABILITY_REQUIRED');
  }
  const timeoutMs = options.timeoutMs ?? 250;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000) {
    throw new Error('BRIDGE_CLIENT_TIMEOUT_INVALID');
  }
  let sequence = 0;
  return {
    async request<Result>(request: RuntimeBridgeRequest, resultSchema: z.ZodType<Result>) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      sequence += 1;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: {
            'content-type': 'application/json',
            'x-dali-process-capability': options.processCapability,
          },
          body: JSON.stringify({
            schemaVersion: 1,
            correlationId: `ui-correlation-${sequence}`,
            operationId: `ui-operation-${sequence}`,
            ...request,
          }),
          signal: controller.signal,
        });
        const raw: unknown = await response.json();
        return bridgeEnvelopeSchema(resultSchema).parse(raw);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function stableIntentKey(operation: string, payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(`${operation}:${stableJson(payload)}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `ui-intent-${hash.slice(0, 48)}`;
}

async function execute<Result>(
  executor: RuntimeBridgeExecutor,
  operation: DomainOperation,
  role: 'viewer' | 'operator' | 'approver',
  payload: Record<string, unknown>,
  mutation = false,
): Promise<Result> {
  const resultSchema = resultSchemas[operation] as z.ZodType<Result> | undefined;
  if (!resultSchema) throw new Error('BRIDGE_OPERATION_NOT_INSTALLED');
  const envelope = await executor.request(
    {
      operation,
      role,
      payload,
      ...(mutation ? { idempotencyKey: await stableIntentKey(operation, payload) } : {}),
    },
    resultSchema,
  );
  if (envelope.status === 'error') throw new Error(envelope.error.code);
  return envelope.data;
}

export function createBridgeBackedComposition(
  executor: RuntimeBridgeExecutor,
  snapshotControl: RuntimeSnapshotControl,
): {
  readonly dataClient: DataUiClient;
  readonly emailClient: EmailUiClient;
  readonly telegramClient: TelegramUiClient;
} {
  let emailStatus: EmailUiStatus = { paused: false, syntheticOutcome: 'success' };
  let pendingTelegramReconciliationKey: string | undefined;
  const controlIntentVersions = { email: 0, telegram: 0 };
  const readback = async (emailDraftId?: string) => runtimeReadbackSchema.parse(
    await snapshotControl.readSnapshot(emailDraftId),
  );
  const control = async (moduleId: 'email' | 'telegram', paused: boolean) => {
    const idempotencyKey = await stableIntentKey(
      paused ? 'runtime.pause' : 'runtime.resume',
      { moduleId, intentVersion: controlIntentVersions[moduleId] },
    );
    const result = runtimeReadbackSchema.parse(
      await (paused
        ? snapshotControl.pause(moduleId, idempotencyKey)
        : snapshotControl.resume(moduleId, idempotencyKey)),
    );
    controlIntentVersions[moduleId] += 1;
    return result;
  };

  const emailClient: EmailUiClient = {
    getStatus: async () => {
      emailStatus = (await readback()).email.status;
      return emailStatus;
    },
    pause: async () => {
      emailStatus = (await control('email', true)).email.status;
      return emailStatus;
    },
    resume: async () => {
      emailStatus = (await control('email', false)).email.status;
      return emailStatus;
    },
    setSyntheticOutcome: async (outcome: SyntheticEmailOutcome) => {
      if (outcome !== 'success') throw new Error('BRIDGE_SYNTHETIC_OUTCOME_LOCKED');
      emailStatus = { ...emailStatus, syntheticOutcome: 'success' };
      return emailStatus;
    },
    previewImport: (payload) => execute(executor, 'email.previewImport', 'operator', payload, true),
    createDraft: (payload) => execute(executor, 'email.createDraft', 'operator', payload, true),
    reviseDraft: (payload) => execute(executor, 'email.reviseDraft', 'operator', payload, true),
    approveDraft: async (payload) => {
      await execute(executor, 'email.approveDraft', 'approver', payload, true);
      const draft = (await readback(payload.draftId)).email.draft;
      if (!draft) throw new Error('EMAIL_DRAFT_READBACK_REQUIRED');
      return draft;
    },
    enqueueLocal: async (draftId) => {
      const payload = { draftId };
      const targetIdempotencyKey = await stableIntentKey('email.enqueueLocal', payload);
      const result = await execute<z.infer<typeof enqueueResultSchema>>(
        executor,
        'email.enqueueLocal',
        'operator',
        payload,
        true,
      );
      return { targetIdempotencyKey, result };
    },
    reconcile: (targetIdempotencyKey, outcome) => execute(
      executor,
      'email.reconcile',
      'operator',
      { targetIdempotencyKey, outcome },
      true,
    ),
    readDraft: async (draftId): Promise<EmailDraftView | undefined> =>
      (await readback(draftId)).email.draft,
    readAudit: async () => (await readback()).email.audit,
    readQueue: async () => (await readback()).email.queue,
  };

  const telegramClient: TelegramUiClient = {
    readSnapshot: async () => (await readback()).telegram.snapshot,
    readAudit: async () => (await readback()).telegram.audit,
    previewTargets: (payload) => execute(executor, 'telegram.previewImport', 'operator', payload, true),
    createMessage: (payload) => execute(executor, 'telegram.createMessage', 'operator', payload, true),
    reviseMessage: (payload) => execute(executor, 'telegram.reviseMessage', 'operator', payload, true),
    approveMessage: (payload) => execute(executor, 'telegram.approveMessage', 'approver', payload, true),
    enqueueLocal: async (payload) => {
      pendingTelegramReconciliationKey = await stableIntentKey('telegram.enqueueLocal', payload);
      const result = await execute<z.infer<typeof telegramQueueResultSchema>>(
        executor,
        'telegram.enqueueLocal',
        'operator',
        payload,
        true,
      );
      if (result.outcome !== 'unknown') pendingTelegramReconciliationKey = undefined;
      return result;
    },
    reconcile: async (outcome) => {
      if (!pendingTelegramReconciliationKey) throw new Error('RECONCILIATION_REQUIRED');
      const targetIdempotencyKey = pendingTelegramReconciliationKey;
      const result = await execute<z.infer<typeof telegramQueueResultSchema>>(
        executor,
        'telegram.reconcile',
        'operator',
        { targetIdempotencyKey, outcome, queueReceipt: `ui-reconciled-${outcome}` },
        true,
      );
      pendingTelegramReconciliationKey = undefined;
      return result;
    },
    pause: async (): Promise<TelegramUiSnapshot> => (await control('telegram', true)).telegram.snapshot,
    resume: async (): Promise<TelegramUiSnapshot> => (await control('telegram', false)).telegram.snapshot,
  };

  const dataClient: DataUiClient = {
    previewImport: (payload) => execute(executor, 'data.previewImport', 'operator', payload, true),
    importBatch: (previewId) => execute(
      executor,
      'data.importBatch',
      'operator',
      { previewId },
      true,
    ),
    listWorkItems: (input = {}) => execute(
      executor,
      'data.listWorkItems',
      'viewer',
      { page: 1, pageSize: 20, ...input },
    ),
    updateWorkItem: (payload) => execute(
      executor,
      'data.updateWorkItem',
      'operator',
      payload,
      true,
    ),
    readAudit: () => execute(executor, 'data.readAudit', 'viewer', {}),
  };

  return { dataClient, emailClient, telegramClient };
}
