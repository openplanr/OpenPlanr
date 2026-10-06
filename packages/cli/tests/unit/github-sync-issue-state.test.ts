import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/prompt-service.js', () => ({
  promptSelect: vi.fn(async (_message: string, _choices: unknown, defaultValue?: string) => {
    return defaultValue;
  }),
}));

import { registerGitHubCommand } from '../../src/cli/commands/github.js';
import { createDefaultConfig, saveConfig } from '../../src/services/config-service.js';
import { getIssue } from '../../src/services/github-service.js';
import { promptSelect } from '../../src/services/prompt-service.js';
import { parseMarkdown } from '../../src/utils/markdown.js';
import { fakeGh, fakeGhCalls } from '../helpers/fake-gh.js';

/** Linked tasks and the issue state `gh` reports for each: three agree, two differ. */
const LINKED = [
  { id: 'TASK-001', status: 'done', issue: 1, state: 'CLOSED' },
  { id: 'TASK-002', status: 'pending', issue: 2, state: 'CLOSED' },
  { id: 'TASK-003', status: 'done', issue: 3, state: 'OPEN' },
  { id: 'TASK-004', status: 'pending', issue: 4, state: 'OPEN' },
  { id: 'TASK-005', status: 'in-progress', issue: 5, state: 'OPEN' },
];

let bin: string;
let projectDir: string;
let tasksDir: string;
let printed: string[];

function issueJson(issue: number, state: string): string {
  return JSON.stringify({
    number: issue,
    title: `TASK-00${issue}: Linked`,
    state,
    url: `https://github.com/acme/app/issues/${issue}`,
    labels: [{ name: 'planr:task' }],
  });
}

function stubGh(issues: Array<{ issue: number; state: string }>): void {
  fakeGh(bin, {
    'auth status': '',
    'repo view': '{"nameWithOwner":"acme/app"}',
    ...Object.fromEntries(
      issues.map(({ issue, state }) => [`issue view ${issue} `, issueJson(issue, state)]),
    ),
    'issue close ': '',
    'issue reopen ': '',
  });
}

async function runGitHub(...args: string[]): Promise<void> {
  const program = new Command().exitOverride();
  program.option('--project-dir <path>');
  registerGitHubCommand(program);
  await program.parseAsync(['node', 'planr', '--project-dir', projectDir, 'github', ...args]);
}

function localStatus(id: string): unknown {
  const file = readdirSync(tasksDir).find((name) => name.startsWith(`${id}-`));
  if (!file) throw new Error(`no task file for ${id} in ${tasksDir}`);
  return parseMarkdown(readFileSync(join(tasksDir, file), 'utf8')).data.status;
}

function stateChanges(): string[] {
  return fakeGhCalls(bin).filter((call) => /^issue (close|reopen) /.test(call));
}

