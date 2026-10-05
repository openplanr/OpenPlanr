import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBacklogCommand } from '../../src/cli/commands/backlog.js';
import type { OpenPlanrConfig } from '../../src/models/types.js';
import { updateArtifactFields } from '../../src/services/artifact-service.js';
import { createDefaultConfig, saveConfig } from '../../src/services/config-service.js';
import { ensureDir, writeFile } from '../../src/utils/fs.js';

function baseConfig(): OpenPlanrConfig {
  return {
    projectName: 'backlog-priority-sync',
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
      quick: 'QT',
      backlog: 'BL',
      sprint: 'SPRINT',
      spec: 'SPEC',
    },
    createdAt: '2026-04-23',
  };
}

let projectDir: string;
let backlogDir: string;
let printed: string[];

async function backlog(...args: string[]): Promise<void> {
  const program = new Command().exitOverride();
  program.option('--project-dir <path>');
  registerBacklogCommand(program);
  await program.parseAsync(['node', 'planr', '--project-dir', projectDir, 'backlog', ...args]);
}

/** Run `openplanr backlog add --json` and return the id it reports for `title`. */
async function add(title: string, ...extra: string[]): Promise<string> {
  await backlog('add', title, '--json', ...extra);
  const created = printed
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as { id: string; title: string })
    .find((result) => result.title === title);
  if (!created) throw new Error(`openplanr backlog add printed no result for "${title}"`);
  return created.id;
}

function readBacklogFile(id: string): string {
  const files = readdirSync(backlogDir);
  const file = files.find((name: string) => name.startsWith(`${id}-`));
  if (!file) throw new Error(`no backlog file for ${id} in ${backlogDir}`);
  return readFileSync(path.join(backlogDir, file), 'utf-8');
}

beforeEach(async () => {
  projectDir = mkdtempSync(path.join(tmpdir(), 'openplanr-backlog-priority-'));
  backlogDir = path.join(projectDir, '.planr', 'backlog');
  mkdirSync(backlogDir, { recursive: true });
  await saveConfig(projectDir, createDefaultConfig('backlog-priority'));
  printed = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    printed.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(projectDir, { recursive: true, force: true });
});

describe('backlog add --data priority is honored', () => {
  it('uses priority from --data JSON when --priority flag is absent', async () => {
    const dataFile = path.join(backlogDir, 'bl-data.json');
    writeFileSync(dataFile, JSON.stringify({ title: 'Data priority test', priority: 'low' }));

    const id = await add('Data priority test', '--data', dataFile);

    const raw = readBacklogFile(id);
    expect(raw).toContain('priority: "low"');
  });

  it('uses --priority flag when both --data and --priority are provided', async () => {
    const dataFile = path.join(backlogDir, 'bl-data-priority.json');
    writeFileSync(dataFile, JSON.stringify({ title: 'Flag wins', priority: 'low' }));

    const id = await add('Flag wins', '--data', dataFile, '--priority', 'high');

    const raw = readBacklogFile(id);
    expect(raw).toContain('priority: "high"');
  });

  it('falls back to medium when neither --data nor --priority provides a value', async () => {
    const dataFile = path.join(backlogDir, 'bl-no-priority.json');
    writeFileSync(dataFile, JSON.stringify({ title: 'Fallback to medium' }));

    const id = await add('Fallback to medium', '--data', dataFile);

    const raw = readBacklogFile(id);
    expect(raw).toContain('priority: "medium"');
  });
});

