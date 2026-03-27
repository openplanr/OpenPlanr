import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNextId } from '../../src/services/id-service.js';

// Mock the fs utility
vi.mock('../../src/utils/fs.js', () => ({
  listFiles: vi.fn(),
}));

import { listFiles } from '../../src/utils/fs.js';
const mockListFiles = vi.mocked(listFiles);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getNextId', () => {
  it('returns PREFIX-001 for empty directory', async () => {
    mockListFiles.mockResolvedValue([]);
    const id = await getNextId('/fake/dir', 'EPIC');
    expect(id).toBe('EPIC-001');
  });

  it('increments from highest existing sequential IDs', async () => {
    mockListFiles.mockResolvedValue([
      'EPIC-001-some-slug.md',
      'EPIC-002-another.md',
      'EPIC-003-third.md',
    ]);
    const id = await getNextId('/fake/dir', 'EPIC');
    expect(id).toBe('EPIC-004');
  });

  it('fills gaps in numbering', async () => {
    mockListFiles.mockResolvedValue([
      'TASK-002-some-task.md',
      'TASK-003-another.md',
    ]);
    const id = await getNextId('/fake/dir', 'TASK');
    expect(id).toBe('TASK-001');
  });

  it('fills middle gaps', async () => {
    mockListFiles.mockResolvedValue([
      'FEAT-001-first.md',
      'FEAT-003-third.md',
    ]);
    const id = await getNextId('/fake/dir', 'FEAT');
    expect(id).toBe('FEAT-002');
  });

  it('handles different prefixes independently', async () => {
    mockListFiles.mockResolvedValue([
      'US-001-story.md',
      'US-002-story.md',
    ]);
    const id = await getNextId('/fake/dir', 'US');
    expect(id).toBe('US-003');
  });

  it('pads numbers to 3 digits', async () => {
    mockListFiles.mockResolvedValue([]);
    const id = await getNextId('/fake/dir', 'TASK');
    expect(id).toBe('TASK-001');
    expect(id).toMatch(/^TASK-\d{3}$/);
  });

  it('passes correct regex to listFiles', async () => {
    mockListFiles.mockResolvedValue([]);
    await getNextId('/some/path', 'EPIC');
    expect(mockListFiles).toHaveBeenCalledWith('/some/path', expect.any(RegExp));
    const regex = mockListFiles.mock.calls[0][1] as RegExp;
    expect(regex.test('EPIC-001-slug.md')).toBe(true);
    expect(regex.test('FEAT-001-slug.md')).toBe(false);
  });
});
