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
 * SPEC-005 T-017 — the `citation-rejected` outcome, proven on the LIVE
 * `runOperatingCycle` path (never the helpers directly). Two coupled defects are
 * exercised end to end:
 *
 *  A. A role whose proposal cites a fabricated path is governed with a citation
 *     rejection gap. Persisting that gap through the real event store used to throw
 *     `E_OPERATE_STATE_INVALID` (the append log / operating-record schemas only
 *     admit a v1.2 data gap); the cycle must now COMPLETE and the gap must be
 *     readable back from the store.
 *  B. That role must classify `citation-rejected` on the Chair board — DISTINCT
 *     from a lens that genuinely produced nothing (a stall → `not-evaluated`) and
 *     from a lens that recorded a real analysis (`recorded-evaluated`). One
 *     invalid citation must not drop a sibling's valid proposal (FR8).
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
  const projectRoot = await temporaryDirectory('openplanr-t017-project-');
  const localRoot = await temporaryDirectory('openplanr-t017-local-');
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
      purpose: 'Exercise the live citation-rejected outcome and its governed gap persistence.',
      goals: ['Keep the board honest when a lens cites a fabricated location.'],
    },
    now: '2026-08-03T12:00:00.000Z',
  });
  await applyOperatingInitialization({
    projectRoot,
    localRoot,
    preview,
    confirmationDigest: preview.previewDigest,
  });
  return { projectRoot, localRoot };
}

function resolvableCitation(pinnedRevision: string): Record<string, unknown> {
  return { repositoryPath: 'service.ts', lineRange: { start: 1, end: 1 }, pinnedRevision };
}

function fabricatedCitation(pinnedRevision: string): Record<string, unknown> {
  // `phantom.ts` was never committed and is not in the working tree, so the
  // citation gate rejects it at the pinned revision (fabricated path).
  return { repositoryPath: 'phantom.ts', lineRange: { start: 1, end: 1 }, pinnedRevision };
}

function proposal(
  roleId: string,
  key: string,
  citation: Record<string, unknown>,
): Record<string, unknown> {
  return {
    proposalKey: key,
    type: 'finding',
    title: `Harden the health surface (${roleId})`,
    problem: 'Health behaviour lacks a reviewed specification.',
    proposal: 'Create a bounded specification with a measurable completion outcome.',
    impact: 3,
    confidence: 3,
    ease: 4,
    severity: 'medium',
    citations: [citation],
  };
}

/**
 * A board fixture. `stalledRole` never resolves (a genuine stall → not_evaluated).
 * `fabricatedRole` returns a single proposal citing a fabricated path (every
 * proposal citation-rejected). `mixedRole` returns one valid and one fabricated
 * proposal (FR8 partial validity). Every other lens grounds one valid proposal.
 */
function boardAdapter(config: {
  stalledRole?: string;
  fabricatedRole: string;
  mixedRole: string;
}): AdvisorAdapter {
  return {
    id: 'citation-rejected-fixture',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    capability: 'analysis-high',
    parallelDispatch: true,
    async invoke(input) {
      if (config.stalledRole && input.roleId === config.stalledRole) {
        return new Promise<unknown>(() => {
          // Intentionally never resolves: the lens has stalled.
        });
      }
      if (input.roleId === config.fabricatedRole) {
        return {
          outcome: 'proposals',
          proposals: [
            proposal(
              input.roleId,
              `${input.roleId}-fabricated`,
              fabricatedCitation(input.pinnedRevision),
            ),
          ],
          gaps: [],
          conflicts: [],
        };
      }
      if (input.roleId === config.mixedRole) {
        return {
          outcome: 'proposals',
          proposals: [
            proposal(
              input.roleId,
              `${input.roleId}-valid`,
              resolvableCitation(input.pinnedRevision),
            ),
            proposal(
              input.roleId,
              `${input.roleId}-fabricated`,
              fabricatedCitation(input.pinnedRevision),
            ),
          ],
          gaps: [],
          conflicts: [],
        };
      }
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
              citations: [resolvableCitation(input.pinnedRevision)],
            },
          ],
          gaps: [],
          conflicts: [],
        };
      }
      return {
        outcome: 'proposals',
        proposals: [
          proposal(input.roleId, `${input.roleId}-valid`, resolvableCitation(input.pinnedRevision)),
        ],
        gaps: [],
        conflicts: [],
      };
    },
  };
}

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

