import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { OpenPlanrConfig } from '../../src/models/types.js';
import {
  createSpec,
  createSpecStory,
  createSpecTask,
  decomposeSpec,
  destroySpec,
  getSpecDir,
  listSpecStories,
  listSpecs,
  listSpecTasks,
  readSpec,
} from '../../src/services/spec-service.js';

function makeConfig(): OpenPlanrConfig {
  return {
    projectName: 'host-native-spec-test',
    targets: ['codex'],
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
    createdAt: '2026-09-03',
  };
}

const hostDecomposition = {
  stories: [
    {
      title: 'Scoped admin access',
      roleAction: 'an administrator, I want read-only grants',
      benefit: 'access is bounded per event',
      scope: 'Read-only grants and event assignment. Out of scope: billing.',
      acceptanceCriteria: ['Read-only administrators cannot mutate an event'],
      tasks: [
        {
          id: 'T-001',
          title: 'Enforce scoped read-only access',
          type: 'Tech' as const,
          agent: 'backend-agent' as const,
          rationale: 'The service owns authorization for event mutations.',
          dependsOn: [],
          acceptanceRefs: ['AC-001'],
          filesCreate: ['src/admin/access.test.ts'],
          filesModify: ['src/admin/access.ts'],
          filesPreserve: ['src/billing/index.ts'],
          objective: 'Reject writes from read-only administrators.',
          technicalSpec: 'Check the event-scoped grant before every mutation.',
          testRequirements: 'AC-001: npm test -- access',
          reviewRisks: ['security'],
          browserSurfaces: [],
        },
      ],
    },
  ],
  decompositionNotes: 'One backend task covers the non-visual contract.',
};

let projectDir: string;
let config: OpenPlanrConfig;

beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(tmpdir(), 'openplanr-spec-service-'));
  config = makeConfig();
  await fs.mkdir(path.join(projectDir, '.planr'), { recursive: true });
});

