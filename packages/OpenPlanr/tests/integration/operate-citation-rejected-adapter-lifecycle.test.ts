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
import { operateAdapterLifecycle } from '../../src/services/operate/maintenance.js';
import { readOperatingReport } from '../../src/services/operate/reports.js';

/**
 * SPEC-005 T-019 — the `citation-rejected` outcome, proven on the LIVE agent-native
 * ADAPTER-LIFECYCLE path (`operateAdapterLifecycle`: prepare → record → finalize →
 * continue → Chair), never the inline `runOperatingCycle` in-process adapter that
 * T-017 exercised.
 *
 * The QA re-audit live-reproduced the production defect here: a lens whose every
 * proposal cites a fabricated path records a schema-legal `quiet` result, but the
 * governed citation gaps were never persisted, so the Chair board — assembled by a
 * later `run` continuation, after the role is already recorded and never
 * re-dispatched — rendered the lens a FALSE-CLEAN `recorded-quiet` (reason `null`,
 * gapId `null`), indistinguishable from a lens that genuinely had nothing to say.
 *
 * This suite drives the REAL native lifecycle end to end (no in-process adapter, no
 * stubbing) and asserts the fix: the citation-rejected lens now classifies
 * `citation-rejected` with a non-null reason and a non-null governed gap id, the
 * gap is readable back from the event store, and quiet / not_evaluated /
 * citation-rejected remain three distinct states on this path.
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
  pinnedRevision: string;
}> {
  const projectRoot = await temporaryDirectory('openplanr-t019-project-');
  const localRoot = await temporaryDirectory('openplanr-t019-local-');
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
      purpose: 'Exercise the live citation-rejected outcome on the adapter-lifecycle path.',
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
  return { projectRoot, localRoot, pinnedRevision };
}

function repositoryCitation(path: string, revision: string): Record<string, unknown> {
  return { kind: 'repository', path, startLine: 1, endLine: 1, revision };
}

/** A v1.4 compact agent-native response proposing one action with a single citation. */
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
  chairBoard?: unknown;
  result: Awaited<ReturnType<typeof runOperatingCycle>>;
}> {
  const result = await runOperatingCycle({
    projectRoot: fixture.projectRoot,
    localRoot: fixture.localRoot,
    deferAdvisors: true,
    confirmed: true,
    now: new Date(when),
  });
  return {
    nativeHandoff: result.nativeHandoff as NativeHandoff | undefined,
    chairBoard: result.chairBoard,
    result,
  };
}

