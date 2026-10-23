import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workspaceRoot = resolve(root, '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const readWorkspace = (path) => readFileSync(join(workspaceRoot, path), 'utf8');
const workflowsDir = '.github/workflows';
const loadWorkflow = (file) => load(readWorkspace(join(workflowsDir, file)));
const PULL_REQUEST_CAP_MINUTES = 12;

const triggers = (workflow) => {
  const on = workflow.on;
  if (typeof on === 'string') return [on];
  return Array.isArray(on) ? on : Object.keys(on ?? {});
};

const APT = /\bapt(?:-get)?\b|install-deps|--with-deps/u;

/** Lists pull request and merge queue jobs that install system packages. */
export function pullRequestAptViolations(workflows) {
  return Object.entries(workflows)
    .filter(([, workflow]) =>
      triggers(workflow).some((event) => event === 'pull_request' || event === 'merge_group'),
    )
    .flatMap(([file, workflow]) =>
      Object.entries(workflow.jobs ?? {}).flatMap(([id, job]) =>
        (job.steps ?? [])
          .filter((step) => APT.test(step.run ?? '') || step.uses?.startsWith('./.github/actions/'))
          .map((step) => `${file} ${id}: ${step.name ?? step.uses ?? step.run}`),
      ),
    );
}

/** Lists the jobs, including called local workflows, that exceed the pull request time cap. */
export function pullRequestTimeoutViolations(workflows) {
  const violations = [];
  const check = (file, seen = new Set()) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [id, job] of Object.entries(workflows[file].jobs ?? {})) {
      const called = /^\.\/\.github\/workflows\/(.+)$/u.exec(job.uses ?? '')?.[1];
      if (called) {
        if (!workflows[called]) violations.push(`${file} ${id}: calls missing ${called}`);
        else check(called, seen);
        continue;
      }
      const cap = job['timeout-minutes'];
      if (!Number.isInteger(cap) || cap > PULL_REQUEST_CAP_MINUTES) {
        violations.push(
          `${file} ${id}: timeout-minutes ${cap ?? 'unset'} exceeds ${PULL_REQUEST_CAP_MINUTES}`,
        );
        continue;
      }
      for (const [index, step] of (job.steps ?? []).entries()) {
        const limit = step['timeout-minutes'];
        if (limit !== undefined && (!Number.isInteger(limit) || limit > cap))
          violations.push(
            `${file} ${id} step ${index + 1}: timeout-minutes ${limit} exceeds the job's ${cap}`,
          );
      }
    }
  };
  for (const [file, workflow] of Object.entries(workflows)) {
    if (triggers(workflow).some((event) => event === 'pull_request' || event === 'merge_group'))
      check(file);
  }
  return violations;
}

test('package metadata identifies the provenance repository and license', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.deepEqual(packageJson.repository, {
    type: 'git',
    url: 'git+https://github.com/openplanr/OpenPlanr.git',
    directory: 'packages/pipeline',
  });
  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageJson.bugs?.url, 'https://github.com/openplanr/OpenPlanr/issues');
  assert.equal(
    packageJson.homepage,
    'https://github.com/openplanr/OpenPlanr/tree/main/packages/pipeline#readme',
  );
});

test('local release proof installs the exact root lock and never publishes', () => {
  const workflow = readWorkspace('.github/workflows/release-proof.yml');
  const install = workflow.indexOf('run: npm ci');
  const verification = workflow.indexOf('run: npm run verify');
  assert.ok(install > 0, 'release proof must run npm ci');
  assert.ok(install < verification, 'npm ci must precede workspace verification');
  assert.doesNotMatch(workflow, /npm publish|id-token:\s*write/u);
});

