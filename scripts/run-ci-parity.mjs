#!/usr/bin/env node
// Run the Workspace CI job commands locally, in order, on the current Node version.
// Usage: node scripts/run-ci-parity.mjs [--only <id,...>] [--skip <id,...>] [--list]
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_PATH = '.github/workflows/ci.yml';

const JOB_KEYS = new Set([
  'name',
  'needs',
  'if',
  'strategy',
  'runs-on',
  'timeout-minutes',
  'steps',
]);
const STRATEGY_KEYS = new Set(['fail-fast', 'matrix']);
const STEP_KEYS = new Set(['name', 'uses', 'with', 'run', 'env', 'working-directory']);
const CONSUMER_IF = /^\$\{\{\s*!cancelled\(\)\s*\}\}$/u;
const RUNNER_ACTIONS = /^actions\/(?:checkout|setup-node|upload-artifact|download-artifact)@/u;
// Runner provisioning that a contributor's checkout already has after the CONTRIBUTING setup.
const RUNNER_SETUP = /^(?:npm ci|npm exec --workspace=\S+ -- playwright install\b.*)$/u;
const RESTORE = /^tar -xzmf "\$RUNNER_TEMP\/build-outputs\.tgz"$/u;
const MATRIX_EXPRESSION = /\$\{\{\s*matrix\.([\w-]+)\s*\}\}/gu;
const NODE_AXIS = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/u;
const CONSUMER_NODE_TEST = /^node --test(?:\s+[\w./=-]+)*$/u;
const CONTRIBUTOR_NODE_RANGE = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  .engines.node;
/** The required status job: it only reads the other jobs' results, so it is not replayed. */
export const AGGREGATE_JOB = 'ci-passed';

/** The local command runner needs the contributor runtime, even for a consumer CI job. */
export function assertContributorRuntime(version) {
  const actual = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  const accepted = CONTRIBUTOR_NODE_RANGE.split('||').some((branch) => {
    const required = /^(\^|>=)([1-9]\d*)\.(\d+)\.(\d+)$/u.exec(branch.trim());
    if (!required) throw new Error(`Unsupported contributor Node range: ${CONTRIBUTOR_NODE_RANGE}`);
    if (!actual) return false;
    const current = actual.slice(1).map(Number);
    const minimum = required.slice(2).map(Number);
    if (![...current, ...minimum].every(Number.isSafeInteger)) return false;
    const difference =
      current.map((part, index) => part - minimum[index]).find((part) => part !== 0) ?? 0;
    return difference >= 0 && (required[1] === '>=' || current[0] === minimum[0]);
  });
  if (!accepted)
    throw new Error(
      `verify:ci requires contributor Node.js ${CONTRIBUTOR_NODE_RANGE}; found ${version}. ` +
        'Use a supported contributor runtime. CI verifies installed public packages separately.',
    );
}

/**
 * Derives the local run of every Workspace CI job on one Node major version.
 * Throws on a job or step shape it cannot reproduce, except in the build job: that job only
 * contributes its bare `npm run` lines, and its other steps are not checked.
 */
export function planLocalCi(workflow, nodeMajor) {
  for (const key of ['env', 'defaults']) {
    if (workflow[key] !== undefined) {
      throw new Error(`${WORKFLOW_PATH} sets workflow-level ${key}, which the local run ignores`);
    }
  }
  const entries = Object.entries(workflow.jobs ?? {});
  const producers = entries.filter(([, job]) => (job.steps ?? []).some(uploadsBuildOutputs));
  if (producers.length !== 1) {
    throw new Error(
      `${WORKFLOW_PATH} must have exactly one job that uploads build-outputs; found ${producers.length}`,
    );
  }
  const [[producer, producerJob]] = producers;
  const context = {
    producer,
    buildNode: setupNodeVersion(producer, producerJob),
    nodeMajor: String(nodeMajor),
    // The build job's npm commands stand in for restoring its outputs. Its drift checks stay
    // in quality so a targeted job still runs on a tree with uncommitted edits.
    prepare: producerJob.steps
      .flatMap((step) => (step.run ?? '').split('\n'))
      .map((line) => line.trim())
      .filter((line) => /^npm run [a-z][\w:-]*$/u.test(line)),
  };
  return {
    producer,
    buildNode: context.buildNode,
    prepare: context.prepare,
    jobs: entries
      .filter(([id]) => id !== producer && id !== AGGREGATE_JOB)
      .map(([id, job]) => planJob(id, job, context)),
  };
}