async function prepareAdvisors(
  fixture: Fixture,
  handoff: NativeHandoff,
  prepareRoles?: string[],
): Promise<{ roles: string[]; lease: string }> {
  return (await operateAdapterLifecycle({
    ...fixture,
    action: 'prepare',
    cycleId: handoff.cycleId,
    evidenceDigest: handoff.evidenceDigest,
    idempotencyKey: `advisors-${handoff.cycleId}`,
    ...(prepareRoles ? { role: prepareRoles.join(',') } : {}),
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

describe('T-019 — citation-rejected honest on the adapter-lifecycle path', () => {
  const fabricatedRole = 'strategy-finance';
  const quietRole = 'product-activation';
  const recordedRole = 'growth-market';
  const stalledRole = 'technology-risk';

  it('classifies a citation-rejected lens distinctly and keeps quiet/stalled/citation-rejected distinct (FR5/FR13)', async () => {
    const fixture = await initialize([
      fabricatedRole,
      quietRole,
      recordedRole,
      stalledRole,
      'chair',
    ]);

    // Reach the real native advisor handoff (deferAdvisors → the agent runs the fan-out).
    const first = await nativeCycle(fixture, '2026-08-03T13:00:00.000Z');
    expect(first.nativeHandoff?.phase).toBe('advisors');
    const advisorHandoff = first.nativeHandoff as NativeHandoff;

    // Prepare all four advisor lenses, then record three of them through the real
    // adapter lifecycle: the fabricated-path lens (every citation rejected), a
    // genuinely quiet lens, and a lens whose citation resolves. The fourth lens
    // (`technology-risk`) STALLS — the agent never records it.
    const prepared = await prepareAdvisors(fixture, advisorHandoff);
    expect(prepared.roles.sort()).toEqual(
      [fabricatedRole, quietRole, recordedRole, stalledRole].sort(),
    );
    await recordRole(
      fixture,
      advisorHandoff,
      prepared.lease,
      fabricatedRole,
      actionsResponse('sf-fabricated', 'phantom.ts', fixture.pinnedRevision),
    );
    await recordRole(fixture, advisorHandoff, prepared.lease, quietRole, quietResponse());
    await recordRole(
      fixture,
      advisorHandoff,
      prepared.lease,
      recordedRole,
      actionsResponse('gm-valid', 'service.ts', fixture.pinnedRevision),
    );

    // DoD 2 (not_evaluated distinct) — while the stalled lens is still unrecorded,
    // the honest live report renders it `not_evaluated`, DISTINCT from the recorded
    // quiet lens. On the adapter-lifecycle path a genuine stall cannot reach the
    // Chair board (consolidation blocks until every lens records), so `not_evaluated`
    // for a stalled lens is the report/status surface here — this is the pre-existing
    // FR5 honesty guard, preserved by this task, and it is what keeps `not_evaluated`
    // a distinct third state on this path rather than collapsing into quiet.
    const report = await readOperatingReport({
      projectRoot: fixture.projectRoot,
      localRoot: fixture.localRoot,
      cycleId: advisorHandoff.cycleId,
    });
    const reportByRole = new Map(report.reports.map((entry) => [entry.roleId, entry.outcome]));
    expect(reportByRole.get(stalledRole)).toBe('not_evaluated');
    expect(reportByRole.get(quietRole)).toBe('quiet');
    expect(reportByRole.get(stalledRole)).not.toBe(reportByRole.get(quietRole));

    // The stalled lens finally records (quiet) so the cycle can consolidate; the
    // citation-rejected classification below is isolated to `strategy-finance`.
    await recordRole(fixture, advisorHandoff, prepared.lease, stalledRole, quietResponse());
    await finalizeAdvisors(fixture, advisorHandoff, prepared.lease);

    // Reach the real native Chair handoff and drive Chair through the lifecycle.
    const second = await nativeCycle(fixture, '2026-08-03T13:05:00.000Z');
    expect(second.nativeHandoff?.phase).toBe('chair');
    await driveChairPhase(fixture, second.nativeHandoff as NativeHandoff);

    // The final continuation assembles the Chair board over committed state.
    const third = await nativeCycle(fixture, '2026-08-03T13:10:00.000Z');
    const chairBoard = third.result.chairBoard;
    expect(chairBoard).toBeDefined();
    const byRole = new Map((chairBoard?.contributions ?? []).map((entry) => [entry.roleId, entry]));

    // DoD 1 — the fully citation-rejected lens renders `citation-rejected` with a
    // non-null reason and a non-null governed gap id — never `recorded-quiet`, never
    // reason/gapId null. This is the exact false-clean surface the QA re-audit
    // live-reproduced, now honest on the production path.
    const fabricated = byRole.get(fabricatedRole);
    expect(fabricated?.outcome).toBe('citation-rejected');
    expect(fabricated?.reason ?? '').not.toHaveLength(0);
    expect(fabricated?.gapId ?? '').not.toHaveLength(0);
    expect(fabricated?.reason ?? '').toMatch(/phantom\.ts|citation|resolve|grounded/i);

    // DoD 2 (Chair board) — a genuinely quiet lens stays `recorded-quiet` and a lens
    // with a resolvable citation stays `recorded-evaluated`. `citation-rejected` is
    // distinct from BOTH: it positively records that findings were produced and
    // failed verification, not silence.
    expect(byRole.get(quietRole)?.outcome).toBe('recorded-quiet');
    expect(byRole.get(quietRole)?.reason).toBeNull();
    expect(byRole.get(recordedRole)?.outcome).toBe('recorded-evaluated');
    expect(byRole.get(recordedRole)?.groundedProposalKeys).toContain('gm-valid');
    expect(fabricated?.outcome).not.toBe(byRole.get(quietRole)?.outcome);
    expect(fabricated?.outcome).not.toBe(byRole.get(recordedRole)?.outcome);

    // The Chair is told to treat the citation-rejected perspective as an explicit
    // gap it must not synthesize around, not a clean lens.
    const gapLine = (chairBoard?.gaps ?? []).find((line) => line.includes(fabricatedRole));
    expect(gapLine).toBeDefined();
    expect(gapLine).toMatch(/do not\s+synthesize/i);

    // The citation-rejected PROPOSAL never leaks into the Chair's grounded evidence
    // (the lens still contributes an honest `-context` item carrying its
    // `citation-rejected` outcome — that is the record of the failure, not a leak of
    // the rejected proposal's content). The resolvable lens's proposal DOES ground.
    const groundedItemIds = (chairBoard?.evidence.items ?? []).map((item) => item.id);
    expect(groundedItemIds.some((id) => id.endsWith(`${fabricatedRole}-sf-fabricated`))).toBe(
      false,
    );
    expect(groundedItemIds.some((id) => id.endsWith(`${recordedRole}-gm-valid`))).toBe(true);

    // DoD 3 — the governed citation gap(s) are durable and readable back from the
    // real event store, each a schema-legal v1.2 record naming the rejected lens,
    // with the citation cause carried in its reason/question text.
    const state = await new OperatingEventStore(fixture.projectRoot, {
      localRoot: fixture.localRoot,
    }).state();
    const persistedGaps = state.dataGaps.filter(
      (gap) => Array.isArray(gap.affectedRoles) && gap.affectedRoles.includes(fabricatedRole),
    );
    expect(persistedGaps.length).toBeGreaterThanOrEqual(1);
    expect(persistedGaps.map((gap) => gap.id)).toContain(fabricated?.gapId ?? '');
    for (const gap of persistedGaps) {
      expect(String(gap.id ?? '')).toMatch(/^GAP-[0-9]{3,}$/);
      expect((gap as Record<string, unknown>).category).toBeUndefined();
    }
    const persistedText = persistedGaps
      .map((gap) => `${gap.reason ?? ''} ${(gap as { question?: unknown }).question ?? ''}`)
      .join(' ')
      .toLowerCase();
    expect(persistedText).toMatch(/citation|fabricated|phantom|grounded/);

    // A genuinely quiet lens produced NO governed gap — the difference between
    // `citation-rejected` and `recorded-quiet` is grounded in committed state, not
    // inferred: the quiet lens is not named by any cycle gap.
    const quietGaps = state.dataGaps.filter(
      (gap) => Array.isArray(gap.affectedRoles) && gap.affectedRoles.includes(quietRole),
    );
    expect(quietGaps).toHaveLength(0);
  }, 120_000);
});
