import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { JOBS } from '../../../../scripts/ci/workspace-jobs.mjs';
import { AGGREGATE_JOB, SELECTOR_JOB, selectedIf } from '../../../../scripts/run-ci-parity.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const { jobs } = load(readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'));
const consumers = Object.entries(jobs).filter(
  ([id, job]) => id !== AGGREGATE_JOB && [job.needs ?? []].flat().includes('build'),
);
const GUARD =
  /^if \[ "\$BUILD_RESULT" != success \]; then\n\s+echo "::error::[^\n]+"\n\s+exit 1\nfi\n?$/u;
const RESTORE = /^tar -xzmf "\$RUNNER_TEMP\/build-outputs\.tgz"$/u;
const SETUP = /^(?:npm ci|git config --global --add safe\.directory "\$GITHUB_WORKSPACE")$/u;

// The build job is not a required check, and a required job skipped by its `if` reports
// success, so each selected consumer must start on every build outcome and fail itself first.
test('every job that needs the build runs when selected unless cancelled and first requires its success', () => {
  assert.ok(consumers.length > 0, 'Workspace CI must keep jobs that consume the build outputs');
  assert.deepEqual(consumers.map(([id]) => id).sort(), [...JOBS].sort());
  for (const [id, job] of consumers) {
    assert.deepEqual(job.needs, ['build', SELECTOR_JOB], id);
    assert.equal(job.if, selectedIf(id), `${id} must run on every build outcome when selected`);
    const [guard] = job.steps;
    assert.equal(guard.if, undefined, `${id} must run its build guard unconditionally`);
    assert.equal(guard.env?.BUILD_RESULT, '${{ needs.build.result }}', `${id} must guard first`);
    assert.match(guard.run ?? '', GUARD, `${id} must fail first when the build did not succeed`);
  }
});

test('every job that needs the build restores its outputs before any test command', () => {
  for (const [id, job] of consumers) {
    const download = job.steps.findIndex(
      (step) =>
        step.uses?.startsWith('actions/download-artifact@') &&
        step.with?.name === 'build-outputs' &&
        step.with?.path === '${{ runner.temp }}',
    );
    const restore = job.steps.findIndex((step) => RESTORE.test(step.run?.trim() ?? ''));
    assert.ok(download > 0, `${id} must download build-outputs into the runner temp directory`);
    assert.ok(restore > download, `${id} must extract build-outputs.tgz after downloading it`);
    for (const step of job.steps.slice(1, restore)) {
      if (step.run === undefined) continue;
      assert.match(step.run.trim(), SETUP, `${id} runs "${step.run.trim()}" before the restore`);
    }
  }
});

test('the selector publishes one output for each job it can skip', () => {
  const selector = jobs[SELECTOR_JOB];
  assert.equal(Object.keys(jobs)[0], SELECTOR_JOB, 'the local run orders jobs after their needs');
  assert.deepEqual(
    selector.outputs,
    Object.fromEntries(JOBS.map((id) => [id, `\${{ steps.select.outputs.${id} }}`])),
  );
  assert.match(selector.steps.at(-1).run, /node scripts\/ci\/workspace-jobs\.mjs --event/u);
});

test('the CI passed gate needs every blocking job and fails unless each selected one succeeded', () => {
  const gate = jobs[AGGREGATE_JOB];
  assert.equal(gate.name, 'CI passed');
  assert.equal(gate.if, '${{ always() }}', 'A cancelled run must still report a failed gate');
  const blocking = Object.entries(jobs)
    .filter(([id, job]) => id !== AGGREGATE_JOB && job['continue-on-error'] !== true)
    .map(([id]) => id);
  assert.deepEqual([...gate.needs].sort(), blocking.sort());
  const [check] = gate.steps;
  const verdict = (needs) =>
    spawnSync('bash', ['-e', '-c', check.run], {
      env: { ...process.env, NEEDS: JSON.stringify(needs, null, 2) },
      encoding: 'utf8',
    }).status;
  const selection = (selected) => Object.fromEntries(JOBS.map((id) => [id, String(selected)]));
  const run = (outputs) =>
    Object.fromEntries(
      gate.needs.map((id) => [
        id,
        { result: 'success', outputs: id === SELECTOR_JOB ? outputs : {} },
      ]),
    );
  const all = run(selection(true));
  assert.equal(verdict(all), 0);
  for (const result of ['failure', 'cancelled', 'skipped'])
    assert.equal(verdict({ ...all, [gate.needs.at(-1)]: { result, outputs: {} } }), 1, result);
  const none = run(selection(false));
  const skipped = { result: 'skipped', outputs: {} };
  const skippedLanes = Object.fromEntries(JOBS.map((id) => [id, skipped]));
  assert.equal(verdict({ ...none, ...skippedLanes }), 0, 'an unselected job may skip');
  assert.equal(verdict({ ...all, 'cli-tests': skipped }), 1, 'a selected job may not skip');
  assert.equal(verdict({ ...none, ...skippedLanes, static: skipped }), 1, 'static never skips');
  assert.equal(
    verdict({ ...none, ...skippedLanes, [SELECTOR_JOB]: { result: 'failure', outputs: {} } }),
    1,
    'a failed selector fails the gate',
  );
  assert.equal(verdict({}), 1, 'A gate that reads no results must fail');
});
