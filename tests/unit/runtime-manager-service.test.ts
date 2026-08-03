import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ClaudeCommandRunner,
  OPENPLANR_SKILLS_VERSION,
} from '../../src/services/claude-plugin-service.js';
import {
  applySetup,
  classifyComponentDrift,
  cleanupHomeProjectInstall,
  inspectProjectContext,
  previewHomeProjectCleanup,
  previewSetup,
  removeRuntime,
  rollbackRuntime,
  runtimeDoctor,
} from '../../src/services/runtime-manager-service.js';

let root: string;
let projectDir: string;
let userHome: string;
const cliVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version as string;
const pipelineRoot = process.env.OPENPLANR_PIPELINE_ROOT ?? resolve('../planr-pipeline');
const pipelineVersion = JSON.parse(readFileSync(join(pipelineRoot, 'package.json'), 'utf8'))
  .version as string;

beforeEach(() => {
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
  delete process.env.OPENPLANR_HOME;
  delete process.env.OPENPLANR_PIPELINE_ROOT;
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('runtime setup', () => {
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

  it('rejects project writes outside Git and initialized Planr projects', async () => {
    const arbitrary = join(root, 'arbitrary');
    mkdirSync(arbitrary);
    await expect(
      previewSetup({ projectDir: arbitrary, cliVersion, runtime: 'cursor', scope: 'project' }),
    ).rejects.toMatchObject({ code: 'E_PROJECT_CONTEXT_REQUIRED' });
  });

  it('cleans only recorded project-scoped files from a legacy home installation', async () => {
    const lock = join(userHome, '.planr', 'runtime-lock.json');
    const content = Buffer.from('{"legacy":true}\n');
    const agents = join(userHome, 'AGENTS.md');
    const managed = [
      '# Hand-written before',
      '<!-- ##planr-pipeline:begin## (managed by planr CLI; preserve hand-edits outside this block) -->',
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
    const key = createHash('sha256').update(resolve(userHome)).digest('hex').slice(0, 16);
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
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'openplanr.mdc'))).toBe(true);
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'openplanr-operate.mdc'))).toBe(true);
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
    expect(existsSync(join(userHome, '.codex', 'skills', 'planr-plan', 'SKILL.md'))).toBe(false);
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
    expect(agents).toContain('# Hand-written policy');
    expect(agents).toContain('OpenPlanr runtime policy');
    expect(existsSync(join(userHome, '.codex', 'skills', 'planr-ship', 'SKILL.md'))).toBe(true);
    const lock = JSON.parse(readFileSync(join(projectDir, '.planr', 'runtime-lock.json'), 'utf8'));
    expect(lock.components).toEqual({
      cli: cliVersion,
      pipeline: pipelineVersion,
      skills: '1.23.0',
    });
    expect(existsSync(join(userHome, '.codex', 'skills', 'planr-artifact', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(userHome, '.codex', 'skills', 'planr-operate', 'SKILL.md'))).toBe(true);
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
    expect(doctor.diagnostics.find((item) => item.code === 'skill-commands')).toMatchObject({
      status: 'pass',
      message: 'Installed Codex skills reference public planr commands only',
    });
    expect(doctor.diagnostics.find((item) => item.code === 'operate-skill')).toMatchObject({
      status: 'pass',
      message:
        'Installed planr-operate skill references the public CLI and preserves the SHIP boundary',
    });
    expect(doctor.diagnostics.find((item) => item.code === 'operate-protocol')).toMatchObject({
      status: 'pass',
    });
  });

  it('reports questionnaire-first operate skills as stale', async () => {
    await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'user',
    });
    const skillPath = join(userHome, '.codex', 'skills', 'planr-operate', 'SKILL.md');
    const content = readFileSync(skillPath, 'utf8').replace(
      /## Default invocation[\s\S]*?## Research and runtime rules/u,
      '## Research and runtime rules',
    );
    writeFileSync(skillPath, content);

    const doctor = await runtimeDoctor(projectDir);
    expect(doctor.diagnostics.find((item) => item.code === 'operate-skill')).toMatchObject({
      status: 'fail',
      message: 'Installed planr-operate skill does not satisfy the functional command contract',
      fix: 'Run `planr setup --runtime codex --scope user` to refresh the managed skill.',
    });
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
      fix: 'Run `planr runtime update all --scope project`.',
    });
  });

  it('previews, applies, and diagnoses the managed Claude plugin release set', async () => {
    const skillsPath = join(root, 'claude-openplanr');
    const pipelinePath = join(root, 'claude-pipeline');
    const pluginState = {
      skillsVersion: '1.18.1',
      skillsIdentity: false,
    };
    const writeManifest = (pluginRoot: string, name: string, version: string) => {
      mkdirSync(join(pluginRoot, '.claude-plugin'), { recursive: true });
      writeFileSync(
        join(pluginRoot, '.claude-plugin', 'plugin.json'),
        `${JSON.stringify({ name, version })}\n`,
      );
    };
    writeManifest(pipelinePath, 'planr-pipeline', pipelineVersion);
    const runner: ClaudeCommandRunner = (args) => {
      if (args[0] === '--version') return { status: 0, stdout: '2.1.0\n', stderr: '' };
      if (args[1] === 'marketplace' && args[2] === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify([{ name: 'openplanr', repo: 'openplanr/marketplace' }]),
          stderr: '',
        };
      }
      if (args[1] === 'list') {
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              id: 'openplanr@openplanr',
              version: pluginState.skillsVersion,
              scope: 'user',
              enabled: true,
              installPath: skillsPath,
            },
            {
              id: 'planr-pipeline@openplanr',
              version: pipelineVersion,
              scope: 'user',
              enabled: true,
              installPath: pipelinePath,
            },
          ]),
          stderr: '',
        };
      }
      if (args[1] === 'marketplace' && args[2] === 'update') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[1] === 'update' && args[2] === 'openplanr@openplanr') {
        pluginState.skillsVersion = OPENPLANR_SKILLS_VERSION;
        pluginState.skillsIdentity = true;
        writeManifest(skillsPath, 'openplanr', OPENPLANR_SKILLS_VERSION);
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

    pluginState.skillsVersion = '1.18.1';
    rmSync(join(skillsPath, '.claude-plugin'), { recursive: true, force: true });
    expect(
      (await runtimeDoctor(projectDir, { claudeCommandRunner: runner })).diagnostics.find(
        (item) => item.code === 'runtime-claude-plugins',
      ),
    ).toMatchObject({
      status: 'fail',
      fix: 'Run `planr runtime update claude --scope user` and restart Claude Code.',
    });
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
    writeFileSync(join(projectDir, 'AGENTS.md'), original);
    const setup = await applySetup({
      projectDir,
      cliVersion,
      runtime: 'codex',
      scope: 'both',
    });
    const result = await rollbackRuntime(projectDir, setup.backupDir);
    expect(result.restored).toContain(join(projectDir, 'AGENTS.md'));
    expect(readFileSync(join(projectDir, 'AGENTS.md'), 'utf8')).toBe(original);
    expect(existsSync(join(projectDir, '.planr', 'runtime-lock.json'))).toBe(false);
    expect(existsSync(join(userHome, '.codex', 'skills', 'planr-plan', 'SKILL.md'))).toBe(false);
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
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'openplanr.mdc'))).toBe(true);
    expect(existsSync(join(projectDir, '.cursor', 'rules', 'openplanr-operate.mdc'))).toBe(true);
    expect(existsSync(join(userHome, '.codex', 'skills', 'planr-plan', 'SKILL.md'))).toBe(true);

    const doctor = await runtimeDoctor(projectDir);
    expect(doctor.diagnostics.find((item) => item.code === 'operate-cursor-rule')).toMatchObject({
      status: 'pass',
      message:
        'Installed Cursor Operating Board rule references the public CLI and preserves the SHIP boundary',
    });

    await removeRuntime('codex', projectDir);
    lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(lock.adapters).toMatchObject([{ runtime: 'cursor', installScope: 'project' }]);
    expect(existsSync(join(userHome, '.codex', 'skills', 'planr-plan', 'SKILL.md'))).toBe(false);
    expect((await runtimeDoctor(projectDir)).ok).toBe(true);
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

    const skill = join(userHome, '.codex', 'skills', 'planr-plan', 'SKILL.md');
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

    const skill = join(userHome, '.codex', 'skills', 'planr-plan', 'SKILL.md');
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
    const firstAsset = join(projectDir, '.cursor', 'rules', 'openplanr.mdc');
    const lateAsset = join(projectDir, '.cursor', 'rules', 'openplanr-roles', 'doc-gen-agent.md');
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

// The single warn/fail distinction doctor's lock-drift diagnostic and
// `planr upgrade status` both rely on (SPEC-006 FR3). These four outcomes are
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
