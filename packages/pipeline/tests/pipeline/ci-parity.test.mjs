import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { planLocalCi } from '../../../../scripts/run-ci-parity.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const workflow = load(readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'));
const PROVISIONING = new Set([
  'npm ci',
  'npm exec --workspace=@openplanr/protocol -- playwright install --with-deps chromium',
  'tar -xzmf "$RUNNER_TEMP/build-outputs.tgz"',
]);
const expand = (text, matrix) =>
  text.replace(/\$\{\{ matrix\.(\w+) \}\}/gu, (_expression, key) => String(matrix[key]));
const nodesFor = (nodeMajor, id) =>
  planLocalCi(workflow, nodeMajor)
    .jobs.find((job) => job.id === id)
    .instances.map(({ node }) => node);
const withStep = (step) => {
  const changed = structuredClone(workflow);
  changed.jobs['design-tests'].steps.push(step);
  return changed;
};

test('local parity plans every Workspace CI job except the build producer', () => {
  const plan = planLocalCi(workflow, 24);
  assert.equal(plan.producer, 'build');
  assert.deepEqual(plan.prepare, ['npm run generate', 'npm run build']);
  assert.deepEqual(
    plan.jobs.map(({ id }) => id),
    Object.keys(workflow.jobs).filter((id) => id !== 'build'),
  );
});

test('local parity runs every CI command except runner provisioning, the build guard and the restore', () => {
  for (const job of planLocalCi(workflow, 24).jobs) {
    for (const instance of job.instances) {
      const expected = workflow.jobs[job.id].steps
        .filter(
          (step) =>
            typeof step.run === 'string' &&
            step.env?.BUILD_RESULT === undefined &&
            !PROVISIONING.has(step.run.trim()),
        )
        .map((step) => ({
          script: expand(step.run.trim(), instance.matrix),
          workingDirectory: expand(step['working-directory'] ?? '.', instance.matrix),
        }));
      assert.deepEqual(
        instance.steps.map(({ script, workingDirectory }) => ({ script, workingDirectory })),
        expected,
        instance.name,
      );
    }
  }
});

test('local parity runs each CI matrix entry under its CI check name', () => {
  const plan = planLocalCi(workflow, 24);
  const names = (id) => plan.jobs.find((job) => job.id === id).instances.map(({ name }) => name);
  assert.deepEqual(
    names('cli-tests'),
    [1, 2, 3, 4, 5, 6].map((shard) => `Node 24 CLI tests (shard ${shard}/6)`),
  );
  assert.equal(
    names('pipeline-tests').length,
    workflow.jobs['pipeline-tests'].strategy.matrix.include.length,
  );
  for (const job of plan.jobs) {
    for (const instance of job.instances) assert.doesNotMatch(instance.name, /\$\{\{/u);
  }
});

test('a Node-matrix job runs once, on this Node when CI covers it and otherwise on the build Node', () => {
  assert.deepEqual(nodesFor(22, 'packed-public-packages'), ['22']);
  assert.deepEqual(nodesFor(22, 'compatibility'), ['22']);
  assert.deepEqual(nodesFor(24, 'packed-public-packages'), ['24']);
  assert.deepEqual(nodesFor(24, 'compatibility'), []);
  assert.deepEqual(nodesFor(26, 'packed-public-packages'), ['24']);
  assert.deepEqual(nodesFor(20, 'quality'), ['24']);
});

test('a CI step the local run cannot reproduce fails the plan instead of being dropped', () => {
  assert.throws(
    () => planLocalCi(withStep({ name: 'Conditional', if: 'always()', run: 'npm test' }), 24),
    /sets if, which the local run ignores/u,
  );
  assert.throws(
    () => planLocalCi(withStep({ uses: 'example/test-action@v1' }), 24),
    /uses example\/test-action@v1, which cannot run locally/u,
  );
  assert.throws(
    () => planLocalCi(withStep({ run: `echo "\${{ github.sha }}"` }), 24),
    /GitHub expression the local run cannot evaluate/u,
  );
  const gated = structuredClone(workflow);
  gated.jobs.quality.if = "github.event_name == 'push'";
  assert.throws(() => planLocalCi(gated, 24), /quality runs under if: .*cannot evaluate/u);
});