beforeEach(async () => {
  bin = mkdtempSync(join(tmpdir(), 'openplanr-fake-gh-'));
  vi.stubEnv('PATH', `${bin}${delimiter}${process.env.PATH ?? ''}`);
  projectDir = mkdtempSync(join(tmpdir(), 'openplanr-github-sync-'));
  tasksDir = join(projectDir, '.planr', 'tasks');
  mkdirSync(tasksDir, { recursive: true });
  for (const { id, status, issue } of LINKED) {
    writeFileSync(
      join(tasksDir, `${id}-linked.md`),
      `---\nid: "${id}"\ntitle: "Linked"\nstatus: "${status}"\ngithubIssue: ${issue}\n---\n# ${id}: Linked\n`,
    );
  }
  await saveConfig(projectDir, createDefaultConfig('github-sync'));
  stubGh(LINKED);
  printed = [];
  vi.mocked(promptSelect).mockClear();
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    printed.push(stripVTControlCharacters(args.map(String).join(' ')));
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(bin, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('openplanr github sync reads gh issue states', () => {
  it('pulls a closed issue as done and a reopened one as in-progress, leaving open work as it is', async () => {
    await runGitHub('sync', '--direction', 'pull');

    expect(LINKED.map(({ id }) => [id, localStatus(id)])).toEqual([
      ['TASK-001', 'done'],
      ['TASK-002', 'done'],
      ['TASK-003', 'in-progress'],
      ['TASK-004', 'pending'],
      ['TASK-005', 'in-progress'],
    ]);
  });

  it('pushes only the state changes an issue needs', async () => {
    await runGitHub('sync', '--direction', 'push');

    expect(stateChanges()).toEqual(['issue reopen 2', 'issue close 3']);
    expect(LINKED.map(({ id }) => localStatus(id))).toEqual([
      'done',
      'pending',
      'done',
      'pending',
      'in-progress',
    ]);
  });

  it('reports a conflict only where the local status and the issue state differ', async () => {
    await runGitHub('sync');

    expect(printed.filter((line) => line.includes('local:'))).toEqual([
      '  ! TASK-002 — local: pending, GitHub #2: closed (done)',
      '  ! TASK-003 — local: done, GitHub #3: open (in-progress)',
    ]);
    expect(
      vi.mocked(promptSelect).mock.calls.map(([message, choices]) => [message, choices[0]]),
    ).toEqual([
      ['  Resolve TASK-002:', { name: 'Use GitHub status (done)', value: 'pull' }],
      ['  Resolve TASK-003:', { name: 'Use GitHub status (in-progress)', value: 'pull' }],
    ]);
    expect(stateChanges()).toEqual([]);
  });

  it('keeps a planning epic with an open issue and closes out one whose issue closed', async () => {
    const epicsDir = join(projectDir, '.planr', 'epics');
    mkdirSync(epicsDir, { recursive: true });
    const epics = [
      { id: 'EPIC-001', status: 'planning', issue: 11, state: 'OPEN' },
      { id: 'EPIC-002', status: 'planning', issue: 12, state: 'CLOSED' },
    ];
    for (const { id, status, issue } of epics) {
      writeFileSync(
        join(epicsDir, `${id}-linked.md`),
        `---\nid: "${id}"\ntitle: "Linked epic"\nstatus: "${status}"\ngithubIssue: ${issue}\n---\n# ${id}: Linked epic\n`,
      );
    }
    stubGh([...LINKED, ...epics]);

    await runGitHub('sync', '--direction', 'pull');

    const epicStatus = (id: string) =>
      parseMarkdown(readFileSync(join(epicsDir, `${id}-linked.md`), 'utf8')).data.status;
    expect(epics.map(({ id }) => [id, epicStatus(id)])).toEqual([
      ['EPIC-001', 'planning'],
      ['EPIC-002', 'done'],
    ]);
  });

  it('shows each issue state in openplanr github status and marks an unreadable issue out of sync', async () => {
    stubGh(LINKED.filter(({ issue }) => issue !== 4));

    await runGitHub('status');

    expect(
      printed.filter((line) => line.includes(' #')).map((line) => line.trim().split(/\s+/u)),
    ).toEqual([
      ['TASK-001', 'done', '#1', 'closed', '✓'],
      ['TASK-002', 'pending', '#2', 'closed', '✗'],
      ['TASK-003', 'done', '#3', 'open', '✗'],
      ['TASK-004', 'pending', '#4', 'error', '✗'],
      ['TASK-005', 'in-progress', '#5', 'open', '✓'],
    ]);
  });

  it('reads an issue state in any case and a merged pull request as closed', async () => {
    stubGh([
      { issue: 1, state: 'Closed' },
      { issue: 2, state: 'open' },
      { issue: 3, state: 'MERGED' },
    ]);

    expect((await getIssue(1)).state).toBe('closed');
    expect((await getIssue(2)).state).toBe('open');
    expect((await getIssue(3)).state).toBe('closed');
  });

  it('rejects an issue state gh does not document, naming the command and the field', async () => {
    stubGh([{ issue: 1, state: 'DRAFT' }]);

    await expect(getIssue(1)).rejects.toThrow(
      'gh issue view has an unexpected shape: state: Invalid option: expected one of "open"|"closed"|"merged"',
    );
  });
});
