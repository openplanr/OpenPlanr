import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256Digest } from '../../src/services/operate/canonical.js';
import { operatingProjectKey } from '../../src/services/operate/config.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import {
  applyOperatingMigration,
  inspectOperatingMigration,
  rollbackOperatingMigration,
} from '../../src/services/operate/legacy-import-service.js';
import { acquireOperatingLock } from '../../src/services/operate/lock-service.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';

const temporaryDirectories: string[] = [];
const REGISTER_HEADER = [
  '| ID | Date | Role | Title | Score | Lane | Status | Ref |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
];

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(root);
  return root;
}

async function fixture(
  lines: string[],
): Promise<{ projectRoot: string; localRoot: string; register: string }> {
  const projectRoot = await temporaryRoot('openplanr-operate-legacy-project-');
  const localRoot = await temporaryRoot('openplanr-operate-legacy-local-');
  const register = join(projectRoot, '.planr', 'board', 'register.md');
  await mkdir(join(projectRoot, '.planr', 'board'), { recursive: true });
  await writeFile(register, `${[...REGISTER_HEADER, ...lines].join('\n')}\n`);
  return { projectRoot, localRoot, register };
}

async function byteSnapshot(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else snapshot[relative(root, target)] = sha256Digest(await readFile(target));
    }
  }
  await visit(root);
  return snapshot;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

