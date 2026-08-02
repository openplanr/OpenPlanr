import { access, mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalize } from './canonical.js';
import { OperatingEventStore } from './event-store.js';
import { applyJournalTransaction, prepareJournalTransaction, recoverOperatingTransactions, } from './journal.js';
import { assertOperatingArtifact, resolveOperatingPipelineRoot } from './protocol.js';
import { OperateError } from './types.js';
import { ensureOperatingDirectories, resolveOperatingPaths } from './workspace.js';
const STATE_EVENTS = '.planr/operate/.state/events.jsonl';
const STATE_RECORDS = '.planr/operate/.state/records.jsonl';
const STATE_CHECKPOINT = '.planr/operate/.state/checkpoint.json';
const MIGRATION_TRANSFORM_MODULE = ['lib', 'operate', 'records-migration.mjs'];
let cachedTransform;
/**
 * Load the records-container transform directly from the installed pipeline. The
 * v1.3 storage layout is only reachable when the pipeline ships this module, so
 * we fail closed with a named error rather than degrade silently.
 */
async function loadRecordsMigration() {
    const root = resolveOperatingPipelineRoot();
    if (!root) {
        throw new OperateError('E_PIPELINE_NOT_INSTALLED', 'The v1.3 storage-layout migration requires the installed pipeline package.', {
            recovery: 'Run `npm install -g openplanr@latest` (without `--omit=optional`), then re-run.',
        });
    }
    cachedTransform ??= import(pathToFileURL(path.join(root, ...MIGRATION_TRANSFORM_MODULE)).href).then((value) => value);
    return cachedTransform;
}
async function fileExists(target) {
    return access(target).then(() => true, () => false);
}
function legacyEventsPath(operateRoot) {
    return path.join(operateRoot, 'events.jsonl');
}
function legacyCheckpointPath(operateRoot) {
    return path.join(operateRoot, 'checkpoints', 'current.json');
}
function legacyRecordsDir(operateRoot) {
    return path.join(operateRoot, 'records', 'sha256');
}
/**
 * Detect which storage layout is on disk. `.state/` (or its events log) means the
 * project is already on v1.3; any SPEC-002 internal without `.state/` means v1.2.
 */
export async function detectOperatingStorageLayout(projectRoot, options = {}) {
    const paths = resolveOperatingPaths(projectRoot, options);
    if ((await fileExists(paths.state)) || (await fileExists(paths.events)))
        return 'v1.3';
    if ((await fileExists(legacyEventsPath(paths.root))) ||
        (await fileExists(legacyRecordsDir(paths.root))) ||
        (await fileExists(legacyCheckpointPath(paths.root)))) {
        return 'v1.2';
    }
    return 'absent';
}
async function readLegacyRecords(operateRoot) {
    const recordsDir = legacyRecordsDir(operateRoot);
    const records = [];
    for (const prefix of await readdir(recordsDir).catch(() => [])) {
        if (!/^[a-f0-9]{2}$/.test(prefix))
            continue;
        for (const name of await readdir(path.join(recordsDir, prefix)).catch(() => [])) {
            if (!/^[a-f0-9]{62}\.json$/.test(name))
                continue;
            const raw = await readFile(path.join(recordsDir, prefix, name), 'utf8');
            records.push(JSON.parse(raw));
        }
    }
    return records.sort((left, right) => left.digest.localeCompare(right.digest));
}
async function removeLegacyLayout(operateRoot) {
    await unlink(legacyEventsPath(operateRoot)).catch(() => undefined);
    await rm(path.join(operateRoot, 'checkpoints'), { recursive: true, force: true });
    await rm(path.join(operateRoot, 'records'), { recursive: true, force: true });
}
/**
 * Idempotent, journal-safe SPEC-002 -> v1.3 migration. Writes the `.state/`
 * internals through the write-ahead journal first (so a crash mid-migration
 * unwinds cleanly), then removes the SPEC-002 tree only after the journal
 * commits. A crash between commit and cleanup leaves a resolvable `.state/`
 * project whose stale SPEC-002 residue is removed on the next open.
 */
