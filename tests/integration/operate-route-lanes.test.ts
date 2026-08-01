import { execFile } from 'node:child_process';
import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdvisorAdapter } from '../../src/services/operate/advisors.js';
import { canonicalize } from '../../src/services/operate/canonical.js';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
  validateOperatingConfiguration,
} from '../../src/services/operate/config.js';
import { runOperatingCycle } from '../../src/services/operate/engine.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { governOperatingFinding } from '../../src/services/operate/lifecycle.js';
import { recordOperatingOutcomeObservation } from '../../src/services/operate/outcomes.js';
import {
  applyOperatingRoute,
  createOperatingRoutePlan,
  readOperatingRoute,
  rollbackOperatingRoute,
} from '../../src/services/operate/routes.js';
import type { OperatingFinding, OperatingRoutePlan } from '../../src/services/operate/types.js';
import {
  refreshOperatingWorkspaceManifest,
  resolveOperatingPaths,
} from '../../src/services/operate/workspace.js';
import { OPENPLANR_VERSION } from '../../src/utils/package-version.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function initialize(): Promise<{ projectRoot: string; localRoot: string }> {
  const projectRoot = await temporaryDirectory('openplanr-operate-routes-project-');
  const localRoot = await temporaryDirectory('openplanr-operate-routes-local-');
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], {
    cwd: projectRoot,
  });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await writeFile(
    join(projectRoot, 'service.ts'),
    'export function health(): string { return "ok"; }\n',
  );
  await execFileAsync('git', ['add', 'service.ts'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], {
    cwd: projectRoot,
  });
  const preview = await prepareOperatingInitialization({
    projectRoot,
    localRoot,
    profile: 'custom',
    decisionOwner: 'Product owner',
    planningEngine: 'openplanr',
    runtime: 'codex',
    timezone: 'UTC',
    sensitivityCeiling: 'internal',
    enabledProviders: ['repository', 'git'],
    customProfile: {
      enabledRoles: ['strategy-finance', 'technology-risk', 'chair'],
      enabledProviders: ['repository', 'git'],
      caps: {
        surfacedFindings: 10,
        newSpecs: 3,
        openDecisions: 3,
        agentArtifacts: 2,
      },
      budgets: {
        maxFiles: 1_000,
        maxItems: 2_000,
        maxBytes: 10 * 1024 * 1024,
        maxDurationMs: 60_000,
      },
    },
    charter: {
      purpose: 'Exercise every governed operating route.',
      goals: ['Keep routing deterministic and bounded.'],
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

function routeAdapter(): AdvisorAdapter {
  return {
    id: 'route-fixture',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    capability: 'analysis-high',
    async invoke(input) {
      const evidenceRef = input.evidence.items[0]?.id;
      if (!evidenceRef) {
        return { outcome: 'quiet', proposals: [], gaps: [], conflicts: [] };
      }
      if (input.roleId === 'technology-risk') {
        return { outcome: 'quiet', proposals: [], gaps: [], conflicts: [] };
      }
      if (input.roleId === 'chair') {
        return {
          outcome: 'proposals',
          proposals: [
            {
              proposalKey: 'agent-route',
              type: 'merge',
              title: 'Prepare a health evidence brief',
              problem: 'Reviewers need a concise local synthesis of the evidence.',
              proposal: 'Generate a reviewable markdown brief without external publication.',
              impact: 2,
              confidence: 3,
              ease: 5,
              severity: 'low',
              evidenceRefs: [evidenceRef],
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
            proposalKey: 'dev-route',
            type: 'finding',
            title: 'Harden service health reporting',
            problem: 'Health behavior is not represented by a reviewed specification.',
            proposal: 'Create a bounded specification with a measurable completion outcome.',
            impact: 3,
            confidence: 3,
            ease: 4,
            severity: 'medium',
            evidenceRefs: [evidenceRef],
          },
          {
            proposalKey: 'owner-route',
            type: 'decision',
            title: 'Choose the health-reporting owner',
            problem: 'The accountable decision owner is not recorded.',
            proposal: 'Record Product owner as the accountable owner.',
            impact: 2,
            confidence: 3,
            ease: 5,
            severity: 'low',
            evidenceRefs: [evidenceRef],
          },
        ],
        gaps: [],
        conflicts: [],
      };
    },
  };
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

describe('committed Operating Board route lanes', () => {
  it('applies DEV, OWNER, and AGENT routes through canonical writes and events', async () => {
    const { projectRoot, localRoot } = await initialize();
    await expect(
      access(resolveOperatingPaths(projectRoot, { localRoot }).roots),
    ).resolves.toBeUndefined();
    const cycle = await runOperatingCycle({
      projectRoot,
      localRoot,
      adapter: routeAdapter(),
      confirmed: true,
      now: new Date('2026-07-28T13:00:00.000Z'),
    });
    expect(cycle.cycle.producer.version).toBe(OPENPLANR_VERSION);
    const config = await validateOperatingConfiguration(projectRoot);
    const routes = cycle.routes ?? [];
    expect(
      routes.map((route) => route.actions[0]?.lane).sort(),
      JSON.stringify({ warnings: cycle.warnings, readiness: cycle.readiness }, null, 2),
    ).toEqual(['AGENT', 'DEV', 'OWNER']);

    for (const proposed of routes) {
      const findingId = proposed.actions[0]?.findingId as string;
      const governed = (await governOperatingFinding({
        projectRoot,
        localRoot,
        findingId,
        action: 'accept',
        confirmed: true,
        reason: 'Fixture acceptance after reviewing the exact route preview.',
      })) as { routeId: string; routePreviewDigest: string };
      const route = await readOperatingRoute(projectRoot, governed.routeId);
      if (route.actions[0]?.lane === 'DEV') {
        await expect(
          applyOperatingRoute({
            projectRoot,
            localRoot,
            route,
            config,
            confirmationDigest: governed.routePreviewDigest,
            faultInjector(boundary) {
              if (boundary === 'bytes-committed') {
                throw new Error('simulated process interruption');
              }
            },
          }),
        ).rejects.toThrow('simulated process interruption');
        expect(
          (await new OperatingEventStore(projectRoot, { localRoot }).state()).routes.find(
            (candidate) => candidate.id === route.id,
          )?.state,
        ).toBe('prepared');
      }
      if (route.actions[0]?.lane === 'DEV') {
        const awaiting = await applyOperatingRoute({
          projectRoot,
          localRoot,
          route,
          config,
          confirmationDigest: governed.routePreviewDigest,
        });
        expect(awaiting).toMatchObject({
          state: 'awaiting-plan',
          invocation: expect.stringContaining('planr spec decompose'),
          shipInvoked: false,
        });
        const specDirectory = dirname(join(projectRoot, route.actions[0].targetPath as string));
        await mkdir(join(specDirectory, 'stories'), { recursive: true });
        await mkdir(join(specDirectory, 'tasks'), { recursive: true });
        await writeFile(
          join(specDirectory, 'stories', 'US-001-health.md'),
          '---\nid: "US-001"\nspecId: "SPEC-001"\ntitle: "Health"\nstatus: "ready"\n---\n',
        );
        await writeFile(
          join(specDirectory, 'tasks', 'T-001-health.md'),
          '---\nid: "T-001"\nspecId: "SPEC-001"\nstoryId: "US-001"\ntitle: "Health"\nstatus: "pending"\n---\n',
        );
        await appendFile(
          join(projectRoot, '.planr', 'provenance.jsonl'),
          `${JSON.stringify({
            schema_version: '1.0.0',
            event_id: 'openplanr-route-test',
            timestamp: '2026-07-28T13:30:00.000Z',
            artifact_id: 'SPEC-001',
            artifact_path: route.actions[0].targetPath,
            operation: 'decomposed',
            producer: {
              product: 'openplanr',
              version: '1.14.0',
              runtime: 'codex',
              phase: 'planning',
            },
            run_id: 'openplanr-route-test',
          })}\n`,
        );
        const applied = await applyOperatingRoute({
          projectRoot,
          localRoot,
          route,
          config,
          confirmationDigest: governed.routePreviewDigest,
        });
        expect(applied).toMatchObject({ state: 'applied', shipInvoked: false });
        await expect(access(join(specDirectory, '.pipeline-shipped'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      } else {
        const applied = await applyOperatingRoute({
          projectRoot,
          localRoot,
          route,
          config,
          confirmationDigest: governed.routePreviewDigest,
        });
        if (applied.state === 'awaiting-artifact-review') {
          await applyOperatingRoute({
            projectRoot,
            localRoot,
            route,
            config,
            confirmationDigest: applied.previewDigest as string,
          });
        }
      }
    }

    const state = await new OperatingEventStore(projectRoot, { localRoot }).state();
    expect(state.routes).toHaveLength(3);
    expect(state.routes.every((route) => route.state === 'applied')).toBe(true);
    expect(state.outcomes).toHaveLength(1);

    const dev = routes.find((route) => route.actions[0]?.lane === 'DEV');
    const owner = routes.find((route) => route.actions[0]?.lane === 'OWNER');
    const agent = routes.find((route) => route.actions[0]?.lane === 'AGENT');
    expect(
      await readFile(join(projectRoot, dev?.actions[0]?.targetPath as string), 'utf8'),
    ).toContain('PLAN artifacts receive human review before any SHIP invocation.');
    expect(
      JSON.parse(
        await readFile(join(projectRoot, owner?.actions[0]?.targetPath as string), 'utf8'),
      ),
    ).toMatchObject({ status: 'open', owner: 'Product owner' });
    expect(
      await readFile(join(projectRoot, agent?.actions[0]?.targetPath as string), 'utf8'),
    ).toContain('## Completion gate');

    const replay = await new OperatingEventStore(projectRoot, { localRoot }).replay();
    expect(replay.events.filter((event) => event.type === 'route.applied')).toHaveLength(3);
    expect(replay.events.filter((event) => event.type === 'spec.linked')).toHaveLength(1);
    expect(replay.events.filter((event) => event.type === 'outcome.registered')).toHaveLength(1);
    expect(replay.events.filter((event) => event.type === 'artifact.created')).toHaveLength(1);
    expect(
      replay.events.some(
        (event) =>
          event.type === 'artifact.created' &&
          Object.keys(event.payload).join(',') === 'recordDigest',
      ),
    ).toBe(true);

    const outcome = JSON.parse(
      await readFile(join(projectRoot, '.planr/operate/outcomes/OUT-001.json'), 'utf8'),
    );
    const observation = {
      kind: 'operating-outcome-observation' as const,
      schemaVersion: '1.0.0' as const,
      protocolVersion: '1.2.0' as const,
      id: 'OBS-001',
      outcomeId: outcome.id,
      observedAt: `${outcome.verifyAfter}T00:00:00.000Z`,
      window: outcome.targetWindow,
      value: 1,
      unit: outcome.unit,
      queryIdentity: outcome.queryIdentity,
      aggregation: outcome.aggregation,
      sampleSize: 1,
      coverage: 1,
      freshness: 'fresh' as const,
      guardrails: [],
      evaluation: 'positive' as const,
      evidenceRefs: ['EVD-outcome-fixture'],
    };
    const observed = await recordOperatingOutcomeObservation({
      projectRoot,
      localRoot,
      observation,
    });
    expect(observed.applied).toBe(true);
    expect(observed.state.outcomes[0]).toMatchObject({
      id: 'OUT-001',
      status: 'positive',
      lastObservationId: 'OBS-001',
    });
    expect(observed.state.learnings).toContainEqual(
      expect.objectContaining({ id: 'LRN-OBS-001', outcomeId: 'OUT-001' }),
    );
    expect(
      (
        await recordOperatingOutcomeObservation({
          projectRoot,
          localRoot,
          observation,
        })
      ).applied,
    ).toBe(false);
  });

  it('rejects an accepted route when the control-repository revision moves', async () => {
    const { projectRoot, localRoot } = await initialize();
    const cycle = await runOperatingCycle({
      projectRoot,
      localRoot,
      adapter: routeAdapter(),
      confirmed: true,
      now: new Date('2026-07-28T14:00:00.000Z'),
    });
    const route = cycle.routes?.find((candidate) => candidate.actions[0]?.lane === 'DEV');
    expect(route).toBeDefined();
    const findingId = route?.actions[0]?.findingId as string;
    const governed = (await governOperatingFinding({
      projectRoot,
      localRoot,
      findingId,
      action: 'accept',
      confirmed: true,
      reason: 'Accept before simulating a Git handoff.',
    })) as { routeId: string; routePreviewDigest: string };
    const acceptedRoute = await readOperatingRoute(projectRoot, governed.routeId);

    await writeFile(
      join(projectRoot, 'service.ts'),
      'export function health(): string { return "changed after preview"; }\n',
    );
    await execFileAsync('git', ['add', 'service.ts'], { cwd: projectRoot });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'move workspace head'], {
      cwd: projectRoot,
    });

    await expect(
      applyOperatingRoute({
        projectRoot,
        localRoot,
        route: acceptedRoute,
        config: await validateOperatingConfiguration(projectRoot),
        confirmationDigest: governed.routePreviewDigest,
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_HEAD_DIVERGED' });
    await expect(
      access(join(projectRoot, acceptedRoute.actions[0]?.targetPath as string)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

/**
 * Two distinct DEV findings that share the `finding` category (no token overlap,
 * so consolidation keeps them separate) — the raw material for a 2+-member epic
 * group. Every other role stays quiet.
 */
function twoRelatedDevFindingsAdapter(): AdvisorAdapter {
  return {
    id: 'epic-group-fixture',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    capability: 'analysis-high',
    async invoke(input) {
      const evidenceRef = input.evidence.items[0]?.id;
      if (!evidenceRef || input.roleId === 'technology-risk' || input.roleId === 'chair') {
        return { outcome: 'quiet', proposals: [], gaps: [], conflicts: [] };
      }
      return {
        outcome: 'proposals',
        proposals: [
          {
            proposalKey: 'pooling',
            type: 'finding',
            title: 'Improve database connection pooling under load',
            problem: 'The connection pool exhausts during peak traffic bursts.',
            proposal: 'Introduce a bounded reusable pool with backpressure signalling.',
            impact: 3,
            confidence: 3,
            ease: 4,
            severity: 'medium',
            evidenceRefs: [evidenceRef],
          },
          {
            proposalKey: 'fragments',
            type: 'finding',
            title: 'Cache rendered dashboard fragments',
            problem: 'Dashboard fragments recompute on every request, wasting cycles.',
            proposal: 'Add a short-lived fragment cache keyed by its render inputs.',
            impact: 3,
            confidence: 3,
            ease: 4,
            severity: 'medium',
            evidenceRefs: [evidenceRef],
          },
        ],
        gaps: [],
        conflicts: [],
      };
    },
  };
}

/**
 * Commit a proposed→accepted route straight into the event log, exactly the way
 * the engine (`route.proposed`) and governance (`route.accepted`) do, so an
 * engine-independent `create-epic` route can be applied through the real
 * `applyOperatingRoute` handler. The confirmation digest is the accepted preview
 * digest, mirroring `governOperatingFinding`.
 */
async function commitAcceptedRoute(
  projectRoot: string,
  localRoot: string,
  route: OperatingRoutePlan,
): Promise<void> {
  const store = new OperatingEventStore(projectRoot, { localRoot });
  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  await mkdir(paths.routes, { recursive: true });
  await writeFile(join(paths.routes, `${route.id}.json`), `${canonicalize(route)}\n`);
  await store.putRecord('route', route as unknown as Record<string, unknown>, {
    correlationId: route.cycleId,
    createdAt: route.createdAt,
  });
  const evidenceRefs = route.actions.flatMap((action) => action.evidenceRefs);
  const v13 = route.protocolVersion === '1.3.0';
  let head = (await store.replay()).eventHead;
  const proposed = await store.append({
    type: 'route.proposed',
    cycleId: route.cycleId,
    entityId: route.id,
    evidenceRefs,
    payload: { record: route },
    expectedHead: head.hash,
    ...(v13 ? { protocolVersion: '1.3.0' } : {}),
  });
  head = { sequence: proposed.sequence, hash: proposed.eventHash };
  await store.append({
    type: 'route.accepted',
    cycleId: route.cycleId,
    entityId: route.id,
    evidenceRefs,
    payload: { routeDigest: route.routeDigest, confirmationDigest: route.previewDigest },
    expectedHead: head.hash,
  });
}

describe('committed Operating Board create-epic route (FR8 / US-006)', () => {
  it('elects, applies, and byte-exact rolls back a grouped-finding epic without ever invoking PLAN or SHIP', async () => {
    const { projectRoot, localRoot } = await initialize();
    const config = await validateOperatingConfiguration(projectRoot);
    const cycle = await runOperatingCycle({
      projectRoot,
      localRoot,
      adapter: twoRelatedDevFindingsAdapter(),
      confirmed: true,
      now: new Date('2026-07-28T13:00:00.000Z'),
    });

    // Two DEV findings sharing the `finding` category surface from the cycle.
    const surfaced = (cycle.state?.findings ?? []).filter(
      (finding) => finding.lane === 'DEV' && finding.category === 'finding',
    );
    expect(
      surfaced.length,
      JSON.stringify({ warnings: cycle.warnings, readiness: cycle.readiness }, null, 2),
    ).toBeGreaterThanOrEqual(2);

    // Accept both findings (accept ≠ apply). Governance also accepts each
    // finding's engine-proposed create-spec route, which we never apply.
    for (const finding of surfaced) {
      await governOperatingFinding({
        projectRoot,
        localRoot,
        findingId: finding.id,
        action: 'accept',
        confirmed: true,
        reason: 'Fixture acceptance of a related finding for epic grouping.',
      });
    }

    const store = new OperatingEventStore(projectRoot, { localRoot });
    const acceptedFindings = (await store.state()).findings
      .filter((finding) => finding.status === 'accepted' && finding.category === 'finding')
      .sort((left, right) => left.id.localeCompare(right.id));
    expect(acceptedFindings.length).toBeGreaterThanOrEqual(2);
    const anchor = acceptedFindings[0] as unknown as OperatingFinding;
    const memberIds = acceptedFindings.map((finding) => finding.id);

    // The anchor of a 2+-member accepted-finding group elects `create-epic`, and
    // the returned plan validates against the published v1.3 route-plan schema.
    const eventHead = (await store.replay()).eventHead;
    const workspace = await refreshOperatingWorkspaceManifest(projectRoot, { localRoot });
    const fixedDigest = `sha256:${'a'.repeat(64)}` as const;
    const epicRoute = await createOperatingRoutePlan({
      projectRoot,
      cycleId: cycle.cycle.id,
      finding: anchor,
      config,
      workspace,
      eventHead,
      evidenceDigest: fixedDigest,
      providerDigest: fixedDigest,
      sequence: 900,
      epicId: 'EPIC-001',
      localRoot,
      now: '2026-07-28T13:00:00.000Z',
    });
    expect(epicRoute.actions[0]?.kind).toBe('create-epic');
    expect(epicRoute.protocolVersion).toBe('1.3.0');
    expect(epicRoute.actions[0]?.findingId).toBe(anchor.id);
    expect(epicRoute.actions[0]?.targetPath).toMatch(/^\.planr\/epics\/EPIC-001-.+\.md$/);
    // R1: the epic target is a planning artifact, never a ship/plan marker.
    expect(epicRoute.actions[0]?.targetPath).not.toMatch(/\.pipeline-shipped|\bship\b|\bplan\b/);

    // Commit + accept the epic route, then apply it against the exact preview.
    await commitAcceptedRoute(projectRoot, localRoot, epicRoute);
    const acceptedRoute = await readOperatingRoute(projectRoot, epicRoute.id);
    const epicTarget = join(projectRoot, epicRoute.actions[0]?.targetPath as string);
    expect(
      await access(epicTarget).then(
        () => true,
        () => false,
      ),
    ).toBe(false);

    const applied = await applyOperatingRoute({
      projectRoot,
      localRoot,
      route: acceptedRoute,
      config,
      confirmationDigest: epicRoute.previewDigest,
    });
    expect(applied).toMatchObject({ state: 'applied', shipInvoked: false });
    expect(applied.transactionId).toBeDefined();

    // The epic markdown lists every member finding id and its evidence refs.
    const epicBody = await readFile(epicTarget, 'utf8');
    for (const memberId of memberIds) {
      expect(epicBody).toContain(memberId);
    }
    expect(epicBody).toContain(anchor.evidenceRefs[0]);
    expect(epicBody).toContain(`# EPIC-001:`);
    // R1: the generated epic never emits a ship marker or PLAN/SHIP invocation.
    expect(epicBody).not.toMatch(/\.pipeline-shipped/);
    expect(epicBody).toContain('PLAN and SHIP are never invoked automatically');

    // R1 (event log): applying the epic route never chains into PLAN or SHIP —
    // no ship observation, no spec.linked/outcome/handoff, no awaiting-plan.
    const afterApply = await store.replay();
    expect(afterApply.events.some((event) => event.type === 'ship.observed')).toBe(false);
    expect(afterApply.events.some((event) => event.type === 'spec.linked')).toBe(false);
    expect(afterApply.events.some((event) => event.type === 'outcome.registered')).toBe(false);
    expect(applied.state).not.toBe('awaiting-plan');
    expect((applied as { invocation?: string }).invocation).toBeUndefined();

    // Byte-exact rollback: the epic file is removed and the prior (absent) tree
    // is restored exactly, and the route projection reflects the rollback.
    await rollbackOperatingRoute({
      projectRoot,
      localRoot,
      route: acceptedRoute,
      transactionId: applied.transactionId as string,
      recoveryId: 'RCV-epic-rollback',
    });
    await expect(access(epicTarget)).rejects.toMatchObject({ code: 'ENOENT' });
    const rolledBack = await store.state();
    expect(rolledBack.routes.find((route) => route.id === epicRoute.id)?.state).toBe('rolled_back');
  });
});
