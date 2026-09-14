import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

const CLI = path.resolve('src/cli/index.ts');
const TSX = path.resolve('node_modules/tsx/dist/cli.mjs');
const projects: TestProject[] = [];

async function project(): Promise<TestProject> {
  const created = await createTestProject('cli-boundary');
  projects.push(created);
  return created;
}

function run(projectDir: string, args: string[], input?: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [TSX, CLI, '--project-dir', projectDir, ...args], {
    cwd: projectDir,
    encoding: 'utf8',
    input,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function quickFiles(created: TestProject): string[] {
  const root = path.join(created.dir, created.config.outputPaths.agile, 'quick');
  return readdirSync(root).map((entry) => path.join(root, entry));
}

function machineFailure(result: SpawnSyncReturns<string>) {
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('');
  expect(result.stdout).not.toMatch(/\n\s+at\s/u);
  const value = JSON.parse(result.stdout) as Record<string, unknown>;
  expect(value.ok).toBe(false);
  return value;
}

afterEach(() => {
  for (const created of projects.splice(0)) created.cleanup();
});

describe('closed CLI and non-interactive quick boundary', { timeout: 30_000 }, () => {
  it('creates one deterministic quick artifact from an explicit no-TTY description', async () => {
    const created = await project();
    const result = run(created.dir, [
      '--no-interactive',
      'quick',
      'create',
      'Repair the release package',
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/\n\s+at\s/u);
    const [file] = quickFiles(created);
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('## Source Description');
    expect(content).toContain('Repair the release package');
    expect(content).toContain('- [ ] **1.0** Repair the release package');
  });

  it('returns one JSON success envelope and consumes a bounded file or stdin', async () => {
    for (const source of ['file', 'stdin'] as const) {
      const created = await project();
      const description = '# Harden CLI input\n\nKeep option tokens out of positionals.';
      const inputPath = path.join(created.dir, 'private-input.md');
      if (source === 'file') writeFileSync(inputPath, description);
      const result = run(
        created.dir,
        [
          '--no-interactive',
          'quick',
          'create',
          '--file',
          source === 'file' ? inputPath : '-',
          '--json',
        ],
        source === 'stdin' ? description : undefined,
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout.trim().split('\n')).toHaveLength(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        action: 'quick.created',
        id: 'QT-001',
        title: 'Harden CLI input',
      });
      const [file] = quickFiles(created);
      expect(readFileSync(file, 'utf8')).toContain('Keep option tokens out of positionals.');
    }
  });

  it('aggregates missing quick input without prompting or creating an artifact', async () => {
    const created = await project();
    const value = machineFailure(run(created.dir, ['quick', 'create', '--json']));
    expect(value).toEqual({
      ok: false,
      code: 'E_QUICK_INPUT_REQUIRED',
      problem: 'Quick creation requires an explicit description or --file.',
      recovery: 'Provide a description, --file <path>, or --file - for bounded stdin.',
      missing: ['descriptionOrFile'],
    });
    expect(() => quickFiles(created)).toThrow();
  });

  it('bounds conflicting and unreadable inputs without serializing private paths', async () => {
    const created = await project();
    const privatePath = path.join(created.dir, 'private', 'missing.md');
    const cases = [
      {
        args: ['quick', 'create', 'explicit', '--file', privatePath, '--json'],
        code: 'E_QUICK_INPUT_CONFLICT',
      },
      {
        args: ['quick', 'create', '--file', privatePath, '--json'],
        code: 'E_QUICK_INPUT_FILE_UNREADABLE',
      },
    ];
    for (const { args, code } of cases) {
      const result = run(created.dir, args);
      const value = machineFailure(result);
      expect(value.code).toBe(code);
      expect(result.stdout).not.toContain(privatePath);
      expect(result.stdout).not.toContain(created.dir);
    }
  });

  it('uses the bounded JSON renderer for retired semantic command facades', async () => {
    const created = await project();
    const pipeline = machineFailure(
      run(created.dir, ['pipeline', 'definitely-not-an-action', '--json']),
    );
    expect(pipeline).toEqual({
      ok: false,
      code: 'commander.unknownCommand',
      problem: "unknown command 'pipeline'",
    });

    const operatePlanning = machineFailure(
      run(created.dir, [
        'operate',
        'planning',
        'preview',
        'act_12345678',
        '--framing-file',
        '--json',
      ]),
    );
    expect(operatePlanning).toEqual({
      ok: false,
      code: 'commander.unknownCommand',
      problem: "unknown command 'planning'",
    });
    expect(JSON.stringify({ pipeline, operatePlanning })).not.toContain(created.dir);
  });
});
