import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalDigest, canonicalize } from '../../src/services/operate/canonical.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { loadOperatingProtocol } from '../../src/services/operate/protocol.js';

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
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function cycleManifest() {
  return {
    kind: 'operating-cycle-manifest',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    id: 'CYCLE-001',
    state: 'preparing',
    health: 'normal',
    depth: 'standard',
    focus: ['all'],
    inputDigest: digest('a'),
    enabledRoles: ['technology-risk'],
    enabledProviders: ['repository', 'git'],
    createdAt: '2026-07-28T09:00:00.000Z',
    updatedAt: '2026-07-28T09:00:00.000Z',
    completedAt: null,
    producer: {
      product: 'openplanr',
      version: '1.14.0',
      runtime: 'fixture',
    },
    warnings: [],
  };
}

describe('canonical operating artifacts and sibling Protocol replay', () => {
  it('uses deterministic JCS-compatible serialization and rejects non-I-JSON values', () => {
    expect(
      canonicalize({
        z: 'last',
        a: 'first',
        nested: { b: 2, a: -0 },
        unicode: '€$\u000f\nA\'B"\\\\\\"/',
      }),
    ).toBe(
      '{"a":"first","nested":{"a":0,"b":2},"unicode":"€$\\u000f\\nA\'B\\"\\\\\\\\\\\\\\"/","z":"last"}',
    );
    expect(canonicalDigest({ b: 2, a: 1 })).toBe(canonicalDigest({ a: 1, b: 2 }));
    expect(() => canonicalize({ value: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalize({ value: '\ud800' })).toThrow(/lone Unicode surrogate/);
    expect(() => canonicalize({ value: undefined })).toThrow(/undefined/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalize(cyclic)).toThrow(/cyclic/);
  });

  it('round-trips CLI-owned events through the sibling pipeline loader', async () => {
    const projectRoot = await temporaryDirectory('openplanr-operate-events-project-');
    const localRoot = await temporaryDirectory('openplanr-operate-events-local-');
    const store = new OperatingEventStore(projectRoot, { localRoot });
    const preparing = await store.append({
      type: 'cycle.preparing',
      cycleId: 'CYCLE-001',
      entityId: 'CYCLE-001',
      eventId: 'evt-cli-001',
      timestamp: '2026-07-28T09:00:00.000Z',
      correlationId: 'cli-round-trip',
      payload: { record: cycleManifest() },
    });
    const collecting = await store.append({
      type: 'cycle.collecting',
      cycleId: 'CYCLE-001',
      entityId: 'CYCLE-001',
      eventId: 'evt-cli-002',
      timestamp: '2026-07-28T09:01:00.000Z',
      correlationId: 'cli-round-trip',
      expectedHead: preparing.eventHash,
      payload: { patch: { health: 'normal' } },
    });

    const replay = await store.replay();
    const protocol = await loadOperatingProtocol();
    expect(replay.events).toEqual([preparing, collecting]);
    expect(protocol.verifyOperatingEventChain(replay.events)).toEqual({
      sequence: 2,
      hash: collecting.eventHash,
    });
    expect(
      replay.events.flatMap((event) => protocol.validateProtocolArtifact('operating-event', event)),
    ).toEqual([]);
    expect(protocol.reduceOperatingEvents(replay.events).cycles[0]).toMatchObject({
      id: 'CYCLE-001',
      state: 'collecting',
      health: 'normal',
    });

    const persisted = await readFile(store.paths.events, 'utf8');
    expect(persisted).toBe(`${replay.events.map((event) => canonicalize(event)).join('\n')}\n`);
  });

  it('rejects a persisted event whose payload changed after hashing', async () => {
    const projectRoot = await temporaryDirectory('openplanr-operate-tamper-project-');
    const localRoot = await temporaryDirectory('openplanr-operate-tamper-local-');
    const store = new OperatingEventStore(projectRoot, { localRoot });
    await store.append({
      type: 'cycle.preparing',
      cycleId: 'CYCLE-001',
      entityId: 'CYCLE-001',
      eventId: 'evt-cli-001',
      timestamp: '2026-07-28T09:00:00.000Z',
      correlationId: 'cli-tamper',
      payload: { record: cycleManifest() },
    });
    const [event] = (await store.replay()).events;
    const tampered = structuredClone(event);
    (
      tampered.payload.record as {
        producer: { runtime: string };
      }
    ).producer.runtime = 'tampered';
    await writeFile(store.paths.events, `${canonicalize(tampered)}\n`);

    await expect(store.replay()).rejects.toMatchObject({
      code: 'E_OPERATE_STATE_INVALID',
    });
  });
});
