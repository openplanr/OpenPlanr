import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProtocolArtifact } from 'planr-pipeline/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClaudeCommandRunner } from '../../src/services/claude-plugin-service.js';
import {
  applySetup as applyRuntimeSetup,
  classifyComponentDrift,
  cleanupHomeProjectInstall,
  inspectProjectContext,
  installedRuntimeScopes,
  previewHomeProjectCleanup,
  previewSetup as previewRuntimeSetup,
  removeRuntime,
  rollbackRuntime,
  runtimeDoctor,
  runtimeRoot,
  type SetupOptions,
} from '../../src/services/runtime-manager-service.js';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

// File ownership tests do not consult or mutate the developer's native plugin installation.
// Native integration cases opt in through their explicit injected command runner.
function setupOptions(options: SetupOptions): SetupOptions {
  return {
    ...options,
    manageExternalRuntimes:
      options.manageExternalRuntimes ??
      Boolean(options.codexCommandRunner || options.claudeCommandRunner),
  };
}
const applySetup = (options: SetupOptions) => applyRuntimeSetup(setupOptions(options));
const previewSetup = (options: SetupOptions) => previewRuntimeSetup(setupOptions(options));

let root: string;
let projectDir: string;
let userHome: string;
let previousCodexHome: string | undefined;
const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const cliVersion = JSON.parse(
  readFileSync(join(workspaceRoot, 'packages', 'cli', 'package.json'), 'utf8'),
).version as string;
// Ownership migration depends on the recorded legacy bytes and name, not on a
// retired installation tree remaining in this checkout.
const legacyPlanSkill =
  '---\nname: planr-plan\ndescription: Plan a feature.\n---\n# Legacy Plan skill\n';
const pipelineRoot = resolvePipelinePackageRoot();
const pipelineVersion = JSON.parse(readFileSync(join(pipelineRoot, 'package.json'), 'utf8'))
  .version as string;
const bundledOpenAiSkillsRoot = join(
  workspaceRoot,
  'packages',
  'cli',
  'lib',
  'host-packages',
  'openai',
  'openplanr',
  'skills',
);
const bundledClaudePluginRoot = join(
  workspaceRoot,
  'packages',
  'cli',
  'lib',
  'host-packages',
  'claude',
  'openplanr',
);
const bundledAdapterRegistry = JSON.parse(
  readFileSync(
    join(workspaceRoot, 'packages', 'cli', 'lib', 'host-packages', 'adapter-registry.json'),
    'utf8',
  ),
) as { pluginVersion: string; protocolVersion: string };
function regularFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = join(directory, entry.name);
    return entry.isDirectory() ? regularFiles(target) : entry.isFile() ? [target] : [];
  });
}
const canonicalProjectKey = (directory: string) =>
  createHash('sha256').update(realpathSync(directory)).digest('hex').slice(0, 16);

beforeEach(() => {
  previousCodexHome = process.env.CODEX_HOME;
  delete process.env.CODEX_HOME;
  root = mkdtempSync(join(tmpdir(), 'openplanr-runtime-'));
  projectDir = join(root, 'project');
  userHome = join(root, 'home');
  process.env.OPENPLANR_HOME = userHome;
  process.env.OPENPLANR_PIPELINE_ROOT = pipelineRoot;
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(join(projectDir, '.planr'), { recursive: true });
  writeFileSync(join(projectDir, '.planr', 'config.json'), '{}\n');
});

