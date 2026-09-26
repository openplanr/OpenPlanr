import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { digestArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { acquireStartLock } from '@openplanr/artifact/internal/server-util.mjs';
import { createArtifactReview } from '@openplanr/artifact/review.mjs';
import {
  atomicJson,
  currentDesign,
  prepareDesignDocument,
  renderDesignDocument,
} from '../lib/design/document.mjs';
import {
  readDesignFeedback,
  resolveDesignPins,
  saveDesignState,
  startDesignReview,
} from '../lib/design/review.mjs';
import { designFixture } from './design-fixture.mjs';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-review-test-'));
  const closers = [];
  t.after(async () => {
    for (const close of closers.reverse()) await close();
    rmSync(root, { recursive: true, force: true });
  });
  const design = designFixture(root, {
    variants: 2,
    frames: [{ id: 'desktop', label: 'Desktop', width: 1440, height: 1024 }],
  });
  await renderDesignDocument(design.file);
  const env = { ...process.env, PLANR_HOME: join(root, 'home') };
  return {
    root,
    ...design,
    env,
    closers,
    async start(options = {}) {
      const session = await startDesignReview(design.file, { env, ...options });
      if (session.close) closers.push(session.close);
      return session;
    },
  };
}

function feedback(current) {
  const artifact = current.envelope.artifacts[0];
  return createArtifactReview({
    reviewId: 'review-one',
    reviewOf: digestArtifactEnvelope(current.envelope),
    decision: 'changes_requested',
    overall: 'Clarify the primary action.',
    pins: [
      {
        id: 'pin-one',
        author: { name: 'Reviewer' },
        artifactId: artifact.id,
        region: { x: 0.2, y: 0.3, w: 0.1, h: 0.05 },
        viewport: artifact.viewport,
        anchor: { planrId: 'action-1' },
        intent: 'fix',
        status: 'open',
        comment: 'Make the primary action clearer.',
        replies: [],
        createdAt: '2026-09-09T09:00:00.000Z',
        updatedAt: '2026-09-09T09:00:00.000Z',
      },
    ],
  });
}

