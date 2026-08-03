import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inspectOperatingCompletion,
  renderOperatingReviewGateNotice,
  verifyOperatingCompletionPhases,
} from '../../src/services/operate/completion.js';
import { writeOperatingScratch } from '../../src/services/operate/scratch.js';
import type { OperatingState } from '../../src/services/operate/types.js';
import {
  type OperatingPaths,
  resolveOperatingPaths,
} from '../../src/services/operate/workspace.js';

const ADVISORY_ROLES = [
  'strategy-finance',
  'technology-risk',
  'product-activation',
  'growth-market',
  'operations-customer',
] as const;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

async function temporaryProject(): Promise<{
  projectRoot: string;
  localRoot: string;
  paths: OperatingPaths;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'openplanr-operate-completion-'));
  temporaryDirectories.push(root);
  const projectRoot = path.join(root, 'project');
  const localRoot = path.join(root, 'state');
  await mkdir(projectRoot, { recursive: true });
  const paths = resolveOperatingPaths(projectRoot, { localRoot });
  return { projectRoot, localRoot, paths };
}

function boardFile(role: string, status: 'evaluated' | 'not_evaluated'): string {
  return [
    '<!-- ##planr-operate-board:begin## (managed by planr CLI) -->',
    `## ${role}`,
    '',
    'Mandate for the lens.',
    '',
    `Status: ${status}`,
    '',
    '### Recommendations',
    '',
    '- A cited recommendation.',
    '<!-- ##planr-operate-board:end## -->',
  ].join('\n');
}

function cycleState(cycleId: string, overrides: Record<string, unknown> = {}): OperatingState {
  return {
    kind: 'operating-state',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    generatedAt: '2026-08-02T00:00:00.000Z',
    eventHead: { sequence: 1, hash: `sha256:${'a'.repeat(64)}` },
    cycles: [
      {
        id: cycleId,
        state: 'reviewable',
        enabledRoles: [...ADVISORY_ROLES],
        producer: { product: 'openplanr', version: '1.0.0', runtime: 'claude' },
        ...overrides,
      },
    ],
    findings: [],
    decisions: [],
    dataGaps: [],
    routes: [],
    specLinks: [],
    outcomes: [],
    learnings: [],
    evidenceSources: [],
    summary: {
      currentCycleId: cycleId,
      currentConstraint: null,
      quiet: true,
      evidenceFreshness: 'fresh',
      surfacedFindings: 0,
      parkedFindings: 0,
      openDecisions: 0,
      openGaps: 0,
      stalledItems: 0,
    },
  } as OperatingState;
}

async function writePhaseFArtifacts(paths: OperatingPaths, cycleId: string): Promise<void> {
  await mkdir(paths.root, { recursive: true });
  await writeFile(paths.config, '{"kind":"operating-config"}\n');
  await writeFile(paths.workspace, '{"kind":"operating-workspace-manifest"}\n');
  const cycleDir = path.join(paths.cycles, cycleId);
  const boardDir = path.join(cycleDir, 'board');
  await mkdir(boardDir, { recursive: true });
  for (const role of ADVISORY_ROLES) {
    await writeFile(path.join(boardDir, `${role}.md`), boardFile(role, 'evaluated'));
  }
  await writeFile(path.join(boardDir, 'chair.md'), boardFile('Chair', 'evaluated'));
  await writeFile(path.join(cycleDir, 'brief.md'), '# Cycle brief\n\nOne cited action.\n');
  await writeFile(path.join(cycleDir, 'report.md'), '# Cycle report\n\nFull lens reports.\n');
  await writeFile(
    path.join(cycleDir, 'report.json'),
    `${JSON.stringify({ kind: 'operating-cycle-report', cycleId, roles: [], drafts: [] })}\n`,
  );
  await writeFile(path.join(cycleDir, 'actions.md'), '# Proposed actions\n\n- One proposal.\n');
}

