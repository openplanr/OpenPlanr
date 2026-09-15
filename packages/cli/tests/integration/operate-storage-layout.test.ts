import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pinnedVerifierMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/operate/pinned-legacy-replay-runner.js', () => ({
  runPinnedLegacyReplayVerifier: pinnedVerifierMock,
}));

import { withOperateProjectTransaction } from '../../src/services/operate/project-transaction-lock.js';
import {
  adapterRepositoryReadCapabilities,
  readScreenedRepositoryText,
  resolveScreenedRepositoryFile,
} from '../../src/services/operate/repository-read-service.js';
import {
  ensureOperateStorageLayout,
  inspectOperateStorage,
  migrateOperateStorage,
  type OperateLegacyReplayProof,
  rollbackOperateStorageMigration,
} from '../../src/services/operate/storage-layout.js';
import { createEmptyOperatePreferences, OperateStore } from '../../src/services/operate/store.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

const projects: TestProject[] = [];
const proofs = new Map<string, OperateLegacyReplayProof>();
afterEach(() => {
  for (const project of projects.splice(0)) project.cleanup();
  proofs.clear();
  pinnedVerifierMock.mockReset();
  pinnedVerifierMock.mockImplementation(async (projectDir: string) => {
    const proof = proofs.get(resolve(projectDir));
    if (!proof)
      throw Object.assign(new Error('no pinned proof fixture'), {
        code: 'OPERATE_STORE_INCOMPATIBLE',
      });
    return proof;
  });
});

pinnedVerifierMock.mockImplementation(async (projectDir: string) => {
  const proof = proofs.get(resolve(projectDir));
  if (!proof)
    throw Object.assign(new Error('no pinned proof fixture'), {
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });
  return proof;
});

async function digestFixtureTree(root: string): Promise<{ hash: string; fileCount: number }> {
  const records: Array<{ path: string; hash: string; size: number }> = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isDirectory()) await walk(absolute);
      else {
        const bytes = await readFile(absolute);
        records.push({
          path: relative(root, absolute).split(sep).join('/'),
          hash: createHash('sha256').update(bytes).digest('hex'),
          size: bytes.byteLength,
        });
      }
    }
  };
  await walk(root);
  return {
    hash: `sha256:${createHash('sha256').update(JSON.stringify(records)).digest('hex')}`,
    fileCount: records.length,
  };
}

