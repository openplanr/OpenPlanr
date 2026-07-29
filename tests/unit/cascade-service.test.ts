import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCascadeOrder, executeCascade } from '../../src/services/cascade-service.js';
import { createDefaultConfig } from '../../src/services/config-service.js';
import { ensureDir } from '../../src/utils/fs.js';

async function seedHierarchy(tmpDir: string, config: ReturnType<typeof createDefaultConfig>) {
  const base = join(tmpDir, config.outputPaths.agile);
  await ensureDir(join(base, 'epics'));
  await ensureDir(join(base, 'features'));
  await ensureDir(join(base, 'stories'));
  await ensureDir(join(base, 'tasks'));

  writeFileSync(
    join(base, 'epics', 'EPIC-900-root.md'),
    '---\nid: "EPIC-900"\ntitle: "root"\n---\n# Body',
  );
  writeFileSync(
    join(base, 'features', 'FEAT-901-one.md'),
    '---\nid: "FEAT-901"\nepicId: "EPIC-900"\n---\n# Body',
  );
  writeFileSync(
    join(base, 'features', 'FEAT-902-two.md'),
    '---\nid: "FEAT-902"\nepicId: "EPIC-900"\n---\n# Body',
  );
  // Feature under a different epic — should be excluded from cascade.
  writeFileSync(
    join(base, 'features', 'FEAT-999-other.md'),
    '---\nid: "FEAT-999"\nepicId: "EPIC-OTHER"\n---\n# Body',
  );
  writeFileSync(
    join(base, 'stories', 'US-910-a.md'),
    '---\nid: "US-910"\nfeatureId: "FEAT-901"\n---\n# Body',
  );
  writeFileSync(
    join(base, 'stories', 'US-911-b.md'),
    '---\nid: "US-911"\nfeatureId: "FEAT-902"\n---\n# Body',
  );
  writeFileSync(
    join(base, 'tasks', 'TASK-920-root.md'),
    '---\nid: "TASK-920"\nstoryId: "US-910"\n---\n# Body',
  );
}

describe('buildCascadeOrder', () => {
  let tmpDir: string;
  const config = createDefaultConfig('cascade-test');

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'planr-cascade-'));
    await seedHierarchy(tmpDir, config);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('produces top-down order for an epic root: epic → features → stories → tasks', async () => {
    const plan = await buildCascadeOrder(tmpDir, config, 'epic', 'EPIC-900');
    expect(plan.levels[0].label).toBe('epic');
    expect(plan.levels[0].artifactIds).toEqual(['EPIC-900']);
    expect(plan.levels[1].label).toBe('features');
    expect(plan.levels[1].artifactIds.sort()).toEqual(['FEAT-901', 'FEAT-902']);
    expect(plan.levels[2].label).toBe('stories');
    expect(plan.levels[2].artifactIds.sort()).toEqual(['US-910', 'US-911']);
    expect(plan.levels[3].label).toBe('tasks');
    expect(plan.levels[3].artifactIds).toEqual(['TASK-920']);
  });

  it('excludes artifacts that belong to a different parent', async () => {
    const plan = await buildCascadeOrder(tmpDir, config, 'epic', 'EPIC-900');
    expect(plan.levels[1].artifactIds).not.toContain('FEAT-999');
  });

  it('starts mid-hierarchy when root is a feature', async () => {
    const plan = await buildCascadeOrder(tmpDir, config, 'feature', 'FEAT-901');
    expect(plan.levels[0].artifactIds).toEqual([]); // epic level empty
    expect(plan.levels[1].artifactIds).toEqual(['FEAT-901']);
    expect(plan.levels[2].artifactIds).toEqual(['US-910']);
    expect(plan.levels[3].artifactIds).toEqual(['TASK-920']);
  });

  it('starts at story when root is a story', async () => {
    const plan = await buildCascadeOrder(tmpDir, config, 'story', 'US-910');
    expect(plan.levels[0].artifactIds).toEqual([]);
    expect(plan.levels[1].artifactIds).toEqual([]);
    expect(plan.levels[2].artifactIds).toEqual(['US-910']);
    expect(plan.levels[3].artifactIds).toEqual(['TASK-920']);
  });

  it('exposes a flat ordered list of all ids', async () => {
    const plan = await buildCascadeOrder(tmpDir, config, 'epic', 'EPIC-900');
    expect(plan.orderedIds[0]).toBe('EPIC-900');
    expect(plan.orderedIds.length).toBeGreaterThan(0);
  });
});

