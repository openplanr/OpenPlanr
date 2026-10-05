import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = path.resolve('src/cli/index.ts');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const roots: string[] = [];

function repository(files: string[] = []): string {
  const root = mkdtempSync(path.join(tmpdir(), 'openplanr-folder-guard-'));
  roots.push(root);
  for (const file of files) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), '\n');
  }
  return root;
}

function run(projectDir: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [TSX, CLI, '--project-dir', projectDir, ...args], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('planning folder guard', { timeout: 60_000 }, () => {
  it('initializes a clean repository', () => {
    const root = repository(['README.md']);
    const result = run(root, ['init', '--name', 'demo']);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(root, '.planr', 'config.json'))).toBe(true);
  });

  it('keeps writing to an OpenPlanr planning folder that also holds look-alike files', () => {
    const root = repository();
    expect(run(root, ['init', '--name', 'demo']).status).toBe(0);
    writeFileSync(path.join(root, '.planr', 'board.html'), '\n');
    writeFileSync(path.join(root, '.planr', 'tasks', 'TASK-900-release-goal.md'), '\n');
    const result = run(root, ['backlog', 'add', '--title', 'Keep going', '--json']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
  });

  it('refuses to write into a planning folder another tool owns', () => {
    const files = ['.planr/planr.config.json', '.planr/board.html', '.planr/tasks/launch-goal.md'];
    const root = repository(files);
    const before = readdirSync(path.join(root, '.planr')).sort();

    const init = run(root, ['init', '--name', 'demo']);
    expect(init.status).toBe(1);
    const output = `${init.stdout}${init.stderr}`;
    expect(output).toContain('E_PLANNING_FOLDER_FOREIGN');
    expect(output).toContain('belongs to another tool');
    expect(output).toContain('planr.config.json, board.html, *-goal.md files in tasks');
    expect(output).toContain('Move or rename that folder');
    expect(readdirSync(path.join(root, '.planr')).sort()).toEqual(before);
    expect(existsSync(path.join(root, '.planr', 'config.json'))).toBe(false);

    const status = run(root, ['status', '--json']);
    expect(status.status).toBe(1);
    expect(JSON.parse(status.stdout)).toMatchObject({
      ok: false,
      code: 'E_PLANNING_FOLDER_FOREIGN',
      recovery: expect.stringContaining('Move or rename that folder'),
    });
    expect(readdirSync(path.join(root, '.planr')).sort()).toEqual(before);
  });
});
