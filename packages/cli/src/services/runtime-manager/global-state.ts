import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { RuntimeManagerError } from './errors.js';
import type { RuntimeId } from './inventory.js';
import {
  canonicalProjectPath,
  codexProfileKey,
  effectiveCodexHome,
  pathIsWithin,
  planrCustodyAnchor,
  projectKey,
  runtimeRoot,
  statePath,
  userHome,
} from './paths.js';
import {
  assertApprovedTargetCustody,
  assertRequestedProjectBinding,
  assertRuntimeStateValue,
  isUserOwnedFile,
} from './storage.js';

export type InstallScope = 'user' | 'project' | 'both';
export type CommandPrefix = 'namespaced' | 'bare';
export type SkillInstallMode = 'direct' | 'unified-plugin' | 'project-rule';

export interface OwnedFile {
  runtime: RuntimeId | 'core';
  scope?: 'user' | 'project';
  target: string;
  kind: 'file' | 'managed-block';
  marker?: string;
  hash: string;
}

export interface RuntimeState {
  schemaVersion: '1.0.0' | '2.0.0';
  userBundles?: Partial<
    Record<
      RuntimeId,
      {
        runtime: RuntimeId;
        scope: 'user';
        updatedAt: string;
        pipelineVersion: string;
        commandPrefix: CommandPrefix;
        installMode?: SkillInstallMode;
        ownedFiles: OwnedFile[];
      }
    >
  >;
  /** Alternate native homes share transactions but retain their own Codex user bundle. */
  codexProfiles?: Record<
    string,
    {
      home: string;
      bundle?: NonNullable<RuntimeState['userBundles']>['codex'];
    }
  >;
  projects: Record<
    string,
    {
      projectDir: string;
      updatedAt: string;
      backupDir?: string;
      backupManifestHash?: string;
      runtimes: RuntimeId[];
      runtimeScopes?: Partial<Record<RuntimeId, InstallScope>>;
      commandPrefix?: CommandPrefix;
      activeRuntime?: RuntimeId;
      skillModes?: Partial<Record<RuntimeId, SkillInstallMode>>;
      codexHome?: string;
      ownedFiles: OwnedFile[];
    }
  >;
}

type StateConflict = (
  code: 'E_RUNTIME_STATE_CONFLICT' | 'E_RUNTIME_PREFIX_CONFLICT',
  message: string,
  recovery?: string,
) => never;