afterEach(() => {
  if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousCodexHome;
  delete process.env.OPENPLANR_HOME;
  delete process.env.OPENPLANR_PIPELINE_ROOT;
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('runtime Node.js diagnostics', () => {
  it.each(['20.18.9', '21.7.0', '22.12.9', '23.4.9'])(
    'rejects setup for %s without creating installation custody and reports the same doctor failure',
    async (version) => {
      const descriptor = Object.getOwnPropertyDescriptor(process.versions, 'node');
      try {
        Object.defineProperty(process.versions, 'node', { value: version });
        await expect(previewSetup({ projectDir, cliVersion, minimal: true })).rejects.toMatchObject(
          {
            code: 'E_NODE_VERSION',
          },
        );
        expect(existsSync(join(userHome, '.planr', 'runtime', 'state.json'))).toBe(false);
        const doctor = await runtimeDoctor(projectDir);
        expect(doctor.diagnostics.find((entry) => entry.code === 'node-version')).toMatchObject({
          status: 'fail',
          message: expect.stringContaining(version),
          fix: expect.stringContaining('Install a supported Node.js version'),
        });
      } finally {
        if (descriptor) Object.defineProperty(process.versions, 'node', descriptor);
      }
    },
  );
  it.each(['20.19.0', '22.13.0', '23.5.0', '24.0.0'])(
    'uses the same accepted branch for setup and doctor on %s',
    async (version) => {
      const descriptor = Object.getOwnPropertyDescriptor(process.versions, 'node');
      try {
        Object.defineProperty(process.versions, 'node', { value: version });
        await expect(
          previewSetup({ projectDir, cliVersion, minimal: true }),
        ).resolves.toMatchObject({ ok: true });
        const doctor = await runtimeDoctor(projectDir);
        expect(doctor.diagnostics.find((entry) => entry.code === 'node-version')).toMatchObject({
          status: 'pass',
        });
      } finally {
        if (descriptor) Object.defineProperty(process.versions, 'node', descriptor);
      }
    },
  );
});

describe('runtime setup', () => {
  it('refuses project-scoped setup when another tool owns the planning folder', async () => {
    rmSync(join(projectDir, '.planr', 'config.json'));
    writeFileSync(join(projectDir, '.planr', 'planr.config.json'), '{}\n');
    execFileSync('git', ['init', '-q'], { cwd: projectDir });
    await expect(
      previewSetup({ projectDir, cliVersion, runtime: 'cursor', scope: 'project' }),
    ).rejects.toMatchObject({ code: 'E_PLANNING_FOLDER_FOREIGN' });
    expect(readdirSync(join(projectDir, '.planr'))).toEqual(['planr.config.json']);
    expect(existsSync(join(userHome, '.planr', 'runtime', 'state.json'))).toBe(false);
  });
  it.each(['codex', 'claude-code'] as const)(
    'does not write setup state when %s native plugin inspection fails',
    async (runtime) => {
      const runner = () => ({ status: 1, stdout: '', stderr: 'Native plugin state unavailable' });
      const options = {
        projectDir,
        cliVersion,
        runtime,
        scope: 'user' as const,
        skillMode: 'unified-plugin' as const,
        ...(runtime === 'codex' ? { codexCommandRunner: runner } : { claudeCommandRunner: runner }),
      };
      const preview = await previewSetup(options);
      expect(preview.runtimeDiagnostics.some((entry) => entry.status === 'fail')).toBe(true);
      await expect(applySetup(options)).rejects.toMatchObject({
        code:
          runtime === 'codex'
            ? 'E_CODEX_PLUGIN_INSPECTION_FAILED'
            : 'E_CLAUDE_PLUGIN_INSPECTION_FAILED',
      });
      expect(existsSync(join(userHome, '.planr', 'runtime', 'state.json'))).toBe(false);
      expect(existsSync(join(userHome, '.planr', 'runtime', 'setup.lock'))).toBe(false);
    },
  );
  it('keeps project-only Codex setup separate from native user plugin configuration', async () => {
    const nativeCalls: string[][] = [];
    const options = {
      projectDir,
      cliVersion,
      runtime: 'codex' as const,
      scope: 'project' as const,
      codexCommandRunner: (args: string[]) => {
        nativeCalls.push(args);
        return { status: 1, stdout: '', stderr: 'Unrelated global plugin configuration' };
      },
    };
    const preview = await previewSetup(options);
    expect(preview.runtimeOperations).toEqual([]);
    expect(preview.runtimeDiagnostics).toEqual([]);
    expect(
      preview.actions
        .filter((action) => action.runtime !== 'core')
        .every((action) => action.scope === 'project'),
    ).toBe(true);
    await applySetup(options);
    expect(nativeCalls).toEqual([]);
    expect(existsSync(join(projectDir, '.agents', 'skills', 'plan', 'SKILL.md'))).toBe(true);
  });

  it('retires the user plugin when switching both scopes to project skills', async () => {
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'user',
      skillMode: 'unified-plugin',
      manageExternalRuntimes: false,
    });
    const hostRoot = join(workspaceRoot, 'packages', 'cli', 'lib', 'host-packages', 'openai');
    const marketplace = JSON.parse(
      readFileSync(join(hostRoot, '.claude-plugin', 'marketplace.json'), 'utf8'),
    );
    const pluginId = `planr@${marketplace.name}`;
    let installed = true;
    const nativeCalls: string[][] = [];
    const codexCommandRunner = (args: string[]) => {
      nativeCalls.push(args);
      if (args[0] === '--version') return { status: 0, stdout: 'codex 0.159.1', stderr: '' };
      if (args.join(' ') === 'plugin marketplace list --json')
        return { status: 0, stdout: JSON.stringify({ marketplaces: [] }), stderr: '' };
      if (args.join(' ') === 'plugin list --json')
        return {
          status: 0,
          stdout: JSON.stringify(installed ? [{ pluginId, installed: true, enabled: true }] : []),
          stderr: '',
        };
      if (args.slice(0, 2).join(' ') === 'plugin remove' && args[2] === pluginId) installed = false;
      return { status: 0, stdout: '{}', stderr: '' };
    };
    const transition = {
      projectDir,
      cliVersion,
      runtime: 'codex' as const,
      scope: 'both' as const,
      skillMode: 'project-rule' as const,
      replaceManaged: true,
      codexCommandRunner,
    };
    const preview = await previewSetup(transition);
    expect(preview.runtimeOperations).toContainEqual(
      expect.objectContaining({ runtime: 'codex', kind: 'remove', id: pluginId, scope: 'user' }),
    );
    await applySetup(transition);
    expect(installed).toBe(false);
    expect(nativeCalls).toContainEqual(['plugin', 'remove', pluginId, '--json']);
    const state = JSON.parse(
      readFileSync(join(userHome, '.planr', 'runtime', 'state.json'), 'utf8'),
    );
    expect(state.userBundles.codex.installMode).toBe('project-rule');
    expect(state.projects[canonicalProjectKey(projectDir)].skillModes.codex).toBe('project-rule');
    const repair = await previewSetup({ ...transition, preserveExistingScopes: true });
    expect(repair.runtimeOperations).toEqual([]);
    expect(repair.runtimeDiagnostics.every((entry) => entry.status === 'pass')).toBe(true);
  });

  it('preserves plugin discovery through stale-daemon repair and converges without direct assets', async () => {
    let pluginInstalled = false;
    let legacyEnabled = false;
    let marketplaceConfigured = false;
    const nativeCalls: string[][] = [];
    const hostRoot = join(workspaceRoot, 'packages', 'cli', 'lib', 'host-packages', 'openai');
    const marketplace = JSON.parse(
      readFileSync(join(hostRoot, '.claude-plugin', 'marketplace.json'), 'utf8'),
    );
    const pluginId = `planr@${marketplace.name}`;
    const legacyId = `openplanr@${marketplace.name}`;
    const configPath = join(userHome, '.codex', 'config.toml');
    const writeNativeConfig = () => {
      mkdirSync(join(configPath, '..'), { recursive: true });
      writeFileSync(
        configPath,
        `[plugins."unrelated@custom"]\nenabled = true\n${pluginInstalled ? `[plugins."${pluginId}"]\nenabled = true\n` : ''}${legacyEnabled ? `[plugins."${legacyId}"]\nenabled = true\n` : ''}`,
      );
    };
    const codexCommandRunner = (args: string[]) => {
      nativeCalls.push(args);
      if (args[0] === '--version') return { status: 0, stdout: 'codex 0.159.1', stderr: '' };
      if (args.join(' ') === 'plugin marketplace list --json')
        return {
          status: 0,
          stderr: '',
          stdout: JSON.stringify({
            marketplaces: marketplaceConfigured ? [{ name: marketplace.name, root: hostRoot }] : [],
          }),
        };
      if (args.join(' ') === 'plugin list --json')
        return {
          status: 0,
          stderr: '',
          stdout: JSON.stringify(
            pluginInstalled
              ? [
                  {
                    pluginId,
                    name: 'planr',
                    marketplaceName: marketplace.name,
                    version: marketplace.plugins[0].version,
                    installed: true,
                    enabled: true,
                  },
                ]
              : [],
          ),
        };
      if (args.slice(0, 3).join(' ') === 'plugin marketplace add') marketplaceConfigured = true;
      if (args.slice(0, 2).join(' ') === 'plugin add') {
        pluginInstalled = true;
        cpSync(
          join(hostRoot, 'openplanr'),
          join(
            userHome,
            '.codex',
            'plugins',
            'cache',
            marketplace.name,
            'planr',
            marketplace.plugins[0].version,
          ),
          { recursive: true },
        );
      }
      if (args.slice(0, 2).join(' ') === 'plugin remove' && args[2] === legacyId)
        legacyEnabled = false;
      writeNativeConfig();
      return { status: 0, stdout: '{}', stderr: '' };
    };
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'user',
      skillMode: 'unified-plugin',
      codexCommandRunner,
    });
    legacyEnabled = true;
    writeNativeConfig();
    const dashboardState = join(userHome, '.planr', 'dashboard-daemon');
    mkdirSync(dashboardState, { recursive: true });
    writeFileSync(join(dashboardState, 'port'), 'invalid\n');
    const diagnosis = await runtimeDoctor(projectDir, {
      pipelineRepair: 'preview',
      codexCommandRunner,
    });
    expect(diagnosis.repairs).toHaveLength(1);
    expect(
      diagnosis.diagnostics.find((entry) => entry.code === 'runtime-codex-install-mode')?.status,
    ).toBe('warn');
    const repairOptions = {
      projectDir,
      cliVersion,
      runtimes: ['codex' as const],
      scope: 'user' as const,
      preserveExistingScopes: true,
      replaceManaged: true,
      codexCommandRunner,
    };
    const preview = await previewSetup(repairOptions);
    expect(preview.skillModes.codex).toBe('unified-plugin');
    expect(preview.actions.every((action) => !action.target.includes('/.codex/skills/'))).toBe(
      true,
    );
    expect(preview.runtimeOperations).toContainEqual(
      expect.objectContaining({ kind: 'remove', id: legacyId }),
    );
    await runtimeDoctor(projectDir, { pipelineRepair: 'apply', codexCommandRunner });
    const applied = await applySetup(repairOptions);
    expect(applied.restartRequired).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toContain('unrelated@custom');
    expect(existsSync(join(userHome, '.codex', 'skills', 'plan', 'SKILL.md'))).toBe(false);
    const second = await previewSetup(repairOptions);
    expect(second.runtimeOperations).toEqual([]);
    expect(second.actions.every((action) => action.operation === 'unchanged')).toBe(true);
    expect(
      (await runtimeDoctor(projectDir, { pipelineRepair: 'preview', codexCommandRunner })).repairs,
    ).toEqual([]);
    expect(nativeCalls.some((args) => args[2] === 'unrelated@custom')).toBe(false);
  });

  it('retains the saved discovery choice and mixed scopes when repairing from another directory', async () => {
    await applySetup({
      projectDir,
      cliVersion,
      runtimes: ['claude-code', 'codex', 'cursor'],
      scope: 'both',
      skillMode: 'unified-plugin',
      manageExternalRuntimes: false,
    });
    const mixed = await previewSetup({
      projectDir,
      cliVersion,
      runtimes: ['claude-code', 'codex', 'cursor'],
      scope: 'user',
      preserveExistingScopes: true,
      manageExternalRuntimes: false,
    });
    expect(mixed.runtimeScopes).toEqual({
      'claude-code': 'both',
      codex: 'both',
      cursor: 'project',
    });
    expect(mixed.skillModes.codex).toBe('unified-plugin');
    const outside = join(root, 'outside');
    mkdirSync(outside);
    const outsideOptions = {
      projectDir: outside,
      cliVersion,
      runtimes: ['claude-code', 'codex'] as const,
      scope: 'user' as const,
      preserveExistingScopes: true,
      manageExternalRuntimes: false,
    };
    const outsidePreview = await previewSetup({
      ...outsideOptions,
      runtimes: [...outsideOptions.runtimes],
    });
    expect(outsidePreview.runtimeScopes).toEqual({ 'claude-code': 'user', codex: 'user' });
    expect(outsidePreview.skillModes.codex).toBe('unified-plugin');
    await applySetup({ ...outsideOptions, runtimes: [...outsideOptions.runtimes] });
    expect(existsSync(join(outside, '.agents'))).toBe(false);
    const original = await previewSetup({
      projectDir,
      cliVersion,
      runtimes: ['claude-code', 'codex', 'cursor'],
      scope: 'user',
      preserveExistingScopes: true,
      manageExternalRuntimes: false,
    });
    expect(original.runtimeScopes).toEqual(mixed.runtimeScopes);
    expect(original.actions.every((action) => action.operation === 'unchanged')).toBe(true);
  });

  it.each(['direct', 'project-rule'] as const)(
    'preserves saved %s mode through repair',
    async (skillMode) => {
      const scope = skillMode === 'direct' ? 'user' : 'project';
      await applySetup({
        projectDir,
        cliVersion,
        runtime: 'codex',
        scope,
        skillMode,
        manageExternalRuntimes: false,
      });
      const repaired = await applySetup({
        projectDir,
        cliVersion,
        runtime: 'codex',
        scope: 'user',
        preserveExistingScopes: true,
        manageExternalRuntimes: false,
      });
      expect(repaired.skillModes.codex).toBe(skillMode);
      expect(repaired.runtimeScopes.codex).toBe(scope);
      expect(repaired.actions.every((action) => action.operation === 'unchanged')).toBe(true);
    },
  );

  it.each(['codex', 'claude-code'] as const)(
    'preserves modified %s project skills during repair',
    async (runtime) => {
      await applySetup({
        projectDir,
        cliVersion,
        runtime,
        scope: 'project',
        manageExternalRuntimes: false,
      });
      const target =
        runtime === 'codex'
          ? join(projectDir, '.agents', 'skills', 'plan', 'SKILL.md')
          : join(projectDir, '.claude', 'skills', 'plan', 'SKILL.md');
      const custom = `${readFileSync(target, 'utf8')}\nOwner customization: preserve this.\n`;
      writeFileSync(target, custom);
      const repair = {
        projectDir,
        cliVersion,
        runtime,
        scope: 'user' as const,
        preserveExistingScopes: true,
        manageExternalRuntimes: false,
      };
      await expect(previewSetup(repair)).rejects.toMatchObject({ code: 'E_MIGRATION_CONFLICT' });
      await expect(applySetup(repair)).rejects.toMatchObject({ code: 'E_MIGRATION_CONFLICT' });
      expect(readFileSync(target, 'utf8')).toBe(custom);
    },
  );

  it('retains saved user and project modes while replacing duplicate discovery with project policy', async () => {
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'user',
      skillMode: 'unified-plugin',
      manageExternalRuntimes: false,
    });
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'project',
      skillMode: 'project-rule',
      manageExternalRuntimes: false,
    });
    const lockPath = join(projectDir, '.planr', 'runtime-lock.json');
    const before = readFileSync(lockPath);
    const repair = {
      projectDir,
      cliVersion,
      runtimes: ['codex' as const],
      scope: 'user' as const,
      preserveExistingScopes: true,
      manageExternalRuntimes: false,
    };
    const preview = await previewSetup(repair);
    expect(preview.skillModes.codex).toBe('unified-plugin');
    expect(preview.projectSkillModes?.codex).toBe('project-rule');
    expect(preview.runtimeScopes.codex).toBe('project');
    expect(preview.userScopeRuntimes).toEqual(['codex']);
    expect(preview.actions.some((action) => action.operation === 'retire')).toBe(true);
    const userMarker = join(userHome, '.planr', 'runtime', 'adapters', 'codex.json');
    unlinkSync(userMarker);
    await applySetup(repair);
    const state = JSON.parse(
      readFileSync(join(userHome, '.planr', 'runtime', 'state.json'), 'utf8'),
    );
    expect(state.userBundles.codex.installMode).toBe('unified-plugin');
    expect(state.projects[canonicalProjectKey(projectDir)].skillModes.codex).toBe('project-rule');
    expect(state.projects[canonicalProjectKey(projectDir)].runtimeScopes.codex).toBe('project');
    expect(readFileSync(lockPath).equals(before)).toBe(true);
    expect(
      (await previewSetup(repair)).actions.every((action) => action.operation === 'unchanged'),
    ).toBe(true);
  });

  it('preserves global direct skills while installing separate project skills', async () => {
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'user',
      skillMode: 'direct',
      manageExternalRuntimes: false,
    });
    const target = join(userHome, '.codex', 'skills', 'plan', 'SKILL.md');
    const before = readFileSync(target);
    const installed = await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'project',
      skillMode: 'project-rule',
      manageExternalRuntimes: false,
    });
    expect(
      installed.actions.every(
        (action) =>
          (action.scope === 'project' || action.runtime === 'core') &&
          action.operation !== 'retire',
      ),
    ).toBe(true);
    expect(readFileSync(target).equals(before)).toBe(true);
    const repair = await previewSetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'user',
      preserveExistingScopes: true,
      manageExternalRuntimes: false,
    });
    expect(repair.skillModes.codex).toBe('direct');
    expect(repair.projectSkillModes?.codex).toBe('project-rule');
    expect(repair.actions.some((action) => action.operation === 'retire')).toBe(true);
    expect(readFileSync(target).equals(before)).toBe(true);
  });

  it('rejects a symlinked runtime-backup parent without writing external bytes', async () => {
    const external = join(root, 'external-backups');
    mkdirSync(join(userHome, '.planr'), { recursive: true });
    mkdirSync(external, { recursive: true });
    symlinkSync(external, join(userHome, '.planr', 'backups'), 'dir');

    await expect(
      applySetup({ projectDir, cliVersion, runtime: 'codex', scope: 'user' }),
    ).rejects.toMatchObject({ code: 'E_BACKUP_FAILED' });
    expect(readdirSync(external)).toEqual([]);
  });

  it('rejects a symlinked global Codex skills parent without touching its external target', async () => {
    const external = join(root, 'external-skills');
    mkdirSync(join(userHome, '.codex'), { recursive: true });
    mkdirSync(external, { recursive: true });
    symlinkSync(external, join(userHome, '.codex', 'skills'), 'dir');

    await expect(
      previewSetup({ projectDir, cliVersion, runtime: 'codex', scope: 'user' }),
    ).rejects.toMatchObject({ code: 'E_MIGRATION_CONFLICT' });
    expect(readdirSync(external)).toEqual([]);
  });

  it('rejects forged global ownership targets before preview or retirement', async () => {
    const external = join(root, 'external-owned-skill.md');
    writeFileSync(external, 'preserve me\n');
    const key = canonicalProjectKey(projectDir);
    const runtimeStatePath = join(userHome, '.planr', 'runtime', 'state.json');
    mkdirSync(join(runtimeStatePath, '..'), { recursive: true });
    writeFileSync(
      runtimeStatePath,
      `${JSON.stringify(
        {
          schemaVersion: '2.0.0',
          userBundles: {
            codex: {
              runtime: 'codex',
              scope: 'user',
              updatedAt: '2026-08-20T00:00:00.000Z',
              pipelineVersion,
              commandPrefix: 'namespaced',
              ownedFiles: [
                {
                  runtime: 'codex',
                  scope: 'user',
                  target: external,
                  kind: 'file',
                  hash: createHash('sha256').update('preserve me\n').digest('hex'),
                },
              ],
            },
          },
          projects: {
            [key]: {
              projectDir: resolve(projectDir),
              updatedAt: '2026-08-20T00:00:00.000Z',
              runtimes: ['codex'],
              runtimeScopes: { codex: 'user' },
              ownedFiles: [],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    await expect(
      previewSetup({ projectDir, cliVersion, runtime: 'codex', scope: 'user' }),
    ).rejects.toMatchObject({ code: 'E_RUNTIME_STATE_INVALID' });
    await expect(removeRuntime('codex', projectDir)).rejects.toMatchObject({
      code: 'E_RUNTIME_STATE_INVALID',
    });
    expect(readFileSync(external, 'utf8')).toBe('preserve me\n');
  });

  it('rejects a forged project key bound to a different canonical directory', async () => {
    const externalProject = join(root, 'external-project');
    const external = join(externalProject, 'preserve.txt');
    mkdirSync(externalProject, { recursive: true });
    writeFileSync(external, 'preserve external project bytes\n');
    const victimKey = canonicalProjectKey(projectDir);
    const runtimeStatePath = join(userHome, '.planr', 'runtime', 'state.json');
    mkdirSync(join(runtimeStatePath, '..'), { recursive: true });
    writeFileSync(
      runtimeStatePath,
      `${JSON.stringify({
        schemaVersion: '2.0.0',
        userBundles: {},
        projects: {
          [victimKey]: {
            projectDir: resolve(externalProject),
            updatedAt: '2026-08-20T00:00:00.000Z',
            runtimes: ['codex'],
            runtimeScopes: { codex: 'project' },
            ownedFiles: [
              {
                runtime: 'codex',
                scope: 'project',
                target: external,
                kind: 'file',
                hash: createHash('sha256')
                  .update('preserve external project bytes\n')
                  .digest('hex'),
              },
            ],
          },
        },
      })}\n`,
    );

    await expect(
      previewSetup({ projectDir, cliVersion, runtime: 'codex', scope: 'project' }),
    ).rejects.toMatchObject({ code: 'E_RUNTIME_STATE_INVALID' });
    await expect(removeRuntime('codex', projectDir)).rejects.toMatchObject({
      code: 'E_RUNTIME_STATE_INVALID',
    });
    await expect(rollbackRuntime(projectDir)).rejects.toMatchObject({
      code: 'E_RUNTIME_STATE_INVALID',
    });
    expect(readFileSync(external, 'utf8')).toBe('preserve external project bytes\n');
  });

  it('installs and audits the complete Codex host package', async () => {
    await applySetup({ projectDir, cliVersion, runtime: 'codex', scope: 'user' });
    const expectedNames = readdirSync(bundledOpenAiSkillsRoot).sort();
    const expectedAssets = regularFiles(join(userHome, '.codex', 'skills'));
    const locator = JSON.parse(
      readFileSync(join(userHome, '.codex', 'skills', 'design', 'openplanr.install.json'), 'utf8'),
    );
    expect(regularFiles(locator.sourceRoot).length).toBeGreaterThan(expectedAssets.length);
    expect(readFileSync(join(locator.sourceRoot, locator.entryPath))).toEqual(
      readFileSync(join(bundledOpenAiSkillsRoot, 'design', 'SKILL.md')),
    );
    const installedNames = readdirSync(join(userHome, '.codex', 'skills')).sort();
    const canonicalSkills = JSON.parse(
      readFileSync(join(workspaceRoot, 'skills', 'registry.json'), 'utf8'),
    ) as { skills: Array<{ skillId: string }> };
    expect(expectedNames).toHaveLength(canonicalSkills.skills.length);
    expect(installedNames).toEqual(expectedNames);
    const state = JSON.parse(
      readFileSync(join(userHome, '.planr', 'runtime', 'state.json'), 'utf8'),
    ) as { userBundles: { codex: { ownedFiles: Array<{ target: string }> } } };
    expect(
      state.userBundles.codex.ownedFiles.filter((file) =>
        file.target.startsWith(join(userHome, '.codex', 'skills') + sep),
      ),
    ).toHaveLength(expectedAssets.length);

    const unrelated = join(root, 'unregistered-project');
    mkdirSync(unrelated);
    const doctor = await runtimeDoctor(unrelated);
    expect(doctor.diagnostics.find((item) => item.code === 'host-skill-packages')).toMatchObject({
      status: 'pass',
      message: `Claude Code, Codex, and Cursor each expose all ${canonicalSkills.skills.length} host-native skills`,
    });
  });

  it('validates the bundled host package independently of Codex discovery mode', async () => {
    await applySetup({ projectDir, cliVersion, runtime: 'codex', scope: 'user' });
    const runtimeStatePath = join(userHome, '.planr', 'runtime', 'state.json');
    const state = JSON.parse(readFileSync(runtimeStatePath, 'utf8'));
    state.userBundles.codex.installMode = 'unified-plugin';
    state.userBundles.codex.ownedFiles = [];
    writeFileSync(runtimeStatePath, `${JSON.stringify(state, null, 2)}\n`);
    rmSync(join(userHome, '.codex', 'skills'), { recursive: true, force: true });

    const doctor = await runtimeDoctor(projectDir);

    expect(doctor.diagnostics.find((item) => item.code === 'host-skill-packages')).toMatchObject({
      status: 'pass',
    });
  });

  it('preserves and reports an unknown file inside a managed Codex skill directory', async () => {
    const unknown = join(userHome, '.codex', 'skills', 'plan', 'private-notes.md');
    mkdirSync(join(unknown, '..'), { recursive: true });
    writeFileSync(unknown, 'keep me\n');

    await expect(
      previewSetup({ projectDir, cliVersion, runtime: 'codex', scope: 'user' }),
    ).rejects.toMatchObject({ code: 'E_MIGRATION_CONFLICT' });
    expect(readFileSync(unknown, 'utf8')).toBe('keep me\n');
  });

  it('refuses unknown user-owned bytes at a Cursor professional skill target', async () => {
    const target = join(projectDir, '.cursor', 'rules', 'openplanr', 'planr-spec.mdc');
    const userBytes = '# user-owned Cursor rule\n';
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, userBytes);

    await expect(
      previewSetup({ projectDir, cliVersion, runtime: 'cursor', scope: 'project' }),
    ).rejects.toMatchObject({ code: 'E_MIGRATION_CONFLICT' });
    expect(readFileSync(target, 'utf8')).toBe(userBytes);
    expect(existsSync(join(userHome, '.planr', 'runtime', 'state.json'))).toBe(false);
  });

  it('refuses to update a modified managed Cursor professional skill', async () => {
    const target = join(projectDir, '.cursor', 'rules', 'openplanr', 'planr-spec.mdc');
    await applySetup({ projectDir, cliVersion, runtime: 'cursor', scope: 'project' });
    const modifiedBytes = '# modified after managed install\n';
    writeFileSync(target, modifiedBytes);

    await expect(
      previewSetup({ projectDir, cliVersion, runtime: 'cursor', scope: 'project' }),
    ).rejects.toMatchObject({ code: 'E_MIGRATION_CONFLICT' });
    await expect(
      applySetup({ projectDir, cliVersion, runtime: 'cursor', scope: 'project' }),
    ).rejects.toMatchObject({ code: 'E_MIGRATION_CONFLICT' });
    expect(readFileSync(target, 'utf8')).toBe(modifiedBytes);
  });

  it('migrates scope-less legacy Codex skill ownership into one global bundle', async () => {
    const skill = join(userHome, '.codex', 'skills', 'planr-plan', 'SKILL.md');
    const migratedSkill = join(userHome, '.codex', 'skills', 'plan', 'SKILL.md');
    const source = legacyPlanSkill;
    mkdirSync(join(skill, '..'), { recursive: true });
    writeFileSync(skill, source);
    const key = canonicalProjectKey(projectDir);
    const runtimeStatePath = join(userHome, '.planr', 'runtime', 'state.json');
    mkdirSync(join(runtimeStatePath, '..'), { recursive: true });
    writeFileSync(
      runtimeStatePath,
      `${JSON.stringify({
        schemaVersion: '1.0.0',
        projects: {
          [key]: {
            projectDir: resolve(projectDir),
            updatedAt: '2026-01-01T00:00:00.000Z',
            runtimes: ['codex'],
            commandPrefix: 'namespaced',
            ownedFiles: [
              {
                runtime: 'codex',
                target: skill,
                kind: 'file',
                hash: createHash('sha256').update(source).digest('hex'),
              },
            ],
          },
        },
      })}\n`,
    );

    await applySetup({ projectDir, cliVersion, runtime: 'codex', scope: 'user' });
    const state = JSON.parse(readFileSync(runtimeStatePath, 'utf8')) as {
      schemaVersion: string;
      userBundles: { codex: { commandPrefix: string; ownedFiles: Array<{ target: string }> } };
      projects: Record<string, { commandPrefix?: string; ownedFiles: Array<{ target: string }> }>;
    };
    expect(state.schemaVersion).toBe('2.0.0');
    expect(state.userBundles.codex.commandPrefix).toBe('bare');
    expect(state.userBundles.codex.ownedFiles.some((file) => file.target === migratedSkill)).toBe(
      true,
    );
    expect(state.userBundles.codex.ownedFiles.some((file) => file.target === skill)).toBe(false);
    expect(state.projects[key].ownedFiles.some((file) => file.target === skill)).toBe(false);
    expect(state.projects[key].commandPrefix).toBeUndefined();
  });

  it('refuses divergent legacy project prefixes instead of silently choosing one', async () => {
    const secondProject = join(root, 'legacy-two');
    mkdirSync(secondProject);
    const namespaced = join(userHome, '.codex', 'skills', 'planr-plan', 'SKILL.md');
    const bare = join(userHome, '.codex', 'skills', 'plan', 'SKILL.md');
    const source = legacyPlanSkill;
    const bareSource = source.replace(/^name: planr-plan$/m, 'name: plan');
    mkdirSync(join(namespaced, '..'), { recursive: true });
    mkdirSync(join(bare, '..'), { recursive: true });
    writeFileSync(namespaced, source);
    writeFileSync(bare, bareSource);
    const legacyProject = (
      directory: string,
      commandPrefix: string,
      target: string,
      bytes: string,
    ) => ({
      projectDir: resolve(directory),
      updatedAt: '2026-01-01T00:00:00.000Z',
      runtimes: ['codex'],
      commandPrefix,
      ownedFiles: [
        {
          runtime: 'codex',
          target,
          kind: 'file',
          hash: createHash('sha256').update(bytes).digest('hex'),
        },
      ],
    });
    const runtimeStatePath = join(userHome, '.planr', 'runtime', 'state.json');
    mkdirSync(join(runtimeStatePath, '..'), { recursive: true });
    writeFileSync(
      runtimeStatePath,
      `${JSON.stringify({
        schemaVersion: '1.0.0',
        projects: {
          one: legacyProject(projectDir, 'namespaced', namespaced, source),
          two: legacyProject(secondProject, 'bare', bare, bareSource),
        },
      })}\n`,
    );

    await expect(
      previewSetup({ projectDir, cliVersion, runtime: 'codex', scope: 'user' }),
    ).rejects.toMatchObject({ code: 'E_RUNTIME_PREFIX_CONFLICT' });
  });

  it('defaults to user scope and never writes project files', async () => {
    const preview = await previewSetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
    });
    expect(preview.scope).toBe('user');
    expect(preview.actions.every((action) => action.scope === 'user')).toBe(true);
    expect(preview.projectContext).toMatchObject({ valid: true, reason: 'planr' });
    await applySetup({ projectDir, cliVersion, runtime: 'codex' });
    expect(existsSync(join(userHome, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(userHome, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(userHome, '.planr', 'runtime-lock.json'))).toBe(false);
  });

  it('accepts nested directories inside a Git worktree as project context', () => {
    const gitProject = join(root, 'git-project');
    const nested = join(gitProject, 'packages', 'app');
    mkdirSync(nested, { recursive: true });
    execFileSync('git', ['init', gitProject], { stdio: 'ignore' });
    expect(inspectProjectContext(nested)).toMatchObject({ valid: true, reason: 'git' });
  });

  it('gives Cursor project recovery without an unsupported user-scope alternative', async () => {
    const arbitrary = join(root, 'arbitrary');
    mkdirSync(arbitrary);
    const options = { projectDir: arbitrary, cliVersion, runtime: 'cursor' as const };
    await expect(previewSetup({ ...options, scope: 'user' })).rejects.toMatchObject({
      code: 'E_SCOPE_UNSUPPORTED',
      recovery: expect.stringContaining('Change into your project'),
    });
    for (const runtimes of [['cursor'], ['codex', 'cursor']] as const) {
      const error = await previewSetup({
        ...options,
        runtimes: [...runtimes],
        scope: 'project',
      }).catch((error) => error);
      expect(error).toMatchObject({
        code: 'E_PROJECT_CONTEXT_REQUIRED',
        recovery: expect.stringContaining('openplanr init'),
      });
      expect(error.recovery).not.toContain('--scope user');
    }
    expect(existsSync(join(arbitrary, '.planr'))).toBe(false);
  });

  it('offers user scope only when the selected integration supports it', async () => {
    const arbitrary = join(root, 'arbitrary');
    mkdirSync(arbitrary);
    const options = {
      projectDir: arbitrary,
      cliVersion,
      runtime: 'codex' as const,
      scope: 'project' as const,
    };
    const supported = await previewSetup(options).catch((error) => error);
    expect(supported.recovery).toContain('--scope user');
    const projectOnly = await previewSetup({ ...options, skillMode: 'project-rule' }).catch(
      (error) => error,
    );
    expect(projectOnly.recovery).not.toContain('--scope user');
  });

  it('cleans only recorded project-scoped files from a legacy home installation', async () => {
    const lock = join(userHome, '.planr', 'runtime-lock.json');
    const content = Buffer.from('{"legacy":true}\n');
    const agents = join(userHome, 'AGENTS.md');
    const managed = [
      '# Hand-written before',
      '<!-- ##planr-pipeline:begin## (managed by openplanr CLI; preserve hand-edits outside this block) -->',
      'managed policy',
      '<!-- ##planr-pipeline:end## -->',
      '# Hand-written after',
      '',
    ].join('\n');
    const managedBegin = managed.indexOf('<!-- ##planr-pipeline:begin##');
    const managedEnd =
      managed.indexOf('<!-- ##planr-pipeline:end## -->') + '<!-- ##planr-pipeline:end## -->'.length;
    const managedHash = createHash('sha256')
      .update(managed.slice(managedBegin, managedEnd))
      .digest('hex');
    mkdirSync(join(userHome, '.planr', 'runtime'), { recursive: true });
    writeFileSync(lock, content);
    writeFileSync(agents, managed);
    const key = canonicalProjectKey(userHome);
    writeFileSync(
      join(userHome, '.planr', 'runtime', 'state.json'),
      `${JSON.stringify({
        schemaVersion: '1.0.0',
        projects: {
          [key]: {
            projectDir: resolve(userHome),
            updatedAt: new Date().toISOString(),
            runtimes: [],
            ownedFiles: [
              {
                runtime: 'core',
                scope: 'project',
                target: lock,
                kind: 'file',
                hash: createHash('sha256').update(content).digest('hex'),
              },
              {
                runtime: 'codex',
                scope: 'project',
                target: agents,
                kind: 'managed-block',
                marker: 'pipeline',
                hash: managedHash,
              },
            ],
          },
        },
      })}\n`,
    );
    expect(await previewHomeProjectCleanup()).toEqual([lock, agents]);
    expect((await cleanupHomeProjectInstall()).removed).toEqual([lock, agents]);
    expect(existsSync(lock)).toBe(false);
    expect(readFileSync(agents, 'utf8')).toContain('# Hand-written before');
    expect(readFileSync(agents, 'utf8')).toContain('# Hand-written after');
    expect(readFileSync(agents, 'utf8')).not.toContain('managed policy');
  });

  it('keeps minimal setup a no-op outside project context', async () => {
    const arbitrary = join(root, 'cli-only');
    mkdirSync(arbitrary);
    const preview = await previewSetup({
      projectDir: arbitrary,
      cliVersion,
      runtime: 'cursor',
      scope: 'project',
      minimal: true,
    });
    expect(preview.actions).toEqual([]);
    expect(preview.runtimeOperations).toEqual([]);
    expect(existsSync(join(arbitrary, '.planr'))).toBe(false);
  });

  it('can add the full pipeline after a minimal planning-only setup', async () => {
    const minimal = await applySetup({
      projectDir,
      cliVersion,
      minimal: true,
      scope: 'both',
    });
    expect(minimal.pipelineVersion).toBeNull();
    expect(existsSync(join(projectDir, '.planr', 'runtime-lock.json'))).toBe(false);

    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'cursor',
      scope: 'project',
    });
    expect(existsSync(join(projectDir, '.planr', 'runtime-lock.json'))).toBe(true);
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'openplanr', 'planr-plan.mdc'))).toBe(
      true,
    );
  });

  it('installs host-native Claude skills and role agents without rewriting project policy', async () => {
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'claude-code',
      scope: 'project',
      manageExternalRuntimes: false,
    });

    expect(existsSync(join(projectDir, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(projectDir, '.claude', 'skills', 'plan', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.claude', 'agents', 'planr-specification.md'))).toBe(true);

    const doctor = await runtimeDoctor(projectDir);
    expect(doctor.diagnostics.find((item) => item.code === 'managed-files')).toMatchObject({
      status: 'pass',
    });
  });

  it('previews exact changes without writing', async () => {
    const preview = await previewSetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'both',
      dryRun: true,
    });
    expect(preview.actions.some((action) => action.target.endsWith('runtime-lock.json'))).toBe(
      true,
    );
    expect(existsSync(join(projectDir, '.planr', 'runtime-lock.json'))).toBe(false);
    expect(existsSync(join(userHome, '.codex', 'skills', 'plan', 'SKILL.md'))).toBe(false);
  });

  it('is idempotent, preserves hand content, and writes a valid runtime lock', async () => {
    writeFileSync(join(projectDir, 'AGENTS.md'), '# Hand-written policy\n');
    const first = await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'both',
    });
    expect(first.backupDir).toBeTruthy();
    const agents = readFileSync(join(projectDir, 'AGENTS.md'), 'utf8');
    expect(agents).toBe('# Hand-written policy\n');
    expect(existsSync(join(userHome, '.codex', 'skills', 'ship', 'SKILL.md'))).toBe(true);
    const lock = JSON.parse(readFileSync(join(projectDir, '.planr', 'runtime-lock.json'), 'utf8'));
    expect(validateProtocolArtifact('runtime-lock', lock, { protocolVersion: '1.18.0' })).toEqual(
      [],
    );
    expect(lock.protocolVersion).toBe(bundledAdapterRegistry.protocolVersion);
    expect(lock.skillModes).toEqual({ codex: 'direct' });
    expect(lock.components).toEqual({
      cli: cliVersion,
      pipeline: pipelineVersion,
      skills: bundledAdapterRegistry.pluginVersion,
    });
    expect(existsSync(join(userHome, '.codex', 'skills', 'artifact', 'SKILL.md'))).toBe(true);
    expect(lock.adapters).toHaveLength(1);

    const second = await previewSetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'both',
    });
    expect(second.actions.filter((action) => action.operation !== 'unchanged')).toEqual([]);

    appendFileSync(join(projectDir, 'AGENTS.md'), '\n# Later hand-written policy\n');
    const doctor = await runtimeDoctor(projectDir);
    expect(doctor.diagnostics.find((item) => item.code === 'managed-files')?.status).toBe('pass');
    expect(doctor.diagnostics.find((item) => item.code === 'host-skill-packages')).toMatchObject({
      status: 'pass',
    });
    expect(doctor.diagnostics.find((item) => item.code === 'runtime-lock')).toMatchObject({
      status: 'pass',
    });
    expect(doctor.diagnostics.find((item) => item.code === 'lock-drift')).toBeUndefined();
  });

  it('reports a runtime lock that pins an obsolete skill bundle', async () => {
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'project',
    });
    const lockPath = join(projectDir, '.planr', 'runtime-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lock.components.skills = '1.18.1';
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    const doctor = await runtimeDoctor(projectDir);

    expect(doctor.diagnostics.find((item) => item.code === 'lock-drift')).toMatchObject({
      status: 'fail',
      fix: 'Run `openplanr runtime update all --scope project`.',
    });
  });

  it('reports unsupported recorded discovery modes before accepting a matching lock digest', async () => {
    await applySetup({ projectDir, cliVersion, runtime: 'codex', scope: 'project' });
    const lockPath = join(projectDir, '.planr', 'runtime-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lock.skillModes.codex = 'unsupported';
    lock.manifestDigest = `sha256:${createHash('sha256')
      .update(
        JSON.stringify({
          protocol: lock.protocolVersion,
          pipelineVersion: lock.components.pipeline,
          adapters: lock.adapters,
          skillModes: lock.skillModes,
        }),
      )
      .digest('hex')}`;
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    const doctor = await runtimeDoctor(projectDir);
    expect(doctor.diagnostics.find((item) => item.code === 'runtime-lock-invalid')).toMatchObject({
      status: 'fail',
    });
    expect(doctor.diagnostics.find((item) => item.code === 'runtime-lock')).toBeUndefined();
  });

  it('keeps supported discovery modes in runtime lock digest verification', async () => {
    await applySetup({ projectDir, cliVersion, runtime: 'codex', scope: 'project' });
    const lockPath = join(projectDir, '.planr', 'runtime-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lock.skillModes.codex = 'direct';
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    const doctor = await runtimeDoctor(projectDir);
    expect(doctor.diagnostics.find((item) => item.code === 'lock-drift')).toMatchObject({
      status: 'fail',
    });
    expect(doctor.diagnostics.find((item) => item.code === 'runtime-lock-invalid')).toBeUndefined();
  });

  it('previews, applies, and diagnoses the managed Claude plugin release set', async () => {
    const skillsPath = join(root, 'claude-openplanr');
    const pluginState = {
      skillsVersion: '0.0.0',
      skillsIdentity: false,
    };
    const writeManifest = (pluginRoot: string, name: string, version: string) => {
      mkdirSync(join(pluginRoot, '.claude-plugin'), { recursive: true });
      writeFileSync(
        join(pluginRoot, '.claude-plugin', 'plugin.json'),
        `${JSON.stringify({ name, version })}\n`,
      );
      copyFileSync(
        join(bundledClaudePluginRoot, '.openplanr-content.json'),
        join(pluginRoot, '.openplanr-content.json'),
      );
    };
    const runner: ClaudeCommandRunner = (args) => {
      if (args[0] === '--version') return { status: 0, stdout: '2.1.0\n', stderr: '' };
      if (args[1] === 'marketplace' && args[2] === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify([{ name: 'openplanr-local', path: 'generated-local-package' }]),
          stderr: '',
        };
      }
      if (args[1] === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              id: 'planr@openplanr-local',
              version: pluginState.skillsVersion,
              scope: 'user',
              enabled: true,
              installPath: skillsPath,
            },
          ]),
          stderr: '',
        };
      }
      if (args[1] === 'marketplace' && args[2] === 'update') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[1] === 'update' && args[2] === 'planr@openplanr-local') {
        pluginState.skillsVersion = bundledAdapterRegistry.pluginVersion;
        pluginState.skillsIdentity = true;
        writeManifest(skillsPath, 'planr', bundledAdapterRegistry.pluginVersion);
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[1] === 'uninstall' && args[2] === 'planr@openplanr-local') {
        rmSync(skillsPath, { recursive: true, force: true });
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[1] === 'install' && args[2] === 'planr@openplanr-local') {
        pluginState.skillsVersion = bundledAdapterRegistry.pluginVersion;
        pluginState.skillsIdentity = true;
        writeManifest(skillsPath, 'planr', bundledAdapterRegistry.pluginVersion);
        return { status: 0, stdout: '', stderr: '' };
      }
      return {
        status: 1,
        stdout: '',
        stderr: `Unexpected Claude command: ${args.join(' ')}`,
      };
    };

    const preview = await previewSetup({
      projectDir,
      cliVersion,
      runtime: 'claude-code',
      scope: 'user',
      claudeCommandRunner: runner,
    });
    expect(preview.runtimeOperations.map((operation) => operation.kind)).toEqual([
      'refresh-marketplace',
      'update',
    ]);

    const applied = await applySetup({
      projectDir,
      cliVersion,
      runtime: 'claude-code',
      scope: 'user',
      claudeCommandRunner: runner,
    });
    expect(applied.restartRequired).toBe(true);
    expect(pluginState.skillsIdentity).toBe(true);
    expect(
      (await runtimeDoctor(projectDir, { claudeCommandRunner: runner })).diagnostics.find(
        (item) => item.code === 'runtime-claude-plugins',
      ),
    ).toMatchObject({ status: 'pass' });

    mkdirSync(join(skillsPath, 'commands'), { recursive: true });
    writeFileSync(join(skillsPath, 'commands', 'plan.md'), 'legacy command\n');
    expect(
      (await runtimeDoctor(projectDir, { claudeCommandRunner: runner })).diagnostics.find(
        (item) => item.code === 'runtime-claude-plugins',
      ),
    ).toMatchObject({ status: 'fail' });
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'claude-code',
      scope: 'user',
      claudeCommandRunner: runner,
    });
    expect(existsSync(join(skillsPath, 'commands'))).toBe(false);

    pluginState.skillsVersion = '0.0.0';
    rmSync(join(skillsPath, '.claude-plugin'), { recursive: true, force: true });
    expect(
      (await runtimeDoctor(projectDir, { claudeCommandRunner: runner })).diagnostics.find(
        (item) => item.code === 'runtime-claude-plugins',
      ),
    ).toMatchObject({
      status: 'fail',
      fix: 'Run `openplanr runtime update claude --scope user` and restart Claude Code.',
    });
  });

  it('retires a legacy OpenPlanr Claude plugin only with managed replacement enabled', async () => {
    const skillsPath = join(root, 'claude-openplanr-current');
    mkdirSync(join(skillsPath, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(skillsPath, '.claude-plugin', 'plugin.json'),
      `${JSON.stringify({ name: 'planr', version: bundledAdapterRegistry.pluginVersion })}\n`,
    );
    copyFileSync(
      join(bundledClaudePluginRoot, '.openplanr-content.json'),
      join(skillsPath, '.openplanr-content.json'),
    );
    let legacyInstalled = true;
    const calls: string[][] = [];
    const runner: ClaudeCommandRunner = (args) => {
      calls.push(args);
      if (args[0] === '--version') return { status: 0, stdout: '2.1.0\n', stderr: '' };
      if (args[1] === 'marketplace' && args[2] === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify([{ name: 'openplanr-local', path: 'generated-local-package' }]),
          stderr: '',
        };
      }
      if (args[1] === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              id: 'planr@openplanr-local',
              version: bundledAdapterRegistry.pluginVersion,
              scope: 'user',
              enabled: true,
              installPath: skillsPath,
            },
            ...(legacyInstalled
              ? [
                  {
                    id: 'openplanr@openplanr',
                    version: '0.1.0',
                    scope: 'user',
                    enabled: true,
                    installPath: join(root, 'legacy-claude-openplanr'),
                  },
                ]
              : []),
          ]),
          stderr: '',
        };
      }
      if (args[1] === 'marketplace' && args[2] === 'update') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[1] === 'uninstall' && args[2] === 'openplanr@openplanr') {
        legacyInstalled = false;
        return { status: 0, stdout: '', stderr: '' };
      }
      return {
        status: 1,
        stdout: '',
        stderr: `Unexpected Claude command: ${args.join(' ')}`,
      };
    };

    const preview = await previewSetup({
      projectDir,
      cliVersion,
      runtime: 'claude-code',
      scope: 'user',
      claudeCommandRunner: runner,
    });
    expect(preview.runtimeOperations.map(({ kind }) => kind)).toEqual([
      'refresh-marketplace',
      'remove',
    ]);
    expect(preview.runtimeDiagnostics).toContainEqual(
      expect.objectContaining({
        status: 'warn',
        message: 'Legacy Claude plugin installation detected: openplanr@openplanr',
      }),
    );

    await expect(
      applySetup({
        projectDir,
        cliVersion,
        runtime: 'claude-code',
        scope: 'user',
        claudeCommandRunner: runner,
      }),
    ).rejects.toMatchObject({ code: 'E_INSTALL_MODE_CONFLICT' });

    const applied = await applySetup({
      projectDir,
      cliVersion,
      runtime: 'claude-code',
      scope: 'user',
      replaceManaged: true,
      claudeCommandRunner: runner,
    });
    expect(applied.restartRequired).toBe(true);
    expect(legacyInstalled).toBe(false);
    expect(calls).toContainEqual([
      'plugin',
      'uninstall',
      'openplanr@openplanr',
      '--scope',
      'user',
      '--keep-data',
      '--yes',
    ]);
  });

  it('warns about a marketplace-installed planr@openplanr beside planr@openplanr-local without removing it', async () => {
    const skillsPath = join(root, 'claude-openplanr-current');
    mkdirSync(join(skillsPath, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(skillsPath, '.claude-plugin', 'plugin.json'),
      `${JSON.stringify({ name: 'planr', version: bundledAdapterRegistry.pluginVersion })}\n`,
    );
    copyFileSync(
      join(bundledClaudePluginRoot, '.openplanr-content.json'),
      join(skillsPath, '.openplanr-content.json'),
    );
    const calls: string[][] = [];
    const runner: ClaudeCommandRunner = (args) => {
      calls.push(args);
      if (args[0] === '--version') return { status: 0, stdout: '2.1.0\n', stderr: '' };
      if (args[1] === 'marketplace' && args[2] === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify([{ name: 'openplanr-local', path: 'generated-local-package' }]),
          stderr: '',
        };
      }
      if (args[1] === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              id: 'planr@openplanr-local',
              version: bundledAdapterRegistry.pluginVersion,
              scope: 'user',
              enabled: true,
              installPath: skillsPath,
            },
            {
              id: 'planr@openplanr',
              version: '2.6.1',
              scope: 'user',
              enabled: true,
              installPath: join(root, 'marketplace-claude-planr'),
            },
          ]),
          stderr: '',
        };
      }
      if (args[1] === 'marketplace' && args[2] === 'update') {
        return { status: 0, stdout: '', stderr: '' };
      }
      return {
        status: 1,
        stdout: '',
        stderr: `Unexpected Claude command: ${args.join(' ')}`,
      };
    };
    const uninstallCommand =
      'claude plugin uninstall planr@openplanr --scope user --keep-data --yes';

    const preview = await previewSetup({
      projectDir,
      cliVersion,
      runtime: 'claude-code',
      scope: 'user',
      claudeCommandRunner: runner,
    });
    expect(preview.runtimeOperations.map(({ kind }) => kind)).toEqual(['refresh-marketplace']);
    expect(preview.runtimeDiagnostics).toContainEqual(
      expect.objectContaining({
        status: 'warn',
        message: expect.stringContaining(
          'planr@openplanr installed beside the setup-managed planr@openplanr-local',
        ),
        fix: expect.stringContaining(uninstallCommand),
      }),
    );

    // No replacement prompt and no `--replace-managed` requirement: the duplicate stays.
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'claude-code',
      scope: 'user',
      claudeCommandRunner: runner,
    });
    expect(calls.some((args) => args[1] === 'uninstall')).toBe(false);

    const doctor = await runtimeDoctor(projectDir, { claudeCommandRunner: runner });
    expect(doctor.diagnostics.find((item) => item.code === 'runtime-claude-plugins')).toMatchObject(
      { status: 'pass' },
    );
    expect(
      doctor.diagnostics.find((item) => item.code === 'runtime-claude-duplicate-plugin'),
    ).toMatchObject({ status: 'warn', fix: expect.stringContaining(uninstallCommand) });
  });

  it('treats an unselected missing runtime as informational and a configured one as a warning', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const unconfigured = await runtimeDoctor(projectDir);
      expect(unconfigured.diagnostics.find((item) => item.code === 'runtime-cursor')).toMatchObject(
        {
          status: 'pass',
          message: 'cursor is not installed or configured',
        },
      );

      await applySetup({ projectDir, cliVersion, runtime: 'cursor', scope: 'project' });
      const configured = await runtimeDoctor(projectDir);
      expect(configured.diagnostics.find((item) => item.code === 'runtime-cursor')).toMatchObject({
        status: 'warn',
        message: 'cursor is configured but not detected',
      });
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('previews and applies pipeline stale-daemon repairs', async () => {
    const designState = join(userHome, '.planr', 'design-daemon');
    const dashboardState = join(userHome, '.planr', 'dashboard-daemon');
    mkdirSync(designState, { recursive: true });
    mkdirSync(dashboardState, { recursive: true });
    writeFileSync(join(designState, 'port'), '1\n');
    writeFileSync(join(dashboardState, 'port'), 'invalid\n');

    const preview = await runtimeDoctor(projectDir, { pipelineRepair: 'preview' });
    expect(preview.repairs).toHaveLength(2);
    expect(preview.repairs.every((repair) => repair.applied === false)).toBe(true);
    expect(existsSync(designState)).toBe(true);
    expect(existsSync(dashboardState)).toBe(true);

    const fixed = await runtimeDoctor(projectDir, { pipelineRepair: 'apply' });
    expect(fixed.repairs).toHaveLength(2);
    expect(fixed.repairs.every((repair) => repair.applied === true)).toBe(true);
    expect(existsSync(designState)).toBe(false);
    expect(existsSync(dashboardState)).toBe(false);
  });

  it('rolls migration back to exact prior bytes', async () => {
    const original = '# Keep exactly this\n\nCustom text.\n';
    const lockPath = join(projectDir, '.planr', 'runtime-lock.json');
    writeFileSync(lockPath, original);
    const setup = await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'both',
    });
    const result = await rollbackRuntime(projectDir, setup.backupDir);
    expect(result.restored).toContain(lockPath);
    expect(readFileSync(lockPath, 'utf8')).toBe(original);
    expect(existsSync(join(userHome, '.codex', 'skills', 'plan', 'SKILL.md'))).toBe(false);
  });

  it('rejects a backup manifest that substitutes an external source path', async () => {
    const original = '# Preserve exact prior bytes\n';
    const target = join(projectDir, '.planr', 'runtime-lock.json');
    writeFileSync(target, original);
    const setup = await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'both',
    });
    const manifestPath = join(setup.backupDir as string, 'migration-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: Array<{ target: string; backup?: string }>;
    };
    const entry = manifest.files.find((candidate) => candidate.target === target);
    if (!entry?.backup) throw new Error('missing runtime-lock backup fixture');
    const external = join(root, 'external-substitute.md');
    writeFileSync(external, 'hostile bytes\n');
    entry.backup = external;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(rollbackRuntime(projectDir, setup.backupDir)).rejects.toMatchObject({
      code: 'E_RUNTIME_STATE_INVALID',
    });
    expect(readFileSync(external, 'utf8')).toBe('hostile bytes\n');
    expect(readFileSync(target, 'utf8')).not.toBe(original);
  });

  it('rejects a symlink substituted for one manifest-bound backup file', async () => {
    const target = join(projectDir, '.planr', 'runtime-lock.json');
    writeFileSync(target, '# Prior policy\n');
    const setup = await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'both',
    });
    const manifest = JSON.parse(
      readFileSync(join(setup.backupDir as string, 'migration-manifest.json'), 'utf8'),
    ) as { files: Array<{ target: string; backup?: string }> };
    const entry = manifest.files.find((candidate) => candidate.target === target);
    if (!entry?.backup) throw new Error('missing runtime-lock backup fixture');
    const external = join(root, 'external-backup-source.md');
    writeFileSync(external, 'external bytes\n');
    unlinkSync(entry.backup);
    symlinkSync(external, entry.backup);

    await expect(rollbackRuntime(projectDir, setup.backupDir)).rejects.toMatchObject({
      code: 'E_RUNTIME_STATE_INVALID',
    });
    expect(readFileSync(external, 'utf8')).toBe('external bytes\n');
  });

  it('rejects substituted backup bytes before restoring any target', async () => {
    const target = join(projectDir, '.planr', 'runtime-lock.json');
    writeFileSync(target, '# Trusted prior policy\n');
    const setup = await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'both',
      manageExternalRuntimes: false,
    });
    const manifest = JSON.parse(
      readFileSync(join(setup.backupDir as string, 'migration-manifest.json'), 'utf8'),
    ) as { files: Array<{ target: string; backup?: string }> };
    const beforeTargets = new Map(
      manifest.files.map(
        (candidate) =>
          [
            candidate.target,
            existsSync(candidate.target) ? readFileSync(candidate.target) : null,
          ] as const,
      ),
    );
    const entry = manifest.files.find((candidate) => candidate.target === target);
    if (!entry?.backup) throw new Error('missing runtime-lock backup fixture');
    writeFileSync(entry.backup, 'substituted bytes\n');

    await expect(rollbackRuntime(projectDir, setup.backupDir)).rejects.toMatchObject({
      code: 'E_RUNTIME_STATE_INVALID',
    });
    for (const [trackedTarget, before] of beforeTargets) {
      expect(existsSync(trackedTarget), trackedTarget).toBe(before !== null);
      if (before) expect(readFileSync(trackedTarget), trackedTarget).toEqual(before);
    }
  }, 45_000);

  it('rejects an unrecorded direct-child empty backup without mutating ownership', async () => {
    const setup = await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'user',
    });
    const stateFile = join(userHome, '.planr', 'runtime', 'state.json');
    const beforeState = readFileSync(stateFile);
    const skill = join(userHome, '.codex', 'skills', 'operate', 'SKILL.md');
    const projectBackupRoot = join(userHome, '.planr', 'backups', canonicalProjectKey(projectDir));
    const forged = join(projectBackupRoot, 'forged-empty');
    mkdirSync(forged, { recursive: true });
    writeFileSync(
      join(forged, 'migration-manifest.json'),
      `${JSON.stringify({
        schemaVersion: '1.0.0',
        projectDir: resolve(projectDir),
        createdAt: '2026-08-20T00:00:00.000Z',
        files: [],
      })}\n`,
    );

    await expect(rollbackRuntime(projectDir, forged)).rejects.toMatchObject({
      code: 'E_RUNTIME_STATE_INVALID',
    });
    expect(readFileSync(stateFile)).toEqual(beforeState);
    expect(existsSync(skill)).toBe(true);
    expect(setup.backupDir).not.toBe(forged);
  });

  it('rejects the recorded backup when its ownership-state entry is missing', async () => {
    const setup = await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'user',
    });
    const stateFile = join(userHome, '.planr', 'runtime', 'state.json');
    const beforeState = readFileSync(stateFile);
    const skill = join(userHome, '.codex', 'skills', 'operate', 'SKILL.md');
    const manifestPath = join(setup.backupDir as string, 'migration-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: Array<{ target: string }>;
    };
    manifest.files = manifest.files.filter((entry) => resolve(entry.target) !== resolve(stateFile));
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(rollbackRuntime(projectDir, setup.backupDir)).rejects.toMatchObject({
      code: 'E_RUNTIME_STATE_INVALID',
    });
    expect(readFileSync(stateFile)).toEqual(beforeState);
    expect(existsSync(skill)).toBe(true);
  });

  it('rejects a forged backed-up ownership state even when its substituted hash matches', async () => {
    await applySetup({ projectDir, cliVersion, runtime: 'codex', scope: 'user' });
    const setup = await applySetup({
      projectDir,
      cliVersion: `${cliVersion}-next`,
      runtime: 'codex',
      scope: 'user',
    });
    const stateFile = join(userHome, '.planr', 'runtime', 'state.json');
    const beforeState = readFileSync(stateFile);
    const manifestPath = join(setup.backupDir as string, 'migration-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: Array<{ target: string; backup?: string; beforeHash?: string }>;
    };
    const stateEntry = manifest.files.find((entry) => resolve(entry.target) === resolve(stateFile));
    if (!stateEntry?.backup) throw new Error('missing ownership-state backup fixture');
    const forgedState = `${JSON.stringify({
      schemaVersion: '2.0.0',
      projects: {},
      userBundles: {},
    })}\n`;
    writeFileSync(stateEntry.backup, forgedState);
    stateEntry.beforeHash = createHash('sha256').update(forgedState).digest('hex');
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(rollbackRuntime(projectDir, setup.backupDir)).rejects.toMatchObject({
      code: 'E_RUNTIME_STATE_INVALID',
    });
    expect(readFileSync(stateFile)).toEqual(beforeState);
    expect(existsSync(join(userHome, '.codex', 'skills', 'operate', 'SKILL.md'))).toBe(true);
  });

  it('rejects a forged non-state after-hash and preserves the modified skill bytes', async () => {
    const setup = await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'user',
    });
    const skill = join(userHome, '.codex', 'skills', 'operate', 'SKILL.md');
    const unknownBytes = 'user-owned replacement bytes\n';
    writeFileSync(skill, unknownBytes);
    const manifestPath = join(setup.backupDir as string, 'migration-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: Array<{ target: string; afterHash?: string }>;
    };
    const entry = manifest.files.find((candidate) => candidate.target === skill);
    if (!entry?.afterHash) throw new Error('missing installed-skill transition fixture');
    entry.afterHash = createHash('sha256').update(unknownBytes).digest('hex');
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(rollbackRuntime(projectDir, setup.backupDir)).rejects.toMatchObject({
      code: 'E_RUNTIME_STATE_INVALID',
    });
    expect(readFileSync(skill, 'utf8')).toBe(unknownBytes);
  });

  it('rejects a recreated retirement target before rollback mutates any bytes', async () => {
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'user',
      skillMode: 'direct',
      manageExternalRuntimes: false,
    });
    const setup = await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'user',
      skillMode: 'unified-plugin',
      replaceManaged: true,
      manageExternalRuntimes: false,
    });
    const retired = join(userHome, '.codex', 'skills', 'operate', 'SKILL.md');
    expect(existsSync(retired)).toBe(false);
    mkdirSync(join(retired, '..'), { recursive: true });
    writeFileSync(retired, 'recreated unknown skill bytes\n');

    await expect(rollbackRuntime(projectDir, setup.backupDir)).rejects.toMatchObject({
      code: 'E_MIGRATION_CONFLICT',
    });
    expect(readFileSync(retired, 'utf8')).toBe('recreated unknown skill bytes\n');
  });

  it('removes only recorded owned files and preserves unknown user files', async () => {
    writeFileSync(join(projectDir, 'AGENTS.md'), '# user policy\n');
    writeFileSync(join(projectDir, 'USER-NOTES.md'), 'never remove\n');
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'project',
    });
    await removeRuntime('codex', projectDir);
    expect(readFileSync(join(projectDir, 'USER-NOTES.md'), 'utf8')).toBe('never remove\n');
    expect(readFileSync(join(projectDir, 'AGENTS.md'), 'utf8')).toContain('# user policy');
  });

  it('adds one adapter without changing existing adapter scope and updates the lock on removal', async () => {
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'cursor',
      scope: 'project',
    });
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'both',
      merge: true,
    });

    const lockPath = join(projectDir, '.planr', 'runtime-lock.json');
    let lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(lock.adapters).toMatchObject([
      { runtime: 'cursor', installScope: 'project' },
      { runtime: 'codex', installScope: 'both' },
    ]);
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'openplanr', 'planr-plan.mdc'))).toBe(
      true,
    );
    expect(existsSync(join(userHome, '.codex', 'skills', 'plan', 'SKILL.md'))).toBe(true);

    await removeRuntime('codex', projectDir);
    lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(lock.adapters).toMatchObject([{ runtime: 'cursor', installScope: 'project' }]);
    expect(lock.skillModes).toEqual({ cursor: 'project-rule' });
    expect(existsSync(join(userHome, '.codex', 'skills', 'plan', 'SKILL.md'))).toBe(false);
    const doctor = await runtimeDoctor(projectDir);
    expect(doctor.ok).toBe(true);
    expect(doctor.diagnostics.find((item) => item.code === 'runtime-lock')).toMatchObject({
      status: 'pass',
    });
  });

  it('retains shared user assets until the final project removes the runtime', async () => {
    const secondProject = join(root, 'project-two');
    mkdirSync(secondProject, { recursive: true });
    mkdirSync(join(secondProject, '.planr'));
    writeFileSync(join(secondProject, '.planr', 'config.json'), '{}\n');
    for (const targetProject of [projectDir, secondProject]) {
      await applySetup({
        projectDir: targetProject,
        cliVersion,
        runtime: 'codex',
        scope: 'both',
      });
    }

    const skill = join(userHome, '.codex', 'skills', 'plan', 'SKILL.md');
    const firstRemoval = await removeRuntime('codex', projectDir);
    expect(firstRemoval.retainedShared).toContain(skill);
    expect(existsSync(skill)).toBe(true);
    expect(existsSync(join(projectDir, '.planr', 'runtime-lock.json'))).toBe(false);

    const finalRemoval = await removeRuntime('codex', secondProject);
    expect(finalRemoval.removed).toContain(skill);
    expect(existsSync(skill)).toBe(false);
    expect(existsSync(join(secondProject, '.planr', 'runtime-lock.json'))).toBe(false);
  });

  it('does not roll back user assets that another project still owns', async () => {
    const secondProject = join(root, 'project-two');
    mkdirSync(secondProject, { recursive: true });
    mkdirSync(join(secondProject, '.planr'));
    writeFileSync(join(secondProject, '.planr', 'config.json'), '{}\n');
    const first = await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'both',
    });
    await applySetup({
      projectDir: secondProject,
      cliVersion,
      runtime: 'codex',
      scope: 'both',
    });

    const skill = join(userHome, '.codex', 'skills', 'plan', 'SKILL.md');
    const rollback = await rollbackRuntime(projectDir, first.backupDir);
    expect(rollback.retainedShared).toContain(skill);
    expect(existsSync(skill)).toBe(true);
  });

  it('preflights every owned file before removing any adapter bytes', async () => {
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'cursor',
      scope: 'project',
    });
    const firstAsset = join(projectDir, '.cursor', 'rules', 'openplanr', 'planr-artifact.mdc');
    const lateAsset = join(projectDir, '.cursor', 'rules', 'openplanr', 'planr-ship.mdc');
    writeFileSync(lateAsset, '# user changed this generated file\n');

    await expect(removeRuntime('cursor', projectDir)).rejects.toMatchObject({
      code: 'E_MIGRATION_CONFLICT',
    });
    expect(existsSync(firstAsset)).toBe(true);
    expect(existsSync(join(projectDir, '.planr', 'runtime-lock.json'))).toBe(true);
  });

  it('names concurrent setup conflicts', async () => {
    mkdirSync(join(userHome, '.planr', 'runtime'), { recursive: true });
    writeFileSync(join(userHome, '.planr', 'runtime', 'setup.lock'), 'busy');
    await expect(
      applySetup({
        projectDir,
        cliVersion,
        runtime: 'codex',
        scope: 'project',
      }),
    ).rejects.toMatchObject({ code: 'E_SETUP_BUSY' });
  });
});

describe('canonical host package naming', () => {
  const codexSkill = (name: string) => join(userHome, '.codex', 'skills', name, 'SKILL.md');
  const readState = () =>
    JSON.parse(readFileSync(join(userHome, '.planr', 'runtime', 'state.json'), 'utf8')) as {
      projects: Record<string, { commandPrefix?: string }>;
      userBundles?: { codex?: { commandPrefix?: string } };
    };

  it('installs short Codex discovery entries pointing to byte-identical cached sources', async () => {
    await applySetup({ projectDir, cliVersion, runtime: 'codex', scope: 'user' });

    expect(existsSync(codexSkill('plan'))).toBe(true);
    expect(existsSync(codexSkill('planr-plan'))).toBe(false);
    const source = readFileSync(join(bundledOpenAiSkillsRoot, 'plan', 'SKILL.md'));
    const locator = JSON.parse(
      readFileSync(join(userHome, '.codex', 'skills', 'plan', 'openplanr.install.json'), 'utf8'),
    );
    expect(readFileSync(join(locator.sourceRoot, locator.entryPath))).toEqual(source);
    expect(readFileSync(codexSkill('plan'), 'utf8')).toContain(locator.sourceRoot);
    expect(readState().userBundles?.codex?.commandPrefix).toBe('bare');
  });

  it('normalizes a legacy namespaced-prefix state record to short names on the next setup', async () => {
    await applySetup({ projectDir, cliVersion, runtime: 'codex', scope: 'user' });
    const statePath = join(userHome, '.planr', 'runtime', 'state.json');
    const legacy = readState();
    if (legacy.userBundles?.codex) legacy.userBundles.codex.commandPrefix = 'namespaced';
    writeFileSync(statePath, `${JSON.stringify(legacy, null, 2)}\n`);

    const preview = await previewSetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'user',
    });
    expect(preview.commandPrefix).toBe('bare');
    expect(
      preview.actions
        .filter(({ target }) => target.endsWith('SKILL.md'))
        .every(({ target }) => !target.includes(`${sep}planr-`)),
    ).toBe(true);

    await applySetup({ projectDir, cliVersion, runtime: 'codex', scope: 'user' });
    expect(readState().userBundles?.codex?.commandPrefix).toBe('bare');
    expect(existsSync(codexSkill('plan'))).toBe(true);
    expect(existsSync(codexSkill('planr-plan'))).toBe(false);
  });

  it('installs Cursor rules under the OpenPlanr namespace with canonical skill IDs', async () => {
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'cursor',
      scope: 'project',
    });

    const rules = join(projectDir, '.cursor', 'rules');
    expect(existsSync(join(rules, 'openplanr', 'planr-plan.mdc'))).toBe(true);
    expect(existsSync(join(rules, 'plan.mdc'))).toBe(false);
  });
});

describe('legacy Cursor cleanup', () => {
  it('retires unreachable generated Cursor workflow copies during project setup', async () => {
    const rules = join(projectDir, '.cursor', 'rules');
    const retired = [
      'planr-pipeline.mdc',
      'planr-pipeline-plan.mdc',
      'planr-pipeline-ship.mdc',
      'agents/backend-agent.md',
      'agents/db-agent.md',
      'agents/designer-agent.md',
      'agents/devops-agent.md',
      'agents/doc-gen-agent.md',
      'agents/entity-scaffold-agent.md',
      'agents/frontend-agent.md',
      'agents/qa-agent.md',
      'agents/specification-agent.md',
    ];
    for (const relative of retired) {
      const target = join(rules, relative);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(
        target,
        relative.startsWith('agents/')
          ? `> **Cursor adapter — synthesized from planr-pipeline.** Agent role system prompt (body-only). Used by \`/cursor/rules/planr-pipeline.mdc\` for Composer subagent dispatch.\n> Source: \`planr-pipeline/agents/${relative.slice('agents/'.length)}\`\n`
          : `${relative === 'planr-pipeline-ship.mdc' ? '.cursor/.snapshot-pending\n' : ''}*Generated by \`openplanr rules generate --target cursor --scope pipeline\`.*\n`,
      );
    }

    const preview = await previewSetup({
      projectDir,
      cliVersion,
      runtime: 'cursor',
      scope: 'project',
    });
    expect(
      preview.actions
        .filter(({ operation }) => operation === 'retire')
        .map(({ target }) => relative(rules, target))
        .sort(),
    ).toEqual([...retired].sort());

    await applySetup({ projectDir, cliVersion, runtime: 'cursor', scope: 'project' });
    expect(retired.filter((relative) => existsSync(join(rules, relative)))).toEqual([]);
    expect(existsSync(join(rules, 'openplanr', 'planr-plan.mdc'))).toBe(true);
    expect(existsSync(join(rules, 'openplanr', 'planr-ship.mdc'))).toBe(true);
  });

  it('preserves hand-authored bytes at a retired Cursor workflow path', async () => {
    const target = join(projectDir, '.cursor', 'rules', 'planr-pipeline.mdc');
    mkdirSync(join(target, '..'), { recursive: true });
    const handAuthored =
      '# Hand-authored project policy\n\nMentions *Generated by `openplanr rules generate --target cursor --scope pipeline`.* as migration history.\n\nKeep this policy.\n';
    writeFileSync(target, handAuthored);

    const preview = await previewSetup({
      projectDir,
      cliVersion,
      runtime: 'cursor',
      scope: 'project',
    });
    expect(preview.actions).not.toContainEqual(
      expect.objectContaining({ target, operation: 'retire' }),
    );

    await applySetup({ projectDir, cliVersion, runtime: 'cursor', scope: 'project' });
    expect(readFileSync(target, 'utf8')).toBe(handAuthored);
  });
});

