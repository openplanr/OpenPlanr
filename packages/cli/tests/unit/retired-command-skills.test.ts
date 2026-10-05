import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  diagnoseRetiredCommandSkills,
  pluginDocuments,
} from '../../src/services/runtime-manager/doctor.js';

const commandRoots = [
  ...new Set(
    (
      JSON.parse(
        readFileSync(resolve('../../docs/generated/utility-command-catalog.json'), 'utf8'),
      ) as { active: Array<{ path: string }> }
    ).active.map(({ path }) => path.split(' ')[0]),
  ),
];
const directories: string[] = [];

function block(content: Buffer, marker = 'runtime'): Buffer {
  const text = content.toString('utf8');
  const start = text.indexOf(`<!-- ##planr-${marker}:begin##`);
  const end = text.indexOf(`<!-- ##planr-${marker}:end## -->`);
  return Buffer.from(start === -1 || end === -1 ? '' : text.slice(start, end));
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function folder(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-retired-command-'));
  directories.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

describe('installed skills that still run planr', () => {
  it('warns and names the setup command for each affected host', () => {
    const root = folder({
      'codex/SKILL.md': 'Run `planr status --json` before planning.\n',
      'cursor/planr-status.mdc': 'Run `openplanr status --json`; the skill is `/planr:status`.\n',
    });
    expect(
      diagnoseRetiredCommandSkills(
        [
          { runtime: 'codex', target: join(root, 'codex/SKILL.md') },
          { runtime: 'cursor', target: join(root, 'cursor/planr-status.mdc') },
        ],
        commandRoots,
        block,
      ),
    ).toEqual({
      code: 'installed-skill-commands',
      status: 'warn',
      message: '1 installed skill or rule file(s) still tell the agent to run planr',
      fix: 'Rerun `openplanr setup --runtime codex`, or update the plugin, then restart the agent.',
    });
  });

  it('passes for current skills and says nothing when no skills are installed', () => {
    const root = folder({
      'SKILL.md':
        'Use `openplanr artifact open <file>` or `$planr:artifact`; planr-artifact is the skill ID.\n',
    });
    const current = [{ runtime: 'claude-code', target: join(root, 'SKILL.md') }];
    expect(diagnoseRetiredCommandSkills(current, commandRoots, block)?.status).toBe('pass');
    expect(diagnoseRetiredCommandSkills([], commandRoots, block)).toBeNull();
    expect(diagnoseRetiredCommandSkills(current, [], block)).toBeNull();
  });

  it('reads only the managed block of a shared instruction file', () => {
    const root = folder({
      'CLAUDE.md': [
        'My notes: run `planr status` before standup.',
        '<!-- ##planr-runtime:begin## -->',
        'Run `openplanr status --json`.',
        '<!-- ##planr-runtime:end## -->',
        '',
      ].join('\n'),
      'AGENTS.md': [
        '<!-- ##planr-runtime:begin## -->',
        'Run `planr status --json`.',
        '<!-- ##planr-runtime:end## -->',
        '',
      ].join('\n'),
    });
    const shared = (file: string) => ({
      runtime: 'codex',
      target: join(root, file),
      kind: 'managed-block' as const,
      marker: 'runtime',
    });
    expect(diagnoseRetiredCommandSkills([shared('CLAUDE.md')], commandRoots, block)?.status).toBe(
      'pass',
    );
    expect(diagnoseRetiredCommandSkills([shared('AGENTS.md')], commandRoots, block)?.status).toBe(
      'warn',
    );
  });

  it('reads every Markdown document in an installed plugin folder', () => {
    const root = folder({
      'skills/status/SKILL.md': 'Overview.\n',
      'skills/status/references/steps.md': '```bash\nplanr status --json\n```\n',
      '.claude-plugin/plugin.json': '{}\n',
    });
    const documents = pluginDocuments('claude-code', root);
    expect(documents.map(({ target }) => target).sort()).toEqual([
      join(root, 'skills/status/SKILL.md'),
      join(root, 'skills/status/references/steps.md'),
    ]);
    expect(diagnoseRetiredCommandSkills(documents, commandRoots, block)?.fix).toBe(
      'Rerun `openplanr setup --runtime claude`, or update the plugin, then restart the agent.',
    );
  });

  it('finds no planr commands in the skills this CLI installs', () => {
    const hostPackages = resolve('lib/host-packages');
    const documents = readdirSync(hostPackages, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => pluginDocuments(entry.name, join(hostPackages, entry.name)));
    expect(documents.length).toBeGreaterThan(0);
    expect(diagnoseRetiredCommandSkills(documents, commandRoots, block)?.status).toBe('pass');
  });
});
