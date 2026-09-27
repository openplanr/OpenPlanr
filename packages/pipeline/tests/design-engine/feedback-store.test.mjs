import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { digestArtifactEnvelope } from '../../lib/artifact/envelope.mjs';
import { createArtifactReview } from '../../lib/artifact/review.mjs';
import { createDesignBoardArtifactEnvelope } from '../../lib/design-engine/artifact-adapter.mjs';
import { DESIGN_BOARD_ENVELOPE_FILE } from '../../lib/design-engine/board.mjs';
import { createDaemon, daemonControlHeaders } from '../../lib/design-engine/daemon.mjs';

const BOARD_ID = `store--${'c'.repeat(24)}`;
const TRUNCATED =
  '{\n  "schema_version": "1.0.0",\n  "pins": [\n    { "id": "aaaaaaaaaaaa", "author": "Owner", "comment": "keep me"';
const NOT_JSON = 'it is not valid JSON';

const submission = {
  schema_version: '1.0.0',
  boardId: BOARD_ID,
  publishedAt: '2026-09-27T10:00:00.000Z',
  regenerated: false,
  ratings: {},
  comments: {},
  authors: [{ name: 'Reviewer' }],
  pins: [
    {
      id: 'b1b2c3d4e5f6',
      author: 'Reviewer',
      variant: 'A',
      x: 0.5,
      y: 0.5,
      w: 0,
      h: 0,
      comment: 'tighten spacing',
      intent: 'fix',
      status: 'open',
    },
  ],
};

