import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { validateJson } from '../../../lib/json-schema.mjs';
import { CLI_COMMAND, PLANNING_FOLDER } from '../../utils/constants.js';
import { spliceManagedBlock } from '../../utils/splice-managed-block.js';
import type { RuntimePackageRestore, SetupOptions } from '../runtime-manager-service.js';
import { RuntimeManagerError } from './errors.js';
import type { InstallScope, RuntimeState, SkillInstallMode } from './global-state.js';
import type { RuntimeId } from './inventory.js';
import { type AdapterRegistry, type AdapterRegistryEntry, readRegistry } from './inventory.js';
import { codexRuntimeRoot, codexSkillsRoot, runtimeRoot } from './paths.js';
import {
  type BundledHostAsset,
  bundledHostRoot,
  bundledRuntimePackage,
  bundledSkillAssets,
  caseVariantOf,
  describePackageDrift,
  type RuntimePackage,
  retainedRuntimePackageDrift,
} from './runtime-package.js';

type FileAction = PlannedFileAction;

export type PlannedFileAction = Readonly<{
  runtime: RuntimeId | 'core';
  scope: 'user' | 'project';
  target: string;
  content: Buffer;
  kind: 'file' | 'managed-block';
  marker?: string;
  custody?: 'professional-skill' | 'runtime-package';
  description: string;
}>;

export type PlannedOwnedFile = Readonly<{
  runtime: RuntimeId | 'core';
  scope?: 'user' | 'project';
  target: string;
  kind: 'file' | 'managed-block';
  marker?: string;
  hash: string;
}>;

type Conflict = (message: string, recovery: string) => never;

const KNOWN_STALE_SKILL_FINGERPRINTS = new Map([
  [
    `${path.sep}planr-operate${path.sep}SKILL.md`,
    'b77ca2825036994a3950e6754e471d427e6382bfe160d5c74d267e5b92910aa0',
  ],
]);

function isKnownStaleSkill(target: string, digest: string): boolean {
  return [...KNOWN_STALE_SKILL_FINGERPRINTS.entries()].some(
    ([suffix, fingerprint]) => target.endsWith(suffix) && digest === fingerprint,
  );
}

/** Inventories every exact regular file under one owned skill root and rejects links/specials. */
export function inventoryManagedSkillFiles(root: string, conflict: Conflict): string[] {
  const stat = lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return conflict(
      `Refusing to use non-directory or symbolic-link Codex skill root ${root}.`,
      'Preserve the existing entry and replace it with a real skill directory before rerunning setup.',
    );
  }
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        conflict(
          `Refusing to traverse symbolic link ${target} in a managed Codex skill tree.`,
          'Preserve or move the link outside the managed skill directory before rerunning setup.',
        );
      }
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push(path.resolve(target));
      else {
        conflict(
          `Refusing unsupported filesystem entry ${target} in a managed Codex skill tree.`,
          'Preserve or move the entry outside the managed skill directory before rerunning setup.',
        );
      }
    }
  };
  visit(root);
  return files;
}

function desiredSkillRoots(
  actions: Iterable<PlannedFileAction>,
  skillsRoot: string,
  pathIsWithin: (candidate: string, root: string) => boolean,
): string[] {
  const roots = new Set<string>();
  for (const action of actions) {
    if (
      action.runtime !== 'codex' ||
      action.scope !== 'user' ||
      !pathIsWithin(action.target, skillsRoot)
    ) {
      continue;
    }
    const first = path.relative(skillsRoot, action.target).split(path.sep)[0];
    if (first) roots.add(path.join(skillsRoot, first));
  }
  return [...roots];
}