async function mutate(session, route, value, method = 'PUT') {
  return fetch(`${session.url}api/${route}`, {
    method,
    headers: {
      origin: new URL(session.url).origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify(value),
  });
}

test('pins, ratings, selected direction and arrangement survive server restart', async (t) => {
  const context = await fixture(t);
  const first = await context.start();
  const current = currentDesign(context.file),
    review = feedback(current);
  assert.equal((await mutate(first, 'review', { review })).status, 200);
  const saved = await saveDesignState(context.file, {
    revision: current.revision,
    stateVersion: 0,
    state: {
      view: 'prototype',
      selectedVariant: 'B',
      ratings: { A: 3, B: 5 },
      camera: { x: -440, y: 180 },
      viewports: {
        canvas: { x: -440, y: 180, zoom: 0.62 },
        prototype: { x: 96, y: 72, zoom: 0.8 },
      },
      positions: { [current.entries[0].artifactId]: { x: -172, y: -96 } },
    },
  });
  await first.close();
  const restarted = await context.start();
  assert.notEqual(restarted.url, first.url);
  const restored = await fetch(`${restarted.url}api/design-state`).then((response) =>
    response.json(),
  );
  assert.deepEqual(restored.state, saved.state);
  const pinned = readDesignFeedback(context.file, context.env).pins;
  assert.equal(pinned.length, 1);
  assert.equal(pinned[0].comment, review.pins[0].comment);
  assert.equal(pinned[0].stale, false);
});

test('simultaneous opens reuse one healthy server while competing state writes return a conflict', async (t) => {
  const context = await fixture(t);
  const sessions = await Promise.all([context.start(), context.start()]);
  assert.equal(sessions[0].url, sessions[1].url);
  assert.equal(sessions.filter((session) => session.reused).length, 1);
  const revision = currentDesign(context.file).revision;
  const results = await Promise.allSettled([
    saveDesignState(context.file, {
      revision,
      stateVersion: 0,
      state: { ratings: { A: 4 } },
    }),
    saveDesignState(context.file, {
      revision,
      stateVersion: 0,
      state: { ratings: { B: 5 } },
    }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.statusCode, 409);
});

test('a stale state writer waiting on a lock cannot overwrite a newly rendered revision', async (t) => {
  const context = await fixture(t),
    initial = currentDesign(context.file);
  const release = await acquireStartLock(join(context.root, '.design/studio-state.json.lock'));
  const save = saveDesignState(context.file, {
    revision: initial.revision,
    stateVersion: 0,
    state: { view: 'prototype' },
  });
  const pending = assert.rejects(
    save,
    (error) => error.statusCode === 409 && /design changed/u.test(error.message),
  );
  try {
    await delay(30);
    writeFileSync(
      join(context.root, 'source/screen-1.html'),
      readFileSync(join(context.root, 'source/screen-1.html'), 'utf8').replace(
        '12 active tasks',
        '15 active tasks',
      ),
    );
    await renderDesignDocument(context.file);
  } finally {
    release();
  }
  await pending;
});

test('revisions reject stale review writes and keep earlier pins visibly marked stale', async (t) => {
  const context = await fixture(t),
    session = await context.start();
  const initial = currentDesign(context.file),
    review = feedback(initial);
  assert.equal((await mutate(session, 'review', { review })).status, 200);
  writeFileSync(
    join(context.root, 'source/screen-2.html'),
    readFileSync(join(context.root, 'source/screen-2.html'), 'utf8').replace(
      '12 active tasks',
      '15 active tasks',
    ),
  );
  await renderDesignDocument(context.file);
  const staleWrite = await mutate(session, 'review', { review });
  assert.equal(
    staleWrite.status,
    400,
    'the artifact API retains its existing invalid-review response',
  );
  const pins = readDesignFeedback(context.file, context.env).pins;
  assert.equal(pins[0].stale, true);
  assert.equal(pins[0].status, 'open');
  const html = await fetch(session.url).then((response) => response.text());
  assert.match(html, /Earlier feedback/u);
  assert.match(html, /Make the primary action clearer/u);
});

test('invalid authoring drafts preserve the last completed studio and feedback', async (t) => {
  const context = await fixture(t),
    session = await context.start();
  const initial = currentDesign(context.file),
    review = feedback(initial);
  assert.equal((await mutate(session, 'review', { review })).status, 200);
  writeFileSync(context.file, '{"kind":');
  assert.equal(currentDesign(context.file).revision, initial.revision);
  assert.equal(readDesignFeedback(context.file, context.env).pins.length, 1);
  assert.equal((await fetch(session.url)).status, 200);
  assert.equal((await context.start()).reused, true);
});

test('occupied requested ports are preserved and incomplete browser readiness never reports ready', async (t) => {
  const context = await fixture(t);
  const occupied = createServer((_req, res) => res.end('existing service'));
  await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  context.closers.push(() => new Promise((resolve) => occupied.close(resolve)));
  const port = occupied.address().port;
  const session = await context.start({ port });
  assert.notEqual(Number(new URL(session.url).port), port);
  assert.equal(
    await fetch(`http://127.0.0.1:${port}`).then((response) => response.text()),
    'existing service',
  );
  const current = currentDesign(context.file);
  assert.equal(
    (
      await mutate(
        session,
        'design-ready',
        { revision: current.revision, status: 'ready', artifacts: [] },
        'POST',
      )
    ).status,
    400,
  );
  assert.equal(
    (await fetch(`${session.url}api/design-status`).then((response) => response.json())).status,
    'loading',
  );
  assert.equal(
    (
      await mutate(
        session,
        'design-ready',
        {
          revision: current.revision,
          status: 'ready',
          artifacts: current.entries.map((entry) => entry.artifactId),
        },
        'POST',
      )
    ).status,
    200,
  );
  assert.equal(
    (await fetch(`${session.url}api/design-status`).then((response) => response.json())).status,
    'ready',
  );
});

test('pin resolution requires verified revision and a surviving current anchor', async (t) => {
  const context = await fixture(t),
    session = await context.start();
  const current = currentDesign(context.file),
    review = feedback(current);
  assert.equal((await mutate(session, 'review', { review })).status, 200);
  await assert.rejects(
    resolveDesignPins(context.file, {
      pinIds: ['pin-one'],
      summary: 'Clarified action',
      env: context.env,
    }),
    /verify/u,
  );
  const screen = context.document.screens[0];
  screen.anchors = [];
  writeFileSync(context.file, JSON.stringify(context.document));
  writeFileSync(
    join(context.root, screen.source.html),
    readFileSync(join(context.root, screen.source.html), 'utf8').replace(
      'data-planr-id="action-1"',
      'data-planr-id="replacement"',
    ),
  );
  await renderDesignDocument(context.file);
  const updated = currentDesign(context.file);
  atomicJson(join(context.root, '.design/verification', `${updated.revision}.json`), {
    status: 'verified',
    revision: updated.revision,
  });
  await assert.rejects(
    resolveDesignPins(context.file, {
      pinIds: ['pin-one'],
      summary: 'Clarified action',
      env: context.env,
    }),
    /no current anchor/u,
  );
});

test('prepared authored snapshots remain consistent when editable sources change after preparation', async (t) => {
  const context = await fixture(t);
  const prepared = prepareDesignDocument(context.file);
  writeFileSync(join(context.root, 'source/screen-1.html'), '<p>Next draft</p>');
  assert.match(
    prepared.sourceContents.get('source/screen-1.html').toString('utf8'),
    /12 active tasks/u,
  );
  assert.match(prepared.envelope.artifacts[0].html, /12 active tasks/u);
});
