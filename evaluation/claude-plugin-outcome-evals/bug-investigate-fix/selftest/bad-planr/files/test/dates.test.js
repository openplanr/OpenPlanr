import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDueDate, parseDueDate } from '../src/dates.js';

test('an empty due date formats as an empty string', () => {
  assert.equal(formatDueDate(null), '');
  assert.equal(parseDueDate(''), null);
});

test('a due date must be YYYY-MM-DD', () => {
  assert.throws(() => parseDueDate('2026-3-1'), TypeError);
});

test('a due date formats as saved west of UTC', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    assert.equal(formatDueDate('2026-03-10'), '2026-03-10');
  } finally {
    process.env.TZ = previous;
  }
});
