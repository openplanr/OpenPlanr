#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  let model = 'gpt-5.4-mini';
  let output = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--model' && argv[index + 1]) model = argv[index += 1];
    else if (argv[index] === '--output' && argv[index + 1]) output = resolve(argv[index += 1]);
    else throw new Error('Usage: evaluate-model-release.mjs [--model <model>] [--output <file>]');
  }
  return { model, output };
}

function usageFromEvents(output) {
  let usage = null;
  for (const line of output.split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      const candidate = event.usage ?? event.item?.usage ?? event.turn?.usage;
      if (candidate) usage = candidate;
    } catch {
      // Codex may emit a non-JSON warning before JSONL events. It is not usage.
    }
  }
  return usage;
}

const { model, output } = parseArgs(process.argv.slice(2));
const registry = JSON.parse(readFileSync(join(repoRoot, 'skills/registry.json'), 'utf8'));
const corpus = JSON.parse(readFileSync(join(repoRoot, 'evaluation/skills/routing-corpus.json'), 'utf8'));
const descriptions = registry.skills.map(({ skillId, description }) => ({ skillId, description }));
const cases = corpus.cases.map(({ id, input, expectedSkillId = null }) => ({ id, input, expectedSkillId }));
const prompt = [
  'You are evaluating metadata-only agent-skill discovery.',
  'Use only the supplied descriptions and aliases. Do not use tools or outside knowledge.',
  'For each case, choose exactly one canonical skillId or null when no skill confidently applies.',
  'Return every case exactly once in the requested JSON shape. Keep each reason under 20 words.',
  '',
  `Skills: ${JSON.stringify(descriptions)}`,
  `Aliases: ${JSON.stringify(registry.aliases)}`,
  `Cases: ${JSON.stringify(cases.map(({ id, input }) => ({ id, input })))}`,
].join('\n');
const scratch = mkdtempSync(join(tmpdir(), 'openplanr-model-eval-'));
try {
  const schemaPath = join(scratch, 'response.schema.json');
  const responsePath = join(scratch, 'response.json');
  writeFileSync(schemaPath, `${JSON.stringify({
    type: 'object',
    additionalProperties: false,
    required: ['results'],
    properties: {
      results: {
        type: 'array',
        minItems: cases.length,
        maxItems: cases.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'skillId', 'reason'],
          properties: {
            id: { type: 'string' },
            skillId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            reason: { type: 'string' },
          },
        },
      },
    },
  }, null, 2)}\n`);
  const started = performance.now();
  const run = spawnSync('codex', [
    'exec',
    '--model', model,
    '--ephemeral',
    '--ignore-user-config',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '--cd', scratch,
    '--output-schema', schemaPath,
    '--output-last-message', responsePath,
    '--json',
    '-',
  ], { input: prompt, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  const latencyMs = Number((performance.now() - started).toFixed(3));
  if (run.status !== 0) throw new Error(`Codex model evaluation failed (${run.status})\n${run.stdout}${run.stderr}`);
  const response = JSON.parse(readFileSync(responsePath, 'utf8'));
  const byId = new Map(response.results.map((result) => [result.id, result]));
  if (byId.size !== cases.length) throw new Error(`Model response returned ${byId.size}/${cases.length} unique cases.`);
  const observations = cases.map((testCase) => {
    const actual = byId.get(testCase.id);
    if (!actual) throw new Error(`Model response omitted ${testCase.id}.`);
    const passed = actual.skillId === testCase.expectedSkillId;
    return { ...testCase, actualSkillId: actual.skillId, reason: actual.reason, passed };
  });
  const positives = observations.filter(({ expectedSkillId }) => expectedSkillId !== null);
  const negatives = observations.filter(({ expectedSkillId }) => expectedSkillId === null);
  const falseNegatives = positives.filter(({ actualSkillId, expectedSkillId }) => actualSkillId !== expectedSkillId);
  const falsePositives = negatives.filter(({ actualSkillId }) => actualSkillId !== null);
  const passed = observations.filter((observation) => observation.passed).length;
  const report = {
    kind: 'openplanr-model-backed-skill-evaluation',
    schemaVersion: '1.0.0',
    model,
    hostClass: 'codex-cli-metadata-only',
    corpus: 'evaluation/skills/routing-corpus.json',
    skillCount: descriptions.length,
    caseCount: observations.length,
    passed,
    accuracy: passed / observations.length,
    falsePositiveCount: falsePositives.length,
    falseNegativeCount: falseNegatives.length,
    latencyMs,
    usage: usageFromEvents(run.stdout),
    status: passed / observations.length >= corpus.threshold ? 'pass' : 'below-threshold',
    failures: observations.filter((observation) => !observation.passed),
  };
  const bytes = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, bytes, { mode: 0o644 });
  }
  process.stdout.write(bytes);
  if (report.status !== 'pass') process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
