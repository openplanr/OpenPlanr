import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/prompt-service.js', () => ({
  promptText: vi.fn(async () => 'A reusable pattern'),
  promptConfirm: vi.fn(async () => true),
}));

import { registerTemplateCommand } from '../../src/cli/commands/template.js';
import { createDefaultConfig, saveConfig } from '../../src/services/config-service.js';
import { promptText } from '../../src/services/prompt-service.js';

const TASK =
  '---\nid: "TASK-001"\ntitle: "Build"\n---\n# TASK-001: Build\n\n## Tasks\n\n- [ ] **1.0** Build it\n  - [ ] 1.1 Write code\n';

let root: string;
let projectDir: string;
let planningDir: string;
let templatesDir: string;
let outside: string;

async function createProject(planning: string): Promise<void> {
  mkdirSync(path.join(planning, 'tasks'), { recursive: true });
  writeFileSync(path.join(planning, 'tasks', 'TASK-001-build.md'), TASK);
  await saveConfig(projectDir, createDefaultConfig('template-names'));
}

async function run(...args: string[]): Promise<void> {
  const program = new Command().exitOverride();
  program.option('--project-dir <path>');
  registerTemplateCommand(program);
  await program.parseAsync(['node', 'planr', '--project-dir', projectDir, 'template', ...args]);
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'openplanr-template-names-'));
  projectDir = path.join(root, 'project');
  planningDir = path.join(projectDir, '.planr');
  templatesDir = path.join(planningDir, 'templates');
  outside = path.join(root, 'outside');
  mkdirSync(outside);
  await createProject(planningDir);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('planr template save', () => {
  it('saves a kebab-case name as one file in the templates directory', async () => {
    await run('save', 'TASK-001', '--name', 'my-pattern');
    const saved = JSON.parse(readFileSync(path.join(templatesDir, 'my-pattern.json'), 'utf8'));
    expect(saved).toMatchObject({ name: 'my-pattern', description: 'A reusable pattern' });
  });

  it('rejects a name that is not a plain file name and writes nothing', async () => {
    for (const name of ['../escaped', '../../escaped', '/tmp/absolute', 'a/b', 'a\\b', '..']) {
      await expect(run('save', 'TASK-001', '--name', name)).rejects.toMatchObject({
        code: 'E_TEMPLATE_NAME_INVALID',
      });
    }
    for (const name of ['x\u0000y', 'My Pattern', 'trailing-', 'a'.repeat(65)]) {
      await expect(run('save', 'TASK-001', '--name', name)).rejects.toMatchObject({
        code: 'E_TEMPLATE_NAME_INVALID',
      });
    }
    expect(existsSync(path.join(planningDir, 'escaped.json'))).toBe(false);
    expect(existsSync(path.join(projectDir, 'escaped.json'))).toBe(false);
    expect(existsSync(templatesDir) ? readdirSync(templatesDir) : []).toEqual([]);
  });

  it('validates a name typed at the prompt the same way', async () => {
    vi.mocked(promptText).mockResolvedValueOnce('../prompted');
    await expect(run('save', 'TASK-001')).rejects.toMatchObject({
      code: 'E_TEMPLATE_NAME_INVALID',
    });
    expect(existsSync(path.join(planningDir, 'prompted.json'))).toBe(false);
  });

  it('refuses a templates directory linked outside the planning directory', async () => {
    symlinkSync(outside, templatesDir, 'dir');
    await expect(run('save', 'TASK-001', '--name', 'kept')).rejects.toMatchObject({
      code: 'E_TEMPLATE_DIR_OUTSIDE',
    });
    expect(readdirSync(outside)).toEqual([]);
  });

  it('replaces a template file that is a link instead of writing through it', async () => {
    mkdirSync(templatesDir);
    const target = path.join(outside, 'target.json');
    writeFileSync(target, 'original\n');
    symlinkSync(target, path.join(templatesDir, 'linked.json'));
    await run('save', 'TASK-001', '--name', 'linked');
    expect(readFileSync(target, 'utf8')).toBe('original\n');
    expect(lstatSync(path.join(templatesDir, 'linked.json')).isSymbolicLink()).toBe(false);
  });

  it('still saves when the whole planning directory is a link, as sibling worktrees use', async () => {
    const shared = path.join(root, 'shared-planr');
    rmSync(planningDir, { recursive: true });
    mkdirSync(shared);
    symlinkSync(shared, planningDir, 'dir');
    await createProject(planningDir);
    await run('save', 'TASK-001', '--name', 'shared-pattern');
    expect(existsSync(path.join(shared, 'templates', 'shared-pattern.json'))).toBe(true);
  });
});

describe('planr template delete', () => {
  it('deletes a template by its name', async () => {
    mkdirSync(templatesDir);
    writeFileSync(path.join(templatesDir, 'old-pattern.json'), '{}\n');
    await run('delete', 'old-pattern');
    expect(existsSync(path.join(templatesDir, 'old-pattern.json'))).toBe(false);
  });

  it('rejects a name that reaches outside the templates directory and deletes nothing', async () => {
    mkdirSync(templatesDir);
    const victim = path.join(projectDir, 'package.json');
    writeFileSync(victim, '{}\n');
    for (const name of ['../../package', '/tmp/absolute', '..']) {
      await expect(run('delete', name)).rejects.toMatchObject({
        code: 'E_TEMPLATE_NAME_INVALID',
      });
    }
    expect(existsSync(victim)).toBe(true);
  });

  it('refuses to delete through a templates directory linked outside the planning directory', async () => {
    const victim = path.join(outside, 'victim.json');
    writeFileSync(victim, '{}\n');
    symlinkSync(outside, templatesDir, 'dir');
    await expect(run('delete', 'victim')).rejects.toMatchObject({
      code: 'E_TEMPLATE_DIR_OUTSIDE',
    });
    expect(existsSync(victim)).toBe(true);
  });
});
