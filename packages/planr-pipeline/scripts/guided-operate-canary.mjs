#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createGuidedAnswerEnvelope,
  guidedAnswerPreviewDigest,
  resolveGuidedInteraction,
} from '../lib/pipeline/index.mjs';

const fixturesOnly = process.argv.includes('--fixtures');
if (!fixturesOnly) {
  process.stderr.write(
    'The public canary is deterministic. Pass --fixtures; credentialed runtime checks run in runtime-smoke.yml.\n',
  );
  process.exitCode = 2;
} else {
  const startedAt = performance.now();
  const fixtureRoot = new URL('../conformance/fixtures/guided-operate-journeys/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('journeys.json', fixtureRoot), 'utf8'));
  const registry = JSON.parse(readFileSync(new URL('../../../registry/adapters.json', fixtureRoot), 'utf8'));
  const questionnaire = JSON.parse(readFileSync(new URL(manifest.questionnaire, fixtureRoot), 'utf8'));
  const answers = JSON.parse(readFileSync(new URL(manifest.answers, fixtureRoot), 'utf8'));
  const digests = [];

  for (const journey of manifest.journeys) {
    const interaction = resolveGuidedInteraction({
      registry,
      runtime: journey.runtime,
      runtimeReport: journey.runtimeReport,
    });
    assert.equal(interaction.mode, journey.expectedMode, journey.id);
    if (interaction.mode === 'none') continue;
    digests.push(guidedAnswerPreviewDigest(createGuidedAnswerEnvelope({
      questionnaire,
      answers,
      runtime: journey.runtime,
      runtimeVersion: journey.runtimeVersion,
      interaction: interaction.mode,
      submittedAt: '2026-07-29T09:30:00.000Z',
    })));
  }

  assert.equal(new Set(digests).size, 1);
  const durationMs = Math.round(performance.now() - startedAt);
  assert.ok(durationMs < manifest.maximumFirstPreviewMs);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    canary: 'guided-operate',
    journeys: manifest.journeys.length,
    previewDigest: digests[0],
    durationMs,
    maximumFirstPreviewMs: manifest.maximumFirstPreviewMs,
  })}\n`);
}
