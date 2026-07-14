import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as pipeline from '../../lib/pipeline/index.mjs';

const STABLE_ARTIFACT_EXPORTS = Object.freeze([
  'bundleArtifact',
  'createArtifactEnvelope',
  'createReviewLink',
  'decodeArtifactFragment',
  'decryptArtifactPayload',
  'encodeArtifactFragment',
  'encryptArtifactPayload',
  'importArtifactReview',
  'mergeArtifactFeedback',
  'startArtifactReview',
]);

test('package root exposes the complete stable artifact engine contract', () => {
  for (const name of STABLE_ARTIFACT_EXPORTS) {
    assert.equal(typeof pipeline[name], 'function', `${name} must be a public function`);
  }
  assert.equal(typeof pipeline.PipelineError, 'function');
  assert.equal(Object.isFrozen(pipeline.ARTIFACT_ERROR_CODES), true);
});

test('artifact error codes are named, unique, stable E_ARTIFACT values', () => {
  const entries = Object.entries(pipeline.ARTIFACT_ERROR_CODES);
  assert.equal(entries.length, 49, 'the complete artifact error registry must be exported');
  assert.equal(new Set(entries.map(([, code]) => code)).size, entries.length);
  for (const [name, code] of entries) {
    assert.match(name, /^[A-Z][A-Z0-9_]+$/);
    assert.match(code, /^E_ARTIFACT_[A-Z0-9_]+$/);
  }
  assert.equal(pipeline.ARTIFACT_ERROR_CODES.STALE_REVIEW, 'E_ARTIFACT_STALE_REVIEW');
  assert.equal(
    pipeline.ARTIFACT_ERROR_CODES.SHORT_CONFIRMATION_REQUIRED,
    'E_ARTIFACT_SHORT_CONFIRMATION_REQUIRED',
  );
});

test('root exports execute a deterministic fragment round trip', () => {
  const envelope = pipeline.createArtifactEnvelope({
    artifacts: [{
      id: 'checkout',
      title: 'Checkout',
      html: '<!doctype html><main data-planr-id="checkout">Hello 🌍</main>',
      viewport: { width: 1280, height: 720 },
      colorScheme: 'dark',
    }],
  });
  const fragment = pipeline.encodeArtifactFragment(envelope);
  assert.match(fragment, /^v1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(pipeline.decodeArtifactFragment(fragment), envelope);
});
