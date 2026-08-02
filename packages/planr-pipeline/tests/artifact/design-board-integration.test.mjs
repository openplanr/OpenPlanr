import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  createDesignBoardArtifactEnvelope,
} from '../../lib/design-engine/artifact-adapter.mjs';
import {
  DESIGN_BOARD_ENVELOPE_FILE,
  DESIGN_BOARD_SOURCES_FILE,
  renderBoardHtml,
} from '../../lib/design-engine/board.mjs';
import { createDaemon } from '../../lib/design-engine/daemon.mjs';
import { digestArtifactEnvelope } from '../../lib/artifact/envelope.mjs';
import { createArtifactReview } from '../../lib/artifact/review.mjs';

const roots = [];
const daemons = [];
const runBrowser = process.env.PLANR_BROWSER_TESTS === '1'
  || process.env.npm_lifecycle_event === 'test:artifact:browser';

function temporary(prefix) {
  const path = mkdtempSync(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

afterEach(async () => {
  while (daemons.length) await daemons.pop().close();
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

async function fixture() {
  const sessionDir = temporary('planr-design-board-');
  const home = temporary('planr-design-home-');
  writeFileSync(join(sessionDir, 'variant-A.html'), `<!doctype html>
<html><head><meta charset="utf-8"><title>Checkout</title></head>
<body><button data-planr-id="checkout-submit">Pay now</button></body></html>`);
  writeFileSync(join(sessionDir, 'variant-B.html'), `<!doctype html>
<html><head><meta charset="utf-8"><title>Checkout compact</title></head>
<body><button data-planr-id="checkout-submit-compact">Pay</button></body></html>`);
  writeFileSync(join(sessionDir, 'variant-A.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M0 0h10v10z"/></svg>');
  writeFileSync(join(sessionDir, 'variant-B.png'), Buffer.from('89504e470d0a1a0a00000000', 'hex'));

  const envelope = await createDesignBoardArtifactEnvelope({
    sessionDir,
    mode: 'loop',
    title: 'Checkout design round',
    variants: [
      { id: 'A', label: 'Checkout', src: 'variant-A.html', type: 'html' },
      { id: 'B', label: 'Checkout compact', src: 'variant-B.html', type: 'html' },
    ],
  });
  writeFileSync(join(sessionDir, DESIGN_BOARD_ENVELOPE_FILE), `${JSON.stringify(envelope, null, 2)}\n`);
  writeFileSync(join(sessionDir, DESIGN_BOARD_SOURCES_FILE), `${JSON.stringify({
    schemaVersion: '1.0.0',
    sources: [
      { artifactId: 'A', src: 'variant-A.svg', kind: 'svg' },
      { artifactId: 'B', src: 'variant-B.png', kind: 'png' },
    ],
  }, null, 2)}\n`);
  writeFileSync(join(sessionDir, 'board.html'), renderBoardHtml({
    title: 'Checkout design round', mode: 'loop', envelope,
  }));

  const daemon = createDaemon({ env: { PLANR_HOME: home } });
  daemons.push(daemon);
  const port = await daemon.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const id = `checkout--${'b'.repeat(24)}`;
  const registration = await fetch(`${base}/api/boards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, dir: sessionDir }),
  });
  assert.equal(registration.status, 200);
  return { base, id, sessionDir, envelope };
}

test('design-loop uses one shared shell and serves ordered artifacts through trusted runtimes', async () => {
  const { base, id, envelope } = await fixture();
  const boardBase = `${base}/boards/${encodeURIComponent(id)}/`;
  const board = await fetch(boardBase).then((response) => response.text());

  assert.equal((board.match(/class="planr-review-rail"/g) ?? []).length, 1);
  assert.equal((board.match(/data-planr-slot="decision"/g) ?? []).length, 1);
  assert.match(board, /data-planr-slot="domain-rail"/);
  assert.match(board, /data-planr-action="share"/);
  assert.doesNotMatch(board, /class="rb-|--rb-/);

  const payload = await fetch(`${boardBase}api/envelope`).then((response) => response.json());
  assert.deepEqual(payload.envelope.artifacts.map(({ id: artifactId }) => artifactId), ['A', 'B']);
  assert.equal(payload.envelope.review.reviewOf, digestArtifactEnvelope(envelope));

  const runtimes = {};
  for (const route of ['runtime.js', 'stage.js', 'design-adapter.js']) {
    const response = await fetch(`${boardBase}${route}`);
    assert.equal(response.status, 200, `${route} remains available`);
    assert.match(response.headers.get('content-type') ?? '', /javascript/);
    runtimes[route] = await response.text();
  }
  for (const control of [
    'Overall direction', 'planrVariantComment', 'planrVariantRating',
    'planrRemixLayout', 'planrRemixColors', 'planrRemixNote',
    'Regenerate', 'More like selected', 'Remix', 'Save design review',
    'PNG — current screen', 'PNG — full design', 'HTML — artifact',
    'source-${source.kind}',
  ]) assert.match(runtimes['design-adapter.js'], new RegExp(control.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(runtimes['runtime.js'], /exportPng/);

  const sourceIndex = await fetch(`${boardBase}api/sources`).then((response) => response.json());
  assert.deepEqual(sourceIndex.sources.map(({ artifactId, kind }) => [artifactId, kind]), [['A', 'svg'], ['B', 'png']]);
  assert.doesNotMatch(JSON.stringify(sourceIndex), /planr-design-board-|\/private\/|\/Users\//);
  for (const source of sourceIndex.sources) {
    const response = await fetch(`${boardBase}${source.url}`);
    assert.equal(response.status, 200, `${source.kind} source export remains available`);
    assert.match(response.headers.get('content-disposition') ?? '', /attachment/);
    assert.match(response.headers.get('content-type') ?? '', source.kind === 'svg' ? /svg/ : /png/);
  }
  for (const artifact of envelope.artifacts) {
    const response = await fetch(`${boardBase}artifacts/${encodeURIComponent(artifact.id)}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') ?? '', /sandbox allow-scripts/);
    const prepared = await response.text();
    assert.match(prepared, /openplanr\.artifact-anchor/);
    assert.match(prepared, /export\.request/);
    assert.match(prepared, /export\.result/);
    assert.match(prepared, /data-planr-id=/);
    assert.doesNotMatch(prepared, /\/Users\/|file:\/\//);
  }
});

test('generic review writes translate into the unchanged durable feedback contract', async () => {
  const { base, id, sessionDir, envelope } = await fixture();
  const boardBase = `${base}/boards/${encodeURIComponent(id)}/`;
  const review = createArtifactReview({
    reviewId: 'design-review-1',
    reviewOf: digestArtifactEnvelope(envelope),
    decision: 'changes_requested',
    overall: 'Increase the primary action contrast.',
    createdAt: '2026-07-14T19:00:00.000Z',
    updatedAt: '2026-07-14T19:00:00.000Z',
    pins: [{
      id: 'pin-1',
      author: { name: 'Asem' },
      artifactId: 'A',
      variant: 'A',
      region: { x: 0.2, y: 0.3, w: 0.1, h: 0.05 },
      viewport: { width: 1440, height: 900 },
      anchor: { planrId: 'checkout-submit' },
      intent: 'fix',
      status: 'open',
      comment: 'Increase the primary action contrast.',
      replies: [],
      createdAt: '2026-07-14T19:00:00.000Z',
      updatedAt: '2026-07-14T19:00:00.000Z',
    }],
  });

  const saved = await fetch(`${boardBase}api/artifact-review`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ review }),
  });
  assert.equal(saved.status, 200);
  const result = await saved.json();
  assert.equal(result.feedback.schema_version, '1.0.0');
  assert.equal(result.feedback.pins[0].screen, 'checkout-submit');
  assert.equal(result.feedback.pins[0].variant, 'A');

  const legacy = await fetch(`${boardBase}api/feedback`).then((response) => response.json());
  assert.equal(legacy.pins[0].comment, review.pins[0].comment);
  assert.equal(legacy.pins[0].author, 'Asem');
  assert.equal(legacy.pins[0].status, 'open');
  assert.equal(JSON.parse(readFileSync(join(sessionDir, 'feedback.json'), 'utf8')).pins.length, 1);

  const hydrated = await fetch(`${boardBase}api/artifact-review`).then((response) => response.json());
  assert.equal(hydrated.review.reviewOf, review.reviewOf);
  assert.equal(hydrated.review.pins[0].anchor.planrId, 'checkout-submit');

  const stale = { ...review, reviewOf: 'f'.repeat(64) };
  const rejected = await fetch(`${boardBase}api/artifact-review`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ review: stale }),
  });
  assert.equal(rejected.status, 409);
});

