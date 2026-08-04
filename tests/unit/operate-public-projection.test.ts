import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { applyStorageLayoutMigration } from '../../src/services/operate/migration.js';
import {
  emitOperatingPublicProjection,
  persistOperatingProjections,
} from '../../src/services/operate/projection-persistence.js';
import type { OperatingState } from '../../src/services/operate/types.js';

// The DECISIVE Defect-2 proof imports the ACTUAL installed pipeline dashboard reader
// (never a hand-rolled reimplementation) and asserts it can read a directory this
// repo's code wrote. That reader is the one that returned `available:false,
// status:"absent"` tonight against a fully reviewable cycle.
// Resolved portably: the sibling checkout (CI pins it via OPENPLANR_PIPELINE_ROOT;
// locally it is ../planr-pipeline), falling back to the installed package. A
// machine-absolute plugin-cache path here failed CI on its first run — the exact
// works-on-my-machine coupling this batch exists to remove.
const READER_CANDIDATES = [
  process.env.OPENPLANR_PIPELINE_ROOT?.trim(),
  resolve('../planr-pipeline'),
  resolve('node_modules/planr-pipeline'),
]
  .filter((root): root is string => Boolean(root))
  .map((root) => join(root, 'lib', 'dashboard', 'operate-reader.mjs'));
const INSTALLED_READER_PATH = READER_CANDIDATES.find((candidate) => existsSync(candidate));
if (!INSTALLED_READER_PATH) {
  throw new Error(`No pipeline dashboard reader found; looked in: ${READER_CANDIDATES.join(', ')}`);
}

interface ReaderResult {
  available: boolean;
  readOnly: boolean;
  status: string;
  path: string;
  state: OperatingState | null;
  expectedEventHead?: { sequence: number; hash: string | null };
  actualEventHead?: { sequence: number; hash: string | null };
}

type Reader = {
  readOperatingProjection: (
    planrDir: string,
    options?: {
      maxBytes?: number;
      expectedEventHead?: { sequence: number; hash: string | null } | null;
    },
  ) => ReaderResult;
  OPERATING_PROJECTION_MAX_BYTES: number;
};

let reader: Reader;

// The CLI's protocol loader (used by the emitter to derive the checkpoint) resolves
// against the local pipeline checkout in the test environment, exactly as the other
// operate suites bind it.
beforeAll(async () => {
  process.env.OPENPLANR_PIPELINE_ROOT =
    process.env.OPENPLANR_PIPELINE_ROOT ?? resolve('../planr-pipeline');
  reader = (await import(pathToFileURL(INSTALLED_READER_PATH).href)) as unknown as Reader;
});

afterAll(() => {
  delete process.env.OPENPLANR_PIPELINE_ROOT;
});

const temporaryDirectories: string[] = [];
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
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
 * Commit a real advising cycle to the private `.state/` event store and return the
 * store plus its reduced `operating-state` — the same shape every transition hands
 * to `persistOperatingProjections`.
 */
async function advisingCycleState(): Promise<{
  projectRoot: string;
  localRoot: string;
  store: OperatingEventStore;
  state: OperatingState;
}> {
  const projectRoot = await temporaryDirectory('openplanr-public-projection-project-');
  const localRoot = await temporaryDirectory('openplanr-public-projection-local-');
  const store = new OperatingEventStore(projectRoot, { localRoot });
  let head: `sha256:${string}` | null = null;
  const append = async (
    type: Parameters<OperatingEventStore['append']>[0]['type'],
    payload: Record<string, unknown>,
  ) => {
    const event = await store.append({
      type,
      cycleId: 'CYCLE-001',
      entityId: 'CYCLE-001',
      correlationId: 'public-projection-test',
      expectedHead: head,
      timestamp: '2026-07-28T09:00:00.000Z',
      payload,
    });
    head = event.eventHash;
  };
  await append('cycle.preparing', {
    record: {
      kind: 'operating-cycle-manifest',
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      id: 'CYCLE-001',
      state: 'preparing',
      health: 'normal',
      depth: 'standard',
      focus: ['all'],
      inputDigest: digest('a'),
      enabledRoles: ['strategy-finance', 'technology-risk', 'chair'],
      enabledProviders: ['repository'],
      createdAt: '2026-07-28T09:00:00.000Z',
      updatedAt: '2026-07-28T09:00:00.000Z',
      producer: { product: 'openplanr', version: '1.14.0', runtime: 'codex' },
    },
  });
  await append('cycle.collecting', {});
  await store.writeCheckpoint(await store.state());
  return { projectRoot, localRoot, store, state: await store.state() };
}

