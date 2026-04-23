/**
 * Standalone-project push tests (Phase 3 of EPIC-LINEAR-GRANULAR-PUSH).
 *
 * Locks in:
 *   - QT push creates an issue in the configured standalone project with the
 *     parsed checkbox body as description.
 *   - BL push ensures a `backlog` label, attaches it, and creates an issue.
 *   - Re-running each push is idempotent (update, not create).
 *   - Missing `standaloneProjectId` + non-interactive → actionable error,
 *     zero API calls.
 *   - QT checkbox body round-trips through `formatTaskCheckboxBody` identically.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LinearClient } from '@linear/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenPlanrConfig } from '../src/models/types.js';
import { runLinearPush } from '../src/services/linear-push-service.js';
import { ensureDir, writeFile } from '../src/utils/fs.js';

function baseConfig(withStandalone: boolean): OpenPlanrConfig {
  return {
    projectName: 'standalone-push-test',
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
    createdAt: '2026-04-22',
    linear: {
      teamId: 'team-uuid-abc',
      ...(withStandalone
        ? {
            standaloneProjectId: '9b2f4c3e-1234-4abc-89de-0123456789ab',
            standaloneProjectName: 'Planr Quick Tasks',
          }
        : {}),
    },
  };
}

async function writeQuickTask(
  dir: string,
  id: string,
  opts: { linearIssueId?: string; status?: string } = {},
): Promise<void> {
  const fm = [`id: "${id}"`, `title: "${id} title"`, `status: "${opts.status ?? 'pending'}"`];
  if (opts.linearIssueId) fm.push(`linearIssueId: "${opts.linearIssueId}"`);
  const body = `---\n${fm.join('\n')}\n---\n\n# ${id}: ${id} title\n\n## Tasks\n\n- [ ] **1.0** First task\n  - [x] 1.1 Subtask done\n- [ ] **2.0** Second task\n`;
  await writeFile(join(dir, '.planr', 'quick', `${id}-test.md`), body);
}

async function writeBacklogItem(
  dir: string,
  id: string,
  opts: { linearIssueId?: string; status?: string } = {},
): Promise<void> {
  const fm = [
    `id: "${id}"`,
    `title: "${id} title"`,
    'priority: "high"',
    'tags: ["feature","dx"]',
    `status: "${opts.status ?? 'open'}"`,
    'description: "Backlog item description text."',
  ];
  if (opts.linearIssueId) fm.push(`linearIssueId: "${opts.linearIssueId}"`);
  const body = `---\n${fm.join('\n')}\n---\n\n# ${id}\n\n## Description\nBacklog item description text.\n`;
  await writeFile(join(dir, '.planr', 'backlog', `${id}-test.md`), body);
}

function makeFakeClient(
  opts: { teamStates?: Array<{ id: string; name: string; type: string }> } = {},
) {
  let issueCounter = 0;
  let labelCounter = 0;
  const issueInputs: Array<Record<string, unknown>> = [];
  const createIssue = vi.fn(async (input: Record<string, unknown>) => {
    issueCounter += 1;
    issueInputs.push(input);
    return { success: true, issueId: `issue-uuid-${issueCounter}` };
  });
  const updateIssue = vi.fn(async () => ({ success: true }));
  const issueLabels = vi.fn(async () => ({ nodes: [] }));
  const createIssueLabel = vi.fn(async () => {
    labelCounter += 1;
    return { success: true, issueLabelId: `label-uuid-${labelCounter}` };
  });
  const issue = vi.fn(async (id: string) => ({
    id,
    identifier: `ENG-${id.replace(/\D/g, '') || '0'}`,
    url: `https://linear.app/test/issue/${id}`,
    labelIds: [] as string[],
  }));
  const teamStates = opts.teamStates ?? [];
  const team = vi.fn(async () => ({
    states: async () => ({ nodes: teamStates }),
  }));
  const client = {
    createIssue,
    updateIssue,
    issueLabels,
    createIssueLabel,
    issue,
    team,
  } as unknown as LinearClient;
  return {
    client,
    calls: { createIssue, updateIssue, issueLabels, createIssueLabel, issue, team },
    lastIssueInput: () => issueInputs[issueInputs.length - 1],
    allIssueInputs: () => issueInputs,
  };
}

async function setupProject(
  withStandalone = true,
): Promise<{ dir: string; config: OpenPlanrConfig }> {
  const dir = mkdtempSync(join(tmpdir(), 'planr-standalone-'));
  const config = baseConfig(withStandalone);
  await ensureDir(join(dir, '.planr', 'quick'));
  await ensureDir(join(dir, '.planr', 'backlog'));
  await writeFile(join(dir, '.planr', 'config.json'), JSON.stringify(config, null, 2));
  return { dir, config };
}

describe('runLinearPush — QT push', () => {
  let projectDir: string;
  let config: OpenPlanrConfig;
  beforeEach(async () => {
    const p = await setupProject(true);
    projectDir = p.dir;
    config = p.config;
    await writeQuickTask(projectDir, 'QT-007');
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('creates the QT as a top-level issue in the standalone project', async () => {
    const fake = makeFakeClient();
    const plan = await runLinearPush(projectDir, config, fake.client, 'QT-007');
    expect(plan?.scope).toBe('quick');
    expect(fake.calls.createIssue).toHaveBeenCalledTimes(1);
    const input = fake.lastIssueInput();
    expect(input?.projectId).toBe('9b2f4c3e-1234-4abc-89de-0123456789ab');
    expect(input?.parentId).toBeUndefined(); // top-level, no parent
    // Auto-labels: every QT gets the `quick-task` type label.
    expect(input?.labelIds).toEqual(expect.arrayContaining(['label-uuid-1']));
    // Title no longer includes the QT-XXX prefix — just the clean title.
    expect(input?.title).toBe('QT-007 title');
    // Description includes our task checkboxes (parsed + re-rendered).
    expect(String(input?.description)).toContain('- [ ] **1.0** First task');
    expect(String(input?.description)).toContain('  - [x] 1.1 Subtask done');
  });

  it('updates (not creates) on re-run', async () => {
    // Pre-seed with an existing linearIssueId.
    rmSync(join(projectDir, '.planr', 'quick'), { recursive: true });
    await ensureDir(join(projectDir, '.planr', 'quick'));
    await writeQuickTask(projectDir, 'QT-007', {
      linearIssueId: '9b2f4c3e-1234-4abc-89de-0123456789ab',
    });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'QT-007');
    expect(fake.calls.createIssue).not.toHaveBeenCalled();
    expect(fake.calls.updateIssue).toHaveBeenCalledTimes(1);
  });

  it('writes linearIssueId back to QT frontmatter', async () => {
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'QT-007');
    const raw = readFileSync(join(projectDir, '.planr', 'quick', 'QT-007-test.md'), 'utf-8');
    expect(raw).toContain('linearIssueId:');
    expect(raw).toContain('linearIssueUrl:');
  });

  it('pushes the full markdown body (prose + checkboxes + sub-headings), not just checkboxes', async () => {
    // Simulate a QT with prose sections alongside the checkbox list — the
    // previous push dropped everything that wasn't a checkbox line.
    rmSync(join(projectDir, '.planr', 'quick'), { recursive: true });
    await ensureDir(join(projectDir, '.planr', 'quick'));
    await writeFile(
      join(projectDir, '.planr', 'quick', 'QT-007-prose.md'),
      `---\nid: "QT-007"\ntitle: "QT-007 title"\nstatus: "pending"\n---\n\n# QT-007: QT-007 title\n\n## Context\n\nBackground prose that describes why this matters.\n\n## Tasks\n\n- [ ] **1.0** Do the thing\n\n## Notes\n\nExtra notes that must land in Linear.\n`,
    );
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'QT-007');
    const input = fake.lastIssueInput();
    const description = String(input?.description);
    expect(description).toContain('## Context');
    expect(description).toContain('Background prose');
    expect(description).toContain('- [ ] **1.0** Do the thing');
    expect(description).toContain('## Notes');
    expect(description).toContain('Extra notes that must land in Linear.');
    // Top-level `# QT-007: title` heading is stripped — Linear shows the
    // title in its own field, so repeating it in the description is noise.
    expect(description).not.toMatch(/^#\s+QT-007:/m);
  });
});

describe('runLinearPush — BL push', () => {
  let projectDir: string;
  let config: OpenPlanrConfig;
  beforeEach(async () => {
    const p = await setupProject(true);
    projectDir = p.dir;
    config = p.config;
    await writeBacklogItem(projectDir, 'BL-001');
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('ensures a `backlog` team label and attaches it to the created issue', async () => {
    const fake = makeFakeClient();
    const plan = await runLinearPush(projectDir, config, fake.client, 'BL-001');
    expect(plan?.scope).toBe('backlog');
    expect(fake.calls.issueLabels).toHaveBeenCalled(); // label lookup fires first
    expect(fake.calls.createIssueLabel).toHaveBeenCalledTimes(1); // the backlog type label
    expect(fake.calls.createIssue).toHaveBeenCalledTimes(1);
    const input = fake.lastIssueInput();
    expect(input?.projectId).toBe('9b2f4c3e-1234-4abc-89de-0123456789ab');
    expect(input?.labelIds).toEqual(expect.arrayContaining(['label-uuid-1']));
    // Title no longer includes the BL-XXX prefix.
    expect(input?.title).toBe('BL-001 title');
    // Body includes priority + tags + description.
    expect(String(input?.description)).toContain('**Priority:** high');
    expect(String(input?.description)).toContain('**Tags:** feature, dx');
  });

  it('re-run is idempotent (update + label already exists)', async () => {
    rmSync(join(projectDir, '.planr', 'backlog'), { recursive: true });
    await ensureDir(join(projectDir, '.planr', 'backlog'));
    await writeBacklogItem(projectDir, 'BL-001', {
      linearIssueId: '9b2f4c3e-1234-4abc-89de-0123456789ab',
    });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'BL-001');
    expect(fake.calls.createIssue).not.toHaveBeenCalled();
    expect(fake.calls.updateIssue).toHaveBeenCalledTimes(1);
  });
});

describe('runLinearPush — standalone-project config missing', () => {
  let projectDir: string;
  let config: OpenPlanrConfig;
  beforeEach(async () => {
    const p = await setupProject(false); // no standaloneProjectId
    projectDir = p.dir;
    config = p.config;
    await writeQuickTask(projectDir, 'QT-007');
    await writeBacklogItem(projectDir, 'BL-001');
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('QT push errors with an actionable message; zero API calls', async () => {
    const fake = makeFakeClient();
    await expect(runLinearPush(projectDir, config, fake.client, 'QT-007')).rejects.toThrow(
      /standaloneProjectId/,
    );
    expect(fake.calls.createIssue).not.toHaveBeenCalled();
  });

  it('BL push errors with an actionable message; zero API calls', async () => {
    const fake = makeFakeClient();
    await expect(runLinearPush(projectDir, config, fake.client, 'BL-001')).rejects.toThrow(
      /standaloneProjectId/,
    );
    expect(fake.calls.createIssue).not.toHaveBeenCalled();
    expect(fake.calls.createIssueLabel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Status → stateId push coverage for QT and BL
// ---------------------------------------------------------------------------

const STATE_UUIDS = {
  todo: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  inProgress: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  done: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
  closed: 'dddddddd-dddd-4ddd-dddd-dddddddddddd',
} as const;

function configWithStates(): OpenPlanrConfig {
  return {
    ...baseConfig(true),
    linear: {
      ...baseConfig(true).linear,
      pushStateIds: {
        pending: STATE_UUIDS.todo,
        'in-progress': STATE_UUIDS.inProgress,
        done: STATE_UUIDS.done,
        open: STATE_UUIDS.todo,
        closed: STATE_UUIDS.closed,
      },
    },
  };
}

describe('runLinearPush — QT status → Linear stateId', () => {
  let projectDir: string;
  beforeEach(async () => {
    const p = await setupProject(true);
    projectDir = p.dir;
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('sends stateId on create when local status matches pushStateIds', async () => {
    const config = configWithStates();
    await writeQuickTask(projectDir, 'QT-030', { status: 'in-progress' });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'QT-030');
    expect(fake.lastIssueInput()?.stateId).toBe(STATE_UUIDS.inProgress);
  });

  it('sends stateId on update when local status matches pushStateIds', async () => {
    const config = configWithStates();
    await writeQuickTask(projectDir, 'QT-031', {
      status: 'done',
      linearIssueId: '9b2f4c3e-1234-4abc-89de-000000000001',
    });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'QT-031');
    expect(fake.calls.updateIssue).toHaveBeenCalledTimes(1);
    const updateArgs = fake.calls.updateIssue.mock.calls[0];
    expect(updateArgs[1]?.stateId).toBe(STATE_UUIDS.done);
  });

  it('resolves "completed" alias to the done stateId (Linear-native vocabulary)', async () => {
    const config = configWithStates();
    await writeQuickTask(projectDir, 'QT-032', { status: 'completed' });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'QT-032');
    expect(fake.lastIssueInput()?.stateId).toBe(STATE_UUIDS.done);
  });

  it('omits stateId on create when pushStateIds is not configured', async () => {
    const config = baseConfig(true); // no pushStateIds
    await writeQuickTask(projectDir, 'QT-033', { status: 'in-progress' });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'QT-033');
    expect(fake.lastIssueInput()?.stateId).toBeUndefined();
  });

  it('omits stateId on update when pushStateIds is not configured', async () => {
    // Regression: Linear's API rejects `stateId: null` on update with
    // InvalidInput. The field must be absent entirely so the issue keeps
    // whatever state it already has.
    const config = baseConfig(true);
    await writeQuickTask(projectDir, 'QT-034', {
      status: 'in-progress',
      linearIssueId: '9b2f4c3e-1234-4abc-89de-000000000002',
    });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'QT-034');
    const updateArgs = fake.calls.updateIssue.mock.calls[0];
    expect(updateArgs[1]).not.toHaveProperty('stateId');
  });
});

describe('runLinearPush — BL status → Linear stateId', () => {
  let projectDir: string;
  beforeEach(async () => {
    const p = await setupProject(true);
    projectDir = p.dir;
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('sends stateId on create when BL status key is in pushStateIds', async () => {
    const config = configWithStates();
    await writeBacklogItem(projectDir, 'BL-030', { status: 'closed' });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'BL-030');
    expect(fake.lastIssueInput()?.stateId).toBe(STATE_UUIDS.closed);
  });

  it('omits stateId on create when BL key is not in pushStateIds', async () => {
    // `open` is intentionally NOT in this config; BL should still push fine
    // without a stateId (no silent coercion into task vocabulary).
    const config = {
      ...baseConfig(true),
      linear: {
        ...baseConfig(true).linear,
        pushStateIds: {
          // Only task keys — no `open` mapping. BL push must not pick up
          // `pushStateIds.pending` by accident.
          pending: STATE_UUIDS.todo,
          done: STATE_UUIDS.done,
        },
      },
    } satisfies OpenPlanrConfig;
    await writeBacklogItem(projectDir, 'BL-031', { status: 'open' });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'BL-031');
    expect(fake.lastIssueInput()?.stateId).toBeUndefined();
  });

  it('sends stateId on update when BL status maps to pushStateIds', async () => {
    const config = configWithStates();
    await writeBacklogItem(projectDir, 'BL-032', {
      status: 'closed',
      linearIssueId: '9b2f4c3e-1234-4abc-89de-000000000003',
    });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'BL-032');
    const updateArgs = fake.calls.updateIssue.mock.calls[0];
    expect(updateArgs[1]?.stateId).toBe(STATE_UUIDS.closed);
  });

  it('omits stateId on update when BL pushStateIds is not configured (Linear rejects null)', async () => {
    // Regression: re-pushing BL-020 after the first successful push hit
    // `InvalidInput: stateId should not be null` because we were sending
    // `stateId: null`. Linear requires the field absent in that case.
    const config = baseConfig(true);
    await writeBacklogItem(projectDir, 'BL-033', {
      status: 'open',
      linearIssueId: '9b2f4c3e-1234-4abc-89de-000000000004',
    });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'BL-033');
    const updateArgs = fake.calls.updateIssue.mock.calls[0];
    expect(updateArgs[1]).not.toHaveProperty('stateId');
  });
});

describe('runLinearPush — zero-config auto-derived stateIds', () => {
  let projectDir: string;
  beforeEach(async () => {
    const p = await setupProject(true);
    projectDir = p.dir;
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  const teamStatesFixture = [
    { id: 'st-backlog-uuid', name: 'Backlog', type: 'backlog' },
    { id: 'st-todo-uuid', name: 'Todo', type: 'unstarted' },
    { id: 'st-inprog-uuid', name: 'In Progress', type: 'started' },
    { id: 'st-done-uuid', name: 'Done', type: 'completed' },
    { id: 'st-canceled-uuid', name: 'Canceled', type: 'canceled' },
  ];

  it('QT status "done" auto-resolves to the team\'s completed state when pushStateIds is missing', async () => {
    // This closes the zero-config UX cliff: a fresh project with no
    // pushStateIds config still gets working status sync on push.
    const config = baseConfig(true); // no pushStateIds
    await writeQuickTask(projectDir, 'QT-040', { status: 'done' });
    const fake = makeFakeClient({ teamStates: teamStatesFixture });
    await runLinearPush(projectDir, config, fake.client, 'QT-040');
    expect(fake.lastIssueInput()?.stateId).toBe('st-done-uuid');
    expect(fake.calls.team).toHaveBeenCalledTimes(1);
  });

  it('QT status "in-progress" auto-resolves to the team\'s started state', async () => {
    const config = baseConfig(true);
    await writeQuickTask(projectDir, 'QT-041', { status: 'in-progress' });
    const fake = makeFakeClient({ teamStates: teamStatesFixture });
    await runLinearPush(projectDir, config, fake.client, 'QT-041');
    expect(fake.lastIssueInput()?.stateId).toBe('st-inprog-uuid');
  });

  it('QT "completed" alias still resolves through auto-map (alias → done → completed type)', async () => {
    const config = baseConfig(true);
    await writeQuickTask(projectDir, 'QT-042', { status: 'completed' });
    const fake = makeFakeClient({ teamStates: teamStatesFixture });
    await runLinearPush(projectDir, config, fake.client, 'QT-042');
    expect(fake.lastIssueInput()?.stateId).toBe('st-done-uuid');
  });

  it('BL status "closed" auto-resolves to the team\'s completed state', async () => {
    const config = baseConfig(true);
    await writeBacklogItem(projectDir, 'BL-040', { status: 'closed' });
    const fake = makeFakeClient({ teamStates: teamStatesFixture });
    await runLinearPush(projectDir, config, fake.client, 'BL-040');
    expect(fake.lastIssueInput()?.stateId).toBe('st-done-uuid');
  });

  it('BL status "open" auto-resolves to the team\'s backlog state (preferred over unstarted)', async () => {
    const config = baseConfig(true);
    await writeBacklogItem(projectDir, 'BL-041', { status: 'open' });
    const fake = makeFakeClient({ teamStates: teamStatesFixture });
    await runLinearPush(projectDir, config, fake.client, 'BL-041');
    expect(fake.lastIssueInput()?.stateId).toBe('st-backlog-uuid');
  });

  it('user pushStateIds override the auto-derived defaults', async () => {
    // pushStateIds.done points at a DIFFERENT uuid than the team's completed
    // state; the explicit config must win.
    const configOverride: OpenPlanrConfig = {
      ...baseConfig(true),
      linear: {
        ...baseConfig(true).linear,
        pushStateIds: {
          done: 'user-override-uuid',
        },
      },
    };
    await writeQuickTask(projectDir, 'QT-043', { status: 'done' });
    const fake = makeFakeClient({ teamStates: teamStatesFixture });
    await runLinearPush(projectDir, configOverride, fake.client, 'QT-043');
    expect(fake.lastIssueInput()?.stateId).toBe('user-override-uuid');
  });

  it('push still succeeds when the team-states fetch throws (graceful degradation)', async () => {
    // Simulate a Linear API error on team.states() — push must continue;
    // stateId is simply omitted (back to pre-status-sync behavior).
    const config = baseConfig(true);
    await writeQuickTask(projectDir, 'QT-044', { status: 'done' });
    const fake = makeFakeClient({ teamStates: teamStatesFixture });
    (fake.client.team as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error('Network error');
    });
    await runLinearPush(projectDir, config, fake.client, 'QT-044');
    expect(fake.lastIssueInput()?.stateId).toBeUndefined();
    expect(fake.calls.createIssue).toHaveBeenCalledTimes(1);
  });
});