test('every pull request and merge queue job is capped at 12 minutes', () => {
  const workflows = Object.fromEntries(
    readdirSync(join(workspaceRoot, workflowsDir))
      .filter((file) => /\.ya?ml$/u.test(file))
      .map((file) => [file, loadWorkflow(file)]),
  );
  assert.deepEqual(pullRequestTimeoutViolations(workflows), []);

  const job = (timeout, steps = []) => ({ 'timeout-minutes': timeout, steps });
  const fixture = {
    'pr.yml': {
      on: { pull_request: {} },
      jobs: {
        capped: job(12, [{ 'timeout-minutes': 12 }]),
        long: job(13),
        unset: { steps: [] },
        step: job(10, [{ 'timeout-minutes': 11 }]),
        called: { uses: './.github/workflows/called.yml' },
      },
    },
    'queue.yml': { on: ['merge_group'], jobs: { long: job(20) } },
    'called.yml': { on: { workflow_call: {} }, jobs: { long: job(30) } },
    'nightly.yml': { on: { schedule: [] }, jobs: { long: job(45) } },
  };
  assert.deepEqual(pullRequestTimeoutViolations(fixture), [
    'pr.yml long: timeout-minutes 13 exceeds 12',
    'pr.yml unset: timeout-minutes unset exceeds 12',
    "pr.yml step step 1: timeout-minutes 11 exceeds the job's 10",
    'called.yml long: timeout-minutes 30 exceeds 12',
    'queue.yml long: timeout-minutes 20 exceeds 12',
  ]);
});

test('pull request jobs take browsers from the Playwright image pinned to the lockfile', () => {
  const workflows = Object.fromEntries(
    readdirSync(join(workspaceRoot, workflowsDir))
      .filter((file) => /\.ya?ml$/u.test(file))
      .map((file) => [file, loadWorkflow(file)]),
  );
  assert.deepEqual(pullRequestAptViolations(workflows), []);
  assert.deepEqual(
    pullRequestAptViolations({
      'pr.yml': {
        on: ['pull_request'],
        jobs: {
          a: { steps: [{ name: 'deps', run: 'npx playwright install-deps chromium' }] },
          b: { steps: [{ run: 'sudo apt-get install -y x' }] },
          c: { steps: [{ uses: './.github/actions/setup' }] },
        },
      },
      'nightly.yml': { on: ['schedule'], jobs: { a: { steps: [{ run: 'apt install x' }] } } },
    }),
    ['pr.yml a: deps', 'pr.yml b: sudo apt-get install -y x', 'pr.yml c: ./.github/actions/setup'],
  );

  const { version } = JSON.parse(readWorkspace('package-lock.json')).packages[
    'node_modules/playwright'
  ];
  const images = Object.entries(workflows).flatMap(([file, workflow]) =>
    Object.entries(workflow.jobs ?? {}).flatMap(([id, job]) =>
      job.container ? [[`${file} ${id}`, job.container.image ?? job.container]] : [],
    ),
  );
  assert.ok(images.length > 0);
  for (const [job, image] of images)
    assert.equal(image, `mcr.microsoft.com/playwright:v${version}-noble`, job);
  for (const [file, ids] of [
    ['ci.yml', ['design-tests', 'supporting-package-tests']],
    ['browser.yml', ['canvas', 'dashboard', 'artifact']],
  ])
    for (const id of ids) assert.ok(workflows[file].jobs[id].container, `${file} ${id}`);
});

