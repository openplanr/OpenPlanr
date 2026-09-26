import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function copy(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

test('the installed package doctor accepts a package release bump without source-only release files', () => {
  const temp = mkdtempSync(join(tmpdir(), 'planr-packaged-doctor-'));
  const packageRoot = join(temp, 'node_modules', '@openplanr', 'pipeline');
  const projectRoot = join(temp, 'project');
  mkdirSync(projectRoot, { recursive: true });

  for (const relativePath of [
    'package.json',
    'README.md',
    'conformance/verify-artifact-review.mjs',
    'docs/artifact-review.md',
    'docs/protocol',
    'bin/planr-pipeline.mjs',
    'lib/artifact',
    'lib/design-engine/artifact-adapter.mjs',
    'lib/design-engine/board-adapter.mjs',
    'lib/ecosystem',
    'lib/pipeline/index.mjs',
    'lib/protocol/jcs.mjs',
    'registry/artifact-theme.json',
    'schemas',
    'scripts/doctor.mjs',
    'templates/artifact-review-shell.html',
    'templates/artifact-review-stage.js',
    'templates/diagram-studio.js',
    'templates/diagram-owner.js',
    'templates/design/design-board-adapter.js',
  ]) {
    copy(join(root, relativePath), join(packageRoot, relativePath));
  }
  const packagePath = join(packageRoot, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  const nextVersion = `${Number(pkg.version.split('.')[0]) + 1}.0.0`;
  writeFileSync(packagePath, JSON.stringify({ ...pkg, version: nextVersion }));
  writeFileSync(join(projectRoot, '.env'), 'SAFE_VALUE=yes\n');

  const result = spawnSync(process.execPath, [join(packageRoot, 'scripts/doctor.mjs'), '--json'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, HOME: join(temp, 'home') },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.ok(report.checks.some((check) => check.id === 'versions.package-mode'));
  assert.ok(
    report.checks.some(
      (check) => check.id === 'protocol.ownership-reference' && check.status === 'ok',
    ),
  );
  assert.ok(report.checks.every((check) => check.id !== 'protocol.ownership-adr'));
  assert.ok(report.checks.some((check) => check.id === 'ecosystem.package-mode'));
});

test('the source doctor recognizes consolidated workspace domains without sibling-repo warnings', () => {
  const temp = mkdtempSync(join(tmpdir(), 'planr-consolidated-doctor-'));
  const home = join(temp, 'home');
  const workspaceRoot = resolve(root, '../..');
  const result = spawnSync(process.execPath, [join(root, 'scripts/doctor.mjs'), '--json'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      PLANR_HOME: join(home, '.planr'),
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  for (const id of [
    'ecosystem.workspace-layout',
    'ecosystem.pipeline-version',
    'ecosystem.openplanr-version-present',
    'ecosystem.skills-present',
    'ecosystem.marketplace-present',
  ]) {
    assert.equal(
      report.checks.find((check) => check.id === id)?.status,
      'ok',
      `${id} should pass in the consolidated source workspace`,
    );
  }
  assert.equal(
    report.checks.some(
      (check) =>
        check.status === 'warn' &&
        /marketplace repo not found|skills repo not found|OpenPlanr CLI repo not found/.test(
          check.message,
        ),
    ),
    false,
  );
  assert.equal(
    report.checks.find((check) => check.id === 'ecosystem.openplanr-web-external')?.status,
    'ok',
  );

  const strict = spawnSync(
    process.execPath,
    [join(root, 'scripts/doctor.mjs'), '--strict', '--json'],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PLANR_HOME: join(home, '.planr') },
    },
  );
  assert.equal(strict.status, 0, strict.stderr || strict.stdout);
  const strictReport = JSON.parse(strict.stdout);
  assert.equal(strictReport.failures, 0);
  assert.equal(
    strictReport.checks.find((check) => check.id === 'ecosystem.openplanr-web-external')?.status,
    'ok',
  );
});

test('doctor reports malformed external web metadata without losing its JSON result', () => {
  const temp = mkdtempSync(join(tmpdir(), 'planr-malformed-web-doctor-'));
  const home = join(temp, 'home');
  const webRoot = join(temp, 'openplanr-web');
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, 'package.json'), '{ malformed\n');

  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts/doctor.mjs'), '--workspace-root', temp, '--json'],
    {
      cwd: temp,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PLANR_HOME: join(home, '.planr') },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  const custody = report.checks.find((check) => check.id === 'ecosystem.openplanr-web-custody');
  assert.equal(custody?.status, 'warn');
  assert.match(custody?.message ?? '', /unreadable or malformed/u);
});

test('doctor previews and repairs stale Planr-owned daemon state', () => {
  const temp = mkdtempSync(join(tmpdir(), 'planr-doctor-repair-'));
  const home = join(temp, 'home');
  const projectRoot = join(temp, 'project');
  const designState = join(home, '.planr', 'design-daemon');
  const dashboardState = join(home, '.planr', 'dashboard-daemon');
  mkdirSync(designState, { recursive: true });
  mkdirSync(dashboardState, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(designState, 'port'), '1\n');
  writeFileSync(join(dashboardState, 'port'), 'not-a-port\n');

  const preview = spawnSync(
    process.execPath,
    [join(root, 'scripts/doctor.mjs'), '--json', '--repair-preview'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PLANR_HOME: join(home, '.planr') },
    },
  );
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  const previewReport = JSON.parse(preview.stdout);
  assert.equal(previewReport.repairs.length, 2);
  assert.ok(previewReport.repairs.every((repair) => repair.applied === false));
  assert.equal(existsSync(designState), true);
  assert.equal(existsSync(dashboardState), true);

  const fixed = spawnSync(process.execPath, [join(root, 'scripts/doctor.mjs'), '--json', '--fix'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PLANR_HOME: join(home, '.planr') },
  });
  assert.equal(fixed.status, 0, fixed.stderr || fixed.stdout);
  const fixedReport = JSON.parse(fixed.stdout);
  assert.equal(fixedReport.repairs.length, 2);
  assert.ok(fixedReport.repairs.every((repair) => repair.applied === true));
  assert.equal(existsSync(designState), false);
  assert.equal(existsSync(dashboardState), false);
});
