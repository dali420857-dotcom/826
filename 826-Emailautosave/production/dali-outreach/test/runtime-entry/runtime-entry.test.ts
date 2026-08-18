import { Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  createDaliOutreachRuntime,
  createGuardedRuntimeLauncher,
  installProcessNoEgressGuard,
} from '../../src/runtime-entry';

const capability = 'runtime-entry-test-capability-0001';
const origin = 'http://127.0.0.1:5173';

describe('Data + Email + Telegram runtime entry', () => {
  it('installs exactly the approved Data, Email and Telegram operations', () => {
    const runtime = createDaliOutreachRuntime({
      mode: 'monitoring-only',
      providerAdapters: [],
      liveSend: false,
      processCapability: capability,
      allowedOrigin: origin,
      clock: { now: () => new Date('2026-08-17T12:00:00.000Z') },
    });

    expect([...runtime.installedOperations]).toEqual([
      'data.previewImport',
      'data.importBatch',
      'data.listWorkItems',
      'data.updateWorkItem',
      'data.readAudit',
      'email.previewImport',
      'email.createDraft',
      'email.reviseDraft',
      'email.approveDraft',
      'email.enqueueLocal',
      'email.reconcile',
      'telegram.previewImport',
      'telegram.createMessage',
      'telegram.reviseMessage',
      'telegram.approveMessage',
      'telegram.enqueueLocal',
      'telegram.reconcile',
    ]);
    expect(runtime.registrations.map(({ operation }) => operation)).toEqual([
      ...runtime.installedOperations,
    ]);
    expect(JSON.stringify(runtime.descriptor)).not.toMatch(/provider|live-send/i);
    expect(runtime.descriptor).toEqual({
      mode: 'monitoring-only',
      modules: ['data', 'email', 'telegram'],
      dataSource: 'synthetic-fixture',
      outboundNetwork: 'blocked',
    });
  });

  it('routes typed UI-facing bridge operations into Email and Telegram backend readback', async () => {
    const runtime = createDaliOutreachRuntime({
      mode: 'monitoring-only',
      providerAdapters: [],
      liveSend: false,
      processCapability: capability,
      allowedOrigin: origin,
      clock: { now: () => new Date('2026-08-17T12:00:00.000Z') },
    });
    const bridge = runtime.createInProcessBridge('127.0.0.1:4317');

    const email = await bridge.transport.request(
      {
        schemaVersion: 1,
        correlationId: 'runtime-email-correlation',
        operationId: 'runtime-email-operation',
        operation: 'email.previewImport',
        role: 'operator',
        idempotencyKey: 'runtime-email-idempotency-0001',
        payload: {
          source: {
            kind: 'inline',
            name: 'runtime.csv',
            content: 'email,firstName,company\nada@runtime.example.test,Ada,Runtime',
          },
        },
      },
      bridge.connection,
    );
    const telegram = await bridge.transport.request(
      {
        schemaVersion: 1,
        correlationId: 'runtime-telegram-correlation',
        operationId: 'runtime-telegram-operation',
        operation: 'telegram.previewImport',
        role: 'operator',
        idempotencyKey: 'runtime-telegram-idempotency-0001',
        payload: {
          csvText: 'target_ref,display_name\nsynthetic:runtime-target,Runtime Target',
        },
      },
      bridge.connection,
    );
    const dataPreview = await bridge.transport.request(
      {
        schemaVersion: 1,
        correlationId: 'runtime-data-correlation',
        operationId: 'runtime-data-operation',
        operation: 'data.previewImport',
        role: 'operator',
        idempotencyKey: 'runtime-data-idempotency-0001',
        payload: {
          source: {
            kind: 'inline',
            name: 'runtime-data.csv',
            content: 'customerRef,email,displayName,company\nruntime-customer,runtime@runtime.example.test,Runtime,Fixture',
          },
        },
      },
      bridge.connection,
    );

    expect(email.status).toBe('ok');
    expect(telegram.status).toBe('ok');
    expect(dataPreview).toMatchObject({ status: 'ok', data: { rowCount: 1 } });
    expect(runtime.email.readAudit()).toEqual([
      expect.objectContaining({
        correlationId: 'runtime-email-correlation',
        type: 'email.import.previewed',
      }),
    ]);
    expect(runtime.telegram.readSnapshot()).toMatchObject({
      moduleId: 'telegram',
      providerAccess: false,
      targetPreviewCount: 1,
    });
    expect(runtime.telegram.readAudit()).toEqual([
      expect.objectContaining({
        correlationId: 'runtime-telegram-correlation',
        type: 'telegram.targets-previewed',
      }),
    ]);
    expect(runtime.data.readAudit()).toEqual([
      expect.objectContaining({
        correlationId: 'runtime-data-correlation',
        type: 'data.import.previewed',
      }),
    ]);
  });

  it.each([
    { mode: 'active', providerAdapters: [], liveSend: false },
    { mode: 'monitoring-only', providerAdapters: ['telegram-provider'], liveSend: false },
    { mode: 'monitoring-only', providerAdapters: [], liveSend: true },
  ])('rejects active/provider/live configuration: %j', (unsafe) => {
    expect(() =>
      createDaliOutreachRuntime({
        ...unsafe,
        processCapability: capability,
        allowedOrigin: origin,
      } as never),
    ).toThrow('RUNTIME_MONITORING_ONLY_REQUIRED');
  });

  it('blocks fetch and raw sockets to non-loopback destinations', async () => {
    const guard = installProcessNoEgressGuard();
    try {
      await expect(fetch('https://provider.invalid/status')).rejects.toThrow(
        'NO_EGRESS_BLOCKED',
      );
      const socket = new Socket();
      expect(() => socket.connect({ host: '203.0.113.1', port: 443 })).toThrow(
        'NO_EGRESS_BLOCKED',
      );
      socket.destroy();
    } finally {
      guard.restore();
    }
  });

  it('does not listen until explicitly started and then serves only loopback', async () => {
    const launcher = createGuardedRuntimeLauncher({
      mode: 'monitoring-only',
      providerAdapters: [],
      liveSend: false,
      processCapability: capability,
      allowedOrigin: origin,
    });
    expect(launcher.state()).toBe('idle');

    const running = await launcher.start(0);
    try {
      expect(launcher.state()).toBe('running');
      expect(running.host).toBe('127.0.0.1');
      const response = await fetch(running.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin,
          'x-dali-process-capability': capability,
        },
        body: JSON.stringify({
          schemaVersion: 1,
          correlationId: 'runtime-http-correlation',
          operationId: 'runtime-http-operation',
          idempotencyKey: 'runtime-http-idempotency-0001',
          operation: 'telegram.previewImport',
          role: 'operator',
          payload: {
            csvText: 'target_ref,display_name\nsynthetic:http-target,HTTP Target',
          },
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'ok' });
    } finally {
      await running.close();
    }
    expect(launcher.state()).toBe('closed');
  });
});
