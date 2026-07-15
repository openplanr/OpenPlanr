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
  applySetup,
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
  rmSync(root, { recursive: true, force: true });
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
    expect(lock.components).toEqual({ cli: cliVersion, pipeline: '0.27.1', skills: '1.13.0' });
    expect(existsSync(join(userHome, '.codex', 'skills', 'planr-artifact', 'SKILL.md'))).toBe(true);
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
    expect(existsSync(join(userHome, '.codex', 'skills', 'planr-plan', 'SKILL.md'))).toBe(true);

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
