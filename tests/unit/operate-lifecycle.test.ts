import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import {
  assertOperatingCycleDisposable,
  decideOperatingDecision,
  transitionOperatingCycle,
} from '../../src/services/operate/lifecycle.js';
import type { OperatingState } from '../../src/services/operate/types.js';

const temporaryDirectories: string[] = [];
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

function state(
  overrides: Partial<Pick<OperatingState, 'findings' | 'decisions' | 'routes'>> = {},
): OperatingState {
  return {
    kind: 'operating-state',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    generatedAt: '2026-07-28T12:00:00.000Z',
    eventHead: { sequence: 1, hash: `sha256:${'a'.repeat(64)}` },
    cycles: [{ id: 'CYCLE-001', state: 'reviewable' }],
    findings: [],
    decisions: [],
    dataGaps: [],
    routes: [],
    specLinks: [],
    outcomes: [],
    learnings: [],
    evidenceSources: [],
    summary: {
      currentCycleId: 'CYCLE-001',
      currentConstraint: null,
      quiet: true,
      evidenceFreshness: 'fresh',
      surfacedFindings: 0,
      parkedFindings: 0,
      openDecisions: 0,
      openGaps: 0,
      stalledItems: 0,
    },
    ...overrides,
  };
}

async function reviewableDecisionFixture(): Promise<{
  projectRoot: string;
  localRoot: string;
  store: OperatingEventStore;
}> {
  const projectRoot = await temporaryDirectory('openplanr-operate-lifecycle-project-');
  const localRoot = await temporaryDirectory('openplanr-operate-lifecycle-local-');
  const store = new OperatingEventStore(projectRoot, { localRoot });
  let head: `sha256:${string}` | null = null;
  const append = async (
    type: Parameters<OperatingEventStore['append']>[0]['type'],
    entityId: string,
    payload: Record<string, unknown>,
  ) => {
    const event = await store.append({
      type,
      cycleId: 'CYCLE-001',
      entityId,
      correlationId: 'lifecycle-regression',
      expectedHead: head,
      payload,
    });
    head = event.eventHash;
    return event;
  };
  await append('cycle.preparing', 'CYCLE-001', {
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
      enabledRoles: ['technology-risk'],
      enabledProviders: ['repository'],
      createdAt: '2026-07-28T09:00:00.000Z',
      updatedAt: '2026-07-28T09:00:00.000Z',
      producer: { product: 'openplanr', version: '1.14.0', runtime: 'fixture' },
    },
  });
  await append('cycle.collecting', 'CYCLE-001', {});
  await append('cycle.advising', 'CYCLE-001', {});
  await append('cycle.consolidating', 'CYCLE-001', {});
  await append('decision.open', 'DEC-001', {
    record: {
      kind: 'operating-decision',
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      id: 'DEC-001',
      cycleId: 'CYCLE-001',
      question: 'Which option should be selected?',
      options: [
        { id: 'A', label: 'Option A' },
        { id: 'B', label: 'Option B' },
      ],
      recommendation: 'Choose B.',
      consequences: 'The selected option is recorded for audit.',
      reversibility: 'reversible',
      deadline: '2026-07-30T12:00:00.000Z',
      proposedDefault: null,
      unblocks: [],
      status: 'open',
      owner: 'Product owner',
      evidenceRefs: ['EVD-fixture'],
      createdAt: '2026-07-28T09:04:00.000Z',
      updatedAt: '2026-07-28T09:04:00.000Z',
    },
  });
  await append('cycle.reviewable', 'CYCLE-001', { patch: { health: 'normal' } });
  return { projectRoot, localRoot, store };
}

