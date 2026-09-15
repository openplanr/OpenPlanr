// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspaceRoot = resolve(cliRoot, '../..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runNpm(args: string[], cwd: string, cache: string): string {
  return execFileSync(npm, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_cache: cache,
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function pack(packageRoot: string, archives: string, cache: string): string {
  const report = JSON.parse(
    runNpm(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', archives],
      packageRoot,
      cache,
    ),
  ) as Array<{ filename?: unknown }>;
  const filename = report[0]?.filename;
  if (report.length !== 1 || typeof filename !== 'string') {
    throw new Error(`npm pack did not report one archive for ${packageRoot}.`);
  }
  return join(archives, filename);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Fixture value is not JSON.');
  return encoded;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function hashValue(value: unknown): string {
  return sha256(Buffer.from(canonical(value), 'utf8'));
}

function writeFrozenLegacyStore(project: string, state: Record<string, unknown>): string {
  const root = join(project, '.planr', 'operate-v2');
  const generation = 'gen_11111111111111111111111111111111';
  const custodyNonce = '22222222222222222222222222222222';
  const createdAt = '2026-09-14T00:00:00.000Z';
  const projectIdentity = hashValue({
    kind: 'openplanr-project-identity',
    resolved: realpathSync(project),
    config: null,
  });
  const bindings: unknown[] = [];
  const events = Buffer.from('', 'utf8');
  const replayIndexes = Object.fromEntries(
    Object.entries(state).filter(
      ([key]) => key === 'eventHead' || key === 'eventReplayIndex' || /ReplayIndex$/u.test(key),
    ),
  );
  const preferences = {
    selectedScopeId: null,
    selectedDomainId: null,
    selectedDomainVersion: null,
    lastCycleId: null,
    reviewOwners: {},
    cycleModes: {},
    cycleDeliveryRoutes: {},
    assignmentArtifactIds: {},
    cycleRoleAssignments: {},
    cycleIntelligencePlanIds: {},
    actorMemberships: {},
  };
  const manifestProjection = {
    format: 'openplanr-operate-store',
    storeVersion: 3,
    protocolVersion: '2.0.0',
    projectIdentity,
    custodyNonce,
    generation,
    parentGeneration: null,
    parentIntegrityHash: null,
    createdAt,
    eventCount: 0,
    eventsHash: sha256(events),
    replayIndexHash: hashValue(replayIndexes),
    bindings,
    baseState: state,
    state,
    preferences,
    artifacts: [],
  };
  const manifest = { ...manifestProjection, integrityHash: hashValue(manifestProjection) };
  const journalProjection = {
    format: 'openplanr-operate-head-journal',
    journalVersion: 1,
    sequence: 1,
    projectIdentity,
    custodyNonce,
    generation,
    integrityHash: manifest.integrityHash,
    bindings,
    previousRecordHash: null,
    createdAt,
  };
  const journal = { ...journalProjection, recordHash: hashValue(journalProjection) };
  const custody = {
    format: 'openplanr-operate-custody',
    custodyVersion: 2,
    projectIdentity,
    custodyNonce,
    headGeneration: generation,
    headIntegrityHash: manifest.integrityHash,
    bindings,
    journalSequence: 1,
    journalRecordHash: journal.recordHash,
    updatedAt: createdAt,
  };
  const generationRoot = join(root, 'generations', generation);
  mkdirSync(join(generationRoot, 'artifacts'), { recursive: true });
  writeFileSync(join(generationRoot, 'events.jsonl'), events);
  writeFileSync(join(generationRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(root, 'HEADS.jsonl'), `${JSON.stringify(journal)}\n`);
  writeFileSync(join(root, 'CUSTODY.json'), `${JSON.stringify(custody, null, 2)}\n`);
  writeFileSync(join(root, 'CURRENT'), `${generation}\n`);
  return generation;
}

describe('packed Operate storage migration', () => {
  it('migrates, rejects changed custody, and rolls back with only installed packages', async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'openplanr-packed-operate-migration-'));
    try {
      const archives = join(temporaryRoot, 'archives');
      const consumer = join(temporaryRoot, 'consumer');
      const project = join(temporaryRoot, 'project');
      const cache = resolve(process.env.OPENPLANR_NPM_CACHE ?? join(temporaryRoot, 'npm-cache'));
      mkdirSync(archives, { recursive: true });
      mkdirSync(consumer, { recursive: true });
      mkdirSync(project, { recursive: true });
      writeFileSync(
        join(consumer, 'package.json'),
        '{"name":"openplanr-packed-migration","private":true,"type":"module"}\n',
      );

      const protocolArchive = pack(join(workspaceRoot, 'packages/protocol'), archives, cache);
      const pipelineArchive = pack(join(workspaceRoot, 'packages/pipeline'), archives, cache);
      const cliArchive = pack(cliRoot, archives, cache);
      runNpm(
        [
          'install',
          '--ignore-scripts',
          '--no-package-lock',
          '--omit=dev',
          '--prefer-offline',
          protocolArchive,
          pipelineArchive,
          cliArchive,
        ],
        consumer,
        cache,
      );

      const installedCli = join(consumer, 'node_modules', 'openplanr');
      expect(
        existsSync(join(installedCli, 'dist', 'services', 'operate', 'storage-layout.js')),
      ).toBe(true);
      const pinnedReader = readFileSync(
        join(installedCli, 'dist', 'services', 'operate', 'pinned-legacy-replay-runner.js'),
        'utf8',
      );
      expect(pinnedReader).not.toMatch(/from ["']\.\/(?:store|composition)\.js["']/u);
      expect(pinnedReader).not.toContain('planr-pipeline/protocol');
      const compositionModule = await import(
        pathToFileURL(join(installedCli, 'dist', 'services', 'operate', 'composition.js')).href
      );
      const storageModule = await import(
        pathToFileURL(join(installedCli, 'dist', 'services', 'operate', 'storage-layout.js')).href
      );
      const composition = await compositionModule.createOperateComposition();
      const state = composition.createEmptyState('2026-09-14T00:00:00.000Z');
      const legacyRoot = join(project, '.planr', 'operate-v2');
      const originalGeneration = writeFrozenLegacyStore(project, state);

      const migrated = await storageModule.migrateOperateStorage(project, {
        now: new Date('2026-09-14T00:01:00.000Z'),
      });
      expect(migrated.migrated).toBe(true);
      expect(migrated.verificationProofHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(migrated.rollbackArchiveId).toBe('2026-09-14T00-01-00.000Z-operate-v2');
      expect(readFileSync(join(project, '.planr', 'operate', 'state', 'CURRENT'), 'utf8')).toBe(
        `${originalGeneration}\n`,
      );

      const storeModule = await import(
        pathToFileURL(join(installedCli, 'dist', 'services', 'operate', 'store.js')).href
      );
      const active = new storeModule.OperateStore(project);
      const loaded = await active.load(
        async ({
          baseState,
          events,
          artifacts,
        }: {
          baseState: Record<string, unknown>;
          events: Record<string, unknown>[];
          artifacts: Map<string, Uint8Array>;
        }) => composition.replay(baseState, events, artifacts),
      );
      expect(loaded?.generation).toBe(originalGeneration);

      const rollback = await storageModule.rollbackOperateStorageMigration(project);
      expect(rollback.restoredSource).toBe('operate-v2');
      expect(readFileSync(join(legacyRoot, 'CURRENT'), 'utf8')).toBe(`${originalGeneration}\n`);
      expect(
        existsSync(join(project, '.planr', rollback.forwardSnapshotId, 'state', 'CURRENT')),
      ).toBe(true);
      expect(JSON.stringify({ migrated, rollback })).not.toContain(workspaceRoot);

      writeFileSync(join(legacyRoot, 'generations', originalGeneration, 'events.jsonl'), '{}\n');
      await expect(
        storageModule.migrateOperateStorage(project, {
          now: new Date('2026-09-14T00:02:00.000Z'),
        }),
      ).rejects.toMatchObject({ code: 'OPERATE_STORE_INCOMPATIBLE' });
      expect(existsSync(legacyRoot)).toBe(true);
      expect(existsSync(join(project, '.planr', 'operate'))).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 300_000);
});