describe('backlog template has no body Priority section', () => {
  it('does not render ## Priority in the markdown body', async () => {
    const dataFile = path.join(backlogDir, 'bl-no-body-priority.json');
    writeFileSync(dataFile, JSON.stringify({ title: 'No body priority', priority: 'critical' }));

    const id = await add('No body priority', '--data', dataFile);

    const raw = readBacklogFile(id);
    expect(raw).not.toMatch(/^## Priority$/m);
  });
});

describe('update --priority syncs body Priority section', () => {
  let dir: string;
  const config = baseConfig();

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'planr-priority-sync-'));
    await ensureDir(path.join(dir, '.planr', 'backlog'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('updates the ## Priority body section when present', async () => {
    const blPath = path.join(dir, '.planr', 'backlog', 'BL-001-legacy-priority.md');
    await writeFile(
      blPath,
      [
        '---',
        'id: "BL-001"',
        'title: "Legacy priority item"',
        'priority: "medium"',
        'status: "open"',
        '---',
        '',
        '# BL-001: Legacy priority item',
        '',
        '## Priority',
        'MEDIUM',
        '',
        '## Description',
        'A legacy item with a body priority section.',
      ].join('\n'),
    );

    await updateArtifactFields(dir, config, 'backlog', 'BL-001', { priority: 'low' });

    const raw = readFileSync(blPath, 'utf-8');
    expect(raw).toContain('priority: "low"');
    expect(raw).toMatch(/^## Priority\s*\nLOW$/m);
    expect(raw).toContain('## Description');
    expect(raw).toContain('A legacy item with a body priority section.');
  });

  it('preserves following content when Priority value is absent', async () => {
    const blPath = path.join(dir, '.planr', 'backlog', 'BL-004-absent-value.md');
    await writeFile(
      blPath,
      [
        '---',
        'id: "BL-004"',
        'title: "Absent value item"',
        'priority: "medium"',
        'status: "open"',
        '---',
        '',
        '# BL-004: Absent value item',
        '',
        '## Priority',
        '',
        '## Description',
        'Follows a blank Priority value.',
      ].join('\n'),
    );

    await updateArtifactFields(dir, config, 'backlog', 'BL-004', { priority: 'high' });

    const raw = readFileSync(blPath, 'utf-8');
    expect(raw).toContain('priority: "high"');
    expect(raw).toMatch(/^## Priority$/m);
    expect(raw).toContain('## Description');
    expect(raw).toContain('Follows a blank Priority value.');
  });

  it('does not create a Priority section when it did not exist', async () => {
    const blPath = path.join(dir, '.planr', 'backlog', 'BL-002-new-template.md');
    await writeFile(
      blPath,
      [
        '---',
        'id: "BL-002"',
        'title: "New template item"',
        'priority: "medium"',
        'status: "open"',
        '---',
        '',
        '# BL-002: New template item',
        '',
        '## Description',
        'A new template item without a body priority section.',
      ].join('\n'),
    );

    await updateArtifactFields(dir, config, 'backlog', 'BL-002', { priority: 'high' });

    const raw = readFileSync(blPath, 'utf-8');
    expect(raw).toContain('priority: "high"');
    expect(raw).not.toMatch(/^## Priority$/m);
    expect(raw).toContain('## Description');
    expect(raw).toContain('A new template item without a body priority section.');
  });

  it('preserves other body content when updating priority', async () => {
    const blPath = path.join(dir, '.planr', 'backlog', 'BL-003-rich-body.md');
    await writeFile(
      blPath,
      [
        '---',
        'id: "BL-003"',
        'title: "Rich body item"',
        'priority: "high"',
        'status: "open"',
        'tags: ["bug", "cli"]',
        '---',
        '',
        '# BL-003: Rich body item',
        '',
        '## Priority',
        'HIGH',
        '',
        '## Tags',
        '',
        '- bug',
        '- cli',
        '',
        '## Description',
        'A rich body with tags and description.',
        '',
        '## Notes',
        'Important notes here.',
      ].join('\n'),
    );

    await updateArtifactFields(dir, config, 'backlog', 'BL-003', { priority: 'critical' });

    const raw = readFileSync(blPath, 'utf-8');
    expect(raw).toContain('priority: "critical"');
    expect(raw).toMatch(/^## Priority\s*\nCRITICAL$/m);
    expect(raw).toContain('## Tags');
    expect(raw).toContain('- bug');
    expect(raw).toContain('- cli');
    expect(raw).toContain('## Description');
    expect(raw).toContain('A rich body with tags and description.');
    expect(raw).toContain('## Notes');
    expect(raw).toContain('Important notes here.');
  });
});