describe('T-017 — citation-rejected reachable and durable on the live cycle', () => {
  const fabricatedRole = 'strategy-finance';
  const stalledRole = 'technology-risk';
  const recordedRole = 'product-activation';
  const mixedRole = 'growth-market';

  it('completes the cycle, persists the governed citation gap, and classifies citation-rejected distinctly (FR2/FR8/FR13)', async () => {
    const { projectRoot, localRoot } = await initialize([
      fabricatedRole,
      stalledRole,
      recordedRole,
      mixedRole,
      'chair',
    ]);

    // DoD 1 — the live cycle with a fabricated-path citation COMPLETES instead of
    // throwing E_OPERATE_STATE_INVALID out of the gap-persistence path.
    const result = await runOperatingCycle({
      projectRoot,
      localRoot,
      adapter: boardAdapter({ stalledRole, fabricatedRole, mixedRole }),
      confirmed: true,
      now: new Date('2026-08-03T13:00:00.000Z'),
      advisorLifecycle: lifecycleHooks,
    });

    const chairBoard = result.chairBoard;
    expect(chairBoard).toBeDefined();
    const outcomeByRole = new Map(
      (chairBoard?.contributions ?? []).map((entry) => [entry.roleId, entry]),
    );

    // DoD 2 — the fully citation-rejected role classifies `citation-rejected`,
    // DISTINCT from the stalled role's `not-evaluated` and the valid role's
    // `recorded-evaluated`. citation-rejected means "produced findings that failed
    // verification"; not-evaluated means "produced nothing groundable".
    const fabricated = outcomeByRole.get(fabricatedRole);
    const stalled = outcomeByRole.get(stalledRole);
    const recorded = outcomeByRole.get(recordedRole);
    expect(fabricated?.outcome).toBe('citation-rejected');
    expect(stalled?.outcome).toBe('not-evaluated');
    expect(recorded?.outcome).toBe('recorded-evaluated');
    expect(fabricated?.outcome).not.toBe(stalled?.outcome);
    // The citation-rejected reason names the verification failure, not a silence.
    expect(fabricated?.reason ?? '').not.toHaveLength(0);
    expect(fabricated?.reason ?? '').not.toBe(stalled?.reason ?? '');

    // DoD 2 (rendered board) — the shared per-role summary shows the difference.
    const renderedByRole = new Map(
      (chairBoard?.contributions ?? []).map((entry) => [entry.roleId, entry.outcome]),
    );
    expect(renderedByRole.get(fabricatedRole)).toBe('citation-rejected');
    expect(renderedByRole.get(stalledRole)).toBe('not-evaluated');
    // The Chair sees each absent perspective as a NAMED gap it must not synthesize.
    const fabricatedGapLine = (chairBoard?.gaps ?? []).find((line) =>
      line.includes(fabricatedRole),
    );
    expect(fabricatedGapLine).toBeDefined();
    expect(fabricatedGapLine).toMatch(/do not\s+synthesize/i);

    // DoD 3 — the other contribution states are present and distinct: a genuine
    // recorded-evaluated lens and the recorded Chair, and no citation-rejected
    // proposal item leaks into the grounded evidence.
    const recordedRoleIds = (result.roleResults ?? []).map((role) => role.roleId);
    expect(recordedRoleIds).toContain('chair');
    expect(recordedRoleIds).toContain(recordedRole);
    const groundedItemIds = (chairBoard?.evidence.items ?? []).map((item) => item.id);
    expect(
      groundedItemIds.some(
        (id) => id.includes(`advisor-results-${fabricatedRole}-`) && id.endsWith('fabricated'),
      ),
    ).toBe(false);
    expect(groundedItemIds.some((id) => id.includes(`advisor-results-${recordedRole}`))).toBe(true);

    // DoD 4 (FR8) — the mixed lens keeps its ONE valid proposal grounded while its
    // fabricated sibling is excluded; the lens is recorded-evaluated, not dropped.
    const mixed = outcomeByRole.get(mixedRole);
    expect(mixed?.outcome).toBe('recorded-evaluated');
    expect(mixed?.groundedProposalKeys).toContain(`${mixedRole}-valid`);
    expect(mixed?.groundedProposalKeys).not.toContain(`${mixedRole}-fabricated`);
    expect(
      groundedItemIds.some(
        (id) => id.includes(`advisor-results-${mixedRole}`) && id.endsWith('valid'),
      ),
    ).toBe(true);
    expect(groundedItemIds.some((id) => id.endsWith(`${mixedRole}-fabricated`))).toBe(false);

    // DoD 1 (durable) — the governed citation gap(s) are persisted and readable
    // back from the real event store, naming the fabricated role.
    const state = await new OperatingEventStore(projectRoot, { localRoot }).state();
    const persistedGaps = state.dataGaps.filter(
      (gap) => Array.isArray(gap.affectedRoles) && gap.affectedRoles.includes(fabricatedRole),
    );
    expect(persistedGaps.length).toBeGreaterThanOrEqual(1);
    // Each persisted gap is a schema-legal v1.2 record (canonical `GAP-NNN` id, no
    // v1.3-only category) — the projection that let it persist through the append
    // log at all, instead of throwing `E_OPERATE_STATE_INVALID`.
    for (const gap of persistedGaps) {
      expect(String(gap.id ?? '')).toMatch(/^GAP-[0-9]{3,}$/);
      expect((gap as Record<string, unknown>).category).toBeUndefined();
    }
    // The citation cause survives into committed state (so the not_evaluated cause
    // is distinguishable on replay), carried in the gaps' reason/question text.
    const persistedText = persistedGaps
      .map((gap) => `${gap.reason ?? ''} ${(gap as { question?: unknown }).question ?? ''}`)
      .join(' ')
      .toLowerCase();
    expect(persistedText).toMatch(/citation|fabricated/);
    // The empty-grounding gap that FR5 requires — a role is never not_evaluated
    // without a governed event recording the reason — is durable, naming the role.
    expect(
      persistedGaps.some((gap) => /grounded no evidence/i.test(String(gap.reason ?? ''))),
    ).toBe(true);
  }, 60_000);
});