export async function applyStorageLayoutMigration(input) {
    const layout = await detectOperatingStorageLayout(input.projectRoot, {
        localRoot: input.localRoot,
    });
    if (layout === 'v1.3') {
        const paths = resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot });
        const legacyPresent = (await fileExists(legacyEventsPath(paths.root))) ||
            (await fileExists(legacyRecordsDir(paths.root))) ||
            (await fileExists(legacyCheckpointPath(paths.root)));
        if (!legacyPresent) {
            // Fully migrated (or a prior interrupted migration already reconciled):
            // there is no SPEC-002 backup left to reconcile against.
            return { migrated: false, layout };
        }
        // `.state/` and the SPEC-002 backup coexist, so a migration was interrupted.
        // Roll back any non-terminal migration transaction FIRST: a crash mid-
        // promotion leaves a partial `.state/` that detects as v1.3 while the SPEC-002
        // backup is still the only complete copy. Removing the backup against that
        // partial view (the previous behavior) destroyed the unpromoted records.
        // Recovery reverts the partial `.state/` writes byte-exact before we decide.
        await recoverOperatingTransactions(input.projectRoot, { localRoot: input.localRoot });
        if (await fileExists(paths.events)) {
            // The event log survived recovery, so the v1.3 view is committed and
            // durable (a crash between commit and cleanup). The residue is safe to drop.
            await removeLegacyLayout(paths.root);
            return { migrated: false, layout };
        }
        // Recovery reverted a partial promotion; discard the now-empty `.state/`
        // residue and re-migrate from the intact SPEC-002 backup.
        await rm(paths.state, { recursive: true, force: true });
        return applyStorageLayoutMigration(input);
    }
    if (layout === 'absent')
        return { migrated: false, layout };
    const paths = resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot });
    const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
    const head = (await store.replay()).eventHead;
    const legacyRecords = await readLegacyRecords(paths.root);
    const transform = await loadRecordsMigration();
    const { lines, migrationRecord } = transform.migrateRecordsDirectoryToJsonl(legacyRecords, {
        eventCount: head.sequence,
        ...(input.now ? { migratedAt: input.now } : {}),
    });
    // Validate the transform output against the published Protocol v1.3 contract.
    await assertOperatingArtifact('operating-migration-record', migrationRecord);
    const previewDigest = migrationRecord.previewDigest;
    const migrationId = migrationRecord.id;
    const eventsBytes = await readFile(legacyEventsPath(paths.root), 'utf8').catch((error) => {
        if (error.code === 'ENOENT')
            return '';
        throw error;
    });
    const checkpointBytes = await readFile(legacyCheckpointPath(paths.root), 'utf8').catch((error) => {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    });
    await ensureOperatingDirectories(input.projectRoot, { localRoot: input.localRoot });
    const writes = [
        { relativePath: STATE_EVENTS, content: eventsBytes, operation: 'create' },
        {
            relativePath: STATE_RECORDS,
            content: lines.length > 0 ? `${lines.join('\n')}\n` : '',
            operation: 'create',
        },
        ...(checkpointBytes !== null
            ? [{ relativePath: STATE_CHECKPOINT, content: checkpointBytes, operation: 'create' }]
            : []),
    ];
    const transaction = await prepareJournalTransaction(input.projectRoot, {
        writes,
        eventHead: head,
        previewDigest,
        localRoot: input.localRoot,
        transactionId: `TXN-${migrationId}`,
        now: input.now,
    });
    await applyJournalTransaction(input.projectRoot, transaction, { currentEventHead: head });
    // The `.state/` view is committed; the SPEC-002 tree is now safe to remove.
    await removeLegacyLayout(paths.root);
    return { migrated: true, layout, recordCount: legacyRecords.length, migrationId };
}
/**
 * Automatic-on-open entry point. Any mutating operate action calls this before
 * it proceeds; it is a fast no-op for a v1.3 or uninitialized project and only
 * migrates a genuine SPEC-002-layout project. When the pipeline transform is
 * unavailable the layout is left untouched — the mutation fails downstream with
 * the standard pipeline-required error rather than half-migrating.
 */
export async function migrateOperatingStorageLayoutOnOpen(projectRoot, options = {}) {
    const layout = await detectOperatingStorageLayout(projectRoot, options);
    if (layout === 'v1.2' && !resolveOperatingPipelineRoot()) {
        return { migrated: false, layout };
    }
    return applyStorageLayoutMigration({ projectRoot, localRoot: options.localRoot });
}
/** Read-only inspection of what an automatic migration would do. */
export async function inspectStorageLayoutMigration(input) {
    const layout = await detectOperatingStorageLayout(input.projectRoot, {
        localRoot: input.localRoot,
    });
    const recordCount = layout === 'v1.2'
        ? (await readLegacyRecords(resolveOperatingPaths(input.projectRoot, input).root)).length
        : 0;
    return { migrated: false, layout, recordCount };
}
async function atomicWrite(target, content) {
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, target);
}
/**
 * Byte-exact inverse: rebuild the SPEC-002 layout from the v1.3 `.state/` view.
 * Restores `records/sha256/<pp>/<rest>.json` from `records.jsonl` via the
 * pipeline's `reconstructDirectoryLayoutFromJsonl`, copies the events log and
 * checkpoint back to their SPEC-002 locations, and removes `.state/`.
 */
export async function rollbackStorageLayoutMigration(input) {
    const paths = resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot });
    if (!(await fileExists(paths.state))) {
        return {
            migrated: false,
            layout: await detectOperatingStorageLayout(input.projectRoot, input),
        };
    }
    const transform = await loadRecordsMigration();
    const recordsRaw = await readFile(paths.records, 'utf8').catch((error) => {
        if (error.code === 'ENOENT')
            return '';
        throw error;
    });
    const lines = recordsRaw.split('\n').filter((line) => line.trim().length > 0);
    const layout = transform.reconstructDirectoryLayoutFromJsonl(lines);
    const recordsDir = legacyRecordsDir(paths.root);
    for (const [prefix, bucket] of layout) {
        for (const [rest, record] of bucket) {
            // The SPEC-002 per-file record body is the canonical operating-record with
            // no trailing newline, so the restored bytes match the original exactly.
            await atomicWrite(path.join(recordsDir, prefix, `${rest}.json`), canonicalize(record));
        }
    }
    const eventsBytes = await readFile(paths.events, 'utf8').catch(() => '');
    await atomicWrite(legacyEventsPath(paths.root), eventsBytes);
    const checkpointBytes = await readFile(paths.checkpoint, 'utf8').catch(() => null);
    if (checkpointBytes !== null) {
        await atomicWrite(legacyCheckpointPath(paths.root), checkpointBytes);
    }
    await rm(paths.state, { recursive: true, force: true });
    return { migrated: true, layout: 'v1.2', recordCount: lines.length };
}
//# sourceMappingURL=migration.js.map