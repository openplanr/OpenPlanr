import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { selectLanes } from '../../scripts/ci/browser-lanes.mjs';
import { changedFiles, suitesFor } from '../../scripts/hooks/pre-push.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

for (const scenario of ['safe-fix warning', 'partially staged source', 'formatting error']) {
  test(`pre-commit preserves source and pins with ${scenario}`, () => {
    const repo = mkdtempSync(join(tmpdir(), 'pre-commit-'));
    const git = (...args) =>
      execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        encoding: 'utf8',
      });
    const sourcePath = 'packages/pipeline/lib/source.mjs';
    const pinPath = 'packages/pipeline/lib/pins.json';
    const digest = (source) => createHash('sha256').update(source).digest('hex');
    const writeSourceAndPin = (source) => {
      writeFileSync(join(repo, sourcePath), source);
      writeFileSync(join(repo, pinPath), `{ "sha256": "${digest(source)}" }\n`);
    };
    try {
      git('init', '-q');
      git('config', 'core.hooksPath', '/dev/null');
      mkdirSync(join(repo, 'packages/pipeline/lib'), { recursive: true });
      for (const file of ['.lintstagedrc.mjs', 'biome.jsonc'])
        copyFileSync(join(root, file), join(repo, file));
      writeSourceAndPin('export const hasPreserve = () => false;\n');
      git('add', '.');
      git('commit', '-q', '-m', 'fixture');
      symlinkSync(join(root, 'node_modules'), join(repo, 'node_modules'), 'dir');
      symlinkSync(join(root, 'scripts'), join(repo, 'scripts'), 'dir');
      writeSourceAndPin(
        scenario === 'formatting error'
          ? 'export const hasPreserve=(value)=>Object.hasOwn(value,"preserve")\n'
          : "export const hasPreserve = (value) => Object.prototype.hasOwnProperty.call(value, 'preserve');\n",
      );
      git('add', sourcePath, pinPath);
      if (scenario === 'partially staged source')
        writeFileSync(
          join(repo, sourcePath),
          readFileSync(join(repo, sourcePath), 'utf8') + "export const note = 'unstaged';\n",
        );
      const staged = git('diff', '--cached', '--binary');
      const unstaged = git('diff', '--binary');
      const source = readFileSync(join(repo, sourcePath), 'utf8');
      const pin = readFileSync(join(repo, pinPath), 'utf8');
      const result = spawnSync('sh', [join(root, '.husky/pre-commit')], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${join(root, 'node_modules/.bin')}:${process.env.PATH}` },
      });
      assert.ifError(result.error);
      assert.equal(
        result.status,
        scenario === 'formatting error' ? 1 : 0,
        result.stdout + result.stderr,
      );
      assert.equal(git('diff', '--cached', '--binary'), staged);
      assert.equal(git('diff', '--binary'), unstaged);
      assert.equal(readFileSync(join(repo, sourcePath), 'utf8'), source);
      assert.equal(readFileSync(join(repo, pinPath), 'utf8'), pin);
      assert.equal(
        JSON.parse(git('show', `:${pinPath}`)).sha256,
        digest(git('show', `:${sourcePath}`)),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
}

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
  for (const editor of [
    'packages/artifact/lib/artifact/ui/diagram-editor-canvas.mts',
    'packages/artifact/lib/artifact/ui/stage.mjs',
    'packages/artifact/tests/diagram-editor-canvas.browser.test.mjs',
    'packages/artifact/tests/fixtures/diagram-editor-canvas.mjs',
  ])
    assert.deepEqual(selectLanes([editor]), { canvas: true, dashboard: false, artifact: true });
  assert.equal(selectLanes(['packages/artifact/tests/diagram-studio.test.mjs']).canvas, false);
  assert.equal(selectLanes(['packages/artifact/tests/fixtures/other.mjs']).canvas, false);
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