describe('legacy .planr/board migration', () => {
  it('reports no migration and performs no writes when the legacy directory is absent', async () => {
    const projectRoot = await temporaryRoot('openplanr-operate-legacy-none-');
    const localRoot = await temporaryRoot('openplanr-operate-legacy-none-local-');
    const beforeProject = await byteSnapshot(projectRoot);
    const beforeLocal = await byteSnapshot(localRoot);

    await expect(inspectOperatingMigration({ projectRoot, localRoot })).resolves.toEqual({
      record: null,
      sourcePath: null,
      files: [],
      rows: [],
      counts: {
        files: 0,
        bytes: 0,
        importable: 0,
        alreadyImported: 0,
        duplicates: 0,
        conflicts: 0,
      },
    });
    await expect(
      applyOperatingMigration({ projectRoot, localRoot, confirmed: true }),
    ).resolves.toBeNull();
    expect(await byteSnapshot(projectRoot)).toEqual(beforeProject);
    expect(await byteSnapshot(localRoot)).toEqual(beforeLocal);
  });

  it('previews rows/files, stores byte-exact backups, and appends one audit event per record', async () => {
    const { projectRoot, localRoot } = await fixture([
      '| F-1 | 2026-07-01 | CTO | Verify payment retries | 60 | DEV | open | SPEC-001 |',
      '| F-2 | 2026-07-02 | CEO | Select launch market | 40 | OWNER | open | decisions.md |',
    ]);
    const before = await byteSnapshot(join(projectRoot, '.planr', 'board'));
    const preview = await inspectOperatingMigration({
      projectRoot,
      localRoot,
      now: '2026-07-28T10:00:00.000Z',
    });

    expect(preview).toMatchObject({
      sourcePath: '.planr/board',
      record: {
        kind: 'operating-migration-record',
        state: 'previewed',
        conflicts: [],
      },
      counts: {
        files: 1,
        importable: 2,
        alreadyImported: 0,
        duplicates: 0,
        conflicts: 0,
      },
    });
    expect(preview.record?.mappings).toHaveLength(2);
    expect(preview.record?.mappings[0]).toEqual({
      sourceId: expect.any(String),
      targetId: expect.any(String),
      eventId: expect.any(String),
    });
    expect(preview.files).toEqual([
      {
        path: '.planr/board/register.md',
        digest: expect.stringMatching(/^sha256:/),
        size: expect.any(Number),
        rows: 2,
      },
    ]);
    const beforeConfirmationLocal = await byteSnapshot(localRoot);
    await expect(
      applyOperatingMigration({
        projectRoot,
        localRoot,
        confirmed: false,
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_AUTHORITY_REQUIRED' });
    expect(await byteSnapshot(localRoot)).toEqual(beforeConfirmationLocal);
    expect(await byteSnapshot(join(projectRoot, '.planr', 'board'))).toEqual(before);

    const applied = await applyOperatingMigration({
      projectRoot,
      localRoot,
      confirmed: true,
      now: '2026-07-28T10:01:00.000Z',
    });
    expect(applied).toMatchObject({ id: preview.record?.id, state: 'applied' });
    expect(await byteSnapshot(join(projectRoot, '.planr', 'board'))).toEqual(before);

    const replay = await new OperatingEventStore(projectRoot, { localRoot }).replay();
    const imports = replay.events.filter((event) => event.type === 'migration.legacy-imported');
    expect(imports).toHaveLength(2);
    expect(imports.every((event) => event.actor.kind === 'migration')).toBe(true);
    expect(imports.every((event) => event.cycleId === 'CYCLE-000')).toBe(true);
    expect(imports.every((event) => event.evidenceRefs.length === 0)).toBe(true);
    expect(
      imports.every(
        (event) =>
          (event.payload as { sourceDigest?: string }).sourceDigest === preview.files[0].digest,
      ),
    ).toBe(true);
    const recordDigests = [
      ...new Set(
        imports.map(
          (event) => (event.payload as { recordDigest: `sha256:${string}` }).recordDigest,
        ),
      ),
    ];
    expect(recordDigests).toHaveLength(1);
    await expect(
      new OperatingEventStore(projectRoot, { localRoot }).readRecord(recordDigests[0]),
    ).resolves.toMatchObject({
      recordType: 'migration',
      content: {
        kind: 'operating-migration-record',
        id: applied?.id,
      },
    });

    const backup = join(
      resolveOperatingPaths(projectRoot, { localRoot }).localRoot,
      'migration-backups',
      applied?.id as string,
    );
    const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')) as {
      files: Array<{ backupFile: string; digest: string }>;
    };
    expect(manifest.files).toHaveLength(1);
    expect(sha256Digest(await readFile(join(backup, manifest.files[0].backupFile)))).toBe(
      manifest.files[0].digest,
    );

    const reapplied = await applyOperatingMigration({
      projectRoot,
      localRoot,
      confirmed: true,
    });
    expect(reapplied).toEqual(applied);
    expect(
      (await new OperatingEventStore(projectRoot, { localRoot }).replay()).events.filter(
        (event) => event.type === 'migration.legacy-imported',
      ),
    ).toHaveLength(2);
  });

  it('deduplicates byte-equivalent legacy rows without duplicating events', async () => {
    const row = '| F-1 | 2026-07-01 | CTO | Verify payment retries | 60 | DEV | open | SPEC-001 |';
    const { projectRoot, localRoot } = await fixture([row, row]);
    const preview = await inspectOperatingMigration({ projectRoot, localRoot });

    expect(preview.counts).toMatchObject({
      importable: 1,
      duplicates: 1,
      conflicts: 0,
    });
    expect(preview.rows.map((entry) => entry.disposition)).toEqual(['import', 'duplicate']);

    await applyOperatingMigration({ projectRoot, localRoot, confirmed: true });
    expect(
      (await new OperatingEventStore(projectRoot, { localRoot }).replay()).events.filter(
        (event) => event.type === 'migration.legacy-imported',
      ),
    ).toHaveLength(1);
  });

  it('reports conflicting legacy IDs and refuses to write migration state', async () => {
    const { projectRoot, localRoot } = await fixture([
      '| F-1 | 2026-07-01 | CTO | Verify payment retries | 60 | DEV | open | SPEC-001 |',
      '| F-1 | 2026-07-02 | CTO | Replace payment retries | 45 | DEV | open | SPEC-002 |',
    ]);
    const before = await byteSnapshot(join(projectRoot, '.planr', 'board'));
    const preview = await inspectOperatingMigration({ projectRoot, localRoot });

    expect(preview.record).toMatchObject({
      state: 'conflict',
      conflicts: ['finding:F-1:conflicting-source-records'],
    });
    expect(preview.rows.every((row) => row.disposition === 'conflict')).toBe(true);
    await expect(
      applyOperatingMigration({ projectRoot, localRoot, confirmed: true }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_MIGRATION_CONFLICT' });
    expect(await byteSnapshot(join(projectRoot, '.planr', 'board'))).toEqual(before);
    expect((await new OperatingEventStore(projectRoot, { localRoot }).replay()).events).toEqual([]);
  });

  it('reports corrupt structured input without echoing or modifying its bytes', async () => {
    const projectRoot = await temporaryRoot('openplanr-operate-legacy-corrupt-');
    const localRoot = await temporaryRoot('openplanr-operate-legacy-corrupt-local-');
    const board = join(projectRoot, '.planr', 'board');
    await mkdir(board, { recursive: true });
    await writeFile(join(board, 'register.json'), '{"findings":[{"id":"F-1"},]}');
    const before = await byteSnapshot(board);

    const preview = await inspectOperatingMigration({ projectRoot, localRoot });
    expect(preview.record).toMatchObject({
      state: 'conflict',
      conflicts: ['.planr/board/register.json:corrupt-json'],
    });
    await expect(
      applyOperatingMigration({ projectRoot, localRoot, confirmed: true }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_MIGRATION_CONFLICT' });
    expect(await byteSnapshot(board)).toEqual(before);
  });

  it('rejects secret-shaped legacy IDs and file names before preview metadata is created', async () => {
    const sensitiveId = 'ghp_abcdefghijklmnopqrstuvwxyz';
    const { projectRoot, localRoot } = await fixture([
      `| ${sensitiveId} | 2026-07-01 | CTO | Hidden credential | 60 | DEV | open | SPEC-001 |`,
    ]);

    const preview = await inspectOperatingMigration({ projectRoot, localRoot });
    expect(JSON.stringify(preview)).not.toContain(sensitiveId);
    expect(preview).toMatchObject({
      rows: [],
      counts: { importable: 0, conflicts: 1 },
      record: {
        state: 'conflict',
        mappings: [],
        conflicts: ['.planr/board/register.md:3:missing-or-invalid-id'],
      },
    });
    await expect(
      applyOperatingMigration({ projectRoot, localRoot, confirmed: true }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_MIGRATION_CONFLICT' });
    expect(
      await readdir(resolveOperatingPaths(projectRoot, { localRoot }).migrations).catch(() => []),
    ).toEqual([]);

    const tokenFile = `npm_${'a'.repeat(24)}.md`;
    await writeFile(join(projectRoot, '.planr', 'board', tokenFile), '# sensitive file name\n');
    const error = await inspectOperatingMigration({ projectRoot, localRoot }).then(
      () => null,
      (failure: unknown) => failure,
    );
    expect(error).toMatchObject({ code: 'E_OPERATE_SECRET_DETECTED' });
    expect(JSON.stringify(error)).not.toContain(tokenFile);
  });

  it('uses the canonical project writer lock for migration', async () => {
    const { projectRoot, localRoot } = await fixture([
      '| F-1 | 2026-07-01 | CTO | Verify payment retries | 60 | DEV | open | SPEC-001 |',
    ]);
    let migrationLocked!: () => void;
    let continueMigration!: () => void;
    const atLock = new Promise<void>((resolve) => {
      migrationLocked = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      continueMigration = resolve;
    });
    const applying = applyOperatingMigration({
      projectRoot,
      localRoot,
      confirmed: true,
      async beforeTransition(transition) {
        if (transition !== 'backup') return;
        migrationLocked();
        await resume;
      },
    });
    await atLock;
    const head = (await new OperatingEventStore(projectRoot, { localRoot }).replay()).eventHead;
    const competingWriter = await acquireOperatingLock(projectRoot, {
      projectKey: operatingProjectKey(projectRoot),
      expectedEventHead: head,
      currentEventHead: head,
      localRoot,
    }).then(
      (lock) => ({ lock, error: null }),
      (error: unknown) => ({ lock: null, error }),
    );
    if (competingWriter.lock) await competingWriter.lock.release();
    continueMigration();
    expect(competingWriter.error).toMatchObject({ code: 'E_OPERATE_CYCLE_ACTIVE' });
    await expect(applying).resolves.toMatchObject({ state: 'applied' });
  });

  it('fails closed on event-head drift before writing backups, records, or migration metadata', async () => {
    const { projectRoot, localRoot } = await fixture([
      '| F-1 | 2026-07-01 | CTO | Verify payment retries | 60 | DEV | open | SPEC-001 |',
    ]);
    const digest = `sha256:${'a'.repeat(64)}` as const;
    const store = new OperatingEventStore(projectRoot, { localRoot });

    await expect(
      applyOperatingMigration({
        projectRoot,
        localRoot,
        confirmed: true,
        async beforeTransition(transition) {
          if (transition !== 'lock') return;
          await store.append({
            type: 'migration.legacy-imported',
            cycleId: 'CYCLE-000',
            entityId: 'MIG-concurrent',
            actor: { kind: 'migration', id: 'concurrent-test' },
            payload: {
              migrationId: 'MIG-concurrent',
              sourcePath: '.planr/board/concurrent.md',
              sourceDigest: digest,
              recordDigest: digest,
              backupManifestDigest: digest,
              legacyKind: 'unknown',
            },
          });
        },
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_ROUTE_DRIFT' });

    const paths = resolveOperatingPaths(projectRoot, { localRoot });
    expect(await readdir(join(paths.localRoot, 'migration-backups')).catch(() => [])).toEqual([]);
    expect(await readdir(paths.migrations).catch(() => [])).toEqual([]);
    expect(await readdir(paths.records).catch(() => [])).toEqual([]);
  });

  it('resumes an interrupted append idempotently and completes only missing events', async () => {
    const { projectRoot, localRoot } = await fixture([
      '| F-1 | 2026-07-01 | CTO | Verify payment retries | 60 | DEV | open | SPEC-001 |',
      '| F-2 | 2026-07-02 | CEO | Select launch market | 40 | OWNER | open | decisions.md |',
    ]);
    const before = await byteSnapshot(join(projectRoot, '.planr', 'board'));

    await expect(
      applyOperatingMigration({
        projectRoot,
        localRoot,
        confirmed: true,
        beforeTransition(transition, index) {
          if (transition === 'event' && index === 1) throw new Error('simulated interruption');
        },
      }),
    ).rejects.toThrow('simulated interruption');
    expect(
      (await new OperatingEventStore(projectRoot, { localRoot }).replay()).events.filter(
        (event) => event.type === 'migration.legacy-imported',
      ),
    ).toHaveLength(1);

    const applied = await applyOperatingMigration({
      projectRoot,
      localRoot,
      confirmed: true,
    });
    expect(applied?.state).toBe('applied');
    const events = (
      await new OperatingEventStore(projectRoot, { localRoot }).replay()
    ).events.filter((event) => event.type === 'migration.legacy-imported');
    expect(events).toHaveLength(2);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(2);
    expect(await byteSnapshot(join(projectRoot, '.planr', 'board'))).toEqual(before);
  });

  it('repairs a missing checkpoint after interruption without duplicating imported state', async () => {
    const { projectRoot, localRoot } = await fixture([
      '| F-1 | 2026-07-01 | CTO | Verify payment retries | 60 | DEV | open | SPEC-001 |',
    ]);

    await expect(
      applyOperatingMigration({
        projectRoot,
        localRoot,
        confirmed: true,
        beforeTransition(transition) {
          if (transition === 'checkpoint') throw new Error('simulated checkpoint interruption');
        },
      }),
    ).rejects.toThrow('simulated checkpoint interruption');
    await expect(
      readFile(join(projectRoot, '.planr', 'operate', '.state', 'checkpoint.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    const applied = await applyOperatingMigration({
      projectRoot,
      localRoot,
      confirmed: true,
    });
    expect(applied?.state).toBe('applied');
    await expect(
      readFile(join(projectRoot, '.planr', 'operate', '.state', 'checkpoint.json'), 'utf8'),
    ).resolves.toContain('"kind":"operating-checkpoint"');
    expect(
      (await new OperatingEventStore(projectRoot, { localRoot }).replay()).events.filter(
        (event) => event.type === 'migration.legacy-imported',
      ),
    ).toHaveLength(1);
  });

  it('rolls back imported metadata with an append-only recovery while preserving all originals', async () => {
    const { projectRoot, localRoot } = await fixture([
      '| F-1 | 2026-07-01 | CTO | Verify payment retries | 60 | DEV | open | SPEC-001 |',
    ]);
    const beforeSource = await byteSnapshot(join(projectRoot, '.planr', 'board'));
    const applied = await applyOperatingMigration({
      projectRoot,
      localRoot,
      confirmed: true,
    });
    const backup = join(
      resolveOperatingPaths(projectRoot, { localRoot }).localRoot,
      'migration-backups',
      applied?.id as string,
    );
    const beforeBackup = await byteSnapshot(backup);

    const rolledBack = await rollbackOperatingMigration({
      projectRoot,
      localRoot,
      migrationId: applied?.id as string,
      confirmed: true,
      now: '2026-07-28T12:00:00.000Z',
    });
    expect(rolledBack.state).toBe('rolled-back');
    expect(await byteSnapshot(join(projectRoot, '.planr', 'board'))).toEqual(beforeSource);
    expect(await byteSnapshot(backup)).toEqual(beforeBackup);
    const events = (await new OperatingEventStore(projectRoot, { localRoot }).replay()).events;
    expect(events.filter((event) => event.type === 'migration.legacy-imported')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'recovery.performed')).toHaveLength(1);

    const repeated = await rollbackOperatingMigration({
      projectRoot,
      localRoot,
      migrationId: applied?.id as string,
      confirmed: true,
    });
    expect(repeated).toEqual(rolledBack);
    expect(
      (await new OperatingEventStore(projectRoot, { localRoot }).replay()).events.filter(
        (event) => event.type === 'recovery.performed',
      ),
    ).toHaveLength(1);
  });

  it('repairs missing checkpoint and projections when a rolled-back migration is retried', async () => {
    const { projectRoot, localRoot } = await fixture([
      '| F-1 | 2026-07-01 | CTO | Verify payment retries | 60 | DEV | open | SPEC-001 |',
    ]);
    const applied = await applyOperatingMigration({
      projectRoot,
      localRoot,
      confirmed: true,
    });
    const rolledBack = await rollbackOperatingMigration({
      projectRoot,
      localRoot,
      migrationId: applied?.id as string,
      confirmed: true,
      now: '2026-07-28T12:00:00.000Z',
    });
    const paths = resolveOperatingPaths(projectRoot, { localRoot });
    await rm(paths.checkpoint, { force: true });
    await rm(paths.projections, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    await expect(
      rollbackOperatingMigration({
        projectRoot,
        localRoot,
        migrationId: applied?.id as string,
        confirmed: true,
      }),
    ).resolves.toEqual(rolledBack);
    await expect(readFile(paths.checkpoint, 'utf8')).resolves.toContain(
      '"kind":"operating-checkpoint"',
    );
    await expect(readFile(join(paths.projections, 'state.json'), 'utf8')).resolves.toContain(
      '"kind":"operating-state"',
    );
    await expect(readFile(join(paths.projections, 'register.md'), 'utf8')).resolves.toContain(
      '# Operating Findings Register',
    );
  });
});
