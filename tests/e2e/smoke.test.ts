import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = resolve('src/cli/index.ts');
const run = (args: string, opts?: { cwd?: string }) =>
  execSync(`npx tsx ${CLI} ${args}`, {
    encoding: 'utf-8',
    cwd: opts?.cwd,
    env: { ...process.env, NO_COLOR: '1' },
  });

let tempDirs: string[] = [];

const makeTempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'planr-e2e-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('CLI smoke tests', () => {
  it('prints a version string with --version', () => {
    const output = run('--version');
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('prints help text mentioning key commands', () => {
    const output = run('--help');
    expect(output).toContain('init');
    expect(output).toContain('epic');
    expect(output).toContain('backlog');
    expect(output).toContain('sprint');
  });

  it('initializes a project with planr init', () => {
    const dir = makeTempDir();
    run('init --name test-project --no-ai', { cwd: dir });

    expect(existsSync(join(dir, '.planr', 'config.json'))).toBe(true);
    expect(existsSync(join(dir, '.planr', 'epics'))).toBe(true);
  });

  it('runs planr status in an initialized project without error', () => {
    const dir = makeTempDir();
    run('init --name test-project --no-ai', { cwd: dir });

    const output = run('status', { cwd: dir });
    expect(output).toBeDefined();
  }, 20_000);
});
