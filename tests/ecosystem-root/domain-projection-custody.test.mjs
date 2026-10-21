import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-projection-transition-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (target, bytes) => {
    mkdirSync(dirname(join(root, target)), { recursive: true });
    writeFileSync(join(root, target), bytes);
  };
  for (const path of [
    'scripts/domains/project-domains.mjs',
    'scripts/domains/legacy-projection-ownership.json',
    'scripts/lib/generated-ownership.mjs',
  ]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(repositoryRoot, path), join(root, path));
  }
  put('packages/pipeline/package.json', JSON.stringify({ name: 'planr-pipeline' }));
  put('packages/operate/lib/operate/current.mjs', 'export const current = true;\n');
  put('packages/canvas/src/index.mts', 'export const engine = true;\n');
  put('packages/canvas/src/index.mjs', 'export const engine = true;\n');
  put('packages/canvas/src/styles.css', '.canvas { position: relative; }\n');
  const target = join(root, 'packages/pipeline');
  const run = (mode = 'write', domain = 'operate') => {
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'scripts/domains/project-domains.mjs'),
        `--${mode}`,
        '--domain',
        domain,
        '--target',
        target,
      ],
      { encoding: 'utf8' },
    );
    return {
      status: result.status,
      stderr: result.stderr,
      report: result.stdout ? JSON.parse(result.stdout) : null,
    };
  };
  return { root, target, put, run };
}

test('design projection owns the compiled canvas runtime and rewrites its imports', (t) => {
  const { root, target, put, run } = fixture(t);
  for (const directory of ['lib/design-engine', 'templates/studio'])
    mkdirSync(join(root, 'packages/design', directory), { recursive: true });
  put(
    'packages/design/lib/design/ui/studio.mjs',
    [
      "import { engine } from '@openplanr/canvas';",
      "import styles from '@openplanr/canvas/styles.css';",
      'export { engine, styles };',
      '',
    ].join('\n'),
  );
  put('packages/canvas/src/index.d.mts', 'export declare const engine: true;\n');
  for (const path of ['react/index', 'testing/index', 'tests/engine.test'])
    put(`packages/canvas/src/${path}.mts`, 'export const excluded = true;\n');
  for (const path of ['react/index', 'testing/index', 'tests/engine.test'])
    put(`packages/canvas/src/${path}.mjs`, 'export const excluded = true;\n');
  put('packages/canvas/src/overview-worker.mjs', 'export const worker = true;\n');
  const result = run('write', 'design');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(join(target, 'lib/design/ui/studio.mjs'), 'utf8'),
    [
      "import { engine } from '../../canvas/index.mjs';",
      "import styles from '../../canvas/styles.css';",
      'export { engine, styles };',
      '',
    ].join('\n'),
  );
  const manifest = JSON.parse(
    readFileSync(join(target, 'lib/generated/domain-projections/design.json'), 'utf8'),
  );
  const canvas = manifest.entries.filter(({ target }) => target.startsWith('lib/canvas/'));
  assert.deepEqual(
    canvas.map(({ target }) => target),
    ['lib/canvas/index.mjs', 'lib/canvas/overview-worker.mjs', 'lib/canvas/styles.css'],
  );
  for (const entry of canvas) {
    const bytes = readFileSync(join(target, entry.target));
    assert.deepEqual(bytes, readFileSync(join(root, entry.source)));
    assert.equal(digest(bytes), entry.sha256);
  }
  assert.equal(run('check', 'design').status, 0);
  assert.equal(run('write', 'design').report.changedFiles, 0);
  put('packages/pipeline/lib/canvas/index.mjs', 'customer modification\n');
  const conflict = run('write', 'design');
  assert.equal(conflict.status, 1);
  assert.equal(conflict.report.conflicts[0].target, 'lib/canvas/index.mjs');
});

test('design projection requires compiled canvas sources before writing', (t) => {
  const { root, target, run } = fixture(t);
  for (const directory of ['lib/design', 'lib/design-engine', 'templates/studio'])
    mkdirSync(join(root, 'packages/design', directory), { recursive: true });
  rmSync(join(root, 'packages/canvas/src/index.mjs'));
  const result = run('write', 'design');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing compiled packages\/canvas\/src\/index.mjs/u);
  assert.equal(existsSync(join(target, 'lib/canvas/index.mjs')), false);
});