function uploadsBuildOutputs(step) {
  return (
    step.uses?.startsWith('actions/upload-artifact@') === true &&
    step.with?.name === 'build-outputs'
  );
}

function setupNodeVersion(id, job) {
  const setups = job.steps.flatMap((step, index) =>
    step.uses?.startsWith('actions/setup-node@') ? [{ ...step, index }] : [],
  );
  if (setups.length === 1 && setups[0].with?.['node-version'] !== undefined)
    return String(setups[0].with['node-version']);
  const [preparation, consumer] = setups;
  const version = String(consumer?.with?.['node-version']);
  const axis = NODE_AXIS.exec(version)?.[1];
  const install = job.steps.findIndex((step) => step.run?.trim() === 'npm ci');
  const restore = job.steps.findIndex((step) => RESTORE.test(step.run?.trim() ?? ''));
  const proof = job.steps.findIndex((step) => step.run?.trim() === 'npm run verify:packed:strict');
  const consumerCommands = job.steps
    .slice((consumer?.index ?? job.steps.length) + 1)
    .filter((step) => step.run !== undefined)
    .map((step) => step.run.trim());
  if (
    id !== 'packed-public-packages' ||
    setups.length !== 2 ||
    String(preparation.with?.['node-version']) !== '24' ||
    !axis ||
    !Array.isArray(job.strategy?.matrix?.[axis]) ||
    !(
      preparation.index < install &&
      install < consumer.index &&
      restore > install &&
      restore < consumer.index &&
      proof > consumer.index
    ) ||
    consumerCommands.some(
      (command) => command !== 'npm run verify:packed:strict' && !CONSUMER_NODE_TEST.test(command),
    )
  )
    throw new Error(
      `${id} must use one setup-node step or the explicit contributor-to-consumer packed setup`,
    );
  return version;
}

function requireKnownKeys(label, object, known) {
  for (const key of Object.keys(object ?? {})) {
    if (!known.has(key)) throw new Error(`${label} sets ${key}, which the local run ignores`);
  }
}

function planJob(id, job, context) {
  requireKnownKeys(id, job, JOB_KEYS);
  requireKnownKeys(`${id} strategy`, job.strategy, STRATEGY_KEYS);
  const needs = [job.needs ?? []].flat();
  if (needs.some((need) => need !== context.producer)) {
    throw new Error(
      `${id} needs ${needs.join(', ')}; the local run orders jobs only after the build`,
    );
  }
  if (job.if !== undefined && !CONSUMER_IF.test(job.if)) {
    throw new Error(`${id} runs under if: ${job.if}, which the local run cannot evaluate`);
  }
  const all = expandMatrix(id, job.strategy?.matrix).map((matrix) =>
    planInstance(id, job, matrix, context.producer),
  );
  const nodeAxis = NODE_AXIS.exec(setupNodeVersion(id, job))?.[1];
  const lines = all[0].steps.flatMap(({ script }) => script.split('\n').map((line) => line.trim()));
  return {
    id,
    consumer: all[0].consumer,
    coversPrepare: context.prepare.every((command) => lines.includes(command)),
    ciNodes: [...new Set(all.map(({ node }) => node))],
    instances: nodeAxis ? selectNode(all, nodeAxis, context) : all,
  };
}

// A Node-matrix job runs once locally: its entry for this Node, else its entry for the Node
// the build job uses. A job with neither, such as a compatibility check, is reported instead.
function selectNode(instances, axis, { nodeMajor, buildNode }) {
  const groups = new Map();
  for (const instance of instances) {
    const key = JSON.stringify(Object.entries(instance.matrix).filter(([name]) => name !== axis));
    groups.set(key, [...(groups.get(key) ?? []), instance]);
  }
  return [...groups.values()].flatMap((group) => {
    const selected =
      group.find(({ node }) => node === nodeMajor) ?? group.find(({ node }) => node === buildNode);
    return selected ? [selected] : [];
  });
}

