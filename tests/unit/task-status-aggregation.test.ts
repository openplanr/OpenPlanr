/**
 * Aggregation rule that drives the merged TaskList Linear issue's stateId
 * (BL-014). Pure function — no I/O, no mocks.
 */

import { describe, expect, it } from 'vitest';
import { aggregateTaskStatus } from '../../src/services/linear/task-status-aggregation.js';

describe('aggregateTaskStatus', () => {
  it('returns undefined for empty input', () => {
    expect(aggregateTaskStatus([])).toBeUndefined();
  });

  it('all done → done', () => {
    expect(aggregateTaskStatus(['done', 'done', 'done'])).toBe('done');
  });

  it('any in-progress → in-progress', () => {
    expect(aggregateTaskStatus(['done', 'in-progress', 'done'])).toBe('in-progress');
    expect(aggregateTaskStatus(['pending', 'in-progress'])).toBe('in-progress');
  });

  it('mix of done + pending (no in-progress) → in-progress', () => {
    // The user has shipped at least one task — the merged TaskList is in progress.
    expect(aggregateTaskStatus(['done', 'pending'])).toBe('in-progress');
    expect(aggregateTaskStatus(['pending', 'done', 'pending'])).toBe('in-progress');
  });

  it('all pending → pending', () => {
    expect(aggregateTaskStatus(['pending', 'pending'])).toBe('pending');
  });

  it('single-element inputs return that status', () => {
    expect(aggregateTaskStatus(['done'])).toBe('done');
    expect(aggregateTaskStatus(['pending'])).toBe('pending');
    expect(aggregateTaskStatus(['in-progress'])).toBe('in-progress');
    expect(aggregateTaskStatus(['blocked'])).toBe('blocked');
  });

  it('any blocked → blocked (escalation: stuck child blocks parent)', () => {
    // One blocked task surfaces as blocked at the parent — operators must
    // see the failure, not have it averaged away into "in-progress".
    expect(aggregateTaskStatus(['done', 'blocked', 'done'])).toBe('blocked');
    expect(aggregateTaskStatus(['blocked', 'pending'])).toBe('blocked');
    expect(aggregateTaskStatus(['blocked', 'in-progress'])).toBe('blocked');
    expect(aggregateTaskStatus(['blocked'])).toBe('blocked');
  });
});
