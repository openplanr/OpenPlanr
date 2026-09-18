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

test('public onboarding states the supported Node.js line once and links the diagram guide', () => {
  const statement = /OpenPlanr requires Node\.js 20 or later\. CI verifies Node\.js 20, 22, and 24;\s+contributors\s+use Node\.js 24 \(`\.nvmrc`\)\./u;
  assert.match(read('README.md'), /OpenPlanr requires Node\.js 20 or later\./u);
  assert.match(read('README.md'), /docs\/diagrams\/authoring\.md/u);
  assert.match(read('README.md'), /docs\/diagrams\/planning-artifacts\/planning-artifacts\.svg/u);
  for (const path of ['CONTRIBUTING.md', 'docs/contributing/dogfooding.md', 'docs/diagrams/authoring.md']) {
    assert.match(read(path), statement, path);
  }
  assert.equal(read('.nvmrc').trim(), '24');
});