test('container jobs read runner paths from the shell, not from expressions', () => {
  // Expressions resolve to host paths, which the job container does not mount there.
  const offending = readdirSync(join(workspaceRoot, workflowsDir))
    .filter((file) => /\.ya?ml$/u.test(file))
    .flatMap((file) =>
      Object.entries(loadWorkflow(file).jobs ?? {})
        .filter(([, job]) => job.container)
        .flatMap(([id, job]) =>
          (job.steps ?? [])
            .filter((step) =>
              [step.run ?? '', ...Object.values(step.env ?? {})].some((value) =>
                /\$\{\{\s*(?:runner\.temp|github\.workspace|runner\.workspace)/u.test(value),
              ),
            )
            .map((step) => `${file} ${id}: ${step.name ?? step.run}`),
        ),
    );
  assert.deepEqual(offending, []);
});

test('container jobs trust the runner-owned workspace for git right after checkout', () => {
  for (const file of readdirSync(join(workspaceRoot, workflowsDir)).filter((name) =>
    /\.ya?ml$/u.test(name),
  ))
    for (const [id, job] of Object.entries(loadWorkflow(file).jobs ?? {})) {
      if (!job.container) continue;
      const checkout = job.steps.findIndex((step) => step.uses?.startsWith('actions/checkout@'));
      assert.equal(
        job.steps[checkout + 1]?.run,
        'git config --global --add safe.directory "$GITHUB_WORKSPACE"',
        `${file} ${id}`,
      );
    }
});

test('CI and Browser report on every pull request and merge queue run', () => {
  for (const [file, gate] of [
    ['ci.yml', 'ci-passed'],
    ['browser.yml', 'browser'],
  ]) {
    const workflow = loadWorkflow(file);
    assert.deepEqual(workflow.on.merge_group, { types: ['checks_requested'] }, file);
    assert.ok(workflow.on.pull_request, file);
    assert.equal(workflow.on.pull_request.paths, undefined, `${file} must not filter paths`);
    assert.equal(workflow.jobs[gate].if, '${{ always() }}', file);
  }
  assert.equal(loadWorkflow('browser.yml').jobs.browser.name, 'Browser');
});

test('the Browser gate passes skipped lanes and fails anything else', () => {
  const gate = loadWorkflow('browser.yml').jobs.browser;
  const lanes = Object.keys(loadWorkflow('browser.yml').jobs).filter(
    (id) => id !== 'browser' && id !== 'changes',
  );
  assert.deepEqual([...gate.needs].sort(), ['changes', ...lanes].sort());
  const verdict = (needs) =>
    spawnSync('bash', ['-e', '-c', gate.steps[0].run], {
      env: { ...process.env, NEEDS: JSON.stringify(needs) },
      encoding: 'utf8',
    }).status;
  const result = (value) => ({ result: value, outputs: {} });
  const skipped = Object.fromEntries(lanes.map((id) => [id, result('skipped')]));
  assert.equal(verdict({ changes: result('success'), ...skipped }), 0, 'a queue run passes');
  assert.equal(verdict({ changes: result('success'), ...skipped, canvas: result('success') }), 0);
  for (const value of ['failure', 'cancelled'])
    assert.equal(verdict({ changes: result('success'), ...skipped, canvas: result(value) }), 1);
  assert.equal(verdict({ changes: result('failure'), ...skipped }), 1);
  assert.equal(verdict({}), 1);
});

test('Browser runs Chromium lanes and the nightly run certifies Chromium Firefox and WebKit', () => {
  const browser = readWorkspace('.github/workflows/browser.yml');
  assert.doesNotMatch(browser, /firefox|webkit/u);
  assert.match(browser, /--grep-invert '\(bench-trace\|budgets\)\\\.spec\\\.ts'/u);

  const workflow = readWorkspace('.github/workflows/nightly.yml');
  assert.match(workflow, /schedule:\s*\n\s*- cron:/);
  assert.match(workflow, /workflow_dispatch: \{\}/);
  assert.match(workflow, /browser: \[chromium, firefox, webkit\]/);
  assert.match(workflow, /PLANR_BROWSER_ENGINE:\s*\$\{\{ matrix\.browser \}\}/);
  assert.doesNotMatch(workflow, /playwright install/u);
  assert.match(
    workflow,
    /node --test packages\/pipeline\/tests\/artifact\/sandbox-hostile\.test\.mjs/,
  );
  assert.match(workflow, /CANVAS_SECOND_DENSITY: '1'/);
  assert.match(workflow, /test:browser --workspace=@openplanr\/canvas -- bench-trace budgets/);
  const editorTrace = workflow
    .split(/\n(?= {6}- )/)
    .find((block) => block.includes('diagram-editor-canvas.browser.test.mjs'));
  assert.ok(editorTrace, 'nightly must trace the diagram editor on the canvas engine');
  assert.match(editorTrace, /working-directory: packages\/artifact/);
  assert.match(editorTrace, /PLANR_CANVAS_TRACE: '1'/);
  assert.match(editorTrace, /PLANR_BROWSER_TESTS: '1'/);

  const blocks = workflow.split(/\n(?= {6}- | {2}\S)/);
  const studio = blocks.find((block) => block.includes('diagram-studio.browser.test.mjs'));
  assert.ok(studio, 'a workflow step must run the studio, pin and frame-budget suites');
  for (const suite of ['diagram-studio', 'pin-stability', 'frame-budget']) {
    assert.match(studio, new RegExp(`packages/artifact/tests/${suite}\\.browser\\.test\\.mjs`));
  }
  assert.match(studio, /PLANR_BROWSER_TESTS: '1'/);
  assert.match(studio, /PLANR_BROWSER_ENGINE: \$\{\{ matrix\.browser \}\}/);
  assert.doesNotMatch(studio, /^\s+if:/m, 'the studio suites must run on every matrix engine');

  const stuckLaunch = blocks.find((block) => block.includes('browser-launcher.test.mjs'));
  assert.ok(stuckLaunch, 'a workflow step must run the stuck browser launch test');
  assert.match(stuckLaunch, /if: matrix\.browser == 'chromium'/);
  assert.match(stuckLaunch, /PLANR_STUCK_LAUNCH_TEST: '1'/);

  const hostile = read('tests/artifact/sandbox-hostile.test.mjs');
  assert.match(hostile, /tests\/support\/browser-launcher\.mjs/);
  assert.match(hostile, /await launchBrowser\(\)/);
  const launcher = readWorkspace('tests/support/browser-launcher.mjs');
  assert.match(launcher, /BROWSER_ENGINES = Object\.freeze\(\['chromium', 'firefox', 'webkit'\]\)/);
  assert.match(launcher, /playwright\[engine\]\.launch\(/);
});

test('the nightly run covers first runs, reports scheduled failures and runs on the release PR', () => {
  const nightly = loadWorkflow('nightly.yml');
  const text = readWorkspace('.github/workflows/nightly.yml');
  assert.doesNotMatch(text, /runs-on: macos/);
  assert.match(text, /run: node scripts\/ci\/first-run-journeys\.mjs\n/);
  assert.equal(nightly.jobs['first-run-windows'].uses, './.github/workflows/installer-guard.yml');
  assert.deepEqual(triggers(nightly).sort(), ['schedule', 'workflow_dispatch']);
  for (const id of ['compatibility', 'artifact-browsers'])
    assert.equal(nightly.jobs[id].container.options, '--user 1001', `${id} must not run as root`);

  const report = nightly.jobs.report;
  assert.deepEqual(
    [...report.needs].sort(),
    Object.keys(nightly.jobs)
      .filter((id) => id !== 'report')
      .sort(),
  );
  assert.equal(report.if, "failure() && github.event_name == 'schedule'");
  assert.deepEqual(report.permissions, { actions: 'read', issues: 'write' });

  const guard = readWorkspace('.github/workflows/installer-guard.yml');
  assert.match(guard, /workflow_call: \{\}/);
  assert.match(
    guard,
    /if: github\.event_name != 'pull_request'\s*\n\s*run: node scripts\/ci\/first-run-journeys\.mjs --scenario fresh/,
  );

  const version = loadWorkflow('version-pr.yml').jobs.version;
  const dispatch = version.steps.at(-1);
  assert.equal(dispatch.if, "steps.changesets.outputs.pr-number != ''");
  assert.match(dispatch.run, /gh workflow run nightly\.yml .*--ref changeset-release\/main/u);
  assert.equal(version.permissions.actions, 'write');
});

test('release stack metadata remains valid in spec-driven conformance', () => {
  for (const fixture of ['spec-driven-todo', 'spec-driven-todo-shipped']) {
    assert.doesNotThrow(() =>
      execFileSync(
        process.execPath,
        [
          'conformance/runner.mjs',
          '--runtime',
          'cursor',
          '--validate-schema',
          `conformance/fixtures/${fixture}`,
        ],
        { cwd: root, stdio: 'pipe' },
      ),
    );
  }
});