function fixtureProofHash(proof: Omit<OperateLegacyReplayProof, 'receiptHash'>): string {
  const payload = JSON.stringify({
    kind: proof.kind,
    schemaVersion: proof.schemaVersion,
    protocolVersion: proof.protocolVersion,
    source: proof.source,
    projectFingerprint: proof.projectFingerprint,
    tree: { hash: proof.tree.hash, fileCount: proof.tree.fileCount },
    replay: {
      currentGeneration: proof.replay.currentGeneration,
      stateCanonicalHash: proof.replay.stateCanonicalHash,
      eventHead: proof.replay.eventHead,
      artifactHashes: proof.replay.artifactHashes,
    },
    verifier: proof.verifier,
    verifiedAt: proof.verifiedAt,
  });
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

async function createLegacyV2Store(project: TestProject): Promise<{
  root: string;
  generation: string;
  proof: OperateLegacyReplayProof;
}> {
  const root = join(project.dir, '.planr', 'operate-v2');
  const store = new OperateStore(project.dir, { root });
  const state = {
    eventHead: { sequence: 0, hash: null },
    eventReplayIndex: [],
    cycles: [],
  };
  const committed = await store.commit(
    {
      baseState: state,
      state,
      events: [],
      artifacts: new Map(),
      preferences: createEmptyOperatePreferences(),
    },
    null,
  );
  const unsigned: Omit<OperateLegacyReplayProof, 'receiptHash'> = {
    kind: 'operate-legacy-replay-proof',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    source: 'operate-v2',
    projectFingerprint: `sha256:${createHash('sha256')
      .update(`openplanr-operate-project\0${await realpath(project.dir)}`)
      .digest('hex')}`,
    tree: await digestFixtureTree(root),
    replay: {
      currentGeneration: committed.generation as string,
      stateCanonicalHash: sha256Jcs(state),
      eventHead: state.eventHead,
      artifactHashes: [],
    },
    verifier: {
      implementation: 'bundled-compatibility-reader',
      verifierVersion: '1.0.0',
    },
    verifiedAt: '2026-08-20T11:59:00.000Z',
  };
  const proof = Object.freeze({ ...unsigned, receiptHash: fixtureProofHash(unsigned) });
  proofs.set(resolve(project.dir), proof);
  return { root, generation: committed.generation as string, proof };
}

describe('neutral Operate storage layout', () => {
  it('serializes concurrent project transactions even when they start in the same millisecond', async () => {
    const project = await createTestProject('operate-project-transaction-serialization');
    projects.push(project);
    const order: string[] = [];
    let releaseFirst: (() => void) | null = null;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstEntered = new Promise<void>((resolve) => {
      void withOperateProjectTransaction(project.dir, async () => {
        order.push('first-enter');
        resolve();
        await firstMayFinish;
        order.push('first-exit');
      });
    });
    await firstEntered;
    const second = withOperateProjectTransaction(project.dir, async () => {
      order.push('second-enter');
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(order).toEqual(['first-enter']);
    releaseFirst?.();
    await second;
    expect(order).toEqual(['first-enter', 'first-exit', 'second-enter']);
    await expect(
      lstat(join(project.dir, '.planr', '.operate-transaction-lock.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('holds Store commits behind migration and rollback project custody', async () => {
    const project = await createTestProject('operate-store-project-transaction');
    projects.push(project);
    let releaseTransaction: (() => void) | null = null;
    const transactionMayFinish = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    let transactionEntered: (() => void) | null = null;
    const entered = new Promise<void>((resolve) => {
      transactionEntered = resolve;
    });
    const transaction = withOperateProjectTransaction(project.dir, async () => {
      transactionEntered?.();
      await transactionMayFinish;
    });
    await entered;
    const state = { eventHead: { sequence: 0, hash: null }, eventReplayIndex: [], cycles: [] };
    let committed = false;
    const commit = new OperateStore(project.dir)
      .commit(
        {
          baseState: state,
          state,
          events: [],
          artifacts: new Map(),
          preferences: createEmptyOperatePreferences(),
        },
        null,
      )
      .then(() => {
        committed = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(committed).toBe(false);
    releaseTransaction?.();
    await Promise.all([transaction, commit]);
    expect(committed).toBe(true);
  });

  it('rejects root, child, and Store symlink custody without touching external targets', async () => {
    const rootProject = await createTestProject('operate-storage-root-symlink');
    const childProject = await createTestProject('operate-storage-child-symlink');
    const storeProject = await createTestProject('operate-store-root-symlink');
    projects.push(rootProject, childProject, storeProject);

    const rootExternal = join(rootProject.dir, 'external');
    await mkdir(rootExternal, { recursive: true });
    await mkdir(join(rootProject.dir, '.planr'), { recursive: true });
    await symlink(rootExternal, join(rootProject.dir, '.planr', 'operate'));
    await expect(ensureOperateStorageLayout(rootProject.dir)).rejects.toMatchObject({
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });
    expect(await stat(rootExternal)).toMatchObject({ mode: expect.any(Number) });
    await expect(stat(join(rootExternal, 'state'))).rejects.toMatchObject({ code: 'ENOENT' });

    const childRoot = join(childProject.dir, '.planr', 'operate');
    const childExternal = join(childProject.dir, 'external-packets');
    await Promise.all([
      mkdir(join(childRoot, 'state'), { recursive: true }),
      mkdir(join(childRoot, 'projections'), { recursive: true }),
      mkdir(join(childRoot, 'archive'), { recursive: true }),
      mkdir(childExternal, { recursive: true }),
    ]);
    await symlink(childExternal, join(childRoot, 'packets'));
    await expect(ensureOperateStorageLayout(childProject.dir)).rejects.toMatchObject({
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });
    await expect(stat(join(childExternal, '.ignore'))).rejects.toMatchObject({ code: 'ENOENT' });

    const stateExternal = join(storeProject.dir, 'external-state');
    await mkdir(join(storeProject.dir, '.planr', 'operate'), { recursive: true });
    await mkdir(stateExternal, { recursive: true });
    await symlink(stateExternal, join(storeProject.dir, '.planr', 'operate', 'state'));
    const store = new OperateStore(storeProject.dir);
    const state = { eventHead: { sequence: 0, hash: null }, eventReplayIndex: [], cycles: [] };
    await expect(
      store.commit(
        {
          baseState: state,
          state,
          events: [],
          artifacts: new Map(),
          preferences: createEmptyOperatePreferences(),
        },
        null,
      ),
    ).rejects.toMatchObject({ code: 'OPERATE_STORE_INCOMPATIBLE' });
    expect(await stat(stateExternal)).toMatchObject({ mode: expect.any(Number) });
    expect(await (await import('node:fs/promises')).readdir(stateExternal)).toEqual([]);
  });

  it('rejects nested Store symlinks for commit, load, restore, inspect, and lock recovery', async () => {
    const project = await createTestProject('operate-store-nested-symlink');
    projects.push(project);
    const root = join(project.dir, '.planr', 'operate', 'state');
    const external = join(project.dir, 'external-generations');
    await mkdir(root, { recursive: true });
    await mkdir(external, { recursive: true });
    await symlink(external, join(root, 'generations'));
    const store = new OperateStore(project.dir);
    const state = { eventHead: { sequence: 0, hash: null }, eventReplayIndex: [], cycles: [] };
    const replay = (() => undefined) as never;

    for (const operation of [
      () =>
        store.commit(
          {
            baseState: state,
            state,
            events: [],
            artifacts: new Map(),
            preferences: createEmptyOperatePreferences(),
          },
          null,
        ),
      () => store.load(replay),
      () => store.restore(`gen_${'a'.repeat(32)}`, replay),
      () => store.inspect(replay),
      () => store.clearStaleLock(),
    ]) {
      await expect(operation()).rejects.toMatchObject({ code: 'OPERATE_STORE_INCOMPATIBLE' });
    }
    expect(await (await import('node:fs/promises')).readdir(external)).toEqual([]);
  });

  it('creates the closed state, packet, projection, and archive layout with search exclusions', async () => {
    const project = await createTestProject('operate-storage-layout');
    projects.push(project);
    const root = await ensureOperateStorageLayout(project.dir);

    await writeFile(join(root, 'state', 'private.json'), '{}\n');
    await writeFile(join(root, 'packets', 'packet.json'), '{}\n');
    await writeFile(join(root, 'archive', 'old.json'), '{}\n');
    await mkdir(join(project.dir, '.planr', 'specs'), { recursive: true });
    await writeFile(join(project.dir, '.planr', 'specs', 'public.md'), '# Public\n');

    const files = spawnSync('rg', ['--files', '--hidden'], {
      cwd: project.dir,
      encoding: 'utf8',
    });
    if (files.status === 0) {
      expect(files.stdout).toContain('.planr/specs/public.md');
      expect(files.stdout).not.toContain('private.json');
      expect(files.stdout).not.toContain('packet.json');
      expect(files.stdout).not.toContain('old.json');
    } else {
      expect((files.error as NodeJS.ErrnoException | undefined)?.code).toBe('ENOENT');
    }
    expect(await readFile(join(root, '.ignore'), 'utf8')).toBe('/state/\n/packets/\n/archive/\n');
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, 'state'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, '.ignore'))).mode & 0o777).toBe(0o600);
  });

  it('screens repository evidence paths and omits repository.read for unconstrained adapters', async () => {
    const project = await createTestProject('operate-repository-screen');
    projects.push(project);
    const root = await ensureOperateStorageLayout(project.dir);
    await mkdir(join(project.dir, '.planr', 'specs'), { recursive: true });
    await writeFile(join(project.dir, '.planr', 'specs', 'public.md'), '# Public\n');
    await writeFile(join(root, 'state', 'private.json'), '{"secret":true}\n');
    await mkdir(join(project.dir, '.git'), { recursive: true });
    await writeFile(join(project.dir, '.git', 'config'), 'private\n');
    await writeFile(join(project.dir, '.env'), 'TOKEN=private\n');
    for (const tree of ['node_modules', 'dist', 'generated']) {
      await mkdir(join(project.dir, tree), { recursive: true });
      await writeFile(join(project.dir, tree, 'private.txt'), 'private\n');
    }
    await symlink(join(root, 'state', 'private.json'), join(project.dir, 'private-link'));

    await expect(readScreenedRepositoryText(project.dir, '.planr/specs/public.md')).resolves.toBe(
      '# Public\n',
    );
    for (const denied of [
      '.planr/operate/state/private.json',
      '.planr/operate/packets/missing.json',
      '.planr/operate/archive/missing.json',
      '../outside',
      '.git/config',
      '.GIT/config',
      '.PLANR/OPERATE/STATE/private.json',
      '.env',
      'node_modules/private.txt',
      'dist/private.txt',
      'generated/private.txt',
      'private-link',
    ]) {
      await expect(readScreenedRepositoryText(project.dir, denied)).rejects.toMatchObject({
        code: 'E_OPERATE_REPOSITORY_PATH_DENIED',
      });
    }
    await expect(
      readScreenedRepositoryText(project.dir, '.planr/specs/public.md', { maxBytes: 1 }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_REPOSITORY_PATH_DENIED' });

    const swapped = join(project.dir, '.planr', 'specs', 'swapped.md');
    await writeFile(swapped, '# Screened first\n');
    await expect(
      resolveScreenedRepositoryFile(project.dir, '.planr/specs/swapped.md'),
    ).resolves.toContain('.planr/specs/swapped.md');
    await unlink(swapped);
    await symlink(join(root, 'state', 'private.json'), swapped);
    await expect(
      readScreenedRepositoryText(project.dir, '.planr/specs/swapped.md'),
    ).rejects.toMatchObject({ code: 'E_OPERATE_REPOSITORY_PATH_DENIED' });
    expect(
      adapterRepositoryReadCapabilities({ adapterId: 'codex', enforcesScreenedBoundary: false }),
    ).toEqual([]);
    expect(
      adapterRepositoryReadCapabilities({
        adapterId: 'screened-artifact-adapter',
        enforcesScreenedBoundary: true,
      }),
    ).toEqual(['repository.read']);
  });

  it('matches a bundled replay proof, activates exact v2 state, and archives rollback bytes', async () => {
    const project = await createTestProject('operate-storage-migration');
    projects.push(project);
    const legacy = await createLegacyV2Store(project);
    const legacyV2 = legacy.root;
    const legacyNeutral = join(project.dir, '.planr', 'operate');
    await mkdir(join(legacyNeutral, '.state'), { recursive: true });
    await writeFile(join(legacyNeutral, '.state', 'runtime.json'), '{"legacy":true}\n');
    await chmod(legacyV2, 0o777);
    await chmod(join(legacyV2, 'CURRENT'), 0o666);
    await chmod(join(legacyNeutral, '.state'), 0o777);
    await chmod(join(legacyNeutral, '.state', 'runtime.json'), 0o666);
    const receipt = await migrateOperateStorage(project.dir, {
      now: new Date('2026-08-20T12:00:00.000Z'),
    });

    expect(receipt.migrated).toBe(true);
    expect(pinnedVerifierMock).toHaveBeenCalledTimes(1);
    expect(pinnedVerifierMock).toHaveBeenCalledWith(project.dir);
    expect(receipt.verificationProofHash).toBe(legacy.proof.receiptHash);
    expect(receipt.archives.map((entry) => entry.source).sort()).toEqual([
      'operate-legacy',
      'operate-v2',
    ]);
    expect(
      await readFile(
        join(
          join(project.dir, '.planr', 'operate'),
          'archive',
          '2026-08-20T12-00-00.000Z-operate-v2',
          'CURRENT',
        ),
        'utf8',
      ),
    ).toBe(`${legacy.generation}\n`);
    expect(await inspectOperateStorage(project.dir)).toMatchObject({ status: 'ready' });
    expect(await readFile(join(project.dir, '.planr', 'operate', 'state', 'CURRENT'), 'utf8')).toBe(
      `${legacy.generation}\n`,
    );
    expect(receipt.activatedState).toEqual(legacy.proof.tree);
    expect(receipt.rollbackArchiveId).toBe('2026-08-20T12-00-00.000Z-operate-v2');
    expect(JSON.stringify(receipt)).not.toContain(project.dir);
    const archivedV2 = join(
      project.dir,
      '.planr',
      'operate',
      'archive',
      '2026-08-20T12-00-00.000Z-operate-v2',
    );
    expect((await stat(archivedV2)).mode & 0o777).toBe(0o700);
    expect((await stat(join(archivedV2, 'CURRENT'))).mode & 0o777).toBe(0o600);
  });

  it('parks and archives a current-looking neutral root alongside the proved legacy v2 root', async () => {
    const project = await createTestProject('operate-storage-dual-active-roots');
    projects.push(project);
    const legacy = await createLegacyV2Store(project);
    const neutral = join(project.dir, '.planr', 'operate');
    for (const directory of ['state', 'packets', 'projections', 'archive']) {
      await mkdir(join(neutral, directory), { recursive: true });
    }
    await writeFile(join(neutral, 'state', 'old-neutral.json'), '{"old":true}\n');

    const before = await inspectOperateStorage(project.dir);
    expect(before).toMatchObject({
      status: 'migration-required',
      legacyV2Root: legacy.root,
      legacyNeutralRoot: neutral,
    });
    const receipt = await migrateOperateStorage(project.dir, {
      now: new Date('2026-08-20T12:02:00.000Z'),
    });

    expect(receipt.archives.map(({ source }) => source).sort()).toEqual([
      'operate-legacy',
      'operate-v2',
    ]);
    expect(
      await readFile(
        join(
          neutral,
          'archive',
          '2026-08-20T12-02-00.000Z-operate-legacy',
          'state',
          'old-neutral.json',
        ),
        'utf8',
      ),
    ).toBe('{"old":true}\n');
    expect(await inspectOperateStorage(project.dir)).toMatchObject({ status: 'ready' });
  });

  it('accepts the same canonical project through a symlinked invocation path', async () => {
    const project = await createTestProject('operate-storage-canonical-project');
    projects.push(project);
    const legacy = await createLegacyV2Store(project);
    const alias = join(project.dir, 'canonical-alias');
    await symlink('.', alias, 'dir');
    proofs.set(resolve(alias), legacy.proof);

    const receipt = await migrateOperateStorage(alias, {
      now: new Date('2026-08-20T12:03:00.000Z'),
    });

    expect(receipt.verificationProofHash).toBe(legacy.proof.receiptHash);
    expect(pinnedVerifierMock).toHaveBeenCalledWith(alias);
    expect(await inspectOperateStorage(alias)).toMatchObject({ status: 'ready' });
  });

  it('refuses to move an existing v2 store when the pinned replay runner fails', async () => {
    const project = await createTestProject('operate-storage-refusal');
    projects.push(project);
    const legacy = await createLegacyV2Store(project);

    pinnedVerifierMock.mockRejectedValueOnce(
      Object.assign(new Error('pinned verifier failed'), {
        code: 'OPERATE_STORE_INCOMPATIBLE',
      }),
    );
    await expect(migrateOperateStorage(project.dir)).rejects.toMatchObject({
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });
    expect(await readFile(join(legacy.root, 'CURRENT'), 'utf8')).toBe(`${legacy.generation}\n`);
  });

  it('does not accept caller proof JSON through the low-level migration options', async () => {
    const project = await createTestProject('operate-storage-no-caller-proof');
    projects.push(project);
    const legacy = await createLegacyV2Store(project);
    pinnedVerifierMock.mockRejectedValueOnce(
      Object.assign(new Error('pinned runner required'), {
        code: 'OPERATE_STORE_INCOMPATIBLE',
      }),
    );

    await expect(
      migrateOperateStorage(project.dir, {
        untrustedProof: legacy.proof,
      } as never),
    ).rejects.toThrow('pinned runner required');
    expect(pinnedVerifierMock).toHaveBeenCalledTimes(1);
    expect(await readFile(join(legacy.root, 'CURRENT'), 'utf8')).toBe(`${legacy.generation}\n`);
  });

  it('restores both original roots if migration fails after the first archive move', async () => {
    const project = await createTestProject('operate-storage-rollback');
    projects.push(project);
    const legacy = await createLegacyV2Store(project);
    const legacyV2 = legacy.root;
    const legacyNeutral = join(project.dir, '.planr', 'operate');
    await mkdir(join(legacyNeutral, '.state'), { recursive: true });
    await writeFile(join(legacyNeutral, '.state', 'runtime.json'), 'legacy-original\n');

    await expect(
      migrateOperateStorage(project.dir, {
        onArchive: async () => {
          throw new Error('injected archive failure');
        },
      }),
    ).rejects.toThrow('injected archive failure');

    expect(await readFile(join(legacyV2, 'CURRENT'), 'utf8')).toBe(`${legacy.generation}\n`);
    expect(await readFile(join(legacyNeutral, '.state', 'runtime.json'), 'utf8')).toBe(
      'legacy-original\n',
    );
    expect(await inspectOperateStorage(project.dir)).toMatchObject({
      status: 'migration-required',
      legacyV2Root: legacyV2,
      legacyNeutralRoot: legacyNeutral,
    });
  });

  it('resumes an activated clean root before the legacy v2 store was archived', async () => {
    const project = await createTestProject('operate-storage-activation-crash');
    projects.push(project);
    const legacy = await createLegacyV2Store(project);
    const legacyV2 = legacy.root;

    await expect(
      migrateOperateStorage(project.dir, {
        now: new Date('2026-08-20T12:05:00.000Z'),
        afterActivate: async () => {
          throw Object.assign(new Error('simulated process interruption'), {
            code: 'OPERATE_MIGRATION_INTERRUPTED',
          });
        },
      }),
    ).rejects.toMatchObject({ code: 'OPERATE_MIGRATION_INTERRUPTED' });

    expect(await inspectOperateStorage(project.dir)).toMatchObject({
      status: 'interrupted',
      legacyV2Root: legacyV2,
      interruptedEntries: ['operate/archive/.migration-in-progress.json'],
    });
    const receipt = await migrateOperateStorage(project.dir);
    expect(receipt.archives).toMatchObject([
      { archiveId: '2026-08-20T12-05-00.000Z-operate-v2', source: 'operate-v2' },
    ]);
    expect(await inspectOperateStorage(project.dir)).toMatchObject({ status: 'ready' });
    expect(
      await readFile(
        join(
          project.dir,
          '.planr',
          'operate',
          'archive',
          '2026-08-20T12-05-00.000Z-operate-v2',
          'CURRENT',
        ),
        'utf8',
      ),
    ).toBe(`${legacy.generation}\n`);
  });

  it.each(['after-stage', 'after-neutral-park'] as const)(
    'recovers exact pre-activation custody %s without overlaying either legacy root',
    async (point) => {
      const project = await createTestProject(`operate-storage-preactivation-${point}`);
      projects.push(project);
      await createLegacyV2Store(project);
      const legacyNeutral = join(project.dir, '.planr', 'operate');
      await mkdir(join(legacyNeutral, '.state'), { recursive: true });
      await writeFile(join(legacyNeutral, '.state', 'runtime.json'), `${point}\n`);
      const interrupt = async () => {
        throw Object.assign(new Error(`interrupted ${point}`), {
          code: 'OPERATE_MIGRATION_INTERRUPTED',
        });
      };

      await expect(
        migrateOperateStorage(project.dir, {
          now: new Date('2026-08-20T12:06:00.000Z'),
          ...(point === 'after-stage'
            ? { afterStagePrepared: interrupt }
            : { afterParkNeutral: interrupt }),
        }),
      ).rejects.toMatchObject({ code: 'OPERATE_MIGRATION_INTERRUPTED' });

      const interrupted = await inspectOperateStorage(project.dir);
      expect(interrupted.status).toBe('interrupted');
      expect(
        interrupted.interruptedEntries.some((entry) => entry.startsWith('.operate-stage-')),
      ).toBe(true);
      expect(
        interrupted.interruptedEntries.some((entry) => entry.startsWith('.operate-legacy-')),
      ).toBe(point === 'after-neutral-park');

      const receipt = await migrateOperateStorage(project.dir);
      expect(receipt.archives.map(({ source }) => source).sort()).toEqual([
        'operate-legacy',
        'operate-v2',
      ]);
      expect(await inspectOperateStorage(project.dir)).toMatchObject({ status: 'ready' });
      expect(
        await readFile(
          join(
            project.dir,
            '.planr',
            'operate',
            'archive',
            '2026-08-20T12-06-00.000Z-operate-legacy',
            '.state',
            'runtime.json',
          ),
          'utf8',
        ),
      ).toBe(`${point}\n`);
    },
  );

  it('refuses ambiguous or nonce-mismatched pre-activation migration custody', async () => {
    const project = await createTestProject('operate-storage-preactivation-hostile');
    projects.push(project);
    await mkdir(join(project.dir, '.planr', '.operate-stage-deadbeef'), { recursive: true });
    await mkdir(join(project.dir, '.planr', '.operate-stage-feedface'), { recursive: true });

    await expect(migrateOperateStorage(project.dir)).rejects.toMatchObject({
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });
  });

  it('rejects tampered, stale, and foreign replay proofs without moving either source', async () => {
    const source = await createTestProject('operate-storage-proof-source');
    const foreign = await createTestProject('operate-storage-proof-foreign');
    projects.push(source, foreign);
    const sourceLegacy = await createLegacyV2Store(source);
    const foreignLegacy = await createLegacyV2Store(foreign);
    const tampered = {
      ...sourceLegacy.proof,
      receiptHash: `sha256:${'0'.repeat(64)}`,
    } as OperateLegacyReplayProof;

    pinnedVerifierMock.mockResolvedValueOnce(tampered);
    await expect(migrateOperateStorage(source.dir)).rejects.toMatchObject({
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });
    pinnedVerifierMock.mockResolvedValueOnce(sourceLegacy.proof);
    await expect(migrateOperateStorage(foreign.dir)).rejects.toMatchObject({
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });

    const store = new OperateStore(source.dir, { root: sourceLegacy.root });
    const state = { eventHead: { sequence: 0, hash: null }, eventReplayIndex: [], cycles: [] };
    await store.commit(
      {
        baseState: state,
        state,
        events: [],
        artifacts: new Map(),
        preferences: createEmptyOperatePreferences(),
      },
      sourceLegacy.generation,
    );
    await expect(migrateOperateStorage(source.dir)).rejects.toMatchObject({
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });

    expect(await inspectOperateStorage(source.dir)).toMatchObject({
      status: 'migration-required',
      legacyV2Root: sourceLegacy.root,
    });
    expect(await inspectOperateStorage(foreign.dir)).toMatchObject({
      status: 'migration-required',
      legacyV2Root: foreignLegacy.root,
    });
  });

  it('rejects unpinned verifier identities returned by the pinned-runner boundary', async () => {
    const project = await createTestProject('operate-storage-proof-forged-verifier');
    projects.push(project);
    const legacy = await createLegacyV2Store(project);

    const forged = {
      ...legacy.proof,
      verifier: { ...legacy.proof.verifier, verifierVersion: '9.9.9' },
    } as OperateLegacyReplayProof;
    pinnedVerifierMock.mockResolvedValueOnce(forged);
    await expect(migrateOperateStorage(project.dir)).rejects.toMatchObject({
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });
  });

  it('rolls a migration back without deleting the activated forward state', async () => {
    const project = await createTestProject('operate-storage-explicit-rollback');
    projects.push(project);
    const legacy = await createLegacyV2Store(project);
    await migrateOperateStorage(project.dir, {
      now: new Date('2026-08-20T12:08:00.000Z'),
    });
    await writeFile(
      join(project.dir, '.planr', 'operate', 'packets', 'forward.json'),
      '{"ok":true}\n',
    );

    const receipt = await rollbackOperateStorageMigration(project.dir);

    expect(receipt).toMatchObject({
      kind: 'operate-storage-rollback-receipt',
      restoredSource: 'operate-v2',
    });
    expect(await readFile(join(legacy.root, 'CURRENT'), 'utf8')).toBe(`${legacy.generation}\n`);
    expect(
      await readFile(
        join(project.dir, '.planr', receipt.forwardSnapshotId, 'packets', 'forward.json'),
        'utf8',
      ),
    ).toBe('{"ok":true}\n');
    expect(await inspectOperateStorage(project.dir)).toMatchObject({
      status: 'migration-required',
    });
  });

  it('restores both pre-migration roots and preserves the activated forward state', async () => {
    const project = await createTestProject('operate-storage-dual-root-rollback');
    projects.push(project);
    const legacy = await createLegacyV2Store(project);
    const neutral = join(project.dir, '.planr', 'operate');
    for (const directory of ['state', 'packets', 'projections', 'archive']) {
      await mkdir(join(neutral, directory), { recursive: true });
    }
    await writeFile(join(neutral, 'state', 'old-neutral.json'), '{"old":true}\n');
    await migrateOperateStorage(project.dir, {
      now: new Date('2026-08-20T12:09:00.000Z'),
    });
    await writeFile(join(neutral, 'packets', 'forward.json'), '{"forward":true}\n');

    const receipt = await rollbackOperateStorageMigration(project.dir);

    expect(receipt.restoredLegacyTree).not.toBeNull();
    expect(await readFile(join(legacy.root, 'CURRENT'), 'utf8')).toBe(`${legacy.generation}\n`);
    expect(await readFile(join(neutral, 'state', 'old-neutral.json'), 'utf8')).toBe(
      '{"old":true}\n',
    );
    expect(
      await readFile(
        join(project.dir, '.planr', receipt.forwardSnapshotId, 'packets', 'forward.json'),
        'utf8',
      ),
    ).toBe('{"forward":true}\n');
  });

  it.each(['afterProgress', 'afterRestoreV2', 'afterParkForward', 'afterRestoreNeutral'] as const)(
    'resumes an interrupted dual-root rollback after %s',
    async (point) => {
      const project = await createTestProject(`operate-storage-rollback-${point}`);
      projects.push(project);
      const legacy = await createLegacyV2Store(project);
      const neutral = join(project.dir, '.planr', 'operate');
      for (const directory of ['state', 'packets', 'projections', 'archive']) {
        await mkdir(join(neutral, directory), { recursive: true });
      }
      await writeFile(join(neutral, 'state', 'old-neutral.json'), `${point}\n`);
      await migrateOperateStorage(project.dir, {
        now: new Date('2026-08-20T12:10:00.000Z'),
      });
      await writeFile(join(neutral, 'packets', 'forward.json'), `${point}\n`);
      const interrupt = async () => {
        throw Object.assign(new Error(`interrupted ${point}`), {
          code: 'OPERATE_ROLLBACK_INTERRUPTED',
        });
      };

      await expect(
        rollbackOperateStorageMigration(project.dir, { [point]: interrupt }),
      ).rejects.toMatchObject({ code: 'OPERATE_ROLLBACK_INTERRUPTED' });
      expect(await inspectOperateStorage(project.dir)).toMatchObject({ status: 'interrupted' });

      const receipt = await rollbackOperateStorageMigration(project.dir);
      expect(await readFile(join(legacy.root, 'CURRENT'), 'utf8')).toBe(`${legacy.generation}\n`);
      expect(await readFile(join(neutral, 'state', 'old-neutral.json'), 'utf8')).toBe(`${point}\n`);
      expect(
        await readFile(
          join(project.dir, '.planr', receipt.forwardSnapshotId, 'packets', 'forward.json'),
          'utf8',
        ),
      ).toBe(`${point}\n`);
      expect((await inspectOperateStorage(project.dir)).interruptedEntries).toEqual([]);
    },
  );

  it('preserves an unreceipted staging tree before retrying migration', async () => {
    const project = await createTestProject('operate-storage-unreceipted-stage');
    projects.push(project);
    await createLegacyV2Store(project);
    const nonce = 'a'.repeat(32);
    const staged = join(project.dir, '.planr', `.operate-stage-${nonce}`);
    await mkdir(staged, { recursive: true });
    await writeFile(join(staged, 'partial.txt'), 'unverified staged bytes\n');

    const receipt = await migrateOperateStorage(project.dir, {
      now: new Date('2026-08-20T12:11:00.000Z'),
    });

    expect(receipt.migrated).toBe(true);
    expect(
      await readFile(
        join(project.dir, '.planr', 'operate-recovery', `abandoned-stage-${nonce}`, 'partial.txt'),
        'utf8',
      ),
    ).toBe('unverified staged bytes\n');
    expect(await inspectOperateStorage(project.dir)).toMatchObject({ status: 'ready' });
  });

  it('serializes competing rollbacks without losing either result tree', async () => {
    const project = await createTestProject('operate-storage-concurrent-rollback');
    projects.push(project);
    const legacy = await createLegacyV2Store(project);
    await migrateOperateStorage(project.dir, {
      now: new Date('2026-08-20T12:12:00.000Z'),
    });

    const results = await Promise.allSettled([
      rollbackOperateStorageMigration(project.dir),
      rollbackOperateStorageMigration(project.dir),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(await readFile(join(legacy.root, 'CURRENT'), 'utf8')).toBe(`${legacy.generation}\n`);
    expect((await inspectOperateStorage(project.dir)).interruptedEntries).toEqual([]);
  });

  it('fails closed when an interrupted staged or parked migration is present', async () => {
    const project = await createTestProject('operate-storage-interrupted');
    projects.push(project);
    await mkdir(join(project.dir, '.planr', '.operate-stage-deadbeef'), { recursive: true });

    await expect(ensureOperateStorageLayout(project.dir)).rejects.toMatchObject({
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });
    expect(await inspectOperateStorage(project.dir)).toMatchObject({
      status: 'interrupted',
      interruptedEntries: ['.operate-stage-deadbeef'],
    });
  });
});
