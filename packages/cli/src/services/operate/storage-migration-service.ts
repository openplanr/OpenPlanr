import {
  inspectOperateStorage,
  migrateOperateStorage,
  type OperateStorageMigrationReceipt,
} from './storage-layout.js';

export type OperateStorageStatus = Readonly<{
  kind: 'operate-storage-status';
  status: 'empty' | 'ready' | 'migration-required' | 'interrupted';
  legacySources: readonly ('operate-v2' | 'operate-legacy')[];
  interruptedEntries: readonly string[];
  pinnedVerifierRequired: boolean;
  nextAction: 'none' | 'migrate-storage' | 'recover-interrupted-migration';
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
    nextAction:
      inspection.status === 'migration-required'
        ? 'migrate-storage'
        : inspection.status === 'interrupted'
          ? 'recover-interrupted-migration'
          : 'none',
  });
}

/** Explicit, recoverable product path. Normal runtime activation remains fail-closed. */
export async function migrateProjectOperateStorage(
  projectDir: string,
): Promise<OperateStorageMigrationReceipt> {
  return await migrateOperateStorage(projectDir);
}
