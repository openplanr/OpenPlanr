import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { sha256Hex } from '../../packages/protocol/src/canonical-json.mjs';

test('portable SHA256 matches native SHA256 across padding, modular overflow, UTF8 and offset view boundaries', () => {
  for (const length of [0, 1, 31, 55, 56, 57, 63, 64, 65, 127, 128, 129, 1024, 65536, 128000]) {
    const buffer = new Uint8Array(length + 19);
    for (let index = 0; index < buffer.length; index++)
      buffer[index] = (index * 197 + index * index + 255) & 255;
    const bytes = buffer.subarray(7, 7 + length);
    assert.equal(
      sha256Hex(bytes),
      createHash('sha256').update(bytes).digest('hex'),
      `length ${length}`,
    );
  }
  for (const text of ['', 'abc', 'café☕𐐀', 'z'.repeat(1000000)])
    assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'));
  assert.throws(() => sha256Hex(new Uint16Array(4)), /Uint8Array/);
});
