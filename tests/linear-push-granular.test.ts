/**
 * Granular push tests (Phase 1 of EPIC-LINEAR-GRANULAR-PUSH).
 *
 * These lock in `planr linear push <artifactId>` behavior at each scope:
 *   - Dry-run plans for FEAT-/US-/TASK- ids are correctly scoped (no project row, right row counts).
 *   - The router refuses unsupported prefixes (ADR/SPRINT) and not-yet-supported ones (QT/BL).
 *   - Parent-chain pre-flight fails fast without API calls when `--push-parents` is not set.
 *   - `--push-parents` cascades to the parent scope (observable via fake-client call counts).
 *   - Non-cascading granular pushes touch exactly the expected Linear entities.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LinearClient } from '@linear/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenPlanrConfig } from '../src/models/types.js';
import { buildLinearPushPlan, runLinearPush } from '../src/services/linear-push-service.js';
import { ensureDir, writeFile } from '../src/utils/fs.js';

// ---------------------------------------------------------------------------
// Fixture helpers — lighter than tests/helpers/test-project.ts because we need
// fine-grained control over `linear*` frontmatter per artifact.
// ---------------------------------------------------------------------------

function baseConfig(): OpenPlanrConfig {
  return {
    projectName: 'granular-push-test',
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
    linear: { teamId: 'team-uuid-abc' },
  };
}

async function writeEpic(
  dir: string,
  id: string,
  opts: { linearProjectId?: string } = {},
): Promise<void> {
  const fm = [`id: "${id}"`, `title: "${id} title"`, 'status: "planning"'];
  if (opts.linearProjectId) fm.push(`linearProjectId: "${opts.linearProjectId}"`);
  const body = `---\n${fm.join('\n')}\n---\n\n# ${id}\n\n## Overview\nText.\n`;
  await writeFile(join(dir, '.planr', 'epics', `${id}-test.md`), body);
}

async function writeFeature(
  dir: string,
  id: string,
  epicId: string,
  opts: { linearIssueId?: string } = {},
): Promise<void> {
  const fm = [`id: "${id}"`, `title: "${id} title"`, `epicId: "${epicId}"`, 'status: "planning"'];
  if (opts.linearIssueId) fm.push(`linearIssueId: "${opts.linearIssueId}"`);
  const body = `---\n${fm.join('\n')}\n---\n\n# ${id}\n\n## Overview\nText.\n`;
  await writeFile(join(dir, '.planr', 'features', `${id}-test.md`), body);
}

async function writeStory(
  dir: string,
  id: string,
  featureId: string,
  opts: { linearIssueId?: string } = {},
): Promise<void> {
  const fm = [
    `id: "${id}"`,
    `title: "${id} title"`,
    `featureId: "${featureId}"`,
    'status: "planning"',
  ];
  if (opts.linearIssueId) fm.push(`linearIssueId: "${opts.linearIssueId}"`);
  const body = `---\n${fm.join('\n')}\n---\n\n# ${id}\n\n## User Story\nAs a dev I want X so that Y.\n\n## Acceptance Criteria\n- a\n`;
  await writeFile(join(dir, '.planr', 'stories', `${id}-test.md`), body);
}

async function writeTaskFile(
  dir: string,
  id: string,
  featureId: string,
  opts: { linearIssueId?: string } = {},
): Promise<void> {
  const fm = [`id: "${id}"`, `title: "${id} title"`, `featureId: "${featureId}"`];
  if (opts.linearIssueId) fm.push(`linearIssueId: "${opts.linearIssueId}"`);
  const body = `---\n${fm.join('\n')}\n---\n\n# ${id}\n\n## Tasks\n\n- [ ] **1.0** Task one\n  - [ ] 1.1 Subtask\n- [ ] **2.0** Task two\n`;
  await writeFile(join(dir, '.planr', 'tasks', `${id}-test.md`), body);
}

/**
 * Fake LinearClient with vi.fn() stubs on every method we call from the push
 * service, returning the shape the real SDK does (enough to satisfy the
 * wrappers in `linear-service.ts`). Tracks calls for assertion.
 */
