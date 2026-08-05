import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
} from '../../src/services/operate/config.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { executeOperateAction } from '../../src/services/operate/index.js';
import { persistOperatingProjections } from '../../src/services/operate/projection-persistence.js';
import type {
  OperatingEventType,
  OperatingRoleId,
  OperatingRoleResult,
} from '../../src/services/operate/types.js';

/**
 * The aggregate operate surfaces must never contradict the per-lens board files.
 *
 * Reproduction being locked down: five advisory lenses recorded, the Chair not
 * yet run, cycle state `advising`. `board/chair.md` correctly read
 * `Status: not_evaluated`, but `operate status` answered "Operating Board is
 * quiet." and `operate review` answered "This is the mandatory human review
 * gate." — a confident, wrong answer to "is this cycle done?".
 */

const ADVISORY_ROLES: readonly OperatingRoleId[] = [
  'strategy-finance',
  'technology-risk',
  'product-activation',
  'growth-market',
  'operations-customer',
];

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

const execFileAsync = promisify(execFile);

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

/** The Operating Board requires a real worktree to resolve a project identity. */
async function gitProject(): Promise<string> {
  const projectRoot = await temporaryDirectory('openplanr-operate-truthful-project-');
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(join(projectRoot, 'service.ts'), 'export const health = (): string => "ok";\n');
  await execFileAsync('git', ['add', 'service.ts'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
  return projectRoot;
}

function roleResult(cycleId: string, roleId: OperatingRoleId): OperatingRoleResult {
  return {
    kind: 'operating-role-result',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    cycleId,
    roleId,
    inputDigest: digest('1'),
    resultDigest: digest('2'),
    outcome: 'proposals',
    proposals: [
      {
        proposalKey: `${roleId}-action`,
        type: 'finding',
        title: `Recorded ${roleId} action`,
        problem: `A problem this lens observed for ${roleId}.`,
        proposal: `A bounded action this lens recommends for ${roleId}.`,
        impact: 3,
        confidence: 3,
        ease: 3,
        severity: 'medium',
        evidenceRefs: ['EVD-repository'],
      },
    ],
    gaps: [],
    conflicts: [],
    producer: {
      product: 'openplanr',
      version: '0.0.0',
      runtime: 'fixture',
      capability: 'analysis-high',
    },
  };
}

/**
 * An initialized board whose CYCLE-001 is durably `advising` with every advisory
 * lens recorded and the Chair still outstanding — exactly the on-disk shape the
 * reproduction had when the aggregate surfaces lied.
 */
async function advisingBoardWithRecordedLenses(): Promise<{
  projectRoot: string;
  localRoot: string;
  store: OperatingEventStore;
}> {
  const projectRoot = await gitProject();
  const localRoot = await temporaryDirectory('openplanr-operate-truthful-local-');
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
    customProfile: {
      enabledRoles: [...ADVISORY_ROLES, 'chair'],
      caps: { surfacedFindings: 10, newSpecs: 3, openDecisions: 3, agentArtifacts: 2 },
    },
    charter: {
      purpose: 'Prove the aggregate surfaces never contradict the per-lens board.',
      goals: ['Keep status and review honest while a cycle is still in flight.'],
    },
    now: '2026-08-04T09:00:00.000Z',
  });
  await applyOperatingInitialization({
    projectRoot,
    localRoot,
    preview,
    confirmationDigest: preview.previewDigest,
  });

  const store = new OperatingEventStore(projectRoot, { localRoot });
  let head = (await store.replay()).eventHead.hash;
  const append = async (
    type: OperatingEventType,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    const event = await store.append({
      type,
      cycleId: 'CYCLE-001',
      entityId,
      correlationId: 'aggregate-truthfulness-fixture',
      expectedHead: head,
      timestamp: '2026-08-04T09:00:00.000Z',
      payload,
    });
    head = event.eventHash;
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
      enabledRoles: [...ADVISORY_ROLES, 'chair'],
      enabledProviders: ['repository'],
      createdAt: '2026-08-04T09:00:00.000Z',
      updatedAt: '2026-08-04T09:00:00.000Z',
      producer: { product: 'openplanr', version: '1.25.0', runtime: 'codex' },
    },
  });
  await append('cycle.collecting', 'CYCLE-001', {});
  await append('cycle.advising', 'CYCLE-001', {});

  for (const roleId of ADVISORY_ROLES) {
    const record = await store.putRecord('advisor-result', roleResult('CYCLE-001', roleId), {
      correlationId: 'aggregate-truthfulness-fixture',
      createdAt: '2026-08-04T09:00:00.000Z',
    });
    await append('advisory.recorded', `CYCLE-001-${roleId}`, { recordDigest: record.digest });
  }

  // Materialize the readable tree exactly as an in-flight cycle does, so the
  // per-lens board files exist on disk: five recorded lenses plus an honest
  // `Status: not_evaluated` chair.md — the shape the reproduction had when the
  // aggregate surfaces contradicted it.
  await persistOperatingProjections({
    projectRoot,
    localRoot,
    state: await store.state(),
    revalidateEventHead: async () => (await store.replay()).eventHead,
  });
  return { projectRoot, localRoot, store };
}

