import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { operatingProjectKey } from '../../src/services/operate/config.js';
import {
  diagnoseBoardStateVersion,
  diagnoseOperatingBoard,
  diagnoseOperatingCycleIntegrity,
  evaluateAgentContract,
  evaluateOperatingTransportLeakage,
} from '../../src/services/operate/doctor.js';
import { OperatingEventStore } from '../../src/services/operate/event-store.js';
import { prepareJournalTransaction } from '../../src/services/operate/journal.js';
import type { OperatingState } from '../../src/services/operate/types.js';
import { resolveOperatingPaths } from '../../src/services/operate/workspace.js';

const execFileAsync = promisify(execFile);

// A cycle whose committed gaps carry all three integrity signals — a rejected
// citation, a boundary refusal, and a not_evaluated role — for the FR7 check.
function integrityState(): OperatingState {
  return {
    kind: 'operating-state',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    generatedAt: '2026-08-01T00:00:00.000Z',
    eventHead: { sequence: 1, hash: `sha256:${'a'.repeat(64)}` },
    cycles: [{ id: 'CYCLE-001', state: 'reviewable' }],
    findings: [],
    decisions: [],
    dataGaps: [
      {
        id: 'GAP-reject',
        cycleId: 'CYCLE-001',
        category: 'unresolvable-citation',
        reason: 'unresolvable',
        question: 'A cited path could not be resolved to evidence at the pinned revision.',
        status: 'open',
      },
      {
        id: 'GAP-boundary',
        cycleId: 'CYCLE-001',
        category: 'unresolvable-citation',
        reason: 'dirty-working-tree',
        question:
          'A citation reached uncommitted working-tree content outside the pinned revision.',
        status: 'open',
      },
      {
        id: 'GAP-role',
        cycleId: 'CYCLE-001',
        category: 'missing-evidence',
        reason: 'The role grounded no evidence and is recorded not_evaluated.',
        question: 'What evidence can technology-risk cite?',
        affectedRoles: ['technology-risk'],
        status: 'open',
      },
    ] as OperatingState['dataGaps'],
    routes: [],
    specLinks: [],
    outcomes: [],
    learnings: [],
    evidenceSources: [],
    summary: {
      currentCycleId: 'CYCLE-001',
      currentConstraint: null,
      quiet: true,
      evidenceFreshness: 'fresh',
      surfacedFindings: 0,
      parkedFindings: 0,
      openDecisions: 0,
      openGaps: 3,
      stalledItems: 0,
    },
  } as OperatingState;
}

let root: string;
let projectRoot: string;
let localRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openplanr-operate-doctor-'));
  projectRoot = join(root, 'project');
  localRoot = join(root, 'state');
  mkdirSync(projectRoot, { recursive: true });
  process.env.OPENPLANR_PIPELINE_ROOT =
    process.env.OPENPLANR_PIPELINE_ROOT ?? resolve('../planr-pipeline');
});

