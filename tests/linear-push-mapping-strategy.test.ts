/**
 * Mapping-strategy tests (Phase 2 of EPIC-LINEAR-GRANULAR-PUSH).
 *
 * Locks in:
 *   - `project` strategy preserves v1 behavior (createProject + descendants).
 *   - `milestone-of:<projectId>` creates a ProjectMilestone once + propagates
 *     `projectMilestoneId` to every descendant issue.
 *   - `label-on:<projectId>` ensures a team label once + propagates `labelIds`
 *     to every descendant issue (merged, not stomped).
 *   - Re-running `milestone-of` against a stored epic is idempotent (no new
 *     createProjectMilestone call).
 *   - Attempting to restrategize (`--as label-on:X` on a project-mapped epic)
 *     errors with a "Phase 5" pointer rather than silently migrating.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LinearClient } from '@linear/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenPlanrConfig } from '../src/models/types.js';
import { runLinearPush } from '../src/services/linear-push-service.js';
import { ensureDir, writeFile } from '../src/utils/fs.js';

// ---------------------------------------------------------------------------
// Fixtures (copied from granular test — lightweight, no shared mutable state).
// ---------------------------------------------------------------------------

function baseConfig(): OpenPlanrConfig {
  return {
    projectName: 'strategy-push-test',
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
      spec: 'SPEC',
    },
    createdAt: '2026-04-22',
    linear: { teamId: 'team-uuid-abc' },
  };
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

async function writeFeature(dir: string, id: string, epicId: string): Promise<void> {
  const body = `---\nid: "${id}"\ntitle: "${id} title"\nepicId: "${epicId}"\nstatus: "planning"\n---\n\n# ${id}\n\n## Overview\nText.\n`;
  await writeFile(join(dir, '.planr', 'features', `${id}-test.md`), body);
}

async function writeStory(dir: string, id: string, featureId: string): Promise<void> {
  const body = `---\nid: "${id}"\ntitle: "${id} title"\nfeatureId: "${featureId}"\nstatus: "planning"\n---\n\n# ${id}\n\n## User Story\nAs a dev I want X so that Y.\n\n## Acceptance Criteria\n- a\n`;
  await writeFile(join(dir, '.planr', 'stories', `${id}-test.md`), body);
}

interface FakeLinearClient {
  client: LinearClient;
  calls: {
    createProject: ReturnType<typeof vi.fn>;
    createProjectMilestone: ReturnType<typeof vi.fn>;
    createIssueLabel: ReturnType<typeof vi.fn>;
    issueLabels: ReturnType<typeof vi.fn>;
    createIssue: ReturnType<typeof vi.fn>;
    updateIssue: ReturnType<typeof vi.fn>;
    issue: ReturnType<typeof vi.fn>;
    project: ReturnType<typeof vi.fn>;
  };
  /** Grab the payload the push service passed to createIssue (for assertions). */
  createIssueInputs(): Array<Record<string, unknown>>;
}

function makeFakeClient(opts?: { labelAlreadyExists?: boolean }): FakeLinearClient {
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
  const createIssueLabel = vi.fn(async () => {
    labelCounter += 1;
    return { success: true, issueLabelId: `label-uuid-${labelCounter}` };
  });
  const issueLabels = vi.fn(async () => ({
    nodes: opts?.labelAlreadyExists ? [{ id: 'label-uuid-preexisting', name: 'preexisting' }] : [],
  }));
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
    createIssueLabel,
    issueLabels,
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
      createIssueLabel,
      issueLabels,
      createIssue,
      updateIssue,
      issue,
      project,
    },
    createIssueInputs: () => issueInputs,
  };
}

async function setupProject(): Promise<{ dir: string; config: OpenPlanrConfig }> {
  const dir = mkdtempSync(join(tmpdir(), 'planr-strategy-'));
  const config = baseConfig();
  await ensureDir(join(dir, '.planr', 'epics'));
  await ensureDir(join(dir, '.planr', 'features'));
  await ensureDir(join(dir, '.planr', 'stories'));
  await ensureDir(join(dir, '.planr', 'tasks'));
  await writeFile(join(dir, '.planr', 'config.json'), JSON.stringify(config, null, 2));
  return { dir, config };
}

// ---------------------------------------------------------------------------

