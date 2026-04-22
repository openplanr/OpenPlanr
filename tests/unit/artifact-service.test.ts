import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenPlanrConfig } from '../../src/models/types.js';
import {
  addChildReference,
  findArtifactTypeById,
  getArtifactDir,
  listArtifacts,
  readArtifact,
  readArtifactRaw,
  resolveArtifactFilename,
  updateArtifact,
} from '../../src/services/artifact-service.js';

// Mock dependencies
vi.mock('../../src/utils/fs.js', () => ({
  ensureDir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  listFiles: vi.fn(),
}));

vi.mock('../../src/utils/slugify.js', () => ({
  slugify: vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, '-')),
}));

vi.mock('../../src/utils/markdown.js', () => ({
  parseMarkdown: vi.fn((_raw: string) => ({
    data: { id: 'EPIC-001', title: 'Test Epic' },
    content: '# Test Epic\n\nBody content.',
  })),
}));

vi.mock('../../src/services/atomic-write-service.js', () => ({
  atomicWriteFile: async (targetPath: string, content: string) => {
    const { writeFile: wf } = await import('../../src/utils/fs.js');
    await wf(targetPath, content);
    return { targetPath };
  },
}));

vi.mock('../../src/services/id-service.js', () => ({
  getNextId: vi.fn(() => 'EPIC-001'),
}));

vi.mock('../../src/services/template-service.js', () => ({
  renderTemplate: vi.fn(() => '---\nid: EPIC-001\n---\n# Test Epic'),
}));

import { listFiles, readFile, writeFile } from '../../src/utils/fs.js';

const mockListFiles = vi.mocked(listFiles);
const mockWriteFile = vi.mocked(writeFile);
const mockReadFile = vi.mocked(readFile);

const config: OpenPlanrConfig = {
  projectName: 'test-project',
  targets: ['cursor'],
  outputPaths: {
    agile: '.planr',
    cursorRules: '.cursor/rules',
    claudeConfig: '.',
    codexConfig: '.',
  },
  idPrefix: {
    epic: 'EPIC',
    feature: 'FEAT',
    story: 'US',
    task: 'TASK',
  },
  createdAt: '2026-03-27',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getArtifactDir', () => {
  it('returns correct path for epic', () => {
    expect(getArtifactDir(config, 'epic')).toBe('.planr/epics');
  });

  it('returns correct path for feature', () => {
    expect(getArtifactDir(config, 'feature')).toBe('.planr/features');
  });

  it('returns correct path for story', () => {
    expect(getArtifactDir(config, 'story')).toBe('.planr/stories');
  });

  it('returns correct path for task', () => {
    expect(getArtifactDir(config, 'task')).toBe('.planr/tasks');
  });

  it('returns correct path for adr', () => {
    expect(getArtifactDir(config, 'adr')).toBe('.planr/adrs');
  });

  it('returns correct path for checklist', () => {
    expect(getArtifactDir(config, 'checklist')).toBe('.planr/checklists');
  });
});

describe('findArtifactTypeById', () => {
  it('maps EPIC prefix to epic', () => {
    expect(findArtifactTypeById('EPIC-001')).toBe('epic');
  });

  it('maps FEAT prefix to feature', () => {
    expect(findArtifactTypeById('FEAT-002')).toBe('feature');
  });

  it('maps US prefix to story', () => {
    expect(findArtifactTypeById('US-003')).toBe('story');
  });

  it('maps TASK prefix to task', () => {
    expect(findArtifactTypeById('TASK-004')).toBe('task');
  });

  it('maps ADR prefix to adr', () => {
    expect(findArtifactTypeById('ADR-001')).toBe('adr');
  });

  it('returns null for unknown prefix', () => {
    expect(findArtifactTypeById('UNKNOWN-001')).toBeNull();
  });
});

describe('listArtifacts', () => {
  it('lists and parses artifact filenames', async () => {
    mockListFiles.mockResolvedValue(['EPIC-001-user-auth.md', 'EPIC-002-payments.md']);

    const result = await listArtifacts('/project', config, 'epic');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'EPIC-001',
      title: 'user auth',
      filename: 'EPIC-001-user-auth.md',
    });
    expect(result[1]).toEqual({
      id: 'EPIC-002',
      title: 'payments',
      filename: 'EPIC-002-payments.md',
    });
  });

  it('ignores non-matching filenames', async () => {
    mockListFiles.mockResolvedValue(['EPIC-001-auth.md', 'readme.md', '.DS_Store']);

    const result = await listArtifacts('/project', config, 'epic');
    expect(result).toHaveLength(1);
  });

  it('returns empty array when no files', async () => {
    mockListFiles.mockResolvedValue([]);
    const result = await listArtifacts('/project', config, 'epic');
    expect(result).toEqual([]);
  });

  it('sorts results alphabetically', async () => {
    mockListFiles.mockResolvedValue([
      'FEAT-003-third.md',
      'FEAT-001-first.md',
      'FEAT-002-second.md',
    ]);

    const result = await listArtifacts('/project', config, 'feature');
    expect(result.map((r) => r.id)).toEqual(['FEAT-001', 'FEAT-002', 'FEAT-003']);
  });
});

