import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdvisorAdapter } from '../../src/services/operate/advisors.js';
import { canonicalize } from '../../src/services/operate/canonical.js';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
} from '../../src/services/operate/config.js';
import { runOperatingCycle } from '../../src/services/operate/engine.js';
import {
  logEntryToOperatingRecord,
  OperatingEventStore,
  type OperatingRecordsLogEntry,
} from '../../src/services/operate/event-store.js';
import { executeOperateAction } from '../../src/services/operate/index.js';
import {
  assertCommittedOperatingView,
  type JournalWrite,
  prepareJournalTransaction,
  readJournal,
  recoverOperatingTransactions,
} from '../../src/services/operate/journal.js';
import {
  applyStorageLayoutMigration,
  detectOperatingStorageLayout,
  inspectStorageLayoutMigration,
  migrateOperatingStorageLayoutOnOpen,
  rollbackStorageLayoutMigration,
} from '../../src/services/operate/migration.js';
import { resolveOperatingPipelineRoot } from '../../src/services/operate/protocol.js';
import type { OperatingCheckpoint, OperatingEventHead } from '../../src/services/operate/types.js';
import {
  ensureOperatingDirectories,
  type OperatingPaths,
  resolveOperatingPaths,
} from '../../src/services/operate/workspace.js';

/**
 * FR5 / E-005 — automatic and explicit SPEC-002 (v1.2) -> Protocol v1.3
 * storage-layout migration (`src/services/operate/migration.ts`).
 *
 * Every test constructs a *genuine* SPEC-002 layout on disk: a real Operating
 * Board project is initialized and driven through one real cycle so it holds
 * authentic events, content-addressed records, and a signed checkpoint; that
 * v1.3 `.state/` view is then rewritten into the SPEC-002 shape the migration
 * consumes — `events.jsonl` at the operate root, a directory-per-digest-prefix
 * `records/sha256/<pp>/<rest>.json` tree of canonical `operating-record`
 * envelopes, and `checkpoints/current.json`. The down-conversion uses only
 * `event-store`'s field mapping and `canonicalize` (never `migration.ts`), so
 * the fixture is independent of the code under test.
 *
 * The suite exercises the migration transform end-to-end: automatic migration on
 * a mutating command, digest/event preservation proven by checkpoint
 * revalidation, byte-exact rollback, crash recovery in both journal windows, and
 * idempotence. It lives under `tests/integration/operate-*.test.ts` so it runs
 * sequentially in `vitest.heavy.config.ts` alongside the other fsynced
 * write-ahead-journal suites (it is excluded from the default pool).
 */

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function pathExists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

/**
 * One advisor role emits a medium-severity DEV finding plus a decision, and the
 * chair emits a merge proposal. All classify to v1.2 routes, so every persisted
 * record is a genuine v1.2 `operating-record` — exactly what a SPEC-002 project
 * held, with no v1.3 content that a downgraded fixture could never have carried.
 */
function routeAdapter(): AdvisorAdapter {
  return {
    id: 'storage-migration-fixture',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    capability: 'analysis-high',
    async invoke(input) {
      const evidenceRef = input.evidence.items[0]?.id;
      if (!evidenceRef || input.roleId === 'technology-risk') {
        return { outcome: 'quiet', proposals: [], gaps: [], conflicts: [] };
      }
      if (input.roleId === 'chair') {
        return {
          outcome: 'proposals',
          proposals: [
            {
              proposalKey: 'agent-route',
              type: 'merge',
              title: 'Prepare a health evidence brief',
              problem: 'Reviewers need a concise local synthesis of the evidence.',
              proposal: 'Generate a reviewable markdown brief without external publication.',
              impact: 2,
              confidence: 3,
              ease: 5,
              severity: 'low',
              evidenceRefs: [evidenceRef],
            },
          ],
          gaps: [],
          conflicts: [],
        };
      }
      return {
        outcome: 'proposals',
        proposals: [
          {
            proposalKey: 'dev-route',
            type: 'finding',
            title: 'Harden service health reporting',
            problem: 'Health behavior is not represented by a reviewed specification.',
            proposal: 'Create a bounded specification with a measurable completion outcome.',
            impact: 3,
            confidence: 3,
            ease: 4,
            severity: 'medium',
            evidenceRefs: [evidenceRef],
          },
          {
            proposalKey: 'owner-route',
            type: 'decision',
            title: 'Choose the health-reporting owner',
            problem: 'The accountable decision owner is not recorded.',
            proposal: 'Record Product owner as the accountable owner.',
            impact: 2,
            confidence: 3,
            ease: 5,
            severity: 'low',
            evidenceRefs: [evidenceRef],
          },
        ],
        gaps: [],
        conflicts: [],
      };
    },
  };
}