for (const transition of ['pull', 'branch switch']) {
  test(`an unchanged retired projection is removed after a simulated ${transition}`, (t) => {
    const { root, target, put, run } = fixture(t);
    put('packages/operate/lib/operate/old.mjs', 'export const old = true;\n');
    assert.equal(run().status, 0);
    const manifestPath = 'packages/pipeline/lib/generated/domain-projections/operate.json';
    const oldManifest = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'));
    rmSync(join(root, 'packages/operate/lib/operate/old.mjs'));
    // A pull or a branch switch replaces the tracked manifest before regeneration runs.
    put(
      manifestPath,
      JSON.stringify({
        ...oldManifest,
        entries: oldManifest.entries.filter(({ target }) => target !== 'lib/operate/old.mjs'),
      }),
    );
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(target, 'lib/operate/old.mjs')), false);
    assert.equal(run('check').status, 0);
    assert.equal(run().report.changedFiles, 0);
  });
}

test('a modified retired output stays intact after the tracked manifest is replaced', (t) => {
  const { root, target, put, run } = fixture(t);
  put('packages/operate/lib/operate/old.mjs', 'export const old = true;\n');
  assert.equal(run().status, 0);
  const manifestPath = 'packages/pipeline/lib/generated/domain-projections/operate.json';
  const manifest = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'));
  rmSync(join(root, 'packages/operate/lib/operate/old.mjs'));
  put('packages/pipeline/lib/operate/old.mjs', 'customer modification\n');
  put(
    manifestPath,
    JSON.stringify({
      ...manifest,
      entries: manifest.entries.filter(({ target }) => target !== 'lib/operate/old.mjs'),
    }),
  );
  const result = run();
  assert.equal(result.status, 1);
  assert.equal(result.report.conflicts[0].target, 'lib/operate/old.mjs');
  assert.equal(
    readFileSync(join(target, 'lib/operate/old.mjs'), 'utf8'),
    'customer modification\n',
  );
  assert.equal(run().report.conflicts[0].target, 'lib/operate/old.mjs');
});

test('regeneration preserves a modified current output instead of overwriting it', (t) => {
  const { target, put, run } = fixture(t);
  assert.equal(run().status, 0);
  put('packages/pipeline/lib/operate/current.mjs', 'customer modification\n');
  const result = run();
  assert.equal(result.status, 1);
  assert.equal(result.report.conflicts[0].target, 'lib/operate/current.mjs');
  assert.equal(
    readFileSync(join(target, 'lib/operate/current.mjs'), 'utf8'),
    'customer modification\n',
  );
});

test('historical digest evidence bootstraps unchanged legacy outputs without a previous manifest', (t) => {
  const { root, target, put, run } = fixture(t);
  const bytes = '# Legacy generated shell\n';
  const old = 'templates/design/README.md';
  put(
    'scripts/domains/legacy-projection-ownership.json',
    JSON.stringify({ entries: [{ owner: 'design', target: old, sha256: digest(bytes) }] }),
  );
  for (const directory of ['lib/design', 'lib/design-engine', 'templates/studio'])
    mkdirSync(join(root, 'packages/design', directory), { recursive: true });
  put(`packages/pipeline/${old}`, bytes);
  const result = run('write', 'design');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(target, old)), false);
});

test('a symlinked output ancestor is rejected before writing outside the target', (t) => {
  const { root, target, run } = fixture(t);
  const outside = join(root, 'outside');
  mkdirSync(outside);
  mkdirSync(join(target, 'lib'));
  symlinkSync(outside, join(target, 'lib/operate'));
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Symlink in generated output path/u);
  assert.equal(existsSync(join(outside, 'current.mjs')), false);
});

test('historical bootstrap evidence never authorizes deletion of modified legacy bytes', (t) => {
  const { root, target, put, run } = fixture(t);
  const old = 'templates/design/README.md';
  put(
    'scripts/domains/legacy-projection-ownership.json',
    JSON.stringify({
      entries: [{ owner: 'design', target: old, sha256: digest('# Legacy generated shell\n') }],
    }),
  );
  for (const directory of ['lib/design', 'lib/design-engine', 'templates/studio'])
    mkdirSync(join(root, 'packages/design', directory), { recursive: true });
  put(`packages/pipeline/${old}`, '# Customer edits\n');
  const result = run('write', 'design');
  assert.equal(result.status, 1);
  assert.equal(result.report.conflicts[0].target, old);
  assert.equal(readFileSync(join(target, old), 'utf8'), '# Customer edits\n');
});
