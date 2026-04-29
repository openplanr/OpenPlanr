/**
 * `resolveBulkStatusIntent` flag-validation logic for BL-015.
 * Pure — no FS access — so we test the mutex rules directly.
 */

import { describe, expect, it } from 'vitest';
import { resolveBulkStatusIntent } from '../../src/cli/helpers/bulk-checkbox-update.js';

describe('resolveBulkStatusIntent', () => {
  it('--all-done implies status=done', () => {
    const r = resolveBulkStatusIntent({ allDone: true });
    expect(r.useBulk).toBe(true);
    if (r.useBulk) expect(r.bulkStatus).toBe('done');
  });

  it('--all-pending implies status=pending', () => {
    const r = resolveBulkStatusIntent({ allPending: true });
    expect(r.useBulk).toBe(true);
    if (r.useBulk) expect(r.bulkStatus).toBe('pending');
  });

  it('plain --status passes through unchanged', () => {
    const r = resolveBulkStatusIntent({ status: 'in-progress' });
    expect(r.useBulk).toBe(false);
    if (!r.useBulk) expect(r.status).toBe('in-progress');
  });

  it('no flags at all → useBulk=false with no status (caller errors)', () => {
    const r = resolveBulkStatusIntent({});
    expect(r.useBulk).toBe(false);
    if (!r.useBulk) expect(r.status).toBeUndefined();
  });

  it('--all-done + --all-pending → throws (mutually exclusive)', () => {
    expect(() => resolveBulkStatusIntent({ allDone: true, allPending: true })).toThrow(
      /mutually exclusive/,
    );
  });

  it('--status + --all-done → throws (combo is ambiguous)', () => {
    expect(() => resolveBulkStatusIntent({ status: 'done', allDone: true })).toThrow(
      /mutually exclusive/,
    );
  });

  it('--status + --all-pending → throws', () => {
    expect(() => resolveBulkStatusIntent({ status: 'pending', allPending: true })).toThrow(
      /mutually exclusive/,
    );
  });
});
