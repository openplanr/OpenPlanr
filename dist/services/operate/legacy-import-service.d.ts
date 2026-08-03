import { type OperatingMigrationRecord } from './types.js';
declare const LEGACY_ROOT = ".planr/board";
export type LegacyOperatingKind = 'finding' | 'decision' | 'gap' | 'route' | 'outcome' | 'unknown';
export interface LegacyMigrationFilePreview {
    path: string;
    digest: `sha256:${string}`;
    size: number;
    rows: number;
}
export interface LegacyMigrationRowPreview {
    sourceId: string;
    sourcePath: string;
    sourceDigest: `sha256:${string}`;
    legacyKind: LegacyOperatingKind;
    legacyId: string | null;
    recordDigest: `sha256:${string}`;
    eventId: string;
    targetId: string;
    disposition: 'import' | 'already-imported' | 'duplicate' | 'conflict';
    duplicateOf?: string;
}
export interface OperatingMigrationInspection {
    record: OperatingMigrationRecord | null;
    sourcePath: typeof LEGACY_ROOT | null;
    files: LegacyMigrationFilePreview[];
    rows: LegacyMigrationRowPreview[];
    counts: {
        files: number;
        bytes: number;
        importable: number;
        alreadyImported: number;
        duplicates: number;
        conflicts: number;
    };
}
interface LegacyImportHooks {
    beforeTransition?: (transition: 'lock' | 'backup' | 'record' | 'event' | 'metadata' | 'checkpoint', index?: number) => Promise<void> | void;
}
export declare function inspectOperatingMigration(input: {
    projectRoot: string;
    localRoot?: string;
    now?: string;
}): Promise<OperatingMigrationInspection>;
export declare function applyOperatingMigration(input: {
    projectRoot: string;
    confirmed: boolean;
    localRoot?: string;
    now?: string;
} & LegacyImportHooks): Promise<OperatingMigrationRecord | null>;
export declare function rollbackOperatingMigration(input: {
    projectRoot: string;
    migrationId: string;
    confirmed: boolean;
    localRoot?: string;
    now?: string;
}): Promise<OperatingMigrationRecord>;
export {};
//# sourceMappingURL=legacy-import-service.d.ts.map