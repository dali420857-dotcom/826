import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDataWorkItemModule } from '../../../src/modules/data';
import { createSQLiteDataWorkItemRepository } from '../../../src/modules/data/sqlite-repository';

const csv = [
  'customerRef,email,displayName,company',
  'customer-ada,ada@alpha.example.test,Ada Lovelace,Analytical Engines',
].join('\n');

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createClock() {
  return { now: () => new Date('2026-08-17T12:00:00.000Z') };
}

describe('SQLite data-work-item repository', () => {
  it('records and reuses the current SQLite schema version', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dali-data-'));
    temporaryDirectories.push(directory);
    const filename = join(directory, 'data-work-items.sqlite');

    const repository = createSQLiteDataWorkItemRepository({ filename });
    repository.close();

    const database = new DatabaseSync(filename);
    const version = database.prepare('PRAGMA user_version').get() as { user_version?: unknown };
    const migration = database
      .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
      .all() as Array<{ version?: unknown; name?: unknown }>;
    database.close();

    expect(version.user_version).toBe(1);
    expect(migration).toEqual([{ version: 1, name: 'data-work-item-baseline' }]);
  });

  it('migrates an unversioned legacy schema without replacing existing rows', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dali-data-'));
    temporaryDirectories.push(directory);
    const filename = join(directory, 'legacy-data.sqlite');
    const database = new DatabaseSync(filename);
    database.exec(`
      CREATE TABLE data_previews (
        preview_id TEXT PRIMARY KEY,
        preview_json TEXT NOT NULL,
        rows_json TEXT NOT NULL
      );
      CREATE TABLE data_batches (
        preview_id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL UNIQUE,
        result_json TEXT NOT NULL
      );
      CREATE TABLE data_work_items (
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
      CREATE INDEX data_work_items_created_at_idx
        ON data_work_items (created_at, work_item_id);
      CREATE TABLE data_audit (
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
      INSERT INTO data_work_items (
        work_item_id, batch_id, customer_id, customer_ref, email,
        display_name, company, status, owner, email_status,
        telegram_status, version, created_at, updated_at
      ) VALUES (
        'data-work-legacy', 'data-batch-legacy', 'data-customer-legacy',
        'legacy-customer', 'legacy@legacy.example.test', 'Legacy Customer',
        'Legacy Company', 'pending', NULL, 'pending', 'pending', 1,
        '2026-08-17T12:00:00.000Z', '2026-08-17T12:00:00.000Z'
      );
    `);
    database.close();

    const repository = createSQLiteDataWorkItemRepository({ filename });
    expect(repository.getWorkItem('data-work-legacy')).toMatchObject({
      workItemId: 'data-work-legacy',
      customer: { email: 'legacy@legacy.example.test' },
    });
    repository.close();
  });

  it('fails closed when an existing database advertises a future schema version', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dali-data-'));
    temporaryDirectories.push(directory);
    const filename = join(directory, 'future-data.sqlite');
    const database = new DatabaseSync(filename);
    database.exec('PRAGMA user_version = 99');
    database.close();

    expect(() => createSQLiteDataWorkItemRepository({ filename })).toThrow(
      'DATA_STORE_SCHEMA_VERSION_UNSUPPORTED',
    );

    const reopened = new DatabaseSync(filename);
    const migrationTable = reopened
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get();
    reopened.close();
    expect(migrationTable).toBeUndefined();
  });

  it('fails closed when migration metadata disagrees with the SQLite version', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dali-data-'));
    temporaryDirectories.push(directory);
    const filename = join(directory, 'mismatched-data.sqlite');
    const repository = createSQLiteDataWorkItemRepository({ filename });
    repository.close();

    const database = new DatabaseSync(filename);
    database.exec('PRAGMA user_version = 0');
    database.close();

    expect(() => createSQLiteDataWorkItemRepository({ filename })).toThrow(
      'DATA_STORE_SCHEMA_VERSION_MISMATCH',
    );
  });

  it('fails closed when an applied migration record has been changed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dali-data-'));
    temporaryDirectories.push(directory);
    const filename = join(directory, 'tampered-data.sqlite');
    const repository = createSQLiteDataWorkItemRepository({ filename });
    repository.close();

    const database = new DatabaseSync(filename);
    database.prepare('UPDATE schema_migrations SET name = ? WHERE version = 1').run('tampered');
    database.close();

    expect(() => createSQLiteDataWorkItemRepository({ filename })).toThrow(
      'DATA_STORE_SCHEMA_MIGRATION_TAMPERED',
    );
  });

  it('reads batches, work-item state, and audit back after the repository is reopened', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dali-data-'));
    temporaryDirectories.push(directory);
    const filename = join(directory, 'data-work-items.sqlite');

    const firstRepository = createSQLiteDataWorkItemRepository({ filename });
    const firstModule = createDataWorkItemModule({
      clock: createClock(),
      repository: firstRepository,
    });
    const preview = firstModule.previewImport({
      source: { kind: 'inline', name: 'synthetic-data.csv', content: csv },
    });
    const imported = firstModule.importBatch({ previewId: preview.previewId });
    const workItem = imported.items[0]!;
    firstModule.updateWorkItem({
      workItemId: workItem.workItemId,
      expectedVersion: workItem.version,
      status: 'in_progress',
      owner: 'operator-01',
    });
    firstRepository.close();

    const secondRepository = createSQLiteDataWorkItemRepository({ filename });
    const secondModule = createDataWorkItemModule({
      clock: createClock(),
      repository: secondRepository,
    });
    const replayed = secondModule.importBatch({ previewId: preview.previewId });
    const listed = secondModule.listWorkItems({ page: 1, pageSize: 20 });

    expect(replayed).toEqual(imported);
    expect(listed.items).toMatchObject([
      {
        workItemId: workItem.workItemId,
        status: 'in_progress',
        owner: 'operator-01',
        version: 2,
        customer: { maskedEmail: 'a***@alpha.example.test' },
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain('ada@alpha.example.test');
    expect(secondModule.readAudit()).toHaveLength(3);
    secondRepository.close();
  });
});
