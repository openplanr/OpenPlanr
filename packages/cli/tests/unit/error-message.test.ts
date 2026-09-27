import { describe, expect, it } from 'vitest';
import { messageOf } from '../../src/utils/error-message.js';

describe('messageOf', () => {
  it('returns the message of an Error', () => {
    expect(messageOf(new TypeError('bad input'))).toBe('bad input');
  });

  it('returns a thrown non-Error value as text instead of undefined', () => {
    expect(messageOf('gh: not logged in')).toBe('gh: not logged in');
    expect(messageOf(42)).toBe('42');
    expect(messageOf(undefined)).toBe('undefined');
  });
});
