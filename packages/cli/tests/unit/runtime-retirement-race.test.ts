import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const race = vi.hoisted(() => ({
  callback: undefined as (() => void) | undefined,
  trigger: 'migration-manifest.json.',
  operation: 'writeFile' as 'writeFile' | 'mkdir',
}));
vi.mock('node:fs/promises', async (original) => {
  const filesystem = await original<typeof import('node:fs/promises')>();
  return {
    ...filesystem,
    writeFile: async (...args: Parameters<typeof filesystem.writeFile>) => {
      const result = await filesystem.writeFile(...args);
      if (
        race.operation === 'writeFile' &&
        String(args[0]).includes(race.trigger) &&
        race.callback
      ) {
        const callback = race.callback;
        race.callback = undefined;
        callback();
      }
      return result;
    },
    mkdir: async (...args: Parameters<typeof filesystem.mkdir>) => {
      const result = await filesystem.mkdir(...args);
      if (race.operation === 'mkdir' && String(args[0]).includes(race.trigger) && race.callback) {
        const callback = race.callback;
        race.callback = undefined;
        callback();
      }
      return result;
    },
  };
});

import { inspectRuntimeLocator } from '../../src/services/runtime-manager/runtime-package.js';
import { applySetup, rollbackRuntime } from '../../src/services/runtime-manager-service.js';

let root: string | undefined;
afterEach(() => {
  race.callback = undefined;
  race.trigger = 'migration-manifest.json.';
  race.operation = 'writeFile';
  delete process.env.PLANR_HOME;
  delete process.env.CODEX_HOME;
  if (root) rmSync(root, { recursive: true, force: true });
});
it('preserves a global Codex edit made after the retirement backup was sealed', async () => {
  root = mkdtempSync(join(tmpdir(), 'openplanr-retirement-race-'));
  const projectDir = join(root, 'project');
  process.env.PLANR_HOME = join(root, 'state');
  process.env.CODEX_HOME = join(root, 'codex');
  mkdirSync(join(projectDir, '.planr'), { recursive: true });
  writeFileSync(join(projectDir, '.planr', 'config.json'), '{}\n');
  const options = {
    projectDir,
    cliVersion: '2.2640.7',
    runtime: 'codex' as const,
    scope: 'user' as const,
    manageExternalRuntimes: false,
  };
  await applySetup({ ...options, skillMode: 'direct' });
  const target = join(root, 'codex', 'skills', 'plan', 'SKILL.md');
  const concurrent = `${readFileSync(target, 'utf8')}\nConcurrent owner edit.\n`;
  race.callback = () => writeFileSync(target, concurrent);
  await expect(
    applySetup({ ...options, skillMode: 'unified-plugin', replaceManaged: true }),
  ).rejects.toMatchObject({ code: 'E_SETUP_ROLLBACK_FAILED' });
  expect(readFileSync(target, 'utf8')).toBe(concurrent);
  expect(existsSync(join(root, 'state', 'runtime', 'setup.lock'))).toBe(false);
});

it.each(['edit', 'delete'] as const)(
  'preserves a concurrent %s of an unchanged thin entry after backup',
  async (operation) => {
    root = mkdtempSync(join(tmpdir(), 'openplanr-entry-race-'));
    const projectDir = join(root, 'project');
    process.env.PLANR_HOME = join(root, 'state');
    process.env.CODEX_HOME = join(root, 'codex');
    mkdirSync(join(projectDir, '.planr'), { recursive: true });
    writeFileSync(join(projectDir, '.planr', 'config.json'), '{}\n');
    const options = {
      projectDir,
      cliVersion: '2.2640.7',
      runtime: 'codex' as const,
      scope: 'project' as const,
      skillMode: 'direct' as const,
      manageExternalRuntimes: false,
    };
    await applySetup(options);
    const target = join(projectDir, '.agents', 'skills', 'plan', 'SKILL.md');
    const concurrent = `${readFileSync(target, 'utf8')}\nConcurrent owner edit.\n`;
    race.callback = () => {
      if (operation === 'delete') rmSync(target);
      else writeFileSync(target, concurrent);
    };
    await expect(applySetup(options)).rejects.toMatchObject({ code: 'E_MIGRATION_CONFLICT' });
    if (operation === 'delete') expect(existsSync(target)).toBe(false);
    else expect(readFileSync(target, 'utf8')).toBe(concurrent);
    expect(existsSync(join(root, 'state', 'runtime', 'setup.lock'))).toBe(false);
  },
);

