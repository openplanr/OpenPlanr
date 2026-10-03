import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = resolve('src/cli/index.ts');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function runPlanr(directory: string, args: string[]) {
  const result = spawnSync(
    process.execPath,
    [TSX, CLI, '--project-dir', directory, '--no-interactive', ...args],
    { cwd: directory, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } },
  );
  expect(result.status, result.stderr).toBe(0);
  return result;
}

function project() {
  const directory = mkdtempSync(join(tmpdir(), 'planr-context-export-'));
  directories.push(directory);
  runPlanr(directory, ['init', '--name', 'Synthetic planning']);
  const create = (type: string, title: string, parent: string[] = []) => {
    const result = runPlanr(directory, [type, 'create', '--title', title, ...parent, '--json']);
    const artifact = JSON.parse(result.stdout);
    expect(artifact).toMatchObject({ ok: true, id: expect.any(String) });
    return artifact.id as string;
  };
  const epic = create('epic', 'SelectedAlpha epic');
  const feature = create('feature', 'SelectedAlpha feature', ['--epic', epic]);
  const story = create('story', 'SelectedAlpha story', ['--feature', feature]);
  const task = create('task', 'SelectedAlpha story task', ['--story', story]);
  const directTask = create('task', 'SelectedAlpha feature task', ['--feature', feature]);
  const otherEpic = create('epic', 'UnrelatedBeta epic');
  const otherFeature = create('feature', 'UnrelatedBeta feature', ['--epic', otherEpic]);
  const otherStory = create('story', 'UnrelatedBeta story', ['--feature', otherFeature]);
  const otherTask = create('task', 'UnrelatedBeta task', ['--story', otherStory]);
  return { directory, epic, feature, story, task, directTask, otherStory, otherTask };
}

function planningBytes(directory: string) {
  const result: Record<string, string> = {};
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        result[relative(directory, path)] = createHash('sha256')
          .update(readFileSync(path))
          .digest('hex');
      }
    }
  };
  visit(join(directory, '.planr'));
  return result;
}

describe('machine context and scoped planning exports', () => {
  it('prints one complete JSON context document for every report type without provider calls', () => {
    const fixture = project();
    const before = planningBytes(fixture.directory);
    for (const reportType of ['weekly', 'sprint', 'executive', 'standup', 'retro', 'release']) {
      const result = runPlanr(fixture.directory, [
        'context',
        '--report-type',
        reportType,
        '--no-github',
        '--days',
        '3',
      ]);
      const context = JSON.parse(result.stdout);
      expect(result.stderr).toContain('context: 2 evidence items\n');
      expect(context).toMatchObject({
        projectName: 'Synthetic planning',
        reportType,
        daysLookback: 3,
        placeholders: { noGitHub: true, noSprint: true },
      });
      expect(context.github).toBeUndefined();
      expect(context.artifacts.stories.map((story: { id: string }) => story.id)).toEqual([
        fixture.story,
        fixture.otherStory,
      ]);
      expect(context.evidence.map((item: { label: string }) => item.label)).toEqual([
        `${fixture.story}: SelectedAlpha story`,
        `${fixture.otherStory}: UnrelatedBeta story`,
      ]);
    }
    expect(planningBytes(fixture.directory)).toEqual(before);
  });

  it('limits JSON, Markdown and HTML evidence to the selected epic while retaining both task bindings', () => {
    const fixture = project();
    const before = planningBytes(fixture.directory);
    for (const [format, extension] of [
      ['json', 'json'],
      ['markdown', 'md'],
      ['html', 'html'],
    ]) {
      const output = join(fixture.directory, `scope.${extension}`);
      runPlanr(fixture.directory, [
        'export',
        '--format',
        format,
        '--scope',
        fixture.epic,
        '--output',
        output,
      ]);
      const content = readFileSync(output, 'utf8');
      expect(content).not.toContain('UnrelatedBeta');
      expect(content).not.toContain(fixture.otherStory);
      expect(content).not.toContain(fixture.otherTask);
      for (const id of [
        fixture.epic,
        fixture.feature,
        fixture.story,
        fixture.task,
        fixture.directTask,
      ]) {
        expect(content).toContain(id);
      }
      if (format === 'json') {
        const exported = JSON.parse(content);
        expect(exported.counts).toEqual({ epics: 1, features: 1, stories: 1, tasks: 2, quick: 0 });
        expect(exported.evidence).toEqual([
          {
            kind: 'story',
            label: `${fixture.story}: SelectedAlpha story`,
            detail: 'Status: planning',
          },
          {
            kind: 'task',
            label: `${fixture.task}: SelectedAlpha story task`,
            detail: 'Status: pending',
          },
          {
            kind: 'task',
            label: `${fixture.directTask}: SelectedAlpha feature task`,
            detail: 'Status: pending',
          },
        ]);
        expect(exported.epics[0].features[0].stories[0].tasks[0].id).toBe(fixture.task);
      }
    }
    const unscoped = join(fixture.directory, 'all.json');
    runPlanr(fixture.directory, ['export', '--format', 'json', '--output', unscoped]);
    const all = JSON.parse(readFileSync(unscoped, 'utf8'));
    expect(all.counts).toEqual({ epics: 2, features: 2, stories: 2, tasks: 3, quick: 0 });
    expect(all.evidence).toHaveLength(5);
    expect(all.evidence).toContainEqual({
      kind: 'story',
      label: `${fixture.otherStory}: UnrelatedBeta story`,
      detail: 'Status: planning',
    });
    expect(all.evidence).toContainEqual({
      kind: 'task',
      label: `${fixture.otherTask}: UnrelatedBeta task`,
      detail: 'Status: pending',
    });
    expect(planningBytes(fixture.directory)).toEqual(before);
  });
});
