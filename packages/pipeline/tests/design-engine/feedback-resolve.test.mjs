import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { createDaemon } from '../../lib/design-engine/daemon.mjs';
import { publicBoardId } from '../../lib/design-engine/board-token.mjs';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', '..', 'lib', 'design-engine', 'cli.mjs');

// Async (NOT execFileSync): the in-process daemon answers on this event loop, so a synchronous
// child would deadlock its HTTP handlers.
const runCli = async (args, env) =>
  JSON.parse((await execFileP(process.execPath, [CLI, ...args], { env, encoding: 'utf-8' })).stdout);

const fb = (id, pins, authors) => ({
  schema_version: '1.0.0', boardId: id, publishedAt: new Date().toISOString(),
  regenerated: false, ratings: {}, comments: {}, authors, pins,
});
const postFeedback = (port, id, feedback) => fetch(
  `http://127.0.0.1:${port}/boards/${encodeURIComponent(id)}/api/feedback`,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'submit', feedback }) },
).then((r) => r.json());
const durablePins = (boardDir) => JSON.parse(readFileSync(join(boardDir, 'feedback.json'), 'utf-8')).pins;

// Spin an isolated in-process daemon + a registered board; returns handles + teardown.
async function setup() {
  const home = mkdtempSync(join(tmpdir(), 'planr-resolve-home-'));
  const boardDir = mkdtempSync(join(tmpdir(), 'planr-resolve-board-'));
  writeFileSync(join(boardDir, 'board.html'), '<!doctype html><title>t</title>');
  const env = { ...process.env, PLANR_HOME: home };
  const slug = 'demo-review';
  const id = publicBoardId(slug, boardDir, { env }); // mints the token under the isolated home
  const daemon = createDaemon({ env });
  const port = await daemon.listen();
  await fetch(`http://127.0.0.1:${port}/api/boards`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, dir: boardDir }),
  }).then((r) => r.json());
  const teardown = async () => {
    await daemon.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(boardDir, { recursive: true, force: true });
  };
  return { boardDir, env, slug, id, port, teardown };
}

test('feedback resolve --pins: flips the pin to resolved; preserves author, comment, replies', async () => {
  const s = await setup();
  try {
    await postFeedback(s.port, s.id, fb(s.id, [{
      id: 'a1b2c3d4e5f6', author: 'Reviewer', variant: 'artifact', x: 0.5, y: 0.5, w: 0, h: 0,
      comment: 'tighten spacing', intent: 'fix', status: 'open', screen: 'hero',
      replies: [{ author: 'Reviewer', comment: 'still off', createdAt: new Date().toISOString() }],
    }], [{ name: 'Reviewer' }]));

    const res = await runCli(['feedback', 'resolve', '--dir', s.boardDir, '--id', s.slug, '--pins', 'a1b2c3d4e5f6'], s.env);
    assert.equal(res.ok, true);
    assert.deepEqual(res.resolved, ['a1b2c3d4e5f6']);

    const pin = durablePins(s.boardDir).find((p) => p.id === 'a1b2c3d4e5f6');
    assert.equal(pin.status, 'resolved', 'status flipped in the durable record');
    assert.equal(pin.author, 'Reviewer', 'author preserved — resolve is a team action, not author-scoped');
    assert.equal(pin.comment, 'tighten spacing', 'comment preserved through the merge');
    assert.equal(pin.replies.length, 1, 'reply thread preserved (status flip never clobbers it)');

    // idempotent: a second resolve is a no-op
    const again = await runCli(['feedback', 'resolve', '--dir', s.boardDir, '--id', s.slug, '--pins', 'a1b2c3d4e5f6'], s.env);
    assert.deepEqual(again.resolved, [], 'second run resolves nothing');
    assert.deepEqual(again.alreadyResolved, ['a1b2c3d4e5f6']);
  } finally { await s.teardown(); }
});

test('feedback resolve --all-open: resolves only the not-yet-resolved pins', async () => {
  const s = await setup();
  try {
    await postFeedback(s.port, s.id, fb(s.id, [
      { id: 'open01', author: 'A', variant: 'artifact', x: 0.1, y: 0.1, w: 0, h: 0, comment: 'a', intent: 'fix', status: 'open' },
      { id: 'done01', author: 'A', variant: 'artifact', x: 0.2, y: 0.2, w: 0, h: 0, comment: 'b', intent: 'improve', status: 'resolved' },
    ], [{ name: 'A' }]));

    const res = await runCli(['feedback', 'resolve', '--dir', s.boardDir, '--id', s.slug, '--all-open'], s.env);
    assert.deepEqual(res.resolved, ['open01']);
    assert.deepEqual(res.alreadyResolved, ['done01']);
    assert.equal(durablePins(s.boardDir).find((p) => p.id === 'open01').status, 'resolved');
  } finally { await s.teardown(); }
});

test('feedback resolve: unknown pin id is a non-fatal no-op (reported as missing)', async () => {
  const s = await setup();
  try {
    await postFeedback(s.port, s.id, fb(s.id, [
      { id: 'real01', author: 'A', variant: 'artifact', x: 0.1, y: 0.1, w: 0, h: 0, comment: 'a', intent: 'fix', status: 'open' },
    ], [{ name: 'A' }]));
    const res = await runCli(['feedback', 'resolve', '--dir', s.boardDir, '--id', s.slug, '--pins', 'ghost,real01'], s.env);
    assert.equal(res.ok, true);
    assert.deepEqual(res.resolved, ['real01']);
    assert.deepEqual(res.missing, ['ghost']);
  } finally { await s.teardown(); }
});