describe('Epic push — project strategy (default, v1)', () => {
  let projectDir: string;
  let config: OpenPlanrConfig;
  beforeEach(async () => {
    const p = await setupProject();
    projectDir = p.dir;
    config = p.config;
    await writeEpic(projectDir, 'EPIC-001');
    await writeFeature(projectDir, 'FEAT-001', 'EPIC-001');
    await writeStory(projectDir, 'US-001', 'FEAT-001');
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('project strategy: creates one Linear project + descendants; no milestone/label calls', async () => {
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'EPIC-001', {
      strategyOverride: { strategy: 'project' },
    });
    expect(fake.calls.createProject).toHaveBeenCalledTimes(1);
    expect(fake.calls.createProjectMilestone).not.toHaveBeenCalled();
    // One feature + one story issue.
    expect(fake.calls.createIssue).toHaveBeenCalledTimes(2);
    // Type labels (`feature`, `story`) are always ensured — but no epic/milestone attribute.
    for (const input of fake.createIssueInputs()) {
      expect(input.projectMilestoneId).toBeUndefined();
      // Every issue carries exactly one label: its type label.
      expect((input.labelIds as string[])?.length).toBe(1);
    }
  });
});

describe('Epic push — milestone-of strategy', () => {
  let projectDir: string;
  let config: OpenPlanrConfig;
  beforeEach(async () => {
    const p = await setupProject();
    projectDir = p.dir;
    config = p.config;
    await writeEpic(projectDir, 'EPIC-001');
    await writeFeature(projectDir, 'FEAT-001', 'EPIC-001');
    await writeStory(projectDir, 'US-001', 'FEAT-001');
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('creates a milestone in the target project; descendants carry projectMilestoneId', async () => {
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'EPIC-001', {
      strategyOverride: { strategy: 'milestone-of', targetProjectId: 'existing-proj-1' },
    });
    // Milestone is created; Linear project is NOT (we're attaching into an existing project).
    expect(fake.calls.createProject).not.toHaveBeenCalled();
    expect(fake.calls.createProjectMilestone).toHaveBeenCalledTimes(1);
    // Each descendant issue was told its milestone.
    for (const input of fake.createIssueInputs()) {
      expect(input.projectMilestoneId).toBe('milestone-uuid-1');
    }
  });

  it('re-run with a stored milestone is idempotent (no new createProjectMilestone call)', async () => {
    // Pre-seed epic as already mapped under milestone-of.
    rmSync(join(projectDir, '.planr', 'epics'), { recursive: true });
    await ensureDir(join(projectDir, '.planr', 'epics'));
    await writeEpic(projectDir, 'EPIC-001', {
      linearProjectId: 'existing-proj-1',
      linearMappingStrategy: 'milestone-of',
      linearMilestoneId: 'preexisting-milestone',
    });
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'EPIC-001');
    expect(fake.calls.createProjectMilestone).not.toHaveBeenCalled();
    // Descendants still carry the stored milestone id.
    for (const input of fake.createIssueInputs()) {
      expect(input.projectMilestoneId).toBe('preexisting-milestone');
    }
  });
});

describe('Epic push — label-on strategy', () => {
  let projectDir: string;
  let config: OpenPlanrConfig;
  beforeEach(async () => {
    const p = await setupProject();
    projectDir = p.dir;
    config = p.config;
    await writeEpic(projectDir, 'EPIC-001');
    await writeFeature(projectDir, 'FEAT-001', 'EPIC-001');
    await writeStory(projectDir, 'US-001', 'FEAT-001');
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('ensures a team label; descendants carry labelIds containing the epic label', async () => {
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'EPIC-001', {
      strategyOverride: { strategy: 'label-on', targetProjectId: 'existing-proj-1' },
    });
    expect(fake.calls.createProject).not.toHaveBeenCalled();
    expect(fake.calls.createProjectMilestone).not.toHaveBeenCalled();
    // issueLabels is queried (once per distinct label: the epic label + each type label).
    expect(fake.calls.issueLabels).toHaveBeenCalled();
    // Every descendant issue carries the epic label plus its type label.
    for (const input of fake.createIssueInputs()) {
      const labelIds = input.labelIds as string[];
      expect(labelIds.length).toBeGreaterThanOrEqual(2); // type label + epic label
      // One of the label uuids is the epic label — created first (label-uuid-1).
      expect(labelIds).toContain('label-uuid-1');
    }
  });

  it('reuses an existing team label when one matches by name (idempotent)', async () => {
    const fake = makeFakeClient({ labelAlreadyExists: true });
    await runLinearPush(projectDir, config, fake.client, 'EPIC-001', {
      strategyOverride: { strategy: 'label-on', targetProjectId: 'existing-proj-1' },
    });
    // No new labels were created — everything existed already (the fake returns
    // `label-uuid-preexisting` for every lookup).
    expect(fake.calls.createIssueLabel).not.toHaveBeenCalled();
    for (const input of fake.createIssueInputs()) {
      expect(input.labelIds).toEqual(['label-uuid-preexisting']);
    }
  });
});

describe('Epic push — restrategize guard (Phase 5 is out of scope)', () => {
  let projectDir: string;
  let config: OpenPlanrConfig;
  beforeEach(async () => {
    const p = await setupProject();
    projectDir = p.dir;
    config = p.config;
    await writeEpic(projectDir, 'EPIC-001', {
      linearProjectId: 'existing-proj-1',
      linearMappingStrategy: 'project',
    });
    await writeFeature(projectDir, 'FEAT-001', 'EPIC-001');
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('errors when --as picks a different strategy than the epic already has stored', async () => {
    const fake = makeFakeClient();
    await expect(
      runLinearPush(projectDir, config, fake.client, 'EPIC-001', {
        strategyOverride: { strategy: 'label-on', targetProjectId: 'existing-proj-1' },
      }),
    ).rejects.toThrow(/already mapped as 'project'/);
    // Nothing was called.
    expect(fake.calls.createProject).not.toHaveBeenCalled();
    expect(fake.calls.createIssueLabel).not.toHaveBeenCalled();
    expect(fake.calls.createIssue).not.toHaveBeenCalled();
  });
});
