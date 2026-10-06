import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { sheetContract, validateSheet } from '../../lib/design-engine/providers/claude-svg.mjs';
import { resolveProvider } from '../../lib/design-engine/providers/index.mjs';
import {
  DECAY_PER_WEEK,
  decayedConfidence,
  detectConflicts,
  emptyProfile,
  loadProfile,
  saveProfile,
  updateTaste,
} from '../../lib/design-engine/taste.mjs';

const dirs = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'planr-tp-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const NOW = new Date('2026-06-10T00:00:00Z');

// ── taste decay math ─────────────────────────────────────────────────────────
test('decay: exactly one week → confidence × 0.95; two weeks → × 0.95²', () => {
  const entry = {
    value: 'minimal',
    confidence: 0.8,
    approved_count: 1,
    rejected_count: 0,
    last_seen: '2026-06-03T00:00:00Z',
  };
  assert.ok(Math.abs(decayedConfidence(entry, NOW) - 0.8 * DECAY_PER_WEEK) < 1e-9);
  const twoWeeks = { ...entry, last_seen: '2026-05-27T00:00:00Z' };
  assert.ok(Math.abs(decayedConfidence(twoWeeks, NOW) - 0.8 * DECAY_PER_WEEK ** 2) < 1e-9);
});

test('decay is computed AT READ TIME — raw confidence is what persists', () => {
  const path = join(tmp(), 'taste-profile.json');
  const p = updateTaste(emptyProfile(), {
    verdict: 'approved',
    attributes: { aesthetics: ['minimal'] },
    sessionId: 's',
    now: new Date('2026-05-27T00:00:00Z'),
  });
  saveProfile(path, p);
  const onDisk = JSON.parse(readFileSync(path, 'utf-8'));
  const raw = onDisk.dimensions.aesthetics[0].confidence;
  const read = loadProfile(path, { now: NOW });
  assert.ok(read.dimensions.aesthetics[0].effective < raw, 'effective < raw after 2 weeks');
  assert.equal(
    onDisk.dimensions.aesthetics[0].effective,
    undefined,
    'no effective field persisted',
  );
});

test('updateTaste: approve raises toward 1, reject decays toward 0; counts track BOTH', () => {
  let p = emptyProfile();
  p = updateTaste(p, {
    verdict: 'approved',
    attributes: { fonts: ['Inter'] },
    sessionId: 'a',
    now: NOW,
  });
  const c1 = p.dimensions.fonts[0].confidence;
  p = updateTaste(p, {
    verdict: 'approved',
    attributes: { fonts: ['Inter'] },
    sessionId: 'b',
    now: NOW,
  });
  const c2 = p.dimensions.fonts[0].confidence;
  assert.ok(c2 > c1 && c2 <= 1);
  p = updateTaste(p, {
    verdict: 'rejected',
    attributes: { fonts: ['Inter'] },
    sessionId: 'c',
    now: NOW,
  });
  assert.ok(p.dimensions.fonts[0].confidence < c2);
  assert.equal(p.dimensions.fonts[0].approved_count, 2);
  assert.equal(p.dimensions.fonts[0].rejected_count, 1);
  assert.equal(p.sessions.length, 3, 'audit trail records every verdict');
});

test('conflicts are FLAGGED (high-confidence preference vs a contradicting brief), never resolved', () => {
  let p = emptyProfile();
  for (const s of ['1', '2', '3']) {
    p = updateTaste(p, {
      verdict: 'approved',
      attributes: { aesthetics: ['minimal'] },
      sessionId: s,
      now: NOW,
    });
  }
  const conflicts = detectConflicts(p, { aesthetics: ['playful'] }, { now: NOW });
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0], /minimal/);
  assert.match(conflicts[0], /playful/);
  assert.equal(
    detectConflicts(p, { aesthetics: ['minimal'] }, { now: NOW }).length,
    0,
    'agreeing brief → no flag',
  );
});

// ── provider selection: claude-svg is the only provider ─────────────────────
test('resolveProvider: auto and claude-svg resolve to claude-svg; any other name is rejected', () => {
  for (const requested of ['auto', 'claude-svg', undefined]) {
    const picked = resolveProvider(requested === undefined ? {} : { requested });
    assert.equal(picked.name, 'claude-svg');
    assert.equal(picked.degraded, false, 'the default is not a degradation');
  }
  assert.throws(() => resolveProvider({ requested: 'openai' }), /openai provider was removed/);
  assert.throws(
    () => resolveProvider({ requested: 'midjourney' }),
    /unknown provider "midjourney"/,
  );
});

// ── claude-svg sheet contract ────────────────────────────────────────────────
test('validateSheet: catches every contract violation class', () => {
  const c = sheetContract('logo');
  const good = `<svg xmlns="x" width="1200" height="800" viewBox="0 0 1200 800">
    <g id="tile-light"><g id="section-mark"/><g id="section-wordmark"><text>w</text></g><g id="section-lockup"/></g>
    <g id="tile-dark"><text>w</text></g></svg>`;
  assert.equal(validateSheet(good, c).pass, true);

  const bad =
    '<svg width="100" height="100"><script>x</script><a href="https://cdn.example/x"/></svg>';
  const verdict = validateSheet(bad, c);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.issues.some((i) => i.includes('dimensions')));
  assert.ok(verdict.issues.some((i) => i.includes('viewBox')));
  assert.ok(verdict.issues.some((i) => i.includes('section-mark')));
  assert.ok(verdict.issues.some((i) => i.includes('<script>')));
  assert.ok(verdict.issues.some((i) => i.includes('external URL')));
  assert.ok(verdict.issues.some((i) => i.includes('<text>')));
});
