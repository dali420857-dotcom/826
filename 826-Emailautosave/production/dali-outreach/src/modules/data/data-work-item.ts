import { assertSafeCsvCell, inputLimits } from '../../contracts';
import type { Clock } from '../../runtime-core';
import { hashValue } from './hash';
import {
  createInMemoryDataWorkItemRepository,
  type DataStoredWorkItem,
  type DataWorkItemRepository,
} from './repository';
import {
  dataImportBatchRequestSchema,
  dataPreviewImportRequestSchema,
  dataIdentifierSchema,
  listWorkItemsRequestSchema,
  updateWorkItemRequestSchema,
  type DataAuditEvent,
  type DataImportBatchResult,
  type DataPreview,
  type ListWorkItemsResult,
  type UpdateWorkItemRequest,
  type WorkItem,
} from './schemas';

type OperationMetadata = {
  readonly operationId?: string;
  readonly correlationId?: string;
};

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell.length === 0) quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (quoted) throw new Error('INVALID_DATA_IMPORT');
  row.push(cell.replace(/\r$/, ''));
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function isSyntheticEmail(email: string): boolean {
  if (email.length > 320) return false;
  const match = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Za-z0-9.-]+)$/.exec(email);
  const [local, domain] = email.split('@');
  return Boolean(
    match?.[1]?.toLowerCase().endsWith('.example.test') &&
      local &&
      local.length <= 64 &&
      domain &&
      domain.length <= 253,
  );
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local?.slice(0, 1) ?? '*'}***@${domain}`;
}

function safeMetadata(metadata: OperationMetadata): OperationMetadata {
  for (const value of [metadata.operationId, metadata.correlationId]) {
    if (value !== undefined && !dataIdentifierSchema.safeParse(value).success) {
      throw new Error('INVALID_OPERATION_METADATA');
    }
  }
  return metadata;
}

export function createDataWorkItemModule(options: {
  readonly clock: Clock;
  readonly repository?: DataWorkItemRepository;
}) {
  const repository = options.repository ?? createInMemoryDataWorkItemRepository();

  const appendAudit = (event: Omit<DataAuditEvent, 'sequence' | 'occurredAt'>) => {
    repository.putAudit({
      ...event,
      sequence: repository.nextAuditSequence(),
      occurredAt: options.clock.now().toISOString(),
    });
  };

  const publicWorkItem = (item: DataStoredWorkItem): WorkItem => ({
    ...item,
    customer: {
      customerId: item.customer.customerId,
      customerRef: item.customer.customerRef,
      maskedEmail: maskEmail(item.customer.email),
      displayName: item.customer.displayName,
      company: item.customer.company,
    },
  });

  const previewImport = (input: unknown, metadata: OperationMetadata = {}): DataPreview => {
    const parsed = dataPreviewImportRequestSchema.safeParse(input);
    if (!parsed.success) throw new Error('INVALID_DATA_IMPORT');
    const safe = safeMetadata(metadata);
    if (
      new TextEncoder().encode(parsed.data.source.content).byteLength > inputLimits.maxImportBytes
    ) {
      throw new Error('INVALID_DATA_IMPORT');
    }
    const rows = parseCsv(parsed.data.source.content);
    if (rows.length < 2 || rows.length - 1 > inputLimits.maxImportRows) {
      throw new Error('INVALID_DATA_IMPORT');
    }
    const columns = rows[0] ?? [];
    if (columns.join(',') !== 'customerRef,email,displayName,company') {
      throw new Error('INVALID_DATA_IMPORT_HEADERS');
    }
    const seenCustomerRefs = new Set<string>();
    const parsedRows = rows.slice(1).map((cells, index) => {
      if (cells.length !== 4) throw new Error('INVALID_DATA_IMPORT_ROW');
      const [customerRef = '', email = '', displayName = '', company = ''] = cells.map((value) => value.trim());
      if (!dataIdentifierSchema.max(64).safeParse(customerRef).success) {
        throw new Error('INVALID_DATA_IMPORT_ROW');
      }
      if (seenCustomerRefs.has(customerRef)) throw new Error('DUPLICATE_DATA_CUSTOMER_REF');
      seenCustomerRefs.add(customerRef);
      if (!isSyntheticEmail(email)) throw new Error('NON_SYNTHETIC_DATA');
      if (!displayName || displayName.length > 200 || !company || company.length > 200) {
        throw new Error('INVALID_DATA_IMPORT_ROW');
      }
      return {
        rowNumber: index + 2,
        customerRef,
        email: email.toLowerCase(),
        maskedEmail: maskEmail(email),
        displayName: assertSafeCsvCell(displayName),
        company: assertSafeCsvCell(company),
      };
    });
    const previewId = `data-preview-${hashValue(parsed.data.source.content).slice(0, 20)}`;
    const preview: DataPreview = {
      previewId,
      columns,
      rowCount: parsedRows.length,
      rows: parsedRows.map(({ rowNumber, customerRef, maskedEmail, displayName, company }) => ({
        rowNumber,
        customerRef,
        maskedEmail,
        displayName,
        company,
      })),
    };
    repository.transaction(() => {
      repository.putPreview({
        preview,
        rows: parsedRows.map(({ customerRef, email, displayName, company }) => ({
          customerRef,
          email,
          displayName,
          company,
        })),
      });
      appendAudit({
        type: 'data.import.previewed',
        count: parsedRows.length,
        operationId: safe.operationId,
        correlationId: safe.correlationId,
      });
    });
    return preview;
  };

  const importBatch = (input: unknown, metadata: OperationMetadata = {}): DataImportBatchResult => {
    const parsed = dataImportBatchRequestSchema.safeParse(input);
    if (!parsed.success) throw new Error('INVALID_DATA_BATCH_IMPORT');
    const safe = safeMetadata(metadata);
    const existing = repository.getBatchByPreview(parsed.data.previewId);
    if (existing) return existing;
    const preview = repository.getPreview(parsed.data.previewId);
    if (!preview) throw new Error('DATA_PREVIEW_NOT_FOUND');
    const batchId = `data-batch-${hashValue(parsed.data.previewId).slice(0, 20)}`;
    const now = options.clock.now().toISOString();
    const storedItems: DataStoredWorkItem[] = preview.rows.map((row) => {
      const customerId = `data-customer-${hashValue(row.customerRef).slice(0, 20)}`;
      return {
        workItemId: `data-work-${hashValue(`${batchId}:${row.customerRef}`).slice(0, 20)}`,
        batchId,
        customerId,
        customer: {
          customerId,
          customerRef: row.customerRef,
          email: row.email,
          displayName: row.displayName,
          company: row.company,
        },
        status: 'pending',
        owner: null,
        emailStatus: 'pending',
        telegramStatus: 'pending',
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
    });
    const items = storedItems.map(publicWorkItem);
    const result: DataImportBatchResult = {
      batchId,
      customerCount: items.length,
      workItemCount: items.length,
      items,
    };
    repository.transaction(() => {
      for (const item of storedItems) repository.putWorkItem(item);
      repository.putBatch(parsed.data.previewId, result);
      appendAudit({
        type: 'data.batch.imported',
        batchId,
        count: items.length,
        operationId: safe.operationId,
        correlationId: safe.correlationId,
      });
    });
    return result;
  };

  const listWorkItems = (input: unknown): ListWorkItemsResult => {
    const parsed = listWorkItemsRequestSchema.safeParse(input);
    if (!parsed.success) throw new Error('INVALID_DATA_WORK_ITEM_QUERY');
    const filtered = [...repository.listWorkItems()]
      .filter((item) => parsed.data.status === undefined || item.status === parsed.data.status)
      .filter((item) => parsed.data.owner === undefined || item.owner === parsed.data.owner)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const totalItems = filtered.length;
    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / parsed.data.pageSize);
    const start = (parsed.data.page - 1) * parsed.data.pageSize;
    return {
      items: filtered.slice(start, start + parsed.data.pageSize).map(publicWorkItem),
      pagination: {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        totalItems,
        totalPages,
      },
    };
  };

  const updateWorkItem = (input: UpdateWorkItemRequest, metadata: OperationMetadata = {}): WorkItem => {
    const parsed = updateWorkItemRequestSchema.safeParse(input);
    if (!parsed.success) throw new Error('INVALID_DATA_WORK_ITEM_UPDATE');
    const safe = safeMetadata(metadata);
    const item = repository.getWorkItem(parsed.data.workItemId);
    if (!item) throw new Error('DATA_WORK_ITEM_NOT_FOUND');
    if (item.version !== parsed.data.expectedVersion) {
      throw new Error('DATA_WORK_ITEM_STATE_CONFLICT');
    }
    const next: DataStoredWorkItem = {
      ...item,
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(Object.prototype.hasOwnProperty.call(parsed.data, 'owner') ? { owner: parsed.data.owner ?? null } : {}),
      ...(parsed.data.emailStatus !== undefined ? { emailStatus: parsed.data.emailStatus } : {}),
      ...(parsed.data.telegramStatus !== undefined ? { telegramStatus: parsed.data.telegramStatus } : {}),
      version: item.version + 1,
      updatedAt: options.clock.now().toISOString(),
    };
    repository.transaction(() => {
      repository.putWorkItem(next);
      appendAudit({
        type: 'data.work-item.updated',
        workItemId: next.workItemId,
        status: next.status,
        operationId: safe.operationId,
        correlationId: safe.correlationId,
      });
    });
    return publicWorkItem(next);
  };

  return {
    moduleId: 'data' as const,
    previewImport,
    importBatch,
    listWorkItems,
    updateWorkItem,
    readAudit: () => repository.readAudit().map((event) => ({ ...event })),
    close: () => repository.close(),
  };
}
