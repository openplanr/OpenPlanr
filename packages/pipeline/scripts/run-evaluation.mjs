#!/usr/bin/env node

/**
 * Local and CI entrypoint for the skill evaluation laboratory.
 *
 *   node scripts/run-evaluation.mjs [--json] [--ci] [--out <dir>]
 *                                   [--waiver-file <path>] [--owner <identity>]
 *                                   [--no-browser-adapter] --source-root <canonical-source-root>
 *
 * The run measures and reports. It never edits a graded skill, assigns a
 * version, or performs a release effect.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLoopbackBrowserAdapter } from '../lib/evaluation/journeys.mjs';
import { writeCiReports, writeLocalRun } from '../lib/evaluation/report.mjs';
import { runEvaluation } from '../lib/evaluation/runner.mjs';
import { PipelineError } from '../lib/pipeline/errors.mjs';
import { assertEvaluationWaiver } from '../lib/pipeline/evaluation-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

const KNOWN_FLAGS = new Set(['--json', '--ci', '--no-browser-adapter']);
const KNOWN_OPTIONS = new Set(['--out', '--waiver-file', '--owner', '--source-root']);

function parseArguments(tokens) {
  const flags = new Set();
  const options = new Map();
  const owners = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (KNOWN_FLAGS.has(token)) {
      flags.add(token);
      continue;
    }
    if (KNOWN_OPTIONS.has(token)) {
      const value = tokens[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new PipelineError(
          'E_EVALUATION_ARGUMENT_INVALID',
          `${token} requires a value.`,
          'Supply the value immediately after the option.',
        );
      }
      if (token === '--owner') owners.push(value);
      else options.set(token, value);
      index += 1;
      continue;
    }
    throw new PipelineError(
      'E_EVALUATION_ARGUMENT_INVALID',
      `Unknown argument ${token}.`,
      `Use only: ${[...KNOWN_FLAGS, ...KNOWN_OPTIONS].join(', ')}.`,
    );
  }
  return { flags, options, owners };
}

function loadWaivers(path) {
  if (path === undefined) return [];
  const parsed = JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new PipelineError(
      'E_EVALUATION_ARGUMENT_INVALID',
      'A waiver file holds an array of waiver records.',
      'Wrap the waivers in a JSON array.',
    );
  }
  return parsed.map((waiver, index) => assertEvaluationWaiver(waiver, `waiver[${index}]`));
}

function renderHuman(outcome, artifacts) {
  const { counters, rates, budget } = outcome.aggregateReport;
  const lines = [
    `verdict            ${outcome.verdict}`,
    `run                ${outcome.runId}`,
    `scenarios          ${counters.scenariosTotal} total · ${counters.scenariosPassed} passed · ${counters.scenariosFailed} failed · ${counters.scenariosBlocked} blocked · ${counters.scenariosAbsent} absent · ${counters.scenariosWaived} waived`,
    `trigger            precision ${rates.triggerPrecision} bp · recall ${rates.triggerRecall} bp`,
    `journeys           ${counters.journeysCompleted}/${counters.journeysAttempted} completed (${rates.journeyCompletion} bp)`,
    `schema validity    ${rates.schemaValidity} bp over ${counters.outputsValidated} accepted outputs`,
    `parity             asset ${rates.assetParity} bp · export ${rates.exportParity} bp · package ${rates.packageParity} bp`,
    `findings           P0 ${counters.findingsP0} · P1 ${counters.findingsP1} · P2 ${counters.findingsP2} · P3 ${counters.findingsP3}`,
    `regression         latency ${budget.latencyRegression} bp · cost ${budget.costRegression} bp`,
  ];
  for (const receipt of outcome.receipts) {
    lines.push(
      `  ${receipt.subject.skillId.padEnd(20)} ${receipt.result}${receipt.blockingMetrics.length > 0 ? ` — blocked by ${receipt.blockingMetrics.join(', ')}` : ''}`,
    );
  }
  for (const waiver of outcome.gates.appliedWaivers) {
    lines.push(
      `  waiver applied      ${waiver.metric} · ${waiver.scopeKind} · ${waiver.reasonCode} · ${waiver.ownerSignatureIdentity} · expires ${waiver.expiresAt}`,
    );
  }
  for (const waiver of outcome.gates.refusedWaivers) {
    lines.push(`  waiver refused      ${waiver.metric} · ${waiver.code}`);
  }
  if (outcome.uncoveredSkills.length > 0) {
    lines.push(`  catalog uncovered   ${outcome.uncoveredSkills.join(', ')}`);
  }
  lines.push(`artifacts          ${artifacts.join(' · ')}`);
  return `${lines.join('\n')}\n`;
}

try {
  const { flags, options, owners } = parseArguments(argv);
  const outcome = await runEvaluation({
    repoRoot,
    sourceRoot: options.has('--source-root') ? resolve(options.get('--source-root')) : undefined,
    now: new Date().toISOString(),
    waivers: loadWaivers(options.get('--waiver-file')),
    owners,
    browserAdapter: flags.has('--no-browser-adapter') ? null : createLoopbackBrowserAdapter(),
  });

  const localDirectory = resolve(
    repoRoot,
    options.get('--out') ?? join('evaluation', '.runs', outcome.runId),
  );
  writeLocalRun(localDirectory, {
    runResult: outcome.runResult,
    aggregateReport: outcome.aggregateReport,
    receipts: outcome.receipts,
    rawEvidence: outcome.evidenceInputs,
  });
  const artifacts = [
    'run-result.json',
    'evaluation-aggregate.json',
    'certification-receipts.json',
    'raw-evidence.json',
  ];
  if (flags.has('--ci'))
    artifacts.push(...writeCiReports(join(localDirectory, 'ci'), outcome.aggregateReport));

  if (flags.has('--json')) {
    process.stdout.write(
      `${JSON.stringify({
        ok: outcome.verdict === 'PASS',
        verdict: outcome.verdict,
        runId: outcome.runId,
        blockingMetrics: outcome.gates.blockingMetrics,
        appliedWaivers: outcome.gates.appliedWaivers,
        refusedWaivers: outcome.gates.refusedWaivers,
        report: outcome.aggregateReport,
        receipts: outcome.receipts,
        uncoveredSkills: outcome.uncoveredSkills,
      })}\n`,
    );
  } else {
    process.stdout.write(renderHuman(outcome, artifacts));
  }
  process.exitCode = outcome.verdict === 'PASS' ? 0 : 1;
} catch (error) {
  const typed = error instanceof PipelineError ? error.toJSON() : null;
  const value = {
    ok: false,
    code: typed?.code ?? 'E_EVALUATION_RUN_FAILED',
    problem: typed?.problem ?? error.message,
    ...(typed?.fix ? { fix: typed.fix } : {}),
  };
  process.stderr.write(
    `${argv.includes('--json') ? JSON.stringify(value) : `${value.code}: ${value.problem}`}\n`,
  );
  process.exitCode = 1;
}
