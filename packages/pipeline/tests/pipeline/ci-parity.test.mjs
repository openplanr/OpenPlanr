import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import {
  AGGREGATE_JOB,
  assertContributorRuntime,
  parseScriptRun,
  planLocalCi,
  SELECTOR_JOB,
  selectedIf,
} from '../../../../scripts/run-ci-parity.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const workflow = load(readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'));
const nightly = load(readFileSync(resolve(root, '.github/workflows/nightly.yml'), 'utf8'));
const ACTIONS_CONTEXT = /\$\{\{\s*(?:github|runner)\./u;
const PROVISIONING = new Set([
  'npm ci',
  'git config --global --add safe.directory "$GITHUB_WORKSPACE"',
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

test('local parity plans every Workspace CI job except the build producer, the selector and the gate', () => {
  const plan = planLocalCi(workflow, 24);
  assert.equal(plan.producer, 'build');
  assert.deepEqual(plan.prepare, ['npm run generate', 'npm run build']);
  assert.deepEqual(
    plan.jobs.map(({ id }) => id),
    Object.keys(workflow.jobs).filter(
      (id) => id !== 'build' && id !== AGGREGATE_JOB && id !== SELECTOR_JOB,
    ),
  );
});

test('local parity replays a job the selector can skip, and only under its own selection', () => {
  const ids = planLocalCi(workflow, 24).jobs.map(({ id }) => id);
  for (const id of ['design-tests', 'cli-tests']) {
    assert.equal(workflow.jobs[id].if, selectedIf(id));
    assert.ok(ids.includes(id), id);
  }
  const crossed = structuredClone(workflow);
  crossed.jobs['design-tests'].if = selectedIf('cli-tests');
  assert.throws(() => planLocalCi(crossed, 24), /design-tests runs under if: .*cannot evaluate/u);
});

test('local parity runs every CI command except runner provisioning, GitHub-only checks, the build guard and the restore', () => {
  for (const job of planLocalCi(workflow, 24).jobs) {
    for (const instance of job.instances) {
      const expected = workflow.jobs[job.id].steps
        .filter(
          (step) =>
            typeof step.run === 'string' &&
            step.env?.BUILD_RESULT === undefined &&
            !Object.values(step.env ?? {}).some((value) => ACTIONS_CONTEXT.test(value)) &&
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
    [1, 2, 3].map((shard) => `Node 24 CLI tests (shard ${shard}/3)`),
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
  const changed = structuredClone(workflow);
  changed.jobs.compatibility = structuredClone(nightly.jobs.compatibility);
  changed.jobs.current = structuredClone(nightly.jobs.compatibility);
  changed.jobs.current.strategy.matrix.node = [24, 26];
  const nodes = (nodeMajor, id) =>
    planLocalCi(changed, nodeMajor)
      .jobs.find((job) => job.id === id)
      .instances.map(({ node }) => node);
  assert.deepEqual(nodes(22, 'compatibility'), ['22']);
  assert.deepEqual(nodes(24, 'compatibility'), []);
  assert.deepEqual(nodes(26, 'current'), ['26']);
  assert.deepEqual(nodes(22, 'current'), ['24']);
  assert.deepEqual(nodes(20, 'static'), ['24']);
});

test('a job may end on an exact minimum runtime that runs only node --test', () => {
  const steps = workflow.jobs.static.steps;
  const floor = steps.findIndex((step) => step.with?.['node-version'] === '22.13.0');
  assert.equal(floor, steps.length - 2, 'the Protocol floor must be the last runtime switch');
  const plan = planLocalCi(workflow, 24).jobs.find((job) => job.id === 'static');
  assert.deepEqual(
    plan.instances.map(({ node }) => node),
    ['24'],
  );
  for (const mutate of [
    (job) => job.steps.push({ run: 'npm run build' }),
    (job) => {
      job.steps[floor].with['node-version'] = 22;
    },
    (job) => job.steps.push({ uses: 'actions/setup-node@v5', with: { 'node-version': 24 } }),
  ]) {
    const changed = structuredClone(workflow);
    mutate(changed.jobs.static);
    assert.throws(() => planLocalCi(changed, 24), /must use one setup-node step/u);
  }
});

test('GitHub-only checks are named in the plan and never replayed', () => {
  const [static_] = planLocalCi(workflow, 24).jobs.find((job) => job.id === 'static').instances;
  assert.deepEqual(static_.remote, [
    'Pack exact public candidates for linked private Studio verification',
    'Review dependency changes',
    'Check changeset bumps against the title type',
  ]);
  assert.ok(static_.steps.every(({ script }) => !/check-changeset-bump|pack-studio/u.test(script)));
  assert.throws(
    () =>
      planLocalCi(
        withStep({
          name: 'Remote',
          if: 'always()',
          'continue-on-error': true,
          env: { T: `\${{ github.token }}` },
          run: 'true',
        }),
        24,
      ),
    /sets continue-on-error, which the local run ignores/u,
  );
});

test('local parity execution requires the repository contributor floor', () => {
  for (const version of ['22.13.0', '22.23.2', '24.0.0', '26.0.0'])
    assert.doesNotThrow(() => assertContributorRuntime(version));
  for (const version of ['20.20.2', '22.12.9', '23.5.0', '25.0.0', '24.0.0-rc.1'])
    assert.throws(() => assertContributorRuntime(version), /Use a supported contributor runtime/u);
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
  gated.jobs.static.if = "github.event_name == 'push'";
  assert.throws(() => planLocalCi(gated, 24), /static runs under if: .*cannot evaluate/u);
});

test('a job may need only the build and jobs defined before it', () => {
  const needing = (needs) => {
    const changed = structuredClone(workflow);
    changed.jobs['design-tests'].needs = needs;
    return changed;
  };
  assert.doesNotThrow(() => planLocalCi(needing(['build', 'static']), 24));
  for (const needs of ['cli-tests', 'unknown-job', AGGREGATE_JOB]) {
    assert.throws(
      () => planLocalCi(needing(needs), 24),
      /the local run orders jobs only after the build and earlier jobs/u,
    );
  }
});

test('a shard passes no flag but its shard', () => {
  const shard = workflow.jobs['cli-tests'].steps.find((step) => step.name === 'Run CLI test shard');
  const line = expand(shard.run.trim(), { shard: 1 });
  assert.deepEqual(parseScriptRun(line), { script: 'test:main', workspace: undefined });
  assert.equal(parseScriptRun(`${line} --coverage`), null);
  assert.equal(parseScriptRun('npm run test:main -- --bail=1'), null);
});

// Follows `npm run <script>` aliases in && chains down to the commands they run.
function leaves(scripts, script) {
  assert.ok(Object.hasOwn(scripts, script), `missing script ${script}`);
  return scripts[script].split(/\s*&&\s*/u).flatMap((command) => {
    const alias = /^npm run ([a-z][\w:-]*)$/u.exec(command);
    return alias ? leaves(scripts, alias[1]) : [command];
  });
}

test('every workspace npm test runs exactly the commands Workspace CI and the nightly CLI suites run', () => {
  const isolated = nightly.jobs['cli-isolated-tests'];
  const runSuite = isolated.steps.find((step) => step.name === 'Run the suite in a fresh process');
  const nightlySuites = isolated.strategy.matrix.include.map((matrix) => ({
    line: expand(runSuite.run.trim(), matrix),
    workingDirectory: runSuite['working-directory'],
  }));
  const commands = [
    ...planLocalCi(workflow, 24).jobs.flatMap(({ instances }) =>
      instances.flatMap(({ steps }) =>
        steps.flatMap(({ script, workingDirectory }) =>
          script.split('\n').map((line) => ({ line: line.trim(), workingDirectory })),
        ),
      ),
    ),
    ...nightlySuites,
  ];
  for (const { line, workingDirectory } of commands) {
    if (workingDirectory === '.') continue;
    assert.ok(
      parseScriptRun(line),
      `${workingDirectory} CI commands must name a workspace script so npm test can run them: ${line}`,
    );
  }
  const { workspaces } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  for (const path of workspaces) {
    const { name, scripts } = JSON.parse(readFileSync(resolve(root, path, 'package.json'), 'utf8'));
    const ci = commands.flatMap(({ line, workingDirectory }) => {
      if (line === `npm test --workspace=${name}`) return ['test'];
      const run = parseScriptRun(line);
      if (!run) return [];
      const { script, workspace } = run;
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
