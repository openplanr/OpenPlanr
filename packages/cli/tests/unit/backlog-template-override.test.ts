import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { afterEach, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { registerBacklogCommand } from '../../src/cli/commands/backlog.js';
import { createDefaultConfig, saveConfig } from '../../src/services/config-service.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('normalizes an empty block-list override without --files and lists without warnings', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'openplanr-backlog-template-empty-'));
  roots.push(dir);
  const override = path.join(dir, 'templates');
  mkdirSync(path.join(override, 'backlog'), { recursive: true });
  writeFileSync(
    path.join(override, 'backlog/backlog-item.md.hbs'),
    '---\nid: "{{id}}"\ntitle: "{{title}}"\npriority: "{{priority}}"\ntags: []\nstatus: "open"\ncreated: "{{date}}"\nupdated: "{{date}}"\nwhen: {{when}}\nfiles:\n{{#each files}}  - "{{this}}"\n{{/each}}---\nCustom body\n',
  );
  await saveConfig(dir, { ...createDefaultConfig('template'), templateOverrides: override });
  const printed: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) =>
    printed.push(args.map(String).join(' ')),
  );
  const program = new Command().exitOverride().option('--project-dir <path>');
  registerBacklogCommand(program);
  await program.parseAsync(['node', 'openplanr', '--project-dir', dir, 'backlog', 'add', 't one']);
  const raw = readFileSync(path.join(dir, '.planr/backlog/BL-001-t-one.md'), 'utf8');
  const metadata = YAML.parse(raw.split('---')[1]) as Record<string, unknown>;
  expect(metadata.files === undefined || Array.isArray(metadata.files)).toBe(true);
  expect(metadata).not.toHaveProperty('when');
  expect(raw).toContain('Custom body\n');
  printed.length = 0;
  await expect(
    program.parseAsync(['node', 'openplanr', '--project-dir', dir, 'backlog', 'list', '--json']),
  ).resolves.toBe(program);
  const result = JSON.parse(printed.join(''));
  expect(result).toMatchObject({ items: [{ id: 'BL-001', files: [] }], warnings: [] });
  expect(result.items[0]).not.toHaveProperty('when');
  const helper = fileURLToPath(new URL('../../lib/backlog-item.mjs', import.meta.url));
  const listed = spawnSync(process.execPath, [helper, 'list', '--project', dir, '--open'], {
    encoding: 'utf8',
  });
  expect(listed.status, listed.stderr).toBe(0);
  expect(JSON.parse(listed.stdout)).toEqual(result);
});

it.each(['omitted', 'rendered', 'block', 'blank', 'separated'])(
  'post-writes backlog metadata when the override has %s keys',
  async (mode) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'openplanr-backlog-template-'));
    roots.push(dir);
    const override = path.join(dir, 'templates');
    mkdirSync(path.join(override, 'backlog'), { recursive: true });
    const fields = {
      title: 'Custom',
      when: 'next-unit:#612',
      files: ['src/$1.ts', 'src/b.ts'],
      unverified: true,
    };
    writeFileSync(
      path.join(override, 'backlog/backlog-item.md.hbs'),
      '---\nid: "{{id}}"\ntitle: "{{title}}"\n' +
        {
          rendered: 'when: "old"\nfiles: ["old.ts"]\nunverified: false\n',
          block: 'files:\n  - "old.ts"\n  - "also-old.ts"\n',
          separated: 'files:\n  - "old.ts"\n\n# evidence paths\n  - "also-old.ts"\n',
          blank: 'when:\nowner: "kept"\n',
          omitted: '',
        }[mode] +
        '---\nCustom body: {{when}} / {{join files " | "}} / {{unverified}}\n',
    );
    await saveConfig(dir, { ...createDefaultConfig('template'), templateOverrides: override });
    const input = path.join(dir, 'input.json');
    writeFileSync(input, JSON.stringify(fields));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command().exitOverride().option('--project-dir <path>');
    registerBacklogCommand(program);
    await expect(
      program.parseAsync([
        'node',
        'openplanr',
        '--project-dir',
        dir,
        'backlog',
        'add',
        '--data',
        input,
      ]),
    ).resolves.toBe(program);
    const raw = readFileSync(path.join(dir, '.planr/backlog/BL-001-custom.md'), 'utf8');
    expect(YAML.parse(raw.split('---')[1])).toMatchObject(fields);
    if (mode === 'blank') expect(YAML.parse(raw.split('---')[1]).owner).toBe('kept');
    expect(raw).toContain('files: ["src/$1.ts", "src/b.ts"]');
    expect(raw).toContain('Custom body: next-unit:#612 / src/$1.ts | src/b.ts / true\n');
  },
);
