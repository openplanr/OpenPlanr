import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertDesignReviewBundle } from '@openplanr/protocol/review-experience-contracts';
import {
  bundleDesignRevision,
  emptyReviewContext,
  reviewFingerprints,
} from '../lib/design/context.mjs';
import { prepareDesignDocument } from '../lib/design/document.mjs';
import { designFixture } from './design-fixture.mjs';

const fingerprintInput = () => ({
  document: { id: 'operations' },
  context: emptyReviewContext({ id: 'operations' }),
  screen: { id: 'overview', title: 'Overview' },
  variant: { id: 'calm', label: 'Calm' },
  frame: { id: 'desktop', label: 'Desktop', width: 1440, height: 1024 },
  sourceDigests: { 'source/screen.html': 'abc', 'source/style.css': 'def' },
});

test('content fingerprints include effective prop values and preserve guidance', () => {
  const input = fingerprintInput();
  input.screen.props = {
    theme: { type: 'enum', options: ['light', 'dark'], default: 'light' },
    partial: { type: 'boolean', default: false },
  };
  const defaults = reviewFingerprints(input);
  input.screen.props.theme.default = 'dark';
  assert.notEqual(reviewFingerprints(input).contentDigest, defaults.contentDigest);
  input.screen.props.theme.default = 'light';
  input.variant.props = { overview: { theme: 'light', partial: false } };
  assert.deepEqual(reviewFingerprints(input), defaults);
  input.screen.props.theme.default = 'dark';
  assert.deepEqual(reviewFingerprints(input), defaults);
  input.variant.props.overview.theme = 'dark';
  const dark = reviewFingerprints(input);
  assert.notEqual(dark.contentDigest, defaults.contentDigest);
  assert.equal(dark.guidanceDigest, defaults.guidanceDigest);
  input.variant.props.overview.partial = true;
  assert.notEqual(reviewFingerprints(input).contentDigest, dark.contentDigest);
  input.variant.props.other = { theme: 'light' };
  const unrelated = reviewFingerprints(input);
  delete input.variant.props.other;
  assert.deepEqual(reviewFingerprints(input), unrelated);
});

test('legacy content fingerprints retain the digest captured before props support', () => {
  assert.equal(
    reviewFingerprints(fingerprintInput()).contentDigest,
    'f744c0c59b625b9b34523532e6f88ef223bb35216f956beb1c9bd1ef815e4d5a',
  );
});

test('review bundles preserve typed props through JSON without sharing source paths', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'design-props-flow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { file, document } = designFixture(root, { count: 1, variants: 2 });
  document.schemaVersion = '1.1.0';
  document.screens[0].props = {
    theme: { type: 'enum', options: ['light', 'dark'], default: 'light' },
    partial: { type: 'boolean', default: false },
  };
  document.variants[1].props = { 'screen-1': { theme: 'dark', partial: true } };
  writeFileSync(file, JSON.stringify(document));
  const bundle = bundleDesignRevision(prepareDesignDocument(file));
  assert.equal(bundle.design.schemaVersion, '1.1.0');
  assert.deepEqual(bundle.design.screens[0].props, document.screens[0].props);
  assert.deepEqual(bundle.design.variants[1].props, document.variants[1].props);
  assert.equal(bundle.design.screens[0].source, undefined);
  const roundTrip = JSON.parse(JSON.stringify(bundle));
  assert.strictEqual(assertDesignReviewBundle(roundTrip), roundTrip);
  bundle.design.screens[0].props.theme.default = 'dark';
  assert.equal(document.screens[0].props.theme.default, 'light');
  bundle.design.variants[1].props['screen-1'].partial = false;
  assert.equal(document.variants[1].props['screen-1'].partial, true);
});

test('review bundles without props retain their existing design shape', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'design-legacy-flow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { file } = designFixture(root, { count: 1 });
  const bundle = bundleDesignRevision(prepareDesignDocument(file));
  assert.equal(Object.hasOwn(bundle.design, 'schemaVersion'), false);
  assert.equal(Object.hasOwn(bundle.design.screens[0], 'props'), false);
  assert.equal(Object.hasOwn(bundle.design.variants[0], 'props'), false);
  assert.strictEqual(assertDesignReviewBundle(bundle), bundle);
});
