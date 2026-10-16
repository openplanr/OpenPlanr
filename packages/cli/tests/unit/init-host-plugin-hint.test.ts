import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerInitCommand } from '../../src/cli/commands/init-deterministic.js';
import { applySetup } from '../../src/services/runtime-manager-service.js';
import { logger } from '../../src/utils/logger.js';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

const HINT = 'Install a host plugin for agent-led Plan, Spec, and Ship workflows.';
const cliVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  .version as string;
const savedEnv = { ...process.env };
let root: string;

async function init(projectDir: string): Promise<string[]> {
  const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'success').mockImplementation(() => {});
  const program = new Command().option('--project-dir <dir>').exitOverride();
  registerInitCommand(program);
  await program.parseAsync(['--project-dir', projectDir, 'init'], { from: 'user' });
  return info.mock.calls.map(([message]) => String(message));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openplanr-init-hint-'));
  delete process.env.CODEX_HOME;
  delete process.env.PLANR_HOME;
  process.env.OPENPLANR_HOME = join(root, 'home');
  process.env.OPENPLANR_PIPELINE_ROOT = resolvePipelinePackageRoot();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
  rmSync(root, { recursive: true, force: true });
});

describe('init host plugin hint', () => {
  it('suggests a host plugin when no coding agent is set up', async () => {
    const project = join(root, 'project');
    mkdirSync(project);

    expect(await init(project)).toContain(HINT);
  });

  it('omits the hint after a user-scope setup made in another directory', async () => {
    const setupDir = join(root, 'setup');
    const project = join(root, 'project');
    mkdirSync(setupDir);
    mkdirSync(project);
    await applySetup({
      projectDir: setupDir,
      cliVersion,
      runtime: 'codex',
      scope: 'user',
      skillMode: 'direct',
      manageExternalRuntimes: false,
    });

    expect(await init(project)).not.toContain(HINT);
  });

  it('warns and still succeeds when runtime state is unreadable', { timeout: 60_000 }, () => {
    const project = join(root, 'project');
    const planrHome = join(root, 'home', '.planr');
    mkdirSync(project);
    mkdirSync(join(planrHome, 'runtime'), { recursive: true });
    writeFileSync(join(planrHome, 'runtime', 'state.json'), '{ not json');
    const { OPENPLANR_HOME: _legacyHome, ...env } = process.env;

    const result = spawnSync(
      process.execPath,
      [
        createRequire(import.meta.url).resolve('tsx/cli'),
        resolve('src/cli/index.ts'),
        '--project-dir',
        project,
        'init',
      ],
      { cwd: project, encoding: 'utf8', env: { ...env, PLANR_HOME: planrHome, NO_COLOR: '1' } },
    );

    expect(result.status, result.stderr).toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toMatch(/Could not read coding agent setup \(E_RUNTIME_STATE_\w+: .+\)/);
    expect(output).toContain('openplanr doctor');
    expect(output).not.toContain(HINT);
    expect(existsSync(join(project, '.planr', 'config.json'))).toBe(true);
  });
});
