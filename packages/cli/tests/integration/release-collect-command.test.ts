import { execFileSync, type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = path.resolve('src/cli/index.ts');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const roots: string[] = [];

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV },
  }).trim();
}

function repo(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'openplanr-release-collect-'));
  roots.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  return root;
}

function commit(root: string, file: string, message: string): string {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), `${message}\n${Math.random()}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function run(cwd: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [TSX, CLI, '--project-dir', cwd, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV, NO_COLOR: '1' },
  });
}

interface CollectJson {
  ok: boolean;
  base: { revision: string; sha: string; tag: string | null; date: string } | null;
  head: { revision: string; sha: string };
  tags: string[];
  commits: Array<{
    sha: string;
    subject: string;
    body: string;
    type: string | null;
    breaking: boolean;
    breakingNotes: string[];
    reverts: string | null;
    files: string[];
  }>;
  areas: Array<{ area: string; count: number }>;
}

function collect(cwd: string, args: string[] = []): { status: number | null; report: CollectJson } {
  const result = run(cwd, ['release', 'collect', '--json', ...args]);
  return { status: result.status, report: JSON.parse(result.stdout) as CollectJson };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('openplanr release collect', { timeout: 60_000 }, () => {
  it('collects from the last tag with bodies, footers, reverts and areas', () => {
    const root = repo();
    commit(root, 'README.md', 'chore: start');
    git(root, ['tag', 'v1.0.0']);
    const base = git(root, ['rev-parse', 'v1.0.0']);
    commit(root, 'src/cli/run.ts', 'feat(cli): add run\n\nRuns things.');
    const dropped = commit(
      root,
      'src/api/old.ts',
      'refactor(api): drop old route\n\nBREAKING CHANGE: the /old route is gone.',
    );
    commit(root, 'src/api/new.ts', 'feat(api)!: rename the session field');
    const reverted = commit(root, 'src/cli/flag.ts', 'fix(cli): toggle flag');
    commit(
      root,
      'src/cli/flag.ts',
      `Revert "fix(cli): toggle flag"\n\nThis reverts commit ${reverted}.`,
    );
    const head = git(root, ['rev-parse', 'HEAD']);

    const { status, report } = collect(root);
    expect(status).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.base).toEqual({
      revision: 'v1.0.0',
      sha: base,
      tag: 'v1.0.0',
      date: git(root, ['log', '-1', '--format=%cs', 'v1.0.0']),
    });
    expect(report.head).toEqual({ revision: 'HEAD', sha: head });
    expect(report.tags).toEqual(['v1.0.0']);
    expect(report.commits.map((entry) => entry.subject)).toEqual([
      'Revert "fix(cli): toggle flag"',
      'fix(cli): toggle flag',
      'feat(api)!: rename the session field',
      'refactor(api): drop old route',
      'feat(cli): add run',
    ]);
    const byShaOf = (sha: string) => report.commits.find((entry) => entry.sha === sha);
    expect(byShaOf(dropped)).toMatchObject({
      type: 'refactor',
      breaking: true,
      breakingNotes: ['the /old route is gone.'],
    });
    expect(report.commits[2]).toMatchObject({ type: 'feat', breaking: true });
    expect(report.commits[0].reverts).toBe(reverted);
    expect(report.commits[4]).toMatchObject({ body: 'Runs things.', files: ['src/cli/run.ts'] });
    expect(report.areas).toEqual([
      { area: 'src/cli', count: 3 },
      { area: 'src/api', count: 2 },
    ]);
  });

  it('honours explicit base and head revisions', () => {
    const root = repo();
    const first = commit(root, 'a.md', 'chore: one');
    const second = commit(root, 'b.md', 'feat: two');
    commit(root, 'c.md', 'feat: three');
    const { status, report } = collect(root, ['--base', first, '--head', second]);
    expect(status).toBe(0);
    expect(report.base).toMatchObject({ revision: first, sha: first, tag: null });
    expect(report.base?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(report.head).toEqual({ revision: second, sha: second });
    expect(report.commits.map((entry) => entry.subject)).toEqual(['feat: two']);
  });

  it('uses all history when the repository has no tag', () => {
    const root = repo();
    commit(root, 'a.md', 'chore: one');
    commit(root, 'b.md', 'feat: two');
    const { status, report } = collect(root);
    expect(status).toBe(0);
    expect(report.base).toBeNull();
    expect(report.tags).toEqual([]);
    expect(report.commits).toHaveLength(2);
  });

  it('fails with the git error for an unknown base instead of an empty window', () => {
    const root = repo();
    commit(root, 'a.md', 'chore: one');
    const result = run(root, ['release', 'collect', '--json', '--base', 'v9.9.9']);
    expect(result.status).toBe(1);
    const failure = JSON.parse(result.stdout) as { ok: boolean; code: string; problem: string };
    expect(failure.code).toBe('E_RELEASE_GIT_FAILED');
    expect(failure.problem).toContain('v9.9.9');
  });

  it('captures a multi-line breaking footer up to the next footer token', () => {
    const root = repo();
    commit(
      root,
      'a.md',
      'fix: tighten parser\n\nBody text.\n\nBREAKING CHANGE: empty input is rejected\nand whitespace-only input too.\nRefs: #12',
    );
    const { status, report } = collect(root);
    expect(status).toBe(0);
    expect(report.commits[0].breakingNotes).toEqual([
      'empty input is rejected\nand whitespace-only input too.',
    ]);
  });

  it('rejects a --since that is not a calendar date', () => {
    const root = repo();
    commit(root, 'a.md', 'chore: one');
    for (const since of ['2026-02-30', '2026-13-01', 'yesterday']) {
      const result = run(root, ['release', 'collect', '--json', '--since', since]);
      expect(result.status, since).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ code: 'E_RELEASE_SINCE_INVALID' });
    }
    expect(collect(root, ['--since', '2024-02-29']).status).toBe(0);
  });

  it('fails outside a git repository', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'openplanr-release-nogit-'));
    roots.push(root);
    const result = run(root, ['release', 'collect']);
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('E_RELEASE_GIT_FAILED');
  });
});
