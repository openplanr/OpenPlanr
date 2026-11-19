import assert from 'node:assert/strict';
import test from 'node:test';
import { remindersFor } from '../../src/reminders.js';

const note = (id, due, done = false) => ({ id, ownerId: 'ana', title: `note ${id}`, body: null, due, done });

const pick = (reminders) => reminders.map(({ id, overdue }) => ({ id, overdue: Boolean(overdue) }));

test('notes due today and in the next two days are included', () => {
  const notes = [note('1', '2026-03-10'), note('2', '2026-03-11'), note('3', '2026-03-12'), note('4', '2026-03-13')];
  assert.deepEqual(pick(remindersFor(notes, '2026-03-10')), [
    { id: '1', overdue: false },
    { id: '2', overdue: false },
    { id: '3', overdue: false },
  ]);
});

test('overdue notes are included, flagged and listed first', () => {
  const notes = [note('1', '2026-03-11'), note('2', '2026-03-08'), note('3', '2026-03-01')];
  assert.deepEqual(pick(remindersFor(notes, '2026-03-10')), [
    { id: '3', overdue: true },
    { id: '2', overdue: true },
    { id: '1', overdue: false },
  ]);
});

test('done notes and notes without a due date are left out', () => {
  const notes = [note('1', '2026-03-10', true), note('2', null), note('3', '2026-03-09', true), note('4', '2026-03-10')];
  assert.deepEqual(pick(remindersFor(notes, '2026-03-10')), [{ id: '4', overdue: false }]);
});

test('the two-day window crosses a month end', () => {
  const notes = [note('1', '2026-04-01'), note('2', '2026-04-02')];
  assert.deepEqual(pick(remindersFor(notes, '2026-03-30')), [{ id: '1', overdue: false }]);
});

test('each reminder carries the note title and due date', () => {
  const [reminder] = remindersFor([note('7', '2026-03-10')], '2026-03-10');
  assert.equal(reminder.title, 'note 7');
  assert.equal(reminder.due, '2026-03-10');
});