/** Owns the complete fail-closed transition plan for the global Codex skill bundle. */
export function planCodexUserBundleTransition(input: {
  actions: PlannedFileAction[];
  existing: PlannedOwnedFile[];
  skillsRoot: string;
  pathIsWithin: (candidate: string, root: string) => boolean;
  assertUserOwnedTarget: (
    entry: PlannedFileAction | PlannedOwnedFile,
    runtime: 'codex',
    code: 'E_MIGRATION_CONFLICT' | 'E_RUNTIME_STATE_INVALID',
  ) => void;
  ownershipHash: (
    content: string | Buffer,
    kind: PlannedFileAction['kind'],
    marker?: string,
  ) => string;
  hash: (content: string | Buffer) => string;
  actionBytes: (action: PlannedFileAction) => Buffer;
  conflict: Conflict;
}): { retired: PlannedOwnedFile[] } {
  const desired = new Map(
    input.actions
      .filter((action) => action.runtime === 'codex' && action.scope === 'user')
      .map((action) => [action.target, action]),
  );
  for (const action of desired.values()) {
    input.assertUserOwnedTarget(action, 'codex', 'E_MIGRATION_CONFLICT');
  }
  for (const file of input.existing) {
    input.assertUserOwnedTarget(file, 'codex', 'E_RUNTIME_STATE_INVALID');
  }
  const tracked = new Map(input.existing.map((file) => [file.target, file]));
  const allowed = new Set(
    [...desired.keys(), ...tracked.keys()].map((target) => path.resolve(target)),
  );

  for (const root of desiredSkillRoots(desired.values(), input.skillsRoot, input.pathIsWithin)) {
    if (!existsSync(root)) continue;
    const unknown = inventoryManagedSkillFiles(root, input.conflict).find(
      (target) => !allowed.has(target),
    );
    if (unknown) {
      return input.conflict(
        `Refusing to install into a Codex skill tree containing unknown file ${unknown}.`,
        'The unknown file was preserved. Move it aside or explicitly reconcile it before rerunning setup.',
      );
    }
  }

  for (const file of input.existing) {
    if (!existsSync(file.target)) continue;
    const current = input.ownershipHash(readFileSync(file.target), file.kind, file.marker);
    if (current !== file.hash && !isKnownStaleSkill(file.target, current)) {
      return input.conflict(
        `Refusing to replace modified global Codex bundle content at ${file.target}.`,
        'Preserve the modified file, restore the last managed bytes, or choose a separate skill home.',
      );
    }
  }
  for (const action of desired.values()) {
    if (!existsSync(action.target) || tracked.has(action.target)) continue;
    const current = input.hash(readFileSync(action.target));
    const expected = input.hash(input.actionBytes(action));
    if (current !== expected && !isKnownStaleSkill(action.target, current)) {
      return input.conflict(
        `Refusing to overwrite unknown Codex skill bytes at ${action.target}.`,
        'Move the unknown file aside or explicitly reconcile it before rerunning setup.',
      );
    }
  }
  return { retired: input.existing.filter((file) => !desired.has(file.target)) };
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
const runtimeLockSchema = JSON.parse(
  readFileSync(new URL('../../../lib/runtime-lock.schema.json', import.meta.url), 'utf8'),
);

// Setup and global help remain available when the optional pipeline package is absent.
export function validateRuntimeLockContract(value: unknown) {
  return validateJson(value, runtimeLockSchema);
}

export function actionBytes(action: FileAction): Buffer {
  if (action.kind === 'file') return action.content;
  const existing = existsSync(action.target) ? readFileSync(action.target, 'utf8') : '';
  const spliced = spliceManagedBlock(
    existing,
    action.marker ?? 'runtime',
    action.content.toString('utf8'),
  );
  return Buffer.from(spliced.endsWith('\n') ? spliced : `${spliced}\n`);
}

function runtimeMarker(runtime: RuntimeId, pipelineVersion: string): Buffer {
  return Buffer.from(
    `${JSON.stringify({ schemaVersion: '1.0.0', runtime, pipelineVersion, managedBy: 'openplanr' }, null, 2)}\n`,
  );
}

export function normalizeInstallScope(
  adapter: AdapterRegistryEntry,
  requested: InstallScope,
): InstallScope {
  const supportsUser = adapter.installScopes.includes('user');
  const supportsProject = adapter.installScopes.includes('project');
  if (requested === 'user' && !supportsUser) {
    throw new RuntimeManagerError(
      'E_SCOPE_UNSUPPORTED',
      `OpenPlanr's ${adapter.id} integration currently requires project scope.`,
      `Change into your project, then run \`${CLI_COMMAND} setup --runtime ${adapter.id} --scope project\`. To initialize a new project there, run \`${CLI_COMMAND} init\` first.`,
    );
  }
  if (requested === 'project' && !supportsProject) {
    throw new RuntimeManagerError(
      'E_SCOPE_UNSUPPORTED',
      `${adapter.id} does not support project-scope installation.`,
    );
  }
  if (requested !== 'both') return requested;
  if (supportsUser && supportsProject) return 'both';
  return supportsProject ? 'project' : 'user';
}

export function skillInstallMode(
  runtime: RuntimeId,
  options: SetupOptions,
  scope?: 'project',
): SkillInstallMode {
  if (runtime === 'claude-code') return 'unified-plugin';
  if (runtime === 'cursor') return 'project-rule';
  if (scope === 'project' && options.projectSkillMode) return options.projectSkillMode;
  return options.skillMode ?? (options.scope === 'project' ? 'project-rule' : 'direct');
}

export function skillInstallModes(
  runtimes: RuntimeId[],
  options: SetupOptions,
  scope?: 'project',
): Partial<Record<RuntimeId, SkillInstallMode>> {
  return Object.fromEntries(
    runtimes.map((runtime) => [runtime, skillInstallMode(runtime, options, scope)]),
  );
}

export interface RuntimeLockAdapter {
  runtime: RuntimeId;
  version: string;
  capabilityLevel: string;
  installScope: InstallScope;
}

interface RuntimeLockDigestInput {
  protocolVersion?: string;
  pipelineVersion?: string;
  adapters?: readonly RuntimeLockAdapter[];
  skillModes?: Partial<Record<RuntimeId, SkillInstallMode>>;
}

export function runtimeLockManifestDigest(input: RuntimeLockDigestInput): string {
  return `sha256:${hash(
    JSON.stringify({
      protocol: input.protocolVersion,
      pipelineVersion: input.pipelineVersion,
      adapters: input.adapters,
      ...(input.skillModes ? { skillModes: input.skillModes } : {}),
    }),
  )}`;
}

function buildRuntimeLock(
  options: SetupOptions,
  runtimes: RuntimeId[],
  runtimeScopes: Partial<Record<RuntimeId, InstallScope>>,
  registry: AdapterRegistry,
  pipelineVersion: string,
): Buffer {
  const adapters = runtimes.map((runtime) => {
    const adapter = registry.adapters.find((entry) => entry.id === runtime);
    if (!adapter)
      throw new RuntimeManagerError('E_ADAPTER_MISSING', `Adapter ${runtime} is absent.`);
    const installScope = normalizeInstallScope(
      adapter,
      runtimeScopes[runtime] ?? options.scope ?? 'user',
    );
    return {
      runtime,
      version: adapter.version,
      capabilityLevel: adapter.capabilityLevel,
      installScope,
    };
  });
  const skillModes = skillInstallModes(runtimes, options, 'project');
  const components = {
    cli: options.cliVersion,
    pipeline: pipelineVersion,
    skills: readRegistry().pluginVersion,
  };
  const manifestDigest = runtimeLockManifestDigest({
    protocolVersion: registry.protocolVersion,
    pipelineVersion,
    adapters,
    skillModes,
  });
  const lockPath = path.join(options.projectDir, PLANNING_FOLDER, 'runtime-lock.json');
  if (existsSync(lockPath)) {
    try {
      const existing = JSON.parse(readFileSync(lockPath, 'utf8')) as {
        manifestDigest?: string;
        protocolVersion?: string;
        components?: unknown;
        adapters?: unknown;
      };
      if (
        existing.manifestDigest === manifestDigest &&
        existing.protocolVersion === registry.protocolVersion &&
        JSON.stringify(existing.components) === JSON.stringify(components) &&
        JSON.stringify(existing.adapters) === JSON.stringify(adapters) &&
        validateRuntimeLockContract(existing).length === 0
      ) {
        return readFileSync(lockPath);
      }
    } catch {
      // Invalid locks are replaced after backup during setup.
    }
  }
  const lock = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    manifestDigest,
    protocolVersion: registry.protocolVersion,
    components,
    adapters,
    skillModes,
  };
  const errors = validateRuntimeLockContract(lock);
  if (errors.length) {
    throw new RuntimeManagerError(
      'E_RUNTIME_LOCK_INVALID',
      `Generated runtime lock does not match the supported contract: ${errors[0].path} ${errors[0].detail}`,
      'Reinstall the OpenPlanr CLI or regenerate its bundled runtime adapters.',
    );
  }
  return Buffer.from(`${JSON.stringify(lock, null, 2)}\n`);
}

