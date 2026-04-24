/**
 * Epic-linked QT / BL tests.
 *
 * Locks in the behavior the user requested after hitting three gaps:
 *   - A QT/BL with `epicId: "EPIC-XXX"` (or `parentEpic` for compat) pushed
 *     directly inherits the epic's Linear container (project + milestone /
 *     label propagation). It does NOT go to the standalone project.
 *   - Missing `standaloneProjectId` is OK when epicId is set (Gap C fallout).
 *   - Epic-scope push cascades to every linked QT/BL under the epic.
 *   - Unlinked QTs/BLs keep the standalone-project behavior (regression gate).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LinearClient } from '@linear/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenPlanrConfig } from '../src/models/types.js';
import { buildLinearPushPlan, runLinearPush } from '../src/services/linear-push-service.js';
import { ensureDir, writeFile } from '../src/utils/fs.js';

function baseConfig(withStandalone = false): OpenPlanrConfig {
  return {
    projectName: 'epic-linked-qtbl-test',
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
            standaloneProjectName: 'Planr Standalone',
          }
        : {}),
    },
  };
}

async function setupProject(withStandalone = false): Promise<{
  dir: string;
  config: OpenPlanrConfig;
}> {
  const dir = mkdtempSync(join(tmpdir(), 'planr-epic-qt-'));
  const config = baseConfig(withStandalone);
  await ensureDir(join(dir, '.planr', 'epics'));
  await ensureDir(join(dir, '.planr', 'features'));
  await ensureDir(join(dir, '.planr', 'stories'));
  await ensureDir(join(dir, '.planr', 'tasks'));
  await ensureDir(join(dir, '.planr', 'quick'));
  await ensureDir(join(dir, '.planr', 'backlog'));
  await writeFile(join(dir, '.planr', 'config.json'), JSON.stringify(config, null, 2));
  return { dir, config };
}

async function writeEpic(
  dir: string,
  id: string,
  opts: {
    linearProjectId?: string;
    linearMappingStrategy?: string;
    linearMilestoneId?: string;
    linearLabelId?: string;
  } = {},
): Promise<void> {
  const fm = [`id: "${id}"`, `title: "${id} title"`, 'status: "planning"'];
  if (opts.linearProjectId) fm.push(`linearProjectId: "${opts.linearProjectId}"`);
  if (opts.linearMappingStrategy) fm.push(`linearMappingStrategy: "${opts.linearMappingStrategy}"`);
  if (opts.linearMilestoneId) fm.push(`linearMilestoneId: "${opts.linearMilestoneId}"`);
  if (opts.linearLabelId) fm.push(`linearLabelId: "${opts.linearLabelId}"`);
  const body = `---\n${fm.join('\n')}\n---\n\n# ${id}\n\n## Overview\nText.\n`;
  await writeFile(join(dir, '.planr', 'epics', `${id}-test.md`), body);
}

async function writeQuick(
  dir: string,
  id: string,
  opts: { epicId?: string; parentEpic?: string; linearIssueId?: string } = {},
): Promise<void> {
  const fm = [`id: "${id}"`, `title: "${id} title"`, 'status: "pending"'];
  if (opts.epicId) fm.push(`epicId: "${opts.epicId}"`);
  if (opts.parentEpic) fm.push(`parentEpic: "${opts.parentEpic}"`);
  if (opts.linearIssueId) fm.push(`linearIssueId: "${opts.linearIssueId}"`);
  const body = `---\n${fm.join('\n')}\n---\n\n# ${id}\n\n## Tasks\n\n- [ ] **1.0** Do thing\n`;
  await writeFile(join(dir, '.planr', 'quick', `${id}-test.md`), body);
}

async function writeBacklog(
  dir: string,
  id: string,
  opts: { epicId?: string; linearIssueId?: string } = {},
): Promise<void> {
  const fm = [
    `id: "${id}"`,
    `title: "${id} title"`,
    'priority: "medium"',
    'tags: ["feature"]',
    'status: "open"',
    'description: "BL description."',
  ];
  if (opts.epicId) fm.push(`epicId: "${opts.epicId}"`);
  if (opts.linearIssueId) fm.push(`linearIssueId: "${opts.linearIssueId}"`);
  const body = `---\n${fm.join('\n')}\n---\n\n# ${id}\n\n## Description\nBL description.\n`;
  await writeFile(join(dir, '.planr', 'backlog', `${id}-test.md`), body);
}

function makeFakeClient() {
  let projectCounter = 0;
  let milestoneCounter = 0;
  let labelCounter = 0;
  let issueCounter = 0;
  const issueInputs: Array<Record<string, unknown>> = [];
  const createProject = vi.fn(async () => {
    projectCounter += 1;
    return { success: true, projectId: `proj-uuid-${projectCounter}` };
  });
  const createProjectMilestone = vi.fn(async () => {
    milestoneCounter += 1;
    return { success: true, projectMilestoneId: `milestone-uuid-${milestoneCounter}` };
  });
  const issueLabels = vi.fn(async () => ({ nodes: [] }));
  const createIssueLabel = vi.fn(async () => {
    labelCounter += 1;
    return { success: true, issueLabelId: `label-uuid-${labelCounter}` };
  });
  const createIssue = vi.fn(async (input: Record<string, unknown>) => {
    issueCounter += 1;
    issueInputs.push(input);
    return { success: true, issueId: `issue-uuid-${issueCounter}` };
  });
  const updateIssue = vi.fn(async () => ({ success: true }));
  const issue = vi.fn(async (id: string) => ({
    id,
    identifier: `ENG-${id.replace(/\D/g, '') || '0'}`,
    url: `https://linear.app/test/issue/${id}`,
    labelIds: [] as string[],
  }));
  const project = vi.fn(async (id: string) => ({
    id,
    slugId: `slug-${id}`,
    name: `Project ${id}`,
    url: `https://linear.app/test/project/${id}`,
  }));
  const client = {
    createProject,
    createProjectMilestone,
    issueLabels,
    createIssueLabel,
    createIssue,
    updateIssue,
    issue,
    project,
  } as unknown as LinearClient;
  return {
    client,
    calls: {
      createProject,
      createProjectMilestone,
      issueLabels,
      createIssueLabel,
      createIssue,
      updateIssue,
      issue,
      project,
    },
    issueInputs: () => issueInputs,
  };
}

// ---------------------------------------------------------------------------

describe('Epic-linked QT push', () => {
  let projectDir: string;
  let config: OpenPlanrConfig;

  beforeEach(async () => {
    const p = await setupProject(false); // deliberately no standaloneProjectId
    projectDir = p.dir;
    config = p.config;
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('QT with epicId + epic mapped as project → issue in epic project, no standalone project needed', async () => {
    await writeEpic(projectDir, 'EPIC-001', {
      linearProjectId: 'epic-project-uuid',
      linearMappingStrategy: 'project',
    });
    await writeQuick(projectDir, 'QT-100', { epicId: 'EPIC-001' });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'QT-100');
    expect(fake.calls.createIssue).toHaveBeenCalledTimes(1);
    const input = fake.issueInputs()[0];
    expect(input.projectId).toBe('epic-project-uuid');
    expect(input.projectMilestoneId).toBeUndefined();
    // Every issue gets its type label auto-applied — for QT that's `quick-task`.
    expect((input.labelIds as string[])?.length).toBe(1);
  });

  it('QT with epicId + epic mapped milestone-of → issue carries projectMilestoneId', async () => {
    await writeEpic(projectDir, 'EPIC-001', {
      linearProjectId: 'existing-proj',
      linearMappingStrategy: 'milestone-of',
      linearMilestoneId: 'milestone-uuid-preset',
    });
    await writeQuick(projectDir, 'QT-100', { epicId: 'EPIC-001' });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'QT-100');
    expect(fake.calls.createIssue).toHaveBeenCalledTimes(1);
    const input = fake.issueInputs()[0];
    expect(input.projectId).toBe('existing-proj');
    expect(input.projectMilestoneId).toBe('milestone-uuid-preset');
  });

  it('QT with epicId + epic mapped label-on → issue carries labelIds', async () => {
    await writeEpic(projectDir, 'EPIC-001', {
      linearProjectId: 'existing-proj',
      linearMappingStrategy: 'label-on',
      linearLabelId: 'label-uuid-preset',
    });
    await writeQuick(projectDir, 'QT-100', { epicId: 'EPIC-001' });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'QT-100');
    expect(fake.calls.createIssue).toHaveBeenCalledTimes(1);
    const input = fake.issueInputs()[0];
    expect(input.projectId).toBe('existing-proj');
    // Epic label is merged with the QT's type label.
    expect(input.labelIds as string[]).toContain('label-uuid-preset');
    expect((input.labelIds as string[])?.length).toBeGreaterThanOrEqual(2);
  });

  it('QT with `parentEpic` (legacy field) is treated the same as `epicId`', async () => {
    await writeEpic(projectDir, 'EPIC-001', {
      linearProjectId: 'existing-proj',
      linearMappingStrategy: 'milestone-of',
      linearMilestoneId: 'milestone-uuid-preset',
    });
    await writeQuick(projectDir, 'QT-100', { parentEpic: 'EPIC-001' });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'QT-100');
    const input = fake.issueInputs()[0];
    expect(input.projectMilestoneId).toBe('milestone-uuid-preset');
  });

  it('QT with epicId + epic NOT mapped + no --push-parents → throws, zero API calls', async () => {
    await writeEpic(projectDir, 'EPIC-001'); // no linearProjectId
    await writeQuick(projectDir, 'QT-100', { epicId: 'EPIC-001' });
    const fake = makeFakeClient();
    await expect(runLinearPush(projectDir, config, fake.client, 'QT-100')).rejects.toThrow(
      /not been pushed to Linear yet/,
    );
    expect(fake.calls.createIssue).not.toHaveBeenCalled();
  });

  it('QT with epicId + epic NOT mapped + --push-parents → cascades to epic push', async () => {
    await writeEpic(projectDir, 'EPIC-001');
    await writeQuick(projectDir, 'QT-100', { epicId: 'EPIC-001' });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'QT-100', {
      pushParents: true,
      strategyOverride: { strategy: 'project' },
    });
    // Epic push created a Linear project and cascaded to the linked QT.
    expect(fake.calls.createProject).toHaveBeenCalledTimes(1);
    expect(fake.calls.createIssue).toHaveBeenCalledTimes(1);
  });

  it('QT without epicId + no standaloneProjectId → actionable error', async () => {
    await writeQuick(projectDir, 'QT-100');
    const fake = makeFakeClient();
    await expect(runLinearPush(projectDir, config, fake.client, 'QT-100')).rejects.toThrow(
      /standaloneProjectId/,
    );
    expect(fake.calls.createIssue).not.toHaveBeenCalled();
  });

  it('QT with empty frontmatter (broken file) throws pre-flight, zero API calls', async () => {
    // Simulate a QT file whose frontmatter block is malformed enough that the
    // parser returns empty data (e.g. no closing `---`). This would previously
    // slip through and create a Linear issue titled "QT-100" with no body.
    await writeFile(
      join(projectDir, '.planr', 'quick', 'QT-100-broken.md'),
      '---\nbroken: no closing delimiter\n# QT-100: some header\n',
    );
    const fake = makeFakeClient();
    await expect(runLinearPush(projectDir, config, fake.client, 'QT-100')).rejects.toThrow(
      /no `title` field in its frontmatter/,
    );
    expect(fake.calls.createIssue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('Epic-linked BL push', () => {
  let projectDir: string;
  let config: OpenPlanrConfig;

  beforeEach(async () => {
    const p = await setupProject(false);
    projectDir = p.dir;
    config = p.config;
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('BL with epicId + label-on strategy → labelIds contains BOTH backlog + epic label', async () => {
    await writeEpic(projectDir, 'EPIC-001', {
      linearProjectId: 'existing-proj',
      linearMappingStrategy: 'label-on',
      linearLabelId: 'epic-label-uuid',
    });
    await writeBacklog(projectDir, 'BL-100', { epicId: 'EPIC-001' });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'BL-100');
    // Two labels get created: the epic label (via ensureIssueLabel in pushEpicScope…
    // actually no, epic is already mapped, so we don't re-create) + the `backlog` type label.
    // Since the epic is already label-on mapped with `epic-label-uuid`, only the type
    // label gets newly created.
    expect(fake.calls.createIssueLabel).toHaveBeenCalledTimes(1);
    const input = fake.issueInputs()[0];
    expect(input.projectId).toBe('existing-proj');
    const labelIds = input.labelIds as string[];
    // Contains both: the backlog type label (newly created) + the epic label.
    expect(labelIds).toContain('epic-label-uuid');
    expect(labelIds.length).toBeGreaterThanOrEqual(2);
  });

  it('BL with epicId + milestone-of → issue carries projectMilestoneId + backlog label', async () => {
    await writeEpic(projectDir, 'EPIC-001', {
      linearProjectId: 'existing-proj',
      linearMappingStrategy: 'milestone-of',
      linearMilestoneId: 'milestone-uuid-preset',
    });
    await writeBacklog(projectDir, 'BL-100', { epicId: 'EPIC-001' });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'BL-100');
    const input = fake.issueInputs()[0];
    expect(input.projectId).toBe('existing-proj');
    expect(input.projectMilestoneId).toBe('milestone-uuid-preset');
    expect(input.labelIds as string[]).toContain('label-uuid-1'); // backlog label
  });

  it('BL without epicId + no standaloneProjectId → actionable error', async () => {
    await writeBacklog(projectDir, 'BL-100');
    const fake = makeFakeClient();
    await expect(runLinearPush(projectDir, config, fake.client, 'BL-100')).rejects.toThrow(
      /standaloneProjectId/,
    );
    expect(fake.calls.createIssue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('Epic-scope push cascades to linked QT/BL', () => {
  let projectDir: string;
  let config: OpenPlanrConfig;

  beforeEach(async () => {
    const p = await setupProject(false);
    projectDir = p.dir;
    config = p.config;
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('pushing an epic creates project + linked QTs + linked BLs', async () => {
    await writeEpic(projectDir, 'EPIC-001');
    await writeQuick(projectDir, 'QT-100', { epicId: 'EPIC-001' });
    await writeQuick(projectDir, 'QT-101', { parentEpic: 'EPIC-001' });
    await writeQuick(projectDir, 'QT-200'); // unlinked — should NOT cascade
    await writeBacklog(projectDir, 'BL-100', { epicId: 'EPIC-001' });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'EPIC-001', {
      strategyOverride: { strategy: 'project' },
    });
    // 1 epic project + 2 linked QTs + 1 linked BL = 3 issues (QT doesn't use createProject).
    expect(fake.calls.createProject).toHaveBeenCalledTimes(1);
    expect(fake.calls.createIssue).toHaveBeenCalledTimes(3);
    // Type labels get ensured: `quick-task` for QTs + `backlog` for BL (cached per type).
    expect(fake.calls.createIssueLabel).toHaveBeenCalledTimes(2);
  });

  it('dry-run epic plan lists quickTask / backlogItem rows for linked artifacts', async () => {
    await writeEpic(projectDir, 'EPIC-001');
    await writeQuick(projectDir, 'QT-100', { epicId: 'EPIC-001' });
    await writeQuick(projectDir, 'QT-200'); // unlinked
    await writeBacklog(projectDir, 'BL-100', { epicId: 'EPIC-001' });

    const plan = await buildLinearPushPlan(projectDir, config, 'EPIC-001');
    const kinds = plan?.rows.map((r) => r.kind) ?? [];
    expect(kinds).toContain('quickTask');
    expect(kinds).toContain('backlogItem');
    // Unlinked QT-200 must not appear.
    const ids = plan?.rows.map((r) => r.artifactId) ?? [];
    expect(ids).not.toContain('QT-200');
    expect(ids).toContain('QT-100');
    expect(ids).toContain('BL-100');
  });
});
