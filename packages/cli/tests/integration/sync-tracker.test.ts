import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeGh, fakeGhCalls, fakeGhEnvironments } from '../helpers/fake-gh.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

const CLI = path.resolve('src/cli/index.ts');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const REPOSITORY = '{"nameWithOwner":"acme/app","url":"https://github.com/acme/app"}';
const projects: TestProject[] = [];

async function setup(responses: Record<string, string> = {}) {
  const project = await createTestProject('sync-tracker');
  projects.push(project);
  const bin = path.join(project.dir, '.bin');
  mkdirSync(bin);
  fakeGh(bin, responses);
  const run = (args: string[], input?: string): SpawnSyncReturns<string> =>
    spawnSync(process.execPath, [TSX, CLI, '--project-dir', project.dir, ...args], {
      cwd: project.dir,
      encoding: 'utf8',
      input,
      env: {
        ...process.env,
        NO_COLOR: '1',
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
        FOO_TOKEN: 'must-not-reach-gh',
        GH_TOKEN: 'gh-own-token',
      },
    });
  return { project, bin, run };
}

function json(result: SpawnSyncReturns<string>): Record<string, unknown> {
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

afterEach(() => {
  for (const project of projects.splice(0)) project.cleanup();
});

describe('openplanr sync tracker', { timeout: 60_000 }, () => {
  it('previews a GitHub batch from stdin without running gh', async () => {
    const { bin, run } = await setup();
    const operations = [
      { action: 'create', title: 'Add sign-in', labels: ['planr:feature'] },
      { action: 'close', id: 12 },
    ];
    const result = run(
      ['sync', 'tracker', 'github', 'sync', '--input', '-', '--json'],
      JSON.stringify(operations),
    );
    expect(result.status, result.stderr).toBe(0);
    expect(json(result)).toEqual({
      ok: true,
      contract: 1,
      provider: 'github',
      action: 'sync',
      applied: false,
      complete: true,
      results: [
        { index: 0, action: 'create', title: 'Add sign-in', status: 'planned' },
        { index: 1, action: 'close', id: '12', status: 'planned' },
      ],
      next: expect.stringContaining('--apply'),
    });
    expect(fakeGhCalls(bin)).toEqual([]);
  });

  it('applies through gh with an explicit environment that leaves FOO_TOKEN out', async () => {
    const { project, bin, run } = await setup({
      'issue create': 'https://github.com/acme/app/issues/31\n',
      'issue close 12': 'https://github.com/acme/app/issues/12\n',
    });
    const input = path.join(project.dir, 'operations.json');
    writeFileSync(
      input,
      JSON.stringify([
        { action: 'create', title: 'Add sign-in', body: 'From FEAT-001' },
        { action: 'close', id: '12', comment: 'Done in FEAT-002' },
      ]),
    );
    const result = run([
      'sync',
      'tracker',
      'github',
      'sync',
      '--input',
      'operations.json',
      '--apply',
      '--json',
    ]);
    expect(result.status, result.stderr).toBe(0);
    const value = json(result);
    expect(value).toMatchObject({ ok: true, applied: true, complete: true });
    expect(value.results).toEqual([
      {
        index: 0,
        action: 'create',
        title: 'Add sign-in',
        id: '31',
        url: 'https://github.com/acme/app/issues/31',
        status: 'applied',
      },
      {
        index: 1,
        action: 'close',
        id: '12',
        url: 'https://github.com/acme/app/issues/12',
        status: 'applied',
      },
    ]);
    expect(fakeGhCalls(bin)).toEqual([
      'issue create --title Add sign-in --body From FEAT-001',
      'issue close 12 --comment Done in FEAT-002',
    ]);
    for (const names of fakeGhEnvironments(bin)) {
      expect(names).not.toContain('FOO_TOKEN');
      expect(names).toContain('GH_TOKEN');
      expect(names).toContain('GH_PROMPT_DISABLED');
    }
  });

  it('reports which changes applied when gh fails part way', async () => {
    const { run } = await setup({ 'issue reopen 4': 'https://github.com/acme/app/issues/4\n' });
    const result = run(
      ['sync', 'tracker', 'github', 'sync', '--input', '-', '--apply', '--json'],
      JSON.stringify([
        { action: 'reopen', id: '4' },
        { action: 'update', id: '5', title: 'Renamed' },
        { action: 'close', id: '6' },
      ]),
    );
    expect(result.status).toBe(1);
    const value = json(result);
    expect(value).toMatchObject({
      ok: false,
      code: 'E_SYNC_TRACKER_APPLY_INCOMPLETE',
      applied: true,
      complete: false,
    });
    expect(value.problem).toMatch(
      /1 of 3 issue changes applied; operation 1 \(update #5\) failed/u,
    );
    expect((value.results as Array<{ status: string }>).map(({ status }) => status)).toEqual([
      'applied',
      'failed',
      'not-run',
    ]);
    expect(value.recovery).toMatch(/operations 1, 2/u);
  });

  it('inspects the GitHub repository and the local planning roots', async () => {
    const { run } = await setup({ 'repo view': REPOSITORY });
    const github = run(['sync', 'tracker', 'github', 'inspect', '--json']);
    expect(github.status, github.stderr).toBe(0);
    expect(json(github)).toMatchObject({
      ok: true,
      contract: 1,
      provider: 'github',
      action: 'inspect',
      repository: { nameWithOwner: 'acme/app' },
      next: expect.stringContaining('sync tracker github sync'),
    });
    const local = run(['sync', 'tracker', 'local', 'inspect', '--json']);
    expect(json(local)).toMatchObject({ ok: true, roots: ['.planr'], configured: true });
  });

  it('prints a short human result that ends with the next step', async () => {
    const { run } = await setup();
    const result = run(
      ['sync', 'tracker', 'github', 'sync', '--input', '-'],
      JSON.stringify([{ action: 'update', id: '9', title: 'Renamed' }]),
    );
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines[0]).toBe('GitHub sync preview: 1 issue change, nothing applied');
    expect(lines).toContain('  planned  update  #9 "Renamed"');
    expect(lines.at(-1)).toMatch(/^Next: /u);
  });

  it('refuses bad input with a code, the input it read, and a recovery', async () => {
    const { run } = await setup();
    const cases: Array<[string[], string | undefined, string, RegExp]> = [
      [['github', 'sync', '--json'], undefined, 'E_SYNC_TRACKER_USAGE', /--input/u],
      [['github', 'sync', '--input', '-', '--json'], '{not json', 'E_SYNC_TRACKER_INPUT', /stdin/u],
      [
        ['github', 'sync', '--input', 'missing.json', '--json'],
        undefined,
        'E_SYNC_TRACKER_INPUT',
        /missing\.json/u,
      ],
      [['linear', 'sync', '--json'], undefined, 'E_SYNC_TRACKER_LINEAR', /Linear connection/u],
      [['local', 'sync', '--json'], undefined, 'E_SYNC_TRACKER_USAGE', /openplanr sync/u],
      [['jira', 'inspect', '--json'], undefined, 'E_SYNC_TRACKER_USAGE', /local, github/u],
      [
        ['github', 'sync', '--input', '-', '--json'],
        '[{"action":"create","title":""}]',
        'E_SYNC_TRACKER_INPUT',
        /non-empty "title"/u,
      ],
    ];
    for (const [args, input, code, pattern] of cases) {
      const result = run(['sync', 'tracker', ...args], input);
      expect(result.status, args.join(' ')).toBe(1);
      const value = json(result);
      expect(value, args.join(' ')).toMatchObject({ ok: false, code });
      expect(`${value.problem} ${value.recovery}`, args.join(' ')).toMatch(pattern);
    }
  });

  it('refuses an issue URL from another repository before changing anything', async () => {
    const { bin, run } = await setup({ 'repo view': REPOSITORY });
    const result = run(
      ['sync', 'tracker', 'github', 'sync', '--input', '-', '--apply', '--json'],
      JSON.stringify([{ action: 'close', id: 'https://github.com/other/app/issues/4' }]),
    );
    expect(result.status).toBe(1);
    expect(json(result)).toMatchObject({ ok: false, code: 'E_SYNC_TRACKER_FOREIGN_ISSUE' });
    expect(fakeGhCalls(bin)).toEqual(['repo view --json nameWithOwner,url']);
  });

  it('keeps openplanr sync repairing local cross-references', async () => {
    const { run } = await setup();
    const result = run(['sync', '--dry-run']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Nothing to fix');
  });
});