afterEach(async () => {
  if (projectDir && existsSync(projectDir)) {
    await fs.rm(projectDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe('deterministic specification storage', () => {
  it('allocates project-global specification, story, and task IDs', async () => {
    const first = await createSpec(projectDir, config, 'First');
    const second = await createSpec(projectDir, config, 'Second');
    expect([first.id, second.id]).toEqual(['SPEC-001', 'SPEC-002']);

    const storyOne = await createSpecStory(projectDir, config, first.id, 'First story', {
      roleAction: 'a user, I want the first behavior',
      benefit: 'the first result exists',
      acceptanceCriteria: [{ id: 'AC-001', statement: 'The first result is observable' }],
      tasks: [],
    });
    const storyTwo = await createSpecStory(projectDir, config, second.id, 'Second story', {
      roleAction: 'a user, I want the second behavior',
      benefit: 'the second result exists',
      acceptanceCriteria: [{ id: 'AC-001', statement: 'The second result is observable' }],
      tasks: [],
    });
    expect([storyOne.id, storyTwo.id]).toEqual(['US-001', 'US-002']);

    const taskOne = await createSpecTask(projectDir, config, first.id, {
      storyId: storyOne.id,
      title: 'First task',
      type: 'Tech',
      agent: 'backend-agent',
      acceptanceRefs: ['AC-001'],
      reviewRisks: [],
      browserSurfaces: [],
    });
    const taskTwo = await createSpecTask(projectDir, config, second.id, {
      storyId: storyTwo.id,
      title: 'Second task',
      type: 'Tech',
      agent: 'backend-agent',
      acceptanceRefs: ['AC-001'],
      reviewRisks: [],
      browserSurfaces: [],
    });
    expect([taskOne.id, taskTwo.id]).toEqual(['T-001', 'T-002']);
  });

  it('never performs semantic decomposition without host-authored input', async () => {
    await createSpec(projectDir, config, 'Scoped access');
    await expect(decomposeSpec(projectDir, config, 'SPEC-001')).rejects.toMatchObject({
      code: 'E_HOST_AGENT_REQUIRED',
    });
  });

  it('previews host-authored artifacts with zero project writes', async () => {
    await createSpec(projectDir, config, 'Scoped access', { slug: 'access' });
    const before = await snapshot(projectDir);
    await expect(
      decomposeSpec(projectDir, config, 'SPEC-001', {
        preview: true,
        decomposition: hostDecomposition,
      }),
    ).resolves.toMatchObject({
      preview: true,
      storyIds: ['US-001'],
      taskIds: ['T-001'],
      taskSelector: 'T-001',
      shipCommand: '$planr:ship T-001',
    });
    expect(await snapshot(projectDir)).toEqual(before);
  });

  it('atomically publishes consistent Protocol 1.7 stories and tasks', async () => {
    await createSpec(projectDir, config, 'Scoped access', { slug: 'access' });
    const result = await decomposeSpec(projectDir, config, 'SPEC-001', {
      decomposition: hostDecomposition,
    });
    expect(result).toMatchObject({ storiesCreated: 1, tasksCreated: 1, taskSelector: 'T-001' });

    const specDir = getSpecDir(projectDir, config, 'SPEC-001', 'access');
    const stories = await listSpecStories(specDir);
    const tasks = await listSpecTasks(specDir);
    expect(stories.map(({ id }) => id)).toEqual(['US-001']);
    expect(tasks.map(({ id }) => id)).toEqual(['T-001']);
    const task = await fs.readFile(tasks[0].filePath, 'utf8');
    expect(task).toContain('schemaVersion: "1.7.0"');
    expect(task).toContain('acceptanceRefs:');
    expect(task).toContain('"AC-001"');
    expect(task).toContain('reviewRisks:');
    expect(task).toContain('"security"');
    expect(task).toContain('browserSurfaces: []');
    expect((await readSpec(projectDir, config, 'SPEC-001'))?.data.status).toBe('decomposed');
  });

  it('replaces generated work with new global IDs while preserving unrelated spec files', async () => {
    const { specDir } = await createSpec(projectDir, config, 'Scoped access', { slug: 'access' });
    const first = await decomposeSpec(projectDir, config, 'SPEC-001', {
      decomposition: hostDecomposition,
    });
    await fs.writeFile(path.join(specDir, 'design', 'notes.md'), 'preserve\n');
    const second = await decomposeSpec(projectDir, config, 'SPEC-001', {
      replaceExisting: true,
      decomposition: hostDecomposition,
    });
    expect(second.storyIds).not.toEqual(first.storyIds);
    expect(second.taskIds).not.toEqual(first.taskIds);
    await expect(fs.readFile(path.join(specDir, 'design', 'notes.md'), 'utf8')).resolves.toBe(
      'preserve\n',
    );
    expect((await listSpecTasks(specDir)).every(({ status }) => status === 'pending')).toBe(true);
  });

  it('rejects incomplete acceptance coverage before publishing', async () => {
    const { specDir } = await createSpec(projectDir, config, 'Scoped access', { slug: 'access' });
    const invalid = structuredClone(hostDecomposition);
    invalid.stories[0].tasks[0].acceptanceRefs = [];
    await expect(
      decomposeSpec(projectDir, config, 'SPEC-001', {
        decomposition: invalid,
      }),
    ).rejects.toThrow(/acceptance criteria without task verification/u);
    expect(await listSpecStories(specDir)).toEqual([]);
    expect(await listSpecTasks(specDir)).toEqual([]);
  });

  it('lists and removes self-contained specification directories', async () => {
    await createSpec(projectDir, config, 'Scoped access');
    expect((await listSpecs(projectDir, config)).map(({ id }) => id)).toEqual(['SPEC-001']);
    await destroySpec(projectDir, config, 'SPEC-001');
    expect(await listSpecs(projectDir, config)).toEqual([]);
  });
});

async function snapshot(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(directory, absolute);
      if (entry.isDirectory()) {
        result[`${relative}/`] = 'directory';
        await visit(absolute);
      } else {
        result[relative] = (await fs.readFile(absolute)).toString('base64');
      }
    }
  }
  await visit(directory);
  return result;
}