test('legacy next-round fields and remix payload keep their persisted wire shape', async () => {
  const { base, id, sessionDir } = await fixture();
  const boardBase = `${base}/boards/${encodeURIComponent(id)}/`;
  const common = {
    schema_version: '1.0.0',
    boardId: id,
    publishedAt: '2026-07-15T08:00:00.000Z',
    regenerated: false,
    ratings: { A: 5, B: 3 },
    comments: { A: 'Keep this hierarchy.', B: 'Tighten the density.' },
    overall: 'Use the stronger A hierarchy with B spacing.',
    authors: [],
    pins: [],
  };
  const saved = await fetch(`${boardBase}api/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'submit', feedback: { ...common, preferred: 'A' } }),
  });
  assert.equal(saved.status, 200);
  const durable = JSON.parse(readFileSync(join(sessionDir, 'feedback.json'), 'utf8'));
  assert.deepEqual(durable.ratings, common.ratings);
  assert.deepEqual(durable.comments, common.comments);
  assert.equal(durable.overall, common.overall);
  assert.equal(durable.preferred, 'A');

  const pending = await fetch(`${boardBase}api/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'pending',
      feedback: {
        ...common,
        regenerated: true,
        regenerateAction: 'remix',
        remixSpec: { layoutFrom: 'A', colorsFrom: 'B', note: 'Use fewer cards.' },
      },
    }),
  });
  assert.equal(pending.status, 200);
  const round = JSON.parse(readFileSync(join(sessionDir, 'feedback-pending.json'), 'utf8'));
  assert.deepEqual(round.remixSpec, { layoutFrom: 'A', colorsFrom: 'B', note: 'Use fewer cards.' });
  assert.equal(round.regenerateAction, 'remix');
  assert.deepEqual(round.comments, common.comments);
  assert.equal(round.overall, common.overall);
});

