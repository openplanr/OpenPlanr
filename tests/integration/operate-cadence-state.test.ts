import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdvisorAdapter } from '../../src/services/operate/advisors.js';
import { assertOperatingCadenceCannotMutate } from '../../src/services/operate/cadence.js';
import type { CitationResolutionContext } from '../../src/services/operate/citation-resolution.js';
import {
  applyOperatingInitialization,
  prepareOperatingInitialization,
  readOperatingLastRunAt,
  recordOperatingLastRunAt,
} from '../../src/services/operate/config.js';
import {
  gateRecordedProposalCitations,
  runOperatingCycle,
} from '../../src/services/operate/engine.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { OperatingEvidenceCache } from '../../src/services/operate/evidence-cache.js';
import { executeOperateAction } from '../../src/services/operate/index.js';
import type {
  OperatingRoleResult,
  OperatingWorkspaceComponent,
} from '../../src/services/operate/types.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function gitProject(): Promise<string> {
  const projectRoot = await temporaryDirectory('openplanr-operate-cadence-project-');
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
  return projectRoot;
}

async function initialize(input: {
  cadence: 'manual' | 'weekly' | 'monthly';
}): Promise<{ projectRoot: string; localRoot: string }> {
  const projectRoot = await gitProject();
  const localRoot = await temporaryDirectory('openplanr-operate-cadence-local-');
  const preview = await prepareOperatingInitialization({
    projectRoot,
    localRoot,
    profile: 'custom',
    decisionOwner: 'Product owner',
    planningEngine: 'openplanr',
    runtime: 'codex',
    cadence: input.cadence,
    timezone: 'UTC',
    sensitivityCeiling: 'internal',
    customProfile: {
      enabledRoles: ['strategy-finance', 'technology-risk', 'chair'],
      caps: { surfacedFindings: 10, newSpecs: 3, openDecisions: 3, agentArtifacts: 2 },
    },
    charter: {
      purpose: 'Exercise cadence state and the never-acts guarantee.',
      goals: ['Keep cadence deterministic and read-only.'],
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
    id: 'cadence-fixture',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    capability: 'analysis-high',
    async invoke(input) {
      const citations = [
        {
          repositoryPath: 'service.ts',
          lineRange: { start: 1, end: 1 },
          pinnedRevision: input.pinnedRevision,
        },
      ];
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
            proposalKey: 'dev-route',
            type: 'finding',
            title: 'Harden service health reporting',
            problem: 'Health behavior is not represented by a reviewed specification.',
            proposal: 'Create a bounded specification with a measurable completion outcome.',
            impact: 3,
            confidence: 3,
            ease: 4,
            severity: 'medium',
            citations,
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
            citations,
          },
        ],
        gaps: [],
        conflicts: [],
      };
    },
  };
}

