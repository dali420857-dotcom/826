import { describe, expect, it } from 'vitest';
import { createDataWorkItemModule } from '../../../src/modules/data';

const csv = [
  'customerRef,email,displayName,company',
  'customer-ada,ada@alpha.example.test,Ada Lovelace,Analytical Engines',
  'customer-grace,grace@beta.example.test,Grace Hopper,Compilers',
].join('\n');

function createModule() {
  return createDataWorkItemModule({
    clock: { now: () => new Date('2026-08-17T12:00:00.000Z') },
  });
}

describe('Data work-item backend', () => {
  it('previews synthetic data with masked customer contact values', () => {
    const module = createModule();

    const preview = module.previewImport({
      source: { kind: 'inline', name: 'synthetic-data.csv', content: csv },
    });

    expect(preview).toMatchObject({
      previewId: expect.stringMatching(/^data-preview-/),
      rowCount: 2,
      columns: ['customerRef', 'email', 'displayName', 'company'],
    });
    expect(preview.rows[0]).toMatchObject({
      customerRef: 'customer-ada',
      maskedEmail: 'a***@alpha.example.test',
      displayName: 'Ada Lovelace',
    });
    expect(JSON.stringify(preview)).not.toContain('ada@alpha.example.test');
  });

  it('imports one batch into customers and pending work items', () => {
    const module = createModule();
    const preview = module.previewImport({
      source: { kind: 'inline', name: 'synthetic-data.csv', content: csv },
    });

    const imported = module.importBatch({ previewId: preview.previewId });
    expect(imported).toMatchObject({
      batchId: expect.stringMatching(/^data-batch-/),
      customerCount: 2,
      workItemCount: 2,
    });
    expect(imported.items[0]).toMatchObject({
      batchId: imported.batchId,
      status: 'pending',
      emailStatus: 'pending',
      telegramStatus: 'pending',
      customer: { maskedEmail: 'a***@alpha.example.test' },
      version: 1,
    });
    expect(module.listWorkItems({ page: 1, pageSize: 20 })).toMatchObject({
      pagination: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 },
    });
  });

  it('updates status and owner with optimistic versioning and audit readback', () => {
    const module = createModule();
    const preview = module.previewImport({
      source: { kind: 'inline', name: 'synthetic-data.csv', content: csv },
    });
    const imported = module.importBatch({ previewId: preview.previewId });
    const workItem = imported.items[0]!;

    const updated = module.updateWorkItem({
      workItemId: workItem.workItemId,
      expectedVersion: workItem.version,
      status: 'in_progress',
      owner: 'operator-01',
      emailStatus: 'done',
    });

    expect(updated).toMatchObject({
      workItemId: workItem.workItemId,
      status: 'in_progress',
      owner: 'operator-01',
      emailStatus: 'done',
      telegramStatus: 'pending',
      version: 2,
    });
    expect(module.readAudit()).toEqual([
      expect.objectContaining({ type: 'data.import.previewed', count: 2 }),
      expect.objectContaining({ type: 'data.batch.imported', count: 2 }),
      expect.objectContaining({
        type: 'data.work-item.updated',
        workItemId: workItem.workItemId,
        status: 'in_progress',
      }),
    ]);
  });

  it('rejects non-synthetic input and stale work-item updates', () => {
    const module = createModule();

    expect(() =>
      module.previewImport({
        source: {
          kind: 'inline',
          name: 'real-data.csv',
          content: 'customerRef,email,displayName,company\nreal,person@example.com,Real,Public',
        },
      }),
    ).toThrow('NON_SYNTHETIC_DATA');

    const preview = module.previewImport({
      source: { kind: 'inline', name: 'synthetic-data.csv', content: csv },
    });
    const imported = module.importBatch({ previewId: preview.previewId });
    const workItem = imported.items[0]!;

    expect(() =>
      module.updateWorkItem({
        workItemId: workItem.workItemId,
        expectedVersion: 0,
        status: 'completed',
      }),
    ).toThrow('DATA_WORK_ITEM_STATE_CONFLICT');
  });

  it('rejects duplicate customer references within one import batch', () => {
    const module = createModule();
    expect(() =>
      module.previewImport({
        source: {
          kind: 'inline',
          name: 'duplicate-data.csv',
          content: [
            'customerRef,email,displayName,company',
            'same,one@one.example.test,One,Fixture',
            'same,two@two.example.test,Two,Fixture',
          ].join('\n'),
        },
      }),
    ).toThrow('DUPLICATE_DATA_CUSTOMER_REF');
  });
});
