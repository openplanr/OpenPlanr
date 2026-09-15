import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

function run(script, ...args) {
  return spawnSync(process.execPath, [resolve(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('diagram contributor onboarding names every authoring and drift operation', () => {
  const guide = read('docs/diagrams/authoring.md');
  const packageManifest = JSON.parse(read('package.json'));
  for (const command of [
    'planr diagram gallery',
    'planr diagram render',
    'planr diagram inspect',
    'planr diagram check',
    'planr diagram rerender',
    'npm run skill:lint',
    'npm run skill:preview',
    'npm run skill:evaluate',
    'npm run generate',
    'npm run check:generated',
    'npm run verify:packed:strict',
  ]) assert.match(guide, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), command);

  for (const script of ['skill:lint', 'skill:preview', 'skill:evaluate', 'generate', 'check:generated', 'verify:packed:strict']) {
    assert.equal(typeof packageManifest.scripts[script], 'string', script);
  }
  for (const path of [
    'skills/planr-diagram/references/diagram-intent-to-ir.md',
    'skills/planr-diagram/references/diagram-fidelity.md',
  ]) assert.equal(existsSync(resolve(root, path)), true, path);
});

test('the documented planr-diagram lint, preview, and evaluation journey passes', () => {
  for (const [script, expected] of [
    ['scripts/skills/lint.mjs', 'lint ok: planr-diagram@1.0.0'],
    ['scripts/skills/preview.mjs', 'preview ok: planr-diagram@1.0.0'],
    ['scripts/skills/evaluate.mjs', 'evaluate ok: planr-diagram'],
  ]) {
    const result = run(script, 'skills/planr-diagram');
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
});

test('workspace onboarding recommends Node 26 and keeps Node 20 and 22 compatibility explicit', () => {
  const readme = read('README.md');
  assert.match(readme, /Node\.js 26 for day-to-day contributor work/u);
  assert.match(readme, /verified with Node\.js 20 and 22/u);
  assert.match(readme, /docs\/diagrams\/authoring\.md/u);
});
