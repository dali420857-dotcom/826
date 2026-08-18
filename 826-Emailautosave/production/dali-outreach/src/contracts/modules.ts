import type { ZodType } from 'zod';
import type { ModuleId } from './identity';
import type { OperationName } from './operations';

export interface OutreachPresentationModule {
  readonly moduleId: ModuleId;
  readonly navItems: readonly { id: string; label: string; path: string }[];
  readonly routes: readonly { id: string; path: string }[];
}

export interface OutreachSnapshotModule<T> {
  readonly moduleId: ModuleId;
  readonly schemaVersion: 1;
  readonly schema: ZodType<T>;
  readSnapshot(context: { now: Date }): Promise<T>;
}

export interface OutreachOperationModule {
  readonly moduleId: ModuleId;
  readonly definitions: ReadonlySet<OperationName>;
  createHandlers(dependencies: unknown): ReadonlyMap<OperationName, unknown>;
}

export function assertMatchingModuleIds(
  presentation: readonly OutreachPresentationModule[],
  snapshots: readonly OutreachSnapshotModule<unknown>[],
  operations: readonly OutreachOperationModule[],
): readonly ModuleId[] {
  const groups = [presentation, snapshots, operations].map(
    (modules) => new Set(modules.map((module) => module.moduleId)),
  );
  const installed = [...groups[0]].sort();
  if (
    groups.some(
      (group) => group.size !== installed.length || installed.some((id) => !group.has(id)),
    )
  ) {
    throw new Error('MODULE_REGISTRY_MISMATCH');
  }
  return installed;
}

