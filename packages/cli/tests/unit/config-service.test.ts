import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyConfigRepair,
  createDefaultConfig,
  loadConfig,
  planConfigRepair,
  saveConfig,
} from '../../src/services/config-service.js';

vi.mock('../../src/utils/fs.js', () => ({
  fileExists: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('../../src/services/git-service.js', () => ({
  firstAddedDate: vi.fn(),
}));

import { firstAddedDate } from '../../src/services/git-service.js';
import { fileExists, readFile, writeFile } from '../../src/utils/fs.js';

const mockFileExists = vi.mocked(fileExists);
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockFirstAddedDate = vi.mocked(firstAddedDate);

beforeEach(() => {
  vi.clearAllMocks();
});

const validConfig = {
  projectName: 'test-project',
  targets: ['cursor', 'claude'],
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
    await expect(loadConfig('/project')).rejects.toThrow('No .planr/config.json found');
  });

  it('throws on invalid JSON', async () => {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue('{ invalid json');
    await expect(loadConfig('/project')).rejects.toThrow();
  });

  it('names the missing fields and how to repair them, rather than throwing raw', async () => {
    mockFileExists.mockResolvedValue(true);
    // `targets` and `createdAt` are the two required fields with no default, so a
    // hand-edited or minimal config trips both.
    mockReadFile.mockResolvedValue(JSON.stringify({ projectName: 'test' }));

    // `.rejects.toThrow()` alone is what let a raw ZodError stack trace ship: it passes
    // for *any* throw. These assert the error is actionable, not merely present.
    await expect(loadConfig('/project')).rejects.toMatchObject({
      code: 'E_CONFIG_INVALID',
    });
    const error = await loadConfig('/project').catch((caught) => caught);
    // What failed, with what input, and why.
    expect(error.message).toContain('targets');
    expect(error.message).toContain('createdAt');
    // Relative, so the error boundary's absolute-path redaction cannot mask it as `<path>`.
    expect(error.message).toContain('.planr/config.json');
    expect(error.message).not.toContain('/project');
    // And how to fix it — surfaced by the CLI's top-level handler for `E_` codes.
    expect(error.fix).toContain('openplanr init --repair');
  });

  it('throws on invalid target value', async () => {
    mockFileExists.mockResolvedValue(true);
    const invalidConfig = { ...validConfig, targets: ['invalid-target'] };
    mockReadFile.mockResolvedValue(JSON.stringify(invalidConfig));
    await expect(loadConfig('/project')).rejects.toThrow();
  });
});

describe('loadConfig then saveConfig keeps unknown nested keys', () => {
  const teamId = 'team-1';
  it.each([
    ['outputPaths', { outputPaths: { ...validConfig.outputPaths, extra: 'x' } }],
    ['idPrefix', { idPrefix: { ...validConfig.idPrefix, extra: 'x' } }],
    ['reports', { reports: { orgName: 'Org', extra: 'x' } }],
    ['distribution', { distribution: { emailFrom: 'a@b.c', extra: 'x' } }],
    ['upgrade', { upgrade: { autoUpgrade: false, extra: 'x' } }],
    ['findings', { findings: { unattended: 'report', extra: 'x' } }],
    ['linear', { linear: { teamId, extra: 'x' } }],
    [
      'linear.teams[]',
      { linear: { teamId, teams: [{ id: teamId, key: 'T', name: 'T', extra: 'x' }] } },
    ],
    ['linear.typeLabels', { linear: { teamId, typeLabels: { task: 'Task', extra: 'x' } } }],
    ['reportLinter', { reportLinter: { rules: [], vaguePhrases: [], extra: 'x' } }],
    [
      'reportLinter.rules[]',
      { reportLinter: { rules: [{ id: 'r', enabled: true, extra: 'x' }], vaguePhrases: [] } },
    ],
    [
      'reportLinter.vaguePhrases[]',
      {
        reportLinter: {
          rules: [],
          vaguePhrases: [{ pattern: 'soon', alternatives: [], extra: 'x' }],
        },
      },
    ],
  ])('%s', async (_block, nested) => {
    const original = { ...validConfig, ...nested };
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(JSON.stringify(original));

    await saveConfig('/project', await loadConfig('/project'));

    const written = JSON.parse(String(mockWriteFile.mock.calls[0]?.[1]));
    expect(written).toMatchObject(original);
  });
});

describe('loadConfig report-linter phrase patterns', () => {
  async function loadWithPattern(pattern: string): Promise<unknown> {
    mockFileExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        ...validConfig,
        reportLinter: { rules: [], vaguePhrases: [{ pattern, alternatives: ['by Friday'] }] },
      }),
    );
    return loadConfig('/project').catch((caught: unknown) => caught);
  }

  it('rejects a pattern that is not a regular expression, citing the config path and the pattern', async () => {
    const error = await loadWithPattern('(unclosed');

    expect(error).toMatchObject({ name: 'ConfigInvalidError', code: 'E_CONFIG_INVALID' });
    expect((error as Error).message).toContain('.planr/config.json');
    expect((error as Error).message).toContain(
      'reportLinter.vaguePhrases.0.pattern: "(unclosed" is not a valid regular expression',
    );
  });

  it('rejects a pattern that can match empty text, citing the config path and the pattern', async () => {
    for (const pattern of ['(soon)?', 'x*', '\\b']) {
      const error = await loadWithPattern(pattern);

      expect(error).toMatchObject({ name: 'ConfigInvalidError', code: 'E_CONFIG_INVALID' });
      expect((error as Error).message).toContain('.planr/config.json');
      expect((error as Error).message).toContain(
        `reportLinter.vaguePhrases.0.pattern: ${JSON.stringify(pattern)} can match empty text`,
      );
    }
  });

  it('accepts a phrase pattern that always matches text', async () => {
    const config = await loadWithPattern('\\b(almost done|mostly done)\\b');

    expect(config).toMatchObject({
      reportLinter: { vaguePhrases: [{ alternatives: ['by Friday'] }] },
    });
  });
});

