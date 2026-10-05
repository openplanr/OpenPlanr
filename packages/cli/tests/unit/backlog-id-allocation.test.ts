import { mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBacklogCommand } from '../../src/cli/commands/backlog.js';
import { createDefaultConfig, saveConfig } from '../../src/services/config-service.js';

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
async function add(title: string): Promise<string> {
  await backlog('add', title, '--json');
  const created = printed
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as { id: string; title: string })
    .find((result) => result.title === title);
  if (!created) throw new Error(`openplanr backlog add printed no result for "${title}"`);
  return created.id;
}

function remove(id: string): void {
  const file = readdirSync(backlogDir).find((name) => name.startsWith(`${id}-`));
  if (!file) throw new Error(`no backlog file for ${id} in ${backlogDir}`);
  unlinkSync(path.join(backlogDir, file));
}

beforeEach(async () => {
  projectDir = mkdtempSync(path.join(tmpdir(), 'openplanr-backlog-ids-'));
  backlogDir = path.join(projectDir, '.planr', 'backlog');
  mkdirSync(backlogDir, { recursive: true });
  await saveConfig(projectDir, createDefaultConfig('backlog-ids'));
  printed = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    printed.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(projectDir, { recursive: true, force: true });
});

describe('openplanr backlog add id allocation', () => {
  it('does not reissue the ids of removed items', async () => {
    expect([await add('one'), await add('two'), await add('three')]).toEqual([
      'BL-001',
      'BL-002',
      'BL-003',
    ]);
    remove('BL-002');
    remove('BL-003');

    await expect(add('four')).resolves.toBe('BL-004');
  });

  it('issues each id past 999 once and lists it', async () => {
    for (let n = 1; n <= 999; n++) {
      writeFileSync(path.join(backlogDir, `BL-${String(n).padStart(3, '0')}-seeded.md`), '');
    }

    await expect(add('thousandth')).resolves.toBe('BL-1000');
    await expect(add('after')).resolves.toBe('BL-1001');
    printed = [];
    await backlog('list');
    const listed = printed.map((line) => line.split('\t')[0]);
    expect(listed).toHaveLength(1001);
    expect(listed.slice(-3)).toEqual(['BL-999', 'BL-1000', 'BL-1001']);
  });

  it('gives two concurrent adds different ids', async () => {
    const ids = await Promise.all([add('first'), add('second')]);

    expect([...ids].sort()).toEqual(['BL-001', 'BL-002']);
    expect(readdirSync(backlogDir).filter((name) => name.endsWith('.md'))).toHaveLength(2);
  });
});
