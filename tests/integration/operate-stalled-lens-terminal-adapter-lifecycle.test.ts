import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
} from '../../src/services/operate/config.js';
import { runOperatingCycle } from '../../src/services/operate/engine.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import {
  operateAdapterLifecycle,
  reapStalledOperatingRoles,
} from '../../src/services/operate/maintenance.js';
import { readOperatingReport } from '../../src/services/operate/reports.js';

/**
 * SPEC-005 T-020 — a genuinely stalled lens (dispatched but never returns) gets a
 * governed terminal `not_evaluated` path on the LIVE agent-native ADAPTER-LIFECYCLE
 * path, so it no longer strands the cycle at `phase: advisors` forever (the residual
 * FR13 gap the round-3 QA gate adjudicated).
 *
 * Two escapes, one governed core:
 *   1. the RUNTIME invokes `harness abandon --role <role> --reason ...` (lease-bound)
 *      when a lens exceeds its budget; and
 *   2. an OPERATOR reaches a reviewable cycle without the runtime at all, keyed on a
 *      LAPSED lease, via `reapStalledOperatingRoles` — proven by a test that never
 *      invokes the runtime-side `harness abandon`.
 *
 * Both drive the REAL native lifecycle (no in-process adapter, no stubbing) and both
 * assert Chair fabricates nothing for the terminated lens: zero grounded proposal
 * items, a named gap it must not synthesize around, recorded siblings intact, and a
 * durable governed gap readable back from the event store.
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

async function initialize(enabledRoles: string[]): Promise<{
  projectRoot: string;
  localRoot: string;
  pinnedRevision: string;
}> {
  const projectRoot = await temporaryDirectory('openplanr-t020-project-');
  const localRoot = await temporaryDirectory('openplanr-t020-local-');
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
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot });
  const pinnedRevision = stdout.trim();
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
      purpose: 'Exercise the governed terminal path for a stalled lens.',
      goals: ['Keep the board honest and unblocked when a lens never returns.'],
    },
    now: '2026-08-03T12:00:00.000Z',
  });
  await applyOperatingInitialization({
    projectRoot,
    localRoot,
    preview,
    confirmationDigest: preview.previewDigest,
  });
  return { projectRoot, localRoot, pinnedRevision };
}

function repositoryCitation(path: string, revision: string): Record<string, unknown> {
  return { kind: 'repository', path, startLine: 1, endLine: 1, revision };
}

function actionsResponse(
  actionKey: string,
  citationPath: string,
  revision: string,
): Record<string, unknown> {
  return {
    outcome: 'actions',
    analysisMarkdown: `# Lens analysis\n\nProposing a bounded specification for ${actionKey}.`,
    claims: [],
    actions: [
      {
        actionKey,
        title: 'Harden the health surface',
        summary: 'Create a bounded specification with a measurable completion outcome.',
        lane: 'DEV',
        routeKind: 'quick-task',
        horizon: 'immediate',
        confidence: 3,
        impact: 3,
        ease: 4,
        citations: [repositoryCitation(citationPath, revision)],
      },
    ],
    gaps: [],
    conflicts: [],
  };
}

function quietResponse(): Record<string, unknown> {
  return {
    outcome: 'quiet',
    analysisMarkdown: '# Lens analysis\n\nNo citation-qualified action was identified.',
    claims: [],
    actions: [],
    gaps: [],
    conflicts: [],
  };
}

type Fixture = { projectRoot: string; localRoot: string };
type NativeHandoff = { phase: string; cycleId: string; evidenceDigest: string; roles: string[] };

async function nativeCycle(
  fixture: Fixture,
  when: string,
): Promise<{
  nativeHandoff?: NativeHandoff;
  result: Awaited<ReturnType<typeof runOperatingCycle>>;
}> {
  const result = await runOperatingCycle({
    projectRoot: fixture.projectRoot,
    localRoot: fixture.localRoot,
    deferAdvisors: true,
    confirmed: true,
    now: new Date(when),
  });
  return { nativeHandoff: result.nativeHandoff as NativeHandoff | undefined, result };
}

async function prepareAdvisors(
  fixture: Fixture,
  handoff: NativeHandoff,
): Promise<{ roles: string[]; lease: string }> {
  return (await operateAdapterLifecycle({
    ...fixture,
    action: 'prepare',
    cycleId: handoff.cycleId,
    evidenceDigest: handoff.evidenceDigest,
    idempotencyKey: `advisors-${handoff.cycleId}`,
  })) as { roles: string[]; lease: string };
}

async function recordRole(
  fixture: Fixture,
  handoff: NativeHandoff,
  lease: string,
  role: string,
  response: Record<string, unknown>,
): Promise<void> {
  await operateAdapterLifecycle({
    ...fixture,
    action: 'record',
    cycleId: handoff.cycleId,
    evidenceDigest: handoff.evidenceDigest,
    lease,
    idempotencyKey: `advisors-${handoff.cycleId}`,
    role,
    stdin: JSON.stringify(response),
  });
}

async function finalizeAdvisors(
  fixture: Fixture,
  handoff: NativeHandoff,
  lease: string,
): Promise<void> {
  await operateAdapterLifecycle({
    ...fixture,
    action: 'finalize',
    cycleId: handoff.cycleId,
    evidenceDigest: handoff.evidenceDigest,
    lease,
    idempotencyKey: `advisors-${handoff.cycleId}`,
  });
}

async function driveChairPhase(fixture: Fixture, handoff: NativeHandoff): Promise<void> {
  const prepared = (await operateAdapterLifecycle({
    ...fixture,
    action: 'prepare',
    cycleId: handoff.cycleId,
    evidenceDigest: handoff.evidenceDigest,
    idempotencyKey: `chair-${handoff.cycleId}`,
    role: 'chair',
  })) as { lease: string };
  await operateAdapterLifecycle({
    ...fixture,
    action: 'record',
    cycleId: handoff.cycleId,
    evidenceDigest: handoff.evidenceDigest,
    lease: prepared.lease,
    idempotencyKey: `chair-${handoff.cycleId}`,
    role: 'chair',
    stdin: JSON.stringify(quietResponse()),
  });
  await operateAdapterLifecycle({
    ...fixture,
    action: 'finalize',
    cycleId: handoff.cycleId,
    evidenceDigest: handoff.evidenceDigest,
    lease: prepared.lease,
    idempotencyKey: `chair-${handoff.cycleId}`,
  });
}

async function cycleState(fixture: Fixture, cycleId: string): Promise<string> {
  const state = await new OperatingEventStore(fixture.projectRoot, {
    localRoot: fixture.localRoot,
  }).state();
  return String(state.cycles.find((cycle) => cycle.id === cycleId)?.state ?? 'unknown');
}

const fabricatedUnused = 'strategy-finance';
const quietRole = 'product-activation';
const recordedRole = 'growth-market';
const stalledRole = 'technology-risk';

describe('T-020 — a governed terminal path for a stalled lens (adapter-lifecycle)', () => {
  it('DoD1: the runtime abandons a stalled lens, the cycle reaches Chair and reviewable, that lens not_evaluated', async () => {
    const fixture = await initialize([quietRole, recordedRole, stalledRole, 'chair']);

    const first = await nativeCycle(fixture, '2026-08-03T13:00:00.000Z');
    expect(first.nativeHandoff?.phase).toBe('advisors');
    const advisorHandoff = first.nativeHandoff as NativeHandoff;

    const prepared = await prepareAdvisors(fixture, advisorHandoff);
    expect(prepared.roles.sort()).toEqual([quietRole, recordedRole, stalledRole].sort());

    // Two siblings record real work; `technology-risk` is dispatched but STALLS —
    // the runtime never records it.
    await recordRole(fixture, advisorHandoff, prepared.lease, quietRole, quietResponse());
    await recordRole(
      fixture,
      advisorHandoff,
      prepared.lease,
      recordedRole,
      actionsResponse('gm-valid', 'service.ts', fixture.pinnedRevision),
    );

    // The runtime detects the stall (budget exceeded) and invokes the governed
    // terminal action with a reason. This is the RUNTIME-side mechanism.
    const abandonReason =
      'technology-risk exceeded its 90s budget after a heartbeat and never returned a result.';
    const abandoned = (await operateAdapterLifecycle({
      ...fixture,
      action: 'abandon',
      cycleId: advisorHandoff.cycleId,
      evidenceDigest: advisorHandoff.evidenceDigest,
      lease: prepared.lease,
      idempotencyKey: `advisors-${advisorHandoff.cycleId}`,
      role: stalledRole,
      reason: abandonReason,
    })) as { notEvaluated?: boolean; handoff: { state: string; roles: unknown[] } };
    expect(abandoned.notEvaluated).toBe(true);
    // The abandoned lens is a terminal, non-recorded role on the wire, carrying its
    // reason; with the last pending role gone the board is finalize-required.
    const abandonedRole = (
      abandoned.handoff.roles as Array<{ roleId: string; status: string; statusReason?: string }>
    ).find((role) => role.roleId === stalledRole);
    expect(abandonedRole?.status).toBe('not-evaluated');
    expect(abandonedRole?.statusReason).toBe(abandonReason);
    expect(abandoned.handoff.state).toBe('finalize-required');

    // Finalize now succeeds with the stalled lens terminal (T-001 all-terminal board).
    await finalizeAdvisors(fixture, advisorHandoff, prepared.lease);

    const second = await nativeCycle(fixture, '2026-08-03T13:05:00.000Z');
    expect(second.nativeHandoff?.phase).toBe('chair');
    await driveChairPhase(fixture, second.nativeHandoff as NativeHandoff);

    const third = await nativeCycle(fixture, '2026-08-03T13:10:00.000Z');
    const chairBoard = third.result.chairBoard;
    expect(chairBoard).toBeDefined();
    expect(await cycleState(fixture, advisorHandoff.cycleId)).toBe('reviewable');

    const byRole = new Map((chairBoard?.contributions ?? []).map((entry) => [entry.roleId, entry]));

    // DoD 1 — the stalled lens is terminal `not-evaluated` with a governed reason
    // and a governed gap id, distinct from the quiet lens and the evaluated lens.
    const stalled = byRole.get(stalledRole);
    expect(stalled?.outcome).toBe('not-evaluated');
    expect(stalled?.reason ?? '').toContain('budget');
    expect(stalled?.gapId ?? '').toMatch(/^GAP-/);
    expect(byRole.get(quietRole)?.outcome).toBe('recorded-quiet');
    expect(byRole.get(recordedRole)?.outcome).toBe('recorded-evaluated');
    expect(byRole.get(recordedRole)?.groundedProposalKeys).toContain('gm-valid');

    // DoD 5 — Chair fabricates nothing for the terminated lens: zero grounded
    // proposal items and a named gap it must not synthesize around.
    expect(stalled?.groundedProposalKeys ?? []).toHaveLength(0);
    const gapLine = (chairBoard?.gaps ?? []).find((line) => line.includes(stalledRole));
    expect(gapLine).toBeDefined();
    expect(gapLine).toMatch(/do not\s+synthesize/i);
    const groundedItemIds = (chairBoard?.evidence.items ?? []).map((item) => item.id);
    expect(groundedItemIds.some((id) => id.includes(stalledRole))).toBe(false);
    expect(groundedItemIds.some((id) => id.endsWith(`${recordedRole}-gm-valid`))).toBe(true);

    // The governed terminal gap is durable and readable back, naming the lens.
    const state = await new OperatingEventStore(fixture.projectRoot, {
      localRoot: fixture.localRoot,
    }).state();
    const stalledGaps = state.dataGaps.filter(
      (gap) => Array.isArray(gap.affectedRoles) && gap.affectedRoles.includes(stalledRole),
    );
    expect(stalledGaps.length).toBeGreaterThanOrEqual(1);
    expect(stalledGaps.map((gap) => gap.id)).toContain(stalled?.gapId ?? '');
    expect(String(stalledGaps[0]?.reason ?? '')).toContain('budget');

    // The recorded siblings are intact in committed state — the report renders both
    // real outcomes, and neither the quiet lens nor the evaluated lens carries a gap.
    const report = await readOperatingReport({
      projectRoot: fixture.projectRoot,
      localRoot: fixture.localRoot,
      cycleId: advisorHandoff.cycleId,
    });
    const reportByRole = new Map(report.reports.map((entry) => [entry.roleId, entry.outcome]));
    expect(reportByRole.get(recordedRole)).toBe('proposals');
    expect(reportByRole.get(quietRole)).toBe('quiet');
    expect(
      state.dataGaps.filter(
        (gap) => Array.isArray(gap.affectedRoles) && gap.affectedRoles.includes(quietRole),
      ),
    ).toHaveLength(0);
    // Non-vacuity anchor: strategy-finance was not even enabled this cycle, so its
    // absence proves the classifier keys on real committed state, not a fixture.
    expect(byRole.has(fabricatedUnused)).toBe(false);
  }, 120_000);

  it('DoD2: an operator reaches a reviewable cycle after a lapsed lease, without invoking the runtime-side mechanism', async () => {
    const fixture = await initialize([quietRole, recordedRole, stalledRole, 'chair']);

    const first = await nativeCycle(fixture, '2026-08-03T13:00:00.000Z');
    expect(first.nativeHandoff?.phase).toBe('advisors');
    const advisorHandoff = first.nativeHandoff as NativeHandoff;

    const prepared = await prepareAdvisors(fixture, advisorHandoff);
    // The runtime records two siblings, then REPORTS NOTHING AT ALL for the third:
    // no record, no finalize, and — critically for this proof — no `harness abandon`.
    await recordRole(fixture, advisorHandoff, prepared.lease, quietRole, quietResponse());
    await recordRole(
      fixture,
      advisorHandoff,
      prepared.lease,
      recordedRole,
      actionsResponse('gm-valid', 'service.ts', fixture.pinnedRevision),
    );

    // Before the lease lapses, the operator escape refuses — the runtime may still
    // be working. This is what keys the escape on a genuinely dead session. The
    // session's lease was just written against the real clock, so "now" is inside it.
    await expect(
      reapStalledOperatingRoles({
        ...fixture,
        cycleId: advisorHandoff.cycleId,
        reason: 'premature',
        confirmed: true,
        now: () => new Date(),
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_ADVISOR_ISOLATION' });

    // The lease lapses (well past the default window). The operator escapes WITHOUT
    // touching the runtime lifecycle: it never calls `operateAdapterLifecycle`.
    const lapsedClock = () => new Date(Date.now() + 60 * 60 * 1000);
    const escaped = await reapStalledOperatingRoles({
      ...fixture,
      cycleId: advisorHandoff.cycleId,
      reason: 'Operator abandoned technology-risk: the Codex session crashed and its lease lapsed.',
      confirmed: true,
      now: lapsedClock,
    });
    expect(escaped.reaped.map((entry) => entry.roleId)).toEqual([stalledRole]);
    expect(escaped.reaped[0]?.gapId).toMatch(/^GAP-/);
    expect(escaped.alreadyRecorded).toEqual([quietRole, recordedRole].sort());

    // The operator reaches a reviewable cycle with NO runtime at all — an offline
    // consolidation (deterministic quiet Chair). Never a `harness abandon`, never a
    // native Chair dispatch.
    const consolidated = await runOperatingCycle({
      ...fixture,
      offline: true,
      deferAdvisors: false,
      confirmed: true,
      quiet: true,
      now: new Date('2026-08-03T14:00:00.000Z'),
    });
    expect(await cycleState(fixture, advisorHandoff.cycleId)).toBe('reviewable');

    const chairBoard = consolidated.chairBoard;
    expect(chairBoard).toBeDefined();
    const byRole = new Map((chairBoard?.contributions ?? []).map((entry) => [entry.roleId, entry]));

    // DoD 2 — the stalled lens is terminal `not_evaluated` with the operator's
    // governed reason and a governed gap id; the recorded siblings are intact.
    const stalled = byRole.get(stalledRole);
    expect(stalled?.outcome).toBe('not-evaluated');
    expect(stalled?.reason ?? '').toMatch(/operator|lease|crashed/i);
    expect(stalled?.gapId ?? '').toMatch(/^GAP-/);
    expect(byRole.get(quietRole)?.outcome).toBe('recorded-quiet');
    expect(byRole.get(recordedRole)?.outcome).toBe('recorded-evaluated');
    expect(byRole.get(recordedRole)?.groundedProposalKeys).toContain('gm-valid');

    // DoD 5 — Chair fabricates nothing for the terminated lens.
    expect(stalled?.groundedProposalKeys ?? []).toHaveLength(0);
    const gapLine = (chairBoard?.gaps ?? []).find((line) => line.includes(stalledRole));
    expect(gapLine).toBeDefined();
    expect(gapLine).toMatch(/do not\s+synthesize/i);
    const groundedItemIds = (chairBoard?.evidence.items ?? []).map((item) => item.id);
    expect(groundedItemIds.some((id) => id.includes(stalledRole))).toBe(false);

    // The governed terminal gap is durable and readable back, carrying the reason.
    const state = await new OperatingEventStore(fixture.projectRoot, {
      localRoot: fixture.localRoot,
    }).state();
    const stalledGaps = state.dataGaps.filter(
      (gap) => Array.isArray(gap.affectedRoles) && gap.affectedRoles.includes(stalledRole),
    );
    expect(stalledGaps.length).toBeGreaterThanOrEqual(1);
    expect(stalledGaps.map((gap) => gap.id)).toContain(stalled?.gapId ?? '');
    expect(String(stalledGaps[0]?.reason ?? '').toLowerCase()).toMatch(/operator|lease|crashed/);

    // The recorded siblings survive the escape untouched in committed state.
    const report = await readOperatingReport({
      projectRoot: fixture.projectRoot,
      localRoot: fixture.localRoot,
      cycleId: advisorHandoff.cycleId,
    });
    const reportByRole = new Map(report.reports.map((entry) => [entry.roleId, entry.outcome]));
    expect(reportByRole.get(recordedRole)).toBe('proposals');
    expect(reportByRole.get(quietRole)).toBe('quiet');
  }, 120_000);
});