// `setup` is the install path for every runtime, so a mid-apply failure must
// never leave a partially-wired install reporting success — and, per Trap E, must not
// silently leave partial state behind either. When the Claude plugin apply fails after
// owned files were already written, applySetup restores them from the backup it took
// before mutating and names every restored path in the error it surfaces.
describe('applySetup rollback on plugin failure', () => {
  // Inspection (`--version`, marketplace/plugin `list`) succeeds so setup writes its
  // owned files and reaches the apply step; the first mutating plugin command then
  // fails, injecting the mid-apply failure the rollback must recover from. Mirrors the
  // injected-runner pattern used by the managed-plugin test above.
  const failingRunner: ClaudeCommandRunner = (args) => {
    if (args[0] === '--version') return { status: 0, stdout: '2.1.0\n', stderr: '' };
    if (args[1] === 'marketplace' && args[2] === 'list')
      return { status: 0, stdout: '[]', stderr: '' };
    if (args[1] === 'list') return { status: 0, stdout: '[]', stderr: '' };
    return { status: 1, stdout: '', stderr: 'simulated marketplace outage' };
  };

  it('restores every owned file to its pre-setup state and names them in the error', async () => {
    const marker = join(userHome, '.planr', 'runtime', 'adapters', 'claude-code.json');
    const statePath = join(userHome, '.planr', 'runtime', 'state.json');
    // Nothing owned exists before the run, so the restore's job is to undo exactly
    // what this apply writes.
    expect(existsSync(marker)).toBe(false);

    let error: { code?: string; recovery?: string } | undefined;
    try {
      await applySetup({
        projectDir,
        cliVersion,
        runtime: 'claude-code',
        scope: 'user',
        claudeCommandRunner: failingRunner,
      });
    } catch (caught) {
      error = caught as { code?: string; recovery?: string };
    }

    // The failure is surfaced, never swallowed into a false success...
    expect(error).toBeDefined();
    expect(error?.code).toBe('E_CLAUDE_PLUGIN_UPDATE_FAILED');
    // ...and it states plainly what was restored, naming the exact path.
    expect(error?.recovery).toMatch(/Restored \d+ file\(s\) to their exact pre-setup bytes/u);
    expect(error?.recovery).toContain(marker);

    // The one owned file written before the failure was created fresh, so the restore
    // removes it — the install is back to its exact pre-setup state on disk...
    expect(existsSync(marker)).toBe(false);
    // ...and no half-migrated project record is left for a rerun to mistake for a
    // completed install.
    expect(existsSync(statePath)).toBe(false);
  });

  it('refuses an automatic restore from a symlink-swapped backup before mutating targets', async () => {
    const marker = join(userHome, '.planr', 'runtime', 'adapters', 'claude-code.json');
    mkdirSync(join(marker, '..'), { recursive: true });
    writeFileSync(marker, '{"prior":true}\n');
    const external = join(root, 'external-automatic-backup.json');
    writeFileSync(external, '{"external":true}\n');
    let beforeFailureTargets = new Map<string, Buffer | null>();
    let swapped = false;
    const hostileRunner: ClaudeCommandRunner = (args) => {
      if (args[0] === '--version') return { status: 0, stdout: '2.1.0\n', stderr: '' };
      if (args[1] === 'marketplace' && args[2] === 'list') {
        return { status: 0, stdout: '[]', stderr: '' };
      }
      if (args[1] === 'list') return { status: 0, stdout: '[]', stderr: '' };
      if (!swapped) {
        const rootPath = join(userHome, '.planr', 'backups', canonicalProjectKey(projectDir));
        const [stamp] = readdirSync(rootPath);
        const manifest = JSON.parse(
          readFileSync(join(rootPath, stamp, 'migration-manifest.json'), 'utf8'),
        ) as { files: Array<{ target: string; backup?: string }> };
        beforeFailureTargets = new Map(
          manifest.files.map(
            (entry) =>
              [entry.target, existsSync(entry.target) ? readFileSync(entry.target) : null] as const,
          ),
        );
        const markerEntry = manifest.files.find((entry) => entry.target === marker);
        if (!markerEntry?.backup) throw new Error('missing automatic-restore backup fixture');
        unlinkSync(markerEntry.backup);
        symlinkSync(external, markerEntry.backup);
        swapped = true;
      }
      return { status: 1, stdout: '', stderr: 'simulated marketplace outage' };
    };

    await expect(
      applySetup({
        projectDir,
        cliVersion,
        runtime: 'claude-code',
        scope: 'user',
        claudeCommandRunner: hostileRunner,
      }),
    ).rejects.toMatchObject({ code: 'E_SETUP_ROLLBACK_FAILED' });
    expect(swapped).toBe(true);
    for (const [target, before] of beforeFailureTargets) {
      expect(existsSync(target), target).toBe(before !== null);
      if (before) expect(readFileSync(target), target).toEqual(before);
    }
    expect(readFileSync(external, 'utf8')).toBe('{"external":true}\n');
  });
  it.each(['adapters/claude-code.json', 'state.json'])(
    'preserves concurrent %s bytes before any automatic restore',
    async (relativeTarget) => {
      const target = join(userHome, '.planr', 'runtime', relativeTarget);
      const concurrent = Buffer.from('{"concurrentEdit":true}\n');
      let currentTargets = new Map<string, Buffer | null>();
      let changed = false;
      const runner: ClaudeCommandRunner = (args) => {
        if (args[0] === '--version') return { status: 0, stdout: '2.1.0\n', stderr: '' };
        if (args[1] === 'marketplace' && args[2] === 'list')
          return { status: 0, stdout: '[]', stderr: '' };
        if (args[1] === 'list') return { status: 0, stdout: '[]', stderr: '' };
        if (!changed) {
          writeFileSync(target, concurrent);
          const backupRoot = join(userHome, '.planr', 'backups', canonicalProjectKey(projectDir));
          const [stamp] = readdirSync(backupRoot);
          const manifest = JSON.parse(
            readFileSync(join(backupRoot, stamp, 'migration-manifest.json'), 'utf8'),
          ) as { files: Array<{ target: string }> };
          currentTargets = new Map(
            manifest.files.map((entry) => [
              entry.target,
              existsSync(entry.target) ? readFileSync(entry.target) : null,
            ]),
          );
          changed = true;
        }
        return { status: 1, stdout: '', stderr: 'simulated marketplace outage' };
      };
      await expect(
        applySetup({
          projectDir,
          cliVersion,
          runtime: 'claude-code',
          scope: 'user',
          claudeCommandRunner: runner,
        }),
      ).rejects.toMatchObject({
        code: 'E_SETUP_ROLLBACK_FAILED',
        recovery: expect.stringContaining('backups'),
      });
      expect(changed).toBe(true);
      expect(readFileSync(target)).toEqual(concurrent);
      for (const [file, bytes] of currentTargets) {
        expect(existsSync(file), file).toBe(bytes !== null);
        if (bytes) expect(readFileSync(file), file).toEqual(bytes);
      }
    },
  );
});