describe('readArtifact', () => {
  it('returns parsed artifact when file exists', async () => {
    mockListFiles.mockResolvedValue(['EPIC-001-test-epic.md']);
    mockReadFile.mockResolvedValue('---\nid: EPIC-001\n---\n# Test Epic');

    const result = await readArtifact('/project', config, 'epic', 'EPIC-001');
    expect(result).not.toBeNull();
    expect(result?.data.id).toBe('EPIC-001');
    expect(result?.filePath).toContain('EPIC-001-test-epic.md');
  });

  it('returns null when no matching file', async () => {
    mockListFiles.mockResolvedValue([]);
    const result = await readArtifact('/project', config, 'epic', 'EPIC-999');
    expect(result).toBeNull();
  });

  it('returns null (not throw) when frontmatter YAML is malformed — lets batch commands continue past skip', async () => {
    mockListFiles.mockResolvedValue(['QT-008-broken.md']);
    mockReadFile.mockResolvedValue('---\nbroken-yaml\n---\n');
    // Make parseMarkdown simulate a YAML failure for this one call.
    const { parseMarkdown } = await import('../../src/utils/markdown.js');
    vi.mocked(parseMarkdown).mockImplementationOnce(() => {
      throw new Error('Map keys must be unique at line 13, column 1');
    });
    const result = await readArtifact('/project', config, 'quick', 'QT-008');
    expect(result).toBeNull();
  });
});

describe('readArtifactRaw', () => {
  it('returns raw file content', async () => {
    const rawContent = '---\nid: EPIC-001\n---\n# Test Epic\n\nFull content.';
    mockListFiles.mockResolvedValue(['EPIC-001-test.md']);
    mockReadFile.mockResolvedValue(rawContent);

    const result = await readArtifactRaw('/project', config, 'epic', 'EPIC-001');
    expect(result).toBe(rawContent);
  });

  it('returns null when no matching file', async () => {
    mockListFiles.mockResolvedValue([]);
    const result = await readArtifactRaw('/project', config, 'epic', 'EPIC-999');
    expect(result).toBeNull();
  });
});

describe('updateArtifact', () => {
  it('writes new content to existing artifact file', async () => {
    mockListFiles.mockResolvedValue(['EPIC-001-test.md']);
    await updateArtifact('/project', config, 'epic', 'EPIC-001', 'new content');
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('EPIC-001-test.md'),
      'new content',
    );
  });

  it('throws when artifact not found', async () => {
    mockListFiles.mockResolvedValue([]);
    await expect(updateArtifact('/project', config, 'epic', 'EPIC-999', 'content')).rejects.toThrow(
      'Artifact EPIC-999 not found',
    );
  });
});

describe('resolveArtifactFilename', () => {
  it('returns filename without .md extension', async () => {
    mockListFiles.mockResolvedValue(['EPIC-001-test-epic.md']);
    const result = await resolveArtifactFilename('/project', config, 'epic', 'EPIC-001');
    expect(result).toBe('EPIC-001-test-epic');
  });

  it('falls back to bare ID when file not found', async () => {
    mockListFiles.mockResolvedValue([]);
    const result = await resolveArtifactFilename('/project', config, 'epic', 'EPIC-999');
    expect(result).toBe('EPIC-999');
  });
});

describe('addChildReference', () => {
  it('replaces placeholder with child link', async () => {
    const parentContent = `# Epic

## Features
_No features created yet. Run \`planr feature create\` to generate._
`;
    // readArtifactRaw for parent
    mockListFiles.mockResolvedValueOnce(['EPIC-001-test.md']); // readArtifactRaw -> listFiles
    mockReadFile.mockResolvedValueOnce(parentContent); // readArtifactRaw -> readFile
    // resolveArtifactFilename for child
    mockListFiles.mockResolvedValueOnce(['FEAT-001-my-feature.md']);
    // updateArtifact -> listFiles
    mockListFiles.mockResolvedValueOnce(['EPIC-001-test.md']);

    await addChildReference(
      '/project',
      config,
      'epic',
      'EPIC-001',
      'feature',
      'FEAT-001',
      'My Feature',
    );

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('- [FEAT-001: My Feature](../features/FEAT-001-my-feature.md)'),
    );
    // Placeholder should be gone
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.stringContaining('_No features created yet'),
    );
  });

  it('does nothing when parent not found', async () => {
    mockListFiles.mockResolvedValueOnce([]); // readArtifactRaw finds nothing
    await addChildReference('/project', config, 'epic', 'EPIC-999', 'feature', 'FEAT-001', 'Test');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
