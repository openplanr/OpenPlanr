import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { discoverVerificationChecks } from '../../packages/skill-runtime/src/verification/discover-checks.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-verification-'));
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, '.planr', 'specs', 'SPEC-001-x', 'tasks'), { recursive: true });
  const taskPath = join(root, '.planr', 'specs', 'SPEC-001-x', 'tasks', 'T-001-x.md');
  writeFileSync(taskPath, [
    '# T-001', '', '## Test Requirements', '',
    'Run `npm run test:focused` and then:', '', '```bash', 'npm run typecheck', '```', '',
    '## Definition of Done', '', '`npm run unrelated`', '',
  ].join('\n'));
  writeFileSync(join(root, 'AGENTS.md'), 'Use `npm run lint` before completion.\n');
  writeFileSync(join(root, 'package-lock.json'), '{}\n');
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    scripts: { test: 'node --test', 'test:focused': 'node --test focused', lint: 'eslint .', build: 'build' },
  }, null, 2)}\n`);
  writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'steps:\n  - run: npm run build\n');
  return { root, taskPath };
}

test('verification discovery is ordered, deduplicated, and read-only', () => {
  const { root, taskPath } = fixture();
  try {
    const before = readFileSync(taskPath, 'utf8');
    const result = discoverVerificationChecks({ projectRoot: root, taskPath });
    assert.deepEqual(result.checks, [
      { command: 'npm run test:focused', source: 'task-requirements' },
      { command: 'npm run typecheck', source: 'task-requirements' },
      { command: 'npm run lint', source: 'repository-instructions' },
      { command: 'npm run test', source: 'package-task-runner' },
      { command: 'npm run build', source: 'package-task-runner' },
    ]);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(readFileSync(taskPath, 'utf8'), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verification discovery reports a missing task without blocking repository checks', () => {
  const { root } = fixture();
  try {
    const result = discoverVerificationChecks({ projectRoot: root, taskPath: 'missing.md' });
    assert.match(result.diagnostics[0], /Task file not found/u);
    assert.ok(result.checks.some(({ command }) => command === 'npm run test'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