interface FakeLinearClient {
  client: LinearClient;
  calls: {
    createProject: ReturnType<typeof vi.fn>;
    updateProject: ReturnType<typeof vi.fn>;
    createIssue: ReturnType<typeof vi.fn>;
    updateIssue: ReturnType<typeof vi.fn>;
    project: ReturnType<typeof vi.fn>;
    issue: ReturnType<typeof vi.fn>;
  };
}

function makeFakeClient(): FakeLinearClient {
  let projectCounter = 0;
  let issueCounter = 0;
  let labelCounter = 0;
  const createProject = vi.fn(async () => {
    projectCounter += 1;
    return { success: true, projectId: `proj-uuid-${projectCounter}` };
  });
  const updateProject = vi.fn(async () => ({ success: true }));
  const createIssue = vi.fn(async () => {
    issueCounter += 1;
    return { success: true, issueId: `issue-uuid-${issueCounter}` };
  });
  const updateIssue = vi.fn(async () => ({ success: true }));
  const issueLabels = vi.fn(async () => ({ nodes: [] }));
  const createIssueLabel = vi.fn(async () => {
    labelCounter += 1;
    return { success: true, issueLabelId: `label-uuid-${labelCounter}` };
  });
  const project = vi.fn(async (id: string) => ({
    id,
    slugId: `slug-${id}`,
    name: `Project ${id}`,
    url: `https://linear.app/test/project/${id}`,
  }));
  const issue = vi.fn(async (id: string) => ({
    id,
    identifier: `ENG-${id.replace(/\D/g, '') || '0'}`,
    url: `https://linear.app/test/issue/${id}`,
    labelIds: [] as string[],
  }));
  const client = {
    createProject,
    updateProject,
    createIssue,
    updateIssue,
    issueLabels,
    createIssueLabel,
    project,
    issue,
  } as unknown as LinearClient;
  return {
    client,
    calls: { createProject, updateProject, createIssue, updateIssue, project, issue },
  };
}

async function setupProject(): Promise<{ dir: string; config: OpenPlanrConfig }> {
  const dir = mkdtempSync(join(tmpdir(), 'planr-granular-'));
  const config = baseConfig();
  await ensureDir(join(dir, '.planr', 'epics'));
  await ensureDir(join(dir, '.planr', 'features'));
  await ensureDir(join(dir, '.planr', 'stories'));
  await ensureDir(join(dir, '.planr', 'tasks'));
  await writeFile(join(dir, '.planr', 'config.json'), JSON.stringify(config, null, 2));
  return { dir, config };
}

// ---------------------------------------------------------------------------
// Dry-run plan scoping
// ---------------------------------------------------------------------------

