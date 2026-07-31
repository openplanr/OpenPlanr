import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/services/operate/canonical.js';
import {
  assertOperatingProjectionsCurrent,
  inspectOperatingProjectionDrift,
  OPERATING_PROJECTION_PATHS,
  persistOperatingProjections,
  prepareOperatingProjectionPersistence,
  renderOperatingProjectionFiles,
} from '../../src/services/operate/projection-persistence.js';
import type { OperatingState } from '../../src/services/operate/types.js';

const temporaryDirectories: string[] = [];
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

function state(): OperatingState {
  return {
    kind: 'operating-state',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    generatedAt: '2026-07-28T10:05:00.000Z',
    eventHead: { sequence: 15, hash: digest('f') },
    cycles: [
      {
        kind: 'operating-cycle-manifest',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        id: 'CYCLE-001',
        state: 'reviewable',
        health: 'normal',
        depth: 'standard',
        focus: ['all'],
        inputDigest: digest('a'),
        enabledRoles: ['technology-risk'],
        enabledProviders: ['repository', 'git'],
        createdAt: '2026-07-28T09:00:00.000Z',
        updatedAt: '2026-07-28T10:05:00.000Z',
        completedAt: null,
        producer: {
          product: 'openplanr',
          version: '1.14.0',
          runtime: 'fixture',
        },
        warnings: [],
      },
    ],
    findings: [
      {
        id: 'FND-002',
        cycleId: 'CYCLE-001',
        title: 'Park a lower-value expansion',
        status: 'proposed',
        lane: 'OWNER',
        owner: 'Founder',
        score: 20,
        severity: 'low',
        sensitivity: 'internal',
        criticalOverride: false,
        evidenceRefs: ['EVD-repository'],
        parked: true,
        problem: 'Activation is the current constraint.',
        updatedAt: '2026-07-28T10:03:00.000Z',
      },
      {
        id: 'FND-001',
        cycleId: 'CYCLE-001',
        title: 'Instrument activation',
        problem: 'The activation funnel has no verified baseline.',
        proposal: 'Create one bounded instrumentation spec.',
        status: 'accepted',
        lane: 'DEV',
        owner: 'Product engineering',
        score: 80,
        severity: 'high',
        sensitivity: 'internal',
        criticalOverride: false,
        evidenceRefs: ['EVD-planr', 'EVD-repository'],
        parked: false,
        updatedAt: '2026-07-28T10:02:00.000Z',
      },
    ],
    decisions: [
      {
        id: 'DEC-001',
        cycleId: 'CYCLE-001',
        question: 'Which activation event is authoritative?',
        status: 'open',
        owner: 'Founder',
        deadline: '2026-07-30T12:00:00.000Z',
        reversibility: 'reversible',
        recommendation: 'Use onboarding-completed.',
        updatedAt: '2026-07-28T10:02:00.000Z',
      },
    ],
    dataGaps: [
      {
        id: 'GAP-001',
        cycleId: 'CYCLE-001',
        question: 'What is the 30-day activation baseline?',
        reason: 'Confidence cannot exceed the evidence ceiling.',
        status: 'open',
        owner: 'Product',
        unblocks: ['FND-001'],
        updatedAt: '2026-07-28T10:02:00.000Z',
      },
    ],
    routes: [
      {
        id: 'ACT-001',
        cycleId: 'CYCLE-001',
        state: 'accepted',
        routeDigest: digest('b'),
        previewDigest: digest('c'),
        findingIds: ['FND-001'],
        actionCount: 1,
        updatedAt: '2026-07-28T10:04:00.000Z',
      },
    ],
    specLinks: [
      {
        specId: 'SPEC-010',
        cycleId: 'CYCLE-001',
        findingId: 'FND-001',
        planningEngine: 'openplanr',
        state: 'planned',
        path: '.planr/specs/SPEC-010-activation/SPEC-010-activation.md',
        updatedAt: '2026-07-28T10:04:00.000Z',
      },
    ],
    outcomes: [
      {
        id: 'OUT-001',
        specId: 'SPEC-010',
        status: 'pending',
        verifyAfter: '2026-08-15',
        metric: 'activation rate',
        updatedAt: '2026-07-28T10:04:00.000Z',
      },
    ],
    learnings: [],
    evidenceSources: [
      {
        id: 'repository',
        freshness: 'fresh',
        status: 'collected',
        itemCount: 4,
        collectedAt: '2026-07-28T09:30:00.000Z',
      },
    ],
    summary: {
      currentCycleId: 'CYCLE-001',
      currentConstraint: 'The activation funnel has no verified baseline.',
      quiet: false,
      evidenceFreshness: 'fresh',
      surfacedFindings: 1,
      parkedFindings: 1,
      openDecisions: 1,
      openGaps: 1,
      stalledItems: 0,
    },
  };
}

