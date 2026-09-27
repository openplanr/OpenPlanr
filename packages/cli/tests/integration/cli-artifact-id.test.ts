import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

const CLI = path.resolve('src/cli/index.ts');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const STORY = '---\nid: "US-001"\ntitle: "Login"\nstatus: "pending"\n---\n# US-001: Login\n';
const projects: TestProject[] = [];

async function project(): Promise<{ created: TestProject; storyPath: string }> {
  const created = await createTestProject('cli-artifact-id');
  projects.push(created);
  const storyPath = path.join(
    created.dir,
    created.config.outputPaths.agile,
    'stories',
    'US-001-login.md',
  );
  writeFileSync(storyPath, STORY);
  return { created, storyPath };
}

function run(projectDir: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [TSX, CLI, '--project-dir', projectDir, ...args], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function rejected(result: SpawnSyncReturns<string>, argument: string, received: string): void {
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`E_ARTIFACT_ID_INVALID: <${argument}> must be an artifact id`);
  expect(result.stderr).toContain(`received ${JSON.stringify(received)}.`);
  expect(`${result.stdout}${result.stderr}`).not.toMatch(/\n\s+at\s|SyntaxError/u);
}

afterEach(() => {
  for (const created of projects.splice(0)) created.cleanup();
});

describe('positional artifact ids at the CLI boundary', { timeout: 30_000 }, () => {
  it('still shows an artifact by its exact id', async () => {
    const { created } = await project();
    const result = run(created.dir, ['story', 'show', 'US-001']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('# US-001: Login');
  });

  it('rejects ids that would match another artifact or crash the lookup', async () => {
    const { created } = await project();
    for (const hostile of ['.*', '(']) {
      const result = run(created.dir, ['story', 'show', hostile]);
      rejected(result, 'id', hostile);
      expect(result.stdout).not.toContain('Login');
    }
  });

  it('writes nothing when an update names a pattern instead of an id', async () => {
    const { created, storyPath } = await project();
    rejected(run(created.dir, ['update', 'US-00.', '--status', 'done']), 'ids', 'US-00.');
    rejected(run(created.dir, ['story', 'update', 'US-00.', '--status', 'done']), 'id', 'US-00.');
    expect(readFileSync(storyPath, 'utf8')).toBe(STORY);
  });

  it('no longer resolves a bare prefix to the first spec', async () => {
    const { created } = await project();
    const specDir = path.join(
      created.dir,
      created.config.outputPaths.agile,
      'specs',
      'SPEC-001-alpha',
    );
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      path.join(specDir, 'SPEC-001-alpha.md'),
      '---\nid: "SPEC-001"\ntitle: "Alpha"\nstatus: "pending"\n---\n# Alpha\n',
    );
    const result = run(created.dir, ['spec', 'show', 'SPEC']);
    rejected(result, 'specId', 'SPEC');
    expect(result.stdout).not.toContain('Alpha');
  });

  it('returns the bounded JSON envelope when the command asked for JSON', async () => {
    const { created } = await project();
    const result = run(created.dir, ['sprint', 'close', '(', '--json']);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      code: 'E_ARTIFACT_ID_INVALID',
      problem:
        '<id> must be an artifact id such as SPRINT-001 (uppercase prefix, hyphen, three or more digits); received "(".',
    });
  });
});
