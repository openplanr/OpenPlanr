#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  let samples = 3;
  let output = null;
  let enforce = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--samples' && argv[index + 1]) samples = Number(argv[(index += 1)]);
    else if (argv[index] === '--output' && argv[index + 1]) output = resolve(argv[(index += 1)]);
    else if (argv[index] === '--enforce') enforce = true;
    else
      throw new Error(
        'Usage: benchmark-release.mjs [--samples <count>] [--output <file>] [--enforce]',
      );
  }
  if (!Number.isInteger(samples) || samples < 1 || samples > 10)
    throw new Error('--samples must be an integer from 1 to 10.');
  return { samples, output, enforce };
}

function files(root) {
  const output = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) output.push(path);
      else throw new Error(`Performance inventory accepts regular files only: ${path}`);
    }
  };
  visit(root);
  return output;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function measure(label, command, samples) {
  const durations = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const started = performance.now();
    const result = spawnSync(process.execPath, command, {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    });
    const duration = performance.now() - started;
    if (result.status !== 0)
      throw new Error(`${label} failed (${result.status})\n${result.stdout}${result.stderr}`);
    durations.push(Number(duration.toFixed(3)));
  }
  return {
    samples: durations,
    medianMs: Number(percentile(durations, 0.5).toFixed(3)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(3)),
  };
}

function contentMetrics() {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'adapters/manifests/codex-plugin-content.json'), 'utf8'),
  );
  const canonical = manifest.skills.filter(({ classification }) => classification === 'canonical');
  const rows = canonical.map((skill) => {
    const root = join(repoRoot, manifest.pluginRoot, manifest.skillRoot.slice(2), skill.skillId);
    const members = files(root);
    const primary = members.find((path) => path.endsWith(`${sep}SKILL.md`));
    const metadata = members.find((path) => path.endsWith(`${sep}agents${sep}openai.yaml`));
    const selectedBytes = members
      .filter((path) => !path.endsWith(`${sep}agents${sep}openai.yaml`))
      .reduce((sum, path) => sum + statSync(path).size, 0);
    const primaryText = readFileSync(primary, 'utf8');
    return {
      skillId: skill.skillId,
      primaryBytes: Buffer.byteLength(primaryText),
      primaryLines: primaryText.split('\n').length - 1,
      metadataBytes: statSync(metadata).size,
      selectedContextBytes: selectedBytes,
      selectedContextTokenEstimate: Math.ceil(selectedBytes / 4),
      supportFiles: members.length - 2,
    };
  });
  const pluginRoot = join(repoRoot, manifest.pluginRoot);
  const pluginFiles = files(pluginRoot);
  const releaseRoot = join(repoRoot, 'release');
  const releaseFiles = files(releaseRoot);
  return {
    estimation:
      'UTF-8 bytes divided by four; measurement is a comparison budget, not a tokenizer claim.',
    skills: rows,
    totals: {
      canonicalSkills: rows.length,
      metadataBytes: rows.reduce((sum, row) => sum + row.metadataBytes, 0),
      selectedContextBytes: rows.reduce((sum, row) => sum + row.selectedContextBytes, 0),
      maxPrimaryLines: Math.max(...rows.map(({ primaryLines }) => primaryLines)),
      maxSelectedContextTokenEstimate: Math.max(
        ...rows.map(({ selectedContextTokenEstimate }) => selectedContextTokenEstimate),
      ),
      pluginFiles: pluginFiles.length,
      pluginBytes: pluginFiles.reduce((sum, path) => sum + statSync(path).size, 0),
      releaseFiles: releaseFiles.length,
      releaseBytes: releaseFiles.reduce((sum, path) => sum + statSync(path).size, 0),
    },
  };
}

const { samples, output, enforce } = parseArgs(process.argv.slice(2));
const content = contentMetrics();
const timings = {
  generatedCheck: measure('generated check', ['scripts/generate-all.mjs', '--check'], samples),
  releasePackaging: measure(
    'release packaging',
    ['scripts/skills/package-v18-release.mjs', '--check'],
    samples,
  ),
  installedContentCanary: measure(
    'installed content canary',
    ['scripts/skills/verify-v18-release.mjs'],
    samples,
  ),
  routingEvaluation: measure(
    'routing evaluation',
    ['scripts/skills/evaluate-catalog.mjs'],
    samples,
  ),
};
const budgets = {
  generatedCheckP95Ms: 30_000,
  releasePackagingP95Ms: 5_000,
  installedContentCanaryP95Ms: 15_000,
  routingEvaluationP95Ms: 5_000,
  maxPrimaryLines: 500,
  maxSelectedContextTokenEstimate: 12_000,
  pluginBytes: 1_048_576,
};
const checks = {
  generatedCheck: timings.generatedCheck.p95Ms <= budgets.generatedCheckP95Ms,
  releasePackaging: timings.releasePackaging.p95Ms <= budgets.releasePackagingP95Ms,
  installedContentCanary:
    timings.installedContentCanary.p95Ms <= budgets.installedContentCanaryP95Ms,
  routingEvaluation: timings.routingEvaluation.p95Ms <= budgets.routingEvaluationP95Ms,
  primaryLength: content.totals.maxPrimaryLines <= budgets.maxPrimaryLines,
  selectedContext:
    content.totals.maxSelectedContextTokenEstimate <= budgets.maxSelectedContextTokenEstimate,
  pluginSize: content.totals.pluginBytes <= budgets.pluginBytes,
};
const report = {
  kind: 'openplanr-skill-release-performance',
  schemaVersion: '1.0.0',
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  samples,
  timings,
  content,
  budgets,
  checks,
  status: Object.values(checks).every(Boolean) ? 'pass' : 'budget-deviation',
};
const bytes = `${JSON.stringify(report, null, 2)}\n`;
if (output) {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, bytes, { mode: 0o644 });
}
process.stdout.write(bytes);
if (enforce && report.status !== 'pass') process.exitCode = 1;
