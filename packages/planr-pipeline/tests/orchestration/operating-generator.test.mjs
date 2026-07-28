import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cancelOperatingArtifactGeneration,
  prepareOperatingArtifactGeneration,
  renderOperatingArtifactTemplate,
  resumeOperatingArtifactGeneration,
  runOperatingArtifactGeneration,
  startOperatingArtifactGeneration,
  validateOperatingArtifactOutput,
} from '../../lib/pipeline/index.mjs';

const digest = (character) => `sha256:${character.repeat(64)}`;
const timestamps = [
  '2026-07-28T10:00:00.000Z',
  '2026-07-28T10:00:01.000Z',
  '2026-07-28T10:00:02.000Z',
  '2026-07-28T10:00:03.000Z',
  '2026-07-28T10:00:04.000Z',
];

function template(artifactType = 'markdown') {
  return {
    id: 'operating-brief',
    version: '1.0.0',
    artifactType,
    body: artifactType === 'html' ? '<h1>{{title}}</h1>' : '# {{title}}\n',
    requiredVariables: ['title'],
  };
}

function session(overrides = {}) {
  return prepareOperatingArtifactGeneration({
    id: 'ART-001',
    cycleId: 'CYCLE-001',
    artifactType: 'markdown',
    inputDigest: digest('a'),
    destination: '.planr/operate/cycles/CYCLE-001/artifacts/brief.md',
    evidenceRefs: ['EVD-repository'],
    producer: {
      product: 'openplanr',
      version: '1.14.0',
      runtime: 'codex',
      capability: 'analysis-high',
    },
    template: template(),
    now: timestamps[0],
    ...overrides,
  });
}

test('portable generator renders typed templates and records bounded provenance', () => {
  const rendered = renderOperatingArtifactTemplate(template('html'), {
    title: '<Operating & review>',
  });
  assert.equal(rendered.content, '<h1>&lt;Operating &amp; review&gt;</h1>');
  assert.match(rendered.template.digest, /^sha256:[a-f0-9]{64}$/u);

  const started = startOperatingArtifactGeneration(session(), { now: timestamps[1] });
  const validated = validateOperatingArtifactOutput(started, '# Cited brief\n\n- EVD-repository\n', {
    now: timestamps[2],
  });
  assert.equal(validated.session.state, 'validated');
  assert.equal(validated.session.provenance.inputDigest, digest('a'));
  assert.equal(validated.session.provenance.outputDigest, validated.session.outputDigest);
});

test('portable generator rejects traversal, active HTML, formula CSV, and hostile JSON', () => {
  assert.throws(
    () => session({ destination: '.planr/operate/cycles/CYCLE-001/artifacts/../brief.md' }),
    (error) => error.code === 'E_OPERATE_ARTIFACT_DESTINATION_INVALID',
  );

  const html = startOperatingArtifactGeneration(
    session({
      artifactType: 'html',
      destination: '.planr/operate/cycles/CYCLE-001/artifacts/brief.html',
      template: template('html'),
    }),
    { now: timestamps[1] },
  );
  assert.throws(
    () => validateOperatingArtifactOutput(html, '<script>alert(1)</script>'),
    (error) => error.code === 'E_OPERATE_ARTIFACT_OUTPUT_INVALID',
  );

  const csv = startOperatingArtifactGeneration(
    session({
      artifactType: 'csv',
      destination: '.planr/operate/cycles/CYCLE-001/artifacts/brief.csv',
      template: { ...template('markdown'), artifactType: 'csv' },
    }),
    { now: timestamps[1] },
  );
  assert.throws(
    () => validateOperatingArtifactOutput(csv, 'name,value\nowner,=CMD()\n'),
    (error) => error.code === 'E_OPERATE_ARTIFACT_OUTPUT_INVALID',
  );

  const json = startOperatingArtifactGeneration(
    session({
      artifactType: 'json',
      destination: '.planr/operate/cycles/CYCLE-001/artifacts/brief.json',
      template: { ...template('markdown'), artifactType: 'json' },
    }),
    { now: timestamps[1] },
  );
  assert.throws(
    () => validateOperatingArtifactOutput(json, '{"constructor":{"prototype":{}}}'),
    (error) => error.code === 'E_OPERATE_ARTIFACT_OUTPUT_INVALID',
  );
});

test('portable generator retries deterministically and stops after its correction cap', async () => {
  let invocation = 0;
  let clock = 0;
  const result = await runOperatingArtifactGeneration({
    session: session({ maxAttempts: 2 }),
    now: () => timestamps[Math.min(clock++, timestamps.length - 1)],
    generate: async () => {
      invocation += 1;
      if (invocation === 1) throw new Error('fixture failure');
      return { content: '# Recovered\n\n- EVD-repository\n', usage: { tokens: 10, costUsd: 0 } };
    },
  });
  assert.equal(result.session.state, 'committed');
  assert.equal(result.session.generation.attempt, 2);
  assert.deepEqual(
    result.attempts.map(({ status }) => status),
    ['failed', 'committed'],
  );

  await assert.rejects(
    runOperatingArtifactGeneration({
      session: session({ maxAttempts: 1 }),
      now: () => timestamps[0],
      generate: async () => {
        throw new Error('always fails');
      },
    }),
    (error) =>
      error.code === 'E_OPERATE_ARTIFACT_RETRY_EXHAUSTED' &&
      error.details.attempts.length === 1,
  );
});

test('failed sessions resume only below the cap and cancellation is terminal', async () => {
  const prepared = session({ maxAttempts: 2 });
  const failed = await assert.rejects(
    runOperatingArtifactGeneration({
      session: { ...prepared, generation: { ...prepared.generation, maxAttempts: 1 } },
      now: () => timestamps[1],
      generate: async () => {
        throw new Error('failure');
      },
    }),
    () => true,
  );
  assert.equal(failed, undefined);

  const started = startOperatingArtifactGeneration(prepared, { now: timestamps[1] });
  const cancelled = cancelOperatingArtifactGeneration(started, { now: timestamps[2] });
  assert.equal(cancelled.state, 'cancelled');
  assert.throws(
    () => resumeOperatingArtifactGeneration(cancelled, { now: timestamps[3] }),
    (error) => error.code === 'E_OPERATE_ARTIFACT_STATE_INVALID',
  );
});

test('portable generator aborts a provider that exceeds its declared time budget', async () => {
  let observedAbort = false;
  await assert.rejects(
    runOperatingArtifactGeneration({
      session: session({
        maxAttempts: 1,
        budget: { maxDurationMs: 100 },
      }),
      now: () => timestamps[0],
      generate: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              observedAbort = true;
              reject(new Error('aborted'));
            },
            { once: true },
          );
        }),
    }),
    (error) =>
      error.code === 'E_OPERATE_ARTIFACT_RETRY_EXHAUSTED' &&
      error.details.attempts[0].failureCode === 'E_OPERATE_ARTIFACT_BUDGET_EXCEEDED',
  );
  assert.equal(observedAbort, true);
});
