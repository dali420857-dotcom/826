import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createGuardedRuntimeLauncher } from '../src/runtime-entry/index.ts';

function parsePort(value: string | undefined): number {
  if (value === undefined) return 0;
  if (!/^\d{1,5}$/.test(value)) throw new Error('RUNTIME_PORT_INVALID');
  const port = Number(value);
  if (port < 0 || port > 65_535) throw new Error('RUNTIME_PORT_INVALID');
  return port;
}

function assertMonitoringOnlyEnvironment(): void {
  if (
    (process.env.DALI_RUNTIME_MODE !== undefined &&
      process.env.DALI_RUNTIME_MODE !== 'monitoring-only') ||
    Boolean(process.env.DALI_PROVIDER_ADAPTERS?.trim()) ||
    (process.env.DALI_LIVE_SEND !== undefined && process.env.DALI_LIVE_SEND !== 'false')
  ) {
    throw new Error('RUNTIME_MONITORING_ONLY_REQUIRED');
  }
}

function resolveDataStorePath(value: string | undefined): string {
  const configured = value?.trim();
  if (configured) return resolve(configured);
  const localDataRoot = process.env.LOCALAPPDATA?.trim() || process.cwd();
  return join(localDataRoot, 'DaliOutreach', 'data-work-items.sqlite');
}

async function main(): Promise<void> {
  assertMonitoringOnlyEnvironment();
  const processCapability =
    process.env.DALI_PROCESS_CAPABILITY ?? randomBytes(32).toString('hex');
  const launcher = createGuardedRuntimeLauncher({
    mode: 'monitoring-only',
    providerAdapters: [],
    liveSend: false,
    processCapability,
    allowedOrigin: process.env.DALI_RUNTIME_ORIGIN ?? 'http://127.0.0.1:5173',
    dataStorePath: resolveDataStorePath(process.env.DALI_DATA_STORE_PATH),
  });
  const running = await launcher.start(parsePort(process.env.DALI_RUNTIME_PORT));
  process.stdout.write(
    `${JSON.stringify({
      status: 'ready',
      mode: 'monitoring-only',
      endpoint: running.endpoint,
      modules: launcher.runtime.descriptor.modules,
      outboundNetwork: launcher.runtime.descriptor.outboundNetwork,
    })}\n`,
  );

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await running.close();
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}

main().catch(() => {
  process.stderr.write('DALI_RUNTIME_START_FAILED\n');
  process.exitCode = 1;
});
