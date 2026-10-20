import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { createReviewLedger } from '@openplanr/artifact/merge.mjs';
import { writeArtifactReviewState } from '@openplanr/artifact/review.mjs';
import { atomicJson, currentDesign, renderDesignDocument } from '../lib/design/document.mjs';
import {
  designReviewKey,
  designReviewPath,
  readDesignFeedback,
  saveDesignLayout,
} from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';
import { fetch, startDesignReview } from './studio-http-fixture.mjs';

const key = 'screen-1/desktop/A';
async function fixture(t, layout) {
  const root = mkdtempSync(join(tmpdir(), 'planr-design-layout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { file, document } = designFixture(root, { count: 1 });
  if (layout !== undefined) document.layout = layout;
  atomicJson(file, document);
  await renderDesignDocument(file);
  return { root, file, document, current: currentDesign(file) };
}

test('layout saves preserve titles, formatting, artifact identity and review pin anchors', async (t) => {
  const f = await fixture(t, { boards: { [key]: { x: 12, y: 34, title: 'Overview' } } });
  chmodSync(f.file, 0o664);
  const mode = statSync(f.file).mode & 0o7777;
  const env = { ...process.env, PLANR_HOME: join(f.root, 'home') };
  const review = {
    schemaVersion: '1.0.0',
    reviewId: 'local-layout',
    reviewOf: digestArtifactEnvelope(f.current.envelope),
    decision: 'pending',
    overall: '',
    pins: [
      {
        id: 'pin',
        artifactId: f.current.entries[0].artifactId,
        author: { id: 'owner', name: 'Owner' },
        intent: 'improve',
        status: 'open',
        comment: 'Keep this action visible.',
        anchor: { planrId: 'action-1', screen: 'screen-1' },
        region: { x: 0.4, y: 0.5, w: 0.2, h: 0.2 },
        viewport: { width: 1440, height: 1024 },
        createdAt: '2026-10-20T10:00:00Z',
        updatedAt: '2026-10-20T10:00:00Z',
        replies: [],
      },
    ],
  };
  writeArtifactReviewState(
    designReviewPath(f.file, env),
    createReviewLedger({
      artifactId: designReviewKey(f.document),
      currentReviewOf: review.reviewOf,
      reviews: [{ review, stale: false }],
    }),
  );
  const pins = readDesignFeedback(f.file, env).pins;
  const result = await saveDesignLayout(f.file, {
    revision: f.current.revision,
    boards: { [key]: { x: 1200.25, y: -345 } },
  });
  const current = currentDesign(f.file);
  assert.equal(result.revision, current.revision);
  assert.equal(statSync(f.file).mode & 0o7777, mode);
  assert.notEqual(result.revision, f.current.revision);
  assert.deepEqual(current.document.layout.boards[key], { x: 1200.25, y: -345, title: 'Overview' });
  assert.equal(readFileSync(f.file, 'utf8'), `${JSON.stringify(current.document, null, 2)}\n`);
  assert.equal(digestArtifactEnvelope(current.envelope), review.reviewOf);
  assert.deepEqual(current.envelope, f.current.envelope);
  assert.deepEqual(current.fingerprints, f.current.fingerprints);
  assert.deepEqual(readDesignFeedback(f.file, env).pins, pins);
});

test('concurrent layout saves recheck the revision under the render lock', async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled(
    [1, 2].map((x) =>
      saveDesignLayout(f.file, {
        revision: f.current.revision,
        boards: { [key]: { x, y: 0 } },
      }),
    ),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.statusCode, 409);
});

test('layout saves cannot publish authored source changes into unchanged previews', async (t) => {
  const f = await fixture(t);
  const before = readFileSync(f.file, 'utf8');
  const source = join(f.root, 'source/screen-1.html');
  writeFileSync(source, readFileSync(source, 'utf8').replace('12 active tasks', '13 active tasks'));
  await assert.rejects(
    saveDesignLayout(f.file, {
      revision: f.current.revision,
      boards: { [key]: { x: 21, y: 34 } },
    }),
    (error) =>
      error.statusCode === 409 && /sources or content changed.*Render.*reload/u.test(error.message),
  );
  assert.equal(readFileSync(f.file, 'utf8'), before);
  assert.equal(currentDesign(f.file).revision, f.current.revision);
});

test('malformed coordinates, fields and unknown exact board keys never write the document', async (t) => {
  const f = await fixture(t);
  const before = readFileSync(f.file, 'utf8');
  for (const boards of [
    { 'screen-1': { x: 0, y: 0 } },
    { 'screen-1/desktop/unknown': null },
    { [key]: { x: 0 } },
    { [key]: { x: Infinity, y: 0 } },
    { [key]: { x: 1e7 + 1, y: 0 } },
    { [key]: { x: 0, y: 0, title: 'Changed' } },
    { [key]: [] },
  ]) {
    await assert.rejects(
      saveDesignLayout(f.file, { revision: f.current.revision, boards }),
      /board/i,
    );
    assert.equal(readFileSync(f.file, 'utf8'), before);
  }
  await assert.rejects(
    saveDesignLayout(f.file, {
      revision: f.current.revision,
      boards: {},
      unknown: true,
    }),
    /requires a revision/,
  );
});

test('layout undo restores the exact prior revision including absent and empty layout objects', async (t) => {
  for (const layout of [undefined, {}, { boards: {} }, { sections: [] }]) {
    const f = await fixture(t, layout);
    chmodSync(f.file, 0o644);
    const mode = statSync(f.file).mode & 0o7777;
    const moved = await saveDesignLayout(f.file, {
      revision: f.current.revision,
      boards: { [key]: { x: 91, y: 82 } },
    });
    const undone = await saveDesignLayout(f.file, {
      revision: moved.revision,
      restoreRevision: f.current.revision,
    });
    assert.equal(undone.revision, f.current.revision);
    assert.equal(statSync(f.file).mode & 0o7777, mode);
    assert.deepEqual(currentDesign(f.file).document.layout, layout);
    const redone = await saveDesignLayout(f.file, {
      revision: undone.revision,
      restoreRevision: moved.revision,
    });
    assert.equal(redone.revision, moved.revision);
    assert.equal(statSync(f.file).mode & 0o7777, mode);
  }
});

test('external specification edits cannot be published by layout saves', async (t) => {
  const f = await fixture(t);
  const before = readFileSync(f.file, 'utf8');
  writeFileSync(join(f.root, 'design-spec.md'), 'Incomplete specification');
  await assert.rejects(
    saveDesignLayout(f.file, {
      revision: f.current.revision,
      boards: { [key]: { x: 40, y: 50 } },
    }),
    (error) => error.statusCode === 409 && /sources or content changed/u.test(error.message),
  );
  assert.equal(readFileSync(f.file, 'utf8'), before);
  assert.equal(currentDesign(f.file).revision, f.current.revision);
});

test('exact board removal preserves sections and external document edits block layout restores', async (t) => {
  const sections = [{ id: 'start', x: 0, y: -60, text: 'Start here' }];
  const f = await fixture(t, { sections });
  const moved = await saveDesignLayout(f.file, {
    revision: f.current.revision,
    boards: { [key]: { x: -1e7, y: 1e7 } },
  });
  const removed = await saveDesignLayout(f.file, {
    revision: moved.revision,
    boards: { [key]: null },
  });
  assert.equal(removed.revision, f.current.revision);
  f.document.brief.text = 'An updated brief with the same authored screens.';
  atomicJson(f.file, f.document);
  const before = readFileSync(f.file, 'utf8');
  await assert.rejects(
    saveDesignLayout(f.file, { revision: removed.revision, restoreRevision: moved.revision }),
    (error) => error.statusCode === 409 && /sources or content changed/u.test(error.message),
  );
  assert.equal(readFileSync(f.file, 'utf8'), before);
  assert.equal(currentDesign(f.file).revision, removed.revision);
});

test('studio layout operation returns the new revision, rejects stale writes and requires owner headers', async (t) => {
  const f = await fixture(t);
  const session = await startDesignReview(f.file, {
    env: { ...process.env, PLANR_HOME: join(f.root, 'home') },
  });
  t.after(() => session.close());
  const url = `${session.url}api/design-layout`;
  const body = JSON.stringify({
    revision: f.current.revision,
    boards: { [key]: { x: 43, y: 52 } },
  });
  const forbidden = await fetch(url, { method: 'PUT', body });
  assert.equal(forbidden.status, 403);
  const options = {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-openplanr-design': '1',
      origin: new URL(session.url).origin,
    },
    body,
  };
  for (const headers of [
    { 'content-type': 'application/json', 'x-openplanr-design': '1' },
    { ...options.headers, origin: 'https://outside.example' },
    { ...options.headers, origin: 'null' },
    { ...options.headers, origin: 'http://127.0.0.1:0' },
    { ...options.headers, 'x-openplanr-design': '' },
    { ...options.headers, 'content-type': 'text/plain' },
  ])
    assert.equal((await fetch(url, { ...options, headers })).status, 403);
  const saved = await fetch(url, options);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { revision: currentDesign(f.file).revision });
  const stale = await fetch(url, options);
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /design changed/i);
});