// The non-guided `setup` preview must report what it skipped and why, not only in
// the guided wizard. This runs the real CLI as a subprocess (through the repo's tsx
// loader, so it exercises the current wiring without a stale build) against a
// fabricated real tuple: `codex` and `cursor` faked onto an isolated PATH with `claude`
// deliberately absent. `--runtime auto --scope user` then drops the project-only
// `cursor` as scope-incompatible and reports the undetected `claude-code`, both under
// one Skipped block.
describe('setup preview reports skipped runtimes', () => {
  const cliEntry = join(workspaceRoot, 'packages', 'cli', 'src', 'cli', 'index.ts');
  const tsxLoader = createRequire(import.meta.url).resolve('tsx');

  const fakeRuntime = (binDir: string, name: string) => {
    if (process.platform === 'win32') {
      // `.exe` is the one extension a bare `spawnSync(name)` resolves on Windows; a
      // copy of the Node binary answers `--version` with exit 0, so detection sees the
      // runtime as installed. A shell-script stub is not directly spawnable there.
      copyFileSync(process.execPath, join(binDir, `${name}.exe`));
    } else {
      writeFileSync(join(binDir, name), '#!/bin/sh\nexit 0\n');
      chmodSync(join(binDir, name), 0o755);
    }
  };

  it('prints a Skipped block naming a scope-incompatible and an undetected runtime', () => {
    const binDir = join(root, 'fake-bin');
    mkdirSync(binDir, { recursive: true });
    fakeRuntime(binDir, 'codex');
    fakeRuntime(binDir, 'cursor');

    // An isolated PATH holds only the two faked runtimes (so `claude` is genuinely
    // undetected and no real runtime installed on the host leaks in); System32 is kept
    // on Windows so the copied Node binary and CreateProcess still resolve.
    const pathSep = process.platform === 'win32' ? ';' : ':';
    const systemDirs =
      process.platform === 'win32' && process.env.SystemRoot
        ? [join(process.env.SystemRoot, 'System32')]
        : [];
    const isolatedPath = [binDir, ...systemDirs].join(pathSep);

    const output = execFileSync(
      process.execPath,
      [
        '--import',
        tsxLoader,
        cliEntry,
        '--project-dir',
        projectDir,
        'setup',
        '--runtime',
        'auto',
        '--scope',
        'user',
        '--dry-run',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: isolatedPath,
          OPENPLANR_HOME: userHome,
          OPENPLANR_STATE_ROOT: join(root, 'cli-state'),
          OPENPLANR_PIPELINE_ROOT: pipelineRoot,
          NO_COLOR: '1',
        },
      },
    );

    expect(output).toContain('Skipped:');
    expect(output).toContain('Cursor — requires project scope');
    expect(output).toContain('Claude Code — not detected on PATH');
  }, 30_000);
});

