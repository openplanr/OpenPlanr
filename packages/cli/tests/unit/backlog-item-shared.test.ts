import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as backlog from '../../lib/backlog-item.mjs';
import {
  backlogFields,
  CLI_HINT,
  listOpenBacklog,
  renderBacklogItem,
} from '../../lib/backlog-item.mjs';
import { registerBacklogCommand } from '../../src/cli/commands/backlog.js';
import { registerConfigCommand } from '../../src/cli/commands/config-deterministic.js';
import { toCliFailureEnvelope } from '../../src/cli/error-boundary.js';
import { createDefaultConfig, loadConfig, saveConfig } from '../../src/services/config-service.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const helpers = [path.join(repoRoot, 'packages', 'cli', 'lib', 'backlog-item.mjs')];

const roots: string[] = [];
let printed: string[];
let warningsPrinted: string[];

function project(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'openplanr-backlog-shared-'));
  roots.push(dir);
  return dir;
}

async function initProject(dir: string): Promise<void> {
  mkdirSync(path.join(dir, '.planr', 'backlog'), { recursive: true });
  await saveConfig(dir, createDefaultConfig('backlog-shared'));
}

async function cli(dir: string, ...args: string[]): Promise<void> {
  const program = new Command().exitOverride();
  program.option('--project-dir <path>');
  registerBacklogCommand(program);
  registerConfigCommand(program);
  await program.parseAsync(['node', 'openplanr', '--project-dir', dir, ...args]);
}

