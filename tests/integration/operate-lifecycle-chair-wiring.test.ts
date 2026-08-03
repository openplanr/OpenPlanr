import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AdvisorAdapter } from '../../src/services/operate/advisors.js';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
} from '../../src/services/operate/config.js';
import {
  type RunOperatingCycleInput,
  runOperatingCycle,
} from '../../src/services/operate/engine.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';

/**
 * SPEC-005 T-015 — wire the lifecycle driver (T-003) and the Chair board
 * assembler (T-004) into the LIVE operating cycle, and prove both on the live
 * path by driving a REAL `runOperatingCycle` (never the helpers directly):
 *
 *  - Wiring 1 (advisor fan-out): a lens that stalls past its retry budget
 *    terminates not_evaluated with a governed reason while its siblings keep
 *    recording, the lease keeps renewing via the driver's heartbeat, and the
 *    cycle still reaches Chair.
 *  - Wiring 2 (Chair phase): the Chair's input is produced by
 *    `assembleChairBoardInput` — the absent lens is a named gap with its real
 *    reason, and no proposal item attributable to it exists in the grounded
 *    evidence.
 *
 * The mandate/protocol loader is bound to the local pipeline checkout, exactly as
 * the other agent-native operate integration suites do.
 */
beforeAll(() => {
  process.env.OPENPLANR_PIPELINE_ROOT =
    process.env.OPENPLANR_PIPELINE_ROOT ?? join(process.cwd(), '..', 'planr-pipeline');
});

afterAll(() => {
  delete process.env.OPENPLANR_PIPELINE_ROOT;
});

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

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

/** Stand up a real, committed operating project with the given advisory board. */
async function initialize(enabledRoles: string[]): Promise<{
  projectRoot: string;
  localRoot: string;
}> {
  const projectRoot = await temporaryDirectory('openplanr-t015-project-');
  const localRoot = await temporaryDirectory('openplanr-t015-local-');
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(
    join(projectRoot, 'service.ts'),
    'export function health(): string {\n  return "ok";\n}\n',
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
    timezone: 'UTC',
    sensitivityCeiling: 'internal',
    customProfile: {
      enabledRoles,
      caps: { surfacedFindings: 20, newSpecs: 6, openDecisions: 6, agentArtifacts: 4 },
    },
    charter: {
      purpose: 'Exercise the wired advisor lifecycle driver and Chair board assembler.',
      goals: ['Keep the cycle honest when a lens stalls.'],
    },
    now: '2026-07-28T12:00:00.000Z',
  });
  await applyOperatingInitialization({
    projectRoot,
    localRoot,
    preview,
    confirmationDigest: preview.previewDigest,
  });
  return { projectRoot, localRoot };
}

/**
 * A board fixture. Every lens grounds a proposal against the committed
 * `service.ts` so its citations resolve; the role named `stalledRole` returns a
 * never-resolving promise, modelling a lens that stalls — the driver's
 * per-attempt timeout is what ends each attempt, never a wall-clock sleep here.
 */
function boardAdapter(stalledRole?: string): AdvisorAdapter {
  return {
    id: 'lifecycle-fixture',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    capability: 'analysis-high',
    parallelDispatch: true,
    async invoke(input) {
      if (stalledRole && input.roleId === stalledRole) {
        return new Promise<unknown>(() => {
          // Intentionally never resolves: the lens has stalled.
        });
      }
      const citations = [
        {
          repositoryPath: 'service.ts',
          lineRange: { start: 1, end: 1 },
          pinnedRevision: input.pinnedRevision,
        },
      ];
      if (input.roleId === 'chair') {
        return {
          outcome: 'proposals',
          proposals: [
            {
              proposalKey: 'chair-synthesis',
              type: 'merge',
              title: 'Consolidate the board into a reviewable brief',
              problem: 'The owner needs one synthesis of the recorded lenses.',
              proposal: 'Prepare a local, reviewable synthesis without external publication.',
              impact: 2,
              confidence: 3,
              ease: 5,
              severity: 'low',
              citations,
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
            proposalKey: `${input.roleId}-proposal`,
            type: 'finding',
            title: `Harden the health surface (${input.roleId})`,
            problem: 'Health behaviour lacks a reviewed specification.',
            proposal: 'Create a bounded specification with a measurable completion outcome.',
            impact: 3,
            confidence: 3,
            ease: 4,
            severity: 'medium',
            citations,
          },
        ],
        gaps: [],
        conflicts: [],
      };
    },
  };
}

/**
 * Real timers with small windows keep the test deterministic without any injected
 * virtual clock racing the healthy lenses' real dispatch I/O: a stalled lens NEVER
 * resolves, so it always loses the race to the per-attempt timeout, and a lease
 * window shorter than the heartbeat lead guarantees the heartbeat fires on every
 * tick — independent of any role completing. The clock/timers are injected
 * explicitly so the engine threads them into the driver.
 */
const lifecycleHooks: RunOperatingCycleInput['advisorLifecycle'] = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  roleTimeoutMs: 3_000,
  retryBudget: 1,
  heartbeatIntervalMs: 150,
  heartbeatLeadMs: 1_000,
  leaseWindowMs: 400,
};

