import { mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyOperatePreferences, OperateStore } from '../../src/services/operate/store.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

const projects: TestProject[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) project.cleanup();
});

function stateFixture(marker: string) {
  return {
    eventHead: { sequence: 0, hash: null },
    eventReplayIndex: [],
    cycles: [],
    marker,
  };
}

function runtimeFixture(state: ReturnType<typeof stateFixture>) {
  return {
    baseState: state,
    state,
    events: [],
    artifacts: new Map<string, Uint8Array>(),
    preferences: createEmptyOperatePreferences(),
  };
}

async function committedStore(project: TestProject, marker = 'first') {
  const store = new OperateStore(project.dir);
  const state = stateFixture(marker);
  const committed = await store.commit(runtimeFixture(state), null);
  return { store, state, committed };
}

describe('Operate Store read stability', () => {
  it('rejects a symlinked .planr root before replay and leaves external state untouched', async () => {
    const project = await createTestProject('operate-store-symlinked-planr');
    const external = await createTestProject('operate-store-external-planr');
    projects.push(project, external);
    const externalState = path.join(external.dir, '.planr', 'operate', 'state');
    const sentinel = path.join(externalState, 'outside.txt');
    await mkdir(externalState, { recursive: true });
    await writeFile(sentinel, 'outside-state\n');
    const before = await readFile(sentinel);

    await rm(path.join(project.dir, '.planr'), { recursive: true });
    await symlink(path.join(external.dir, '.planr'), path.join(project.dir, '.planr'), 'dir');
    const replay = vi.fn(
      async ({ baseState }: { baseState: Record<string, unknown> }) => baseState,
    );

    await expect(new OperateStore(project.dir).load(replay as never)).rejects.toMatchObject({
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });
    expect(replay).not.toHaveBeenCalled();
    expect(await readFile(sentinel)).toEqual(before);
  });

  it('rejects a symlinked config file before replay and preserves its external bytes', async () => {
    const project = await createTestProject('operate-store-symlinked-config');
    const external = await createTestProject('operate-store-external-config');
    projects.push(project, external);
    const { store, committed } = await committedStore(project);
    const configPath = path.join(project.dir, '.planr', 'config.json');
    const externalConfig = path.join(external.dir, 'external-config.json');
    const configBytes = await readFile(configPath);
    await writeFile(externalConfig, configBytes);
    await unlink(configPath);
    await symlink(externalConfig, configPath);
    const replay = vi.fn(
      async ({ baseState }: { baseState: Record<string, unknown> }) => baseState,
    );

    await expect(store.load(replay as never)).rejects.toMatchObject({
      code: 'OPERATE_STORE_INCOMPATIBLE',
    });
    expect(replay).not.toHaveBeenCalled();
    expect(await readFile(externalConfig)).toEqual(configBytes);
    expect(await readFile(path.join(store.root, 'CURRENT'), 'utf8')).toBe(
      `${String(committed.generation)}\n`,
    );
  });

  it('reports quiet durable corruption instead of masking it as a read conflict', async () => {
    const project = await createTestProject('operate-store-stable-corruption');
    projects.push(project);
    const { store, committed } = await committedStore(project);
    const manifest = path.join(
      store.root,
      'generations',
      String(committed.generation),
      'manifest.json',
    );
    await writeFile(manifest, '{not-json\n');
    const replay = vi.fn(
      async ({ baseState }: { baseState: Record<string, unknown> }) => baseState,
    );

    await expect(store.load(replay as never)).rejects.toMatchObject({
      code: 'OPERATE_STORE_CORRUPT',
      message: 'The manifest is not valid JSON.',
    });
    expect(replay).not.toHaveBeenCalled();
  });

  it('retries a generation changed by a live writer and returns its coherent successor', async () => {
    const project = await createTestProject('operate-store-live-writer');
    projects.push(project);
    const { store, committed } = await committedStore(project);
    let enterReplay!: () => void;
    let releaseReplay!: () => void;
    const replayEntered = new Promise<void>((resolve) => {
      enterReplay = resolve;
    });
    const replayReleased = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });
    let holdFirstReplay = true;
    const replay = vi.fn(async ({ baseState }: { baseState: Record<string, unknown> }) => {
      if (holdFirstReplay) {
        holdFirstReplay = false;
        enterReplay();
        await replayReleased;
      }
      return structuredClone(baseState);
    });

    const loading = store.load(replay as never);
    await replayEntered;
    const successorState = stateFixture('successor');
    const successor = await store.commit(
      runtimeFixture(successorState),
      String(committed.generation),
    );
    releaseReplay();
    const loaded = await loading;

    expect(loaded).toMatchObject({
      generation: successor.generation,
      state: successorState,
    });
    expect(replay).toHaveBeenCalledTimes(2);
  });
});
