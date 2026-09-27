import { describe, expect, it } from 'vitest';
import { parseId } from '../../src/services/id-service.js';

describe('parseId', () => {
  it('parses a valid epic ID', () => {
    expect(parseId('EPIC-001')).toEqual({ prefix: 'EPIC', num: 1 });
  });

  it('parses a valid feature ID', () => {
    expect(parseId('FEAT-042')).toEqual({ prefix: 'FEAT', num: 42 });
  });

  it('parses a valid user story ID', () => {
    expect(parseId('US-100')).toEqual({ prefix: 'US', num: 100 });
  });

  it('parses a valid task ID', () => {
    expect(parseId('TASK-007')).toEqual({ prefix: 'TASK', num: 7 });
  });

  it('returns null for invalid ID format', () => {
    expect(parseId('invalid')).toBeNull();
    expect(parseId('EPIC-1')).toBeNull();
    expect(parseId('epic-001')).toBeNull();
    expect(parseId('')).toBeNull();
  });

  it('parses ids past 999, which the generators emit with four or more digits', () => {
    expect(parseId('SPEC-1000')).toEqual({ prefix: 'SPEC', num: 1000 });
  });

  it('rejects ids carrying regular-expression or path syntax', () => {
    for (const hostile of ['.*', '(', 'US-001.*', 'US-001-', 'US', '../US-001', 'US-001/x']) {
      expect(parseId(hostile)).toBeNull();
    }
  });
});
