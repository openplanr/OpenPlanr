/**
 * Integration tests for `syncLinearStatusIntoArtifacts`.
 *
 * Covers:
 *   - Pull-direction: QT/BL iterated alongside feature/story, BL vocabulary
 *     (open/closed), `promoted` guard never overwritten.
 *   - Push-direction (the bidirectional fix): when local status changed
 *     since last sync AND Linear didn't, the sync pushes local to Linear
 *     instead of silently overwriting it.
 *   - Three-way merge: true conflicts resolve via `--on-conflict`
 *     (prompt / local / linear).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LinearClient } from '@linear/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenPlanrConfig } from '../src/models/types.js';
import { syncLinearStatusIntoArtifacts } from '../src/services/linear-pull-service.js';
import { ensureDir, writeFile } from '../src/utils/fs.js';

function baseConfig(): OpenPlanrConfig {
  return {
    projectName: 'status-sync-test',
    targets: ['cursor'],
    outputPaths: {
      agile: '.planr',
      cursorRules: '.cursor/rules',
      claudeConfig: '.',
      codexConfig: '.',
    },
    idPrefix: {
      epic: 'EPIC',
      feature: 'FEAT',
      story: 'US',
      task: 'TASK',
      quick: 'QT',
      backlog: 'BL',
      sprint: 'SPRINT',
    },
    createdAt: '2026-04-23',
    linear: {
      teamId: 'team-uuid-abc',
      standaloneProjectId: '9b2f4c3e-1234-4abc-89de-0123456789ab',
    },
  };
}

async function setupProject(): Promise<{ dir: string; config: OpenPlanrConfig }> {
  const dir = mkdtempSync(join(tmpdir(), 'planr-status-sync-'));
  const config = baseConfig();
  for (const subdir of ['quick', 'backlog', 'features', 'stories']) {
    await ensureDir(join(dir, '.planr', subdir));
  }
  await writeFile(join(dir, '.planr', 'config.json'), JSON.stringify(config, null, 2));
  return { dir, config };
}

async function writeQT(
  dir: string,
  id: string,
  status: string,
  linearIssueId: string,
  reconciled?: string,
): Promise<void> {
  const fm = [
    `id: "${id}"`,
    `title: "${id} title"`,
    `status: "${status}"`,
    `linearIssueId: "${linearIssueId}"`,
  ];
  if (reconciled !== undefined) {
    fm.push(`linearStatusReconciled: "${reconciled}"`);
  }
  const body = `---\n${fm.join('\n')}\n---\n\n# ${id}: ${id} title\n\n## Tasks\n\n- [ ] **1.0** Do the thing\n`;
  await writeFile(join(dir, '.planr', 'quick', `${id}-t.md`), body);
}

async function writeBL(
  dir: string,
  id: string,
  status: string,
  linearIssueId: string,
  reconciled?: string,
): Promise<void> {
  const fm = [
    `id: "${id}"`,
    `title: "${id} title"`,
    'priority: "high"',
    'tags: ["bug"]',
    `status: "${status}"`,
    'description: "BL desc."',
    `linearIssueId: "${linearIssueId}"`,
  ];
  if (reconciled !== undefined) {
    fm.push(`linearStatusReconciled: "${reconciled}"`);
  }
  const body = `---\n${fm.join('\n')}\n---\n\n# ${id}\n\n## Description\nBL desc.\n`;
  await writeFile(join(dir, '.planr', 'backlog', `${id}-t.md`), body);
}

/**
 * Linear state types used by `ensureAutoStateIdMap` to build a status→UUID
 * map so push-back calls can resolve a `stateId` without any extra user
 * config. Mirrors Linear's canonical state-type vocabulary.
 */
const DEFAULT_TEAM_STATES = [
  { id: 'state-backlog-uuid', name: 'Backlog', type: 'backlog' },
  { id: 'state-todo-uuid', name: 'Todo', type: 'unstarted' },
  { id: 'state-inprog-uuid', name: 'In Progress', type: 'started' },
  { id: 'state-done-uuid', name: 'Done', type: 'completed' },
  { id: 'state-canceled-uuid', name: 'Canceled', type: 'canceled' },
];

/**
 * Build a LinearClient mock supporting both pull (`issues()` for state
 * names) and push-back (`team.states()` for state-id auto-derivation +
 * `updateIssue()` for the write). Returned helper exposes the `updateIssue`
 * spy so tests can assert on stateId arguments.
 */
