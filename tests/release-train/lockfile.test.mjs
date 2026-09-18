import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(root, 'scripts/release-train/sync-lockfile.mjs');

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-lockfile-'));
  mkdirSync(join(dir, 'scripts/release-train'), { recursive: true });
  cpSync(script, join(dir, 'scripts/release-train/sync-lockfile.mjs'));
  mkdirSync(join(dir, 'packages/cli'), { recursive: true });
  mkdirSync(join(dir, 'packages/pipeline'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'openplanr-workspace', version: '0.1.0' }),
  );
  writeFileSync(
    join(dir, 'packages/cli/package.json'),
    JSON.stringify({
      name: 'openplanr',
      version: '2.2.1',
      optionalDependencies: { 'planr-pipeline': '0.45.3' },
    }),
  );
  writeFileSync(
    join(dir, 'packages/pipeline/package.json'),
    JSON.stringify({ name: 'planr-pipeline', version: '0.45.3' }),
  );
  const lock = {
    name: 'openplanr-workspace',
    version: '0.1.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'openplanr-workspace', version: '0.1.0' },
      'packages/cli': {
        name: 'openplanr',
        version: '2.2.0',
        optionalDependencies: { 'planr-pipeline': '0.45.2' },
      },
      'packages/pipeline': { name: 'planr-pipeline', version: '0.45.2' },
      // A nested third-party tree the refresh must never touch.
      'packages/cli/node_modules/@esbuild/darwin-arm64': {
        version: '0.28.2',
        resolved: 'https://registry.npmjs.org/x',
        optional: true,
      },
      'node_modules/vitest/node_modules/esbuild': {
        version: '0.28.2',
        resolved: 'https://registry.npmjs.org/y',
      },
    },
  };
  writeFileSync(join(dir, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  return dir;
}

const run = (dir, ...args) =>
  execFileSync(process.execPath, [join(dir, 'scripts/release-train/sync-lockfile.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf8',
  });

test('carries workspace versions and internal ranges into the lockfile, leaving resolution untouched', () => {
  const dir = workspace();
  try {
    const before = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
    const output = run(dir);
    const after = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
    assert.match(output, /packages\/cli 2\.2\.0 -> 2\.2\.1/u);
    assert.match(output, /optionalDependencies\.planr-pipeline 0\.45\.2 -> 0\.45\.3/u);
    assert.equal(after.packages['packages/cli'].version, '2.2.1');
    assert.equal(after.packages['packages/cli'].optionalDependencies['planr-pipeline'], '0.45.3');
    assert.equal(after.packages['packages/pipeline'].version, '0.45.3');
    assert.deepEqual(Object.keys(after.packages), Object.keys(before.packages));
    assert.deepEqual(
      after.packages['node_modules/vitest/node_modules/esbuild'],
      before.packages['node_modules/vitest/node_modules/esbuild'],
    );
    assert.deepEqual(
      after.packages['packages/cli/node_modules/@esbuild/darwin-arm64'],
      before.packages['packages/cli/node_modules/@esbuild/darwin-arm64'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--check fails on drift and passes once the lockfile is in step', () => {
  const dir = workspace();
  try {
    assert.throws(() => run(dir, '--check'), /out of step/u);
    run(dir);
    assert.match(run(dir, '--check'), /matches the workspace manifests/u);
    assert.match(run(dir), /already matches/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the committed lockfile is in step with this workspace', () => {
  assert.match(
    execFileSync(process.execPath, [script, '--check'], { cwd: root, encoding: 'utf8' }),
    /matches the workspace manifests/u,
  );
});
