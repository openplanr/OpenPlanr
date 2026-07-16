import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';

import { validateJson } from '../../conformance/json-schema-validate.mjs';
import {
  canonicalEnvelopeBytes,
  canonicalSerialize,
  createArtifactEnvelope,
  digestArtifact,
  digestArtifactEnvelope,
  validateArtifactEnvelope,
  validateArtifactPaste,
  validateArtifactReview,
} from '../../lib/artifact/envelope.mjs';
import { normalizeArtifactShellModel } from '../../lib/artifact/ui/renderers.mjs';
import { loadSchema } from '../../lib/design/schema-loader.mjs';
import { ARTIFACT_ERROR_CODES } from '../../lib/pipeline/errors.mjs';

const artifact = {
  id: 'checkout-light',
  title: 'Checkout ✓',
  html: '<!doctype html>\r\n<html><body>مرحبا 😀</body></html>\r\n',
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
};

function reviewOf(reviewOfDigest) {
  return {
    schemaVersion: '1.0.0',
    reviewId: 'review-001',
    reviewOf: reviewOfDigest,
    decision: 'changes_requested',
    overall: 'Clarify timing.',
    createdAt: '2026-07-14T10:00:00Z',
    updatedAt: '2026-07-14T10:01:00Z',
    pins: [{
      id: 'pin-001',
      author: { id: 'reviewer-1', name: 'Asem' },
      artifactId: 'checkout-light',
      variant: 'light',
      region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      viewport: { width: 1440, height: 900 },
      anchor: { planrId: 'delivery-promise', screen: 'checkout' },
      intent: 'fix',
      status: 'open',
      comment: 'Show the delivery promise first.',
      replies: [{
        id: 'reply-001',
        author: { name: 'Maya' },
        comment: 'Agreed.',
        createdAt: '2026-07-14T10:00:30Z',
      }],
      createdAt: '2026-07-14T10:00:00Z',
      updatedAt: '2026-07-14T10:00:30Z',
    }],
  };
}

test('version-qualified schema loader keeps v1.0 readers and loads additive v1.1 contracts', () => {
  assert.match(loadSchema('spec').$id, /v1\.0\.0\/spec/);
  assert.match(loadSchema('v1.1.0/artifact-envelope').$id, /v1\.1\.0\/artifact-envelope/);
  assert.match(loadSchema('artifact-review', 'v1.1.0').$id, /v1\.1\.0\/artifact-review/);
  assert.throws(() => loadSchema('../secret'), /invalid schema/);
});

test('canonical artifact envelope normalizes UTF-8 and validates the positive schema fixture', () => {
  const envelope = createArtifactEnvelope({ artifacts: [artifact] });
  assert.equal(envelope.schemaVersion, '1.0.0');
  assert.equal(envelope.artifacts[0].kind, 'html');
  assert.doesNotMatch(envelope.artifacts[0].html, /\r|^\uFEFF/);
  assert.equal(envelope.artifacts[0].sha256, digestArtifact(envelope.artifacts[0].html));
  assert.equal(envelope.viewer.mode, 'single');
  assert.deepEqual(validateJson(envelope, loadSchema('artifact-envelope', 'v1.1.0')), []);
  assert.equal(validateArtifactEnvelope(envelope), envelope);
});

