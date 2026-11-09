import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const skill = read('skills/planr-release/SKILL.md');

test('a notes-only request changes no file, bumps no version and runs no tests', () => {
  assert.match(skill, /changes no file, bumps no version and runs no tests/);
  const prepare = skill.indexOf('## Step 5: Prepare the local release');
  assert.ok(prepare > 0);
  assert.match(skill, /Only when the user asks to prepare or cut a release/);
  const beforePrepare = skill.slice(0, prepare);
  for (const write of [/npm version/, /Prepend the new section/, /release checks/]) {
    assert.doesNotMatch(beforePrepare.replace(/^\|.*\|$/gm, ''), write);
  }
});

test('scheme choice, cadence and health sit behind references', () => {
  assert.doesNotMatch(skill, /## Long-term health|Drift check|Stuck at 0\.x/);
  assert.doesNotMatch(skill, /## Step 5: Cadence|rolling `## \[Unreleased\]`/);
  assert.match(skill, /Choose a scheme and write a profile only on first-time setup/);
  const cadence = read('skills/planr-release/references/cadence.md');
  assert.match(cadence, /Long-term health/);
  assert.match(cadence, /Drift check/);
  assert.ok(Buffer.byteLength(skill) <= 8000, `SKILL.md is ${Buffer.byteLength(skill)} bytes`);
});

test('collection names a base revision, reads bodies and footers, and surfaces git failures', () => {
  assert.match(skill, /`git rev-parse <tag>`/);
  assert.match(skill, /`git rev-parse HEAD`/);
  assert.match(skill, /--pretty=format:'--- %h%n%b'/);
  assert.match(skill, /`BREAKING CHANGE:` footer/);
  assert.match(skill, /check its exit status/);
  assert.match(skill, /never read it as an empty window/);
});

test('the bodies command surfaces a footer-only breaking change the subject hides', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'release-bodies-'));
  try {
    const sh = (command) => {
      const result = spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8' });
      assert.equal(result.status, 0, `${command}: ${result.stderr}`);
      return result.stdout;
    };
    sh('git init -q -b main');
    writeFileSync(join(cwd, 'a'), '1');
    sh(
      "git add -A && git -c user.name=F -c user.email=f@example.com commit -q -m 'chore: start' && git tag v1.0.0",
    );
    writeFileSync(join(cwd, 'a'), '2');
    sh(
      "git add -A && git -c user.name=F -c user.email=f@example.com commit -q -m 'fix: tighten parser' -m 'BREAKING CHANGE: empty input is rejected'",
    );
    const command = /`(git log <range> --no-merges --pretty=format:'--- %h%n%b')`/.exec(skill)?.[1];
    assert.ok(command, 'SKILL.md names no bodies command');
    const bodies = sh(command.replace('<range>', 'v1.0.0..HEAD'));
    assert.match(bodies, /BREAKING CHANGE: empty input is rejected/);
    const subjects = sh("git log v1.0.0..HEAD --no-merges --pretty=format:'%h %s'");
    assert.doesNotMatch(subjects, /BREAKING/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