interface Spec002Fixture {
  projectRoot: string;
  localRoot: string;
  paths: OperatingPaths;
  /** SPEC-002 `events.jsonl` bytes (verbatim from the genuine v1.3 event log). */
  eventsBytes: Buffer;
  /** The pre-migration signed checkpoint captured before down-conversion. */
  checkpoint: OperatingCheckpoint;
  /** Every content-address digest the pre-migration checkpoint attests. */
  recordDigests: `sha256:${string}`[];
  /** The genuine records-log entries the v1.3 project persisted. */
  logEntries: OperatingRecordsLogEntry[];
  /** Event head the genuine v1.3 project committed. */
  eventHead: OperatingEventHead;
}

/**
 * Build a genuine SPEC-002-layout project on disk and capture the pre-migration
 * invariants (event log, checkpoint, record digests) used to prove preservation.
 */
async function seedSpec002Project(slug: string): Promise<Spec002Fixture> {
  const projectRoot = await temporaryDirectory(`openplanr-operate-storage-${slug}-project-`);
  const localRoot = await temporaryDirectory(`openplanr-operate-storage-${slug}-local-`);
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(
    join(projectRoot, 'service.ts'),
    'export function health(): string { return "ok"; }\n',
  );
  await execFileAsync('git', ['add', 'service.ts'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });

  const preview = await prepareOperatingInitialization({
    projectRoot,
    localRoot,
    profile: 'custom',
    decisionOwner: 'Product owner',
    planningEngine: 'openplanr',
    runtime: 'codex',
    cadence: 'manual',
    timezone: 'UTC',
    sensitivityCeiling: 'internal',
    enabledProviders: ['repository', 'git'],
    customProfile: {
      enabledRoles: ['strategy-finance', 'technology-risk', 'chair'],
      enabledProviders: ['repository', 'git'],
      caps: { surfacedFindings: 10, newSpecs: 3, openDecisions: 3, agentArtifacts: 2 },
      budgets: {
        maxFiles: 1_000,
        maxItems: 2_000,
        maxBytes: 10 * 1024 * 1024,
        maxDurationMs: 60_000,
      },
    },
    charter: {
      purpose: 'Exercise the SPEC-002 -> v1.3 storage-layout migration.',
      goals: ['Keep the migration lossless and reversible.'],
    },
    now: '2026-07-28T12:00:00.000Z',
  });
  await applyOperatingInitialization({
    projectRoot,
    localRoot,
    preview,
    confirmationDigest: preview.previewDigest,
  });

  // One genuine cycle mints authentic events, route/finding/decision records, and
  // advisor-result records against real repository evidence.
  await runOperatingCycle({
    projectRoot,
    localRoot,
    adapter: routeAdapter(),
    confirmed: true,
    now: new Date('2026-07-31T08:00:00.000Z'),
  });

  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  const store = new OperatingEventStore(projectRoot, { localRoot });
  const checkpoint = await store.writeCheckpoint();
  const eventHead = (await store.replay()).eventHead;

  const eventsBytes = await readFile(paths.events);
  const checkpointBytes = await readFile(paths.checkpoint);
  const logEntries = (await readFile(paths.records, 'utf8'))
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as OperatingRecordsLogEntry);
  expect(logEntries.length).toBeGreaterThan(0);

  // Down-convert `.state/` into the SPEC-002 directory-per-digest layout. A
  // SPEC-002 project was v1.2 throughout, so each record is written as the
  // canonical v1.2 `operating-record` envelope (protocolVersion 1.2.0) — the
  // exact bytes the per-file layout stored. This uses only event-store field
  // shapes and `canonicalize`, never the migration under test.
  for (const entry of logEntries) {
    const envelope = {
      kind: 'operating-record' as const,
      schemaVersion: entry.schemaVersion,
      protocolVersion: '1.2.0' as const,
      digest: entry.digest,
      recordType: entry.recordType,
      createdAt: entry.createdAt,
      correlationId: entry.correlationId,
      contentDigest: entry.contentDigest,
      content: entry.content,
    };
    const hex = entry.digest.slice('sha256:'.length);
    const target = join(paths.root, 'records', 'sha256', hex.slice(0, 2), `${hex.slice(2)}.json`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, canonicalize(envelope));
  }
  await writeFile(join(paths.root, 'events.jsonl'), eventsBytes);
  await mkdir(join(paths.root, 'checkpoints'), { recursive: true });
  await writeFile(join(paths.root, 'checkpoints', 'current.json'), checkpointBytes);
  await rm(paths.state, { recursive: true, force: true });

  // Confirm a genuine SPEC-002 layout is on disk: legacy paths present, no v1.3.
  expect(await detectOperatingStorageLayout(projectRoot, { localRoot })).toBe('v1.2');
  expect(await pathExists(join(paths.root, 'events.jsonl'))).toBe(true);
  expect(await pathExists(join(paths.root, 'checkpoints', 'current.json'))).toBe(true);
  expect(await pathExists(join(paths.root, 'records', 'sha256'))).toBe(true);
  expect(await pathExists(paths.state)).toBe(false);
  // A genuine SPEC-002 project predates Protocol v1.3, so every record envelope
  // is v1.2. Guarding this keeps the fixture authentic and keeps rollback
  // byte-exact (the reverse transform restores v1.2 envelopes).
  expect(
    logEntries.every((entry) => logEntryToOperatingRecord(entry).protocolVersion === '1.2.0'),
  ).toBe(true);

  return {
    projectRoot,
    localRoot,
    paths,
    eventsBytes,
    checkpoint,
    recordDigests: checkpoint.recordDigests,
    logEntries,
    eventHead,
  };
}

