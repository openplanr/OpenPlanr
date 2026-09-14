import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, afterEach } from 'node:test';

import {
  emptyProfile, updateTaste, decayedConfidence, loadProfile, saveProfile, detectConflicts, DECAY_PER_WEEK,
} from '../../lib/design-engine/taste.mjs';
import { resolveProvider } from '../../lib/design-engine/providers/index.mjs';
import { sheetContract, validateSheet } from '../../lib/design-engine/providers/claudeSvg.mjs';
import { generateVariant, iterate, checkQuality } from '../../lib/design-engine/providers/openai.mjs';

const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'planr-tp-')); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

const NOW = new Date('2026-06-10T00:00:00Z');

// ── taste decay math ─────────────────────────────────────────────────────────
test('decay: exactly one week → confidence × 0.95; two weeks → × 0.95²', () => {
  const entry = { value: 'minimal', confidence: 0.8, approved_count: 1, rejected_count: 0, last_seen: '2026-06-03T00:00:00Z' };
  assert.ok(Math.abs(decayedConfidence(entry, NOW) - 0.8 * DECAY_PER_WEEK) < 1e-9);
  const twoWeeks = { ...entry, last_seen: '2026-05-27T00:00:00Z' };
  assert.ok(Math.abs(decayedConfidence(twoWeeks, NOW) - 0.8 * DECAY_PER_WEEK ** 2) < 1e-9);
});

test('decay is computed AT READ TIME — raw confidence is what persists', () => {
  const path = join(tmp(), 'taste-profile.json');
  let p = updateTaste(emptyProfile(), {
    verdict: 'approved', attributes: { aesthetics: ['minimal'] }, sessionId: 's', now: new Date('2026-05-27T00:00:00Z'),
  });
  saveProfile(path, p);
  const onDisk = JSON.parse(readFileSync(path, 'utf-8'));
  const raw = onDisk.dimensions.aesthetics[0].confidence;
  const read = loadProfile(path, { now: NOW });
  assert.ok(read.dimensions.aesthetics[0].effective < raw, 'effective < raw after 2 weeks');
  assert.equal(onDisk.dimensions.aesthetics[0].effective, undefined, 'no effective field persisted');
});

test('updateTaste: approve raises toward 1, reject decays toward 0; counts track BOTH', () => {
  let p = emptyProfile();
  p = updateTaste(p, { verdict: 'approved', attributes: { fonts: ['Inter'] }, sessionId: 'a', now: NOW });
  const c1 = p.dimensions.fonts[0].confidence;
  p = updateTaste(p, { verdict: 'approved', attributes: { fonts: ['Inter'] }, sessionId: 'b', now: NOW });
  const c2 = p.dimensions.fonts[0].confidence;
  assert.ok(c2 > c1 && c2 <= 1);
  p = updateTaste(p, { verdict: 'rejected', attributes: { fonts: ['Inter'] }, sessionId: 'c', now: NOW });
  assert.ok(p.dimensions.fonts[0].confidence < c2);
  assert.equal(p.dimensions.fonts[0].approved_count, 2);
  assert.equal(p.dimensions.fonts[0].rejected_count, 1);
  assert.equal(p.sessions.length, 3, 'audit trail records every verdict');
});

test('conflicts are FLAGGED (high-confidence preference vs a contradicting brief), never resolved', () => {
  let p = emptyProfile();
  for (const s of ['1', '2', '3']) {
    p = updateTaste(p, { verdict: 'approved', attributes: { aesthetics: ['minimal'] }, sessionId: s, now: NOW });
  }
  const conflicts = detectConflicts(p, { aesthetics: ['playful'] }, { now: NOW });
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0], /minimal/);
  assert.match(conflicts[0], /playful/);
  assert.equal(detectConflicts(p, { aesthetics: ['minimal'] }, { now: NOW }).length, 0, 'agreeing brief → no flag');
});

// ── provider fallback selection ──────────────────────────────────────────────
test('resolveProvider: auto degrades to claude-svg without a key; openai errors with BOTH repairs', () => {
  assert.equal(resolveProvider({ requested: 'auto', auth: { apiKey: null } }).name, 'claude-svg');
  assert.equal(resolveProvider({ requested: 'auto', auth: { apiKey: 'sk' } }).name, 'openai');
  assert.equal(resolveProvider({ requested: 'claude-svg', auth: { apiKey: 'sk' } }).name, 'claude-svg');
  assert.throws(
    () => resolveProvider({ requested: 'openai', auth: { apiKey: null } }),
    /setup.*claude-svg|claude-svg.*setup/s,
  );
});

// ── claude-svg sheet contract ────────────────────────────────────────────────
test('validateSheet: catches every contract violation class', () => {
  const c = sheetContract('logo');
  const good = `<svg xmlns="x" width="1200" height="800" viewBox="0 0 1200 800">
    <g id="tile-light"><g id="section-mark"/><g id="section-wordmark"><text>w</text></g><g id="section-lockup"/></g>
    <g id="tile-dark"><text>w</text></g></svg>`;
  assert.equal(validateSheet(good, c).pass, true);

  const bad = '<svg width="100" height="100"><script>x</script><a href="https://cdn.example/x"/></svg>';
  const verdict = validateSheet(bad, c);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.issues.some((i) => i.includes('dimensions')));
  assert.ok(verdict.issues.some((i) => i.includes('viewBox')));
  assert.ok(verdict.issues.some((i) => i.includes('section-mark')));
  assert.ok(verdict.issues.some((i) => i.includes('<script>')));
  assert.ok(verdict.issues.some((i) => i.includes('external URL')));
  assert.ok(verdict.issues.some((i) => i.includes('<text>')));
});

// ── openai provider with mocked fetch (no network ever) ──────────────────────
const okImage = (id) => ({
  ok: true, status: 200,
  json: async () => ({ id, output: [{ type: 'image_generation_call', result: Buffer.from('png-bytes').toString('base64') }] }),
});

test('generateVariant: writes tmp file, chains previous_response_id, surfaces 429 as RATE_LIMITED', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body)); return okImage('resp_9'); };
  const out = await generateVariant('brief', { apiKey: 'sk', fetchImpl, tmpDir: tmp(), previousResponseId: 'resp_8' });
  assert.equal(out.responseId, 'resp_9');
  assert.equal(readFileSync(out.imagePath, 'utf-8'), 'png-bytes', 'tmp-first write (caller cps)');
  assert.equal(calls[0].previous_response_id, 'resp_8');
  assert.equal(calls[0].tools[0].type, 'image_generation');

  const limited = async () => ({ ok: false, status: 429, text: async () => 'slow down' });
  await assert.rejects(generateVariant('b', { apiKey: 'sk', fetchImpl: limited, tmpDir: tmp() }), (e) => e.code === 'RATE_LIMITED');
});

test('iterate refuses a chain-less session; checkQuality parses the vision verdict', async () => {
  await assert.rejects(iterate({ lastResponseId: null }, 'fb', { apiKey: 'sk' }), /no lastResponseId/);

  const img = join(tmp(), 'x.png');
  writeFileSync(img, 'fake');
  const verdictFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ output: [{ content: [{ text: 'verdict: {"pass": false, "issues": ["mark off-center"]}' }] }] }),
  });
  const v = await checkQuality(img, 'brief', { apiKey: 'sk', fetchImpl: verdictFetch });
  assert.deepEqual(v, { pass: false, issues: ['mark off-center'] });
});
