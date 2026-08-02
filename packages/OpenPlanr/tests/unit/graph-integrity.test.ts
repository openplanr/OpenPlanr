import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../src/services/config-service.js';
import { checkGraphIntegrity } from '../../src/services/graph-integrity.js';
import { ensureDir } from '../../src/utils/fs.js';

async function seed(
  tmpDir: string,
  config: ReturnType<typeof createDefaultConfig>,
  opts: {
    epics: Array<{ id: string }>;
    features: Array<{ id: string; epicId?: string }>;
    stories?: Array<{ id: string; featureId?: string }>;
    tasks?: Array<{ id: string; storyId?: string }>;
  },
) {
  const base = join(tmpDir, config.outputPaths.agile);
  await ensureDir(join(base, 'epics'));
  await ensureDir(join(base, 'features'));
  await ensureDir(join(base, 'stories'));
  await ensureDir(join(base, 'tasks'));

  for (const e of opts.epics) {
    writeFileSync(join(base, 'epics', `${e.id}-seed.md`), `---\nid: "${e.id}"\n---\n# Body`);
  }
  for (const f of opts.features) {
    const fm = [`id: "${f.id}"`];
    if (f.epicId) fm.push(`epicId: "${f.epicId}"`);
    writeFileSync(join(base, 'features', `${f.id}-seed.md`), `---\n${fm.join('\n')}\n---\n# Body`);
  }
  for (const s of opts.stories ?? []) {
    const fm = [`id: "${s.id}"`];
    if (s.featureId) fm.push(`featureId: "${s.featureId}"`);
    writeFileSync(join(base, 'stories', `${s.id}-seed.md`), `---\n${fm.join('\n')}\n---\n# Body`);
  }
  for (const t of opts.tasks ?? []) {
    const fm = [`id: "${t.id}"`];
    if (t.storyId) fm.push(`storyId: "${t.storyId}"`);
    writeFileSync(join(base, 'tasks', `${t.id}-seed.md`), `---\n${fm.join('\n')}\n---\n# Body`);
  }
}

describe('checkGraphIntegrity', () => {
  let tmpDir: string;
  const config = createDefaultConfig('graph-test');

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'planr-graph-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('reports ok when every parent reference resolves', async () => {
    await seed(tmpDir, config, {
      epics: [{ id: 'EPIC-100' }],
      features: [{ id: 'FEAT-200', epicId: 'EPIC-100' }],
      stories: [{ id: 'US-300', featureId: 'FEAT-200' }],
      tasks: [{ id: 'TASK-400', storyId: 'US-300' }],
    });
    const report = await checkGraphIntegrity(tmpDir, config);
    expect(report.ok).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it('flags a feature whose epicId points at a non-existent epic', async () => {
    await seed(tmpDir, config, {
      epics: [{ id: 'EPIC-100' }],
      features: [{ id: 'FEAT-200', epicId: 'EPIC-GHOST' }],
    });
    const report = await checkGraphIntegrity(tmpDir, config);
    expect(report.ok).toBe(false);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].childId).toBe('FEAT-200');
    expect(report.issues[0].parentField).toBe('epicId');
    expect(report.issues[0].parentId).toBe('EPIC-GHOST');
    expect(report.issues[0].reason).toBe('missing-parent');
  });

  it('tolerates missing parent-id fields (optional linkage)', async () => {
    await seed(tmpDir, config, {
      epics: [{ id: 'EPIC-100' }],
      features: [{ id: 'FEAT-200' }], // no epicId — optional
    });
    const report = await checkGraphIntegrity(tmpDir, config);
    expect(report.ok).toBe(true);
  });

  it('flags multiple issues across types', async () => {
    await seed(tmpDir, config, {
      epics: [{ id: 'EPIC-100' }],
      features: [
        { id: 'FEAT-200', epicId: 'EPIC-100' },
        { id: 'FEAT-201', epicId: 'EPIC-GHOST' }, // broken
      ],
      stories: [
        { id: 'US-300', featureId: 'FEAT-GHOST' }, // broken
      ],
      tasks: [
        { id: 'TASK-400', storyId: 'US-GHOST' }, // broken
      ],
    });
    const report = await checkGraphIntegrity(tmpDir, config);
    expect(report.ok).toBe(false);
    expect(report.issues).toHaveLength(3);
    const ids = report.issues.map((i) => i.childId).sort();
    expect(ids).toEqual(['FEAT-201', 'TASK-400', 'US-300']);
  });
});
