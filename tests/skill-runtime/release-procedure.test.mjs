import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const skillDir = join(root, 'skills/planr-release');
const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
const oracle = join(import.meta.dirname, 'fixtures/release/collect_changes.sh');

const bundles = [
  ['claude', 'dist/plugins/claude/openplanr', 'skills/release'],
  ['openai', 'dist/plugins/openai/openplanr', 'skills/release'],
  ['cursor', 'dist/plugins/cursor/openplanr', 'rules/planr-release'],
];

function filesUnder(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

test('the release skill ships no change-collection script', () => {
  const manifest = JSON.parse(readFileSync(join(skillDir, 'openplanr.skill.json'), 'utf8'));
  assert.deepEqual(
    manifest.resources.filter(({ kind, path }) => kind === 'script' || path.startsWith('scripts/')),
    [],
  );
  assert.equal(existsSync(join(skillDir, 'scripts')), false);
  assert.doesNotMatch(skill, /scripts\/|collect_changes|\bnpx\b|\bnode\b/);
  for (const [host, bundle, release] of bundles) {
    assert.ok(existsSync(join(root, bundle, release)), `${host} bundle lacks ${release}`);
    const shipped = filesUnder(join(root, bundle)).filter((path) =>
      path.endsWith('collect_changes.sh'),
    );
    assert.deepEqual(shipped, [], `${host} bundle still ships the change collector`);
  }
});

/** The backticked `git` command the procedure names, that starts with `prefix`. */
function procedureCommand(prefix) {
  const commands = [...skill.matchAll(/`(git [^`]+)`/g)].map(([, command]) => command);
  const command = commands.find((candidate) => candidate.startsWith(prefix));
  assert.ok(command, `SKILL.md no longer names a \`${prefix} …\` command`);
  return command;
}

function sh(cwd, command) {
  const result = spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} failed: ${result.stderr}`);
  return result.stdout;
}

const lines = (text) => text.split('\n').filter((line) => line.trim() !== '');

/** Runs Step 1's local steps as written: window, recent tags, commits, areas. */
function followProcedure(cwd, since) {
  let range = '';
  let description = 'all history (no previous tag found)';
  if (since) {
    range = `--since=${since}`;
    description = `since ${since}`;
  } else {
    const tag = spawnSync('sh', ['-c', procedureCommand('git describe')], {
      cwd,
      encoding: 'utf8',
    });
    if (tag.status === 0) {
      const last = tag.stdout.trim();
      const date = sh(cwd, procedureCommand('git log -1').replace('<tag>', last)).trim();
      range = `${last}..HEAD`;
      description = `since ${last} (${date})`;
    }
  }
  const withRange = (command) => command.replace('<range>', range);
  const counts = new Map();
  for (const path of lines(sh(cwd, withRange(procedureCommand('git log <range> --name-only'))))) {
    const area = path.split('/').slice(0, 2).join('/');
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return {
    description,
    tags: lines(sh(cwd, procedureCommand('git tag --list'))).slice(0, 5),
    commits: lines(sh(cwd, withRange(procedureCommand('git log <range> --no-merges')))),
    areas: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 20),
  };
}

function runOracle(cwd, since) {
  const result = spawnSync('bash', [oracle, ...(since ? [since] : [])], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const sections = new Map();
  let current = 'header';
  for (const line of result.stdout.split('\n')) {
    const heading = /^--- (.+?)(?: \(.*\))? ---$/.exec(line);
    if (heading) current = heading[1];
    else if (line.trim() && !line.startsWith('===='))
      sections.set(current, [...(sections.get(current) ?? []), line]);
  }
  return {
    description: sections.get('header')[0].replace(/^Changes /, ''),
    tags: (sections.get('Recent tags') ?? []).filter((line) => line !== 'none'),
    commits: sections.get('Commits') ?? [],
    areas: (sections.get('Files touched, by area') ?? []).map((line) => {
      const [, count, area] = /^\s*(\d+) (.+)$/.exec(line);
      return [area, Number(count)];
    }),
  };
}

function fixtureRepo(t, { tagged }) {
  const cwd = mkdtempSync(join(tmpdir(), 'release-procedure-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    sh(
      cwd,
      ['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', ...args]
        .map((arg) => `'${arg}'`)
        .join(' '),
    );
  const commit = (message, files) => {
    for (const path of files) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), `${message} ${path}\n`);
    }
    git('add', '-A');
    git('commit', '-q', '-m', message);
  };
  git('init', '-q', '-b', 'main');
  commit('chore: start', ['README.md']);
  if (tagged) {
    git('tag', 'v1.0.0');
    commit('feat: add export', ['src/cli/export.ts']);
    git('tag', 'v1.1.0');
  }
  commit('feat: add import', ['src/cli/import.ts', 'src/cli/run.ts', 'src/cli/flags.ts']);
  commit('feat: add help', ['src/cli/help.ts']);
  commit('fix: keep config order', [
    'packages/core/lib/config.js',
    'packages/core/lib/order.js',
    'packages/core/lib/load.js',
    'packages/core/lib/save.js',
    'packages/core/test/config.test.js',
    'packages/core/test/order.test.js',
  ]);
  git('checkout', '-q', '-b', 'docs');
  commit('docs: document import', [
    'docs/guide/import.md',
    'docs/guide/help.md',
    'docs/guide/index.md',
  ]);
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '-m', 'Merge docs', 'docs');
  commit('chore: bump readme', ['README.md']);
  return cwd;
}

for (const [name, options, since] of [
  ['since the last tag', { tagged: true }],
  ['since a date', { tagged: true }, '2000-01-01'],
  ['with no tag', { tagged: false }],
]) {
  test(`the written procedure collects what the oracle script collected, ${name}`, (t) => {
    const cwd = fixtureRepo(t, options);
    const expected = runOracle(cwd, since);
    assert.ok(expected.commits.length > 0);
    assert.deepEqual(followProcedure(cwd, since), expected);
  });
}

test("the procedure keeps the oracle script's closing reminder", () => {
  for (const phrase of ['feature-flag', 'infrastructure', 'other repositories', 'user-visible'])
    assert.match(skill, new RegExp(phrase));
});