// The single warn/fail distinction doctor's lock-drift diagnostic and
// `openplanr upgrade status` both rely on. These four outcomes are
// the extracted behaviour; the existing `lock-drift` assertions above are the
// proof the extraction preserved doctor's own output.
describe('classifyComponentDrift', () => {
  it('passes when nothing drifted', () => {
    expect(
      classifyComponentDrift({ cliDrift: false, componentDrift: false, incompatibleDrift: false }),
    ).toEqual({ drift: false, genuineDrift: false, upgradeOnlyDrift: false, status: 'pass' });
  });

  it('warns when the CLI merely trails an upgrade and the tuple stays compatible', () => {
    expect(
      classifyComponentDrift({ cliDrift: true, componentDrift: true, incompatibleDrift: false }),
    ).toEqual({ drift: true, genuineDrift: false, upgradeOnlyDrift: true, status: 'warn' });
  });

  it('fails on a genuine incompatibility regardless of the CLI', () => {
    expect(
      classifyComponentDrift({ cliDrift: true, componentDrift: true, incompatibleDrift: true }),
    ).toEqual({ drift: true, genuineDrift: true, upgradeOnlyDrift: false, status: 'fail' });
  });

  it('fails on component drift the CLI does not explain (a pinned obsolete bundle)', () => {
    expect(
      classifyComponentDrift({ cliDrift: false, componentDrift: true, incompatibleDrift: false }),
    ).toEqual({ drift: true, genuineDrift: false, upgradeOnlyDrift: false, status: 'fail' });
  });
});