export function buildActions(
  options: SetupOptions,
  runtimes: RuntimeId[],
  runtimeScopes: Partial<Record<RuntimeId, InstallScope>>,
  retainedProject?: RuntimeState['projects'][string],
  packageRestores: RuntimePackageRestore[] = [],
): FileAction[] {
  if (options.minimal) return [];
  const { version, registry } = readRegistry();
  if (options.version && options.version !== version) {
    throw new RuntimeManagerError(
      'E_VERSION_UNAVAILABLE',
      `Installed pipeline ${version} does not match requested ${options.version}.`,
      `Install an OpenPlanr CLI release that bundles workflow assets ${options.version}, then rerun setup.`,
    );
  }
  const actions: FileAction[] = [];

  for (const runtime of runtimes) {
    const adapter = registry.adapters.find((entry) => entry.id === runtime);
    if (!adapter)
      throw new RuntimeManagerError('E_ADAPTER_MISSING', `Adapter ${runtime} is absent.`);
    const scope = normalizeInstallScope(adapter, runtimeScopes[runtime] ?? options.scope ?? 'user');
    const installUser =
      (scope === 'user' || scope === 'both' || options.userScopeRuntimes?.includes(runtime)) &&
      adapter.installScopes.includes('user');
    const installProject =
      (scope === 'project' || scope === 'both') && adapter.installScopes.includes('project');
    const userDiscovery =
      installUser &&
      (runtime === 'claude-code' ||
        (runtime === 'codex' && skillInstallMode(runtime, options) !== 'project-rule'));
    const usesThinEntries =
      (installProject && !userDiscovery) ||
      (installUser && runtime === 'codex' && skillInstallMode(runtime, options) === 'direct');
    let skillAssets: BundledHostAsset[];
    let runtimePackage: RuntimePackage;
    try {
      runtimePackage = bundledRuntimePackage(runtime);
      skillAssets = bundledSkillAssets(runtime, runtimePackage);
    } catch (cause) {
      throw new RuntimeManagerError(
        'E_SKILL_DISTRIBUTION_INVALID',
        `The generated ${runtime} skill distribution is invalid: ${cause instanceof Error ? cause.message : String(cause)}`,
        'Reinstall the OpenPlanr utility CLI or regenerate the host packages.',
      );
    }
    if (usesThinEntries) {
      const drift = retainedRuntimePackageDrift(runtime, runtimePackage);
      if (drift.changed.length > 0 || drift.unexpected.length > 0) {
        if (!options.restoreRuntimePackages) {
          throw new RuntimeManagerError(
            'E_RUNTIME_PACKAGE_CHANGED',
            `Files in the ${runtime} runtime package ${runtimePackage.version} were changed outside OpenPlanr: ${describePackageDrift(drift)}.`,
            `Run \`${CLI_COMMAND} doctor --fix\` to restore the package from this CLI; the changed files are backed up first.`,
          );
        }
        // A restore never deletes a name that could open a packaged file.
        const reviewed = runtimePackage.files.map((file) => file.relativePath);
        const caseVariants = drift.unexpected.filter((file) => caseVariantOf(file, reviewed));
        if (caseVariants.length > 0) {
          throw new RuntimeManagerError(
            'E_RUNTIME_PACKAGE_CHANGED',
            `Files in the ${runtime} runtime package ${runtimePackage.version} differ from packaged files only by letter case: ${caseVariants.join(', ')}.`,
            `OpenPlanr does not delete them. Remove them by hand, then rerun \`${CLI_COMMAND} doctor --fix\`.`,
          );
        }
        packageRestores.push({
          runtime,
          version: runtimePackage.version,
          root: runtimePackage.root,
          ...drift,
        });
      }
      for (const file of runtimePackage.files) {
        actions.push({
          runtime: 'core',
          scope: 'user',
          target: path.join(runtimePackage.root, file.relativePath),
          content: file.content,
          kind: 'file',
          custody: 'runtime-package',
          description: `Retain exact ${runtime} runtime package ${file.relativePath}`,
        });
      }
    }
    if (installUser) {
      if (runtime === 'codex') {
        const mode = skillInstallMode(runtime, options);
        if (mode === 'direct') {
          for (const asset of skillAssets) {
            actions.push({
              runtime,
              scope: 'user',
              target: path.join(codexSkillsRoot(), asset.targetName, asset.relativePath),
              content: asset.content,
              kind: 'file',
              description: `Install Codex skill asset ${asset.targetName}/${asset.relativePath}`,
            });
          }
        }
        if (mode !== 'project-rule') {
          actions.push({
            runtime,
            scope: 'user',
            target: path.join(codexRuntimeRoot(), 'install-modes', 'codex.json'),
            content: Buffer.from(
              `${JSON.stringify({ schemaVersion: '1.0.0', runtime, mode, sourceVersion: version }, null, 2)}\n`,
            ),
            kind: 'file',
            description: `Record Codex ${mode} skill installation mode`,
          });
        }
      }
      actions.push({
        runtime,
        scope: 'user',
        target: path.join(
          runtime === 'codex' ? codexRuntimeRoot() : runtimeRoot(),
          'adapters',
          `${runtime}.json`,
        ),
        content: runtimeMarker(runtime, version),
        kind: 'file',
        description: `Record ${runtime} adapter installation`,
      });
    }

    if (installProject) {
      if (userDiscovery) {
        actions.push({
          runtime,
          scope: 'project',
          target: path.join(
            options.projectDir,
            PLANNING_FOLDER,
            'runtime-policy',
            `${runtime}.json`,
          ),
          content: Buffer.from(
            `${JSON.stringify({ schemaVersion: '1.0.0', runtime, discovery: 'user', mode: skillInstallMode(runtime, options), packageDigest: runtimePackage.digest, packageVersion: runtimePackage.version }, null, 2)}\n`,
          ),
          kind: 'file',
          custody: 'professional-skill',
          description: `Bind project policy to the existing ${runtime} user discovery`,
        });
        continue;
      }
      if (runtime === 'codex') {
        for (const asset of skillAssets) {
          actions.push({
            runtime,
            scope: 'project',
            target: path.join(
              options.projectDir,
              '.agents',
              'skills',
              asset.targetName,
              asset.relativePath,
            ),
            content: asset.content,
            kind: 'file',
            custody: 'professional-skill',
            description: `Install project Codex skill asset ${asset.targetName}/${asset.relativePath}`,
          });
        }
      } else if (runtime === 'cursor') {
        for (const asset of skillAssets) {
          actions.push({
            runtime,
            scope: 'project',
            target: path.join(
              options.projectDir,
              '.cursor',
              'rules',
              'openplanr',
              asset.relativePath,
            ),
            content: asset.content,
            kind: 'file',
            custody: 'professional-skill',
            description: `Install Cursor rule asset ${asset.relativePath}`,
          });
        }
      } else {
        for (const asset of skillAssets) {
          actions.push({
            runtime,
            scope: 'project',
            target: path.join(
              options.projectDir,
              '.claude',
              'skills',
              asset.targetName,
              asset.relativePath,
            ),
            content: asset.content,
            kind: 'file',
            custody: 'professional-skill',
            description: `Install project Claude skill asset ${asset.targetName}/${asset.relativePath}`,
          });
        }
        const agentsRoot = path.join(bundledHostRoot('claude'), 'openplanr', 'agents');
        for (const absolutePath of inventoryRegularFiles(agentsRoot)) {
          const relativePath = path.relative(agentsRoot, absolutePath);
          actions.push({
            runtime,
            scope: 'project',
            target: path.join(options.projectDir, '.claude', 'agents', relativePath),
            content: Buffer.from(
              readFileSync(absolutePath, 'utf8').replaceAll(
                '${CLAUDE_PLUGIN_ROOT}',
                runtimePackage.root,
              ),
            ),
            kind: 'file',
            custody: 'professional-skill',
            description: `Install project Claude role agent ${relativePath}`,
          });
        }
      }
    }
  }

  const lockRuntimes = [...new Set([...(retainedProject?.runtimes ?? []), ...runtimes])];
  const lockScopes = { ...retainedProject?.runtimeScopes, ...runtimeScopes };
  if (
    lockRuntimes.some((runtime) => {
      const scope = lockScopes[runtime] ?? options.scope ?? 'user';
      return scope === 'project' || scope === 'both';
    })
  ) {
    actions.push({
      runtime: 'core',
      scope: 'project',
      target: path.join(options.projectDir, PLANNING_FOLDER, 'runtime-lock.json'),
      content: buildRuntimeLock(
        {
          ...options,
          projectSkillMode: options.projectSkillMode ?? retainedProject?.skillModes?.codex,
        },
        lockRuntimes,
        lockScopes,
        registry,
        version,
      ),
      kind: 'file',
      description: 'Write exact runtime compatibility lock',
    });
  }
  return actions;
}

export function inventoryRegularFiles(root: string): string[] {
  return inventoryManagedSkillFiles(root, (message, recovery) => {
    throw new RuntimeManagerError('E_MIGRATION_CONFLICT', message, recovery);
  });
}