function makeClientWithStates(
  issueIdToState: Record<string, string>,
  opts: { teamStates?: typeof DEFAULT_TEAM_STATES } = {},
) {
  const issues = vi.fn(async () => ({
    nodes: Object.entries(issueIdToState).map(([id, name]) => ({
      id,
      state: Promise.resolve({ name }),
    })),
  }));
  const updateIssue = vi.fn<(id: string, input: Record<string, unknown>) => Promise<unknown>>(
    async () => ({ success: true }),
  );
  // `updateLinearIssue` in linear-service.ts calls `client.issue(id)` after
  // updating to load the fresh issue details — mock must provide it.
  const issue = vi.fn(async (id: string) => ({
    id,
    identifier: `MOCK-${id.slice(0, 6)}`,
    url: `https://linear.app/mock/issue/${id}`,
    labelIds: [] as string[],
  }));
  const states = opts.teamStates ?? DEFAULT_TEAM_STATES;
  const team = vi.fn(async () => ({
    issueEstimationType: 'notUsed',
    states: async () => ({ nodes: states }),
  }));
  const client = { issues, updateIssue, issue, team } as unknown as LinearClient;
  return { client, updateIssue, issue, issues, team };
}

describe('syncLinearStatusIntoArtifacts — QT status pull', () => {
  let dir: string;
  let config: OpenPlanrConfig;

  beforeEach(async () => {
    const p = await setupProject();
    dir = p.dir;
    config = p.config;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('updates QT frontmatter when Linear state differs from local', async () => {
    const linearId = '11111111-1111-4111-8111-111111111111';
    await writeQT(dir, 'QT-100', 'pending', linearId);
    const { client } = makeClientWithStates({ [linearId]: 'In Progress' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client);

    expect(summary.updated).toBe(1);
    const raw = readFileSync(join(dir, '.planr', 'quick', 'QT-100-t.md'), 'utf-8');
    expect(raw).toMatch(/status: ["']?in-progress["']?/);
  });

  it('leaves QT unchanged when Linear state maps to the same local status', async () => {
    const linearId = '22222222-2222-4222-8222-222222222222';
    await writeQT(dir, 'QT-101', 'done', linearId);
    const { client } = makeClientWithStates({ [linearId]: 'Completed' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client);

    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(1);
  });
});

describe('syncLinearStatusIntoArtifacts — BL status pull', () => {
  let dir: string;
  let config: OpenPlanrConfig;

  beforeEach(async () => {
    const p = await setupProject();
    dir = p.dir;
    config = p.config;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Linear "Done" transitions local BL open → closed', async () => {
    const linearId = '33333333-3333-4333-8333-333333333333';
    await writeBL(dir, 'BL-100', 'open', linearId);
    const { client } = makeClientWithStates({ [linearId]: 'Done' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client);

    expect(summary.updated).toBe(1);
    const raw = readFileSync(join(dir, '.planr', 'backlog', 'BL-100-t.md'), 'utf-8');
    expect(raw).toMatch(/status: ["']?closed["']?/);
  });

  it('Linear "In Progress" leaves local BL open (in-flight stays open, never maps to in-progress)', async () => {
    const linearId = '44444444-4444-4444-8444-444444444444';
    await writeBL(dir, 'BL-101', 'open', linearId);
    const { client } = makeClientWithStates({ [linearId]: 'In Progress' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client);

    // Maps to `open` — same as local, so no write.
    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(1);
    const raw = readFileSync(join(dir, '.planr', 'backlog', 'BL-101-t.md'), 'utf-8');
    expect(raw).toMatch(/status: ["']?open["']?/);
    expect(raw).not.toMatch(/status: ["']?in-progress["']?/);
  });

  it('locally `promoted` BL is never overwritten when Linear says Done', async () => {
    // A BL was promoted to a QT/story locally. Linear only sees the "Done"
    // state. Pulling back as `closed` would destroy the `promoted → target`
    // linkage captured in the BL body. The sync must treat this as unchanged.
    const linearId = '55555555-5555-4555-8555-555555555555';
    await writeBL(dir, 'BL-102', 'promoted', linearId);
    const { client } = makeClientWithStates({ [linearId]: 'Done' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client);

    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(1);
    const raw = readFileSync(join(dir, '.planr', 'backlog', 'BL-102-t.md'), 'utf-8');
    expect(raw).toMatch(/status: ["']?promoted["']?/);
  });
});

describe('syncLinearStatusIntoArtifacts — bidirectional sync (three-way merge)', () => {
  let dir: string;
  let config: OpenPlanrConfig;

  beforeEach(async () => {
    const p = await setupProject();
    dir = p.dir;
    config = p.config;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('pushes local to Linear when base=remote (local changed since last sync)', async () => {
    // This is the whole point of the fix: user runs `planr quick update
    // QT-200 --status done` (which clears linearStatusReconciled), then
    // `planr linear sync`. Previously Linear's stale `in-progress` silently
    // overwrote local `done`. Now we push local up.
    const linearId = 'aaaaaaaa-1111-4111-8111-111111111111';
    // base matches remote (no local change since last sync from Linear's POV),
    // local diverges → push-back path.
    await writeQT(dir, 'QT-200', 'done', linearId, 'in-progress');
    const { client, updateIssue } = makeClientWithStates({ [linearId]: 'In Progress' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client);

    expect(summary.pushedToLinear).toBe(1);
    expect(summary.updated).toBe(0);
    expect(updateIssue).toHaveBeenCalledTimes(1);
    expect(updateIssue.mock.calls[0]?.[1]).toMatchObject({ stateId: 'state-done-uuid' });
    // Local frontmatter keeps `done`; baseline is refreshed to match.
    const raw = readFileSync(join(dir, '.planr', 'quick', 'QT-200-t.md'), 'utf-8');
    expect(raw).toMatch(/status: ["']?done["']?/);
    expect(raw).toMatch(/linearStatusReconciled: ["']?done["']?/);
    expect(raw).toMatch(/linearStatusSyncedAt:/);
  });

  it('pulls Linear to local when base=local (Linear changed since last sync)', async () => {
    // Mirror of the above: base matches local, Linear changed → pull.
    const linearId = 'bbbbbbbb-2222-4222-8222-222222222222';
    await writeQT(dir, 'QT-201', 'pending', linearId, 'pending');
    const { client, updateIssue } = makeClientWithStates({ [linearId]: 'In Progress' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client);

    expect(summary.updated).toBe(1);
    expect(summary.pushedToLinear).toBe(0);
    expect(updateIssue).not.toHaveBeenCalled();
    const raw = readFileSync(join(dir, '.planr', 'quick', 'QT-201-t.md'), 'utf-8');
    expect(raw).toMatch(/status: ["']?in-progress["']?/);
    expect(raw).toMatch(/linearStatusReconciled: ["']?in-progress["']?/);
  });

  it('true conflict with --on-conflict=local: local wins, push to Linear, counter++', async () => {
    // Both sides diverged: local was set to `done`, Linear was separately
    // flipped to `in-progress`. User picked --on-conflict local → push.
    const linearId = 'cccccccc-3333-4333-8333-333333333333';
    await writeQT(dir, 'QT-202', 'done', linearId, 'pending');
    const { client, updateIssue } = makeClientWithStates({ [linearId]: 'In Progress' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client, {
      onConflict: 'local',
    });

    expect(summary.pushedToLinear).toBe(1);
    expect(summary.conflictDecisions).toBe(1);
    expect(updateIssue).toHaveBeenCalledTimes(1);
    expect(updateIssue.mock.calls[0]?.[1]).toMatchObject({ stateId: 'state-done-uuid' });
    const raw = readFileSync(join(dir, '.planr', 'quick', 'QT-202-t.md'), 'utf-8');
    expect(raw).toMatch(/status: ["']?done["']?/);
  });

  it('true conflict with --on-conflict=linear: remote wins, local overwritten, no push', async () => {
    const linearId = 'dddddddd-4444-4444-8444-444444444444';
    await writeQT(dir, 'QT-203', 'done', linearId, 'pending');
    const { client, updateIssue } = makeClientWithStates({ [linearId]: 'In Progress' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client, {
      onConflict: 'linear',
    });

    expect(summary.updated).toBe(1);
    expect(summary.conflictDecisions).toBe(1);
    expect(summary.pushedToLinear).toBe(0);
    expect(updateIssue).not.toHaveBeenCalled();
    const raw = readFileSync(join(dir, '.planr', 'quick', 'QT-203-t.md'), 'utf-8');
    expect(raw).toMatch(/status: ["']?in-progress["']?/);
    // Baseline updated to the winning value.
    expect(raw).toMatch(/linearStatusReconciled: ["']?in-progress["']?/);
  });

  it('idempotent: re-running sync after a push-back is a no-op', async () => {
    // After the push in test 1, a second sync sees base=local=remote=done.
    // Should record `unchanged`, not double-push.
    const linearId = 'eeeeeeee-5555-4555-8555-555555555555';
    await writeQT(dir, 'QT-204', 'done', linearId, 'done');
    const { client, updateIssue } = makeClientWithStates({ [linearId]: 'Done' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client);

    expect(summary.unchanged).toBe(1);
    expect(summary.pushedToLinear).toBe(0);
    expect(summary.updated).toBe(0);
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it('dry-run skips both file writes and Linear updateIssue calls', async () => {
    const linearId = 'ffffffff-6666-4666-8666-666666666666';
    await writeQT(dir, 'QT-205', 'done', linearId, 'in-progress');
    const { client, updateIssue } = makeClientWithStates({ [linearId]: 'In Progress' });

    const summary = await syncLinearStatusIntoArtifacts(dir, config, client, { dryRun: true });

    // Counter reflects what WOULD happen.
    expect(summary.pushedToLinear).toBe(1);
    // But nothing was actually written.
    expect(updateIssue).not.toHaveBeenCalled();
    const raw = readFileSync(join(dir, '.planr', 'quick', 'QT-205-t.md'), 'utf-8');
    expect(raw).not.toMatch(/linearStatusSyncedAt:/);
  });
});