describe('native Codex profile ownership', () => {
  it('installs and removes alternate profile skills without retiring the default profile', async () => {
    const options = {
      projectDir,
      cliVersion,
      runtime: 'codex' as const,
      scope: 'user' as const,
      skillMode: 'direct' as const,
    };
    await applySetup(options);
    const defaultState = join(userHome, '.planr', 'runtime', 'state.json');
    const defaultSkill = join(userHome, '.codex', 'skills', 'design', 'SKILL.md');
    const originalBundle = JSON.parse(readFileSync(defaultState, 'utf8')).userBundles.codex;
    const originalSkill = readFileSync(defaultSkill);
    const nativeHome = join(root, 'ada');
    process.env.CODEX_HOME = nativeHome;
    const preview = await previewSetup(options);
    expect(
      preview.actions
        .filter((action) => action.runtime === 'codex' && action.scope === 'user')
        .every((action) => !action.target.includes('/.codex/skills/')),
    ).toBe(true);
    await applySetup(options);
    expect(readFileSync(join(nativeHome, 'skills', 'design', 'SKILL.md'))).toEqual(originalSkill);
    expect(JSON.parse(readFileSync(defaultState, 'utf8')).userBundles.codex).toEqual(
      originalBundle,
    );
    await removeRuntime('codex', projectDir);
    expect(existsSync(join(nativeHome, 'skills', 'design', 'SKILL.md'))).toBe(false);
    expect(readFileSync(defaultSkill)).toEqual(originalSkill);
    expect(JSON.parse(readFileSync(defaultState, 'utf8')).userBundles.codex).toEqual(
      originalBundle,
    );
  });
  it('uses one record for alternate profile paths referring to the same canonical home', async () => {
    const nativeHome = join(root, 'ada');
    const alias = join(root, 'ada-alias');
    mkdirSync(nativeHome, { recursive: true });
    symlinkSync(nativeHome, alias, 'dir');
    const options = {
      projectDir,
      cliVersion,
      runtime: 'codex' as const,
      scope: 'user' as const,
      skillMode: 'direct' as const,
    };
    process.env.CODEX_HOME = nativeHome;
    await applySetup(options);
    process.env.CODEX_HOME = alias;
    const preview = await previewSetup(options);
    expect(preview.actions.every((action) => action.operation === 'unchanged')).toBe(true);
  });
});