describe('executeCascade', () => {
  it('invokes processor for every artifact in plan order and returns completed=total on success', async () => {
    const visited: string[] = [];
    const result = await executeCascade({
      plan: {
        rootId: 'EPIC-900',
        rootType: 'epic',
        orderedIds: ['EPIC-900', 'FEAT-901', 'US-910'],
        levels: [
          { type: 'epic', label: 'epic', artifactIds: ['EPIC-900'] },
          { type: 'feature', label: 'features', artifactIds: ['FEAT-901'] },
          { type: 'story', label: 'stories', artifactIds: ['US-910'] },
          { type: 'task', label: 'tasks', artifactIds: [] },
        ],
      },
      processor: async ({ artifactId }) => {
        visited.push(artifactId);
        return { continue: true };
      },
    });
    expect(visited).toEqual(['EPIC-900', 'FEAT-901', 'US-910']);
    expect(result).toEqual({ completed: 3, total: 3 });
  });

  it("stops gracefully when the processor returns continue: false with stopReason 'q'", async () => {
    const visited: string[] = [];
    const result = await executeCascade({
      plan: {
        rootId: 'EPIC-900',
        rootType: 'epic',
        orderedIds: ['EPIC-900', 'FEAT-901', 'US-910'],
        levels: [
          { type: 'epic', label: 'epic', artifactIds: ['EPIC-900'] },
          { type: 'feature', label: 'features', artifactIds: ['FEAT-901'] },
          { type: 'story', label: 'stories', artifactIds: ['US-910'] },
          { type: 'task', label: 'tasks', artifactIds: [] },
        ],
      },
      processor: async ({ artifactId }) => {
        visited.push(artifactId);
        if (artifactId === 'FEAT-901') return { continue: false, stopReason: 'q' };
        return { continue: true };
      },
    });
    expect(visited).toEqual(['EPIC-900', 'FEAT-901']);
    expect(result.interrupted?.reason).toBe('q');
    expect(result.interrupted?.atArtifactId).toBe('FEAT-901');
  });

  it('records agent_error reason when processor throws', async () => {
    const result = await executeCascade({
      plan: {
        rootId: 'FEAT-901',
        rootType: 'feature',
        orderedIds: ['FEAT-901', 'US-910'],
        levels: [
          { type: 'epic', label: 'epic', artifactIds: [] },
          { type: 'feature', label: 'features', artifactIds: ['FEAT-901'] },
          { type: 'story', label: 'stories', artifactIds: ['US-910'] },
          { type: 'task', label: 'tasks', artifactIds: [] },
        ],
      },
      processor: async ({ artifactId }) => {
        if (artifactId === 'FEAT-901') throw new Error('AI provider down');
        return { continue: true };
      },
    });
    expect(result.interrupted?.reason).toBe('agent_error');
    expect(result.interrupted?.atArtifactId).toBe('FEAT-901');
  });

  it('stops cascade when SIGINT is emitted before the next artifact', async () => {
    const signalTarget = new EventEmitter() as NodeJS.Process;
    const visited: string[] = [];
    const plan = {
      rootId: 'EPIC-900',
      rootType: 'epic' as const,
      orderedIds: ['EPIC-900', 'FEAT-901', 'US-910'],
      levels: [
        { type: 'epic' as const, label: 'epic' as const, artifactIds: ['EPIC-900'] },
        { type: 'feature' as const, label: 'features' as const, artifactIds: ['FEAT-901'] },
        { type: 'story' as const, label: 'stories' as const, artifactIds: ['US-910'] },
        { type: 'task' as const, label: 'tasks' as const, artifactIds: [] },
      ],
    };
    const result = await executeCascade({
      plan,
      signalTarget,
      processor: async ({ artifactId }) => {
        visited.push(artifactId);
        if (artifactId === 'EPIC-900') {
          signalTarget.emit('SIGINT');
        }
        return { continue: true };
      },
    });
    expect(visited).toEqual(['EPIC-900']); // next iteration bails
    expect(result.interrupted?.reason).toBe('sigint');
  });

  it('emits progress snapshots with level labels and completed/total counts', async () => {
    const progressSamples: Array<{ completed: number; total: number; label: string }> = [];
    await executeCascade({
      plan: {
        rootId: 'EPIC-900',
        rootType: 'epic',
        orderedIds: ['EPIC-900', 'FEAT-901'],
        levels: [
          { type: 'epic', label: 'epic', artifactIds: ['EPIC-900'] },
          { type: 'feature', label: 'features', artifactIds: ['FEAT-901'] },
          { type: 'story', label: 'stories', artifactIds: [] },
          { type: 'task', label: 'tasks', artifactIds: [] },
        ],
      },
      onProgress: (p) =>
        progressSamples.push({
          completed: p.completed,
          total: p.total,
          label: p.currentLevelLabel,
        }),
      processor: async () => ({ continue: true }),
    });
    expect(progressSamples).toEqual([
      { completed: 0, total: 2, label: 'epic' },
      { completed: 1, total: 2, label: 'features' },
    ]);
  });
});