function expandMatrix(id, matrix) {
  if (matrix === undefined) return [{}];
  const { include, exclude, ...axes } = matrix;
  const names = Object.keys(axes);
  if (exclude !== undefined || (include !== undefined && names.length > 0)) {
    throw new Error(
      `${id} combines matrix axes with include or exclude, which the local run does not expand`,
    );
  }
  const combinations =
    include !== undefined
      ? include.map((entry) => ({ ...entry }))
      : names.reduce(
          (partial, name) => {
            if (!Array.isArray(axes[name])) {
              throw new Error(`${id} matrix axis ${name} is not a list`);
            }
            return partial.flatMap((combination) =>
              axes[name].map((value) => ({ ...combination, [name]: value })),
            );
          },
          [{}],
        );
  if (combinations.length === 0) throw new Error(`${id} matrix expands to no entries`);
  return combinations;
}

// Runner steps provision CI and are not repeated locally; restore marks a build consumer.
function stepRole(step, label, producer) {
  requireKnownKeys(label, step, STEP_KEYS);
  if (step.uses !== undefined) {
    if (!RUNNER_ACTIONS.test(step.uses)) {
      throw new Error(`${label} uses ${step.uses}, which cannot run locally`);
    }
    return 'runner';
  }
  if (typeof step.run !== 'string') throw new Error(`${label} has neither run nor uses`);
  const run = step.run.trim();
  if (step.env?.BUILD_RESULT === `\${{ needs.${producer}.result }}` || RUNNER_SETUP.test(run)) {
    return 'runner';
  }
  return RESTORE.test(run) ? 'restore' : 'local';
}

function planInstance(id, job, matrix, producer) {
  const where = Object.keys(matrix).length > 0 ? `${id} ${JSON.stringify(matrix)}` : id;
  const steps = job.steps.map((step, index) => {
    const label = `${where} step ${index + 1}${step.name ? ` (${step.name})` : ''}`;
    return { step, label, role: stepRole(step, label, producer) };
  });
  return {
    name: substitute(job.name ?? id, matrix, `${where} name`),
    node: substitute(setupNodeVersion(id, job), matrix, `${where} node-version`),
    preparationNode: substitute(
      job.steps.find((step) => step.uses?.startsWith('actions/setup-node@')).with['node-version'],
      matrix,
      `${where} preparation node-version`,
    ),
    matrix,
    consumer: steps.some(({ role }) => role === 'restore'),
    steps: steps
      .filter(({ role }) => role === 'local')
      .map(({ step, label }) => ({
        name: step.name ?? step.run.trim(),
        script: substitute(step.run.trim(), matrix, label),
        workingDirectory: substitute(step['working-directory'] ?? '.', matrix, label),
        env: Object.fromEntries(
          Object.entries(step.env ?? {}).map(([name, value]) => [
            name,
            substitute(value, matrix, label),
          ]),
        ),
      })),
  };
}

function substitute(text, matrix, where) {
  const value = String(text).replace(MATRIX_EXPRESSION, (_expression, key) => {
    if (!Object.hasOwn(matrix, key)) {
      throw new Error(`${where} references matrix.${key}, which its matrix does not define`);
    }
    return String(matrix[key]);
  });
  if (value.includes('${{')) {
    throw new Error(`${where} uses a GitHub expression the local run cannot evaluate: ${value}`);
  }
  return value;
}

function notOnThisNode(job, nodeMajor) {
  return `CI runs ${job.id} on Node ${job.ciNodes.join(', ')}, not Node ${nodeMajor}`;
}

function selection(args, jobs, nodeMajor) {
  const list = (name) => {
    const index = args.indexOf(name);
    return index === -1
      ? null
      : new Set(
          args[index + 1]
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
        );
  };
  const only = list('--only');
  const skip = list('--skip') ?? new Set();
  for (const id of [...(only ?? []), ...skip]) {
    if (!jobs.some((job) => job.id === id)) {
      throw new Error(
        `Unknown CI job id: ${id}; ${WORKFLOW_PATH} defines ${jobs.map((job) => job.id).join(', ')}`,
      );
    }
  }
  for (const job of jobs) {
    if (only?.has(job.id) && job.instances.length === 0) {
      throw new Error(notOnThisNode(job, nodeMajor));
    }
  }
  return (job) => (only === null || only.has(job.id)) && !skip.has(job.id);
}

