import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function copy(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

test('the installed package doctor does not require source-only release files', () => {
  const temp = mkdtempSync(join(tmpdir(), 'planr-packaged-doctor-'));
  const packageRoot = join(temp, 'node_modules', '@openplanr', 'pipeline');
  const projectRoot = join(temp, 'project');
  mkdirSync(projectRoot, { recursive: true });

  for (const relativePath of [
    'package.json',
    'README.md',
    '.claude-plugin',
    'agents',
    'commands/sync.md',
    'conformance/verify-artifact-review.mjs',
    'docs/artifact-review.md',
    'docs/protocol',
    'adapters/codex/skills/planr-artifact',
    'bin/planr-pipeline.mjs',
    'lib/artifact',
    'lib/design-engine/artifact-adapter.mjs',
    'lib/design-engine/board-adapter.mjs',
    'lib/ecosystem',
    'lib/pipeline/index.mjs',
    'registry/artifact-theme.json',
    'schemas',
    'scripts/doctor.mjs',
    'templates/artifact-review-shell.html',
    'templates/artifact-review-stage.js',
    'templates/design/design-board-adapter.js',
  ]) {
    copy(join(root, relativePath), join(packageRoot, relativePath));
  }
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
  assert.ok(report.checks.some((check) => check.id === 'ecosystem.package-mode'));
});
