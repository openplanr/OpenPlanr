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
});
