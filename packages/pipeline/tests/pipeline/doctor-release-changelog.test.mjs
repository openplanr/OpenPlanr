import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const CHANGELOG = `# Changelog

## [0.41.0] — 2026-08-04

### Fixed

- Something documented.

## [0.36.1] — 2026-08-01

### Fixed

- Something else documented.
`;

/**
 * Build a source-shaped checkout carrying only the files doctor reads, so the
 * release audit runs to completion without a git remote or network access.
 * Doctor audits the runtime package identity independently of host plugin assets.
 */
function buildCheckout(version) {
  const checkout = mkdtempSync(join(tmpdir(), 'planr-doctor-changelog-'));

  for (const relativePath of [
    'README.md',
    'docs/compatibility-matrix.md',
    'docs/protocol',
    'input/tech/stack.md',
    'lib/ecosystem',
    'lib/protocol/jcs.mjs',
    'schemas/v1.0.0',
    'scripts/doctor.mjs',
  ]) {
    const target = join(checkout, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, relativePath), target, { recursive: true });
  }

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  writeFileSync(join(checkout, 'package.json'), JSON.stringify({ ...pkg, version }, null, 2));
  writeFileSync(join(checkout, 'CHANGELOG.md'), CHANGELOG);

  return checkout;
}

function runDoctor(checkout, extraArgs = []) {
  const result = spawnSync(
    process.execPath,
    [
      join(checkout, 'scripts/doctor.mjs'),
      '--release',
      '--json',
      '--workspace-root',
      checkout,
      ...extraArgs,
    ],
    { cwd: checkout, encoding: 'utf8', env: { ...process.env, HOME: join(checkout, 'home') } },
  );
  assert.ok(result.stdout, result.stderr);
  return JSON.parse(result.stdout);
}

function changelogCheck(report) {
  const check = report.checks.find((entry) => entry.id === 'release.changelog');
  assert.ok(
    check,
    `the release audit must report a release.changelog check; got ${report.checks.map((entry) => entry.id).join(', ')}`,
  );
  return check;
}

test('the release audit fails when CHANGELOG.md has no section for the released version', () => {
  // 0.37.1 reproduces the real gap: it was tagged and published while the
  // changelog jumped from 0.38.0 straight to 0.36.1.
  const checkout = buildCheckout('0.37.1');

  const relaxed = changelogCheck(runDoctor(checkout));
  assert.equal(relaxed.status, 'warn');
  assert.match(relaxed.message, /0\.37\.1/);

  const strict = changelogCheck(runDoctor(checkout, ['--strict']));
  assert.equal(strict.status, 'fail');
  assert.equal(strict.severity, 'error');
  assert.match(strict.message, /0\.37\.1/);
});

test('the release audit accepts a version the changelog documents', () => {
  const checkout = buildCheckout('0.41.0');

  const check = changelogCheck(runDoctor(checkout, ['--strict']));
  assert.equal(check.status, 'ok');
  assert.match(check.message, /0\.41\.0/);
});

test('a prefix of a documented version does not satisfy the changelog gate', () => {
  // "0.4" or "0.41" must not pass by matching inside "## [0.41.0]".
  const checkout = buildCheckout('0.41');

  const check = changelogCheck(runDoctor(checkout, ['--strict']));
  assert.equal(check.status, 'fail');
});

test('the shipped changelog documents the version this repository is about to release', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');

  assert.match(
    changelog,
    new RegExp(`^##\\s*\\[?${pkg.version.replace(/\./g, '\\.')}\\]?(?![0-9.])`, 'm'),
    `CHANGELOG.md has no section for package.json version ${pkg.version}`,
  );
});

function versionCheck(report, id) {
  const check = report.checks.find((entry) => entry.id === id);
  assert.ok(check, `doctor must report ${id}`);
  return check;
}

test('package release bumps preserve schema versions without rewriting documentation', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const nextVersion = `${Number(pkg.version.split('.')[0]) + 1}.0.0`;
  const checkout = buildCheckout(nextVersion);
  const documents = [
    'docs/protocol/README.md',
    'docs/compatibility-matrix.md',
    'input/tech/stack.md',
  ];
  const before = documents.map((path) => readFileSync(join(checkout, path), 'utf8'));
  for (const text of before) {
    assert.equal(text.includes(`planr-pipeline v${nextVersion}`), false);
    assert.equal(text.split('\n').includes(`Version: "${nextVersion}"`), false);
  }

  const report = runDoctor(checkout, ['--strict']);
  for (const id of [
    'versions.runtime-package',
    'versions.stack',
    'protocol.schema-reference',
    'protocol.schemas-present',
    'protocol.ownership-reference',
  ]) {
    assert.equal(versionCheck(report, id).status, 'ok', JSON.stringify(report));
  }
  assert.equal(
    report.checks.some(({ id }) =>
      ['versions.protocol-readme', 'versions.compatibility-matrix'].includes(id),
    ),
    false,
  );
  assert.deepEqual(
    documents.map((path) => readFileSync(join(checkout, path), 'utf8')),
    before,
  );
  assert.equal(
    JSON.parse(readFileSync(join(checkout, 'schemas/v1.0.0/stack.schema.json'), 'utf8')).properties
      .schemaVersion.const,
    '1.0.0',
  );
});

test('release version independence still refuses an invalid package identity', () => {
  const checkout = buildCheckout('not-a-version');
  assert.equal(versionCheck(runDoctor(checkout), 'versions.runtime-package').status, 'fail');
  const pkg = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8'));
  writeFileSync(
    join(checkout, 'package.json'),
    JSON.stringify({ ...pkg, name: 'unrelated-package', version: '3.0.0' }),
  );
  assert.equal(versionCheck(runDoctor(checkout), 'versions.runtime-package').status, 'fail');
});

test('release version independence still refuses incompatible stack and missing schema references', () => {
  const checkout = buildCheckout('3.0.0');
  const stackPath = join(checkout, 'input/tech/stack.md');
  const stack = readFileSync(stackPath, 'utf8');
  writeFileSync(stackPath, stack.replace('schemaVersion: "1.0.0"', 'schemaVersion: "9.0.0"'));
  assert.equal(versionCheck(runDoctor(checkout), 'versions.stack').status, 'fail');
  writeFileSync(
    stackPath,
    stack.replace('AppName: "planr-pipeline"', 'AppName: "unrelated-package"'),
  );
  assert.equal(versionCheck(runDoctor(checkout), 'versions.stack').status, 'fail');
  writeFileSync(stackPath, stack);
  const protocolPath = join(checkout, 'docs/protocol/README.md');
  writeFileSync(
    protocolPath,
    readFileSync(protocolPath, 'utf8').replaceAll('schemas/v1.0.0/', 'schemas/unknown/'),
  );
  assert.equal(versionCheck(runDoctor(checkout), 'protocol.schema-reference').status, 'fail');
});
