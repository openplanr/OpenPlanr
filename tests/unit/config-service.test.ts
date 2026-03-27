import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig, saveConfig, createDefaultConfig } from '../../src/services/config-service.js';

vi.mock('../../src/utils/fs.js', () => ({
  fileExists: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

import { fileExists, readFile, writeFile } from '../../src/utils/fs.js';
const mockFileExists = vi.mocked(fileExists);
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);

beforeEach(() => {
  vi.clearAllMocks();
});

const validConfig = {
  projectName: 'test-project',
  targets: ['cursor', 'claude'],
  outputPaths: {
    agile: 'docs/agile',
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

describe('loadConfig', () => {
  it('loads and validates a valid config', async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(JSON.stringify(validConfig));

    const result = await loadConfig('/project');
    expect(result.projectName).toBe('test-project');
    expect(result.targets).toEqual(['cursor', 'claude']);
  });

  it('throws when config file does not exist', async () => {
    mockFileExists.mockResolvedValue(false);
    await expect(loadConfig('/project')).rejects.toThrow('No planr.config.json found');
  });

  it('throws on invalid JSON', async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue('{ invalid json');
    await expect(loadConfig('/project')).rejects.toThrow();
  });

  it('throws on schema-invalid config (missing required field)', async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(JSON.stringify({ projectName: 'test' }));
    await expect(loadConfig('/project')).rejects.toThrow();
  });

  it('throws on invalid target value', async () => {
    mockFileExists.mockResolvedValue(true);
    const invalidConfig = { ...validConfig, targets: ['invalid-target'] };
    mockReadFile.mockResolvedValue(JSON.stringify(invalidConfig));
    await expect(loadConfig('/project')).rejects.toThrow();
  });
});

describe('saveConfig', () => {
  it('writes pretty-printed JSON with trailing newline', async () => {
    await saveConfig('/project', validConfig as any);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const writtenContent = mockWriteFile.mock.calls[0][1];
    expect(writtenContent).toContain('"projectName": "test-project"');
    expect(writtenContent.endsWith('\n')).toBe(true);
  });

  it('writes to correct path', async () => {
    await saveConfig('/my-project', validConfig as any);
    const writtenPath = mockWriteFile.mock.calls[0][0];
    expect(writtenPath).toContain('/my-project');
    expect(writtenPath).toContain('planr.config.json');
  });
});

describe('createDefaultConfig', () => {
  it('returns a valid default config', () => {
    const config = createDefaultConfig('my-app');
    expect(config.projectName).toBe('my-app');
    expect(config.targets).toEqual(['cursor', 'claude', 'codex']);
    expect(config.outputPaths.agile).toBe('docs/agile');
    expect(config.idPrefix.epic).toBe('EPIC');
    expect(config.idPrefix.feature).toBe('FEAT');
    expect(config.idPrefix.story).toBe('US');
    expect(config.idPrefix.task).toBe('TASK');
  });

  it('sets createdAt to today', () => {
    const config = createDefaultConfig('test');
    const today = new Date().toISOString().split('T')[0];
    expect(config.createdAt).toBe(today);
  });

  it('does not include optional fields', () => {
    const config = createDefaultConfig('test');
    expect(config.ai).toBeUndefined();
    expect(config.defaultAgent).toBeUndefined();
    expect(config.templateOverrides).toBeUndefined();
    expect(config.author).toBeUndefined();
  });
});
