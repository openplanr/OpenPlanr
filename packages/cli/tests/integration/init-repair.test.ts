import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerInitCommand } from '../../src/cli/commands/init-deterministic.js';

vi.mock('../../src/services/prompt-service.js', () => ({
  promptConfirm: vi.fn(async () => false),
}));

const CLI = path.resolve('src/cli/index.ts');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const FIXTURE = path.resolve('tests/fixtures/legacy-config');
const roots: string[] = [];

function legacyProject(agentFiles: string[] = []): string {
  const root = mkdtempSync(path.join(tmpdir(), 'openplanr-init-repair-'));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  for (const file of agentFiles) writeFileSync(path.join(root, file), '\n');
  return root;
}

function configText(root: string): string {
  return readFileSync(path.join(root, '.planr', 'config.json'), 'utf8');
}

function run(projectDir: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [TSX, CLI, '--project-dir', projectDir, ...args], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('init --repair', { timeout: 60_000 }, () => {
  it('repairs a legacy three-field config so status succeeds', () => {
    const root = legacyProject(['CLAUDE.md', 'AGENTS.md']);
    const before = JSON.parse(configText(root));
    expect(run(root, ['status', '--json']).status).toBe(1);

    const repair = run(root, ['init', '--repair']);
    expect(repair.status, repair.stderr).toBe(0);
    const today = new Date().toISOString().split('T')[0];
    expect(repair.stdout).toContain('targets: ["claude","codex"]');
    expect(repair.stdout).toContain(`createdAt: "${today}"`);

    expect(JSON.parse(configText(root))).toEqual({
      ...before,
      targets: ['claude', 'codex'],
      createdAt: today,
    });
    const status = run(root, ['status']);
    expect(status.status, status.stderr).toBe(0);
  });

  it('reports nothing to repair on a valid config and leaves it unchanged', () => {
    const root = legacyProject(['CLAUDE.md']);
    expect(run(root, ['init', '--repair']).status).toBe(0);
    const repaired = configText(root);

    const again = run(root, ['init', '--repair']);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain('Nothing to repair');
    expect(configText(root)).toBe(repaired);
  });

  it('rejects --repair together with --force', () => {
    const root = legacyProject();
    const before = configText(root);
    const result = run(root, ['init', '--repair', '--force']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("option '--repair' cannot be used with option '--force'");
    expect(configText(root)).toBe(before);
  });

  it('writes nothing when the confirmation is declined', async () => {
    const root = legacyProject(['CLAUDE.md']);
    const before = configText(root);
    const program = new Command().option('--project-dir <dir>').exitOverride();
    registerInitCommand(program);

    await program.parseAsync(['--project-dir', root, 'init', '--repair'], { from: 'user' });

    expect(configText(root)).toBe(before);
  });
});

describe('init on an existing project', { timeout: 60_000 }, () => {
  it('fails with E_ALREADY_INITIALIZED and points to --repair and --force', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'openplanr-init-twice-'));
    roots.push(root);
    expect(run(root, ['init', '--name', 'demo']).status).toBe(0);

    const second = run(root, ['init', '--name', 'demo']);
    expect(second.status).toBe(1);
    const output = `${second.stdout}${second.stderr}`;
    expect(output).toContain('E_ALREADY_INITIALIZED: OpenPlanr is already initialized');
    expect(output).toContain('openplanr init --repair');
    expect(output).toContain('openplanr init --force');
  });
});