describe('Codex profile and named update custody', () => {
  const stateFile = () => join(userHome, '.planr', 'runtime', 'state.json');
  const state = () => JSON.parse(readFileSync(stateFile(), 'utf8'));
  function anotherProject(name: string) {
    const directory = join(root, name);
    mkdirSync(join(directory, '.planr'), { recursive: true });
    writeFileSync(join(directory, '.planr', 'config.json'), '{}\n');
    return directory;
  }
  it('keeps Claude ownership visible while an alternate Codex profile installs and removes its bundle', async () => {
    await applySetup({ projectDir, cliVersion, runtimes: ['claude-code', 'codex'], scope: 'user' });
    const before = state();
    const sharedRoot = runtimeRoot();
    const originalFiles = new Map<string, Buffer>(
      before.userBundles['claude-code'].ownedFiles.map((file: { target: string }) => [
        file.target,
        readFileSync(file.target),
      ]),
    );
    const alternateProject = anotherProject('alternate');
    process.env.CODEX_HOME = join(root, 'ada');
    expect(runtimeRoot()).toBe(sharedRoot);
    expect(await installedRuntimeScopes(alternateProject)).toContainEqual(
      expect.objectContaining({ runtime: 'claude-code', scope: 'user' }),
    );
    await applySetup({ projectDir: alternateProject, cliVersion, runtime: 'codex', scope: 'user' });
    expect(state().userBundles['claude-code']).toEqual(before.userBundles['claude-code']);
    expect(state().userBundles.codex).toEqual(before.userBundles.codex);
    await removeRuntime('codex', alternateProject);
    expect(existsSync(join(root, 'ada', 'skills', 'design', 'SKILL.md'))).toBe(false);
    expect(state().userBundles.codex).toEqual(before.userBundles.codex);
    for (const [target, bytes] of originalFiles) expect(readFileSync(target)).toEqual(bytes);
    expect(await installedRuntimeScopes(alternateProject)).toContainEqual(
      expect.objectContaining({ runtime: 'claude-code', scope: 'user' }),
    );
  });
  it('diagnoses and repairs a missing support file in the selected profile without touching other agents', async () => {
    await applySetup({ projectDir, cliVersion, runtimes: ['claude-code', 'codex'], scope: 'user' });
    const defaultBundles = state().userBundles;
    const alternateProject = anotherProject('alternate');
    process.env.CODEX_HOME = join(root, 'ada');
    await applySetup({ projectDir: alternateProject, cliVersion, runtime: 'codex', scope: 'user' });
    const support = join(
      realpathSync(join(root, 'ada')),
      'skills',
      'design',
      'openplanr.skill.json',
    );
    const original = readFileSync(support);
    rmSync(support);
    const codexCommandRunner = (args: string[]) => ({
      status: 0,
      stdout:
        args[0] === '--version'
          ? 'codex 0.159.1'
          : args[1] === 'marketplace'
            ? '{"marketplaces":[]}'
            : '[]',
      stderr: '',
    });
    const diagnosis = await runtimeDoctor(alternateProject, { codexCommandRunner });
    expect(diagnosis.codexDiscovery).toMatchObject({
      effectiveHome: realpathSync(join(root, 'ada')),
      mode: 'direct',
      ownershipStatePath: stateFile(),
    });
    expect(
      diagnosis.codexDiscovery?.skills.find((skill) => skill.skillId === 'planr-design')
        ?.resolution,
    ).toBe('unreadable');
    expect(
      diagnosis.diagnostics.find((entry) => entry.code === 'runtime-codex-skill-resolution'),
    ).toMatchObject({ status: 'warn' });
    const options = {
      projectDir: alternateProject,
      cliVersion,
      runtime: 'codex' as const,
      scope: 'user' as const,
      preserveExistingScopes: true,
      replaceManaged: true,
    };
    expect(
      (await previewSetup(options)).actions.find((action) => action.target === support)?.operation,
    ).toBe('create');
    await applySetup(options);
    expect(readFileSync(support)).toEqual(original);
    expect(state().userBundles).toEqual(defaultBundles);
    const repaired = await runtimeDoctor(alternateProject, { codexCommandRunner });
    expect(
      repaired.codexDiscovery?.skills.find((skill) => skill.skillId === 'planr-design')?.resolution,
    ).toBe('current');
  });
  it('rejects a profile bundle claiming another profile target before removal', async () => {
    await applySetup({ projectDir, cliVersion, runtime: 'codex', scope: 'user' });
    const defaultBundle = state().userBundles.codex;
    const alternateProject = anotherProject('alternate');
    process.env.CODEX_HOME = join(root, 'ada');
    await applySetup({ projectDir: alternateProject, cliVersion, runtime: 'codex', scope: 'user' });
    const recorded = state();
    const profile = Object.values(recorded.codexProfiles)[0] as {
      bundle: { ownedFiles: unknown[] };
    };
    profile.bundle.ownedFiles.push(defaultBundle.ownedFiles[0]);
    writeFileSync(stateFile(), `${JSON.stringify(recorded)}\n`);
    const before = readFileSync(stateFile());
    const target = defaultBundle.ownedFiles[0].target;
    const bytes = readFileSync(target);
    await expect(removeRuntime('codex', alternateProject)).rejects.toMatchObject({
      code: 'E_RUNTIME_STATE_INVALID',
    });
    expect(readFileSync(stateFile())).toEqual(before);
    expect(readFileSync(target)).toEqual(bytes);
  });
  it('uses the shared setup lock across Codex profiles before writing anything', async () => {
    await applySetup({ projectDir, cliVersion, runtime: 'codex', scope: 'user' });
    const original = readFileSync(stateFile());
    const lock = join(runtimeRoot(), 'setup.lock');
    writeFileSync(lock, 'owned competing setup\n');
    process.env.CODEX_HOME = join(root, 'ada');
    await expect(
      applySetup({ projectDir, cliVersion, runtime: 'codex', scope: 'user' }),
    ).rejects.toMatchObject({ code: 'E_SETUP_BUSY' });
    expect(readFileSync(stateFile())).toEqual(original);
    expect(readFileSync(lock, 'utf8')).toBe('owned competing setup\n');
    expect(existsSync(join(root, 'ada', 'skills'))).toBe(false);
  });
  it('rolls back only the selected profile while preserving the default Codex and Claude bundles', async () => {
    await applySetup({ projectDir, cliVersion, runtimes: ['claude-code', 'codex'], scope: 'user' });
    const before = state();
    const alternateProject = anotherProject('alternate');
    process.env.CODEX_HOME = join(root, 'ada');
    const installed = await applySetup({
      projectDir: alternateProject,
      cliVersion,
      runtime: 'codex',
      scope: 'user',
    });
    await rollbackRuntime(alternateProject, installed.backupDir);
    expect(state().userBundles).toEqual(before.userBundles);
    expect(existsSync(join(root, 'ada', 'skills', 'design', 'SKILL.md'))).toBe(false);
    expect(
      readFileSync(join(userHome, '.codex', 'skills', 'design', 'SKILL.md'), 'utf8'),
    ).toContain('Design');
  });
  it('preserves saved plugin mode and mixed scopes while updating only Codex in a multi-agent project', async () => {
    await applySetup({
      projectDir,
      cliVersion,
      runtimes: ['claude-code', 'codex', 'cursor'],
      scope: 'both',
      skillMode: 'unified-plugin',
    });
    const before = state();
    const project = before.projects[canonicalProjectKey(projectDir)];
    const untouched = new Map<string, Buffer>(
      project.ownedFiles
        .filter((file: { runtime: string }) => ['claude-code', 'cursor'].includes(file.runtime))
        .map((file: { target: string }) => [file.target, readFileSync(file.target)]),
    );
    const options = {
      projectDir,
      cliVersion,
      runtime: 'codex' as const,
      scope: 'user' as const,
      preserveExistingScopes: true,
    };
    const preview = await previewSetup(options);
    expect(preview.runtimes).toEqual(['codex']);
    expect(preview.runtimeScopes.codex).toBe('both');
    expect(preview.skillModes.codex).toBe('unified-plugin');
    expect(preview.actions.every((action) => ['core', 'codex'].includes(action.runtime))).toBe(
      true,
    );
    expect(preview.runtimeOperations.every((operation) => operation.runtime === 'codex')).toBe(
      true,
    );
    await applySetup(options);
    const after = state();
    expect(after.userBundles['claude-code']).toEqual(before.userBundles['claude-code']);
    expect(after.projects[canonicalProjectKey(projectDir)].runtimes).toEqual(project.runtimes);
    expect(after.projects[canonicalProjectKey(projectDir)].runtimeScopes).toEqual(
      project.runtimeScopes,
    );
    const lock = JSON.parse(readFileSync(join(projectDir, '.planr', 'runtime-lock.json'), 'utf8'));
    expect(lock.adapters.map((adapter: { runtime: string }) => adapter.runtime)).toEqual(
      project.runtimes,
    );
    expect(lock.skillModes.codex).toBe('unified-plugin');
    for (const [target, bytes] of untouched) expect(readFileSync(target)).toEqual(bytes);
  });
  it('honors an explicit user scope and retires only the named agent project files with exact rollback', async () => {
    await applySetup({
      projectDir,
      cliVersion,
      runtimes: ['claude-code', 'codex', 'cursor'],
      scope: 'both',
      skillMode: 'unified-plugin',
    });
    const before = state();
    const project = before.projects[canonicalProjectKey(projectDir)];
    const originals = new Map<string, Buffer>(
      project.ownedFiles.map((file: { target: string }) => [
        file.target,
        readFileSync(file.target),
      ]),
    );
    const options = {
      projectDir,
      cliVersion,
      runtime: 'codex' as const,
      scope: 'user' as const,
      preserveExistingScopes: true,
      overrideExistingScope: true,
    };
    const preview = await previewSetup(options);
    expect(preview.runtimes).toEqual(['codex']);
    expect(preview.runtimeScopes).toMatchObject({
      codex: 'user',
      'claude-code': 'both',
      cursor: 'project',
    });
    expect(preview.skillModes.codex).toBe('unified-plugin');
    const retired = preview.actions.filter((action) => action.operation === 'retire');
    expect(retired.length).toBeGreaterThan(0);
    expect(
      retired.every((action) => action.runtime === 'codex' && action.scope === 'project'),
    ).toBe(true);
    const result = await applySetup(options);
    expect(state().projects[canonicalProjectKey(projectDir)].runtimeScopes.codex).toBe('user');
    for (const action of retired) expect(existsSync(action.target)).toBe(false);
    for (const file of project.ownedFiles.filter((file: { runtime: string }) =>
      ['claude-code', 'cursor'].includes(file.runtime),
    ))
      expect(readFileSync(file.target)).toEqual(originals.get(file.target));
    await rollbackRuntime(projectDir, result.backupDir);
    expect(state().projects[canonicalProjectKey(projectDir)]).toEqual(project);
    for (const [target, bytes] of originals) expect(readFileSync(target)).toEqual(bytes);
  });
  it('refuses an explicit scope narrowing before writes when a managed project file was modified', async () => {
    await applySetup({
      projectDir,
      cliVersion,
      runtimes: ['codex', 'cursor'],
      scope: 'both',
      skillMode: 'unified-plugin',
    });
    const file = state().projects[canonicalProjectKey(projectDir)].ownedFiles.find(
      (file: { runtime: string; kind: string }) => file.runtime === 'codex' && file.kind === 'file',
    );
    const changed = Buffer.concat([readFileSync(file.target), Buffer.from('\nhand edit\n')]);
    writeFileSync(file.target, changed);
    const originalState = readFileSync(stateFile());
    const options = {
      projectDir,
      cliVersion,
      runtime: 'codex' as const,
      scope: 'user' as const,
      preserveExistingScopes: true,
      overrideExistingScope: true,
    };
    await expect(previewSetup(options)).rejects.toMatchObject({ code: 'E_MIGRATION_CONFLICT' });
    await expect(applySetup(options)).rejects.toMatchObject({ code: 'E_MIGRATION_CONFLICT' });
    expect(readFileSync(file.target)).toEqual(changed);
    expect(readFileSync(stateFile())).toEqual(originalState);
  });
});

