import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { digestArtifactEnvelope, validateArtifactEnvelope } from '../../lib/artifact/envelope.mjs';
import {
  bundleDesignBoardVariants,
  createDesignBoardArtifactEnvelope,
  resolveDesignBoardVariants,
} from '../../lib/design-engine/artifact-adapter.mjs';
import { ARTIFACT_ERROR_CODES } from '../../lib/pipeline/errors.mjs';

const roots = [];

after(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'planr-design-envelope-'));
  roots.push(root);
  return root;
}

function write(root, path, contents) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

function png(width = 640, height = 480) {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(0x89504e47, 0);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function expectCode(code) {
  return (error) => {
    assert.equal(error?.code, code, error?.stack ?? String(error));
    return true;
  };
}

test('loop discovery creates one ordered artifact per variant and never embeds board chrome', async () => {
  const root = fixture();
  write(root, 'variant-A.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180"/></svg>');
  write(root, 'variant-A.html', '<!doctype html><main data-planr-id="hero">A</main>');
  write(root, 'variant-B.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><circle cx="20" cy="20" r="10"/></svg>');
  write(root, 'variant-C.png', png(1024, 768));
  write(root, 'board.html', '<div class="legacy-board-shell">do not nest me</div>');

  const envelope = await createDesignBoardArtifactEnvelope({ sessionDir: root, mode: 'loop' });

  assert.deepEqual(envelope.artifacts.map(({ id }) => id), ['A', 'B', 'C']);
  assert.equal(envelope.viewer.mode, 'variants');
  assert.equal(envelope.viewer.activeArtifactId, 'A');
  assert.equal(envelope.artifacts.length, 3);
  assert.match(envelope.artifacts[0].html, /data-planr-id="hero"/);
  assert.match(envelope.artifacts[1].html, /data:image\/svg\+xml;base64,/);
  assert.match(envelope.artifacts[2].html, /data:image\/png;base64,/);
  assert.deepEqual(envelope.artifacts[1].viewport, { width: 800, height: 600 });
  assert.deepEqual(envelope.artifacts[2].viewport, { width: 1024, height: 768 });
  assert.doesNotMatch(JSON.stringify(envelope), /legacy-board-shell|board\.html/);
  assert.doesNotMatch(JSON.stringify(envelope), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(validateArtifactEnvelope(envelope), envelope);
  assert.equal(readdirSync(root).some((name) => name.startsWith('.planr-artifact-entry-')), false);
});

test('explicit variant order, titles, viewports, and color schemes remain stable', async () => {
  const root = fixture();
  write(root, 'a.html', '<p>A</p>');
  write(root, 'b.html', '<p>B</p>');

  const envelope = await createDesignBoardArtifactEnvelope({
    sessionDir: root,
    mode: 'loop',
    variants: [
      { id: 'B', label: 'Direction B', src: 'b.html', type: 'html' },
      { id: 'A', label: 'Direction A', src: 'a.html', type: 'html' },
    ],
    viewportByVariant: { B: { width: 1280, height: 720 }, A: { width: 390, height: 844 } },
    colorSchemeByVariant: { B: 'dark', A: 'light' },
    activeArtifactId: 'A',
  });

  assert.deepEqual(envelope.artifacts.map(({ id, title }) => [id, title]), [
    ['B', 'Direction B'],
    ['A', 'Direction A'],
  ]);
  assert.deepEqual(envelope.artifacts.map(({ viewport }) => viewport), [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]);
  assert.deepEqual(envelope.artifacts.map(({ colorScheme }) => colorScheme), ['dark', 'light']);
  assert.equal(envelope.viewer.activeArtifactId, 'A');
});

test('review mode selects one finalized artifact and uses the review title', async () => {
  const root = fixture();
  write(root, 'finalized.html', '<!doctype html><h1>Final</h1>');
  write(root, 'canvas.html', '<!doctype html><h1>Draft canvas</h1>');
  write(root, 'board.html', '<h1>Old chrome</h1>');

  const envelope = await createDesignBoardArtifactEnvelope({
    sessionDir: root,
    mode: 'review',
    title: 'Checkout review',
    viewport: { width: 1440, height: 1024 },
    colorScheme: 'dark',
  });

  assert.equal(envelope.artifacts.length, 1);
  assert.equal(envelope.artifacts[0].id, 'artifact');
  assert.equal(envelope.artifacts[0].title, 'Checkout review');
  assert.match(envelope.artifacts[0].html, /<h1>Final<\/h1>/);
  assert.doesNotMatch(envelope.artifacts[0].html, /Draft canvas|Old chrome/);
  assert.deepEqual(envelope.viewer, { mode: 'single', activeArtifactId: 'artifact' });
});

test('legacy feedback is translated after the ordered envelope digest is known', async () => {
  const root = fixture();
  write(root, 'variant-A.html', '<p>A</p>');
  write(root, 'variant-B.html', '<p>B</p>');
  const feedback = {
    schema_version: '1.0.0',
    boardId: 'checkout-board',
    publishedAt: '2026-07-14T12:00:00.000Z',
    preferred: 'B',
    regenerated: false,
    ratings: { A: 3, B: 5 },
    comments: { B: 'Best direction' },
    overall: 'Keep the stronger hierarchy.',
    pins: [{
      id: 'pin-b-001',
      author: 'Asem',
      variant: 'B',
      x: 0.2,
      y: 0.3,
      w: 0.1,
      h: 0.2,
      comment: 'Increase contrast.',
      intent: 'improve',
      status: 'open',
      createdAt: '2026-07-14T11:59:00.000Z',
      replies: [],
    }],
  };

  const envelope = await createDesignBoardArtifactEnvelope({
    sessionDir: root,
    mode: 'loop',
    feedback,
    viewportByVariant: { B: { width: 1200, height: 800 } },
  });

  assert.equal(envelope.review.reviewOf, digestArtifactEnvelope(envelope));
  assert.equal(envelope.review.decision, 'approved');
  assert.equal(envelope.review.overall, feedback.overall);
  assert.equal(envelope.review.pins[0].artifactId, 'B');
  assert.equal(envelope.review.pins[0].variant, 'B');
  assert.deepEqual(envelope.review.pins[0].viewport, { width: 1200, height: 800 });
  assert.equal(validateArtifactEnvelope(envelope), envelope);
});

test('board-wide file and decoded-byte limits are not reset per variant', async () => {
  const root = fixture();
  write(root, 'variant-A.html', '<p>A</p>');
  write(root, 'variant-B.html', '<p>B</p>');

  await assert.rejects(
    createDesignBoardArtifactEnvelope({ sessionDir: root, maxFiles: 1 }),
    expectCode(ARTIFACT_ERROR_CODES.FILE_LIMIT),
  );
  await assert.rejects(
    createDesignBoardArtifactEnvelope({ sessionDir: root, maxBytes: 12 }),
    expectCode(ARTIFACT_ERROR_CODES.BYTE_LIMIT),
  );
});

test('SVG/PNG wrappers use the hardened bundler and are removed after failure', async () => {
  const root = fixture();
  write(root, 'variant-A.svg', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/pixel.png"/></svg>');

  await assert.rejects(
    createDesignBoardArtifactEnvelope({ sessionDir: root }),
    expectCode(ARTIFACT_ERROR_CODES.EXTERNAL_ASSET),
  );
  assert.equal(readdirSync(root).some((name) => name.startsWith('.planr-artifact-entry-')), false);
});

test('invalid board sources and private metadata fail before an envelope is created', async () => {
  const root = fixture();
  write(root, 'board.html', '<p>chrome</p>');
  write(root, 'finalized.html', '<p>artifact</p>');

  await assert.rejects(
    createDesignBoardArtifactEnvelope({
      sessionDir: root,
      variants: [{ id: 'artifact', label: 'Board', src: 'board.html', type: 'html' }],
    }),
    expectCode(ARTIFACT_ERROR_CODES.INPUT_INVALID),
  );
  await assert.rejects(
    createDesignBoardArtifactEnvelope({ sessionDir: root, mode: 'review', title: '/Users/example/private/review' }),
    expectCode(ARTIFACT_ERROR_CODES.REDACTION),
  );
  await assert.rejects(
    createDesignBoardArtifactEnvelope({
      sessionDir: root,
      mode: 'review',
      variants: [
        { id: 'one', src: 'finalized.html', type: 'html' },
        { id: 'two', src: 'finalized.html', type: 'html' },
      ],
    }),
    expectCode(ARTIFACT_ERROR_CODES.INPUT_INVALID),
  );
});

test('resolver returns portable descriptors only and bundle accounting is serializable', async () => {
  const root = fixture();
  write(root, 'variant-A.html', '<p>A</p>');
  const resolved = resolveDesignBoardVariants({ sessionDir: root });
  assert.deepEqual(resolved, {
    mode: 'loop',
    variants: [{ id: 'A', label: 'variant-A.html', src: 'variant-A.html', type: 'html' }],
  });
  const bundled = await bundleDesignBoardVariants({ sessionDir: root });
  assert.deepEqual(Object.keys(bundled.totals), ['fileCount', 'inputBytes', 'outputBytes']);
  assert.equal(bundled.totals.fileCount, 1);
  assert.doesNotMatch(JSON.stringify(bundled), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
