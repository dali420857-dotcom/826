import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/App';
import {
  createBridgeBackedComposition,
} from '../../src/composition/bridge-backed-clients';
import { ComposedOutreachApp } from '../../src/composition/ComposedOutreachApp';
import { createDaliOutreachRuntime } from '../../src/runtime-entry';

const capability = 'runtime-ui-integration-capability-0001';
const origin = 'http://127.0.0.1:5173';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '#/overview');
  delete window.__DALI_OUTREACH_BOOTSTRAP__;
});

function createHarness() {
  const runtime = createDaliOutreachRuntime({
    mode: 'monitoring-only',
    providerAdapters: [],
    liveSend: false,
    processCapability: capability,
    allowedOrigin: origin,
    clock: { now: () => new Date('2026-08-17T12:00:00.000Z') },
  });
  const mutationBridge = runtime.createMutationBridgePort('127.0.0.1:4317');
  const composition = createBridgeBackedComposition(mutationBridge, runtime.snapshotControl);
  return { runtime, composition, mutationBridge };
}

describe('bridge-backed rendered workflows', () => {
  it('routes the Data client through the same local bridge contract', async () => {
    const { runtime, composition } = createHarness();
    const preview = await composition.dataClient.previewImport({
      source: {
        kind: 'inline',
        name: 'bridge-data.csv',
        content: 'customerRef,email,displayName,company\nbridge-customer,bridge@bridge.example.test,Bridge,Fixture',
      },
    });
    const imported = await composition.dataClient.importBatch(preview.previewId);
    const listed = await composition.dataClient.listWorkItems({ page: 1, pageSize: 20 });
    expect(listed.items).toHaveLength(1);
    const item = listed.items[0]!;
    await composition.dataClient.updateWorkItem({
      workItemId: item.workItemId,
      expectedVersion: item.version,
      status: 'in_progress',
    });
    expect(imported.items[0]?.workItemId).toBe(item.workItemId);
    expect(runtime.data.readAudit().map(({ type }) => type)).toEqual([
      'data.import.previewed',
      'data.batch.imported',
      'data.work-item.updated',
    ]);
  });

  it('routes pause through the separate control port and replays one stable domain intent', async () => {
    const { runtime, composition } = createHarness();
    await composition.emailClient.pause();
    expect(await runtime.snapshotControl.readSnapshot()).toMatchObject({
      email: { status: { paused: true } },
    });
    await expect(composition.emailClient.previewImport({
      source: {
        kind: 'inline',
        name: 'paused.csv',
        content: 'email,firstName,company\nada@paused.example.test,Ada,Paused',
      },
    })).rejects.toThrow('INTERNAL_ERROR');
    await composition.emailClient.resume();

    const intent = {
      source: {
        kind: 'inline' as const,
        name: 'stable.csv',
        content: 'email,firstName,company\nada@stable.example.test,Ada,Stable',
      },
    };
    const first = await composition.emailClient.previewImport(intent);
    const replay = await composition.emailClient.previewImport(intent);
    expect(replay).toEqual(first);
    expect(runtime.email.readAudit().filter(({ type }) => type === 'email.import.previewed')).toHaveLength(1);
  });

  it('keeps activation off by default and consumes injected opaque ports without exposing capability', async () => {
    const { runtime, mutationBridge } = createHarness();
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Dali Outreach 尚未啟用' })).toBeInTheDocument();
    cleanup();

    const bootstrap = {
      mode: 'bridge' as const,
      mutationBridge,
      snapshotControl: runtime.snapshotControl,
    };
    expect(JSON.stringify(bootstrap)).not.toContain(capability);
    expect(JSON.stringify(bootstrap)).not.toContain('/bridge');
    window.__DALI_OUTREACH_BOOTSTRAP__ = bootstrap;
    window.history.replaceState(null, '', '#/email');
    render(<App />);

    const importButton = await screen.findByRole('button', { name: '載入合成聯絡人' });
    await waitFor(() => expect(importButton).toBeEnabled());
    importButton.click();
    await waitFor(() => expect(runtime.email.readAudit()).toHaveLength(1));
    expect(document.body.textContent).not.toContain(capability);
    expect(document.documentElement.innerHTML).not.toContain('/bridge');
  });

  it('renders the Data workbench through the local bridge without exposing raw contact data', async () => {
    const { runtime, composition } = createHarness();
    window.history.replaceState(null, '', '#/overview');
    render(<ComposedOutreachApp {...composition} />);

    const importButton = await screen.findByRole('button', { name: '導入合成資料' });
    await waitFor(() => expect(importButton).toBeEnabled());
    importButton.click();
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    await waitFor(() => expect(runtime.data.readAudit()).toHaveLength(2));
    expect(document.body.textContent).not.toContain('ada@alpha.example.test');
    expect(document.body.textContent).toContain('a***@alpha.example.test');
  });

  it('renders and clicks a complete Email no-send flow through dispatcher to queue readback', async () => {
    const { runtime, composition } = createHarness();
    window.history.replaceState(null, '', '#/email');
    render(<ComposedOutreachApp {...composition} />);

    const importButton = await screen.findByRole('button', { name: '載入合成聯絡人' });
    await waitFor(() => expect(importButton).toBeEnabled());
    importButton.click();
    await waitFor(() => expect(screen.getByRole('button', { name: '建立本機草稿' })).toBeEnabled());
    screen.getByRole('button', { name: '建立本機草稿' }).click();
    await waitFor(() => expect(screen.getByRole('button', { name: '批准目前版本' })).toBeEnabled());
    screen.getByRole('button', { name: '批准目前版本' }).click();
    await waitFor(() => expect(screen.getByRole('button', { name: '加入本機佇列' })).toBeEnabled());
    screen.getByRole('button', { name: '加入本機佇列' }).click();

    await waitFor(() => expect(screen.getAllByText('成功 · queued-local')).toHaveLength(2));
    expect(runtime.email.readQueue()).toHaveLength(1);
    expect(runtime.email.readAudit().map(({ type }) => type)).toEqual([
      'email.import.previewed',
      'email.draft.created',
      'email.draft.approved',
      'email.queue.completed',
    ]);
    expect(runtime.readSecurityEvents().some(({ operation }) => operation === 'email.enqueueLocal')).toBe(true);
  });

  it('renders and clicks a complete Telegram no-send flow through dispatcher to backend readback', async () => {
    const { runtime, composition } = createHarness();
    window.history.replaceState(null, '', '#/telegram');
    render(<ComposedOutreachApp {...composition} />);

    const targetsButton = await screen.findByRole('button', { name: '預覽合成目標' });
    await waitFor(() => expect(targetsButton).toBeEnabled());
    targetsButton.click();
    await waitFor(() => expect(screen.getByRole('button', { name: '建立訊息預覽' })).toBeEnabled());
    screen.getByRole('button', { name: '建立訊息預覽' }).click();
    await waitFor(() => expect(screen.getByRole('button', { name: '批准目前內容' })).toBeEnabled());
    screen.getByRole('button', { name: '批准目前內容' }).click();
    await waitFor(() => expect(screen.getByRole('button', { name: '加入本機佇列' })).toBeEnabled());
    screen.getByRole('button', { name: '加入本機佇列' }).click();

    await waitFor(() => expect(screen.getByText('本機佇列已接受；沒有發送真實訊息。')).toBeInTheDocument());
    expect(runtime.telegram.readSnapshot()).toMatchObject({
      providerAccess: false,
      queueCount: 1,
    });
    expect(runtime.telegram.readAudit().map(({ type }) => type)).toEqual([
      'telegram.targets-previewed',
      'telegram.message-created',
      'telegram.approved',
      'telegram.queued',
    ]);
    expect(runtime.readSecurityEvents().some(({ operation }) => operation === 'telegram.enqueueLocal')).toBe(true);
  });
});