it('retains an immutable package when its first project rolls back after another project reuses it', async () => {
  root = mkdtempSync(join(tmpdir(), 'openplanr-shared-package-'));
  process.env.PLANR_HOME = join(root, 'state');
  process.env.CODEX_HOME = join(root, 'codex');
  const options = {
    cliVersion: '2.2640.7',
    runtime: 'codex' as const,
    scope: 'project' as const,
    skillMode: 'direct' as const,
    manageExternalRuntimes: false,
  };
  const firstProject = join(root, 'first');
  const secondProject = join(root, 'second');
  for (const projectDir of [firstProject, secondProject]) {
    mkdirSync(join(projectDir, '.planr'), { recursive: true });
    writeFileSync(join(projectDir, '.planr', 'config.json'), '{}\n');
  }
  const first = await applySetup({ ...options, projectDir: firstProject });
  await applySetup({ ...options, projectDir: secondProject });
  const directory = join(secondProject, '.agents', 'skills', 'plan');
  const locator = inspectRuntimeLocator(directory);
  expect(locator).not.toBeNull();
  if (!locator) throw new Error('The second project has no exact runtime locator.');
  const cached = readFileSync(join(locator.sourceRoot, locator.entryPath));
  const rollback = await rollbackRuntime(firstProject, first.backupDir);
  expect(rollback.retainedShared.some((file) => file.includes('/runtime/packages/'))).toBe(true);
  expect(inspectRuntimeLocator(directory)).toEqual(locator);
  expect(readFileSync(join(locator.sourceRoot, locator.entryPath))).toEqual(cached);
});

it('preserves a concurrent creation during a staged thin-entry write and removes its temporary file', async () => {
  root = mkdtempSync(join(tmpdir(), 'openplanr-staged-entry-'));
  const projectDir = join(root, 'project');
  process.env.PLANR_HOME = join(root, 'state');
  process.env.CODEX_HOME = join(root, 'codex');
  mkdirSync(join(projectDir, '.planr'), { recursive: true });
  writeFileSync(join(projectDir, '.planr', 'config.json'), '{}\n');
  const target = join(projectDir, '.agents', 'skills', 'plan', 'SKILL.md');
  race.trigger = `${target}.`;
  race.callback = () => writeFileSync(target, 'Concurrent owner file.\n');
  await expect(
    applySetup({
      projectDir,
      cliVersion: '2.2640.7',
      runtime: 'codex',
      scope: 'project',
      skillMode: 'direct',
      manageExternalRuntimes: false,
    }),
  ).rejects.toMatchObject({ code: 'E_SETUP_ROLLBACK_FAILED' });
  expect(readFileSync(target, 'utf8')).toBe('Concurrent owner file.\n');
  expect(existsSync(`${target}.${process.pid}.tmp`)).toBe(false);
});

it('resumes missing immutable bytes without treating interrupted staging as package content', async () => {
  root = mkdtempSync(join(tmpdir(), 'openplanr-package-staging-'));
  const projectDir = join(root, 'project');
  process.env.PLANR_HOME = join(root, 'state');
  process.env.CODEX_HOME = join(root, 'codex');
  mkdirSync(join(projectDir, '.planr'), { recursive: true });
  writeFileSync(join(projectDir, '.planr', 'config.json'), '{}\n');
  const options = {
    projectDir,
    cliVersion: '2.2640.7',
    runtime: 'codex' as const,
    scope: 'project' as const,
    skillMode: 'direct' as const,
    manageExternalRuntimes: false,
  };
  const installed = await applySetup(options);
  const support = installed.actions.find(
    (file) => file.target.includes('/runtime/packages/') && file.target.endsWith('.mjs'),
  );
  if (!support) throw new Error('No immutable support resource was installed.');
  const original = readFileSync(support.target);
  rmSync(support.target);
  const orphan = join(root, 'state', 'runtime', 'setup-staging', 'interrupted-operation.tmp');
  writeFileSync(orphan, 'Interrupted staging bytes.\n');
  await applySetup(options);
  expect(readFileSync(support.target)).toEqual(original);
  expect(readFileSync(orphan, 'utf8')).toBe('Interrupted staging bytes.\n');
});

it.each(['mkdir', 'writeFile'] as const)(
  'rejects a staging ancestor replacement during %s without following it',
  async (operation) => {
    root = mkdtempSync(join(tmpdir(), 'openplanr-staging-custody-'));
    const projectDir = join(root, 'project');
    process.env.PLANR_HOME = join(root, 'state');
    process.env.CODEX_HOME = join(root, 'codex');
    mkdirSync(join(projectDir, '.planr'), { recursive: true });
    writeFileSync(join(projectDir, '.planr', 'config.json'), '{}\n');
    const staging = join(root, 'state', 'runtime', 'setup-staging');
    const original = join(root, 'original-staging');
    const outside = join(root, 'replacement');
    mkdirSync(outside);
    writeFileSync(join(outside, 'owner.txt'), 'Owner bytes.\n');
    race.operation = operation;
    race.trigger = staging;
    race.callback = () => {
      renameSync(staging, original);
      symlinkSync(outside, staging, 'dir');
    };
    await expect(
      applySetup({
        projectDir,
        cliVersion: '2.2640.7',
        runtime: 'codex',
        scope: 'project',
        skillMode: 'direct',
        manageExternalRuntimes: false,
      }),
    ).rejects.toMatchObject({ code: 'E_MIGRATION_CONFLICT' });
    expect(readFileSync(join(outside, 'owner.txt'), 'utf8')).toBe('Owner bytes.\n');
    expect(readdirSync(outside)).toEqual(['owner.txt']);
    expect(readdirSync(original)).toHaveLength(operation === 'mkdir' ? 0 : 1);
    expect(existsSync(join(root, 'state', 'runtime', 'setup.lock'))).toBe(false);
  },
);