/** Owns the exact one-time v1 project-state to v2 global user-bundle transition. */
export function migrateLegacyGlobalRuntimeState(
  state: RuntimeState,
  dependencies: {
    inferRuntimeScope: (files: OwnedFile[], runtime: RuntimeId) => InstallScope;
    inferLegacyCodexPrefix: (
      project: RuntimeState['projects'][string],
    ) => CommandPrefix | undefined;
    isUserOwnedFile: (file: OwnedFile, runtime: RuntimeId) => boolean;
    projectKey: (projectDir: string) => string;
    conflict: StateConflict;
  },
): RuntimeState {
  state.userBundles ??= {};
  if (state.schemaVersion !== '1.0.0') return state;

  for (const runtime of ['claude-code', 'codex', 'cursor'] as const) {
    const projects = Object.values(state.projects)
      .filter((project) => project.runtimes.includes(runtime))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const owned = new Map<string, OwnedFile>();
    const prefixes = new Set<CommandPrefix>();
    for (const project of projects) {
      const inferredScope =
        project.runtimeScopes?.[runtime] ??
        dependencies.inferRuntimeScope(project.ownedFiles, runtime);
      project.runtimeScopes ??= {};
      project.runtimeScopes[runtime] = inferredScope;
      if (runtime === 'codex') {
        const prefix = dependencies.inferLegacyCodexPrefix(project);
        if (prefix) prefixes.add(prefix);
      }
      for (const file of project.ownedFiles.filter(
        (candidate) =>
          candidate.runtime === runtime && dependencies.isUserOwnedFile(candidate, runtime),
      )) {
        const existing = owned.get(file.target);
        if (existing && existing.hash !== file.hash) {
          return dependencies.conflict(
            'E_RUNTIME_STATE_CONFLICT',
            `Legacy user bundle ownership conflicts for ${file.target}.`,
            'Restore one consistent managed bundle or remove the conflicting legacy state record.',
          );
        }
        owned.set(file.target, { ...file, scope: 'user' });
      }
      project.ownedFiles = project.ownedFiles.filter(
        (file) => !(file.runtime === runtime && dependencies.isUserOwnedFile(file, runtime)),
      );
      if (runtime === 'codex') delete project.commandPrefix;
    }
    if (prefixes.size > 1) {
      return dependencies.conflict(
        'E_RUNTIME_PREFIX_CONFLICT',
        'Legacy projects record different user-scoped Codex command prefixes.',
        'Choose one global Codex prefix and explicitly reconcile the other installed skill tree.',
      );
    }
    if (owned.size > 0) {
      state.userBundles[runtime] = {
        runtime,
        scope: 'user',
        updatedAt: projects[0]?.updatedAt ?? new Date(0).toISOString(),
        pipelineVersion: 'legacy',
        commandPrefix: runtime === 'codex' ? ([...prefixes][0] ?? 'namespaced') : 'namespaced',
        ownedFiles: [...owned.values()],
      };
    }
  }

  const rekeyed: RuntimeState['projects'] = {};
  for (const project of Object.values(state.projects)) {
    const key = dependencies.projectKey(project.projectDir);
    if (rekeyed[key]) {
      return dependencies.conflict(
        'E_RUNTIME_STATE_CONFLICT',
        'Legacy runtime state aliases more than one record to the same canonical project.',
      );
    }
    rekeyed[key] = project;
  }
  state.projects = rekeyed;
  state.schemaVersion = '2.0.0';
  return state;
}

export function projectUsesUserRuntime(
  project: RuntimeState['projects'][string],
  runtime: RuntimeId,
  nativeHome = effectiveCodexHome(),
): boolean {
  if (
    runtime === 'codex' &&
    (project.codexHome ?? path.resolve(userHome(), '.codex')) !== nativeHome
  )
    return false;
  if (!project.runtimes.includes(runtime)) return false;
  const recorded = project.runtimeScopes?.[runtime];
  if (recorded) return recorded === 'user' || recorded === 'both';
  return project.ownedFiles.some(
    (file) => file.runtime === runtime && isUserOwnedFile(file, runtime),
  );
}

function inferLegacyCodexPrefix(
  project: RuntimeState['projects'][string],
  nativeHome = effectiveCodexHome(),
): CommandPrefix | undefined {
  if (!projectUsesUserRuntime(project, 'codex', nativeHome)) return undefined;
  if (project.commandPrefix) return project.commandPrefix;
  const roots = project.ownedFiles
    .filter(
      (file) =>
        file.runtime === 'codex' && pathIsWithin(file.target, path.join(nativeHome, 'skills')),
    )
    .map((file) => path.relative(path.join(nativeHome, 'skills'), file.target).split(path.sep)[0])
    .filter(Boolean);
  if (roots.length === 0) return 'namespaced';
  const modes = new Set(roots.map((name) => (name.startsWith('planr-') ? 'namespaced' : 'bare')));
  if (modes.size !== 1) {
    throw new RuntimeManagerError(
      'E_RUNTIME_PREFIX_CONFLICT',
      `Legacy Codex ownership for ${project.projectDir} mixes bare and namespaced skill targets.`,
      'Choose one global Codex prefix, move the other skill tree aside, and rerun setup.',
    );
  }
  return [...modes][0] as CommandPrefix;
}

export function inferRuntimeScope(
  files: OwnedFile[],
  runtime: RuntimeId,
  nativeHome = effectiveCodexHome(),
): InstallScope {
  const owned = files.filter((file) => file.runtime === runtime);
  const hasUser = owned.some((file) => isUserOwnedFile(file, runtime, nativeHome));
  const hasProject = owned.some((file) => !isUserOwnedFile(file, runtime, nativeHome));
  return hasUser && hasProject ? 'both' : hasUser ? 'user' : 'project';
}

