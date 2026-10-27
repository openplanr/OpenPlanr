#!/usr/bin/env node

/**
 * Builds the Claude plugin and runs the generated routing suite through `claude plugin eval`.
 * Report-only: `--threshold 0`. Extra arguments (for example `--runs 1 --case spec-vague`) pass through.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLUGIN_EVAL_DIR } from './generate-claude-plugin-evals.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODEL = 'claude-sonnet-5-5';
const JUDGE_MODEL = 'claude-haiku-5-5';
const MAX_COST_USD = '10';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  return result.status ?? 1;
}

const generated = run(process.execPath, ['scripts/generate-all.mjs', '--write']);
if (generated !== 0) {
  process.stderr.write(
    `npm run generate failed with exit ${generated}; the plugin was not built.\n`,
  );
  process.exit(generated);
}

const outputDir = join(PLUGIN_EVAL_DIR, 'results', new Date().toISOString().replace(/[:.]/gu, '-'));
process.exitCode = run('claude', [
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
  '--no-publish',
  '--output-dir',
  outputDir,
  '--report',
  join(outputDir, 'report.html'),
  '--json',
  join(outputDir, 'result.json'),
  ...process.argv.slice(2),
]);
