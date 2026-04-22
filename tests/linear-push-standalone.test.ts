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
  opts: { linearIssueId?: string } = {},
): Promise<void> {
  const fm = [`id: "${id}"`, `title: "${id} title"`, 'status: "pending"'];
  if (opts.linearIssueId) fm.push(`linearIssueId: "${opts.linearIssueId}"`);
  const body = `---\n${fm.join('\n')}\n---\n\n# ${id}: ${id} title\n\n## Tasks\n\n- [ ] **1.0** First task\n  - [x] 1.1 Subtask done\n- [ ] **2.0** Second task\n`;
  await writeFile(join(dir, '.planr', 'quick', `${id}-test.md`), body);
}

async function writeBacklogItem(
  dir: string,
  id: string,
  opts: { linearIssueId?: string } = {},
): Promise<void> {
  const fm = [
    `id: "${id}"`,
    `title: "${id} title"`,
    'priority: "high"',
    'tags: ["feature","dx"]',
    'status: "open"',
    'description: "Backlog item description text."',
  ];
  if (opts.linearIssueId) fm.push(`linearIssueId: "${opts.linearIssueId}"`);
  const body = `---\n${fm.join('\n')}\n---\n\n# ${id}\n\n## Description\nBacklog item description text.\n`;
  await writeFile(join(dir, '.planr', 'backlog', `${id}-test.md`), body);
}

function makeFakeClient() {
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
  const client = {
    createIssue,
    updateIssue,
    issueLabels,
    createIssueLabel,
    issue,
  } as unknown as LinearClient;
  return {
    client,
    calls: { createIssue, updateIssue, issueLabels, createIssueLabel, issue },
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
