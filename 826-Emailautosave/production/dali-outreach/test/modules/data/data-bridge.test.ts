import { describe, expect, it } from 'vitest';
import { createBridgeDispatcher } from '../../../src/bridge';
import {
  createDataBridgeRegistrations,
  createDataWorkItemModule,
} from '../../../src/modules/data';

const csv = [
  'customerRef,email,displayName,company',
  'customer-ada,ada@bridge.example.test,Ada,Bridge',
].join('\n');

describe('Data bridge registrations', () => {
  it('routes the import-to-work-item flow with role and idempotency gates', async () => {
    const service = createDataWorkItemModule({
      clock: { now: () => new Date('2026-08-17T12:00:00.000Z') },
    });
    const registrations = createDataBridgeRegistrations(service);
    expect(registrations.map(({ operation }) => operation)).toEqual([
      'data.previewImport',
      'data.importBatch',
      'data.listWorkItems',
      'data.updateWorkItem',
      'data.readAudit',
    ]);

    const dispatcher = createBridgeDispatcher({
      expectedHost: '127.0.0.1:4317',
      allowedOrigins: ['http://127.0.0.1:5173'],
      processCapability: 'data-test-process-capability-0001',
      operations: registrations,
      installedOperations: new Set(registrations.map(({ operation }) => operation)),
      onSecurityEvent: () => undefined,
    });
    const connection = {
      remoteAddress: '127.0.0.1',
      host: '127.0.0.1:4317',
      origin: 'http://127.0.0.1:5173',
      processCapability: 'data-test-process-capability-0001',
    };
    let sequence = 0;
    const request = async (
      operation: (typeof registrations)[number]['operation'],
      payload: Record<string, unknown>,
      role: 'viewer' | 'operator',
      idempotencyKey?: string,
    ) => {
      sequence += 1;
      return dispatcher.request(
        {
          schemaVersion: 1,
          correlationId: `data-correlation-${sequence}`,
          operationId: `data-operation-${sequence}`,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          operation,
          role,
          payload,
        },
        connection,
      );
    };

    const preview = await request(
      'data.previewImport',
      { source: { kind: 'inline', name: 'bridge-data.csv', content: csv } },
      'operator',
      'data-preview-idempotency-0001',
    );
    expect(preview).toMatchObject({ status: 'ok', data: { rowCount: 1 } });
    if (preview.status !== 'ok') throw new Error('preview failed');
    const previewData = preview.data as { readonly previewId: string };

    const imported = await request(
      'data.importBatch',
      { previewId: previewData.previewId },
      'operator',
      'data-import-idempotency-0001',
    );
    expect(imported).toMatchObject({ status: 'ok', data: { workItemCount: 1 } });
    if (imported.status !== 'ok') throw new Error('import failed');
    const item = (imported.data as { readonly items: readonly [{ readonly workItemId: string; readonly version: number }] }).items[0]!;

    const list = await request('data.listWorkItems', {}, 'viewer');
    expect(list).toMatchObject({ status: 'ok', data: { pagination: { totalItems: 1 } } });
    const wrongRole = await request(
      'data.updateWorkItem',
      { workItemId: item.workItemId, expectedVersion: item.version, status: 'completed' },
      'viewer',
      'data-update-viewer-0001',
    );
    expect(wrongRole).toMatchObject({ status: 'error', error: { code: 'OPERATION_NOT_ALLOWED' } });
    const updated = await request(
      'data.updateWorkItem',
      { workItemId: item.workItemId, expectedVersion: item.version, status: 'in_progress' },
      'operator',
      'data-update-operator-0001',
    );
    expect(updated).toMatchObject({ status: 'ok', data: { status: 'in_progress', version: 2 } });

    const audit = await request('data.readAudit', {}, 'viewer');
    expect(audit).toMatchObject({ status: 'ok', data: [
      { type: 'data.import.previewed' },
      { type: 'data.batch.imported' },
      { type: 'data.work-item.updated' },
    ] });
  });
});
