import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getNextId } from '../../src/services/id-service.js';

let dir: string;

function touch(...names: string[]): void {
  for (const name of names) writeFileSync(path.join(dir, name), '');
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'openplanr-next-id-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('getNextId', () => {
  it('returns PREFIX-001, padded to three digits, for an empty directory', async () => {
    await expect(getNextId(dir, 'EPIC')).resolves.toBe('EPIC-001');
  });

  it('increments from the highest existing id', async () => {
    touch('EPIC-001-some-slug.md', 'EPIC-002-another.md', 'EPIC-003-third.md');
    await expect(getNextId(dir, 'EPIC')).resolves.toBe('EPIC-004');
  });

  it('never fills a gap left by a removed file', async () => {
    touch('TASK-002-some-task.md', 'TASK-003-another.md');
    await expect(getNextId(dir, 'TASK')).resolves.toBe('TASK-004');
  });

  it('never reissues the id of the newest file after it is removed', async () => {
    touch('FEAT-001-first.md');
    const issued = await getNextId(dir, 'FEAT');
    touch(`${issued}-second.md`);
    unlinkSync(path.join(dir, `${issued}-second.md`));

    expect(issued).toBe('FEAT-002');
    await expect(getNextId(dir, 'FEAT')).resolves.toBe('FEAT-003');
  });

  it('continues past 999 and reads four-digit ids back', async () => {
    touch('FEAT-998-a.md', 'FEAT-999-b.md');
    await expect(getNextId(dir, 'FEAT')).resolves.toBe('FEAT-1000');
    touch('FEAT-1000-c.md');
    await expect(getNextId(dir, 'FEAT')).resolves.toBe('FEAT-1001');
  });

  it('counts only files of its own prefix, matched literally', async () => {
    touch('US-001-story.md', 'US-002-story.md', 'FEAT-009-feature.md');
    touch('A.B-001-kept.md', 'AXB-002-decoy.md');
    await expect(getNextId(dir, 'US')).resolves.toBe('US-003');
    await expect(getNextId(dir, 'A.B')).resolves.toBe('A.B-002');
    await expect(getNextId(dir, 'Q(')).resolves.toBe('Q(-001');
  });

  it('does not count a sprint notes directory as an issued id', async () => {
    touch('SPRINT-001-first.md');
    mkdirSync(path.join(dir, 'SPRINT-002'));
    await expect(getNextId(dir, 'SPRINT')).resolves.toBe('SPRINT-002');
  });

  it('gives concurrent callers different ids', async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, () => getNextId(dir, 'BL')));
    expect([...ids].sort()).toEqual([
      'BL-001',
      'BL-002',
      'BL-003',
      'BL-004',
      'BL-005',
      'BL-006',
      'BL-007',
      'BL-008',
    ]);
  });
});
