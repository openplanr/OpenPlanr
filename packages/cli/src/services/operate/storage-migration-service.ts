import {
  inspectOperateStorage,
  migrateOperateStorage,
  type OperateStorageMigrationReceipt,
  type OperateStorageRollbackReceipt,
  rollbackOperateStorageMigration,
} from './storage-layout.js';

export type OperateStorageStatus = Readonly<{
  kind: 'operate-storage-status';
  status: 'empty' | 'ready' | 'migration-required' | 'interrupted';
  legacySources: readonly ('operate-v2' | 'operate-legacy')[];
  interruptedEntries: readonly string[];
  pinnedVerifierRequired: boolean;
  nextAction: 'none' | 'migrate-storage';
}>;

export async function readOperateStorageStatus(projectDir: string): Promise<OperateStorageStatus> {
  const inspection = await inspectOperateStorage(projectDir);
  const legacySources = [
    ...(inspection.legacyV2Root ? (['operate-v2'] as const) : []),
    ...(inspection.legacyNeutralRoot ? (['operate-legacy'] as const) : []),
  ];
  return Object.freeze({
    kind: 'operate-storage-status',
    status: inspection.status,
    legacySources: Object.freeze(legacySources),
    interruptedEntries: Object.freeze([...inspection.interruptedEntries]),
    pinnedVerifierRequired: inspection.legacyV2Root !== null,
    nextAction: ['migration-required', 'interrupted'].includes(inspection.status)
      ? 'migrate-storage'
      : 'none',
  });
}

/** Explicit, recoverable product path. Normal runtime activation remains fail-closed. */
export async function migrateProjectOperateStorage(
  projectDir: string,
): Promise<OperateStorageMigrationReceipt> {
  return await migrateOperateStorage(projectDir);
}

/** Explicit, lossless rollback to the preserved pre-migration v2 Store. */
export async function rollbackProjectOperateStorage(
  projectDir: string,
): Promise<OperateStorageRollbackReceipt> {
  return await rollbackOperateStorageMigration(projectDir);
}