test('canonical JSON and digest bytes are stable and browser Web Crypto compatible', async () => {
  assert.equal(canonicalSerialize({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
  const envelope = createArtifactEnvelope({ artifacts: [artifact] });
  const bytes = canonicalEnvelopeBytes(envelope);
  const browserDigest = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
  assert.equal(browserDigest, digestArtifactEnvelope(envelope));
  assert.equal(digestArtifactEnvelope(envelope), digestArtifactEnvelope(structuredClone(envelope)));
});

test('review state is validated and excluded from the reviewed envelope digest', () => {
  const base = createArtifactEnvelope({ artifacts: [artifact] });
  const digest = digestArtifactEnvelope(base);
  const review = reviewOf(digest);
  assert.equal(validateArtifactReview(review), review);
  const reviewed = createArtifactEnvelope({ artifacts: [artifact], review });
  assert.equal(digestArtifactEnvelope(reviewed), digest);
  assert.notEqual(
    Buffer.from(canonicalEnvelopeBytes(reviewed, { includeReview: true })).toString('utf8'),
    Buffer.from(canonicalEnvelopeBytes(reviewed)).toString('utf8'),
  );
});

test('canonical variants envelope supports transient split shell state without digest mutation', () => {
  const comparison = { ...artifact, id: 'checkout-dark', title: 'Checkout dark', colorScheme: 'dark' };
  const envelope = createArtifactEnvelope({
    artifacts: [artifact, comparison],
    viewer: { mode: 'variants', activeArtifactId: 'checkout-light' },
  });
  const digest = digestArtifactEnvelope(envelope);
  const model = normalizeArtifactShellModel({
    envelope,
    viewer: { mode: 'split', activeArtifactId: 'checkout-light', comparisonArtifactId: 'checkout-dark' },
  });
  assert.equal(model.viewMode, 'split');
  assert.equal(model.comparisonArtifact.id, 'checkout-dark');
  assert.deepEqual(envelope.viewer, { mode: 'variants', activeArtifactId: 'checkout-light' });
  assert.equal(digestArtifactEnvelope(envelope), digest);
});

test('optional presentation preserves old digests and validates only serialized document or canvas values', () => {
  const legacy = createArtifactEnvelope({ artifacts: [artifact] });
  assert.equal(Object.hasOwn(legacy.viewer, 'presentation'), false);
  const legacyDigest = digestArtifactEnvelope(legacy);
  assert.equal(digestArtifactEnvelope(JSON.parse(JSON.stringify(legacy))), legacyDigest);

  const document = createArtifactEnvelope({
    artifacts: [artifact],
    viewer: { mode: 'single', activeArtifactId: artifact.id, presentation: 'document' },
  });
  const canvas = createArtifactEnvelope({
    artifacts: [artifact],
    viewer: { mode: 'single', activeArtifactId: artifact.id, presentation: 'canvas' },
  });
  assert.equal(document.viewer.presentation, 'document');
  assert.equal(canvas.viewer.presentation, 'canvas');
  assert.notEqual(digestArtifactEnvelope(document), legacyDigest);
  assert.notEqual(digestArtifactEnvelope(canvas), legacyDigest);
  assert.throws(
    () => createArtifactEnvelope({
      artifacts: [artifact],
      viewer: { mode: 'single', activeArtifactId: artifact.id, presentation: 'auto' },
    }),
    /presentation must be document or canvas/,
  );
});

test('envelope and review negative fixtures fail with named errors', () => {
  const base = createArtifactEnvelope({ artifacts: [artifact] });
  assert.throws(
    () => createArtifactEnvelope({ artifacts: [{ ...artifact, sha256: '0'.repeat(64) }] }),
    (error) => error.code === ARTIFACT_ERROR_CODES.ENVELOPE_INVALID,
  );
  assert.throws(
    () => createArtifactEnvelope({ artifacts: [{ ...artifact, id: '../escape' }] }),
    (error) => error.code === ARTIFACT_ERROR_CODES.ENVELOPE_INVALID,
  );
  assert.throws(
    () => createArtifactEnvelope({ artifacts: [artifact], viewer: { mode: 'single', activeArtifactId: 'missing' } }),
    (error) => error.code === ARTIFACT_ERROR_CODES.ENVELOPE_INVALID,
  );
  assert.throws(
    () => validateArtifactReview({ ...reviewOf(digestArtifactEnvelope(base)), unexpected: true }),
    (error) => error.code === ARTIFACT_ERROR_CODES.ENVELOPE_INVALID,
  );
  assert.throws(
    () => createArtifactEnvelope({ artifacts: [artifact], review: reviewOf('f'.repeat(64)) }),
    (error) => error.code === ARTIFACT_ERROR_CODES.ENVELOPE_INVALID,
  );
  assert.throws(
    () => validateArtifactReview({ ...reviewOf(digestArtifactEnvelope(base)), overall: 'x'.repeat(65_537) }),
    (error) => error.code === ARTIFACT_ERROR_CODES.ENVELOPE_INVALID,
  );
  assert.throws(
    () => validateArtifactEnvelope({
      ...base,
      artifacts: [{ ...base.artifacts[0], viewport: { width: 20_000, height: 900 } }],
    }),
    (error) => error.code === ARTIFACT_ERROR_CODES.ENVELOPE_INVALID,
  );
  const invalidEmbeddedReview = { ...base, review: { ...reviewOf(digestArtifactEnvelope(base)), pins: [42] } };
  assert.notEqual(validateJson(invalidEmbeddedReview, loadSchema('artifact-envelope', 'v1.1.0')).length, 0);
});

test('paste schema validates request, response, and ciphertext-only storage boundaries', () => {
  const schema = loadSchema('artifact-paste', 'v1.1.0');
  const request = {
    schemaVersion: '1.0.0', operation: 'create', iv: 'abcdefghijklmnop', ciphertext: 'cipher_text-1', ttl: '7d',
  };
  const response = {
    schemaVersion: '1.0.0', operation: 'created', id: 'abcdefghijklmnop',
    expiresAt: '2026-07-21T10:00:00Z', deletionToken: 'abcdefghijklmnopqrstuvwxyzABCDEF',
  };
  const stored = {
    schemaVersion: '1.0.0', operation: 'stored', id: 'abcdefghijklmnop', iv: 'abcdefghijklmnop',
    ciphertext: 'cipher_text-1', expiresAt: '2026-07-21T10:00:00Z', size: 13,
    deletionTokenHash: 'a'.repeat(64),
  };
  assert.deepEqual(validateJson(request, schema), []);
  assert.deepEqual(validateJson(response, schema), []);
  assert.deepEqual(validateJson(stored, schema), []);
  assert.equal(validateArtifactPaste(request), request);
  assert.equal(validateArtifactPaste(response), response);
  assert.equal(validateArtifactPaste(stored), stored);
  assert.throws(
    () => validateArtifactPaste({ ...stored, size: 5 * 1024 * 1024 + 1 }),
    (error) => error.code === ARTIFACT_ERROR_CODES.ENVELOPE_INVALID,
  );
  assert.notEqual(validateJson({ ...request, key: 'must-not-cross-boundary' }, schema).length, 0);
  assert.notEqual(validateJson({ ...stored, plaintext: '<html>' }, schema).length, 0);
});

test('live room event schema validates digest-bound encrypted review operations', () => {
  const schema = loadSchema('artifact-room-event', 'v1.1.0');
  const event = {
    schemaVersion: '1.0.0', eventId: 'evt-1', roomId: 'room_0123456789abcd',
    reviewOf: 'a'.repeat(64), kind: 'pin', createdAt: '2026-07-16T00:00:00.000Z',
    payload: { id: 'pin-1' },
  };
  assert.deepEqual(validateJson(event, schema), []);
  assert.notEqual(validateJson({ ...event, kind: 'plaintext' }, schema).length, 0);
  assert.notEqual(validateJson({ ...event, reviewOf: 'not-a-digest' }, schema).length, 0);
});