function runSteps(steps) {
  for (const step of steps) {
    const directory = step.workingDirectory === '.' ? '' : ` (in ${step.workingDirectory})`;
    console.log(`-- ${step.name}${directory}`);
    for (const line of step.script.split('\n')) console.log(`$ ${line}`);
    const run = spawnSync('bash', ['-e', '-c', step.script], {
      cwd: resolve(root, step.workingDirectory),
      stdio: 'inherit',
      env: { ...process.env, ...step.env, CI: '1' },
    });
    if (run.error) {
      throw new Error(`Could not start bash for "${step.name}": ${run.error.message}`, {
        cause: run.error,
      });
    }
    if (run.status !== 0) return `${step.name} exited with ${run.status ?? run.signal}`;
  }
  return null;
}

function runJob(job, plan, state) {
  for (const instance of job.instances) {
    const label = `${job.id}: ${instance.name}`;
    console.log(`\n=== ${label} ===`);
    if (instance.preparationNode !== instance.node)
      console.log(
        `CI prepares on Node ${instance.preparationNode}, then executes packages on Node ${instance.node}; ` +
          `this local replay uses ${process.version} for every command.`,
      );
    const startedAt = Date.now();
    const prepare =
      job.consumer && !state.prepared
        ? plan.prepare.map((script) => ({
            name: `Prepare the ${plan.producer} job outputs`,
            script,
            workingDirectory: '.',
            env: {},
          }))
        : [];
    const failure = runSteps([...prepare, ...instance.steps]);
    state.results.push({
      label,
      preparationNode: instance.preparationNode,
      consumerNode: instance.node,
      localNode: process.versions.node,
      status: failure ? 'failed' : 'passed',
      seconds: Math.round((Date.now() - startedAt) / 1000),
      failure,
    });
    if (failure) return false;
    if (job.consumer || job.coversPrepare) state.prepared = true;
  }
  return true;
}

function printList(plan, nodeMajor) {
  for (const job of plan.jobs) {
    if (job.instances.length === 0) {
      console.log(`${job.id.padEnd(28)} (${notOnThisNode(job, nodeMajor)})`);
    }
    for (const instance of job.instances) {
      const preparation =
        instance.preparationNode === instance.node
          ? ''
          : ` (CI preparation Node ${instance.preparationNode}; package execution Node ${instance.node})`;
      console.log(`${job.id.padEnd(28)} ${instance.name}${preparation}`);
    }
  }
}

function printSummary(results, startedAt) {
  console.log('\n=== verify:ci summary ===');
  for (const result of results) {
    console.log(
      `${result.status.padEnd(8)} ${result.label}${result.seconds ? ` (${result.seconds}s)` : ''}${result.failure ? ` — ${result.failure}` : ''}`,
    );
  }
  const ran = results.filter((result) => result.seconds !== undefined);
  console.log(
    `${ran.length} job(s) ran in ${Math.round((Date.now() - startedAt) / 1000)}s on Node ${process.version}.`,
  );
}

function main(args) {
  assertContributorRuntime(process.versions.node);
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const plan = planLocalCi(load(readFileSync(resolve(root, WORKFLOW_PATH), 'utf8')), nodeMajor);
  if (args.includes('--list')) {
    printList(plan, nodeMajor);
    return 0;
  }
  const selected = selection(args, plan.jobs, nodeMajor);
  const state = { prepared: false, results: [] };
  const startedAt = Date.now();
  for (const job of plan.jobs) {
    if (!selected(job)) {
      state.results.push({ label: job.id, status: 'skipped' });
    } else if (job.instances.length === 0) {
      state.results.push({
        label: job.id,
        status: 'not run',
        failure: notOnThisNode(job, nodeMajor),
      });
    } else if (!runJob(job, plan, state)) {
      break;
    }
  }
  printSummary(state.results, startedAt);
  return state.results.some((result) => result.status === 'failed') ? 1 : 0;
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = main(process.argv.slice(2));
}