describe('operate aggregate surfaces during an in-flight cycle', () => {
  it('reports the real advising state and the outstanding lens instead of "quiet"', async () => {
    const { projectRoot, localRoot, store } = await advisingBoardWithRecordedLenses();

    // The precondition the reproduction had: durably advising, five lenses
    // recorded, no projected finding yet — so `summary.quiet` is still true.
    const state = await store.state();
    expect(state.cycles.find((cycle) => cycle.id === 'CYCLE-001')?.state).toBe('advising');
    expect(state.summary.quiet).toBe(true);

    const result = await executeOperateAction({
      action: 'status',
      projectRoot,
      interactive: false,
      options: { json: true, localRoot, now: '2026-08-04T10:00:00.000Z' },
    });

    expect(result.ok).toBe(true);
    expect(result.message).not.toContain('Operating Board is quiet');
    expect(result.message).toContain('CYCLE-001 is advising');
    expect(result.message).toContain('5 of 6 advisory lens result(s) recorded');
    expect(result.message).toContain('5 recorded proposal(s) awaiting consolidation');
    expect(result.message).toContain('Outstanding lens(es): chair');
  });

  it('names the current phase and the missing artifacts instead of announcing the review gate', async () => {
    const { projectRoot, localRoot } = await advisingBoardWithRecordedLenses();

    const result = await executeOperateAction({
      action: 'review',
      projectRoot,
      arguments: { cycleId: 'CYCLE-001' },
      interactive: false,
      options: { json: true, localRoot },
    });

    expect(result.ok).toBe(true);
    expect(result.message).not.toContain('This is the mandatory human review gate');
    expect(result.message).toContain('CYCLE-001 is advising and has NOT reached the human review');
    expect(result.message).toContain('Current phase: D — Chair consolidation');
    expect(result.message).toContain('board/chair.md');
    // The one guarantee the old message carried that is still true.
    expect(result.message).toContain('No route has been applied.');
    expect(result.warnings).toContain(
      'Missing before the review gate: Chair consolidation result (cycles/CYCLE-001/board/chair.md)',
    );
  });

  it('still announces the review gate once the cycle reaches a reviewable state', async () => {
    const { projectRoot, localRoot, store } = await advisingBoardWithRecordedLenses();
    for (const type of ['cycle.consolidating', 'cycle.reviewable'] as const) {
      await store.append({
        type,
        cycleId: 'CYCLE-001',
        entityId: 'CYCLE-001',
        correlationId: 'aggregate-truthfulness-fixture',
        expectedHead: (await store.replay()).eventHead.hash,
        timestamp: '2026-08-04T09:30:00.000Z',
        payload: {},
      });
    }

    expect((await store.state()).cycles.find((cycle) => cycle.id === 'CYCLE-001')?.state).toBe(
      'reviewable',
    );

    const result = await executeOperateAction({
      action: 'review',
      projectRoot,
      arguments: { cycleId: 'CYCLE-001' },
      interactive: false,
      options: { json: true, localRoot },
    });

    expect([result.ok, result.code]).toEqual([true, undefined]);
    expect(result.message).toBe(
      'This is the mandatory human review gate. No route has been applied.',
    );
    expect(result.warnings).toEqual([]);
  });
});
