#!/usr/bin/env node

/**
 * Builds the Claude plugin and runs the generated routing suite through `claude plugin eval`.
 * Report-only: `--threshold 0`. Extra arguments (for example `--runs 1 --case spec-vague`) pass through.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLUGIN_EVAL_DIR } from './generate-claude-plugin-evals.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODEL = 'claude-sonnet-5-5';
const JUDGE_MODEL = 'claude-haiku-5-5';
const MAX_COST_USD = '10';

/**
 * Copies each run's trace named in an eval result to `<outputDir>/traces/<case>/<arm>-<n>.jsonl`.
 * Returns the copied relative paths and the runs whose trace could not be copied.
 */
export function collectRunTraces({ result, outputDir }) {
  const copied = [];
  const missing = [];
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
        }
      }
    }
  }
  return { copied, missing };
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
  const resultPath = join(outputDir, 'result.json');
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
    '--trust-plugin',
    '--scaffold',
    // Without it the CLI deletes each run's sandbox, trace included, when the run ends.
    '--keep-temp',
    '--no-publish',
    '--output-dir',
    outputDir,
    '--report',
    join(outputDir, 'report.html'),
    '--json',
    resultPath,
    ...process.argv.slice(2),
  ]);

  if (!existsSync(resultPath)) {
    process.stderr.write(`No eval result at ${resultPath}; no run traces were copied.\n`);
    return status;
  }
  const { copied, missing } = collectRunTraces({
    result: JSON.parse(readFileSync(resultPath, 'utf8')),
    outputDir,
  });
  process.stdout.write(`Copied ${copied.length} run traces to ${join(outputDir, 'traces')}.\n`);
  for (const { run: name, reason } of missing)
    process.stderr.write(`Run trace not copied for ${name}: ${reason}.\n`);
  return status;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) process.exitCode = main();