/** Every SPEC-002 record file path relative to `records/sha256`. */
async function legacyRecordEnvelopes(
  paths: OperatingPaths,
): Promise<Array<Record<string, unknown> & { digest: `sha256:${string}` }>> {
  const dir = join(paths.root, 'records', 'sha256');
  const out: Array<Record<string, unknown> & { digest: `sha256:${string}` }> = [];
  for (const prefix of await readdir(dir).catch(() => [])) {
    for (const name of await readdir(join(dir, prefix)).catch(() => [])) {
      out.push(JSON.parse(await readFile(join(dir, prefix, name), 'utf8')));
    }
  }
  return out.sort((left, right) => left.digest.localeCompare(right.digest));
}

/**
 * Reproduce the migration's exact multi-material journal writes (events,
 * records.jsonl via the installed pipeline transform, checkpoint) and the
 * deterministic transaction id it derives, so a crash residue can be staged
 * through the real journal primitives on the very transaction the migration
 * would run.
 */
async function migrationJournalTransaction(
  fx: Spec002Fixture,
): Promise<{ transactionId: string; previewDigest: `sha256:${string}`; writes: JournalWrite[] }> {
  const root = resolveOperatingPipelineRoot();
  expect(root).toBeTruthy();
  const transform = (await import(
    pathToFileURL(join(root as string, 'lib', 'operate', 'records-migration.mjs')).href
  )) as {
    migrateRecordsDirectoryToJsonl(
      records: unknown[],
      options?: { eventCount?: number },
    ): { lines: string[]; migrationRecord: Record<string, unknown> };
  };
  const legacy = await legacyRecordEnvelopes(fx.paths);
  const { lines, migrationRecord } = transform.migrateRecordsDirectoryToJsonl(legacy, {
    eventCount: fx.eventHead.sequence,
  });
  const checkpointBytes = await readFile(
    join(fx.paths.root, 'checkpoints', 'current.json'),
    'utf8',
  );
  return {
    transactionId: `TXN-${migrationRecord.id as string}`,
    previewDigest: migrationRecord.previewDigest as `sha256:${string}`,
    writes: [
      {
        relativePath: '.planr/operate/.state/events.jsonl',
        content: fx.eventsBytes.toString('utf8'),
        operation: 'create',
      },
      {
        relativePath: '.planr/operate/.state/records.jsonl',
        content: lines.length > 0 ? `${lines.join('\n')}\n` : '',
        operation: 'create',
      },
      {
        relativePath: '.planr/operate/.state/checkpoint.json',
        content: checkpointBytes,
        operation: 'create',
      },
    ],
  };
}