describe('buildLinearPushPlan — per-scope plans', () => {
  let projectDir: string;
  let config: OpenPlanrConfig;
  beforeEach(async () => {
    const p = await setupProject();
    projectDir = p.dir;
    config = p.config;
    await writeEpic(projectDir, 'EPIC-001');
    await writeFeature(projectDir, 'FEAT-001', 'EPIC-001');
    await writeStory(projectDir, 'US-001', 'FEAT-001');
    await writeTaskFile(projectDir, 'TASK-001', 'FEAT-001');
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('epic scope: 1 project + 1 feature + 1 story + 1 tasklist (v1 behavior preserved)', async () => {
    const plan = await buildLinearPushPlan(projectDir, config, 'EPIC-001');
    expect(plan).not.toBeNull();
    expect(plan?.scope).toBe('epic');
    expect(plan?.rootArtifactId).toBe('EPIC-001');
    expect(plan?.epicId).toBe('EPIC-001');
    const kinds = plan?.rows.map((r) => r.kind) ?? [];
    expect(kinds).toContain('project');
    expect(kinds).toContain('feature');
    expect(kinds).toContain('story');
    expect(kinds).toContain('taskList');
  });

  it('feature scope: no project row, 1 feature + 1 story + 1 tasklist', async () => {
    const plan = await buildLinearPushPlan(projectDir, config, 'FEAT-001');
    expect(plan).not.toBeNull();
    expect(plan?.scope).toBe('feature');
    expect(plan?.rootArtifactId).toBe('FEAT-001');
    expect(plan?.epicId).toBe('EPIC-001');
    const kinds = plan?.rows.map((r) => r.kind) ?? [];
    expect(kinds).not.toContain('project');
    expect(kinds.filter((k) => k === 'feature')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'story')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'taskList')).toHaveLength(1);
  });

  it('story scope: only a single story row', async () => {
    const plan = await buildLinearPushPlan(projectDir, config, 'US-001');
    expect(plan).not.toBeNull();
    expect(plan?.scope).toBe('story');
    expect(plan?.rows.map((r) => r.kind)).toEqual(['story']);
    expect(plan?.rows[0]?.artifactId).toBe('US-001');
  });

  it('task-file scope: only the tasklist row, parent epic resolved', async () => {
    const plan = await buildLinearPushPlan(projectDir, config, 'TASK-001');
    expect(plan).not.toBeNull();
    expect(plan?.scope).toBe('taskFile');
    expect(plan?.rows.map((r) => r.kind)).toEqual(['taskList']);
    expect(plan?.epicId).toBe('EPIC-001');
  });

  it('returns null for ids that cannot be resolved', async () => {
    expect(await buildLinearPushPlan(projectDir, config, 'FEAT-999')).toBeNull();
    expect(await buildLinearPushPlan(projectDir, config, 'US-999')).toBeNull();
  });

  it('returns null for unsupported prefixes (ADR/SPRINT/QT/BL in Phase 1)', async () => {
    expect(await buildLinearPushPlan(projectDir, config, 'ADR-001')).toBeNull();
    expect(await buildLinearPushPlan(projectDir, config, 'SPRINT-001')).toBeNull();
    expect(await buildLinearPushPlan(projectDir, config, 'QT-001')).toBeNull();
    expect(await buildLinearPushPlan(projectDir, config, 'BL-001')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Router parent-chain pre-flight
// ---------------------------------------------------------------------------

describe('runLinearPush — parent-chain pre-flight', () => {
  let projectDir: string;
  let config: OpenPlanrConfig;
  beforeEach(async () => {
    const p = await setupProject();
    projectDir = p.dir;
    config = p.config;
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('FEAT push with unmapped parent epic and no --push-parents: throws, zero API calls', async () => {
    await writeEpic(projectDir, 'EPIC-001'); // no linearProjectId
    await writeFeature(projectDir, 'FEAT-001', 'EPIC-001');
    const fake = makeFakeClient();
    await expect(runLinearPush(projectDir, config, fake.client, 'FEAT-001')).rejects.toThrow(
      /not been pushed to Linear yet/,
    );
    expect(fake.calls.createProject).not.toHaveBeenCalled();
    expect(fake.calls.createIssue).not.toHaveBeenCalled();
    expect(fake.calls.updateIssue).not.toHaveBeenCalled();
  });

  it('FEAT push with --push-parents cascades to epic scope (creates project + all descendants)', async () => {
    await writeEpic(projectDir, 'EPIC-001');
    await writeFeature(projectDir, 'FEAT-001', 'EPIC-001');
    await writeStory(projectDir, 'US-001', 'FEAT-001');
    await writeTaskFile(projectDir, 'TASK-001', 'FEAT-001');
    const fake = makeFakeClient();
    const plan = await runLinearPush(projectDir, config, fake.client, 'FEAT-001', {
      pushParents: true,
    });
    expect(plan).not.toBeNull();
    // Project gets created once for the epic.
    expect(fake.calls.createProject).toHaveBeenCalledTimes(1);
    // Feature + story + tasklist = 3 issues.
    expect(fake.calls.createIssue).toHaveBeenCalledTimes(3);
  });

  it('US push with mapped parent feature: exactly one createIssue', async () => {
    await writeEpic(projectDir, 'EPIC-001', { linearProjectId: 'proj-uuid-1' });
    await writeFeature(projectDir, 'FEAT-001', 'EPIC-001', {
      linearIssueId: '9b2f4c3e-1234-4abc-89de-0123456789ab',
    });
    await writeStory(projectDir, 'US-001', 'FEAT-001');
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'US-001');
    expect(fake.calls.createIssue).toHaveBeenCalledTimes(1);
    expect(fake.calls.createProject).not.toHaveBeenCalled();
    expect(fake.calls.updateIssue).not.toHaveBeenCalled();
  });

  it('TASK push with mapped parent feature: exactly one createIssue (tasklist)', async () => {
    await writeEpic(projectDir, 'EPIC-001', { linearProjectId: 'proj-uuid-1' });
    await writeFeature(projectDir, 'FEAT-001', 'EPIC-001', {
      linearIssueId: '9b2f4c3e-1234-4abc-89de-0123456789ab',
    });
    await writeTaskFile(projectDir, 'TASK-001', 'FEAT-001');
    const fake = makeFakeClient();
    await runLinearPush(projectDir, config, fake.client, 'TASK-001');
    expect(fake.calls.createIssue).toHaveBeenCalledTimes(1);
    expect(fake.calls.createProject).not.toHaveBeenCalled();
  });

  it('FEAT push with mapped parent epic and no prior feature issue: 3 createIssue calls', async () => {
    await writeEpic(projectDir, 'EPIC-001', { linearProjectId: 'proj-uuid-1' });
    await writeFeature(projectDir, 'FEAT-001', 'EPIC-001');
    await writeStory(projectDir, 'US-001', 'FEAT-001');
    await writeTaskFile(projectDir, 'TASK-001', 'FEAT-001');
    const fake = makeFakeClient();
    const plan = await runLinearPush(projectDir, config, fake.client, 'FEAT-001');
    expect(plan?.scope).toBe('feature');
    expect(fake.calls.createProject).not.toHaveBeenCalled();
    expect(fake.calls.updateProject).not.toHaveBeenCalled();
    expect(fake.calls.createIssue).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Unsupported / not-yet-supported prefixes
// ---------------------------------------------------------------------------

describe('runLinearPush — unsupported prefixes', () => {
  let projectDir: string;
  let config: OpenPlanrConfig;
  beforeEach(async () => {
    const p = await setupProject();
    projectDir = p.dir;
    config = p.config;
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('rejects ADR-/SPRINT-/checklist- ids with a pointer to the parent epic', async () => {
    const fake = makeFakeClient();
    await expect(runLinearPush(projectDir, config, fake.client, 'ADR-001')).rejects.toThrow(
      /does not support adr/,
    );
    await expect(runLinearPush(projectDir, config, fake.client, 'SPRINT-001')).rejects.toThrow(
      /does not support sprint/,
    );
    expect(fake.calls.createIssue).not.toHaveBeenCalled();
    expect(fake.calls.createProject).not.toHaveBeenCalled();
  });

  it('rejects QT- / BL- ids when the artifact file is missing', async () => {
    const fake = makeFakeClient();
    // The new resolver loads the artifact first (to read `epicId`). A
    // non-existent QT/BL file short-circuits with a clear "not found" before
    // any container-resolution step runs.
    await expect(runLinearPush(projectDir, config, fake.client, 'QT-001')).rejects.toThrow(
      /Quick task not found/,
    );
    await expect(runLinearPush(projectDir, config, fake.client, 'BL-001')).rejects.toThrow(
      /Backlog item not found/,
    );
    expect(fake.calls.createIssue).not.toHaveBeenCalled();
  });

  it('rejects unknown prefixes entirely', async () => {
    const fake = makeFakeClient();
    await expect(runLinearPush(projectDir, config, fake.client, 'ZZZ-001')).rejects.toThrow(
      /Unknown artifact id/,
    );
  });
});
