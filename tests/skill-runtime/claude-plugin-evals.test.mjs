import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildPluginEvalSuite,
  findPluginEvalDrift,
  PLUGIN_EVAL_DIR,
  renderPluginEvalFiles,
  selectPluginEvalCases,
  writePluginEvalSuite,
} from '../../scripts/skills/generate-claude-plugin-evals.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const registry = JSON.parse(readFileSync(join(root, 'skills/registry.json'), 'utf8'));
const corpusPath = 'evaluation/skills/routing-corpus.json';

function scratchRoot(t) {
  const scratch = mkdtempSync(join(tmpdir(), 'openplanr-plugin-evals-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  for (const path of [corpusPath, 'skills/registry.json'])
    cpSync(join(root, path), join(scratch, path));
  writePluginEvalSuite(scratch, buildPluginEvalSuite(scratch));
  return scratch;
}

function editCorpus(scratch, edit) {
  const corpus = JSON.parse(readFileSync(join(scratch, corpusPath), 'utf8'));
  edit(corpus.cases);
  writeFileSync(join(scratch, corpusPath), JSON.stringify(corpus));
}

const corpusWith = (fixture) => ({ cases: [fixture] });
const positive = (claudePluginEval) => ({
  id: 'case-a',
  kind: 'collision',
  input: 'Write a spec',
  expectedSkillId: 'planr-spec',
  claudePluginEval,
});

test('the tracked plugin eval suite matches the routing corpus', () => {
  assert.deepEqual(findPluginEvalDrift(root, buildPluginEvalSuite(root)), []);
});

test('every generated Skill grader is scored in both arms', () => {
  const graders = [...buildPluginEvalSuite(root)].filter(([path]) => path.includes('/graders/'));
  assert.ok(graders.length > 0);
  for (const [path, content] of graders) {
    assert.match(content, /^tool: Skill$/mu, path);
    assert.match(content, /^arm: both$/mu, path);
  }
});

test('a corpus change the generated tree does not reflect is reported as drift', (t) => {
  const scratch = scratchRoot(t);
  editCorpus(scratch, (cases) => {
    cases.find(({ id }) => id === 'spec-vague').input = 'Shape this idea into a spec';
  });
  assert.deepEqual(findPluginEvalDrift(scratch, buildPluginEvalSuite(scratch)), [
    'spec-vague/prompt.md',
  ]);
});

test('opting a case out leaves its stale files as drift until regenerated', (t) => {
  const scratch = scratchRoot(t);
  editCorpus(scratch, (cases) => {
    delete cases.find(({ id }) => id === 'ceo-finance').claudePluginEval;
  });
  const files = buildPluginEvalSuite(scratch);
  assert.deepEqual(findPluginEvalDrift(scratch, files), [
    'ceo-finance/graders/planr-ceo-review-fires.md',
    'ceo-finance/graders/planr-operate-does-not-fire.md',
    'ceo-finance/prompt.md',
  ]);
  writePluginEvalSuite(scratch, files);
  assert.deepEqual(findPluginEvalDrift(scratch, files), []);
});

test('run results inside the eval directory are not drift and survive regeneration', (t) => {
  const scratch = scratchRoot(t);
  const results = join(scratch, PLUGIN_EVAL_DIR, 'results');
  cpSync(join(scratch, corpusPath), join(results, 'run/aggregate-result.json'));
  const files = buildPluginEvalSuite(scratch);
  assert.deepEqual(findPluginEvalDrift(scratch, files), []);
  writePluginEvalSuite(scratch, files);
  assert.ok(readFileSync(join(results, 'run/aggregate-result.json'), 'utf8'));
});

test('a positive case asserts its skill fires and its rival does not', () => {
  const files = renderPluginEvalFiles([positive({ rivalSkillId: 'planr-plan' })]);
  assert.deepEqual(
    [...files.keys()],
    [
      'case-a/prompt.md',
      'case-a/graders/planr-spec-fires.md',
      'case-a/graders/planr-plan-does-not-fire.md',
    ],
  );
  assert.match(
    files.get('case-a/prompt.md'),
    /^plugins: \["\.\.\/\.\.\/\.\.\/dist\/plugins\/claude\/openplanr"\]$/mu,
  );
  assert.match(files.get('case-a/graders/planr-spec-fires.md'), /"planr:spec"'\narm: both/u);
  assert.match(
    files.get('case-a/graders/planr-plan-does-not-fire.md'),
    /"planr:plan"'\nmin: 0\nmax: 0\narm: both/u,
  );
});

test('a negative case asserts that no planr skill fires', () => {
  const files = renderPluginEvalFiles([
    { id: 'case-b', kind: 'negative', input: 'Translate this', claudePluginEval: {} },
  ]);
  assert.match(
    files.get('case-b/graders/no-planr-skill.md'),
    /"planr:'\nmin: 0\nmax: 0\narm: both/u,
  );
});

test('malformed claudePluginEval options are rejected', () => {
  for (const [fixture, message] of [
    [positive({}), /not a registry skill/u],
    [positive({ rivalSkillId: 'planr-missing' }), /not a registry skill/u],
    [positive({ rivalSkillId: 'planr-spec' }), /must differ/u],
    [positive({ rivalSkillId: 'planr-plan', extra: true }), /unknown claudePluginEval keys/u],
    [positive(true), /must be an object/u],
    [
      {
        id: 'case-b',
        kind: 'negative',
        input: 'x',
        claudePluginEval: { rivalSkillId: 'planr-plan' },
      },
      /takes no rivalSkillId/u,
    ],
    [{ id: 'case-c', kind: 'positive', input: 'x', claudePluginEval: {} }, /only negative cases/u],
  ])
    assert.throws(() => selectPluginEvalCases({ corpus: corpusWith(fixture), registry }), message);
  assert.throws(
    () => selectPluginEvalCases({ corpus: { cases: [] }, registry }),
    /no routing-corpus case/u,
  );
});
