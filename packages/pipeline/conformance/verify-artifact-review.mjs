#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ARTIFACT_ERROR_CODES,
  bundleArtifact,
  createArtifactEnvelope,
  createReviewLink,
  decodeArtifactFragment,
  decryptArtifactPayload,
  encodeArtifactFragment,
  encryptArtifactPayload,
  importArtifactReview,
  mergeArtifactFeedback,
  startArtifactReview,
} from '../lib/pipeline/index.mjs';
import { digestArtifactEnvelope } from '../lib/artifact/envelope.mjs';
import { createArtifactReview } from '../lib/artifact/review.mjs';
import { createDesignBoardArtifactEnvelope } from '../lib/design-engine/artifact-adapter.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'planr-artifact-conformance-'));
let controller;

function pass(label) { console.log(`  ✓ ${label}`); }

try {
  const source = join(work, 'artifact.html');
  writeFileSync(source, '<!doctype html><main data-planr-id="hero"><button>Dynamic</button></main>');
  const bundled = await bundleArtifact(source, { root: work });
  assert.match(bundled.html, /data-planr-id="hero"/);
  pass('generic HTML bundles without machine metadata');

  const envelope = createArtifactEnvelope({ artifacts: [{
    id: 'artifact', title: 'Artifact', html: bundled.html,
    viewport: { width: 1440, height: 900 }, colorScheme: 'light',
  }] });
  const fragment = encodeArtifactFragment(envelope);
  assert.deepEqual(decodeArtifactFragment(fragment), envelope);
  const fragmentLink = await createReviewLink(envelope);
  assert.equal(fragmentLink.transport, 'fragment');
  assert.equal(fragmentLink.uploaded, false);
  pass('canonical fragment sharing is deterministic and upload-free');

  const encrypted = await encryptArtifactPayload(new TextEncoder().encode('private review'));
  const decrypted = await decryptArtifactPayload(encrypted, { keyFragment: encrypted.keyFragment });
  assert.equal(new TextDecoder().decode(decrypted), 'private review');
  assert.equal(Object.hasOwn(encrypted, 'key'), false);
  pass('AES-256-GCM keeps the decryption key outside the encrypted payload');

  const review = createArtifactReview({
    reviewId: 'conformance-review',
    reviewOf: digestArtifactEnvelope(envelope),
    decision: 'changes_requested',
    overall: 'Clarify the primary action.',
    now: () => new Date('2026-07-14T12:00:00.000Z'),
  });
  const imported = await importArtifactReview({
    sources: [review], currentEnvelope: envelope, persist: false,
    cwd: work, env: { ...process.env, HOME: work, PLANR_HOME: join(work, '.planr') },
  });
  assert.equal(imported.effectiveDecision, 'changes_requested');
  assert.deepEqual(mergeArtifactFeedback(imported.reviewState, review), imported.reviewState);
  pass('digest-bound review import and stable-ID merge are idempotent');

  mkdirSync(join(work, 'design'), { recursive: true });
  writeFileSync(join(work, 'design', 'variant-A.html'), '<main>A</main>');
  writeFileSync(join(work, 'design', 'variant-B.html'), '<main>B</main>');
  const design = await createDesignBoardArtifactEnvelope({ sessionDir: join(work, 'design'), mode: 'loop' });
  assert.deepEqual(design.artifacts.map(({ id }) => id), ['A', 'B']);
  assert.equal(design.viewer.mode, 'variants');
  assert.doesNotMatch(JSON.stringify(design), /board\.html/);
  pass('design-loop variants share one ordered envelope without nested chrome');

  const renderer = readFileSync(join(root, 'lib', 'artifact', 'ui', 'renderers.mjs'), 'utf8');
  assert.match(renderer, /sandbox="allow-scripts"/);
  assert.doesNotMatch(renderer, /allow-same-origin|allow-forms|allow-popups|allow-top-navigation/);
  const bridge = readFileSync(join(root, 'lib', 'artifact', 'bridge.mjs'), 'utf8');
  assert.match(bridge, /connect-src 'none'/);
  pass('opaque-origin sandbox permits scripts while blocking network and privilege escalation');

  controller = await startArtifactReview({
    envelope, noOpen: true, cwd: work,
    env: { ...process.env, HOME: work, PLANR_HOME: join(work, '.planr') },
  });
  assert.equal(controller.host, '127.0.0.1');
  assert.match(controller.url, /^http:\/\/127\.0\.0\.1:/);
  pass('local review binds loopback only');

  assert.equal(ARTIFACT_ERROR_CODES.STALE_REVIEW, 'E_ARTIFACT_STALE_REVIEW');
  pass('named artifact errors are available from the package root');

  console.log('\n✓ artifact review conformance passed');
} catch (error) {
  console.error('\n✗ artifact review conformance failed');
  console.error(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  if (controller) await controller.close().catch(() => {});
  rmSync(work, { recursive: true, force: true });
}
