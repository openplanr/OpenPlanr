#!/usr/bin/env node

/**
 * Builds the Claude plugin and runs the generated routing suite through `claude plugin eval`.
 * Report-only: `--threshold 0`. Extra arguments (for example `--runs 1 --case spec-vague`) pass through.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, matchesGlob, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadPluginEvalCases,
  PLUGIN_EVAL_DIR,
  pluginEvalRunGroups,
} from './generate-claude-plugin-evals.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODEL = 'claude-sonnet-5-5';
const JUDGE_MODEL = 'claude-haiku-5-5';
const MAX_COST_USD = 10;
// The CLI creates sandboxes in /tmp even when the system temporary directory is elsewhere.
const TEMP_ROOTS = [tmpdir(), '/tmp'];

function makeWritable(directory) {
  chmodSync(directory, 0o700);
  for (const entry of readdirSync(directory, { withFileTypes: true }))
    if (entry.isDirectory()) makeWritable(join(directory, entry.name));
}

/** Removes the sandbox holding `<sandbox>/out/trace.jsonl`; returns why it was kept, if it was. */
function removeSandbox(tracePath, tempRoots) {
  const sandbox = dirname(dirname(tracePath));
  if (basename(dirname(tracePath)) !== 'out') return `${tracePath} is not in a sandbox out/ folder`;
  const roots = tempRoots.filter((root) => existsSync(root)).map((root) => realpathSync(root));
  const real = realpathSync(sandbox);
  if (!roots.includes(dirname(real))) return `${real} is not directly inside ${roots.join(' or ')}`;
  makeWritable(real);
  rmSync(real, { recursive: true });
  return null;
}

/**
 * Copies each run's trace named in an eval result to `<outputDir>/traces/<case>/<arm>-<n>.jsonl`,
 * then removes that run's sandbox when it sits directly inside one of `tempRoots`.
 * Returns the copied relative paths, the runs whose trace could not be copied and the sandboxes kept.
 */
export function collectRunTraces({ result, outputDir, tempRoots = TEMP_ROOTS }) {
  const copied = [];
  const missing = [];
  const kept = [];
  for (const { name, arms = {} } of result.cases ?? []) {
    for (const [arm, runs] of Object.entries(arms)) {
      for (const [index, { tracePath }] of runs.entries()) {
        const run = `${name}/${arm}-${index + 1}`;
        if (!tracePath) {
          missing.push({ run, reason: 'the result names no tracePath' });
        } else if (!existsSync(tracePath)) {
          missing.push({ run, reason: `${tracePath} does not exist` });
        } else {
          const target = join('traces', `${run}.jsonl`);
          mkdirSync(dirname(join(outputDir, target)), { recursive: true });
          copyFileSync(tracePath, join(outputDir, target));
          copied.push(target);
          try {
            const reason = removeSandbox(tracePath, tempRoots);
            if (reason) kept.push({ run, reason });
          } catch (error) {
            kept.push({ run, reason: `removal failed: ${error.message}` });
          }
        }
      }
    }
  }
  return { copied, missing, kept };
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  return result.status ?? 1;
}

/** Returns the `claude plugin eval` arguments for one run group. */
export function claudeEvalArgs({ outputDir, tag, grants, maxCostUsd, extraArgs = [] }) {
  return [
    'plugin',
    'eval',
    '.',
    '--eval-dir',
    PLUGIN_EVAL_DIR,
    '--tag',
    tag,
    ...(grants.length ? ['--allow-tools', ...grants] : []),
    '--model',
    MODEL,
    '--judge-model',
    JUDGE_MODEL,
    '--max-cost-usd',
    maxCostUsd.toFixed(2),
    '--threshold',
    '0',
    // Without the plugin no planr skill exists, so a baseline arm only adds cost.
    '--ablation',
    'none',
    '--trust-plugin',
    '--scaffold',
    // Without it the CLI deletes each run's sandbox, trace included, when the run ends.
    '--keep-temp',
    '--no-publish',
    '--output-dir',
    outputDir,
    ...extraArgs,
  ];
}