async function statusCadence(
  projectRoot: string,
  localRoot: string,
  now: string,
): Promise<{ mode: string; lastRunAt: string | null; nextDueAt: string | null }> {
  const result = await executeOperateAction({
    action: 'status',
    projectRoot,
    interactive: false,
    options: { json: true, localRoot, now },
  });
  expect(result.ok).toBe(true);
  return (
    result.data as { cadence: { mode: string; lastRunAt: string | null; nextDueAt: string | null } }
  ).cadence;
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

describe('operate cadence state (FR8 / E-008)', () => {
  it('surfaces the pipeline nextDueAt for a weekly cadence under an injected clock', async () => {
    const { projectRoot, localRoot } = await initialize({ cadence: 'weekly' });
    await recordOperatingLastRunAt({ projectRoot, localRoot, lastRunAt: '2026-07-28T09:00:00Z' });
    const cadence = await statusCadence(projectRoot, localRoot, '2026-07-30T00:00:00Z');
    expect(cadence).toEqual({
      mode: 'weekly',
      lastRunAt: '2026-07-28T09:00:00Z',
      nextDueAt: '2026-08-04T09:00:00Z',
    });
  });

  it('surfaces the pipeline nextDueAt for a monthly cadence, clamped to a shorter month', async () => {
    const { projectRoot, localRoot } = await initialize({ cadence: 'monthly' });
    await recordOperatingLastRunAt({ projectRoot, localRoot, lastRunAt: '2026-01-31T09:00:00Z' });
    const cadence = await statusCadence(projectRoot, localRoot, '2026-02-01T00:00:00Z');
    expect(cadence).toEqual({
      mode: 'monthly',
      lastRunAt: '2026-01-31T09:00:00Z',
      nextDueAt: '2026-02-28T09:00:00Z',
    });
  });

  it('reports nextDueAt null for a manual cadence even with a recorded lastRunAt', async () => {
    const { projectRoot, localRoot } = await initialize({ cadence: 'manual' });
    await recordOperatingLastRunAt({ projectRoot, localRoot, lastRunAt: '2026-07-28T09:00:00Z' });
    const cadence = await statusCadence(projectRoot, localRoot, '2026-07-30T00:00:00Z');
    expect(cadence).toEqual({
      mode: 'manual',
      lastRunAt: '2026-07-28T09:00:00Z',
      nextDueAt: null,
    });
  });

  it('persists lastRunAt across invocations once a cycle completes and reflects it in status', async () => {
    const { projectRoot, localRoot } = await initialize({ cadence: 'weekly' });
    // No cycle has completed yet: weekly is due immediately (nextDueAt === now).
    const before = await statusCadence(projectRoot, localRoot, '2026-07-30T00:00:00Z');
    expect(before).toEqual({ mode: 'weekly', lastRunAt: null, nextDueAt: '2026-07-30T00:00:00Z' });

    await runOperatingCycle({
      projectRoot,
      localRoot,
      adapter: routeAdapter(),
      confirmed: true,
      now: new Date('2026-07-31T08:00:00.000Z'),
    });

    // A separate status invocation reflects the persisted lastRunAt without re-running.
    const persisted = await readOperatingLastRunAt(projectRoot, { localRoot });
    expect(persisted).toBe('2026-07-31T08:00:00.000Z');
    const after = await statusCadence(projectRoot, localRoot, '2026-08-05T00:00:00Z');
    expect(after).toEqual({
      mode: 'weekly',
      lastRunAt: '2026-07-31T08:00:00.000Z',
      nextDueAt: '2026-08-07T08:00:00Z',
    });
  });

  it('never accepts a finding, applies a route, or invokes PLAN or SHIP for a cadence-triggered reviewable run', async () => {
    const { projectRoot, localRoot } = await initialize({ cadence: 'weekly' });
    const result = await runOperatingCycle({
      projectRoot,
      localRoot,
      adapter: routeAdapter(),
      confirmed: true,
      now: new Date('2026-07-31T08:00:00.000Z'),
    });

    // The run stops at reviewable and never escalates into a native PLAN/SHIP handoff.
    expect(result.nativeHandoff).toBeUndefined();

    const state = await new OperatingEventStore(projectRoot, { localRoot }).state();
    const cycle = state.cycles.at(-1);
    expect(cycle?.state).toBe('reviewable');

    // Assert the ABSENCE of every acting effect, not merely a flag.
    // 1. No finding was accepted.
    expect(state.findings.length).toBeGreaterThan(0);
    expect(state.findings.some((finding) => finding.status === 'accepted')).toBe(false);
    // 2. No route was applied (routes exist only as proposals).
    expect(state.routes.length).toBeGreaterThan(0);
    expect(state.routes.every((route) => route.state === 'proposed')).toBe(true);
    expect(state.routes.some((route) => route.state === 'applied')).toBe(false);
    // 3. PLAN was not invoked: no spec was linked or decomposed.
    expect(state.specLinks).toHaveLength(0);
    // 4. SHIP was not invoked: no outcome was registered.
    expect(state.outcomes).toHaveLength(0);

    const replay = await new OperatingEventStore(projectRoot, { localRoot }).replay();
    const actingEvents = replay.events.filter((event) =>
      [
        'route.applied',
        'finding.accepted',
        'spec.linked',
        'outcome.registered',
        'artifact.created',
      ].includes(event.type),
    );
    expect(actingEvents).toHaveLength(0);
    expect(replay.events.some((event) => event.type === 'cycle.reviewable')).toBe(true);

    // The cadence marker is persisted so status can surface nextDueAt afterwards.
    expect(await readOperatingLastRunAt(projectRoot, { localRoot })).toBe(
      '2026-07-31T08:00:00.000Z',
    );

    // The pipeline's structural never-acts guarantee anchors the assertion above.
    expect(await assertOperatingCadenceCannotMutate()).toBe(true);
  });
});

function citationBearingRoleResults(head: string): OperatingRoleResult[] {
  const proposal = (proposalKey: string, repositoryPath: string): Record<string, unknown> => ({
    proposalKey,
    type: 'finding',
    title: 'Title',
    problem: 'Problem',
    proposal: 'Proposal',
    impact: 3,
    confidence: 3,
    ease: 3,
    severity: 'low',
    evidenceRefs: [],
    citations: [{ repositoryPath, lineRange: { start: 1, end: 1 }, pinnedRevision: head }],
  });
  return [
    {
      kind: 'operating-role-result',
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      cycleId: 'CYCLE-001',
      roleId: 'strategy-finance',
      inputDigest: `sha256:${'0'.repeat(64)}`,
      resultDigest: `sha256:${'0'.repeat(64)}`,
      outcome: 'proposals',
      proposals: [proposal('good-cite', 'src/service.ts'), proposal('bad-cite', 'src/missing.ts')],
      gaps: [],
      conflicts: [],
      producer: {
        product: 'openplanr',
        version: '0.0.0',
        runtime: 'codex',
        capability: 'analysis-high',
      },
    },
  ] as unknown as OperatingRoleResult[];
}

describe('operate recorded-proposal citation gate (FR3 / E-003)', () => {
  it('drops a proposal citing a fabricated path with one gap and keeps a valid citation with its evidence id', async () => {
    const projectRoot = await temporaryDirectory('openplanr-operate-citation-gate-project-');
    await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
    await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
      cwd: projectRoot,
    });
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await writeFile(join(projectRoot, 'src', 'service.ts'), 'export const ok = 1;\n');
    await execFileAsync('git', ['add', '-A'], { cwd: projectRoot });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
    const head = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })
    ).stdout.trim();

    const descriptor: OperatingWorkspaceComponent = {
      componentId: 'control',
      canonicalRemote: 'github.com/openplanr/citation-gate-fixture',
      configuredBranch: 'main',
      pinnedRevision: head,
      dirtyFingerprint: null,
      readOnly: false,
    };
    const cacheRoot = await temporaryDirectory('openplanr-operate-citation-gate-cache-');
    const context: CitationResolutionContext = {
      projectRoot,
      cycleId: 'CYCLE-001',
      descriptor,
      cache: new OperatingEvidenceCache(cacheRoot, 'restricted'),
      owner: 'chair',
      now: new Date('2026-07-31T00:00:00.000Z'),
    };

    const gated = await gateRecordedProposalCitations({
      roleResults: citationBearingRoleResults(head),
      context,
    });

    // The fabricated-path proposal is dropped: it can never reach consolidation.
    const survivingKeys = gated.roleResults.flatMap((result) =>
      result.proposals.map((proposal) => proposal.proposalKey),
    );
    expect(survivingKeys).toEqual(['good-cite']);

    // Exactly one unresolvable-citation gap is opened in its place.
    expect(gated.gaps).toHaveLength(1);
    expect(gated.gaps[0]).toMatchObject({
      kind: 'operating-data-gap',
      category: 'unresolvable-citation',
      status: 'open',
      cycleId: 'CYCLE-001',
    });

    // The valid citation passes through with its minted evidence id attached.
    const good = gated.roleResults[0].proposals.find(
      (proposal) => proposal.proposalKey === 'good-cite',
    );
    expect(good?.evidenceRefs.some((ref) => /^EVD-/.test(ref))).toBe(true);
  });

  it('is a no-op for proposals that carry no citations (v1.2 evidence-ref path)', async () => {
    const roleResults = [
      {
        kind: 'operating-role-result',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        cycleId: 'CYCLE-001',
        roleId: 'strategy-finance',
        inputDigest: `sha256:${'0'.repeat(64)}`,
        resultDigest: `sha256:${'0'.repeat(64)}`,
        outcome: 'proposals',
        proposals: [
          {
            proposalKey: 'plain',
            type: 'finding',
            title: 'T',
            problem: 'P',
            proposal: 'Q',
            impact: 3,
            confidence: 3,
            ease: 3,
            severity: 'low',
            evidenceRefs: ['EVD-seed'],
          },
        ],
        gaps: [],
        conflicts: [],
        producer: {
          product: 'openplanr',
          version: '0.0.0',
          runtime: 'codex',
          capability: 'analysis-high',
        },
      },
    ] as unknown as OperatingRoleResult[];
    const context = {
      projectRoot: '/nonexistent',
      cycleId: 'CYCLE-001',
    } as CitationResolutionContext;
    const gated = await gateRecordedProposalCitations({ roleResults, context });
    // A pack result carries no citations, so the now-unconditional universal gate
    // is a SEMANTIC no-op: the same content is returned (a fresh array, since the
    // `bearing.length === 0` bypass was removed so the citation resolver runs on
    // every path), no gaps are opened, and the role is not demoted to
    // not_evaluated (a citation-free v1.2 result is not a citation-bearing role).
    expect(gated.roleResults).toStrictEqual(roleResults);
    expect(gated.gaps).toHaveLength(0);
    expect(gated.notEvaluatedRoleIds).toEqual([]);
  });
});