async function waitForFile(path) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

test('real board restores every round and export control on the shared shell', {
  skip: runBrowser ? false : 'browser-gated',
  timeout: 60_000,
}, async () => {
  const { chromium } = await import('playwright');
  const { base, id, sessionDir } = await fixture();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(`${base}/boards/${encodeURIComponent(id)}/`);
    await page.locator('[data-planr-variant-comment="A"]').waitFor();

    assert.equal(await page.locator('[data-planr-variant-comment]').count(), 2);
    assert.equal(await page.locator('[data-planr-variant-rating]').count(), 2);
    await page.locator('[data-planr-variant-rating="A"]').selectOption('5');
    await page.locator('[data-planr-variant-comment="A"]').fill('Keep this hierarchy.');
    await page.locator('[data-planr-variant-comment="B"]').fill('Tighten the density.');

    await page.locator('summary').filter({ hasText: 'Next round' }).click();
    await page.locator('[data-planr-overall-direction]').fill('Use the stronger hierarchy.');
    await page.locator('[data-planr-remix-layout]').selectOption('A');
    await page.locator('[data-planr-remix-colors]').selectOption('B');
    await page.locator('[data-planr-remix-note]').fill('Use fewer cards.');
    await page.locator('[data-planr-remix]').click();
    await waitForFile(join(sessionDir, 'feedback-pending.json'));
    const pending = JSON.parse(readFileSync(join(sessionDir, 'feedback-pending.json'), 'utf8'));
    assert.deepEqual(pending.remixSpec, { layoutFrom: 'A', colorsFrom: 'B', note: 'Use fewer cards.' });
    assert.equal(pending.overall, 'Use the stronger hierarchy.');
    assert.deepEqual(pending.comments, { A: 'Keep this hierarchy.', B: 'Tighten the density.' });

    await page.locator('[data-planr-save-design]').click();
    await waitForFile(join(sessionDir, 'feedback.json'));
    const saved = JSON.parse(readFileSync(join(sessionDir, 'feedback.json'), 'utf8'));
    assert.equal(saved.ratings.A, 5);
    assert.equal(saved.overall, 'Use the stronger hierarchy.');
    assert.deepEqual(saved.comments, { A: 'Keep this hierarchy.', B: 'Tighten the density.' });

    await page.locator('summary').filter({ hasText: 'Exports' }).click();
    await page.locator('[data-planr-artifact-frame="A"][data-planr-bridge-trusted="true"]').waitFor();
    for (const [selector, extension] of [
      ['[data-planr-export="png-screen"]', '.png'],
      ['[data-planr-export="png-full"]', '.png'],
      ['[data-planr-export="html"]', '.html'],
      ['[data-planr-export="source-svg"][data-planr-artifact-id="A"]', '.svg'],
      ['[data-planr-export="source-png"][data-planr-artifact-id="B"]', '.png'],
    ]) {
      const [downloaded] = await Promise.all([
        page.waitForEvent('download'),
        page.locator(selector).click(),
      ]);
      assert.ok(downloaded.suggestedFilename().endsWith(extension), `${selector} downloads ${extension}`);
    }
    await context.close();
  } finally {
    await browser.close();
  }
});
