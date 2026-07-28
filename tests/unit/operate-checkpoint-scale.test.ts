import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { canonicalDigest, canonicalize } from '../../src/services/operate/canonical.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { loadOperatingProtocol } from '../../src/services/operate/protocol.js';
import type { OperatingEvent } from '../../src/services/operate/types.js';

/**
 * Checkpoint behaviour at the SPEC-002 scale target: a 10,000-event stream
 * must replay, verify, checkpoint, and re-project without drift, and must
 * still reject a single tampered event anywhere in the log.
 *
 * Events are chained directly through the Protocol rather than through
 * `store.append()`, which re-replays the whole log on every call. That keeps
 * the fixture linear while exercising the same canonical hash chain the
 * append path produces.
 *
 * States are compared by canonical digest rather than deep equality: at this
 * size the projections hold 10,000 entries, and a structural diff of two of
 * them costs far more than the assertion it supports.
 */

const TOTAL_EVENTS = 10_000;

const temporaryDirectories: string[] = [];
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

/** Deterministic per-event record digest; content is irrelevant to the chain. */
const recordDigest = (sequence: number): `sha256:${string}` =>
  `sha256:${sequence.toString(16).padStart(64, '0')}`;

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

async function evidenceEvent(
  sequence: number,
  previous: OperatingEvent | null,
): Promise<OperatingEvent> {
  const protocol = await loadOperatingProtocol();
  const isGenesis = sequence === 1;
  return protocol.createOperatingEvent(
    {
      eventId: `evt-${String(sequence).padStart(6, '0')}`,
      // Fixed epoch plus sequence keeps timestamps ordered and deterministic.
      timestamp: new Date(Date.UTC(2026, 6, 28, 9, 0, 0) + sequence * 1000).toISOString(),
      cycleId: 'CYCLE-001',
      type: isGenesis ? 'cycle.preparing' : 'evidence.collected',
      // Evidence collection is recorded against the owning cycle; only
      // canonical entity families are valid entityIds.
      entityId: 'CYCLE-001',
      actor: { kind: 'engine', id: 'openplanr' },
      causationId: null,
      correlationId: 'checkpoint-scale',
      evidenceRefs: [],
      payload: isGenesis
        ? { record: cycleManifest() }
        : {
            recordDigest: recordDigest(sequence),
            sources: [
              {
                id: `source-${sequence}`,
                freshness: 'fresh',
                status: 'collected',
                itemCount: 1,
              },
            ],
          },
    },
    { previousEvent: previous, sequence },
  ) as OperatingEvent;
}

/** Built once — chaining 10,000 events is linear but not free. */
let stream: OperatingEvent[];

beforeAll(async () => {
  stream = [];
  let previous: OperatingEvent | null = null;
  for (let sequence = 1; sequence <= TOTAL_EVENTS; sequence += 1) {
    const event = await evidenceEvent(sequence, previous);
    stream.push(event);
    previous = event;
  }
}, 120_000);

async function storeWith(events: OperatingEvent[]): Promise<OperatingEventStore> {
  const projectRoot = await temporaryDirectory('openplanr-operate-scale-project-');
  const localRoot = await temporaryDirectory('openplanr-operate-scale-local-');
  const store = new OperatingEventStore(projectRoot, { localRoot });
  await store.initialize();
  await writeFile(
    store.paths.events,
    `${events.map((event) => canonicalize(event)).join('\n')}\n`,
    'utf8',
  );
  return store;
}

describe('Operating Board checkpoints at 10,000 events', () => {
  it('replays, verifies, checkpoints, and re-projects a 10,000-event stream without drift', async () => {
    const store = await storeWith(stream);
    const protocol = await loadOperatingProtocol();

    const replay = await store.replay();
    expect(replay.events).toHaveLength(TOTAL_EVENTS);
    expect(replay.eventHead).toEqual({
      sequence: TOTAL_EVENTS,
      hash: stream.at(-1)?.eventHash,
    });
    expect(protocol.verifyOperatingEventChain(replay.events)).toEqual(replay.eventHead);

    // Full projection from genesis.
    const full = await store.state();
    expect(full.evidenceSources).toHaveLength(TOTAL_EVENTS - 1);

    const checkpoint = await store.writeCheckpoint(full);
    expect(checkpoint.eventHead).toEqual(replay.eventHead);
    expect(await store.readCheckpoint()).toEqual(checkpoint);

    // Resuming from a checkpoint whose head is the log head applies no further
    // events and must reproduce the genesis projection exactly.
    const fromCheckpoint = await store.state(checkpoint);
    expect(canonicalDigest(fromCheckpoint)).toBe(canonicalDigest(full));
  });

  it('projects a post-checkpoint tail identically to a full replay from genesis', async () => {
    const store = await storeWith(stream);
    const checkpoint = await store.writeCheckpoint();
    expect(checkpoint.eventHead.sequence).toBe(TOTAL_EVENTS);

    // Extend the stream past the checkpoint.
    let previous = stream.at(-1) as OperatingEvent;
    const tail: OperatingEvent[] = [];
    for (let offset = 1; offset <= 250; offset += 1) {
      const event = await evidenceEvent(TOTAL_EVENTS + offset, previous);
      tail.push(event);
      previous = event;
    }
    await appendFile(
      store.paths.events,
      `${tail.map((event) => canonicalize(event)).join('\n')}\n`,
      'utf8',
    );

    const incremental = await store.state(checkpoint);
    const fromGenesis = await store.state();
    expect(canonicalDigest(incremental)).toBe(canonicalDigest(fromGenesis));
    expect(fromGenesis.evidenceSources).toHaveLength(TOTAL_EVENTS - 1 + tail.length);
  });

  it('rejects a single tampered event buried in the middle of a 10,000-event log', async () => {
    const store = await storeWith(stream);

    // Rewrite event 5,000's payload while leaving its recorded hash intact.
    const lines = (await readFile(store.paths.events, 'utf8')).trimEnd().split('\n');
    const target = JSON.parse(lines[4_999]) as OperatingEvent;
    (target.payload as { sources: Array<{ itemCount: number }> }).sources[0].itemCount = 999;
    lines[4_999] = canonicalize(target);
    await writeFile(store.paths.events, `${lines.join('\n')}\n`, 'utf8');

    await expect(store.replay()).rejects.toThrowError(/hash check|invalid/i);
  });
});