describe('Operating Board projection persistence', () => {
  it('renders canonical JSON and deterministic sorted managed views', () => {
    const current = state();
    const first = renderOperatingProjectionFiles(current);
    const second = renderOperatingProjectionFiles(structuredClone(current));

    expect(second).toEqual(first);
    // The FR5 readable tree renders above the `.state/` internals alongside the
    // projections directory: one consolidated Markdown file per register plus
    // `evidence-index.json`, and a `board/<role>.md` for every board role of
    // each reviewable/closed cycle (including roles the cycle did not evaluate).
    expect(first.map((file) => file.relativePath)).toEqual([
      '.planr/operate/projections/state.json',
      '.planr/operate/evidence-index.json',
      '.planr/operate/projections/register.md',
      '.planr/operate/projections/decisions.md',
      '.planr/operate/projections/data-gaps.md',
      '.planr/operate/projections/backlog.md',
      '.planr/operate/brief.md',
      '.planr/operate/findings.md',
      '.planr/operate/decisions.md',
      '.planr/operate/gaps.md',
      '.planr/operate/routes.md',
      '.planr/operate/cycles/CYCLE-001/brief.md',
      '.planr/operate/cycles/CYCLE-001/board/strategy-finance.md',
      '.planr/operate/cycles/CYCLE-001/board/technology-risk.md',
      '.planr/operate/cycles/CYCLE-001/board/product-activation.md',
      '.planr/operate/cycles/CYCLE-001/board/growth-market.md',
      '.planr/operate/cycles/CYCLE-001/board/operations-customer.md',
      '.planr/operate/cycles/CYCLE-001/board/chair.md',
    ]);
    expect(first[0]?.content).toBe(`${canonicalize(current)}\n`);

    const byPath = new Map(first.map((file) => [file.relativePath, file]));
    const register = byPath.get(OPERATING_PROJECTION_PATHS.register)?.managedContent;
    expect(register?.indexOf('FND-001')).toBeLessThan(register?.indexOf('FND-002') ?? 0);
    expect(register).toContain('Event head: 15 /');

    // The readable-tree `findings.md` reuses the register renderer, so it is
    // byte-identical to the projections register managed block.
    const findings = byPath.get(OPERATING_PROJECTION_PATHS.findings)?.managedContent;
    expect(findings).toBe(register);

    const routes = byPath.get(OPERATING_PROJECTION_PATHS.routes)?.managedContent;
    expect(routes).toContain('Operating Routes');
    expect(routes).toContain('ACT-001');

    // `evidence-index.json` is canonical, non-managed bytes (like `state.json`).
    const evidenceIndex = byPath.get(OPERATING_PROJECTION_PATHS.evidenceIndex);
    expect(evidenceIndex?.markerName).toBeUndefined();
    expect(evidenceIndex?.content).toContain('"kind":"operating-evidence-index"');
    expect(evidenceIndex?.content).toContain('"id":"repository"');

    const topBrief = byPath.get(OPERATING_PROJECTION_PATHS.brief)?.managedContent;
    expect(topBrief).toContain('# OpenPlanr Operating Brief');

    const cycleBrief = byPath.get('.planr/operate/cycles/CYCLE-001/brief.md')?.managedContent;
    expect(cycleBrief).toContain('# OpenPlanr Operating Brief');
    expect(cycleBrief?.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(900);

    // The fixture cycle enables only `technology-risk`; every other board role
    // still renders explicitly as `not_evaluated`.
    const evaluatedBoard = byPath.get(
      '.planr/operate/cycles/CYCLE-001/board/technology-risk.md',
    )?.managedContent;
    expect(evaluatedBoard).toContain('Status: evaluated');
    expect(evaluatedBoard).toContain('## Evidence gaps');

    const notEvaluatedBoard = byPath.get(
      '.planr/operate/cycles/CYCLE-001/board/strategy-finance.md',
    )?.managedContent;
    expect(notEvaluatedBoard).toContain('Status: not_evaluated');
    expect(notEvaluatedBoard).toContain('was not enabled for CYCLE-001');
  });

  it('commits all changed files atomically and becomes byte-idempotent', async () => {
    const projectRoot = await temporaryDirectory('openplanr-projection-project-');
    const localRoot = await temporaryDirectory('openplanr-projection-local-');
    const first = await persistOperatingProjections({
      projectRoot,
      localRoot,
      state: state(),
      transactionId: 'TXN-projection-first',
      now: '2026-07-28T10:06:00.000Z',
    });

    expect(first.changedPaths).toHaveLength(18);
    expect(first.changedPaths).toContain('.planr/operate/evidence-index.json');
    expect(first.changedPaths).toContain('.planr/operate/findings.md');
    expect(first.changedPaths).toContain('.planr/operate/routes.md');
    expect(first.changedPaths).toContain(
      '.planr/operate/cycles/CYCLE-001/board/strategy-finance.md',
    );
    expect(first.transactionId).toBe('TXN-projection-first');
    expect(await readFile(path.join(projectRoot, OPERATING_PROJECTION_PATHS.state), 'utf8')).toBe(
      `${canonicalize(state())}\n`,
    );
    await expect(
      assertOperatingProjectionsCurrent({ projectRoot, state: state() }),
    ).resolves.toBeUndefined();

    const second = await persistOperatingProjections({
      projectRoot,
      localRoot,
      state: state(),
    });
    expect(second.changedPaths).toEqual([]);
    expect(second.transactionId).toBeNull();
  });

  it('reports generated-row drift and repairs it without changing hand-authored bytes', async () => {
    const projectRoot = await temporaryDirectory('openplanr-projection-project-');
    const localRoot = await temporaryDirectory('openplanr-projection-local-');
    await mkdir(path.join(projectRoot, '.planr/operate/projections'), { recursive: true });
    const registerPath = path.join(projectRoot, OPERATING_PROJECTION_PATHS.register);
    await writeFile(registerPath, 'Founder note before generated content.\n');

    await persistOperatingProjections({
      projectRoot,
      localRoot,
      state: state(),
      transactionId: 'TXN-projection-initial',
      now: '2026-07-28T10:06:00.000Z',
    });
    const generated = await readFile(registerPath, 'utf8');
    await writeFile(
      registerPath,
      `${generated.replace('Instrument activation', 'Edited generated row')}\nFounder note after generated content.\n`,
    );

    const drift = await inspectOperatingProjectionDrift({ projectRoot, state: state() });
    expect(drift.find((entry) => entry.path === OPERATING_PROJECTION_PATHS.register)).toMatchObject(
      {
        status: 'drift',
        reason: 'Generated projection rows differ from event replay.',
      },
    );
    await expect(
      assertOperatingProjectionsCurrent({ projectRoot, state: state() }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_PROJECTION_DRIFT' });

    const preview = await prepareOperatingProjectionPersistence({
      projectRoot,
      state: state(),
    });
    expect(preview.changedPaths).toEqual([OPERATING_PROJECTION_PATHS.register]);
    await persistOperatingProjections({
      projectRoot,
      localRoot,
      state: state(),
      transactionId: 'TXN-projection-repair',
      now: '2026-07-28T10:07:00.000Z',
    });

    const repaired = await readFile(registerPath, 'utf8');
    expect(repaired).toContain('Founder note before generated content.');
    expect(repaired).toContain('Founder note after generated content.');
    expect(repaired).toContain('Instrument activation');
    expect(repaired).not.toContain('Edited generated row');
    await expect(
      assertOperatingProjectionsCurrent({ projectRoot, state: state() }),
    ).resolves.toBeUndefined();
  });

  it('treats duplicate managed markers as explicit drift', async () => {
    const projectRoot = await temporaryDirectory('openplanr-projection-project-');
    await mkdir(path.join(projectRoot, '.planr/operate/projections'), { recursive: true });
    const expected = renderOperatingProjectionFiles(state());
    for (const file of expected) {
      const target = path.join(projectRoot, file.relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
    const registerPath = path.join(projectRoot, OPERATING_PROJECTION_PATHS.register);
    const current = await readFile(registerPath, 'utf8');
    await writeFile(registerPath, `${current}\n${current}`);

    const drift = await inspectOperatingProjectionDrift({ projectRoot, state: state() });
    expect(drift.find((entry) => entry.path === OPERATING_PROJECTION_PATHS.register)).toMatchObject(
      {
        status: 'drift',
        reason: 'Managed projection markers are malformed or duplicated.',
      },
    );
  });
});
