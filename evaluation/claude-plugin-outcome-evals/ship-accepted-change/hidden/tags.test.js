import assert from 'node:assert/strict';
import test from 'node:test';
import { createNote } from '../../src/notes.js';
import { withServer } from '../helpers.js';

test('tags are trimmed, lower-cased, de-duplicated and sorted', () => {
  assert.deepEqual(createNote('a', 'b', { tags: [' Work', 'work', 'Home'] }).tags, ['home', 'work']);
});

test('empty tags are dropped', () => {
  assert.deepEqual(createNote('a', 'b', { tags: ['  ', 'x'] }).tags, ['x']);
});

test('a note without tags has an empty tag list', () => {
  assert.deepEqual(createNote('a', 'b').tags, []);
  assert.deepEqual(createNote('a', 'b', { due: '2026-03-10' }).tags, []);
});

test('tags that are not an array of strings are rejected', () => {
  assert.throws(() => createNote('a', 'b', { tags: 'home' }), TypeError);
  assert.throws(() => createNote('a', 'b', { tags: [1] }), TypeError);
});

test('POST /notes stores and returns tags', async () => {
  await withServer(async (call) => {
    const created = await call('POST', '/notes', { body: { title: 'a', tags: ['Home'] } });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.tags, ['home']);
  });
});

test('POST /notes rejects tags that are not an array', async () => {
  await withServer(async (call) => {
    const created = await call('POST', '/notes', { body: { title: 'a', tags: 'home' } });
    assert.equal(created.status, 400);
  });
});
