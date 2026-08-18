import { Socket } from 'node:net';
import type { ZodType } from 'zod';
import {
  createBridgeDispatcher,
  createBridgeTransport,
  type BridgeOperationRegistration,
  type BridgeSecurityEvent,
} from '../bridge';
import {
  type RuntimeReadback,
  type RuntimeBridgeExecutor,
  type RuntimeBridgeRequest,
  type RuntimeSnapshotControl,
} from '../composition/bridge-backed-clients';
import { bridgeEnvelopeSchema } from '../contracts';
import {
  createLoopbackBridgeServer,
  type RunningLoopbackBridgeServer,
} from '../bridge/loopback-server';
import {
  createEmailBridgeRegistrations,
  createEmailOutreachModule,
} from '../modules/email';
import {
  createDataBridgeRegistrations,
  createDataWorkItemModule,
} from '../modules/data';
import { createSQLiteDataWorkItemRepository } from '../modules/data/sqlite-repository';
import {
  createTelegramBackend,
  type FakeTelegramAdapter,
} from '../modules/telegram';
import type { Clock } from '../runtime-core';

type AnyRegistration = BridgeOperationRegistration<any, any, any>;

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);

export interface MonitoringRuntimeOptions {
  readonly mode: 'monitoring-only';
  readonly providerAdapters: readonly [];
  readonly liveSend: false;
  readonly processCapability: string;
  readonly allowedOrigin: string;
  /** Optional local SQLite file. Omitted means an in-memory test store. */
  readonly dataStorePath?: string;
  readonly clock?: Clock;
}

export interface ProcessNoEgressGuard {
  readonly state: 'installed';
  restore(): void;
}

export interface RunningGuardedRuntime extends RunningLoopbackBridgeServer {
  close(): Promise<void>;
}

export interface GuardedRuntimeLauncher {
  readonly runtime: ReturnType<typeof createDaliOutreachRuntime>;
  state(): 'idle' | 'starting' | 'running' | 'closed';
  start(port?: number): Promise<RunningGuardedRuntime>;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function assertLoopbackHost(hostname: string): void {
  const normalized = normalizeHostname(hostname);
  if (!loopbackHosts.has(normalized)) {
    throw new Error(`NO_EGRESS_BLOCKED:${normalized || 'unknown-host'}`);
  }
}

function assertLoopbackUrl(input: RequestInfo | URL): void {
  const target = input instanceof Request ? input.url : input;
  const url = target instanceof URL ? target : new URL(String(target));
  assertLoopbackHost(url.hostname);
}

function socketHost(args: readonly unknown[]): string | undefined {
  const first = args[0];
  if (typeof first === 'number') {
    return typeof args[1] === 'string' ? args[1] : 'localhost';
  }
  if (typeof first === 'object' && first !== null && 'host' in first) {
    const host = (first as { readonly host?: unknown }).host;
    return typeof host === 'string' ? host : 'localhost';
  }
  return undefined;
}

let guardInstalled = false;

/**
 * Installs a process-wide outbound guard. It deliberately leaves server listen
 * APIs untouched while allowing only loopback clients needed by the local UI.
 */
export function installProcessNoEgressGuard(): ProcessNoEgressGuard {
  if (guardInstalled) throw new Error('NO_EGRESS_GUARD_ALREADY_INSTALLED');
  guardInstalled = true;

  const originalFetch = globalThis.fetch;
  const originalConnect = Socket.prototype.connect;
  const guardedConnect = function guardedConnect(this: Socket, ...args: unknown[]) {
    const host = socketHost(args);
    if (host !== undefined) assertLoopbackHost(host);
    return Reflect.apply(originalConnect, this, args) as Socket;
  } as typeof Socket.prototype.connect;

  if (originalFetch) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      assertLoopbackUrl(input);
      return originalFetch(input, init);
    }) as typeof globalThis.fetch;
  }
  Socket.prototype.connect = guardedConnect;

  let restored = false;
  return {
    state: 'installed',
    restore() {
      if (restored) return;
      restored = true;
      if (globalThis.fetch && originalFetch) globalThis.fetch = originalFetch;
      if (Socket.prototype.connect === guardedConnect) {
        Socket.prototype.connect = originalConnect;
      }
      guardInstalled = false;
    },
  };
}

