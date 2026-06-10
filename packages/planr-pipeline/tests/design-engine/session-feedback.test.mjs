import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, afterEach } from 'node:test';

import { createSession, appendRound, recordRegionEdit, saveSession, loadSession } from '../../lib/design-engine/session.mjs';
import { readFeedback, clampPin, assertValidFeedback, FEEDBACK_FILE, PENDING_FILE } from '../../lib/design-engine/feedback.mjs';

const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'planr-sf-')); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

const fixedNow = () => new Date('2026-06-10T12:00:00Z');

test('session chaining: create → round (responseId) → iterate round → region edit', () => {
  let s = createSession({ id: 's1', provider: 'openai', target: 'logo', brief: 'a mark', now: fixedNow });
  assert.equal(s.lastResponseId, null);
  s = appendRound(s, { outputPath: '/a/v1.png', responseId: 'resp_1', now: fixedNow });
  s = appendRound(s, { outputPath: '/a/v2.png', responseId: 'resp_2', feedback: 'tighter', now: fixedNow });
  assert.equal(s.lastResponseId, 'resp_2', 'chain carries the LATEST response id');
  assert.deepEqual(s.outputPaths, ['/a/v1.png', '/a/v2.png']);
  assert.deepEqual(s.feedbackHistory, ['tighter']);
  s = recordRegionEdit(s, { screen: 's-hero', pins: [{ variant: 'A' }], summary: 'kerned', now: fixedNow });
  assert.equal(s.regionEdits.length, 1);
  assert.equal(s.regionEdits[0].screen, 's-hero');
});

test('brief revisions only append when they actually change', () => {
  let s = createSession({ id: 's2', provider: 'claude-svg', target: 'logo', brief: 'v1', now: fixedNow });
  s = appendRound(s, { outputPath: '/a.svg', brief: 'v1', now: fixedNow });
  s = appendRound(s, { outputPath: '/b.svg', brief: 'v2', now: fixedNow });
  assert.deepEqual(s.briefVersions, ['v1', 'v2']);
});

test('save/load round-trips and enforces the schema', () => {
  const dir = tmp();
  const s = createSession({ id: 's3', provider: 'claude-svg', target: 'screen', brief: 'b', now: fixedNow });
  saveSession(dir, 'A', s);
  const back = loadSession(dir, 'A');
  assert.equal(back.id, 's3');
  assert.throws(
    () => saveSession(dir, 'A', { ...s, provider: 'midjourney' }),
    /invalid design-session/,
    'off-schema sessions never hit disk',
  );
});

test('clampPin normalizes out-of-range coords into 0..1', () => {
  const p = clampPin({ variant: 'A', x: 1.8, y: -0.4, w: 2, h: 0.5, comment: 'c', intent: 'fix' });
  assert.deepEqual({ x: p.x, y: p.y, w: p.w, h: p.h }, { x: 1, y: 0, w: 1, h: 0.5 });
});

test('cross-field rule: regenerated=true without regenerateAction throws', () => {
  const base = {
    schema_version: '1.0.0', boardId: 'b', publishedAt: 't',
    ratings: {}, comments: {}, regenerated: true, pins: [],
  };
  assert.throws(() => assertValidFeedback(base), /requires regenerateAction/);
  assert.doesNotThrow(() => assertValidFeedback({ ...base, regenerateAction: 'iterate' }));
});

const submitPayload = {
  schema_version: '1.0.0', boardId: 'b', publishedAt: 't', preferred: 'A',
  ratings: { A: 5 }, comments: {}, regenerated: false, pins: [],
};

test('readFeedback: pending wins over submit and is CONSUMED on read', () => {
  const dir = tmp();
  writeFileSync(join(dir, FEEDBACK_FILE), JSON.stringify(submitPayload));
  writeFileSync(join(dir, PENDING_FILE), JSON.stringify({ ...submitPayload, preferred: undefined, regenerated: true, regenerateAction: 'more-like' }));
  const first = readFeedback(dir);
  assert.equal(first.kind, 'pending');
  assert.equal(existsSync(join(dir, PENDING_FILE)), false, 'pending deleted — never double-applied');
  const second = readFeedback(dir);
  assert.equal(second.kind, 'submit', 'submit remains in place');
  assert.equal(existsSync(join(dir, FEEDBACK_FILE)), true);
});

test('readFeedback: nothing there → null (the agent re-waits, never guesses)', () => {
  assert.equal(readFeedback(tmp()), null);
});