afterEach(() => {
  delete process.env.OPENPLANR_PIPELINE_ROOT;
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('Operating Board doctor', () => {
  it('validates Protocol registries, event replay, checkpoints, and projections', async () => {
    const store = new OperatingEventStore(projectRoot, { localRoot });
    await store.initialize();
    await store.writeCheckpoint();

    const diagnostics = await diagnoseOperatingBoard({
      projectRoot,
      localRoot,
      pipelineVersion: '0.37.1',
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'operate-protocol', status: 'pass' }),
        expect.objectContaining({ code: 'operate-event-replay', status: 'pass' }),
        expect.objectContaining({ code: 'operate-checkpoint', status: 'pass' }),
        expect.objectContaining({ code: 'operate-projection', status: 'pass' }),
        expect.objectContaining({ code: 'operate-locks', status: 'pass' }),
        expect.objectContaining({ code: 'operate-journals', status: 'pass' }),
      ]),
    );
  });

  it('reports corrupt replay state instead of inventing recovery history', async () => {
    const store = new OperatingEventStore(projectRoot, { localRoot });
    await store.initialize();
    writeFileSync(store.paths.events, '{not-json}\n');

    const diagnostics = await diagnoseOperatingBoard({ projectRoot, localRoot });
    expect(diagnostics.find((item) => item.code === 'operate-event-replay')).toMatchObject({
      status: 'fail',
      fix: 'Run `planr operate integrity status`; do not edit events.jsonl by hand.',
    });
  });

  it('detects stale leases and incomplete transaction journals without deleting either', async () => {
    const store = new OperatingEventStore(projectRoot, { localRoot });
    await store.initialize();
    const paths = resolveOperatingPaths(projectRoot, { localRoot });
    mkdirSync(paths.locks, { recursive: true });
    writeFileSync(
      join(paths.locks, 'project.lock'),
      `${JSON.stringify({
        projectKey: operatingProjectKey(projectRoot),
        nonce: 'stale-lock-nonce-that-is-long-enough-0001',
        pid: 999_999,
        host: 'test-host',
        processStartedAt: 'Mon Jan 01 00:00:00 2024',
        createdAt: '2024-01-01T00:00:00.000Z',
        heartbeatAt: '2024-01-01T00:00:00.000Z',
        leaseDurationMs: 5_000,
        leaseExpiresAt: '2024-01-01T00:00:05.000Z',
        expectedEventHead: { sequence: 0, hash: null },
      })}\n`,
    );
    writeFileSync(join(projectRoot, 'existing.txt'), 'before\n');
    await prepareJournalTransaction(projectRoot, {
      localRoot,
      eventHead: { sequence: 0, hash: null },
      previewDigest: `sha256:${'a'.repeat(64)}`,
      transactionId: 'TXN-doctor-pending',
      writes: [
        {
          relativePath: 'existing.txt',
          operation: 'replace',
          content: 'after\n',
        },
      ],
    });

    const diagnostics = await diagnoseOperatingBoard({ projectRoot, localRoot });
    expect(diagnostics.find((item) => item.code === 'operate-locks')).toMatchObject({
      status: 'warn',
      message: '1 operating lock lease(s) are stale',
    });
    expect(diagnostics.find((item) => item.code === 'operate-journals')).toMatchObject({
      status: 'warn',
      message: '1 operating transaction journal(s) require recovery',
    });
    expect(paths.locks).toBeTruthy();
  });

  it('states a mandate-capable runtime is dispatched natively as enforced-read-only-bounded', async () => {
    const store = new OperatingEventStore(projectRoot, { localRoot });
    await store.initialize();

    const diagnostics = await diagnoseOperatingBoard({ projectRoot, localRoot, runtime: 'claude' });
    expect(
      diagnostics.find((item) => item.code === 'operate-runtime-classification'),
    ).toMatchObject({
      status: 'pass',
      message: expect.stringContaining('enforced-read-only-bounded'),
    });
  });

  it('reports Codex as runtime-governed and Operate-capable', async () => {
    const store = new OperatingEventStore(projectRoot, { localRoot });
    await store.initialize();

    const diagnostics = await diagnoseOperatingBoard({ projectRoot, localRoot, runtime: 'codex' });
    const classification = diagnostics.find(
      (item) => item.code === 'operate-runtime-classification',
    );
    expect(classification).toMatchObject({ status: 'pass' });
    expect(classification?.message).toContain('runtime-governed');
    expect(classification?.message).toContain('Operate-capable');
  });

  // FR7: the cycle-integrity check reports the three conditions — citation
  // rejections, boundary refusals, and not_evaluated roles — as an explicit
  // diagnostic, and fails when a rejection or refusal is missing from the
  // readable integrity report (the regression guard).
  it('reports the three integrity conditions and fails when they are absent from the readable tree', () => {
    const state = integrityState();
    const missing = diagnoseOperatingCycleIntegrity(state, 'CYCLE-001', null);
    expect(missing.code).toBe('operate-cycle-integrity');
    expect(missing.status).toBe('fail');
    expect(missing.message).toContain('1 citation rejection(s)');
    expect(missing.message).toContain('1 boundary refusal(s)');
    expect(missing.message).toContain('1 not_evaluated role(s)');

    const rendered = 'GAP-reject and GAP-boundary and GAP-role appear here';
    const surfaced = diagnoseOperatingCycleIntegrity(state, 'CYCLE-001', rendered);
    expect(surfaced.status).toBe('warn');
    expect(surfaced.message).toContain('surfaced in the readable integrity report');
  });

  it('passes the integrity check cleanly for a cycle with no integrity signals', () => {
    const clean = diagnoseOperatingCycleIntegrity(
      { ...integrityState(), dataGaps: [] } as OperatingState,
      'CYCLE-001',
      null,
    );
    expect(clean.status).toBe('pass');
    expect(clean.message).toContain('No cycle integrity concerns');
  });

  // FR9: a project whose `.planr/` is gitignored gets a plain-language statement
  // about board versioning — never an unbacked "commit-safe" guarantee.
  it('warns plainly when `.planr/` is gitignored, and passes when it is tracked', async () => {
    const gitProject = join(root, 'git-project');
    mkdirSync(gitProject, { recursive: true });
    await execFileAsync('git', ['init', '--quiet'], { cwd: gitProject });
    const store = new OperatingEventStore(gitProject, { localRoot });
    await store.initialize();

    // Not ignored yet: the sanitized board is eligible to be versioned.
    const tracked = await diagnoseOperatingBoard({ projectRoot: gitProject, localRoot });
    const trackedGit = tracked.find((item) => item.code === 'operate-workspace-git');
    expect(trackedGit?.status).toBe('pass');
    expect(trackedGit?.message).toMatch(/not gitignored|eligible to be committed/);

    // Ignore `.planr/`: the board is no longer tracked, stated plainly.
    writeFileSync(join(gitProject, '.gitignore'), '.planr/\n');
    const ignored = await diagnoseOperatingBoard({ projectRoot: gitProject, localRoot });
    const ignoredGit = ignored.find((item) => item.code === 'operate-workspace-git');
    expect(ignoredGit?.status).toBe('warn');
    expect(ignoredGit?.message).toContain('gitignored');
    expect(ignoredGit?.message).toContain('not tracked or');
    expect(ignoredGit?.fix).toContain('.planr/operate/');
  });

  // FR9 (T-008): the board-state protocol version and the installed agent
  // contract are two SEPARATE facts. A board persisted at the frozen v1.2
  // envelope, read under a v1.4 agent contract, must report both facts as
  // passing and must never be described as "incompatible".
  it('reports board-state version and agent contract as two separate facts, never incompatible', async () => {
    const store = new OperatingEventStore(projectRoot, { localRoot });
    await store.initialize();
    await store.writeCheckpoint();

    const diagnostics = await diagnoseOperatingBoard({
      projectRoot,
      localRoot,
      pipelineVersion: '0.39.0',
    });

    const contract = diagnostics.find((item) => item.code === 'operate-protocol');
    const boardState = diagnostics.find((item) => item.code === 'operate-board-state-version');
    expect(contract).toMatchObject({ status: 'pass' });
    expect(boardState).toBeDefined();
    expect(boardState?.status).toBe('pass');
    // The persisted board is stamped at the frozen v1.2 envelope; the agent
    // contract is v1.4. Both facts are surfaced, neither claims incompatibility.
    expect(boardState?.message).toContain('1.2.0');
    expect(boardState?.message).toContain('1.4.0');
    expect(boardState?.message).toMatch(/not an incompatibility/);
    for (const item of diagnostics) {
      expect(item.message).not.toMatch(/\bis incompatible\b|are incompatible/);
    }
  });

  // The pure mapping: an older persisted board is informational, never a fail
  // or warn; only a NEWER-than-installed board warns, and even then it does not
  // frame the version relationship itself as an incompatibility.
  it('maps board-state versions to honest, non-incompatibility diagnostics', () => {
    const older = diagnoseBoardStateVersion('1.2.0', '1.4.0');
    expect(older.code).toBe('operate-board-state-version');
    expect(older.status).toBe('pass');
    expect(older.message).toMatch(/readable under the current agent contract/);
    expect(older.message).toMatch(/not an incompatibility/);

    const equal = diagnoseBoardStateVersion('1.4.0', '1.4.0');
    expect(equal.status).toBe('pass');
    expect(equal.message).toMatch(/matching the installed agent contract/);

    const newer = diagnoseBoardStateVersion('1.5.0', '1.4.0');
    expect(newer.status).toBe('warn');
    expect(newer.message).not.toMatch(/incompatible/);

    const absent = diagnoseBoardStateVersion(null, '1.4.0');
    expect(absent.status).toBe('pass');
    expect(absent.message).toMatch(/No persisted Operating Board state/);
  });

  // FR9 (T-008): the split preserves the genuine-mismatch failure path — a
  // role/provider/boundary divergence in the INSTALLED contract still fails and
  // names the diverged facet. This exercises the agent-contract decision that
  // the former `diagnoseProtocol` owned, now `diagnoseAgentContractVersion`.
  it('fails the agent-contract check on a genuine registry mismatch, naming the mismatch', () => {
    const certifiedRoles = [
      'strategy-finance',
      'technology-risk',
      'product-activation',
      'growth-market',
      'operations-customer',
      'chair',
    ];
    const certifiedProviders = ['repository', 'planr', 'git', 'github', 'linear', 'file-import'];

    const clean = evaluateAgentContract({
      roleIds: certifiedRoles,
      providerIds: certifiedProviders,
      boundariesValid: true,
      pipelineVersion: '0.39.0',
    });
    expect(clean).toMatchObject({ code: 'operate-protocol', status: 'pass' });

    const wrongRoles = evaluateAgentContract({
      roleIds: ['strategy-finance'],
      providerIds: certifiedProviders,
      boundariesValid: true,
    });
    expect(wrongRoles.status).toBe('fail');
    expect(wrongRoles.message).toContain('roles');
    expect(wrongRoles.message).toContain('diverge');

    const wrongBoundaries = evaluateAgentContract({
      roleIds: certifiedRoles,
      providerIds: certifiedProviders,
      boundariesValid: false,
    });
    expect(wrongBoundaries.status).toBe('fail');
    expect(wrongBoundaries.message).toContain('read-only boundaries');
  });

  // FR10 / T-009: profile/config drift diagnostic.
  it('reports legacy profile/config drift naming the differing fields', async () => {
    const store = new OperatingEventStore(projectRoot, { localRoot });
    await store.initialize();
    const paths = resolveOperatingPaths(projectRoot, { localRoot });
    writeFileSync(
      paths.config,
      JSON.stringify({
        kind: 'operating-config',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        profile: 'engineering',
        decisionOwner: 'Owner',
        cadence: 'manual',
        planningEngine: 'openplanr',
        enabledRoles: ['technology-risk', 'product-activation', 'operations-customer', 'chair'],
        enabledProviders: ['repository', 'planr', 'git'],
        caps: { surfacedFindings: 10, newSpecs: 3, openDecisions: 3, agentArtifacts: 2 },
        budgets: { maxFiles: 1000, maxItems: 2000, maxBytes: 10485760, maxDurationMs: 60000 },
      }),
    );
    mkdirSync(join(projectRoot, '.planr'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.planr', 'operate-profile.json'),
      JSON.stringify({
        id: 'engineering',
        enabledProviders: ['repository', 'planr', 'git', 'linear'],
        budgets: { maxFiles: 5, maxItems: 5, maxBytes: 5, maxDurationMs: 5 },
      }),
    );

    const diagnostics = await diagnoseOperatingBoard({ projectRoot, localRoot });
    const drift = diagnostics.find((item) => item.code === 'operate-profile-drift');
    expect(drift?.status).toBe('warn');
    expect(drift?.message).toContain('enabledProviders');
    expect(drift?.message).toContain('budgets');
    expect(drift?.fix).toContain('profiles migrate');
  });

  it('passes profile/config drift when no legacy profile file is present', async () => {
    const store = new OperatingEventStore(projectRoot, { localRoot });
    await store.initialize();
    const diagnostics = await diagnoseOperatingBoard({ projectRoot, localRoot });
    expect(diagnostics.find((item) => item.code === 'operate-profile-drift')).toMatchObject({
      status: 'pass',
    });
  });

  // FR6 (T-005): the transport-hiding decision, isolated as a pure function so a
  // genuine leak can be exercised directly and a clean board proven clean.
  it('fails the transport-hiding check on a leak and passes on clean human output', () => {
    const clean = evaluateOperatingTransportLeakage([
      { surface: 'status', text: 'Cycle CYCLE-001 is quiet. Please release the constraint.' },
      { surface: 'report/review', text: '## CTO\n\nStatus: proposals\n\n- Evidence: `.planr/x`.' },
    ]);
    expect(clean).toMatchObject({ code: 'operate-transport-hiding', status: 'pass' });

    const leaked = evaluateOperatingTransportLeakage([
      { surface: 'status', text: 'Operating Board is quiet.' },
      { surface: 'review', text: 'Next: run harness.record --role chair (leaseToken=9f3a)' },
    ]);
    expect(leaked.status).toBe('fail');
    expect(leaked.message).toContain('review: harness/adapter command');
    expect(leaked.message).toContain('review: lease');
    expect(leaked.fix).toContain('--json');
  });

  // FR6 / FR14 (T-005): both new checks are wired into the board diagnostics and
  // pass cleanly on an initialized board with no cycle to report or review.
  it('reports transport-hiding and completion discipline as passing on a clean board', async () => {
    const store = new OperatingEventStore(projectRoot, { localRoot });
    await store.initialize();
    await store.writeCheckpoint();

    const diagnostics = await diagnoseOperatingBoard({ projectRoot, localRoot });
    expect(diagnostics.find((item) => item.code === 'operate-transport-hiding')).toMatchObject({
      status: 'pass',
    });
    expect(diagnostics.find((item) => item.code === 'operate-completion')).toMatchObject({
      status: 'pass',
    });
  });
});