function helper(file: string, dir: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [file, ...args, '--project', dir], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`helper ${args.join(' ')} failed: ${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function backlogFile(dir: string, id: string): string {
  const backlogDir = path.join(dir, '.planr', 'backlog');
  const name = readdirSync(backlogDir).find((entry) => entry.startsWith(`${id}-`));
  if (!name) throw new Error(`no backlog file for ${id} in ${backlogDir}`);
  return readFileSync(path.join(backlogDir, name), 'utf8');
}

const input = {
  title: 'README states 100 requests a minute; the code enforces "60"',
  priority: 'low',
  tags: ['docs', 'api'],
  description: '## Problem\n\nThe README and the limiter disagree.',
  acceptanceCriteria: ['README states 60', 'A docs test pins the value'],
};

beforeEach(() => {
  printed = [];
  warningsPrinted = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    printed.push(args.map(String).join(' '));
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    warningsPrinted.push(String(chunk));
    return true;
  });
});

describe.each(['cli', 'helper'])('backlog read warnings through %s', (surface) => {
  const itemPath = '.planr/backlog/BL-001-candidate.md';

  async function fixture(fields: Record<string, string | null>): Promise<string> {
    const dir = project();
    await initProject(dir);
    let raw = renderBacklogItem('BL-001', backlogFields({ title: 'Candidate' }), '2026-11-08');
    for (const [field, value] of Object.entries(fields)) {
      const pattern = new RegExp(`^${field}:.*\\n`, 'm');
      const replacement = value === null ? '' : `${field}: ${value}\n`;
      raw = pattern.test(raw)
        ? raw.replace(pattern, () => replacement)
        : raw.replace('---\n', `---\n${replacement}`);
    }
    writeFileSync(path.join(dir, itemPath), raw);
    writeFileSync(
      path.join(dir, '.planr/backlog/BL-002-healthy.md'),
      renderBacklogItem('BL-002', backlogFields({ title: 'Healthy' }), '2026-11-08'),
    );
    return dir;
  }

  async function list(dir: string, ...flags: string[]) {
    let raw: string;
    if (surface === 'cli') {
      printed = [];
      await expect(
        cli(dir, 'backlog', 'list', '--open', '--json', ...flags),
      ).resolves.toBeUndefined();
      raw = printed.join('');
      expect(warningsPrinted).toEqual([]);
    } else {
      const result = spawnSync(
        process.execPath,
        [helpers[0], 'list', '--project', dir, '--open', ...flags],
        { encoding: 'utf8' },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe('');
      raw = result.stdout;
    }
    return JSON.parse(raw) as {
      items: backlog.OpenBacklogItem[];
      warnings: { path: string; field: string; value: string; message: string }[];
    };
  }

  it('reads block files with comments and leaves unrelated YAML alone', async () => {
    const dir = await fixture({
      files: '\n  - "src/a.ts"\n\n  # second path\n  - \'src/b.ts\'',
      tracker: '[not valid YAML',
    });
    const result = await list(dir);
    expect(result.items.map(({ files }) => files)).toEqual([['src/a.ts', 'src/b.ts'], []]);
    expect(result.warnings).toEqual([]);
  });

  it('lists a file without frontmatter using filename and status fallbacks', async () => {
    const dir = project();
    await initProject(dir);
    const itemPath = '.planr/backlog/BL-413-extension.md';
    writeFileSync(path.join(dir, itemPath), '\n## Extension notes\n\nKeep the extension notes.\n');
    const result = await list(dir);
    expect(result.items).toEqual([
      { id: 'BL-413', title: 'extension', status: 'open', path: itemPath, files: [] },
    ]);
    expect(result.warnings).toEqual(
      ['id', 'title', 'status', 'priority', 'tags', 'created', 'updated'].map((field) => ({
        path: itemPath,
        field,
        value: 'missing',
        message: expect.any(String),
      })),
    );
    for (const warning of result.warnings) {
      expect(warning.message).toContain(itemPath);
      expect(warning.message).toContain(warning.field);
      expect(warning.message).toContain('missing');
      expect(warning.message).not.toContain('skipping item');
    }
  });

  it.each([
    ['id', '[BL-001]', 'BL-001'],
    ['id', 'invalid', 'BL-001'],
    ['id', 'null', 'BL-001'],
    ['id', 'BL-2', 'BL-001'],
    ['title', '[WIP] b', 'candidate'],
    ['title', '100', 'candidate'],
    ['title', '>\n  Folded title', 'candidate'],
    ['title', '"unterminated', 'candidate'],
    ['status', 'true', 'open'],
    ['status', 'null', 'open'],
    ['status', '5', 'open'],
  ])('falls back for unreadable %s = %s with a warning', async (field, value, fallback) => {
    const dir = await fixture({ [field]: value });
    const result = await list(dir);
    expect(result.items.map(({ id }) => id)).toEqual(['BL-001', 'BL-002']);
    expect(result.items[0]).toMatchObject({ [field]: fallback });
    expect(result.warnings).toEqual([
      { path: itemPath, field, value, message: expect.any(String) },
    ]);
    expect(result.warnings[0].message).toContain(itemPath);
    expect(result.warnings[0].message).toContain(field);
    expect(result.warnings[0].message).toContain(JSON.stringify(value));
    expect(result.warnings[0].message).not.toContain('skipping item');
  });

  it.each([
    ['id', 'BL-001'],
    ['title', 'candidate'],
    ['status', 'open'],
  ])('falls back for missing %s with a warning', async (field, fallback) => {
    const dir = await fixture({ [field]: null });
    const result = await list(dir);
    expect(result.items.map(({ id }) => id)).toEqual(['BL-001', 'BL-002']);
    expect(result.items[0]).toMatchObject({ [field]: fallback });
    expect(result.warnings).toEqual([
      { path: itemPath, field, value: 'missing', message: expect.any(String) },
    ]);
    expect(result.warnings[0].message).not.toContain('skipping item');
  });

  it.each([
    ['files', '["src/a.ts:41"]'],
    ['files', '["../a.ts"]'],
    ['files', '["/tmp/a.ts"]'],
    ['files', '["src/a.ts", "src/a.ts"]'],
    ['files', '[1]'],
    ['files', '["unterminated"'],
    ['files', '\n  - 1'],
    ['when', '"now"'],
    ['when', '["sprint:next"]'],
  ])('skips unreadable %s = %s while listing healthy items', async (field, value) => {
    const dir = await fixture({ [field]: value });
    const result = await list(dir);
    expect(result.items.map(({ id }) => id)).toEqual(['BL-002']);
    expect(result.warnings).toEqual([
      { path: itemPath, field, value: value?.trim() ?? 'missing', message: expect.any(String) },
    ]);
    expect(result.warnings[0].message).toContain('skipping item');
    expect(result.items[0]).not.toHaveProperty('when');
  });

  it.each([
    ['priority', '"highest"'],
    ['priority', null],
    ['tags', '[1]'],
    ['tags', '["unterminated"'],
    ['tags', null],
    ['updated', null],
    ['created', '"2026-02-30"'],
    ['epicId', '[EPIC-001]'],
    ['unverified', 'false'],
  ])('warns about %s = %s without hiding the item', async (field, value) => {
    const dir = await fixture({ [field]: value });
    const result = await list(dir);
    expect(result.items.map(({ id }) => id)).toEqual(['BL-001', 'BL-002']);
    expect(result.warnings).toEqual([
      { path: itemPath, field, value: value ?? 'missing', message: expect.any(String) },
    ]);
  });

  it('reports every missing schema field and keeps the item', async () => {
    const dir = await fixture({ tags: null, updated: null });
    const result = await list(dir);
    expect(result.items.map(({ id }) => id)).toEqual(['BL-001', 'BL-002']);
    expect(result.warnings).toEqual([
      { path: itemPath, field: 'tags', value: 'missing', message: expect.any(String) },
      { path: itemPath, field: 'updated', value: 'missing', message: expect.any(String) },
    ]);
  });

  it.each(['', '""'])('treats blank when %s as absent under --no-when', async (when) => {
    const dir = await fixture({ when });
    const result = await list(dir, '--no-when');
    expect(result.items.map(({ id }) => id)).toEqual(['BL-001', 'BL-002']);
    for (const item of result.items) expect(item).not.toHaveProperty('when');
    expect(result.warnings).toEqual([]);
  });

  it('treats empty files as absent and still derives body evidence', async () => {
    const dir = await fixture({ files: '' });
    writeFileSync(
      path.join(dir, itemPath),
      `${readFileSync(path.join(dir, itemPath), 'utf8')}\nEvidence: src/a.ts:41\n`,
    );
    const result = await list(dir);
    expect(result.items[0].files).toEqual(['src/a.ts']);
    expect(result.warnings).toEqual([]);
  });
});

it('prints backlog warnings only on stderr in text mode', async () => {
  const dir = project();
  await initProject(dir);
  const raw = renderBacklogItem('BL-001', backlogFields({ title: 'Visible' }), '2026-11-08');
  writeFileSync(
    path.join(dir, '.planr/backlog/BL-001-visible.md'),
    raw.replace('"medium"', '"highest"'),
  );
  await cli(dir, 'backlog', 'list');
  expect(printed).toEqual(['BL-001\tVisible']);
  expect(warningsPrinted).toHaveLength(1);
  expect(warningsPrinted[0]).toContain('.planr/backlog/BL-001-visible.md');
  expect(warningsPrinted[0]).toContain('priority');
  expect(warningsPrinted[0]).toContain('highest');
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('shared backlog item writer', () => {
  it('renders an acceptance criteria array as one list item per criterion', () => {
    const text = renderBacklogItem('BL-001', backlogFields(input), '2026-10-18');
    expect(text).toContain(
      '## Acceptance Criteria\n- README states 60\n- A docs test pins the value\n',
    );
    expect(text).toContain(
      'title: "README states 100 requests a minute; the code enforces \\"60\\""',
    );
  });

  it('keeps a description that has its own sections out from under a Description heading', () => {
    const text = renderBacklogItem('BL-001', backlogFields(input), '2026-10-18');
    expect(text).toContain(
      '## Tags\n\n- docs\n- api\n\n## Problem\n\nThe README and the limiter disagree.\n',
    );
    expect(text).not.toContain('## Description');
  });

  it.each(helpers)('the CLI and %s write identical files for the same input', async (file) => {
    const viaCli = project();
    const viaHelper = project();
    await initProject(viaCli);
    await initProject(viaHelper);
    const data = path.join(viaCli, 'input.json');
    writeFileSync(
      data,
      JSON.stringify({
        ...input,
        when: 'next-unit:#612',
        files: ['src/a.ts', 'src/b.ts'],
        unverified: true,
      }),
    );

    await cli(viaCli, 'backlog', 'add', '--data', data, '--json');
    const fromCli = JSON.parse(printed.find((line) => line.startsWith('{')) ?? '{}');
    const fromHelper = helper(file, viaHelper, 'add', '--data', data);

    expect(fromHelper).toMatchObject({
      ok: true,
      id: fromCli.id,
      artifactPath: fromCli.artifactPath,
    });
    expect(backlogFile(viaCli, fromCli.id)).toContain('when: "next-unit:#612"');
    expect(backlogFile(viaHelper, fromHelper.id as string)).toBe(backlogFile(viaCli, fromCli.id));
  });

  it('never reissues the ID of a removed item', () => {
    const dir = project();
    mkdirSync(path.join(dir, '.planr', 'backlog'), { recursive: true });
    writeFileSync(path.join(dir, '.planr', 'config.json'), '{}\n');
    const data = path.join(dir, 'input.json');
    writeFileSync(data, JSON.stringify({ title: 'First' }));
    const first = helper(helpers[0], dir, 'add', '--data', data);
    unlinkSync(path.join(dir, first.artifactPath as string));
    const second = helper(helpers[0], dir, 'add', '--data', data);
    expect(first.id).toBe('BL-001');
    expect(second.id).toBe('BL-002');
  });

  it('lists only open items with repo-relative paths', async () => {
    const dir = project();
    await initProject(dir);
    await cli(dir, 'backlog', 'add', 'Open item', '--json');
    await cli(dir, 'backlog', 'add', 'Closed item', '--json');
    await cli(dir, 'backlog', 'update', 'BL-002', '--status', 'closed');
    expect((await listOpenBacklog(dir)).items).toEqual([
      {
        id: 'BL-001',
        title: 'Open item',
        status: 'open',
        path: '.planr/backlog/BL-001-open-item.md',
        files: [],
      },
    ]);
  });

  it('shows the CLI install hint once per project and keeps the config indentation', () => {
    const dir = project();
    mkdirSync(path.join(dir, '.planr', 'backlog'), { recursive: true });
    writeFileSync(path.join(dir, '.planr', 'config.json'), '{\n\t"projectName": "tabs"\n}\n');
    const data = path.join(dir, 'input.json');
    writeFileSync(data, JSON.stringify({ title: 'Hinted' }));

    expect(helper(helpers[0], dir, 'add', '--data', data).cliHint).toBe(CLI_HINT);
    expect(helper(helpers[0], dir, 'add', '--data', data).cliHint).toBeUndefined();
    expect(readFileSync(path.join(dir, '.planr', 'config.json'), 'utf8')).toBe(
      '{\n\t"projectName": "tabs",\n\t"findings": {\n\t\t"cliHintShown": true\n\t}\n}\n',
    );
  });

  it('never shows the install hint when the CLI files the item', async () => {
    const dir = project();
    await initProject(dir);
    await cli(dir, 'backlog', 'add', 'Via the CLI', '--json');
    expect(printed.join('\n')).not.toContain('npm install -g openplanr');
    expect((await loadConfig(dir)).findings).toBeUndefined();
  });
});

describe('backlog filing procedure', () => {
  const procedure = readFileSync(
    path.join(repoRoot, 'skills', 'shared', 'backlog-filing.md'),
    'utf8',
  );

  it('documents the exact file the CLI writes for the same item', () => {
    const example = /```markdown\n([\s\S]*?)```/u.exec(procedure)?.[1];
    expect(example).toBeDefined();
    const fields = backlogFields({
      title: 'Import endpoint has no rate limit',
      priority: 'medium',
      tags: ['security', 'api'],
      when: 'next-unit:#612',
      files: ['src/routes/import.ts'],
      description:
        '## Problem\n\n`/import` accepts unlimited requests (`src/routes/import.ts:41`).',
    });
    expect(example).toContain('when: "next-unit:#612"');
    expect(example).toBe(renderBacklogItem('BL-007', fields, '2026-11-08'));
  });

  it('takes the ID after both a file and an issued marker, and the item lists as open', async () => {
    const dir = project();
    const backlog = path.join(dir, '.planr', 'backlog');
    mkdirSync(path.join(backlog, '.issued-ids'), { recursive: true });
    writeFileSync(path.join(dir, '.planr', 'config.json'), '{}\n');
    writeFileSync(
      path.join(backlog, 'BL-004-existing.md'),
      renderBacklogItem('BL-004', backlogFields({ title: 'Existing' }), '2026-11-01'),
    );
    writeFileSync(path.join(backlog, '.issued-ids', 'BL-006'), '');
    const data = path.join(dir, 'input.json');
    writeFileSync(data, JSON.stringify({ title: 'New item' }));
    expect(helper(helpers[0], dir, 'add', '--data', data).id).toBe('BL-007');
    expect((await listOpenBacklog(dir)).items.map(({ id }) => id)).toEqual(['BL-004', 'BL-007']);
  });
});

describe('backlog priority', () => {
  const rejection =
    'Backlog priority "highest" is not valid; use one of critical, high, medium, low.';

  const invalid = { code: 'E_BACKLOG_INVALID', message: rejection };

  it('rejects a priority outside the four accepted values with an input code, naming it', () => {
    expect(() => backlogFields({ title: 'Item', priority: 'highest' })).toThrow(
      expect.objectContaining(invalid),
    );
    expect(backlogFields({ title: 'Item' }).priority).toBe('medium');
  });

  it('reports bad input through the CLI boundary as an input error, not a crash', () => {
    for (const [input, problem] of [
      [{ title: 'Item', priority: 'highest' }, rejection],
      [{ title: ' ' }, 'A backlog item needs a non-empty title.'],
    ] as const) {
      const error = (() => {
        try {
          backlogFields(input);
        } catch (caught) {
          return caught;
        }
        throw new Error(`backlogFields accepted ${JSON.stringify(input)}`);
      })();
      expect(toCliFailureEnvelope(error)).toMatchObject({ code: 'E_BACKLOG_INVALID', problem });
    }
  });

  it('rejects an empty title from the CLI as an input error', async () => {
    const dir = project();
    await initProject(dir);
    const data = path.join(dir, 'input.json');
    writeFileSync(data, JSON.stringify({ title: '  ' }));
    const error = await cli(dir, 'backlog', 'add', '--data', data, '--json').catch(
      (caught: unknown) => caught,
    );
    expect(toCliFailureEnvelope(error)).toMatchObject({ code: 'E_PLANNING_INPUT_REQUIRED' });
  });

  it('rejects the same value from --priority and from --data without writing a file', async () => {
    const dir = project();
    await initProject(dir);
    await expect(
      cli(dir, 'backlog', 'add', 'Item', '--priority', 'highest', '--json'),
    ).rejects.toMatchObject(invalid);
    const data = path.join(dir, 'input.json');
    writeFileSync(data, JSON.stringify({ title: 'Item', priority: 'highest' }));
    await expect(cli(dir, 'backlog', 'add', '--data', data, '--json')).rejects.toMatchObject(
      invalid,
    );
    expect(readdirSync(path.join(dir, '.planr', 'backlog'))).toEqual([]);
  });

  it.each(helpers)('%s rejects it too', async (file) => {
    const dir = project();
    await initProject(dir);
    const data = path.join(dir, 'input.json');
    writeFileSync(data, JSON.stringify({ title: 'Item', priority: 'highest' }));
    const result = spawnSync(process.execPath, [file, 'add', '--data', data, '--project', dir], {
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(rejection);
  });

  it('still lists an existing item whose priority predates the check', async () => {
    const dir = project();
    await initProject(dir);
    writeFileSync(
      path.join(dir, '.planr', 'backlog', 'BL-001-legacy.md'),
      '---\nid: "BL-001"\ntitle: "Legacy"\npriority: "highest"\ntags: []\nstatus: "open"\ncreated: "2026-01-01"\nupdated: "2026-01-01"\n---\n\n# BL-001: Legacy\n',
    );
    expect((await listOpenBacklog(dir)).items).toEqual([
      {
        id: 'BL-001',
        title: 'Legacy',
        status: 'open',
        path: '.planr/backlog/BL-001-legacy.md',
        files: [],
      },
    ]);
    await cli(dir, 'backlog', 'list');
    expect(printed.join('\n')).toContain('BL-001\tLegacy');
  });
});

describe('findings config', () => {
  it('keeps findings.unattended and unknown keys through a config write', async () => {
    const dir = project();
    await initProject(dir);
    const configPath = path.join(dir, '.planr', 'config.json');
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    writeFileSync(
      configPath,
      JSON.stringify({ ...raw, findings: { unattended: 'file' }, teamNote: 'kept' }),
    );

    await cli(dir, 'config', 'set-agent', 'codex');

    const saved = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(saved).toMatchObject({
      defaultAgent: 'codex',
      findings: { unattended: 'file' },
      teamNote: 'kept',
    });
  });

  it('rejects an unknown unattended value and names the field', async () => {
    const dir = project();
    await initProject(dir);
    const configPath = path.join(dir, '.planr', 'config.json');
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    writeFileSync(configPath, JSON.stringify({ ...raw, findings: { unattended: 'always' } }));
    await expect(loadConfig(dir)).rejects.toThrow(/findings/);
  });
});

describe('backlog list and created output', () => {
  it('preserves unflagged list output, all statuses, numeric order, and the empty message', async () => {
    const dir = project();
    await initProject(dir);
    await cli(dir, 'backlog', 'list');
    expect(printed.map(stripVTControlCharacters)).toEqual(['ℹ No backlog artifacts found.']);
    for (const [id, title, status] of [
      ['BL-010', '"Last item"', 'done'],
      ['BL-002', "'Owner''s closed item'", 'closed'],
      ['BL-001', '"First item"', 'open'],
    ]) {
      writeFileSync(
        path.join(dir, '.planr/backlog', `${id}-filename-title.md`),
        `---\nid: "${id}"\ntitle: ${title}\nstatus: "${status}"\n---\n`,
      );
    }
    printed = [];
    await cli(dir, 'backlog', 'list');
    expect(printed).toEqual([
      'BL-001\tFirst item',
      "BL-002\tOwner's closed item",
      'BL-010\tLast item',
    ]);
  });

  it('prints the frontmatter title and the relative created path', async () => {
    const dir = project();
    await initProject(dir);
    await cli(dir, 'backlog', 'add', 'Rate-limit the /export endpoint');
    await cli(dir, 'backlog', 'list');
    const output = printed.join('\n');
    expect(output).toContain('BL-001\tRate-limit the /export endpoint');
    expect(output).toContain('.planr/backlog/BL-001-rate-limit-the-export-endpoint.md');
    expect(output).not.toContain(dir);
  });
});

describe('backlog scheduling and files', () => {
  it('normalizes and validates files without constructing an item', () => {
    expect(backlog.normalizeBacklogFiles).toBeTypeOf('function');
    expect(backlog.normalizeBacklogFiles([' ./src/a.ts ', 'src\\b.ts', 'src/a.ts'])).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
    for (const value of ['src/a.ts', [12], ['../a.ts'], ['/a.ts'], ['src/a.ts:12']]) {
      expect(() => backlog.normalizeBacklogFiles(value)).toThrow(/files/);
    }
  });

  const fixtures = JSON.parse(
    readFileSync(path.join(repoRoot, 'tests/protocol/fixtures/backlog-when.json'), 'utf8'),
  ) as { value: string; valid: boolean }[];

  it.each(fixtures)('validates when $value ($valid)', ({ value, valid }) => {
    expect(backlog.parseWhen).toBeTypeOf('function');
    if (valid) {
      expect(backlog.parseWhen(value)).toEqual({
        kind: value.split(':')[0],
        value: value.slice(value.indexOf(':') + 1),
      });
      expect(backlogFields({ title: 'Item', when: value }).when).toBe(value);
    } else {
      expect(() => backlog.parseWhen(value)).toThrow(/when/);
      expect(() => backlogFields({ title: 'Item', when: value })).toThrow(/when/);
    }
  });

  it('adds metadata without changing old item bytes', () => {
    const original =
      '---\nid: "BL-001"\ntitle: "Item"\npriority: "medium"\ntags: []\nstatus: "open"\ncreated: "2026-11-08"\nupdated: "2026-11-08"\n---\n\n# BL-001: Item\n\n---\n_Close when done: `openplanr backlog update BL-001 --status closed`_\n';
    expect(renderBacklogItem('BL-001', backlogFields({ title: 'Item' }), '2026-11-08')).toBe(
      original,
    );
    const fields = backlogFields({
      title: 'Item',
      when: 'sprint:next',
      files: ['./src/a.ts', 'src/a.ts', 'src/b.ts'],
      unverified: true,
      epicId: 'EPIC-001',
    });
    expect(fields.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(renderBacklogItem('BL-001', fields, '2026-11-08')).toContain(
      'updated: "2026-11-08"\nwhen: "sprint:next"\nfiles: ["src/a.ts", "src/b.ts"]\nunverified: true\nepicId: "EPIC-001"',
    );
  });

  it.each([
    '../a.ts',
    'src/../a.ts',
    '/a.ts',
    'C:\\a.ts',
    'src/a.ts:12',
    'src/a.ts:12:3',
    'src/a.ts:12-20',
    '',
    12,
  ])('rejects invalid file %s', (file) => {
    expect(() => backlogFields({ title: 'Item', files: [file] })).toThrow(/files/);
  });

  it('rejects incorrectly typed metadata', () => {
    for (const fields of [{ when: true }, { files: 'a.ts' }, { unverified: false }]) {
      expect(() => backlogFields({ title: 'Item', ...fields })).toThrow(/when|files|unverified/);
    }
  });

  it('derives distinct files from old evidence and respects explicit empty files', async () => {
    const dir = project();
    await initProject(dir);
    const body =
      'Evidence: `./src/a.ts:12`, src/a.ts:15:2, (src/b.ts:3-8), `root.ts:1`. Ignore https://example.test:42 /tmp/out.ts:2 ../out.ts:3.';
    for (const [id, metadata] of [
      ['BL-001', ''],
      ['BL-002', 'files: []\n'],
    ] as const) {
      writeFileSync(
        path.join(dir, '.planr/backlog', `${id}-old.md`),
        `---\nid: "${id}"\ntitle: "Old"\ntags: [old, 'a,b', "quoted"]\n${metadata}---\n${body}\n`,
      );
    }
    const { items } = await listOpenBacklog(dir);
    expect(items.map(({ files }) => files)).toEqual([['src/a.ts', 'src/b.ts', 'root.ts'], []]);
  });

  it.each(['tags', 'files'])(
    'reports malformed %s arrays with the file path and key',
    async (key) => {
      const dir = project();
      await initProject(dir);
      const file = path.join(dir, '.planr/backlog/BL-001-invalid.md');
      for (const value of ['["missing bracket"', '[12]', '["a" "b"]']) {
        writeFileSync(file, `---\nid: "BL-001"\n${key}: ${value}\n---\n`);
        const { warnings } = await listOpenBacklog(dir);
        expect(warnings).toContainEqual({
          path: '.planr/backlog/BL-001-invalid.md',
          field: key,
          value,
          message: expect.any(String),
        });
      }
    },
  );

  it('writes flags, updates arrays, and filters identically to the helper', async () => {
    const dir = project();
    await initProject(dir);
    await expect(
      cli(
        dir,
        'backlog',
        'add',
        't',
        '--when',
        'next-unit:#612',
        '--files',
        'src/a.ts',
        'src/b.ts',
      ),
    ).resolves.toBeUndefined();
    expect(backlogFile(dir, 'BL-001')).toContain('files: ["src/a.ts", "src/b.ts"]');
    expect(backlogFile(dir, 'BL-001')).toContain('when: "next-unit:#612"');
    await cli(dir, 'backlog', 'add', 'Unscheduled', '--files', 'src/a.ts');
    await cli(dir, 'backlog', 'add', 'Closed', '--files', 'src/a.ts');
    await cli(dir, 'backlog', 'update', 'BL-003', '--status', 'closed');
    for (const flags of [
      [],
      ['--files', 'src/a.ts'],
      ['--no-when'],
      ['--files', 'src/a.ts', '--no-when'],
      ['--files', 'absent.ts'],
    ]) {
      printed = [];
      await cli(dir, 'backlog', 'list', '--open', ...flags, '--json');
      const fromCli = JSON.parse(printed.join(''));
      expect(fromCli).toEqual(helper(helpers[0], dir, 'list', '--open', ...flags));
      if (flags.includes('--no-when'))
        expect(fromCli.items.map((item: { id: string }) => item.id)).toEqual(['BL-002']);
      else if (flags.includes('absent.ts')) expect(fromCli.items).toEqual([]);
      else
        expect(fromCli.items.map((item: { id: string }) => item.id)).toEqual(['BL-001', 'BL-002']);
    }
    await cli(dir, 'backlog', 'update', 'BL-001', '--files', 'x.ts', 'y.ts');
    expect(backlogFile(dir, 'BL-001')).toContain('files: ["x.ts", "y.ts"]');
    await cli(dir, 'backlog', 'update', 'BL-002', '--when', 'sprint:next');
    expect(backlogFile(dir, 'BL-002')).toContain('when: "sprint:next"');
    expect((await listOpenBacklog(dir)).items[0].when).toBe('next-unit:#612');
    printed = [];
    await cli(dir, 'backlog', 'list', '--json');
    expect(JSON.parse(printed.join('')).items).toHaveLength(3);
  });

  it('rejects invalid update metadata without writing', async () => {
    const dir = project();
    await initProject(dir);
    await cli(dir, 'backlog', 'add', 'Item');
    const before = backlogFile(dir, 'BL-001');
    await expect(cli(dir, 'backlog', 'update', 'BL-001', '--when', 'now')).rejects.toMatchObject({
      code: 'E_BACKLOG_INVALID',
    });
    await expect(
      cli(dir, 'backlog', 'update', 'BL-001', '--files', '../bad.ts'),
    ).rejects.toMatchObject({ code: 'E_BACKLOG_INVALID' });
    expect(backlogFile(dir, 'BL-001')).toBe(before);
  });
});
