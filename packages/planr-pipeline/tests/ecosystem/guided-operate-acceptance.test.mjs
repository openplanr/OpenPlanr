import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  createGuidedAnswerEnvelope,
  encodeGuidedAnswerStdin,
  guidedAnswerPreviewDigest,
  reduceGuidedAnswerEnvelope,
  resolveGuidedInteraction,
  selectGuidedAction,
} from '../../lib/pipeline/index.mjs';

const root = new URL('../../', import.meta.url);
const fixtureRoot = new URL(
  '../../conformance/fixtures/guided-operate-journeys/',
  import.meta.url,
);

function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

function fixtures() {
  const manifest = readJson(new URL('journeys.json', fixtureRoot));
  return {
    manifest,
    registry: readJson(new URL('../../../registry/adapters.json', fixtureRoot)),
    questionnaire: readJson(new URL(manifest.questionnaire, fixtureRoot)),
    answers: readJson(new URL(manifest.answers, fixtureRoot)),
    action: readJson(new URL(
      'conformance/fixtures/guided-runtime-parity/action.json',
      root,
    )),
  };
}

test('all certified guided journeys preserve the CLI-owned answer contract', () => {
  const { manifest, registry, questionnaire, answers } = fixtures();
  const startedAt = performance.now();
  const reductions = [];
  const digests = [];

  for (const journey of manifest.journeys) {
    const resolved = resolveGuidedInteraction({
      registry,
      runtime: journey.runtime,
      runtimeReport: journey.runtimeReport,
    });
    assert.equal(resolved.mode, journey.expectedMode, journey.id);
    assert.equal(resolved.fallback, journey.expectedFallback, journey.id);
    if (resolved.mode === 'none') {
      assert.equal(resolved.diagnostic.code, 'E_GUIDED_INTERACTION_UNAVAILABLE');
      assert.match(resolved.diagnostic.recovery, /terminal|runtime/u);
      continue;
    }

    const envelope = createGuidedAnswerEnvelope({
      questionnaire,
      answers,
      runtime: journey.runtime,
      runtimeVersion: journey.runtimeVersion,
      interaction: resolved.mode,
      submittedAt: '2026-07-29T09:30:00.000Z',
    });
    assert.deepEqual(JSON.parse(encodeGuidedAnswerStdin(envelope)), envelope);
    reductions.push(reduceGuidedAnswerEnvelope(envelope));
    digests.push(guidedAnswerPreviewDigest(envelope));
  }

  for (const reduction of reductions.slice(1)) {
    assert.deepEqual(reduction, reductions[0]);
  }
  assert.equal(new Set(digests).size, 1);
  assert.ok(performance.now() - startedAt < manifest.maximumFirstPreviewMs);
});

test('guided authority is exact, single-action, and digest-bound', () => {
  const { action } = fixtures();
  const selected = selectGuidedAction({
    actions: [action],
    actionId: action.id,
    confirmationDigest: action.confirmationDigest,
  });
  assert.equal(selected.command, action.command);
  assert.equal(selected.effect, 'project-write');
  assert.equal(selected.providerUse, false);

  for (const attempt of [
    { actionId: 'run-operating-cycle', confirmationDigest: action.confirmationDigest },
    { actionId: action.id, confirmationDigest: `sha256:${'0'.repeat(64)}` },
    { actionId: action.id, confirmationDigest: null },
  ]) {
    assert.throws(
      () => selectGuidedAction({ actions: [action], ...attempt }),
      (error) => [
        'E_GUIDED_ADAPTER_ACTION_NOT_FOUND',
        'E_GUIDED_ADAPTER_CONFIRMATION_MISMATCH',
      ].includes(error.code),
    );
  }
});

test('guided answers reject unknown fields and bounded stdin prevents input abuse', () => {
  const { questionnaire, answers } = fixtures();
  assert.throws(
    () => createGuidedAnswerEnvelope({
      questionnaire,
      answers: { ...answers, '__proto__.admin': true },
      runtime: 'codex',
      runtimeVersion: 'fixture',
      interaction: 'native',
      submittedAt: '2026-07-29T09:30:00.000Z',
    }),
    (error) => error.code === 'E_GUIDED_ADAPTER_ANSWERS_INVALID',
  );
  const envelope = createGuidedAnswerEnvelope({
    questionnaire,
    answers,
    runtime: 'codex',
    runtimeVersion: 'fixture',
    interaction: 'native',
    submittedAt: '2026-07-29T09:30:00.000Z',
  });
  assert.throws(
    () => encodeGuidedAnswerStdin(envelope, { maxBytes: 32 }),
    (error) => error.code === 'E_GUIDED_ADAPTER_STDIN_TOO_LARGE',
  );
});
