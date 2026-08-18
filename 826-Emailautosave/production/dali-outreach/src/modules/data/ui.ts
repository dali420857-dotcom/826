import { createDataWorkItemModule } from './data-work-item';
import type {
  DataAuditEvent,
  DataImportBatchResult,
  DataPreview,
  DataPreviewImportRequest,
  ListWorkItemsRequest,
  ListWorkItemsResult,
  UpdateWorkItemRequest,
  WorkItem,
} from './schemas';

export interface DataUiClient {
  previewImport(payload: DataPreviewImportRequest): Promise<DataPreview>;
  importBatch(previewId: string): Promise<DataImportBatchResult>;
  listWorkItems(input?: Partial<ListWorkItemsRequest>): Promise<ListWorkItemsResult>;
  updateWorkItem(input: UpdateWorkItemRequest): Promise<WorkItem>;
  readAudit(): Promise<readonly DataAuditEvent[]>;
}

export function createSyntheticDataUiClient(): DataUiClient {
  const service = createDataWorkItemModule({
    clock: { now: () => new Date('2026-08-17T12:00:00.000Z') },
  });
  return {
    previewImport: async (payload) => service.previewImport(payload),
    importBatch: async (previewId) => service.importBatch({ previewId }),
    listWorkItems: async (input = {}) =>
      service.listWorkItems({ page: 1, pageSize: 20, ...input }),
    updateWorkItem: async (input) => service.updateWorkItem(input),
    readAudit: async () => service.readAudit(),
  };
}