async function boardFixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'planr-store-home-'));
  const dir = mkdtempSync(join(tmpdir(), 'planr-store-board-'));
  t.after(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(
    join(dir, 'variant-A.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
  );
  const envelope = await createDesignBoardArtifactEnvelope({ sessionDir: dir, mode: 'loop' });
  writeFileSync(join(dir, DESIGN_BOARD_ENVELOPE_FILE), `${JSON.stringify(envelope)}\n`);
  writeFileSync(join(dir, 'board.html'), '<!doctype html><title>board</title>');

  const env = { PLANR_HOME: home };
  const daemon = createDaemon({ env });
  const port = await daemon.listen();
  t.after(() => daemon.close());
  const origin = `http://127.0.0.1:${port}`;
  const register = () =>
    fetch(`${origin}/api/boards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...daemonControlHeaders(env) },
      body: JSON.stringify({ id: BOARD_ID, dir }),
    });
  assert.equal((await register()).status, 200);
  const api = (route, init = {}) =>
    fetch(`${origin}/boards/${BOARD_ID}/api/${route}`, {
      ...init,
      headers: { origin, 'content-type': 'application/json' },
    });
  return { dir, envelope, register, api, feedbackPath: join(dir, 'feedback.json') };
}

function assertUnreadable(message, path, reason = NOT_JSON) {
  assert.equal(
    message,
    `The design board feedback ${path} is unreadable: ${reason}. It was left unchanged; repair it or move it aside, then retry.`,
  );
}

for (const [label, bytes, reason] of [
  ['truncated', Buffer.from(TRUNCATED), NOT_JSON],
  // V8 quotes the ten characters before an unexpected token, here the end of the comment.
  [
    'comment-quoting',
    Buffer.from('{"pins":[{"id":"aaaaaaaaaaaa","comment":"zz91qx88kw","x":y}]}'),
    NOT_JSON,
  ],
  [
    'not UTF-8',
    Buffer.concat([
      Buffer.from('{"pins": [{"id": "aaaaaaaaaaaa", "author": "Owner", "comment": "keep '),
      Buffer.from([0xff]),
      Buffer.from('"}]}'),
    ]),
    NOT_JSON,
  ],
  [
    'pins not an array',
    Buffer.from('{"pins": {"aaaaaaaaaaaa": {"comment": "keep me"}}}'),
    'pins is not an array',
  ],
  [
    'authors not an array',
    Buffer.from('{"pins": [], "authors": {"Owner": {}}}'),
    'authors is not an array',
  ],
]) {
  test(`a submit leaves unreadable feedback (${label}) unchanged and reports it`, async (t) => {
    const board = await boardFixture(t);
    writeFileSync(board.feedbackPath, bytes);

    const submitted = await board.api('feedback', {
      method: 'POST',
      body: JSON.stringify({ kind: 'submit', feedback: submission }),
    });
    assert.deepEqual(readFileSync(board.feedbackPath), bytes, 'the earlier pins are kept');
    assert.equal(submitted.status, 500);
    assertUnreadable((await submitted.json()).error, board.feedbackPath, reason);

    const read = await board.api('feedback');
    assert.equal(read.status, 500, 'a read never presents the file as empty feedback');
    assertUnreadable((await read.json()).error, board.feedbackPath, reason);
  });
}

test('a review save leaves an unreadable feedback file unchanged and reports it', async (t) => {
  const board = await boardFixture(t);
  writeFileSync(board.feedbackPath, TRUNCATED);
  const at = '2026-09-27T10:00:00.000Z';
  const review = createArtifactReview({
    reviewId: 'design-review-1',
    reviewOf: digestArtifactEnvelope(board.envelope),
    decision: 'changes_requested',
    createdAt: at,
    updatedAt: at,
    pins: [
      {
        id: 'pin-1',
        author: { name: 'Reviewer' },
        artifactId: 'A',
        variant: 'A',
        region: { x: 0.2, y: 0.3, w: 0.1, h: 0.05 },
        viewport: { width: 10, height: 10 },
        intent: 'fix',
        status: 'open',
        comment: 'tighten spacing',
        replies: [],
        createdAt: at,
        updatedAt: at,
      },
    ],
  });

  const saved = await board.api('artifact-review', {
    method: 'PUT',
    body: JSON.stringify({ review }),
  });
  assert.equal(readFileSync(board.feedbackPath, 'utf8'), TRUNCATED, 'the earlier pins are kept');
  assert.equal(saved.status, 500);
  assertUnreadable((await saved.json()).error, board.feedbackPath);
});

test('registering a board keeps an unreadable feedback file and its pending round', async (t) => {
  const board = await boardFixture(t);
  writeFileSync(board.feedbackPath, TRUNCATED);
  const pendingPath = join(board.dir, 'feedback-pending.json');
  const pending = `${JSON.stringify(submission, null, 2)}\n`;
  writeFileSync(pendingPath, pending);
  const stderr = [];
  t.mock.method(process.stderr, 'write', (chunk) => {
    stderr.push(String(chunk));
    return true;
  });

  assert.equal((await board.register()).status, 200);
  // The reload queues behind the pending-round merge on the board lock.
  assert.equal((await board.api('reload', { method: 'POST' })).status, 200);
  assert.equal(readFileSync(board.feedbackPath, 'utf8'), TRUNCATED, 'the earlier pins are kept');
  assert.equal(readFileSync(pendingPath, 'utf8'), pending, 'the pending round is kept');
  const notice = stderr.find((line) => line.startsWith('[feedback] The design board feedback '));
  assert.ok(notice, stderr.join(''));
  assertUnreadable(notice.slice('[feedback] '.length).trimEnd(), board.feedbackPath);
});

test('a submit replaces the feedback file atomically with owner-only permissions', async (t) => {
  // A restrictive umask would make a plain write owner-only too.
  const umask = process.umask(0o022);
  t.after(() => process.umask(umask));
  const board = await boardFixture(t);
  const submitted = await board.api('feedback', {
    method: 'POST',
    body: JSON.stringify({ kind: 'submit', feedback: submission }),
  });
  assert.equal(submitted.status, 200);
  assert.deepEqual(
    JSON.parse(readFileSync(board.feedbackPath, 'utf8')).pins.map(({ id }) => id),
    ['b1b2c3d4e5f6'],
  );
  assert.deepEqual(
    readdirSync(board.dir).filter((name) => name.endsWith('.tmp')),
    [],
    'no temporary file is left beside the feedback file',
  );
  if (process.platform !== 'win32') assert.equal(statSync(board.feedbackPath).mode & 0o777, 0o600);
});
