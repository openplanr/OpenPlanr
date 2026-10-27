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
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLUGIN_EVAL_DIR } from './generate-claude-plugin-evals.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODEL = 'claude-sonnet-5-5';
const JUDGE_MODEL = 'claude-haiku-5-5';
const MAX_COST_USD = '10';
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

function main() {
  const generated = run(process.execPath, ['scripts/generate-all.mjs', '--write']);
  if (generated !== 0) {
    process.stderr.write(
      `npm run generate failed with exit ${generated}; the plugin was not built.\n`,
    );
    return generated;
  }

  const outputDir = join(
    repoRoot,
    PLUGIN_EVAL_DIR,
    'results',
    new Date().toISOString().replace(/[:.]/gu, '-'),
  );
  const resultPath = join(outputDir, 'aggregate-result.json');
  const status = run('claude', [
    'plugin',
    'eval',
    '.',
    '--eval-dir',
    PLUGIN_EVAL_DIR,
    '--model',
    MODEL,
    '--judge-model',
    JUDGE_MODEL,
    '--max-cost-usd',
    MAX_COST_USD,
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
    ...process.argv.slice(2),
  ]);

  if (!existsSync(resultPath)) {
    process.stderr.write(`No eval result at ${resultPath}; no run traces were copied.\n`);
    return status;
  }
  const { copied, missing, kept } = collectRunTraces({
    result: JSON.parse(readFileSync(resultPath, 'utf8')),
    outputDir,
  });
  process.stdout.write(`Copied ${copied.length} run traces to ${join(outputDir, 'traces')}.\n`);
  for (const { run: name, reason } of missing)
    process.stderr.write(`Run trace not copied for ${name}: ${reason}.\n`);
  for (const { run: name, reason } of kept)
    process.stderr.write(`Sandbox left behind for ${name}: ${reason}.\n`);
  return status;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) process.exitCode = main();
