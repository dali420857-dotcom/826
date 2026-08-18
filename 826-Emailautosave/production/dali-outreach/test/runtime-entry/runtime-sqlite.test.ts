import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDaliOutreachRuntime,
  createGuardedRuntimeLauncher,
} from '../../src/runtime-entry';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const baseOptions = {
  mode: 'monitoring-only' as const,
  providerAdapters: [] as const,
  liveSend: false as const,
  processCapability: 'runtime-sqlite-test-capability-0001',
  allowedOrigin: 'http://127.0.0.1:5173',
  clock: { now: () => new Date('2026-08-17T12:00:00.000Z') },
};

const csv = [
  'customerRef,email,displayName,company',
  'runtime-sqlite,fixture@runtime.example.test,SQLite Fixture,Local Store',
].join('\n');

describe('Runtime SQLite wiring', () => {
  it('persists the data module through dataStorePath and releases it on runtime close', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dali-runtime-'));
    temporaryDirectories.push(directory);
    const filename = join(directory, 'runtime-data.sqlite');

    const firstRuntime = createDaliOutreachRuntime({
      ...baseOptions,
      dataStorePath: filename,
    });
    const preview = firstRuntime.data.previewImport({
      source: { kind: 'inline', name: 'runtime-data.csv', content: csv },
    });
    const imported = firstRuntime.data.importBatch({ previewId: preview.previewId });
    firstRuntime.close();

    const secondRuntime = createDaliOutreachRuntime({
      ...baseOptions,
      dataStorePath: filename,
    });
    expect(secondRuntime.data.listWorkItems({ page: 1, pageSize: 20 })).toMatchObject({
      items: [{ workItemId: imported.items[0]?.workItemId, customer: { maskedEmail: 'f***@runtime.example.test' } }],
      pagination: { totalItems: 1 },
    });
    secondRuntime.close();
  });

  it('releases the SQLite store when the guarded launcher closes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dali-launcher-'));
    temporaryDirectories.push(directory);
    const filename = join(directory, 'launcher-data.sqlite');
    const launcher = createGuardedRuntimeLauncher({
      ...baseOptions,
      dataStorePath: filename,
    });

    const running = await launcher.start(0);
    await running.close();
    expect(launcher.state()).toBe('closed');

    const reopened = createDaliOutreachRuntime({
      ...baseOptions,
      dataStorePath: filename,
    });
    reopened.close();
  });

  it('rejects non-local or in-memory data store paths when SQLite is requested', () => {
    expect(() =>
      createDaliOutreachRuntime({
        ...baseOptions,
        dataStorePath: 'https://example.test/runtime-data.sqlite',
      }),
    ).toThrow('RUNTIME_DATA_STORE_PATH_INVALID');
    expect(() =>
      createDaliOutreachRuntime({
        ...baseOptions,
        dataStorePath: ':memory:',
      }),
    ).toThrow('RUNTIME_DATA_STORE_PATH_INVALID');
  });
});