describe('planConfigRepair', () => {
  const legacyConfig = {
    projectName: 'legacy',
    outputPaths: { agile: 'docs/agile' },
    idPrefix: { spec: 'RFC' },
    customKey: { kept: true },
  };

  function project(files: string[], config: unknown): void {
    const present = new Set([
      join('/project', '.planr', 'config.json'),
      ...files.map((file) => join('/project', file)),
    ]);
    mockFileExists.mockImplementation(async (filePath) => present.has(filePath));
    mockReadFile.mockResolvedValue(typeof config === 'string' ? config : JSON.stringify(config));
  }

  it('adds only targets and createdAt, inferring targets from agent files and keeping every other key', async () => {
    project(['CLAUDE.md', 'AGENTS.md'], legacyConfig);
    mockFirstAddedDate.mockResolvedValue('2025-11-02');

    const plan = await planConfigRepair('/project');

    expect(plan).toMatchObject({
      status: 'repair',
      added: { targets: ['claude', 'codex'], createdAt: '2025-11-02' },
    });
    if (plan.status !== 'repair') throw new Error(`expected a repair plan, got ${plan.status}`);
    await applyConfigRepair('/project', plan);
    const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
    expect(written).toEqual({
      ...legacyConfig,
      targets: ['claude', 'codex'],
      createdAt: '2025-11-02',
    });
    expect(mockWriteFile.mock.calls[0][0]).toBe(join('/project', '.planr', 'config.json'));
  });

  it('previews each added field with its value and source, without writing', async () => {
    project(['.claude', '.cursor/rules'], legacyConfig);
    mockFirstAddedDate.mockResolvedValue(null);
    const today = new Date().toISOString().split('T')[0];

    const plan = await planConfigRepair('/project');

    expect(plan.status === 'repair' && plan.preview).toEqual([
      'targets: ["cursor","claude"] (from agent files in the project)',
      `createdAt: "${today}" (today; no git history for the config)`,
    ]);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('falls back to the init default targets and labels them as default', async () => {
    project([], legacyConfig);
    mockFirstAddedDate.mockResolvedValue('2025-11-02');

    const plan = await planConfigRepair('/project');

    expect(plan).toMatchObject({ added: { targets: ['cursor', 'claude', 'codex'] } });
    expect(plan.status === 'repair' && plan.preview[0]).toContain('default; no agent files found');
  });

  it('adds only the field that is missing', async () => {
    project(['AGENTS.md'], { ...legacyConfig, createdAt: '2024-01-01' });

    const plan = await planConfigRepair('/project');

    expect(plan).toMatchObject({ status: 'repair', added: { targets: ['codex'] } });
    expect(plan.status === 'repair' && plan.added).not.toHaveProperty('createdAt');
    expect(mockFirstAddedDate).not.toHaveBeenCalled();
  });

  it('reports a valid config as nothing to repair', async () => {
    project([], validConfig);
    expect(await planConfigRepair('/project')).toEqual({ status: 'valid' });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('fails with the not-initialized error when the config is missing', async () => {
    mockFileExists.mockResolvedValue(false);
    await expect(planConfigRepair('/project')).rejects.toMatchObject({
      name: 'ConfigNotFoundError',
    });
  });

  it('refuses unparseable JSON, naming the file', async () => {
    project([], '{ invalid json');
    const error = await planConfigRepair('/project').catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'E_CONFIG_INVALID' });
    expect((error as Error).message).toContain('.planr/config.json is not valid JSON');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('refuses issues in fields it does not add, naming them', async () => {
    project(['CLAUDE.md'], { ...validConfig, targets: ['invalid-target'] });
    const error = await planConfigRepair('/project').catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'E_CONFIG_INVALID' });
    expect((error as Error).message).toContain('targets');
    expect((error as { recovery?: string }).recovery).toContain('init --repair');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe('saveConfig', () => {
  it('writes pretty-printed JSON with trailing newline', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test passes partial config intentionally
    await saveConfig('/project', validConfig as any);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const writtenContent = mockWriteFile.mock.calls[0][1];
    expect(writtenContent).toContain('"projectName": "test-project"');
    expect(writtenContent.endsWith('\n')).toBe(true);
  });

  it('writes to correct path', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test passes partial config intentionally
    await saveConfig('/my-project', validConfig as any);
    const writtenPath = mockWriteFile.mock.calls[0][0];
    expect(writtenPath).toBe(join('/my-project', '.planr', 'config.json'));
  });
});

describe('createDefaultConfig', () => {
  it('returns a valid default config', () => {
    const config = createDefaultConfig('my-app');
    expect(config.projectName).toBe('my-app');
    expect(config.targets).toEqual(['cursor', 'claude', 'codex']);
    expect(config.outputPaths.agile).toBe('.planr');
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
