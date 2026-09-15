import type { RuntimeId } from './inventory.js';

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
