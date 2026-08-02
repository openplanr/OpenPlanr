/**
 * FR5 (E-005): the automatic and explicit SPEC-002 -> Protocol v1.3 storage-layout
 * migration. SPEC-002 kept the append-only internals at the operate root
 * (`events.jsonl`, `checkpoints/current.json`, and a directory-per-digest-prefix
 * `records/sha256/<pp>/<rest>.json` tree). Protocol v1.3 collapses them under a
 * single dot-prefixed `.state/` directory and folds every record into one
 * append-only `records.jsonl`, retaining the content-address digest as a field.
 *
 * The record-container transform itself is owned by the installed pipeline
 * (`lib/operate/records-migration.mjs`) and is consumed here — never vendored.
 * The migration is journal-driven (crash-safe, identical to every other
 * mutation) and byte-exactly reversible: `reconstructDirectoryLayoutFromJsonl`
 * rebuilds the original SPEC-002 tree line-for-line.
 */
export type OperatingStorageLayout = 'v1.3' | 'v1.2' | 'absent';
/**
 * Detect which storage layout is on disk. `.state/` (or its events log) means the
 * project is already on v1.3; any SPEC-002 internal without `.state/` means v1.2.
 */
export declare function detectOperatingStorageLayout(projectRoot: string, options?: {
    localRoot?: string;
}): Promise<OperatingStorageLayout>;
export interface OperatingStorageMigrationResult {
    migrated: boolean;
    layout: OperatingStorageLayout;
    recordCount?: number;
    migrationId?: string;
}
/**
 * Idempotent, journal-safe SPEC-002 -> v1.3 migration. Writes the `.state/`
 * internals through the write-ahead journal first (so a crash mid-migration
 * unwinds cleanly), then removes the SPEC-002 tree only after the journal
 * commits. A crash between commit and cleanup leaves a resolvable `.state/`
 * project whose stale SPEC-002 residue is removed on the next open.
 */
export declare function applyStorageLayoutMigration(input: {
    projectRoot: string;
    localRoot?: string;
    now?: string;
}): Promise<OperatingStorageMigrationResult>;
/**
 * Automatic-on-open entry point. Any mutating operate action calls this before
 * it proceeds; it is a fast no-op for a v1.3 or uninitialized project and only
 * migrates a genuine SPEC-002-layout project. When the pipeline transform is
 * unavailable the layout is left untouched — the mutation fails downstream with
 * the standard pipeline-required error rather than half-migrating.
 */
export declare function migrateOperatingStorageLayoutOnOpen(projectRoot: string, options?: {
    localRoot?: string;
}): Promise<OperatingStorageMigrationResult>;
/** Read-only inspection of what an automatic migration would do. */
export declare function inspectStorageLayoutMigration(input: {
    projectRoot: string;
    localRoot?: string;
}): Promise<OperatingStorageMigrationResult & {
    recordCount: number;
}>;
/**
 * Byte-exact inverse: rebuild the SPEC-002 layout from the v1.3 `.state/` view.
 * Restores `records/sha256/<pp>/<rest>.json` from `records.jsonl` via the
 * pipeline's `reconstructDirectoryLayoutFromJsonl`, copies the events log and
 * checkpoint back to their SPEC-002 locations, and removes `.state/`.
 */
export declare function rollbackStorageLayoutMigration(input: {
    projectRoot: string;
    localRoot?: string;
}): Promise<OperatingStorageMigrationResult>;
//# sourceMappingURL=migration.d.ts.map