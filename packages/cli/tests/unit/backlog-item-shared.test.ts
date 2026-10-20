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
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const helpers = ['planr-ship', 'planr-investigate'].map((skill) =>
  path.join(repoRoot, 'skills', skill, 'scripts', 'backlog-item.mjs'),
);

const roots: string[] = [];
let printed: string[];

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
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    printed.push(args.map(String).join(' '));
  });
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
    writeFileSync(data, JSON.stringify(input));

    await cli(viaCli, 'backlog', 'add', '--data', data, '--json');
    const fromCli = JSON.parse(printed.find((line) => line.startsWith('{')) ?? '{}');
    const fromHelper = helper(file, viaHelper, 'add', '--data', data);

    expect(fromHelper).toMatchObject({
      ok: true,
      id: fromCli.id,
      artifactPath: fromCli.artifactPath,
    });
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
    expect(await listOpenBacklog(dir)).toEqual([
      {
        id: 'BL-001',
        title: 'Open item',
        status: 'open',
        path: '.planr/backlog/BL-001-open-item.md',
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
    expect(helper(helpers[1], dir, 'add', '--data', data).cliHint).toBeUndefined();
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
    expect(await listOpenBacklog(dir)).toEqual([
      { id: 'BL-001', title: 'Legacy', status: 'open', path: '.planr/backlog/BL-001-legacy.md' },
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
