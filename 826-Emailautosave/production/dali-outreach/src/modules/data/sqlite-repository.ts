import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  dataAuditEventSchema,
  dataImportBatchResultSchema,
  dataPreviewSchema,
  type DataAuditEvent,
  type DataImportBatchResult,
} from './schemas';
import type {
  DataPreviewRecord,
  DataStoredWorkItem,
  DataWorkItemRepository,
} from './repository';

const dataCustomerSeedSchema = z
  .object({
    customerRef: z.string(),
    email: z.string(),
    displayName: z.string(),
    company: z.string(),
  })
  .strict();

const dataCustomerSeedListSchema = z.array(dataCustomerSeedSchema);

type SqliteWorkItemRow = {
  readonly work_item_id: unknown;
  readonly batch_id: unknown;
  readonly customer_id: unknown;
  readonly customer_ref: unknown;
  readonly email: unknown;
  readonly display_name: unknown;
  readonly company: unknown;
  readonly status: unknown;
  readonly owner: unknown;
  readonly email_status: unknown;
  readonly telegram_status: unknown;
  readonly version: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
};

type SqliteAuditRow = {
  readonly sequence: unknown;
  readonly occurred_at: unknown;
  readonly type: unknown;
  readonly count: unknown;
  readonly batch_id: unknown;
  readonly work_item_id: unknown;
  readonly operation_id: unknown;
  readonly correlation_id: unknown;
  readonly status: unknown;
  readonly outcome: unknown;
};

type SqliteMigrationRow = {
  readonly version: unknown;
  readonly name: unknown;
};

const CURRENT_SCHEMA_VERSION = 1;
const CURRENT_MIGRATION_NAME = 'data-work-item-baseline';

function parseJson<T>(value: unknown, schema: z.ZodType<T>): T {
  if (typeof value !== 'string') throw new Error('DATA_STORE_CORRUPTED');
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    throw new Error('DATA_STORE_CORRUPTED');
  }
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('DATA_STORE_CORRUPTED');
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('DATA_STORE_CORRUPTED');
  }
  return value;
}

function nullableText(value: unknown): string | null {
  if (value === null) return null;
  return text(value);
}

function rowToWorkItem(row: SqliteWorkItemRow): DataStoredWorkItem {
  return {
    workItemId: text(row.work_item_id),
    batchId: text(row.batch_id),
    customerId: text(row.customer_id),
    customer: {
      customerId: text(row.customer_id),
      customerRef: text(row.customer_ref),
      email: text(row.email),
      displayName: text(row.display_name),
      company: text(row.company),
    },
    status: text(row.status) as DataStoredWorkItem['status'],
    owner: nullableText(row.owner),
    emailStatus: text(row.email_status) as DataStoredWorkItem['emailStatus'],
    telegramStatus: text(row.telegram_status) as DataStoredWorkItem['telegramStatus'],
    version: integer(row.version),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function rowToAudit(row: SqliteAuditRow): DataAuditEvent {
  const event = {
    sequence: integer(row.sequence),
    occurredAt: text(row.occurred_at),
    type: text(row.type),
    ...(row.count === null ? {} : { count: integer(row.count) }),
    ...(row.batch_id === null ? {} : { batchId: text(row.batch_id) }),
    ...(row.work_item_id === null ? {} : { workItemId: text(row.work_item_id) }),
    ...(row.operation_id === null ? {} : { operationId: text(row.operation_id) }),
    ...(row.correlation_id === null ? {} : { correlationId: text(row.correlation_id) }),
    ...(row.status === null ? {} : { status: text(row.status) }),
    ...(row.outcome === null ? {} : { outcome: text(row.outcome) }),
  };
  try {
    return dataAuditEventSchema.parse(event);
  } catch {
    throw new Error('DATA_STORE_CORRUPTED');
  }
}

function validateFilename(filename: string): void {
  if (filename.trim() === '' || filename.includes('\0')) {
    throw new Error('DATA_STORE_PATH_INVALID');
  }
}

function tableExists(database: DatabaseSync, name: string): boolean {
  return database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) !== undefined;
}

function readSchemaVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get() as { user_version?: unknown };
  return integer(row.user_version);
}

function createBaselineSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS data_previews (
      preview_id TEXT PRIMARY KEY,
      preview_json TEXT NOT NULL,
      rows_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS data_batches (
      preview_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL UNIQUE,
      result_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS data_work_items (
      work_item_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      customer_ref TEXT NOT NULL,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      company TEXT NOT NULL,
      status TEXT NOT NULL,
      owner TEXT,
      email_status TEXT NOT NULL,
      telegram_status TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS data_work_items_created_at_idx
      ON data_work_items (created_at, work_item_id);

    CREATE TABLE IF NOT EXISTS data_audit (
      sequence INTEGER PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      type TEXT NOT NULL,
      count INTEGER,
      batch_id TEXT,
      work_item_id TEXT,
      operation_id TEXT,
      correlation_id TEXT,
      status TEXT,
      outcome TEXT
    );
  `);
}

function applyBaselineMigration(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    createBaselineSchema(database);
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      );
    `);
    database
      .prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
      .run(CURRENT_SCHEMA_VERSION, CURRENT_MIGRATION_NAME);
    database.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function validateAppliedMigration(database: DatabaseSync): void {
  if (!tableExists(database, 'schema_migrations')) {
    throw new Error('DATA_STORE_SCHEMA_VERSION_MISMATCH');
  }

  const rows = database
    .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
    .all() as unknown as SqliteMigrationRow[];
  if (rows.length !== 1 || integer(rows[0]?.version) !== CURRENT_SCHEMA_VERSION) {
    throw new Error('DATA_STORE_SCHEMA_VERSION_MISMATCH');
  }
  if (text(rows[0]?.name) !== CURRENT_MIGRATION_NAME) {
    throw new Error('DATA_STORE_SCHEMA_MIGRATION_TAMPERED');
  }
}

function initializeDatabase(database: DatabaseSync): void {
  database.exec('PRAGMA foreign_keys = ON');
  const schemaVersion = readSchemaVersion(database);
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error('DATA_STORE_SCHEMA_VERSION_UNSUPPORTED');
  }

  if (schemaVersion === CURRENT_SCHEMA_VERSION) {
    validateAppliedMigration(database);
    return;
  }

  if (tableExists(database, 'schema_migrations')) {
    throw new Error('DATA_STORE_SCHEMA_VERSION_MISMATCH');
  }
  applyBaselineMigration(database);
}

export function createSQLiteDataWorkItemRepository(options: {
  readonly filename: string;
}): DataWorkItemRepository & { readonly close: () => void } {
  validateFilename(options.filename);
  if (options.filename !== ':memory:') {
    mkdirSync(dirname(options.filename), { recursive: true });
  }
  const database = new DatabaseSync(options.filename);
  try {
    initializeDatabase(database);
  } catch (error) {
    try {
      database.close();
    } catch {
      // Preserve the initialization error even if the close itself fails.
    }
    throw error;
  }

  let closed = false;
  let transactionDepth = 0;
  const assertOpen = (): void => {
    if (closed) throw new Error('DATA_STORE_CLOSED');
  };

  const repository: DataWorkItemRepository & { readonly close: () => void } = {
    getPreview(previewId) {
      assertOpen();
      const row = database
        .prepare('SELECT preview_json, rows_json FROM data_previews WHERE preview_id = ?')
        .get(previewId) as { preview_json?: unknown; rows_json?: unknown } | undefined;
      if (!row) return undefined;
      const preview = parseJson(row.preview_json, dataPreviewSchema);
      const rows = parseJson(row.rows_json, dataCustomerSeedListSchema);
      return { preview, rows } satisfies DataPreviewRecord;
    },

    putPreview(record) {
      assertOpen();
      database
        .prepare(`
          INSERT INTO data_previews (preview_id, preview_json, rows_json)
          VALUES (?, ?, ?)
          ON CONFLICT(preview_id) DO UPDATE SET
            preview_json = excluded.preview_json,
            rows_json = excluded.rows_json
        `)
        .run(record.preview.previewId, JSON.stringify(record.preview), JSON.stringify(record.rows));
    },

    getBatchByPreview(previewId) {
      assertOpen();
      const row = database
        .prepare('SELECT result_json FROM data_batches WHERE preview_id = ?')
        .get(previewId) as { result_json?: unknown } | undefined;
      return row ? parseJson(row.result_json, dataImportBatchResultSchema) : undefined;
    },

    putBatch(previewId, result) {
      assertOpen();
      database
        .prepare(`
          INSERT INTO data_batches (preview_id, batch_id, result_json)
          VALUES (?, ?, ?)
          ON CONFLICT(preview_id) DO UPDATE SET
            batch_id = excluded.batch_id,
            result_json = excluded.result_json
        `)
        .run(previewId, result.batchId, JSON.stringify(result));
    },

    getWorkItem(workItemId) {
      assertOpen();
      const row = database
        .prepare('SELECT * FROM data_work_items WHERE work_item_id = ?')
        .get(workItemId) as SqliteWorkItemRow | undefined;
      return row ? rowToWorkItem(row) : undefined;
    },

    listWorkItems() {
      assertOpen();
      const rows = database
        .prepare('SELECT * FROM data_work_items ORDER BY created_at ASC, work_item_id ASC')
        .all() as unknown as SqliteWorkItemRow[];
      return rows.map(rowToWorkItem);
    },

    putWorkItem(item) {
      assertOpen();
      database
        .prepare(`
          INSERT INTO data_work_items (
            work_item_id, batch_id, customer_id, customer_ref, email,
            display_name, company, status, owner, email_status,
            telegram_status, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(work_item_id) DO UPDATE SET
            batch_id = excluded.batch_id,
            customer_id = excluded.customer_id,
            customer_ref = excluded.customer_ref,
            email = excluded.email,
            display_name = excluded.display_name,
            company = excluded.company,
            status = excluded.status,
            owner = excluded.owner,
            email_status = excluded.email_status,
            telegram_status = excluded.telegram_status,
            version = excluded.version,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `)
        .run(
          item.workItemId,
          item.batchId,
          item.customerId,
          item.customer.customerRef,
          item.customer.email,
          item.customer.displayName,
          item.customer.company,
          item.status,
          item.owner,
          item.emailStatus,
          item.telegramStatus,
          item.version,
          item.createdAt,
          item.updatedAt,
        );
    },

    nextAuditSequence() {
      assertOpen();
      const row = database
        .prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM data_audit')
        .get() as { next_sequence?: unknown };
      return integer(row.next_sequence);
    },

    putAudit(event) {
      assertOpen();
      database
        .prepare(`
          INSERT INTO data_audit (
            sequence, occurred_at, type, count, batch_id, work_item_id,
            operation_id, correlation_id, status, outcome
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          event.sequence,
          event.occurredAt,
          event.type,
          event.count ?? null,
          event.batchId ?? null,
          event.workItemId ?? null,
          event.operationId ?? null,
          event.correlationId ?? null,
          event.status ?? null,
          event.outcome ?? null,
        );
    },

    readAudit() {
      assertOpen();
      const rows = database
        .prepare('SELECT * FROM data_audit ORDER BY sequence ASC')
        .all() as unknown as SqliteAuditRow[];
      return rows.map(rowToAudit);
    },

    transaction<Result>(operation: () => Result): Result {
      assertOpen();
      if (transactionDepth > 0) return operation();
      transactionDepth += 1;
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = operation();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    },

    close() {
      if (closed) return;
      closed = true;
      database.close();
    },
  };

  return repository;
}