describe('operate completion phase tracker (FR14)', () => {
  it('reports phase C and names phase D as next when only advisors have recorded', async () => {
    const cycleId = 'CYCLE-001';
    const { paths } = await temporaryProject();
    await mkdir(paths.root, { recursive: true });
    await writeFile(paths.config, '{"kind":"operating-config"}\n');
    await writeFile(paths.workspace, '{"kind":"operating-workspace-manifest"}\n');
    const boardDir = path.join(paths.cycles, cycleId, 'board');
    await mkdir(boardDir, { recursive: true });
    // Two advisory lenses recorded; Chair has not consolidated; no report/actions.
    await writeFile(path.join(boardDir, 'strategy-finance.md'), boardFile('CEO', 'evaluated'));
    await writeFile(path.join(boardDir, 'technology-risk.md'), boardFile('CTO', 'evaluated'));

    const result = await verifyOperatingCompletionPhases(
      cycleState(cycleId, { state: 'advising' }),
      cycleId,
      paths,
    );

    expect(result.reachedPhase).toBe('C');
    expect(result.complete).toBe(false);
    expect(result.nextPhase).toBe('D');
    expect(result.nextLabel).toBe('Chair consolidation');
    expect(result.missing.join(' ')).toContain('board/chair.md');
    // A phase-C cycle is never reported reviewable.
    expect(result.reachedPhase).not.toBe('F');
  });

  it('does not treat a fresh cycle start as recording — a launched advisor is not phase C', async () => {
    const cycleId = 'CYCLE-002';
    const { paths } = await temporaryProject();
    await mkdir(paths.root, { recursive: true });
    await writeFile(paths.config, '{"kind":"operating-config"}\n');
    await writeFile(paths.workspace, '{"kind":"operating-workspace-manifest"}\n');
    // Cycle started and runtime-bound, but no board file recorded yet.
    const result = await verifyOperatingCompletionPhases(
      cycleState(cycleId, { state: 'advising' }),
      cycleId,
      paths,
    );
    expect(result.reachedPhase).toBe('B');
    expect(result.nextPhase).toBe('C');
    expect(result.missing.join(' ')).toContain('recorded advisor lens');
  });

  it('reports complete only with every phase-F artifact, and flips when any is removed', async () => {
    const cycleId = 'CYCLE-003';
    const { paths } = await temporaryProject();
    await writePhaseFArtifacts(paths, cycleId);

    const complete = await verifyOperatingCompletionPhases(cycleState(cycleId), cycleId, paths);
    expect(complete.complete).toBe(true);
    expect(complete.reachedPhase).toBe('F');
    expect(complete.nextPhase).toBeNull();
    expect(complete.missing).toEqual([]);

    // Removing the final report drops the cycle below phase F.
    const cycleDir = path.join(paths.cycles, cycleId);
    const removals: Array<{ label: string; remove: () => Promise<void> }> = [
      { label: 'report.md', remove: () => unlink(path.join(cycleDir, 'report.md')) },
      { label: 'report.json', remove: () => unlink(path.join(cycleDir, 'report.json')) },
      { label: 'actions.md', remove: () => unlink(path.join(cycleDir, 'actions.md')) },
      { label: 'board/chair.md', remove: () => unlink(path.join(cycleDir, 'board', 'chair.md')) },
      {
        label: 'board/growth-market.md',
        remove: () => unlink(path.join(cycleDir, 'board', 'growth-market.md')),
      },
    ];
    for (const { label, remove } of removals) {
      await writePhaseFArtifacts(paths, cycleId);
      await remove();
      const partial = await verifyOperatingCompletionPhases(cycleState(cycleId), cycleId, paths);
      expect(partial.complete, `removing ${label} must flip completeness`).toBe(false);
    }

    // A non-terminal committed state also flips it back.
    await writePhaseFArtifacts(paths, cycleId);
    const stillAdvising = await verifyOperatingCompletionPhases(
      cycleState(cycleId, { state: 'advising' }),
      cycleId,
      paths,
    );
    expect(stillAdvising.complete).toBe(false);
    expect(stillAdvising.missing.join(' ')).toContain('terminal cycle state');
  });

  it('flips completeness when abandoned OpenPlanr-owned scratch is present', async () => {
    const cycleId = 'CYCLE-004';
    const { paths } = await temporaryProject();
    await writePhaseFArtifacts(paths, cycleId);

    expect(
      (await verifyOperatingCompletionPhases(cycleState(cycleId), cycleId, paths)).complete,
    ).toBe(true);

    // An owned scratch set whose lease already lapsed is abandoned (T-006).
    await writeOperatingScratch({
      paths,
      cycleId,
      key: 'result',
      payload: { role: 'chair' },
      now: () => new Date('2020-01-01T00:00:00.000Z'),
      leaseDurationMs: 1_000,
    });

    const result = await verifyOperatingCompletionPhases(cycleState(cycleId), cycleId, paths);
    expect(result.complete).toBe(false);
    expect(result.missing.join(' ')).toContain('abandoned OpenPlanr-owned scratch');
  });

  it('requires a runtime binding at phase B (blank fails, `auto` is accepted)', async () => {
    const cycleId = 'CYCLE-005';
    const { paths } = await temporaryProject();
    await writePhaseFArtifacts(paths, cycleId);
    // A blank binding is a cycle that was never bound to a runtime.
    const unbound = await verifyOperatingCompletionPhases(
      cycleState(cycleId, {
        producer: { product: 'openplanr', version: '1.0.0', runtime: '' },
      }),
      cycleId,
      paths,
    );
    expect(unbound.complete).toBe(false);
    expect(unbound.reachedPhase).toBe('A');
    expect(unbound.nextPhase).toBe('B');
    expect(unbound.missing.join(' ')).toContain('runtime binding');

    // `auto` is a legitimate engine binding for a structured/offline cycle and
    // must never be mistaken for a missing one.
    const auto = await verifyOperatingCompletionPhases(
      cycleState(cycleId, {
        producer: { product: 'openplanr', version: '1.0.0', runtime: 'auto' },
      }),
      cycleId,
      paths,
    );
    expect(auto.complete).toBe(true);
  });

  it('renders a review-gate notice only for an incomplete cycle', async () => {
    const cycleId = 'CYCLE-006';
    const { paths } = await temporaryProject();
    await writePhaseFArtifacts(paths, cycleId);
    const complete = await verifyOperatingCompletionPhases(cycleState(cycleId), cycleId, paths);
    expect(renderOperatingReviewGateNotice(complete)).toEqual([]);

    await unlink(path.join(paths.cycles, cycleId, 'board', 'chair.md'));
    const partial = await verifyOperatingCompletionPhases(cycleState(cycleId), cycleId, paths);
    const notice = renderOperatingReviewGateNotice(partial);
    expect(notice.join('\n')).toContain('has not reached the review gate');
    expect(notice.join('\n')).toContain('Next required phase: D');
    // The notice never leaks internal transport vocabulary.
    expect(notice.join('\n')).not.toMatch(/lease|idempotency|harness\.|adapter\./i);
  });

  it('inspectOperatingCompletion returns null when the requested cycle is not committed', async () => {
    const { projectRoot, localRoot, paths } = await temporaryProject();
    await mkdir(paths.root, { recursive: true });
    // An empty board has no committed cycle to verify, so the CLI review path
    // gets no phase banner and simply renders the normal review output.
    await expect(
      inspectOperatingCompletion({ projectRoot, cycleId: 'CYCLE-404', localRoot }),
    ).resolves.toBeNull();
  });
});
