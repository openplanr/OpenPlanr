import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const pipeline = resolve(root, 'packages/pipeline');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const { scripts } = JSON.parse(read('packages/pipeline/package.json'));
const workflow = read('.github/workflows/ci.yml');
const matrixJob = workflow
  .slice(workflow.indexOf('\n  pipeline-tests:'))
  .split(/\n  (?=[a-z][a-z0-9-]+:)/u)[1];
assert.ok(matrixJob, 'Workspace CI must retain its pipeline test job');
assert.match(matrixJob, /run: npm run \$\{\{ matrix\.script \}\} --workspace=planr-pipeline/u);
const entrypoints = [...matrixJob.matchAll(/^\s+script: ([a-z][a-z0-9:-]+)\s*$/gmu)].map(
  ([, script]) => script,
);

// Package aliases are simple && chains. Follow the actual aliases rather than
// treating a script name absent from workflow YAML as missing behavior coverage.
function leaves(script, parents = []) {
  assert.ok(Object.hasOwn(scripts, script), `CI references missing script ${script}`);
  assert.ok(
    !parents.includes(script),
    `Cyclic CI script chain: ${[...parents, script].join(' -> ')}`,
  );
  return scripts[script].split(/\s*&&\s*/u).flatMap((command) => {
    const alias = /^npm run ([a-z][a-z0-9:-]+)$/u.exec(command);
    return alias ? leaves(alias[1], [...parents, script]) : [command];
  });
}
const commands = entrypoints.flatMap((script) => leaves(script));

test('CI reaches native dispatch, governed landing and design handoff exactly once', () => {
  for (const fixture of [
    'nd1-parallel',
    'nd2-advisory-locklist',
    'nd3-dependson',
    'nd4-coherent',
  ]) {
    const command = `node conformance/runner.mjs --runtime claude-code --verify-ship --dir conformance/fixtures/native-dispatch-${fixture}`;
    assert.equal(commands.filter((candidate) => candidate === command).length, 1, fixture);
  }
  for (const file of ['verify-governed-landing.mjs', 'verify-design-handoff-contracts.mjs']) {
    assert.equal(
      commands.filter((command) => command === `node conformance/${file}`).length,
      1,
      file,
    );
  }
});

test('existing Operate behavior checks remain transitively reachable without another full suite', () => {
  for (const file of [
    'verify-operating-runtime-v2.mjs',
    'verify-operate-v2-persistent-work.mjs',
    'verify-operate-v2-evidence.mjs',
    'verify-operate-v2-operating-intelligence.mjs',
    'verify-operate-v2-governed-execution.mjs',
    'verify-operate-v2-product-experience.mjs',
    'verify-operate-v2-live-evidence.mjs',
  ])
    assert.equal(
      commands.filter((command) => command === `node conformance/${file}`).length,
      1,
      file,
    );
});

test('ecosystem tests already exercise release reconciliation and installed contract compilation', () => {
  const ecosystem = commands.find((command) =>
    /^node scripts\/run-test-group\.mjs tests\/ecosystem(?: |$)/u.test(command),
  );
  assert.ok(ecosystem, 'The ecosystem test directory must remain a CI input');
  for (const file of ['release-ledger-drift.test.mjs', 'operate-v2-phase2-package.test.mjs']) {
    assert.ok(
      !ecosystem.includes(`--exclude tests/ecosystem/${file}`),
      `${file} must not be excluded`,
    );
  }
  const ledger = readFileSync(
    resolve(pipeline, 'tests/ecosystem/release-ledger-drift.test.mjs'),
    'utf8',
  );
  assert.match(
    ledger,
    /spawnSync\(\s*process\.execPath,\s*\[join\(root, 'conformance\/verify-release-ledger\.mjs'\)\]/u,
  );
  const compilation = readFileSync(
    resolve(pipeline, 'tests/ecosystem/operate-v2-phase2-package.test.mjs'),
    'utf8',
  );
  assert.match(
    compilation,
    /run\(\s*process\.execPath,\s*\[\s*join\(installedPackage, 'conformance', 'verify-operate-v2-contract-compilation\.mjs'\)/u,
  );
});

test('local CI parity runs the same pipeline entrypoints as Workspace CI', () => {
  const local = read('scripts/run-ci-parity.mjs');
  const pipelineJob = /id: 'pipeline',([\s\S]*?)\n  \},/u.exec(local)?.[1];
  assert.ok(pipelineJob, 'Local parity must retain the pipeline job');
  const localEntrypoints = [...pipelineJob.matchAll(/^\s+'([a-z][a-z0-9:-]+)',?\s*$/gmu)].map(
    ([, script]) => script,
  );
  assert.deepEqual(localEntrypoints, entrypoints);
  assert.doesNotMatch(workflow, /check:preservation/u);
  assert.doesNotMatch(local, /check:preservation/u);
});