function validateOptions(options: MonitoringRuntimeOptions): void {
  const allowedKeys = new Set([
    'mode',
    'providerAdapters',
    'liveSend',
    'processCapability',
    'allowedOrigin',
    'dataStorePath',
    'clock',
  ]);
  if (Object.keys(options as object).some((key) => !allowedKeys.has(key))) {
    throw new Error('RUNTIME_UNSUPPORTED_CONFIGURATION');
  }
  if (
    options.mode !== 'monitoring-only' ||
    !Array.isArray(options.providerAdapters) ||
    options.providerAdapters.length !== 0 ||
    options.liveSend !== false
  ) {
    throw new Error('RUNTIME_MONITORING_ONLY_REQUIRED');
  }
  if (
    typeof options.processCapability !== 'string' ||
    options.processCapability.length < 16 ||
    options.processCapability.length > 256
  ) {
    throw new Error('RUNTIME_PROCESS_CAPABILITY_REQUIRED');
  }
  let origin: URL;
  try {
    origin = new URL(options.allowedOrigin);
  } catch {
    throw new Error('RUNTIME_LOOPBACK_ORIGIN_REQUIRED');
  }
  if (
    origin.protocol !== 'http:' ||
    normalizeHostname(origin.hostname) !== '127.0.0.1' ||
    origin.username !== '' ||
    origin.password !== '' ||
    origin.pathname !== '/' ||
    origin.search !== '' ||
    origin.hash !== ''
  ) {
    throw new Error('RUNTIME_LOOPBACK_ORIGIN_REQUIRED');
  }
  if (options.dataStorePath !== undefined) {
    const path = options.dataStorePath.trim();
    if (
      path.length === 0 ||
      path.includes('\0') ||
      path === ':memory:' ||
      path.startsWith('\\\\') ||
      /^(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\//.test(path)
    ) {
      throw new Error('RUNTIME_DATA_STORE_PATH_INVALID');
    }
  }
}

export function createDaliOutreachRuntime(options: MonitoringRuntimeOptions) {
  validateOptions(options);
  const clock = options.clock ?? { now: () => new Date() };
  const createdAt = clock.now();
  const dataRepository =
    options.dataStorePath === undefined
      ? undefined
      : createSQLiteDataWorkItemRepository({ filename: options.dataStorePath.trim() });
  const data = createDataWorkItemModule({
    clock,
    ...(dataRepository ? { repository: dataRepository } : {}),
  });
  const dataRegistrations = createDataBridgeRegistrations(data);
  const email = createEmailOutreachModule({ clock, fakeOutcome: () => 'success' });
  const emailRegistrations = createEmailBridgeRegistrations(email);
  const fakeTelegramAdapter: FakeTelegramAdapter = {
    enqueue: async ({ targetCount }) => ({
      outcome: 'success',
      queueReceipt: `fake-local-${targetCount}`,
    }),
  };
  const telegram = createTelegramBackend({
    clock,
    sessionEvidence: {
      source: 'synthetic-fixture',
      maskedAccount: 'tg-***-0042',
      state: 'ready',
      observedAt: createdAt.toISOString(),
      freshUntil: new Date(createdAt.getTime() + 5 * 60_000).toISOString(),
      providerAccess: false,
    },
    fakeAdapter: fakeTelegramAdapter,
  });
  const paused = { email: false, telegram: false };
  let telegramReconciliationRequired = false;
  const telegramRuntimeAudit: Array<{ readonly type: 'telegram.paused' | 'telegram.resumed' }> = [];
  const readback = (emailDraftId?: string): RuntimeReadback => {
    const telegramAudit = telegram.readAudit();
    const emailDraft = emailDraftId ? email.readDraft(emailDraftId) : undefined;
    const telegramSnapshot = telegram.readSnapshot();
    return {
      mode: 'monitoring-only',
      source: 'synthetic-fixture',
      providerAccess: false,
      email: {
        status: { paused: paused.email, syntheticOutcome: 'success' },
        audit: email.readAudit(),
        queue: email.readQueue(),
        ...(emailDraft ? { draft: emailDraft } : {}),
      },
      telegram: {
        snapshot: {
          maskedAccount: telegramSnapshot.maskedAccount,
          sessionState: telegramSnapshot.sessionState,
          providerAccess: false,
          paused: paused.telegram,
          reconciliationRequired: telegramReconciliationRequired,
        },
        audit: [
          ...telegramAudit.map((event) => ({
            type: event.type,
            ...('outcome' in event ? { outcome: event.outcome } : {}),
          })),
          ...telegramRuntimeAudit,
        ],
      },
    };
  };
  const controlMutations = new Map<string, {
    readonly intent: string;
    readonly result: Promise<RuntimeReadback>;
  }>();
  const runtimeControl = (
    moduleId: 'email' | 'telegram' | 'all',
    nextPaused: boolean,
    idempotencyKey: string,
  ): Promise<RuntimeReadback> => {
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
      throw new Error('IDEMPOTENCY_KEY_REQUIRED');
    }
    const intent = `${moduleId}:${String(nextPaused)}`;
    const existing = controlMutations.get(idempotencyKey);
    if (existing) {
      if (existing.intent !== intent) throw new Error('IDEMPOTENCY_CONFLICT');
      return existing.result;
    }
    const result = Promise.resolve().then(() => {
      if (moduleId === 'email' || moduleId === 'all') paused.email = nextPaused;
      if (moduleId === 'telegram' || moduleId === 'all') {
        paused.telegram = nextPaused;
        telegramRuntimeAudit.push({
          type: nextPaused ? 'telegram.paused' : 'telegram.resumed',
        });
      }
      return readback();
    });
    controlMutations.set(idempotencyKey, { intent, result });
    return result;
  };
  const snapshotControl: RuntimeSnapshotControl = Object.freeze({
    readSnapshot: async (emailDraftId?: string) => readback(emailDraftId),
    pause: (moduleId: 'email' | 'telegram' | 'all', idempotencyKey: string) =>
      runtimeControl(moduleId, true, idempotencyKey),
    resume: (moduleId: 'email' | 'telegram' | 'all', idempotencyKey: string) =>
      runtimeControl(moduleId, false, idempotencyKey),
  });
  const guardRegistration = <Registration extends AnyRegistration>(
    registration: Registration,
    moduleId: 'email' | 'telegram',
  ): Registration => ({
    ...registration,
    handler: async (payload, context) => {
      if (paused[moduleId]) throw new Error('RUNTIME_PAUSED');
      const result = await registration.handler(payload, context);
      if (registration.operation === 'telegram.enqueueLocal') {
        const queueResult = result as { readonly outcome?: string };
        telegramReconciliationRequired = queueResult.outcome === 'unknown';
      }
      if (registration.operation === 'telegram.reconcile') {
        telegramReconciliationRequired = false;
      }
      return result;
    },
  }) as Registration;
  const guardedEmailRegistrations = emailRegistrations.map((registration) =>
    guardRegistration(registration, 'email'));
  const guardedTelegramRegistrations = telegram.registrations.map((registration) =>
    guardRegistration(registration, 'telegram'));
  const registrations = [
    ...dataRegistrations,
    ...guardedEmailRegistrations,
    ...guardedTelegramRegistrations,
  ] as const;
  const installedOperations = new Set(
    registrations.map(({ operation }) => operation),
  ) as ReadonlySet<(typeof registrations)[number]['operation']>;
  const securityEvents: BridgeSecurityEvent[] = [];
  const recordSecurityEvent = (event: BridgeSecurityEvent): void => {
    securityEvents.push({ ...event });
  };
  const emailReadback = Object.freeze({
    readAudit: email.readAudit,
    readQueue: email.readQueue,
  });
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    data.close();
  };

  const createInProcessBridge = (host: string) => {
    const dispatcher = createBridgeDispatcher({
      expectedHost: host,
      allowedOrigins: [options.allowedOrigin],
      processCapability: options.processCapability,
      operations: registrations,
      installedOperations,
      onSecurityEvent: recordSecurityEvent,
    });
    return {
      transport: createBridgeTransport(dispatcher),
      connection: {
        remoteAddress: '127.0.0.1',
        host,
        origin: options.allowedOrigin,
        processCapability: options.processCapability,
      } as const,
    };
  };
  const createMutationBridgePort = (host: string): RuntimeBridgeExecutor => {
    const bridge = createInProcessBridge(host);
    let sequence = 0;
    return Object.freeze({
      async request<Result>(
        request: RuntimeBridgeRequest,
        resultSchema: ZodType<Result>,
      ) {
        sequence += 1;
        const envelope = await bridge.transport.request(
          {
            schemaVersion: 1,
            correlationId: `host-correlation-${sequence}`,
            operationId: `host-operation-${sequence}`,
            ...request,
          } as never,
          bridge.connection,
        );
        return bridgeEnvelopeSchema(resultSchema).parse(envelope);
      },
    });
  };

  return Object.freeze({
    descriptor: Object.freeze({
      mode: 'monitoring-only' as const,
      modules: Object.freeze(['data', 'email', 'telegram'] as const),
      dataSource: 'synthetic-fixture' as const,
      outboundNetwork: 'blocked' as const,
    }),
    email: emailReadback,
    data,
    telegram,
    registrations,
    installedOperations: new Set(installedOperations) as ReadonlySet<
      (typeof registrations)[number]['operation']
    >,
    snapshotControl,
    close,
    createInProcessBridge,
    createMutationBridgePort,
    readSecurityEvents: () => securityEvents.map((event) => ({ ...event })),
    createServer: () =>
      createLoopbackBridgeServer({
        allowedOrigins: [options.allowedOrigin],
        processCapability: options.processCapability,
        operations: registrations,
        installedOperations,
        onSecurityEvent: recordSecurityEvent,
      }),
  });
}

export function createGuardedRuntimeLauncher(
  options: MonitoringRuntimeOptions,
): GuardedRuntimeLauncher {
  const runtime = createDaliOutreachRuntime(options);
  let launcherState: 'idle' | 'starting' | 'running' | 'closed' = 'idle';

  return {
    runtime,
    state: () => launcherState,
    async start(port = 0) {
      if (launcherState !== 'idle') throw new Error('RUNTIME_LAUNCHER_NOT_IDLE');
      launcherState = 'starting';
      const guard = installProcessNoEgressGuard();
      try {
        const server = await runtime.createServer().listen(port);
        launcherState = 'running';
        let closed = false;
        return {
          ...server,
          async close() {
            if (closed) return;
            closed = true;
            try {
              await server.close();
            } finally {
              try {
                runtime.close();
              } finally {
                guard.restore();
                launcherState = 'closed';
              }
            }
          },
        };
      } catch (error) {
        try {
          runtime.close();
        } finally {
          guard.restore();
          launcherState = 'closed';
        }
        throw error;
      }
    },
  };
}
