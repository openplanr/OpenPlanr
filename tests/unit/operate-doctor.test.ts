import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { operatingProjectKey } from '../../src/services/operate/config.js';
import {
  diagnoseOperatingBoard,
  diagnoseOperatingCycleIntegrity,
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
      pipelineVersion: '0.30.0',
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

  it('reports a runtime that cannot carry a mandate as unsupported, with an explicit reason and remediation', async () => {
    const store = new OperatingEventStore(projectRoot, { localRoot });
    await store.initialize();

    const diagnostics = await diagnoseOperatingBoard({ projectRoot, localRoot, runtime: 'codex' });
    const classification = diagnostics.find(
      (item) => item.code === 'operate-runtime-classification',
    );
    expect(classification).toMatchObject({ status: 'warn' });
    expect(classification?.message).toContain('unsupported');
    expect(classification?.message).toMatch(/advisory|unverifiable|cannot carry a mandate/i);
    expect(classification?.fix).toMatch(/claude-code|planr setup/i);
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
});