describe('thin project installations', () => {
  it.each(['claude-code', 'codex'] as const)(
    'keeps user-only %s native packages complete without an unused home cache',
    async (runtime) => {
      const result = await applySetup({
        projectDir,
        cliVersion,
        runtime,
        scope: 'user',
        manageExternalRuntimes: false,
        ...(runtime === 'codex' ? { skillMode: 'unified-plugin' as const } : {}),
      });
      expect(result.actions.some((action) => action.target.includes('/runtime/packages/'))).toBe(
        false,
      );
      expect(existsSync(join(userHome, '.planr', 'runtime', 'packages'))).toBe(false);
    },
  );
  it.each(['claude-code', 'codex', 'cursor'] as const)(
    'diagnoses a missing full runtime closure behind %s thin discovery',
    async (runtime) => {
      const result = await applySetup({
        projectDir,
        cliVersion,
        runtime,
        scope: 'project',
        manageExternalRuntimes: false,
        ...(runtime === 'codex' ? { skillMode: 'direct' as const } : {}),
      });
      const support = result.actions.find(
        (action) => action.target.includes('/runtime/packages/') && action.target.endsWith('.mjs'),
      );
      expect(support).toBeDefined();
      if (!support) throw new Error('No packaged support file was installed.');
      unlinkSync(support.target);
      const diagnosed = await runtimeDoctor(projectDir);
      expect(
        diagnosed.diagnostics.find((entry) => entry.code === 'runtime-package-custody')?.status,
      ).toBe('fail');
      await applySetup({
        projectDir,
        cliVersion,
        runtime,
        scope: 'project',
        manageExternalRuntimes: false,
        ...(runtime === 'codex' ? { skillMode: 'direct' as const } : {}),
      });
      expect(
        (await runtimeDoctor(projectDir)).diagnostics.find(
          (entry) => entry.code === 'runtime-package-custody',
        )?.status,
      ).toBe('pass');
    },
  );
  it.each(['claude-code', 'codex', 'cursor'] as const)(
    'resolves every %s project resource from an exact offline package',
    async (runtime) => {
      const options = {
        projectDir,
        cliVersion,
        runtime,
        scope: 'project' as const,
        manageExternalRuntimes: false,
        ...(runtime === 'codex' ? { skillMode: 'direct' as const } : {}),
      };
      const applied = await applySetup(options);
      const projectActions = applied.actions.filter((action) => action.scope === 'project');
      expect(
        projectActions.every(
          (action) => !/\/(?:schemas|scripts|references)\//u.test(action.target),
        ),
      ).toBe(true);
      const cacheFiles = applied.actions.filter(
        (action) => action.runtime === 'core' && action.scope === 'user',
      );
      expect(cacheFiles.length).toBeGreaterThan(projectActions.length);
      expect(
        cacheFiles.every((action) => action.target.includes(`${sep}runtime${sep}packages${sep}`)),
      ).toBe(true);
      if (runtime === 'claude-code') {
        let referenceCount = 0;
        for (const file of regularFiles(join(projectDir, '.claude', 'agents'))) {
          const markdown = readFileSync(file, 'utf8');
          expect(markdown).not.toContain('${CLAUDE_PLUGIN_ROOT}');
          const references = [...markdown.matchAll(/(?:`|\s)(\/[^\s`]+\/references\/[^\s`]+)/gu)];
          referenceCount += references.length;
          for (const reference of references) {
            for (const mode of ['default', 'spec-driven']) {
              const resolved = reference[1].replaceAll('${MODE}', mode);
              expect(existsSync(resolved.includes('*') ? dirname(resolved) : resolved)).toBe(true);
            }
          }
        }
        expect(referenceCount).toBeGreaterThan(0);
      }
      expect(
        (await previewSetup(options)).actions.every((action) => action.operation === 'unchanged'),
      ).toBe(true);
    },
  );
  it('keeps a single Codex discovery source for both scope', async () => {
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'both',
      skillMode: 'direct',
      manageExternalRuntimes: false,
    });
    expect(existsSync(join(userHome, '.codex', 'skills', 'plan', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.agents', 'skills', 'plan', 'SKILL.md'))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(projectDir, '.planr', 'runtime-policy', 'codex.json'), 'utf8')),
    ).toMatchObject({ discovery: 'user', mode: 'direct' });
  });
  it('writes through the actual CLI with an explicit Planr home and native profile outside the user home', () => {
    const cliRequire = createRequire(import.meta.url);
    const explicitHome = join(root, 'explicit-planr-home');
    const profile = join(root, 'explicit-codex-home');
    const environment = {
      ...process.env,
      PLANR_HOME: explicitHome,
      CODEX_HOME: profile,
      OPENPLANR_HOME: '',
      PATH: '',
    };
    const args = [
      '--import',
      cliRequire.resolve('tsx/esm'),
      join(workspaceRoot, 'packages/cli/src/cli/index.ts'),
      '--project-dir',
      projectDir,
      'setup',
      '--runtime',
      'codex',
      '--scope',
      'project',
      '--skill-mode',
      'direct',
      '--yes',
      '--json',
    ];
    const result = JSON.parse(
      execFileSync(process.execPath, args, { env: environment, encoding: 'utf8' }),
    );
    expect(result.ok).toBe(true);
    expect(result.runtimeOperations).toEqual([]);
    expect(existsSync(join(explicitHome, 'runtime', 'state.json'))).toBe(true);
    expect(existsSync(join(profile, 'config.toml'))).toBe(false);
    const previewArgs = [...args.slice(0, -2), '--dry-run', '--json'];
    const preview = JSON.parse(
      execFileSync(process.execPath, previewArgs, { env: environment, encoding: 'utf8' }),
    );
    expect(
      preview.actions.every((action: { operation: string }) => action.operation === 'unchanged'),
    ).toBe(true);
  });
});