describe('public operating projection (dashboard reader contract)', () => {
  it('makes the INSTALLED pipeline reader return available:true / ready against a persisted transition', async () => {
    const { projectRoot, localRoot, state } = await advisingCycleState();

    // The real transition seam — not the emitter in isolation — writes the public
    // projection alongside the private `.state/` store.
    await persistOperatingProjections({
      projectRoot,
      localRoot,
      state,
      transactionId: 'TXN-public-projection',
      now: '2026-07-28T10:06:00.000Z',
    });

    const result = reader.readOperatingProjection(join(projectRoot, '.planr'));
    expect(result.available).toBe(true);
    expect(result.status).toBe('ready');
    expect(result.state).not.toBeNull();
    expect(result.state?.eventHead).toEqual(state.eventHead);
    expect(result.state?.summary.currentCycleId).toBe('CYCLE-001');
    // The reader's documented public path — not the private `.state/` store.
    expect(result.path).toBe('.planr/operate/projections/state.json');
  });

  it('emits a checkpoint whose eventHead matches so the reader cross-check reads ready, and detects a mismatch as stale', async () => {
    const { projectRoot, state } = await advisingCycleState();
    const written = await emitOperatingPublicProjection({ projectRoot, state });
    expect(written.statePath).toBe('.planr/operate/projections/state.json');
    expect(written.checkpointPath).toBe('.planr/operate/checkpoints/current.json');

    const planrDir = join(projectRoot, '.planr');

    // The written checkpoint is a valid `operating-checkpoint` — a malformed one
    // would make the reader return `invalid`, not `ready`.
    const checkpoint = JSON.parse(
      await readFile(join(projectRoot, '.planr/operate/checkpoints/current.json'), 'utf8'),
    ) as { kind: string; eventHead: { sequence: number; hash: string | null } };
    expect(checkpoint.kind).toBe('operating-checkpoint');
    expect(checkpoint.eventHead).toEqual(state.eventHead);

    // Passing the true committed head keeps the reader at ready (the freshness
    // cross-check runs and passes against our written state).
    const readyWithExpected = reader.readOperatingProjection(planrDir, {
      expectedEventHead: state.eventHead,
    });
    expect(readyWithExpected.status).toBe('ready');
    expect(readyWithExpected.available).toBe(true);

    // A wrong expected head drives the SAME reader to `stale` (still available), so
    // the projection genuinely carries a checked, comparable event head.
    const stale = reader.readOperatingProjection(planrDir, {
      expectedEventHead: { sequence: state.eventHead.sequence + 99, hash: digest('9') },
    });
    expect(stale.status).toBe('stale');
    expect(stale.available).toBe(true);
    expect(stale.actualEventHead).toEqual(state.eventHead);
  });

  it('keeps both public files well under the reader 1 MiB cap', async () => {
    const { projectRoot, state } = await advisingCycleState();
    await emitOperatingPublicProjection({ projectRoot, state });
    for (const relative of [
      '.planr/operate/projections/state.json',
      '.planr/operate/checkpoints/current.json',
    ]) {
      const info = await stat(join(projectRoot, relative));
      expect(info.size).toBeLessThan(reader.OPERATING_PROJECTION_MAX_BYTES);
      expect(info.size).toBeGreaterThan(0);
    }
  });

  it('survives the CLI migration-on-open: the public checkpoint is not mistaken for v1.2 residue', async () => {
    const { projectRoot, localRoot, state } = await advisingCycleState();
    await emitOperatingPublicProjection({ projectRoot, state });
    const checkpointPath = join(projectRoot, '.planr/operate/checkpoints/current.json');
    const before = await readFile(checkpointPath, 'utf8');

    // A v1.3 project's migration-on-open must NOT delete the public checkpoint (its
    // path collides with the retired v1.2 legacy checkpoint). Before the migration
    // fix this ran a spurious recovery and removed the file.
    const migration = await applyStorageLayoutMigration({ projectRoot, localRoot });
    expect(migration.layout).toBe('v1.3');
    expect(migration.migrated).toBe(false);

    const after = await readFile(checkpointPath, 'utf8').catch(() => null);
    expect(after).toBe(before);

    // And the installed reader still reads it green afterwards.
    const result = reader.readOperatingProjection(join(projectRoot, '.planr'));
    expect(result.status).toBe('ready');
    expect(result.available).toBe(true);
  });
});