describe('operating cycle close disposal', () => {
  it('allows quiet cycles and ignores parked findings', () => {
    expect(() => assertOperatingCycleDisposable(state(), 'CYCLE-001')).not.toThrow();
    expect(() =>
      assertOperatingCycleDisposable(
        state({
          findings: [
            {
              id: 'FND-001',
              cycleId: 'CYCLE-001',
              status: 'proposed',
              parked: true,
            },
          ],
        }),
        'CYCLE-001',
      ),
    ).not.toThrow();
  });

  it('reports every surfaced finding and owner decision that is not disposed', () => {
    expect(() =>
      assertOperatingCycleDisposable(
        state({
          findings: [
            { id: 'FND-002', cycleId: 'CYCLE-001', status: 'accepted' },
            { id: 'FND-001', cycleId: 'CYCLE-001', status: 'proposed' },
          ],
          decisions: [{ id: 'DEC-001', cycleId: 'CYCLE-001', status: 'answered' }],
        }),
        'CYCLE-001',
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'E_OPERATE_CYCLE_NOT_DISPOSED',
        details: expect.objectContaining({
          blockingFindings: [
            { id: 'FND-001', status: 'proposed' },
            { id: 'FND-002', status: 'accepted' },
          ],
          blockingDecisions: [{ id: 'DEC-001', status: 'answered' }],
        }),
      }),
    );
  });

  it('accepts terminal governance or an applied route bound to the finding', () => {
    expect(() =>
      assertOperatingCycleDisposable(
        state({
          findings: [
            { id: 'FND-001', cycleId: 'CYCLE-001', status: 'accepted' },
            { id: 'FND-002', cycleId: 'CYCLE-001', status: 'rejected' },
            { id: 'FND-003', cycleId: 'CYCLE-001', status: 'superseded' },
            { id: 'FND-004', cycleId: 'CYCLE-001', status: 'done' },
          ],
          decisions: [
            { id: 'DEC-001', cycleId: 'CYCLE-001', status: 'closed' },
            { id: 'DEC-002', cycleId: 'CYCLE-001', status: 'superseded' },
          ],
          routes: [
            {
              id: 'ACT-001',
              cycleId: 'CYCLE-001',
              state: 'applied',
              findingIds: ['FND-001'],
            },
          ],
        }),
        'CYCLE-001',
      ),
    ).not.toThrow();
  });

  it('rechecks disposal under the writer lock before appending cycle.closed', async () => {
    const { projectRoot, localRoot, store } = await reviewableDecisionFixture();
    const originalState = OperatingEventStore.prototype.state;
    vi.spyOn(OperatingEventStore.prototype, 'state').mockImplementationOnce(async function (
      this: OperatingEventStore,
      checkpoint,
    ) {
      const stale = await originalState.call(this, checkpoint);
      return {
        ...stale,
        decisions: stale.decisions.map((decision) => ({
          ...decision,
          status: 'closed',
        })),
      };
    });

    await expect(
      transitionOperatingCycle({
        projectRoot,
        localRoot,
        cycleId: 'CYCLE-001',
        action: 'close',
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_CYCLE_NOT_DISPOSED' });
    expect((await store.replay()).events.some((event) => event.type === 'cycle.closed')).toBe(
      false,
    );
  });
});

describe('operating decision lifecycle', () => {
  it('resumes an interrupted answered decision by appending only decision.closed', async () => {
    const { projectRoot, localRoot, store } = await reviewableDecisionFixture();
    const replay = await store.replay();
    await store.append({
      type: 'decision.answered',
      cycleId: 'CYCLE-001',
      entityId: 'DEC-001',
      correlationId: 'lifecycle-regression',
      expectedHead: replay.eventHead.hash,
      actor: { kind: 'human', id: 'operate-cli' },
      payload: {
        patch: { selectedOption: 'B' },
        reason: 'The first invocation stopped before closure.',
      },
    });

    await decideOperatingDecision({
      projectRoot,
      localRoot,
      decisionId: 'DEC-001',
      value: 'B',
      confirmed: true,
    });

    const events = (await store.replay()).events;
    expect(events.filter((event) => event.type === 'decision.answered')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'decision.closed')).toHaveLength(1);
    expect((await store.state()).decisions).toContainEqual(
      expect.objectContaining({
        id: 'DEC-001',
        status: 'closed',
        selectedOption: 'B',
      }),
    );
  });
});
