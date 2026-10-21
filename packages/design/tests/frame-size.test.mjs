import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { resolveArtifactHtml } from '@openplanr/artifact/envelope.mjs';
import { assertDesignReviewBundle } from '@openplanr/protocol/review-experience-contracts';
import {
  bundleDesignRevision,
  emptyReviewContext,
  reviewFingerprints,
} from '../lib/design/context.mjs';
import {
  currentDesign,
  prepareDesignDocument,
  renderDesignDocument,
} from '../lib/design/document.mjs';
import {
  designFrameViewport,
  initialFrameHeight,
  matchesDesignFrame,
  observeDesignFrameSize,
} from '../lib/design/frame-size.mjs';
import { lintCanvasData } from '../lib/design/lint.mjs';
import { boardPlacement } from '../lib/design/ui/layout.mjs';
import { verifyDesignDocument } from '../lib/design/utility.mjs';
import { designFixture } from './design-fixture.mjs';

const auto = { id: 'long', label: 'Long page', width: 600, height: 'auto' };

test('auto viewports and grid rows start at the tallest integer height or 900', () => {
  for (const heights of [[450, 1200, 'auto'], ['auto']]) {
    const document = { frames: heights.map((height) => ({ ...auto, height })) };
    const height = heights.length === 1 ? 900 : 1200;
    assert.equal(initialFrameHeight(document), height);
    assert.deepEqual(designFrameViewport(document, auto), { width: 600, height });
  }
  const fixed = { ...auto, height: 450 };
  assert.deepEqual(designFrameViewport({ frames: [auto, fixed] }, fixed), {
    width: 600,
    height: 450,
  });
});

test('auto rendering keeps envelope viewports numeric and authored heights in context', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'design-auto-unit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { file, document } = designFixture(root, { frames: [{ ...auto }], count: 2 });
  const prepared = prepareDesignDocument(file);
  assert.equal(prepared.entries[0].height, 'auto');
  assert.deepEqual(prepared.envelope.artifacts[0].viewport, { width: 600, height: 900 });
  assert.match(
    resolveArtifactHtml(prepared.envelope, prepared.envelope.artifacts[0]),
    /observeDesignFrameSize/,
  );
  const bundle = bundleDesignRevision(prepared);
  assert.equal(bundle.design.frames[0].height, 'auto');
  assert.strictEqual(assertDesignReviewBundle(bundle), bundle);
  assert.deepEqual(boardPlacement(document, prepared.entries[1]), {
    x: 0,
    y: 1148,
    title: 'Step 2',
  });
  const fingerprint = (frame) =>
    reviewFingerprints({
      document,
      context: emptyReviewContext(document),
      screen: document.screens[0],
      variant: document.variants[0],
      frame,
      sourceDigests: {},
    });
  assert.notEqual(
    fingerprint(auto).contentDigest,
    fingerprint({ ...auto, height: 900 }).contentDigest,
  );
  document.frames[0].height = 450;
  writeFileSync(file, JSON.stringify(document));
  const integer = prepareDesignDocument(file);
  assert.deepEqual(integer.envelope.artifacts[0].viewport, { width: 600, height: 450 });
  assert.equal(integer.entries[0].height, undefined);
  assert.doesNotMatch(
    resolveArtifactHtml(integer.envelope, integer.envelope.artifacts[0]),
    /observeDesignFrameSize/,
  );
});

test('auto captured viewports and lint accept bounded measured heights without weakening fixed frames', () => {
  for (const height of [1, 900, 4200, 16384]) {
    assert.equal(matchesDesignFrame(auto, { width: 600, height }), true);
    assert.equal(
      lintCanvasData({ sections: [{ artboards: [{ width: 600, height }] }] }, { frames: [auto] })
        .ok,
      true,
    );
  }
  assert.equal(lintCanvasData({ sections: [{ artboards: [auto] }] }, { frames: [auto] }).ok, true);
  for (const height of [0, 16385, 'auto', '900', NaN, Infinity, 2.5])
    assert.equal(matchesDesignFrame(auto, { width: 600, height }), false);
  assert.equal(matchesDesignFrame(auto, { width: 601, height: 900 }), false);
  assert.equal(matchesDesignFrame({ ...auto, height: 450 }, { width: 600, height: 900 }), false);
  assert.equal(
    lintCanvasData({ sections: [{ artboards: [{ width: 600, height: 0 }] }] }, { frames: [auto] })
      .ok,
    false,
  );
});

test('auto verification requires a numeric bounded captured height for every frame', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'design-auto-verify-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { file } = designFixture(root, { count: 1, frames: [{ ...auto }] });
  await renderDesignDocument(file);
  const current = currentDesign(file);
  const report = {
    revision: current.revision,
    status: 'unverified',
    checkedArtifacts: current.entries.map(({ artifactId }) => artifactId),
    screens: current.entries.map(({ artifactId, screenId }) => ({
      artifactId,
      screenId,
      checkedElements: 1,
      viewport: { width: 600, height: 4200 },
    })),
  };
  assert.equal(verifyDesignDocument(file, report).coverage, true);
  report.screens[0].viewport.height = 'auto';
  assert.equal(verifyDesignDocument(file, report).coverage, false);
});

test('sandbox sizing waits for fonts and two animation frames, observes the body and caps content', async () => {
  const listeners = new Map(),
    animations = [],
    messages = [];
  let fontsReady, resized, observed;
  const body = { getAttribute: () => 'overview' };
  const root = { scrollHeight: 4200 };
  const parent = { postMessage: (message) => messages.push(message) };
  runInNewContext(`(${observeDesignFrameSize.toString()})()`, {
    document: {
      body,
      documentElement: root,
      fonts: {
        ready: new Promise((resolve) => {
          fontsReady = resolve;
        }),
      },
    },
    parent,
    innerWidth: 600,
    addEventListener: (name, callback) => listeners.set(name, callback),
    requestAnimationFrame: (callback) => animations.push(callback),
    ResizeObserver: class {
      constructor(callback) {
        resized = callback;
      }
      observe(node) {
        observed = node;
      }
    },
  });
  listeners.get('load')();
  assert.strictEqual(observed, body);
  assert.equal(messages.length, 0);
  assert.equal(animations.length, 0);
  fontsReady();
  await tick();
  animations.shift()();
  assert.equal(messages.length, 0);
  animations.shift()();
  await tick();
  assert.equal(messages[0].height, 4200);
  assert.equal(messages[0].width, 600);
  root.scrollHeight = 20000;
  resized();
  await tick();
  animations.shift()();
  animations.shift()();
  await tick();
  assert.equal(messages[1].height, 16384);
});

test('integer-only documents preserve the artifact HTML produced before auto sizing', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'design-integer-html-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { file } = designFixture(root, { count: 1 });
  const prepared = prepareDesignDocument(file);
  const expected = readFileSync(
    new URL('./fixtures/integer-frame.html.txt', import.meta.url),
    'utf8',
  );
  for (const artifact of prepared.envelope.artifacts) {
    const html = resolveArtifactHtml(prepared.envelope, artifact);
    assert.equal(html, expected);
    assert.doesNotMatch(html, /body\[data-planr-screen\]\{box-sizing:border-box\}/);
    assert.doesNotMatch(html, /observeDesignFrameSize/);
  }
});
