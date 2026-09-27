import { describe, expect, it } from 'vitest';
import { escapeRegExp } from '../../src/utils/escape-regexp.js';

const hostile = ['a.*', '(', '[', ')', '\\', '$^', 'x{2}', 'a|b', 'a+?', 'SPRINT-001)'];

describe('escapeRegExp', () => {
  it('makes every syntax character match only itself', () => {
    for (const value of hostile) {
      expect(new RegExp(`^${escapeRegExp(value)}$`).test(value)).toBe(true);
    }
    expect(new RegExp(`^${escapeRegExp('a.*')}$`).test('abc')).toBe(false);
    expect(new RegExp(`^${escapeRegExp('a|b')}$`).test('a')).toBe(false);
  });

  it('produces sources that stay valid under the unicode flag', () => {
    for (const value of hostile) {
      expect(new RegExp(`^${escapeRegExp(value)}$`, 'u').test(value)).toBe(true);
    }
  });

  it('leaves ordinary artifact ids unchanged', () => {
    expect(escapeRegExp('FEAT-002')).toBe('FEAT-002');
  });
});
