import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const AGGREGATES = [
  'adapters/manifests/ecosystem-assets.json',
  'adapters/manifests/generated-assets.json',
  'adapters/manifests/skill-footprint.json',
  'ecosystem.json',
];

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=OpenPlanr', '-c', 'user.email=ci@openplanr.dev', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

test('digest aggregates over generated skill outputs are ignored, not tracked', () => {
  assert.equal(git(repository, 'ls-files', '--', ...AGGREGATES), '');
  assert.deepEqual(
    git(repository, 'check-ignore', ...AGGREGATES)
      .trim()
      .split('\n'),
    AGGREGATES,
  );
});

// Generators read the workspace's installed dependencies and earlier generation steps, so the
// clone borrows node_modules and copies the ignored outputs, as the CI build artifact does.
function cloneWithOutputs(t) {
  const clone = mkdtempSync(join(tmpdir(), 'openplanr-aggregate-merge-'));
  t.after(() => rmSync(clone, { recursive: true, force: true }));
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', repository, clone]);
  git(clone, 'checkout', '--quiet', '-B', 'base', git(repository, 'rev-parse', 'HEAD').trim());
  symlinkSync(join(repository, 'node_modules'), join(clone, 'node_modules'));
  for (const name of readdirSync(join(repository, 'packages'))) {
    try {
      symlinkSync(
        join(repository, 'packages', name, 'node_modules'),
        join(clone, 'packages', name, 'node_modules'),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const ignored = git(
    repository,
    'ls-files',
    '-z',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
  )
    .split('\0')
    .filter(
      (path) =>
        path && !/(^|\/)node_modules(\/|$)/u.test(path) && !/^\.(claude|planr)\//u.test(path),
    );
  execFileSync('tar', ['--null', '-T', '-', '-cf', join(clone, '.outputs.tar')], {
    cwd: repository,
    input: ignored.join('\0'),
  });
  execFileSync('tar', ['-xf', '.outputs.tar'], { cwd: clone });
  rmSync(join(clone, '.outputs.tar'));
  return clone;
}

function regenerate(cwd) {
  for (const script of [
    'scripts/skills/generate-v18.mjs',
    'scripts/marketplace/generate-ecosystem.mjs',
  ]) {
    execFileSync(process.execPath, [script, '--write'], { cwd, stdio: 'ignore' });
  }
}

function commitAll(cwd, message) {
  git(cwd, 'add', '--all', '--', '.', ':!node_modules', ':!packages/*/node_modules');
  git(cwd, 'commit', '--quiet', '--allow-empty', '--no-verify', '-m', message);
}

test('two branches that change different skills merge without conflicts', {
  timeout: 180_000,
}, (t) => {
  const clone = cloneWithOutputs(t);
  regenerate(clone);
  commitAll(clone, 'base');
  for (const [branch, skill] of [
    ['first', 'planr-artifact'],
    ['second', 'planr-browser-qa'],
  ]) {
    git(clone, 'checkout', '--quiet', '-b', branch, 'base');
    appendFileSync(join(clone, 'skills', skill, 'SKILL.md'), `\nA ${branch} branch change.\n`);
    regenerate(clone);
    commitAll(clone, branch);
  }
  git(clone, 'merge', '--quiet', '--no-edit', 'first');
  assert.equal(git(clone, 'diff', '--name-only', '--diff-filter=U'), '');
});