const RESERVED_ARGS = ['--tag', '--allow-tools', '--ablation'];
const MIN_GROUP_BUDGET_USD = 0.01;

/** Throws when pass-through arguments would change a group's tag, tool grants or arms. */
export function assertPassThroughArgs(extraArgs) {
  for (const arg of extraArgs) {
    const flag = RESERVED_ARGS.find(
      (reserved) => arg === reserved || arg.startsWith(`${reserved}=`),
    );
    if (flag)
      throw new Error(
        `${flag} cannot be passed through: the runner sets it per tool group so read-only cases never receive extra tools.`,
      );
  }
}

/** Returns the `--case` glob among pass-through arguments, if any. */
function caseGlobOf(extraArgs) {
  const index = extraArgs.indexOf('--case');
  if (index !== -1) return extraArgs[index + 1];
  return extraArgs.find((arg) => arg.startsWith('--case='))?.slice('--case='.length);
}

/**
 * Runs each group through `runEval(args)` under one shared cost ceiling and returns the worst exit status.
 * A group that leaves no result stops the run, since its spend is unknown.
 */
export function runEvalGroups({
  groups,
  runRoot,
  extraArgs,
  runEval,
  maxCostUsd = MAX_COST_USD,
  log = (text) => process.stderr.write(text),
}) {
  let status = 0;
  let spentUsd = 0;
  for (const [index, { tag, grants }] of groups.entries()) {
    const budgetUsd = maxCostUsd - spentUsd;
    if (budgetUsd < MIN_GROUP_BUDGET_USD) {
      log(`Cost ceiling of $${maxCostUsd} reached; group ${tag} did not run.\n`);
      status = Math.max(status, 2);
      continue;
    }
    const outputDir = join(runRoot, tag);
    status = Math.max(
      status,
      runEval(claudeEvalArgs({ outputDir, tag, grants, maxCostUsd: budgetUsd, extraArgs })),
    );
    const resultPath = join(outputDir, 'aggregate-result.json');
    if (!existsSync(resultPath)) {
      const notRun = groups.slice(index + 1).map((group) => group.tag);
      log(`No eval result at ${resultPath}; its spend is unknown and no run traces were copied.\n`);
      if (notRun.length) log(`Groups not run: ${notRun.join(', ')}.\n`);
      return Math.max(status, 1);
    }
    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    spentUsd += result.costUsd ?? 0;
    const { copied, missing, kept } = collectRunTraces({ result, outputDir });
    log(`Copied ${copied.length} run traces to ${join(outputDir, 'traces')}.\n`);
    for (const { run: name, reason } of missing)
      log(`Run trace not copied for ${name}: ${reason}.\n`);
    for (const { run: name, reason } of kept) log(`Sandbox left behind for ${name}: ${reason}.\n`);
  }
  return status;
}

function main() {
  const extraArgs = process.argv.slice(2);
  try {
    assertPassThroughArgs(extraArgs);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
  const generated = run(process.execPath, ['scripts/generate-all.mjs', '--write']);
  if (generated !== 0) {
    process.stderr.write(
      `npm run generate failed with exit ${generated}; the plugin was not built.\n`,
    );
    return generated;
  }

  const caseGlob = caseGlobOf(extraArgs);
  const groups = pluginEvalRunGroups(loadPluginEvalCases()).filter(
    ({ caseIds }) => !caseGlob || caseIds.some((id) => matchesGlob(id, caseGlob)),
  );
  if (!groups.length) {
    process.stderr.write(`No eval case matches --case ${caseGlob}.\n`);
    return 1;
  }
  const runRoot = join(
    repoRoot,
    PLUGIN_EVAL_DIR,
    'results',
    new Date().toISOString().replace(/[:.]/gu, '-'),
  );
  return runEvalGroups({ groups, runRoot, extraArgs, runEval: (args) => run('claude', args) });
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) process.exitCode = main();
