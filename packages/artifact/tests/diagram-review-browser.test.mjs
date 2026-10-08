import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  assertVersionedDiagramReviewBundle,
  normalizeDiagramPresentation,
  versionedDiagramReviewBundleDigest,
} from '@openplanr/protocol/studio-presentation-contracts';
import { makeBundle, sealBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { launchBrowser } from '../../../tests/support/browser-launcher.mjs';
import { compileDiagramCommand } from '../lib/artifact/diagram/authoring/index.mjs';
import { prepareAuthoredDiagramReviewBundle } from '../lib/artifact/diagram/review-bundle-browser.mjs';

const require = createRequire(new URL('../../protocol/package.json', import.meta.url));
const { build } = require('esbuild');
const enabled = process.env.PLANR_BROWSER_TESTS === '1';

function authored(theme) {
  const source = makeBundle('swimlane', { source: true });
  source.document.annotations[0].text = 'Readable note';
  source.document.nodes[0].label = 'مرحبا 👋 → Decision';
  source.presentation.elements.find((item) => item.elementId === 'node-a').bounds.x = -120;
  sealBundle(source);
  if (!theme) return source;
  const change = compileDiagramCommand(
    source,
    { type: 'set-studio-presentation', presentation: normalizeDiagramPresentation({ theme }) },
    { transactionId: `review-${theme}` },
  );
  assert.equal(change.ok, true);
  return change.bundle;
}

test('in-memory reviews retain graph, geometry and original identity without private source or mutation', () => {
  for (const theme of [undefined, 'light', 'dark']) {
    const source = authored(theme);
    const before = JSON.stringify(source);
    const review = prepareAuthoredDiagramReviewBundle(source);
    assertVersionedDiagramReviewBundle(review);
    assert.equal(review.schemaVersion, theme ? '1.1.0' : '1.0.0');
    assert.equal(review.source.digest, source.bundleDigest);
    assert.deepEqual(review.authored.document, source.document);
    assert.deepEqual(review.authored.presentation, source.presentation);
    assert.equal(review.authored.originalSource, null);
    assert.equal(review.authored.sourceMap, null);
    assert.notEqual(review.authored.bundleDigest, source.bundleDigest);
    if (theme) assert.equal(review.presentation.theme, theme);
    assert.equal(JSON.stringify(source), before);
    review.authored.document.title = 'Changed review';
    assert.equal(JSON.stringify(source), before);
  }
});

test('untrusted input cannot bypass validation or run property accessors', () => {
  const source = authored('dark');
  const corrupt = structuredClone(source);
  corrupt.presentation.elements[0].bounds.x += 1;
  const accessor = structuredClone(source);
  let accessed = false;
  Object.defineProperty(accessor, 'document', {
    enumerable: true,
    get() {
      accessed = true;
      throw new Error('Unsafe accessor');
    },
  });
  const cyclic = structuredClone(source);
  cyclic.document.self = cyclic;
  for (const invalid of [null, {}, corrupt, accessor, cyclic, { ...source, executable: 'code' }])
    assert.throws(() => prepareAuthoredDiagramReviewBundle(invalid), {
      code: 'E_DIAGRAM_REVIEW_BUNDLE',
      status: 422,
    });
  assert.equal(accessed, false);
});

test('browser closure resolves without Node APIs, polyfills or filesystem inputs', async () => {
  const result = await build({
    entryPoints: [
      new URL('../lib/artifact/diagram/review-bundle-browser.mjs', import.meta.url).pathname,
    ],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    metafile: true,
  });
  assert.ok(result.outputFiles[0].text.length > 0);
  assert.ok(Object.keys(result.metafile.inputs).every((path) => !path.startsWith('node:')));
  assert.ok(
    Object.values(result.metafile.inputs).every((input) =>
      input.imports.every((entry) => !entry.path.startsWith('node:')),
    ),
  );
});

test('actual browser produces identical validated review bytes for legacy and themed authored copies', {
  skip: !enabled,
  timeout: 90_000,
}, async (t) => {
  const result = await build({
    stdin: {
      contents: `import { prepareAuthoredDiagramReviewBundle } from ${JSON.stringify(new URL('../lib/artifact/diagram/review-bundle-browser.mjs', import.meta.url).pathname)};
        window.prepareReview = prepareAuthoredDiagramReviewBundle;`,
      resolveDir: import.meta.dirname,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
  });
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => {
    await browser.close();
    assert.deepEqual(errors, []);
  });
  await page.route('https://review.example/authoring', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Authored review</title>',
    }),
  );
  await page.goto('https://review.example/authoring');
  await page.addScriptTag({ content: result.outputFiles[0].text });
  for (const theme of [undefined, 'light', 'dark']) {
    const source = authored(theme);
    const expected = prepareAuthoredDiagramReviewBundle(source);
    const actual = await page.evaluate((input) => {
      const before = JSON.stringify(input);
      const review = window.prepareReview(input);
      return { review, unchanged: JSON.stringify(input) === before };
    }, source);
    assert.equal(actual.unchanged, true);
    assert.deepEqual(actual.review, expected);
    assert.equal(
      versionedDiagramReviewBundleDigest(actual.review),
      versionedDiagramReviewBundleDigest(expected),
    );
  }
});
