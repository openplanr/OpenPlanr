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

// Follows `npm run <script>` aliases in && chains down to the commands they run.
function leaves(scripts, script) {
  assert.ok(Object.hasOwn(scripts, script), `missing script ${script}`);
  return scripts[script].split(/\s*&&\s*/u).flatMap((command) => {
    const alias = /^npm run ([a-z][\w:-]*)$/u.exec(command);
    return alias ? leaves(scripts, alias[1]) : [command];
  });
}

test('every workspace npm test runs exactly the commands Workspace CI runs for it', () => {
  const commands = planLocalCi(workflow, 24).jobs.flatMap(({ instances }) =>
    instances.flatMap(({ steps }) =>
      steps.flatMap(({ script, workingDirectory }) =>
        script.split('\n').map((line) => ({ line: line.trim(), workingDirectory })),
      ),
    ),
  );
  for (const { line, workingDirectory } of commands) {
    if (workingDirectory === '.') continue;
    assert.match(
      line,
      /^npm run [a-z][\w:-]*(?: -- --shard=\d+\/\d+)?$/u,
      `${workingDirectory} CI commands must name a workspace script so npm test can run them`,
    );
  }
  const { workspaces } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  for (const path of workspaces) {
    const { name, scripts } = JSON.parse(readFileSync(resolve(root, path, 'package.json'), 'utf8'));
    const ci = commands.flatMap(({ line, workingDirectory }) => {
      if (line === `npm test --workspace=${name}`) return ['test'];
      const run = /^npm run ([a-z][\w:-]*)(?: --workspace=(\S+))?(?: -- --shard=\d+\/\d+)?$/u.exec(
        line,
      );
      if (!run) return [];
      const [, script, workspace] = run;
      return workspace === name || (workspace === undefined && workingDirectory === path)
        ? [script]
        : [];
    });
    assert.ok(ci.length > 0, `Workspace CI runs no tests for ${path}`);
    assert.deepEqual(
      new Set(leaves(scripts, 'test')),
      new Set(ci.flatMap((script) => leaves(scripts, script))),
      path,
    );
  }
});
