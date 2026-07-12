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
    'docs/protocol',
    'lib/ecosystem',
    'schemas',
    'scripts/doctor.mjs',
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
