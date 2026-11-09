import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const text = readFileSync(resolve(root, 'skills/planr-plan-review/SKILL.md'), 'utf8');
const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
const flat = body.replace(/\s+/g, ' ');

test('Plan Review keeps a short body', () => {
  const lines = body.split('\n').filter((line) => line.trim() !== '');
  assert.ok(lines.length <= 22, `body has ${lines.length} non-empty lines`);
});

test('Plan Review has no generic lens list or subagent line', () => {
  assert.doesNotMatch(flat, /review lenses|fixed committee|first-run and everyday/i);
  assert.doesNotMatch(flat, /subagent/i);
  assert.doesNotMatch(flat, /migration, security,\s*operability/i);
});

test('Plan Review keeps the verdict vocabulary and the blocker split', () => {
  for (const verdict of ['ready', 'ready with improvements', 'needs revision']) {
    assert.ok(flat.includes(`\`${verdict}\``), verdict);
  }
  assert.match(flat, /Must fix/);
  assert.match(flat, /Improvements/);
  assert.match(flat, /`needs revision` only while a must-fix remains/);
});

test('every must-fix names its evidence', () => {
  assert.match(flat, /\*\*Must fix\*\*.{0,250}evidence/);
});
