import assert from 'node:assert/strict';
import test from 'node:test';
import { remindersFor } from '../src/reminders.js';

test('overdue notes come first', () => {
  const notes = [
    { id: '1', title: 'a', due: '2026-03-11', done: false },
    { id: '2', title: 'b', due: '2026-03-01', done: false },
  ];
  assert.deepEqual(
    remindersFor(notes, '2026-03-10').map((reminder) => reminder.id),
    ['2', '1'],
  );
});
