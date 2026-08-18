import { describe, expect, it } from 'vitest';
import { createSyntheticDataUiClient } from '../../../src/modules/data';

describe('Data UI client', () => {
  it('keeps the UI flow on the same import, list and update contract', async () => {
    const client = createSyntheticDataUiClient();
    const preview = await client.previewImport({
      source: {
        kind: 'inline',
        name: 'ui-data.csv',
        content: 'customerRef,email,displayName,company\nui-customer,ui@ui.example.test,UI Customer,Fixture',
      },
    });
    const imported = await client.importBatch(preview.previewId);
    const listed = await client.listWorkItems({ page: 1, pageSize: 20 });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.workItemId).toBe(imported.items[0]?.workItemId);

    const updated = await client.updateWorkItem({
      workItemId: listed.items[0]!.workItemId,
      expectedVersion: listed.items[0]!.version,
      status: 'completed',
    });
    expect(updated).toMatchObject({ status: 'completed', version: 2 });
    expect((await client.readAudit()).at(-1)).toMatchObject({
      type: 'data.work-item.updated',
    });
  });
});
