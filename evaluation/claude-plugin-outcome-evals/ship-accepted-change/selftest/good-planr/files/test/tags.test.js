import assert from 'node:assert/strict';
import test from 'node:test';
import { createNote } from '../src/notes.js';

test('tags are cleaned and sorted', () => {
  assert.deepEqual(createNote('a', 'b', { tags: [' Work', 'work', 'Home'] }).tags, ['home', 'work']);
});

test('notes without tags get an empty list', () => {
  assert.deepEqual(createNote('a', 'b').tags, []);
});
