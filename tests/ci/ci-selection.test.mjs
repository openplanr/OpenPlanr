import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { selectLanes } from '../../scripts/ci/browser-lanes.mjs';
import { changedFiles, suitesFor } from '../../scripts/hooks/pre-push.mjs';

test('Browser selects only the lanes a change reaches', () => {
  assert.deepEqual(selectLanes(['docs/README.md']), {
    canvas: false,
    dashboard: false,
    artifact: false,
  });
  assert.deepEqual(selectLanes(['packages/canvas/src/camera.ts']), {
    canvas: true,
    dashboard: false,
    artifact: false,
  });
  assert.deepEqual(selectLanes(['packages/protocol/src/index.mjs']), {
    canvas: false,
    dashboard: true,
    artifact: false,
  });
  assert.deepEqual(selectLanes(['packages/pipeline/tests/artifact/codec.test.mjs']), {
    canvas: false,
    dashboard: false,
    artifact: true,
  });
  for (const shared of ['package-lock.json', '.github/workflows/browser.yml'])
    assert.deepEqual(selectLanes([shared]), { canvas: true, dashboard: true, artifact: true });
  assert.equal(selectLanes(['packages/canvas-extra/x.ts']).canvas, false);
  assert.equal(selectLanes(['packages/cli/package.json']).canvas, false);
});

test('pre-push runs the small suites of the changed workspaces only', () => {
  assert.deepEqual(suitesFor(['docs/README.md', 'packages/pipeline/lib/x.mjs']), []);
  assert.deepEqual(suitesFor(['tests/protocol/a.test.mjs', 'apps/dashboard/src/a.ts']), [
    '@openplanr/protocol',
    '@openplanr/dashboard-app',
  ]);
  assert.equal(suitesFor(['package-lock.json']).length, 6);
  assert.deepEqual(suitesFor(['packages/cli/src/a.ts', 'packages/design/a.mjs']), []);
});

test('pre-push diffs an existing branch against its remote and a new one against origin/main', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pre-push-'));
  const git = (...args) =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      encoding: 'utf8',
    }).trim();
  try {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'base.txt'), 'base');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    writeFileSync(join(repo, 'first.txt'), 'first');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    const first = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'second.txt'), 'second');
    git('add', '.');
    git('commit', '-q', '-m', 'second');
    const second = git('rev-parse', 'HEAD');
    const zero = '0'.repeat(40);
    const cwd = process.cwd();
    process.chdir(repo);
    try {
      assert.deepEqual(changedFiles([`refs/heads/x ${second} refs/heads/x ${zero}`]).sort(), [
        'first.txt',
        'second.txt',
      ]);
      assert.deepEqual(changedFiles([`refs/heads/x ${second} refs/heads/x ${first}`]), [
        'second.txt',
      ]);
      assert.deepEqual(changedFiles([`(delete) ${zero} refs/heads/x ${first}`]), []);
    } finally {
      process.chdir(cwd);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
