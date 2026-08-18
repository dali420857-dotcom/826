import type {
  DataAuditEvent,
  DataImportBatchResult,
  DataPreview,
  WorkItem,
} from './schemas';

export type DataCustomerSeed = {
  readonly customerRef: string;
  readonly email: string;
  readonly displayName: string;
  readonly company: string;
};

export type DataCustomerRecord = DataCustomerSeed & {
  readonly customerId: string;
};

export type DataStoredWorkItem = Omit<WorkItem, 'customer'> & {
  readonly customer: DataCustomerRecord;
};

export type DataPreviewRecord = {
  readonly preview: DataPreview;
  readonly rows: readonly DataCustomerSeed[];
};

/**
 * Storage boundary for the data work-item module.
 *
 * The public module never exposes this record shape; repositories may keep
 * the synthetic email internally while the module only returns masked views.
 */
export interface DataWorkItemRepository {
  getPreview(previewId: string): DataPreviewRecord | undefined;
  putPreview(record: DataPreviewRecord): void;
  getBatchByPreview(previewId: string): DataImportBatchResult | undefined;
  putBatch(previewId: string, result: DataImportBatchResult): void;
  getWorkItem(workItemId: string): DataStoredWorkItem | undefined;
  listWorkItems(): readonly DataStoredWorkItem[];
  putWorkItem(item: DataStoredWorkItem): void;
  nextAuditSequence(): number;
  putAudit(event: DataAuditEvent): void;
  readAudit(): readonly DataAuditEvent[];
  transaction<Result>(operation: () => Result): Result;
  close(): void;
}

export function createInMemoryDataWorkItemRepository(): DataWorkItemRepository {
  const previews = new Map<string, DataPreviewRecord>();
  const batches = new Map<string, DataImportBatchResult>();
  const workItems = new Map<string, DataStoredWorkItem>();
  const audit: DataAuditEvent[] = [];

  return {
    getPreview: (previewId) => previews.get(previewId),
    putPreview: (record) => {
      previews.set(record.preview.previewId, record);
    },
    getBatchByPreview: (previewId) => batches.get(previewId),
    putBatch: (previewId, result) => {
      batches.set(previewId, result);
    },
    getWorkItem: (workItemId) => workItems.get(workItemId),
    listWorkItems: () => [...workItems.values()],
    putWorkItem: (item) => {
      workItems.set(item.workItemId, item);
    },
    nextAuditSequence: () => (audit.at(-1)?.sequence ?? 0) + 1,
    putAudit: (event) => {
      audit.push(event);
    },
    readAudit: () => audit.map((event) => ({ ...event })),
    transaction: <Result>(operation: () => Result) => operation(),
    close: () => undefined,
  };
}
