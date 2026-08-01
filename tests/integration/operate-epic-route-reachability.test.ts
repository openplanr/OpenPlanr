import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdvisorAdapter } from '../../src/services/operate/advisors.js';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
  validateOperatingConfiguration,
} from '../../src/services/operate/config.js';
import { runOperatingCycle } from '../../src/services/operate/engine.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { governOperatingFinding } from '../../src/services/operate/lifecycle.js';
// NOTE: this suite deliberately does NOT import `createOperatingRoutePlan`. The
// FR8 reachability proof requires that a governed `create-epic` route becomes
// present, apply-ready, and appliable through the PUBLIC action surface
// (`governOperatingFinding` → `electAcceptedFindingEpicRoutes` → `applyOperatingRoute`),
// never by calling the route-plan builder as a library function the way the
// engine-independent T-006 coverage does.
import {
  applyOperatingRoute,
  electAcceptedFindingEpicRoutes,
  readOperatingRoute,
  rollbackOperatingRoute,
} from '../../src/services/operate/routes.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function initialize(): Promise<{ projectRoot: string; localRoot: string }> {
  const projectRoot = await temporaryDirectory('openplanr-operate-epic-reach-project-');
  const localRoot = await temporaryDirectory('openplanr-operate-epic-reach-local-');
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(
    join(projectRoot, 'service.ts'),
    'export function health(): string { return "ok"; }\n',
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
      enabledRoles: ['strategy-finance', 'technology-risk', 'chair'],
      caps: { surfacedFindings: 10, newSpecs: 5, openDecisions: 3, agentArtifacts: 2 },
    },
    charter: {
      purpose: 'Exercise operator-reachable epic-route election.',
      goals: ['Close the create-epic route through the public action surface.'],
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
 * Emit `count` DEV findings that all share the `finding` category (so
 * `groupRelatedAcceptedFindings` unions them into one epic theme) but carry
 * distinct semantic content (so consolidation keeps them as separate findings).
 */
function relatedDevFindingsAdapter(count: number): AdvisorAdapter {
  const proposals = [
    {
      proposalKey: 'pooling',
      title: 'Improve database connection pooling under load',
      problem: 'The connection pool exhausts during peak traffic bursts.',
      proposal: 'Introduce a bounded reusable pool with backpressure signalling.',
    },
    {
      proposalKey: 'fragments',
      title: 'Cache rendered dashboard fragments',
      problem: 'Dashboard fragments recompute on every request, wasting cycles.',
      proposal: 'Add a short-lived fragment cache keyed by its render inputs.',
    },
    {
      proposalKey: 'batching',
      title: 'Batch write-behind persistence flushes',
      problem: 'Each mutation flushes to disk independently, saturating I/O.',
      proposal: 'Coalesce flushes into bounded write-behind batches.',
    },
  ].slice(0, count);
  return {
    id: 'epic-reachability-fixture',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    capability: 'analysis-high',
    async invoke(input) {
      if (input.roleId === 'technology-risk' || input.roleId === 'chair') {
        return { outcome: 'quiet', proposals: [], gaps: [], conflicts: [] };
      }
      return {
        outcome: 'proposals',
        proposals: proposals.map((entry) => ({
          proposalKey: entry.proposalKey,
          type: 'finding',
          title: entry.title,
          problem: entry.problem,
          proposal: entry.proposal,
          impact: 3,
          confidence: 3,
          ease: 4,
          severity: 'medium',
          citations: [
            {
              repositoryPath: 'service.ts',
              lineRange: { start: 1, end: 1 },
              pinnedRevision: input.pinnedRevision,
            },
          ],
        })),
        gaps: [],
        conflicts: [],
      };
    },
  };
}

interface AcceptResult {
  routeId: string | null;
  epicRoutes: Array<{ id: string; previewDigest: string; targetPath: string | null }>;
}

async function surfacedFindingIds(projectRoot: string, localRoot: string): Promise<string[]> {
  const state = await new OperatingEventStore(projectRoot, { localRoot }).state();
  return state.findings
    .filter((finding) => finding.lane === 'DEV' && finding.category === 'finding')
    .map((finding) => finding.id)
    .sort((left, right) => left.localeCompare(right));
}

async function createEpicRouteIds(projectRoot: string, localRoot: string): Promise<string[]> {
  const state = await new OperatingEventStore(projectRoot, { localRoot }).state();
  const ids: string[] = [];
  for (const projected of state.routes) {
    const route = await readOperatingRoute(projectRoot, String(projected.id)).catch(() => null);
    if (route?.actions[0]?.kind === 'create-epic') ids.push(route.id);
  }
  return ids.sort();
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

describe('operator-reachable create-epic route election (FR8 / US-006 reachability)', () => {
  it('elects, previews, applies, and byte-exact rolls back an epic route through the public action surface — never PLAN/SHIP', async () => {
    const { projectRoot, localRoot } = await initialize();
    const config = await validateOperatingConfiguration(projectRoot);
    const cycle = await runOperatingCycle({
      projectRoot,
      localRoot,
      adapter: relatedDevFindingsAdapter(2),
      confirmed: true,
      now: new Date('2026-07-28T13:00:00.000Z'),
    });
    const memberIds = await surfacedFindingIds(projectRoot, localRoot);
    expect(
      memberIds.length,
      JSON.stringify({ warnings: cycle.warnings, readiness: cycle.readiness }, null, 2),
    ).toBe(2);

    // Accepting the first related finding does not yet form a 2+-member group,
    // so no epic route is elected.
    const first = (await governOperatingFinding({
      projectRoot,
      localRoot,
      findingId: memberIds[0],
      action: 'accept',
      confirmed: true,
      reason: 'Accept the first related finding via the public action surface.',
    })) as AcceptResult;
    expect(first.epicRoutes).toHaveLength(0);
    expect(await createEpicRouteIds(projectRoot, localRoot)).toHaveLength(0);

    // Accepting the second completes the theme: election proposes AND accepts one
    // governed create-epic route through the normal proposal path — no direct
    // createOperatingRoutePlan call anywhere in this test.
    const second = (await governOperatingFinding({
      projectRoot,
      localRoot,
      findingId: memberIds[1],
      action: 'accept',
      confirmed: true,
      reason: 'Accept the second related finding, closing the epic group.',
    })) as AcceptResult;
    expect(second.epicRoutes).toHaveLength(1);
    const electedId = second.epicRoutes[0].id;

    // Exactly one create-epic route now exists in the cycle's routes.
    expect(await createEpicRouteIds(projectRoot, localRoot)).toEqual([electedId]);

    const electedRoute = await readOperatingRoute(projectRoot, electedId);
    expect(electedRoute.actions[0]?.kind).toBe('create-epic');
    expect(electedRoute.protocolVersion).toBe('1.3.0');
    // The anchor is the lexicographically-first member; the full membership lives
    // in the generated epic markdown, not the single-anchor route action.
    expect(electedRoute.actions[0]?.findingId).toBe(memberIds[0]);
    expect(electedRoute.actions[0]?.targetPath).toMatch(/^\.planr\/epics\/EPIC-\d+-.+\.md$/);
    // Election is proposal-only (accept ≠ apply): the route is apply-ready but the
    // epic markdown does not exist until an explicit `routes apply`.
    const epicTarget = join(projectRoot, electedRoute.actions[0]?.targetPath as string);
    expect(
      await access(epicTarget).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    // R1: the elected target is a planning artifact, never a ship/plan marker.
    expect(electedRoute.actions[0]?.targetPath).not.toMatch(/\.pipeline-shipped|\bship\b|\bplan\b/);

    // Reachability: apply the ELECTED route (built only through the public
    // surface) against its own preview digest.
    const store = new OperatingEventStore(projectRoot, { localRoot });
    const applied = await applyOperatingRoute({
      projectRoot,
      localRoot,
      route: electedRoute,
      config,
      confirmationDigest: electedRoute.previewDigest,
    });
    expect(applied).toMatchObject({ state: 'applied', shipInvoked: false });
    expect(applied.transactionId).toBeDefined();

    const epicBody = await readFile(epicTarget, 'utf8');
    for (const memberId of memberIds) {
      expect(epicBody).toContain(memberId);
    }
    expect(epicBody).toContain('# EPIC-');
    // R1: the generated epic never emits a ship marker or PLAN/SHIP invocation.
    expect(epicBody).not.toMatch(/\.pipeline-shipped/);
    expect(epicBody).toContain('PLAN and SHIP are never invoked automatically');

    // R1 (event log): applying the epic route never chains into PLAN or SHIP.
    const afterApply = await store.replay();
    expect(afterApply.events.some((event) => event.type === 'ship.observed')).toBe(false);
    expect(afterApply.events.some((event) => event.type === 'spec.linked')).toBe(false);
    expect(afterApply.events.some((event) => event.type === 'outcome.registered')).toBe(false);
    expect(applied.state).not.toBe('awaiting-plan');
    expect((applied as { invocation?: string }).invocation).toBeUndefined();

    // Byte-exact rollback: the epic file is removed and the route is rolled back.
    await rollbackOperatingRoute({
      projectRoot,
      localRoot,
      route: electedRoute,
      transactionId: applied.transactionId as string,
      recoveryId: 'RCV-epic-reachability-rollback',
    });
    await expect(access(epicTarget)).rejects.toMatchObject({ code: 'ENOENT' });
    const rolledBack = await store.state();
    expect(rolledBack.routes.find((route) => route.id === electedId)?.state).toBe('rolled_back');
  });

  it('is idempotent: re-electing across further acceptances never duplicates the epic route', async () => {
    const { projectRoot, localRoot } = await initialize();
    await runOperatingCycle({
      projectRoot,
      localRoot,
      adapter: relatedDevFindingsAdapter(3),
      confirmed: true,
      now: new Date('2026-07-28T13:00:00.000Z'),
    });
    const memberIds = await surfacedFindingIds(projectRoot, localRoot);
    expect(memberIds).toHaveLength(3);

    const accept = async (findingId: string): Promise<AcceptResult> =>
      (await governOperatingFinding({
        projectRoot,
        localRoot,
        findingId,
        action: 'accept',
        confirmed: true,
        reason: 'Accept a related finding for idempotent epic election.',
      })) as AcceptResult;

    // First acceptance: no group yet.
    expect((await accept(memberIds[0])).epicRoutes).toHaveLength(0);
    // Second acceptance: the epic route is elected exactly once.
    const elected = await accept(memberIds[1]);
    expect(elected.epicRoutes).toHaveLength(1);
    const electedId = elected.epicRoutes[0].id;
    expect(await createEpicRouteIds(projectRoot, localRoot)).toEqual([electedId]);

    // Third acceptance grows the same theme but MUST NOT duplicate the route —
    // the anchor already heads a committed create-epic route.
    expect((await accept(memberIds[2])).epicRoutes).toHaveLength(0);
    expect(await createEpicRouteIds(projectRoot, localRoot)).toEqual([electedId]);

    // Re-running election directly is a no-op as well (belt-and-suspenders).
    const reElected = await electAcceptedFindingEpicRoutes({
      projectRoot,
      localRoot,
      cycleId: (await readOperatingRoute(projectRoot, electedId)).cycleId,
    });
    expect(reElected).toHaveLength(0);
    expect(await createEpicRouteIds(projectRoot, localRoot)).toEqual([electedId]);
  });
});
