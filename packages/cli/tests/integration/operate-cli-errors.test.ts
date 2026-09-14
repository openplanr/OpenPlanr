import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  it('inspects and shows local artifacts without starting an Operate workflow', () => {
    const projectDir = temporaryProject();
    const artifact = path.join(projectDir, 'review.md');
    const content = '# Review\n\nLocal content.\n';
    writeFileSync(artifact, content);

    const inspection = run(projectDir, ['inspect', 'review.md']);
    expect(inspection.status, inspection.stderr).toBe(0);
    expect(JSON.parse(inspection.stdout)).toMatchObject({
      type: 'file',
      bytes: Buffer.byteLength(content),
    });

    const shown = run(projectDir, ['show', 'review.md']);
    expect(shown.status, shown.stderr).toBe(0);
    expect(shown.stdout).toBe(`${content}\n`);
  });

  it('validates local JSON through the Protocol reader and returns a bounded failure', () => {
    const projectDir = temporaryProject();
    writeFileSync(path.join(projectDir, 'result.json'), '{}\n');
    const failure = machineFailure(
      run(projectDir, ['validate', 'result.json', '--kind', 'skill-package', '--json']),
    );
    expect(failure).toMatchObject({ ok: false, code: 'E_OPERATE_INVALID' });
    expect(String(failure.problem)).toMatch(/^\d+ validation error\(s\)\.$/u);
    expect(JSON.stringify(failure)).not.toContain(projectDir);
  });

  it.each(['assignment', 'planning', 'validate-note'])(
    'keeps retired %s governance commands absent',
    (command) => {
      const projectDir = temporaryProject();
      expect(machineFailure(run(projectDir, [command, '--json']))).toEqual({
        ok: false,
        code: 'commander.unknownCommand',
        problem: `unknown command '${command}'`,
      });
    },
  );
});