const defaultCodexBundles = new WeakMap<
  RuntimeState,
  NonNullable<RuntimeState['userBundles']>['codex']
>();

function selectCodexProfile(state: RuntimeState): RuntimeState {
  const key = codexProfileKey();
  if (!key) return state;
  defaultCodexBundles.set(state, state.userBundles?.codex);
  state.userBundles ??= {};
  const bundle = state.codexProfiles?.[key]?.bundle;
  if (bundle) state.userBundles.codex = bundle;
  else delete state.userBundles.codex;
  return state;
}

/** One shared ownership file and setup lock serialize all native profiles. */
export function runtimeStateBytes(state: RuntimeState): Buffer {
  const key = codexProfileKey();
  if (!key) return Buffer.from(`${JSON.stringify(state, null, 2)}\n`);
  if (!defaultCodexBundles.has(state))
    throw new RuntimeManagerError(
      'E_RUNTIME_STATE_INVALID',
      'Codex profile state lost its default bundle.',
    );
  const stored = {
    ...state,
    userBundles: { ...state.userBundles },
    codexProfiles: { ...state.codexProfiles },
  };
  stored.codexProfiles[key] = {
    home: effectiveCodexHome(),
    ...(state.userBundles?.codex ? { bundle: state.userBundles.codex } : {}),
  };
  const defaultBundle = defaultCodexBundles.get(state);
  if (defaultBundle) stored.userBundles.codex = defaultBundle;
  else delete stored.userBundles.codex;
  return Buffer.from(`${JSON.stringify(stored, null, 2)}\n`);
}

export function decodeStoredRuntimeState(
  value: unknown,
  allowLegacyProjectKeys = false,
): RuntimeState {
  const defaultHome = path.resolve(userHome(), '.codex');
  const state = assertRuntimeStateValue(
    value,
    'E_RUNTIME_STATE_INVALID',
    allowLegacyProjectKeys,
    defaultHome,
  );
  migrateLegacyGlobalRuntimeState(state, {
    inferRuntimeScope: (files, runtime) => inferRuntimeScope(files, runtime, defaultHome),
    inferLegacyCodexPrefix: (project) => inferLegacyCodexPrefix(project, defaultHome),
    isUserOwnedFile: (file, runtime) => isUserOwnedFile(file, runtime, defaultHome),
    projectKey,
    conflict: (code, message, recovery) => {
      throw new RuntimeManagerError(code, message, recovery);
    },
  });
  return assertRuntimeStateValue(selectCodexProfile(state));
}

export async function loadState(): Promise<RuntimeState> {
  assertApprovedTargetCustody(
    statePath(),
    runtimeRoot(),
    planrCustodyAnchor(),
    'E_RUNTIME_STATE_INVALID',
    'Runtime ownership state',
  );
  try {
    return decodeStoredRuntimeState(
      JSON.parse(await readFile(statePath(), 'utf8')) as unknown,
      true,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return selectCodexProfile({ schemaVersion: '2.0.0', projects: {}, userBundles: {} });
    }
    if (error instanceof RuntimeManagerError) throw error;
    throw new RuntimeManagerError(
      'E_RUNTIME_STATE_INVALID',
      `Runtime ownership state is invalid: ${error instanceof Error ? error.message : String(error)}`,
      'Restore the recorded state backup before running setup again.',
    );
  }
}

function homeProjectRecord(state: RuntimeState) {
  return state.projects[projectKey(userHome())];
}

export async function previewHomeProjectCleanup(): Promise<string[]> {
  const state = await loadState();
  const key = projectKey(userHome());
  const project = homeProjectRecord(state);
  if (!project || canonicalProjectPath(project.projectDir) !== canonicalProjectPath(userHome()))
    return [];
  assertRequestedProjectBinding(userHome(), key, project);
  return project.ownedFiles.filter((file) => file.scope === 'project').map((file) => file.target);
}
