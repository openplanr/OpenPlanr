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

// Every smoke test spawns `npx tsx` which, on a cold CI runner, has to
// install tsx (~5–7s) on the first invocation before anything else runs.
// The default 5s vitest timeout is too tight for that cold-start cost —
// release CI hit TS timeouts on the init test after the merge.
// Apply the same generous budget to every test in this file so cold-start
// pays once and subsequent tests still have room to spare.
const SMOKE_TIMEOUT_MS = 20_000;

describe('CLI smoke tests', () => {
  it(
    'prints a version string with --version',
    () => {
      const output = run('--version');
      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    },
    SMOKE_TIMEOUT_MS,
  );

  it(
    'prints help text mentioning key commands',
    () => {
      const output = run('--help');
      expect(output).toContain('init');
      expect(output).toContain('epic');
      expect(output).toContain('backlog');
      expect(output).toContain('sprint');
    },
    SMOKE_TIMEOUT_MS,
  );

  it(
    'initializes a project with planr init',
    () => {
      const dir = makeTempDir();
      run('init --name test-project --no-ai', { cwd: dir });

      expect(existsSync(join(dir, '.planr', 'config.json'))).toBe(true);
      expect(existsSync(join(dir, '.planr', 'epics'))).toBe(true);
    },
    SMOKE_TIMEOUT_MS,
  );

  it('runs planr status in an initialized project without error', () => {
    const dir = makeTempDir();
    run('init --name test-project --no-ai', { cwd: dir });

    const output = run('status', { cwd: dir });
    expect(output).toBeDefined();
  }, 30_000); // `status` runs two CLI invocations; give it a bit more headroom.
});
