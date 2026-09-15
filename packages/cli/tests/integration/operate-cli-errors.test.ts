import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = path.resolve('src/cli/index.ts');
const TSX = path.resolve('node_modules/tsx/dist/cli.mjs');
const temporaryRoots: string[] = [];

function temporaryProject(): string {
  const projectDir = mkdtempSync(path.join(tmpdir(), 'openplanr-operate-cli-errors-'));
  temporaryRoots.push(projectDir);
  return projectDir;
}

function run(projectDir: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [TSX, CLI, '--project-dir', projectDir, 'operate', ...args], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function machineFailure(result: SpawnSyncReturns<string>): Record<string, unknown> {
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('');
  expect(`${result.stdout}${result.stderr}`).not.toMatch(/\n\s+at\s/u);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe('deterministic Operate utilities', { timeout: 30_000 }, () => {
  it('reports neutral storage without starting or writing an Operate workflow', () => {
    const projectDir = temporaryProject();
    const result = run(projectDir, ['recovery', 'storage-status', '--json']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      kind: 'operate-storage-status',
      status: 'empty',
      legacySources: [],
      interruptedEntries: [],
      pinnedVerifierRequired: false,
      nextAction: 'none',
    });
    expect(existsSync(path.join(projectDir, '.planr'))).toBe(false);
  });

  it('validates a local review note and returns a bounded Protocol failure', () => {
    const projectDir = temporaryProject();
    writeFileSync(path.join(projectDir, 'advisor.md'), '# Invalid\n');
    const failure = machineFailure(
      run(projectDir, ['validate-note', 'advisor.md', '--profile', 'advisor', '--json']),
    );
    expect(failure).toMatchObject({ ok: false, code: 'E_OPERATE_NOTE_INVALID' });
    expect(String(failure.problem)).toMatch(
      /^The Operate advisor note failed \d+ contract checks?\.$/u,
    );
    expect(JSON.stringify(failure)).not.toContain(projectDir);
  });

  it('advertises the current planning, assignment, validation, and recovery namespaces', () => {
    const projectDir = temporaryProject();
    const result = run(projectDir, ['--help']);
    expect(result.status, result.stderr).toBe(0);
    for (const command of ['planning', 'assignment', 'validate-note', 'recovery']) {
      expect(result.stdout).toMatch(new RegExp(`^\\s{2}${command}(?:\\s|$)`, 'mu'));
    }
  });
});