/** Recursive relative-path -> hex-byte snapshot of a directory tree. */
async function snapshotTree(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(current: string, base: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const absolute = join(current, entry.name);
      const relative = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(absolute, relative);
      } else {
        out.set(relative, (await readFile(absolute)).toString('hex'));
      }
    }
  }
  await walk(dir, '');
  return out;
}

async function readEveryRecord(fx: Spec002Fixture): Promise<number> {
  const store = new OperatingEventStore(fx.projectRoot, { localRoot: fx.localRoot });
  let readable = 0;
  for (const digest of fx.recordDigests) {
    await store.readRecord(digest);
    readable += 1;
  }
  return readable;
}

async function assertV13Present(paths: OperatingPaths): Promise<void> {
  for (const target of [paths.events, paths.records, paths.checkpoint]) {
    expect(await pathExists(target)).toBe(true);
  }
}

async function assertLegacyGone(paths: OperatingPaths): Promise<void> {
  expect(await pathExists(join(paths.root, 'events.jsonl'))).toBe(false);
  expect(await pathExists(join(paths.root, 'records', 'sha256'))).toBe(false);
  expect(await pathExists(join(paths.root, 'checkpoints', 'current.json'))).toBe(false);
}

describe('operate SPEC-002 -> v1.3 storage-layout migration (FR5 / E-005)', () => {
  it('auto-migrates a genuine SPEC-002 project on a mutating command, then the command succeeds', async () => {
    const fx = await seedSpec002Project('auto');

    // A mutating action opens the SPEC-002 project; the migration hook runs
    // before the handler and completes the journal-safe v1.3 migration first.
    const result = await executeOperateAction({
      action: 'cycles.recover',
      projectRoot: fx.projectRoot,
      interactive: false,
      arguments: { cycleId: 'CYCLE-001' },
      options: { localRoot: fx.localRoot, json: true, yes: true },
    });
    expect(result.ok).toBe(true);

    // The v1.3 `.state/` view exists and the SPEC-002 layout is gone.
    expect(await detectOperatingStorageLayout(fx.projectRoot, { localRoot: fx.localRoot })).toBe(
      'v1.3',
    );
    await assertV13Present(fx.paths);
    await assertLegacyGone(fx.paths);

    // The migration committed through the journal: no partial transaction remains.
    await expect(
      assertCommittedOperatingView(fx.projectRoot, { localRoot: fx.localRoot }),
    ).resolves.toBeUndefined();
  });

  it('preserves every record digest and event, verified by checkpoint revalidation', async () => {
    const fx = await seedSpec002Project('preserve');
    const store = new OperatingEventStore(fx.projectRoot, { localRoot: fx.localRoot });

    const migration = await applyStorageLayoutMigration({
      projectRoot: fx.projectRoot,
      localRoot: fx.localRoot,
    });
    expect(migration).toMatchObject({ migrated: true, layout: 'v1.2' });
    expect(migration.recordCount).toBe(fx.logEntries.length);

    // The migrated checkpoint still validates against the published protocol.
    const migratedCheckpoint = await store.readCheckpoint();
    expect(migratedCheckpoint).not.toBeNull();
    expect(migratedCheckpoint?.eventHead).toEqual(fx.checkpoint.eventHead);
    expect(migratedCheckpoint?.stateHash).toBe(fx.checkpoint.stateHash);
    expect(migratedCheckpoint?.recordDigests).toEqual(fx.recordDigests);

    // Every attested record survives content-address revalidation — the exact
    // digest recomputation the engine performs in `readRecord`.
    expect(await readEveryRecord(fx)).toBe(fx.recordDigests.length);

    // The event log is intact: the same head the SPEC-002 project committed.
    const replay = await store.replay();
    expect(replay.eventHead).toEqual(fx.eventHead);

    // Re-derive a checkpoint with the engine's own recomputation; every record
    // digest and the reduced event/state head match the pre-migration checkpoint.
    const rederived = await store.writeCheckpoint();
    expect(rederived.recordDigests).toEqual(fx.recordDigests);
    expect(rederived.eventHead).toEqual(fx.checkpoint.eventHead);
    expect(rederived.stateHash).toBe(fx.checkpoint.stateHash);
  });

  it('rolls back to the byte-exact prior SPEC-002 layout', async () => {
    const fx = await seedSpec002Project('rollback');

    // Full-tree byte snapshot of the committed SPEC-002 layout before migration.
    const before = await snapshotTree(fx.paths.root);
    expect([...before.keys()]).toContain('events.jsonl');
    expect([...before.keys()]).toContain('checkpoints/current.json');
    expect([...before.keys()].some((key) => key.startsWith('records/sha256/'))).toBe(true);

    const forward = await applyStorageLayoutMigration({
      projectRoot: fx.projectRoot,
      localRoot: fx.localRoot,
    });
    expect(forward.migrated).toBe(true);
    expect(await detectOperatingStorageLayout(fx.projectRoot, { localRoot: fx.localRoot })).toBe(
      'v1.3',
    );

    const rolledBack = await rollbackStorageLayoutMigration({
      projectRoot: fx.projectRoot,
      localRoot: fx.localRoot,
    });
    expect(rolledBack).toMatchObject({ migrated: true, layout: 'v1.2' });
    expect(await detectOperatingStorageLayout(fx.projectRoot, { localRoot: fx.localRoot })).toBe(
      'v1.2',
    );

    // Byte-exact: identical file set and identical bytes for every file, and no
    // `.state/` residue survives the rollback.
    const after = await snapshotTree(fx.paths.root);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [relative, bytes] of before) {
      expect(after.get(relative), `bytes for ${relative}`).toBe(bytes);
    }
    expect(await pathExists(fx.paths.state)).toBe(false);
  });

  it('recovers cleanly from a crash injected BEFORE the journal reaches staged-fsynced', async () => {
    const fx = await seedSpec002Project('crash-before');
    const transaction = await migrationJournalTransaction(fx);

    // Stage the migration's real multi-material transaction, then reproduce the
    // residue of a crash before the staged-fsynced flip: the manifest is rewound
    // to 'prepared' and nothing was promoted into `.state/`.
    await ensureOperatingDirectories(fx.projectRoot, { localRoot: fx.localRoot });
    const prepared = await prepareJournalTransaction(fx.projectRoot, {
      writes: transaction.writes,
      eventHead: fx.eventHead,
      previewDigest: transaction.previewDigest,
      transactionId: transaction.transactionId,
      localRoot: fx.localRoot,
    });
    expect(prepared.record.state).toBe('staged-fsynced');
    const manifest = await readJournal(prepared.manifestPath);
    manifest.state = 'prepared';
    await writeFile(prepared.manifestPath, `${canonicalize(manifest)}\n`, { mode: 0o600 });

    // `ensureOperatingDirectories` (run by the real migration before it prepares
    // the journal) has created an empty `.state/`, so the residue reads as v1.3
    // even though nothing was promoted and the SPEC-002 backup is authoritative.
    expect(await detectOperatingStorageLayout(fx.projectRoot, { localRoot: fx.localRoot })).toBe(
      'v1.3',
    );
    expect(await pathExists(fx.paths.events)).toBe(false);
    expect(await pathExists(join(fx.paths.root, 'events.jsonl'))).toBe(true);
    expect((await readJournal(prepared.manifestPath)).state).toBe('prepared');

    // The next mutating open rolls back the residue and re-migrates cleanly.
    const result = await migrateOperatingStorageLayoutOnOpen(fx.projectRoot, {
      localRoot: fx.localRoot,
    });
    expect(result.migrated).toBe(true);

    await assertV13Present(fx.paths);
    await assertLegacyGone(fx.paths);
    expect(await readEveryRecord(fx)).toBe(fx.recordDigests.length);
    await expect(
      assertCommittedOperatingView(fx.projectRoot, { localRoot: fx.localRoot }),
    ).resolves.toBeUndefined();
    expect(await recoverOperatingTransactions(fx.projectRoot, { localRoot: fx.localRoot })).toEqual(
      [],
    );
  });

  it('recovers cleanly from a crash injected AFTER staged-fsynced with a partially promoted .state/', async () => {
    const fx = await seedSpec002Project('crash-after');
    const transaction = await migrationJournalTransaction(fx);

    // Stage the real transaction, then reproduce a hard crash mid-promotion: the
    // first write (events.jsonl) landed in `.state/`, the journal is still
    // staged-fsynced, and the SPEC-002 backup is untouched. This is the window
    // whose previous handling deleted the backup against a partial view.
    await ensureOperatingDirectories(fx.projectRoot, { localRoot: fx.localRoot });
    const prepared = await prepareJournalTransaction(fx.projectRoot, {
      writes: transaction.writes,
      eventHead: fx.eventHead,
      previewDigest: transaction.previewDigest,
      transactionId: transaction.transactionId,
      localRoot: fx.localRoot,
    });
    expect(prepared.record.state).toBe('staged-fsynced');
    await mkdir(fx.paths.state, { recursive: true });
    await writeFile(fx.paths.events, fx.eventsBytes);

    // A bare/partial `.state/` reads as v1.3, yet the backup is still intact.
    expect(await detectOperatingStorageLayout(fx.projectRoot, { localRoot: fx.localRoot })).toBe(
      'v1.3',
    );
    expect(await pathExists(join(fx.paths.root, 'events.jsonl'))).toBe(true);
    expect(await pathExists(fx.paths.records)).toBe(false);
    expect((await readJournal(prepared.manifestPath)).state).toBe('staged-fsynced');

    // The next mutating open must roll back the partial promotion and re-migrate
    // from the intact backup — no data loss, no stuck journal.
    const result = await migrateOperatingStorageLayoutOnOpen(fx.projectRoot, {
      localRoot: fx.localRoot,
    });
    expect(result.migrated).toBe(true);

    await assertV13Present(fx.paths);
    await assertLegacyGone(fx.paths);
    expect(await readEveryRecord(fx)).toBe(fx.recordDigests.length);
    await expect(
      assertCommittedOperatingView(fx.projectRoot, { localRoot: fx.localRoot }),
    ).resolves.toBeUndefined();
    expect(await recoverOperatingTransactions(fx.projectRoot, { localRoot: fx.localRoot })).toEqual(
      [],
    );
  });

  it('is a no-op when run against an already-migrated project', async () => {
    const fx = await seedSpec002Project('idempotent');

    const first = await applyStorageLayoutMigration({
      projectRoot: fx.projectRoot,
      localRoot: fx.localRoot,
    });
    expect(first.migrated).toBe(true);

    const migratedTree = await snapshotTree(fx.paths.state);

    // A second migration and the automatic-on-open entry are both no-ops.
    const second = await applyStorageLayoutMigration({
      projectRoot: fx.projectRoot,
      localRoot: fx.localRoot,
    });
    expect(second).toMatchObject({ migrated: false, layout: 'v1.3' });
    const onOpen = await migrateOperatingStorageLayoutOnOpen(fx.projectRoot, {
      localRoot: fx.localRoot,
    });
    expect(onOpen.migrated).toBe(false);

    // Read-only inspection also reports the settled v1.3 layout with no records
    // left to migrate.
    const inspection = await inspectStorageLayoutMigration({
      projectRoot: fx.projectRoot,
      localRoot: fx.localRoot,
    });
    expect(inspection).toMatchObject({ migrated: false, layout: 'v1.3', recordCount: 0 });

    // The committed `.state/` view is byte-unchanged by the no-op runs, and the
    // SPEC-002 layout stays gone.
    const afterTree = await snapshotTree(fx.paths.state);
    expect([...afterTree.entries()].sort()).toEqual([...migratedTree.entries()].sort());
    await assertLegacyGone(fx.paths);
  });
});
