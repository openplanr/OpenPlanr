import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

const CLI = path.resolve('src/cli/index.ts');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const STACK_FRAME = /\n\s+at\s/u;
const UNREADABLE = 'E_QUICK_INPUT_FILE_UNREADABLE: The quick input file could not be read.';
const projects: TestProject[] = [];

async function project(): Promise<TestProject> {
  const created = await createTestProject('cli-error-verbosity');
  projects.push(created);
  return created;
}

function run(projectDir: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [TSX, CLI, '--project-dir', projectDir, ...args], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

afterEach(() => {
  for (const created of projects.splice(0)) created.cleanup();
});

describe('the top-level error boundary', { timeout: 30_000 }, () => {
  it('prints one concise line by default', async () => {
    const created = await project();
    const missing = path.join(created.dir, 'missing.md');
    const result = run(created.dir, ['--no-interactive', 'quick', 'create', '--file', missing]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(UNREADABLE);
    expect(result.stdout).not.toContain('[DEBUG]');
    expect(`${result.stdout}${result.stderr}`).not.toMatch(STACK_FRAME);
  });

  it('adds the stack and the cause chain under --verbose', async () => {
    const created = await project();
    const missing = path.join(created.dir, 'missing.md');
    const result = run(created.dir, [
      '--no-interactive',
      '--verbose',
      'quick',
      'create',
      '--file',
      missing,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(UNREADABLE);
    expect(result.stdout).toContain('[DEBUG] The command failed:');
    expect(result.stdout).toContain('The quick input file could not be read.');
    expect(result.stdout).toMatch(STACK_FRAME);
    expect(result.stdout).toContain('Caused by: Error: ENOENT: no such file or directory');
  });

  it('adds the stack of an unexpected failure under --verbose', async () => {
    const created = await project();
    const result = run(created.dir, ['--no-interactive', '--verbose', 'story', 'show', 'US-999']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('E_CLI_UNEXPECTED: story US-999 was not found.');
    expect(result.stdout).toContain(
      '[DEBUG] The command failed: Error: story US-999 was not found.',
    );
    expect(result.stdout).toMatch(STACK_FRAME);
  });

  it('keeps --json output to the one envelope even with --verbose', async () => {
    const created = await project();
    const missing = path.join(created.dir, 'missing.md');
    const result = run(created.dir, ['--verbose', 'quick', 'create', '--file', missing, '--json']);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      code: 'E_QUICK_INPUT_FILE_UNREADABLE',
    });
  });

  it('does not treat an option value spelled --json as a request for JSON', async () => {
    const created = await project();
    const missing = path.join(created.dir, 'missing.md');
    const result = run(created.dir, [
      '--no-interactive',
      'quick',
      'create',
      '--title',
      '--json',
      '--file',
      missing,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('E_QUICK_INPUT_CONFLICT');
    expect(result.stdout).not.toContain('"ok":false');
  });
});