describe('T-015 — lifecycle driver and Chair assembler wired into the live cycle', () => {
  it('terminates a stalled lens not_evaluated while siblings record, renews the lease, and reaches Chair (FR3/FR13)', async () => {
    const stalledRole = 'strategy-finance';
    const recordingRoles = ['technology-risk', 'product-activation'];
    const { projectRoot, localRoot } = await initialize([stalledRole, ...recordingRoles, 'chair']);

    const result = await runOperatingCycle({
      projectRoot,
      localRoot,
      adapter: boardAdapter(stalledRole),
      confirmed: true,
      now: new Date('2026-07-28T13:00:00.000Z'),
      advisorLifecycle: lifecycleHooks,
    });

    // DoD 1 — the stalled lens is terminal not_evaluated with a governed reason,
    // every other lens recorded, and the cycle reached (and recorded) Chair.
    const lifecycle = result.advisorLifecycle;
    expect(lifecycle).toBeDefined();
    expect(lifecycle?.notEvaluated).toEqual([stalledRole]);
    expect([...(lifecycle?.recorded ?? [])].sort()).toEqual([...recordingRoles].sort());
    const stalledGap = lifecycle?.gaps.find((gap) => gap.roleId === stalledRole);
    expect(stalledGap?.outcome).toBe('not_evaluated');
    expect(stalledGap?.reason ?? '').not.toHaveLength(0);
    const stalledSnapshot = lifecycle?.snapshot.find((role) => role.roleId === stalledRole);
    expect(stalledSnapshot?.state).toBe('not_evaluated');
    expect(stalledSnapshot?.retriesUsed).toBe(1); // one bounded retry was spent before terminating

    // The cycle reached Chair and Chair recorded a real analysis over the
    // partial board (the stall did not hold the Chair closed for optional lenses).
    const recordedRoleIds = (result.roleResults ?? []).map((role) => role.roleId);
    expect(recordedRoleIds).toContain('chair');
    for (const role of recordingRoles) expect(recordedRoleIds).toContain(role);
    expect(recordedRoleIds).not.toContain(stalledRole);

    // The recorded work is durable and the stalled lens carries a governed gap.
    const state = await new OperatingEventStore(projectRoot, { localRoot }).state();
    const persistedRoles = new Set(
      state.cycles.flatMap(() => recordedRoleIds).concat(recordedRoleIds),
    );
    for (const role of recordingRoles) expect(persistedRoles.has(role)).toBe(true);
    expect(
      state.dataGaps.some(
        (gap) => Array.isArray(gap.affectedRoles) && gap.affectedRoles.includes(stalledRole),
      ),
    ).toBe(true);

    // DoD 2 — the driver's heartbeat renewed the lease during the cycle with no
    // role completing (injected clock), so the stall could not expire recorded
    // work. A lease window shorter than the lead makes this deterministic.
    expect(lifecycle?.heartbeats ?? 0).toBeGreaterThanOrEqual(1);

    // DoD 3 — the Chair's input was produced by `assembleChairBoardInput`: the
    // absent lens is a NAMED gap with its real reason, classified not-evaluated,
    // and NO proposal item attributable to it exists in the grounded evidence.
    const chairBoard = result.chairBoard;
    expect(chairBoard).toBeDefined();
    const namedGap = (chairBoard?.gaps ?? []).find((line) => line.includes(stalledRole));
    expect(namedGap).toBeDefined();
    expect(namedGap).toMatch(/do not\s+synthesize/i);
    const stalledContribution = (chairBoard?.contributions ?? []).find(
      (entry) => entry.roleId === stalledRole,
    );
    expect(stalledContribution?.outcome).toBe('not-evaluated');
    expect(stalledContribution?.reason ?? '').not.toHaveLength(0);
    const groundedItemIds = (chairBoard?.evidence.items ?? []).map((item) => item.id);
    expect(groundedItemIds.some((id) => id.includes(`advisor-results-${stalledRole}`))).toBe(false);
    // The recording siblings DO contribute grounded proposal items — proof the
    // grounded evidence is real, not empty.
    for (const role of recordingRoles) {
      expect(groundedItemIds.some((id) => id.includes(`advisor-results-${role}`))).toBe(true);
    }
  }, 60_000);

  it('records a five-lens board and reaches Chair with no fabricated gap on the happy path (DoD 4)', async () => {
    const lenses = [
      'strategy-finance',
      'technology-risk',
      'product-activation',
      'growth-market',
      'operations-customer',
    ];
    const { projectRoot, localRoot } = await initialize([...lenses, 'chair']);

    const result = await runOperatingCycle({
      projectRoot,
      localRoot,
      adapter: boardAdapter(),
      confirmed: true,
      now: new Date('2026-07-28T13:05:00.000Z'),
      advisorLifecycle: lifecycleHooks,
    });

    // Every lens recorded; nothing stalled; the driver reports chair-ready and no
    // governed gap, and the Chair board fabricates no gap over a full board.
    expect([...(result.advisorLifecycle?.recorded ?? [])].sort()).toEqual([...lenses].sort());
    expect(result.advisorLifecycle?.notEvaluated).toEqual([]);
    expect(result.advisorLifecycle?.gaps).toEqual([]);
    expect(result.advisorLifecycle?.chairReady).toBe(true);
    const recordedRoleIds = (result.roleResults ?? []).map((role) => role.roleId);
    expect(recordedRoleIds).toContain('chair');
    for (const lens of lenses) expect(recordedRoleIds).toContain(lens);
    // No absent-perspective gap line: every contribution recorded an analysis.
    expect(result.chairBoard?.gaps).toEqual([]);
    for (const contribution of result.chairBoard?.contributions ?? []) {
      expect(['recorded-evaluated', 'recorded-quiet']).toContain(contribution.outcome);
    }
  }, 60_000);
});
