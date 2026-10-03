import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { byteBufferEquality } from '../helpers/byte-buffer-equality.js';

describe('byte custody equality', () => {
  it('compares copied bytes and rejects substitution or changed lengths', () => {
    const original = Buffer.from([0, 1, 127, 255]);
    expect(byteBufferEquality(original, Buffer.from(original))).toBe(true);
    expect(byteBufferEquality(original, Buffer.from([0, 1, 126, 255]))).toBe(false);
    expect(byteBufferEquality(original, Buffer.from([0, 1, 127, 255, 0]))).toBe(false);
    expect(byteBufferEquality(Buffer.alloc(0), Buffer.alloc(0))).toBe(true);
  });

  it('compares only each Buffer view, including its offset and length', () => {
    const backing = Buffer.from([9, 1, 2, 9]);
    expect(byteBufferEquality(backing.subarray(1, 3), Buffer.from([1, 2]))).toBe(true);
    expect(byteBufferEquality(backing.subarray(0, 2), Buffer.from([1, 2]))).toBe(false);
  });

  it('leaves non-Buffer values to the ordinary matcher', () => {
    for (const value of [null, undefined, 1, 'bytes', { length: 2 }, new Uint8Array([1, 2])]) {
      expect(byteBufferEquality(value, value)).toBeUndefined();
      expect(byteBufferEquality(Buffer.from([1, 2]), value)).toBeUndefined();
    }
    expect({ nested: [1, 2] }).not.toEqual({ nested: [1, 3] });
  });

  it('retains exact equality and inequality inside ownership records', () => {
    expect({ bytes: Buffer.from([1, 2]) }).toEqual({ bytes: Buffer.from([1, 2]) });
    expect({ bytes: Buffer.from([1, 3]) }).not.toEqual({ bytes: Buffer.from([1, 2]) });
    expect({ bytes: Buffer.from([1, 2, 3]) }).not.toEqual({ bytes: Buffer.from([1, 2]) });
  });

  it('detects a final-byte substitution in a large preserved file', () => {
    const original = Buffer.alloc(2 * 1024 * 1024, 127);
    const copied = Buffer.from(original);
    expect(copied).toEqual(original);
    copied[copied.length - 1] = 126;
    expect(copied).not.toEqual(original);
  });
});
