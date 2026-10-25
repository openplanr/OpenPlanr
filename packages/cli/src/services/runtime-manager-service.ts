/**
 * Runtime adapter manager behind `openplanr setup`, `openplanr doctor` and `openplanr runtime`: previews and
 * applies project or user installs of the OpenPlanr skills for Claude Code, Codex and Cursor,
 * records owned files in `<planrHome>/runtime/state.json` with per-project backups, and diagnoses
 * drift. Entry points: `previewSetup`, `applySetup`, `rollbackRuntime`, `removeRuntime`,
 * `runtimeDoctor`. Host plugin commands belong to the `claude-plugin` and `codex-plugin` services.
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { type FileHandle, mkdir, open, readFile, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  CLI_NODE_REMEDIATION,
  cliNodeVersionMessage,
  supportsCliNodeVersion,
} from '../../lib/node-runtime.mjs';
import { CLI_COMMAND } from '../utils/constants.js';
import {
  applyBundledClaudePluginIntegration,
  type ClaudeCommandRunner,
  type ClaudePluginOperation,
  duplicateClaudePluginDiagnostic,
  inspectBundledClaudePluginIntegration,
} from './claude-plugin-service.js';
import {
  applyCodexPluginIntegration,
  type CodexCommandRunner,
  type CodexPluginOperation,
  inspectCodexPluginIntegration,
} from './codex-plugin-service.js';
import { resolvePipelinePackage } from './pipeline-package-service.js';
import { type CodexSkillDiscovery, effectiveCodexHome } from './runtime-manager/codex-discovery.js';
import { runtimeDoctor as inspectRuntimeDoctor } from './runtime-manager/doctor.js';
import { RuntimeManagerError } from './runtime-manager/errors.js';
import {
  type CommandPrefix,
  decodeStoredRuntimeState,
  type InstallScope,
  inferRuntimeScope,
  loadState,
  type OwnedFile,
  projectUsesUserRuntime,
  type RuntimeState,
  runtimeStateBytes,
  type SkillInstallMode,
} from './runtime-manager/global-state.js';
import {
  actionBytes,
  buildActions,
  normalizeInstallScope,
  type PlannedFileAction,
  planCodexUserBundleTransition,
  type RuntimeLockAdapter,
  runtimeLockManifestDigest,
  skillInstallMode,
  skillInstallModes,
} from './runtime-manager/install-plan.js';
import {
  type AdapterRegistryEntry,
  detectInstalledRuntimes,
  inspectRuntimeProjectContext,
  listInstalledRuntimeAdapters,
  planningFolderConflict,
  type RuntimeId,
  readRegistry,
} from './runtime-manager/inventory.js';
import {
  planRetiredClaudeProjectAgents,
  planRetiredCursorProjectRules,
} from './runtime-manager/legacy-adapters.js';
import {
  canonicalProjectPath,
  codexSkillsRoot,
  pathIsWithin,
  planrCustodyAnchor,
  projectKey,
  runtimeRoot,
  statePath,
  userHome,
} from './runtime-manager/paths.js';
import {
  type RuntimePackageDrift,
  bundledHostRoot as resolveBundledHostRoot,
} from './runtime-manager/runtime-package.js';
import {
  assertActionCustody,
  assertApprovedTargetCustody,
  assertBackupDirectoryCustody,
  assertClosedBackupManifest,
  assertClosedBackupTree,
  assertMutableOwnedTarget,
  assertProfessionalSkillTransition,
  assertRequestedProjectBinding,
  assertUserOwnedTarget,
  atomicWrite,
  type BackupManifest,
  backupManifestIdentity,
  createBackup,
  hash,
  immutableRuntimeTarget,
  ownershipHash,
  readBackupEntryBytes,
  readCustodiedRegularFile,
  restoreBackup,
} from './runtime-manager/storage.js';

export { classifyComponentDrift } from './runtime-manager/doctor.js';
export { RuntimeManagerError } from './runtime-manager/errors.js';
export type { InstallScope, SkillInstallMode } from './runtime-manager/global-state.js';
export { previewHomeProjectCleanup } from './runtime-manager/global-state.js';
export type { RuntimeId } from './runtime-manager/inventory.js';
export { runtimeRoot } from './runtime-manager/paths.js';
export type RuntimeChoice = RuntimeId | 'auto' | 'all';

type FileAction = PlannedFileAction;

export interface SetupOptions {
  projectDir: string;
  cliVersion: string;
  runtime?: RuntimeChoice;
  /** Explicit runtime selection from the interactive setup wizard. */
  runtimes?: RuntimeId[];
  scope?: InstallScope;
  minimal?: boolean;
  version?: string;
  dryRun?: boolean;
  /** Preserve already-managed adapters when installing or updating one runtime. */
  merge?: boolean;
  /** Reuse every recorded adapter scope when doctor repairs managed assets. */
  preserveExistingScopes?: boolean;
  /** A named runtime update may deliberately replace its saved scope. */
  overrideExistingScope?: boolean;
  /** Disable external runtime package changes for owned-file-only repair flows. */
  manageExternalRuntimes?: boolean;
  /** Codex discovery layout; Claude and Cursor retain their native fixed modes. */
  skillMode?: SkillInstallMode;
  /** Saved project discovery choice when repair also maintains a separate user bundle. */
  projectSkillMode?: SkillInstallMode;
  /** Recorded user installations repaired alongside existing project scopes. */
  userScopeRuntimes?: RuntimeId[];
  /** Permit replacement of only manifest-owned content when changing modes. */
  replaceManaged?: boolean;
  /** Restore a changed retained runtime package from the bundled copy after backing it up. */
  restoreRuntimePackages?: boolean;
  /** Injectable Claude command boundary for deterministic runtime integration tests. */
  claudeCommandRunner?: ClaudeCommandRunner;
  /** Injectable Codex command boundary for deterministic plugin integration tests. */
  codexCommandRunner?: CodexCommandRunner;
}

export interface SetupPreview {
  ok: true;
  dryRun: boolean;
  minimal: boolean;
  runtimes: RuntimeId[];
  runtimeScopes: Partial<Record<RuntimeId, InstallScope>>;
  scope: InstallScope;
  pipelineVersion: string | null;
  /**
   * The command-naming scheme this run will use, resolved from the flag or the
   * persisted per-project choice. Surfaced so the preview can state it: a user
   * re-running plain `openplanr setup` on a project that persisted `bare` otherwise had no
   * way to see which names they were about to get.
   */
  commandPrefix: CommandPrefix;
  skillModes: Partial<Record<RuntimeId, SkillInstallMode>>;
  projectSkillModes?: Partial<Record<RuntimeId, SkillInstallMode>>;
  userScopeRuntimes?: RuntimeId[];
  detectedRuntimes: RuntimeId[];
  unavailableRuntimes: RuntimeId[];
  scopeIncompatibleRuntimes: RuntimeId[];
  projectContext: {
    valid: boolean;
    path: string;
    reason: 'planr' | 'git' | 'none';
  };
  actions: Array<{
    runtime: string;
    scope: string;
    target: string;
    operation: 'create' | 'update' | 'unchanged' | 'retire';
    description: string;
  }>;
  runtimeOperations: Array<ClaudePluginOperation | CodexPluginOperation>;
  runtimeDiagnostics: Array<{
    runtime: RuntimeId;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    fix?: string;
  }>;
  /** Retained runtime packages a repair restores to their reviewed bytes. */
  runtimePackageRestores?: RuntimePackageRestore[];
}

/** A retained runtime package whose files differ from the bytes bundled with this CLI. */
export type RuntimePackageRestore = RuntimePackageDrift &
  Readonly<{ runtime: RuntimeId; version: string; root: string }>;

export function inspectProjectContext(projectDir: string): SetupPreview['projectContext'] {
  return inspectRuntimeProjectContext(projectDir);
}

export function detectRuntimes(): Array<{
  runtime: RuntimeId;
  installed: boolean;
  command: string;
}> {
  return detectInstalledRuntimes();
}

export function listRuntimeAdapters(): AdapterRegistryEntry[] {
  return listInstalledRuntimeAdapters();
}

function assertNodeVersion(): void {
  if (!supportsCliNodeVersion(process.versions.node)) {
    throw new RuntimeManagerError(
      'E_NODE_VERSION',
      cliNodeVersionMessage(process.versions.node),
      CLI_NODE_REMEDIATION,
    );
  }
}

function normalizeRuntime(value: RuntimeChoice = 'auto'): RuntimeChoice {
  return value === ('claude' as RuntimeChoice) ? 'claude-code' : value;
}

function chooseRuntimes(choice: RuntimeChoice): RuntimeId[] {
  const normalized = normalizeRuntime(choice);
  if (normalized === 'all') return ['claude-code', 'codex', 'cursor'];
  if (normalized !== 'auto') {
    if (!['claude-code', 'codex', 'cursor'].includes(normalized)) {
      throw new RuntimeManagerError(
        'E_RUNTIME_UNSUPPORTED',
        `Runtime "${normalized}" is not supported.`,
        'Choose auto, claude, codex, cursor, or all.',
      );
    }
    return [normalized as RuntimeId];
  }
  const detected = detectRuntimes()
    .filter((item) => item.installed)
    .map((item) => item.runtime);
  if (detected.length === 0) {
    throw new RuntimeManagerError(
      'E_RUNTIME_NOT_FOUND',
      'No supported coding runtime was detected.',
      'Install Claude Code, Codex, or Cursor, or pass `--runtime all` to prepare adapter assets.',
    );
  }
  return detected;
}

function operationFor(action: FileAction): 'create' | 'update' | 'unchanged' {
  if (!existsSync(action.target)) return 'create';
  return hash(readFileSync(action.target)) === hash(actionBytes(action)) ? 'unchanged' : 'update';
}

/** Files added to a retained runtime package; a restore removes them after the backup. */
function planPackageRetirements(restores: readonly RuntimePackageRestore[]): FileAction[] {
  return restores.flatMap((restore) =>
    restore.unexpected.map((file) => {
      const target = path.join(restore.root, file);
      return {
        runtime: 'core' as const,
        scope: 'user' as const,
        target,
        content: readFileSync(target),
        kind: 'file' as const,
        custody: 'runtime-package' as const,
        description: `Remove ${file}, which was added to the exact ${restore.runtime} runtime package`,
      };
    }),
  );
}

/** A deliberate scope narrowing retires only unchanged, previously owned project bytes. */
function planScopeRetirements(
  options: SetupOptions,
  project: RuntimeState['projects'][string] | undefined,
  runtimes: RuntimeId[],
  actions: FileAction[],
): FileAction[] {
  if (!project) return [];
  const retainedTargets = new Set(actions.map((action) => action.target));
  const candidates = project.ownedFiles.filter(
    (file) =>
      !retainedTargets.has(file.target) &&
      (runtimes.includes(file.runtime as RuntimeId) ||
        (file.runtime === 'core' &&
          options.overrideExistingScope &&
          options.scope === 'user' &&
          file.target.endsWith('runtime-lock.json'))),
  );
  return candidates.flatMap((file) => {
    assertMutableOwnedTarget(file.target, options.projectDir, 'E_MIGRATION_CONFLICT');
    if (!existsSync(file.target)) return [];
    const metadata = lstatSync(file.target);
    if (metadata.isSymbolicLink() || !metadata.isFile())
      throw new RuntimeManagerError(
        'E_MIGRATION_CONFLICT',
        `Refusing non-file managed retirement target ${file.target}.`,
      );
    const content = readFileSync(file.target);
    if (ownershipHash(content, file.kind, file.marker) !== file.hash)
      throw new RuntimeManagerError(
        'E_MIGRATION_CONFLICT',
        `Refusing to retire modified OpenPlanr file ${file.target}.`,
        'Preserve the hand edits before changing the installation scope.',
      );
    return [
      {
        ...file,
        scope: 'project' as const,
        content,
        description: 'Retire an unchanged managed copy superseded by the exact runtime package',
      },
    ];
  });
}

function planUserBundleTransition(
  state: RuntimeState,
  actions: FileAction[],
): { retired: OwnedFile[] } {
  const existing = state.userBundles?.codex?.ownedFiles ?? [];
  return planCodexUserBundleTransition({
    actions,
    existing,
    skillsRoot: codexSkillsRoot(),
    pathIsWithin,
    assertUserOwnedTarget,
    ownershipHash,
    hash,
    actionBytes,
    conflict: (message, recovery) => {
      throw new RuntimeManagerError('E_MIGRATION_CONFLICT', message, recovery);
    },
  }) as { retired: OwnedFile[] };
}

async function resolveCommandPrefix(options: SetupOptions): Promise<CommandPrefix> {
  return skillInstallMode('codex', options) === 'direct' ? 'bare' : 'namespaced';
}

export async function previewSetup(options: SetupOptions): Promise<SetupPreview> {
  assertNodeVersion();
  const scope = options.scope ?? 'user';
  if (!['user', 'project', 'both'].includes(scope)) {
    throw new RuntimeManagerError(
      'E_SCOPE_INVALID',
      `Install scope "${options.scope}" is invalid.`,
      'Choose user, project, or both.',
    );
  }
  if (
    options.skillMode &&
    !['direct', 'unified-plugin', 'project-rule'].includes(options.skillMode)
  ) {
    throw new RuntimeManagerError(
      'E_SKILL_MODE_INVALID',
      `Skill installation mode "${options.skillMode}" is invalid.`,
      'Choose direct, unified-plugin, or project-rule.',
    );
  }
  const projectContext = inspectProjectContext(options.projectDir);
  let selectedRuntimes = options.minimal
    ? []
    : options.runtimes
      ? [...new Set(options.runtimes)]
      : chooseRuntimes(options.runtime ?? 'auto');
  if (!options.minimal && (scope === 'project' || scope === 'both') && !projectContext.valid) {
    const canUseUserScope =
      !options.minimal &&
      selectedRuntimes.length > 0 &&
      selectedRuntimes.every((runtime) =>
        listRuntimeAdapters()
          .find((adapter) => adapter.id === runtime)
          ?.installScopes.includes('user'),
      ) &&
      options.skillMode !== 'project-rule';
    throw new RuntimeManagerError(
      'E_PROJECT_CONTEXT_REQUIRED',
      `Project-scoped setup requires a Git worktree or initialized OpenPlanr project; ${projectContext.path} is neither.`,
      `Change into your project and rerun this command, or run \`${CLI_COMMAND} init\` here to initialize one.${canUseUserScope ? ' To install across projects instead, rerun this command with --scope user.' : ''}`,
    );
  }
  const folderConflict =
    !options.minimal && (scope === 'project' || scope === 'both')
      ? planningFolderConflict(options.projectDir)
      : null;
  if (folderConflict)
    throw new RuntimeManagerError(folderConflict.code, folderConflict.problem, folderConflict.fix);
  let scopeIncompatibleRuntimes: RuntimeId[] = [];
  if (!options.minimal && (options.runtime ?? 'auto') === 'auto' && !options.runtimes) {
    const adapters = listRuntimeAdapters();
    scopeIncompatibleRuntimes = selectedRuntimes.filter((runtime) => {
      const adapter = adapters.find((entry) => entry.id === runtime);
      return scope === 'user' && !adapter?.installScopes.includes('user');
    });
    selectedRuntimes = selectedRuntimes.filter(
      (runtime) => !scopeIncompatibleRuntimes.includes(runtime),
    );
    if (selectedRuntimes.length === 0) {
      throw new RuntimeManagerError(
        'E_SCOPE_UNSUPPORTED',
        'Detected coding agents require project scope, but setup defaulted to user scope.',
        `Change into a Git or initialized OpenPlanr project and run \`${CLI_COMMAND} setup --scope project\`.`,
      );
    }
  }
  let runtimes = selectedRuntimes;
  const runtimeScopes: Partial<Record<RuntimeId, InstallScope>> = {};
  if ((options.merge || options.preserveExistingScopes) && !options.minimal) {
    const state = await loadState();
    const project = state.projects[projectKey(options.projectDir)];
    const existing = project?.runtimes ?? [];
    for (const runtime of existing) {
      runtimeScopes[runtime] =
        project?.runtimeScopes?.[runtime] ?? inferRuntimeScope(project?.ownedFiles ?? [], runtime);
    }
    const savedMode = state.userBundles?.codex?.installMode ?? project?.skillModes?.codex;
    options = { ...options, skillMode: options.skillMode ?? savedMode };
    if (options.preserveExistingScopes) {
      const userScopeRuntimes = selectedRuntimes.filter((runtime) => state.userBundles?.[runtime]);
      for (const runtime of userScopeRuntimes) runtimeScopes[runtime] ??= 'user';
      options = {
        ...options,
        userScopeRuntimes,
        skillMode: options.skillMode ?? savedMode,
        projectSkillMode: project?.skillModes?.codex,
      };
    }
    if (options.merge) runtimes = [...new Set([...existing, ...runtimes])];
  }
  if (!options.preserveExistingScopes || options.overrideExistingScope) {
    for (const runtime of selectedRuntimes) runtimeScopes[runtime] = scope;
  }
  const pipeline = options.minimal ? null : resolvePipelinePackage();
  if (!options.minimal) {
    const { registry } = readRegistry();
    for (const runtime of runtimes) {
      const adapter = registry.adapters.find((entry) => entry.id === runtime);
      if (!adapter)
        throw new RuntimeManagerError('E_ADAPTER_MISSING', `Adapter ${runtime} is absent.`);
      runtimeScopes[runtime] = normalizeInstallScope(
        adapter,
        runtimeScopes[runtime] ?? options.scope ?? 'user',
      );
    }
    if (runtimes.includes('codex')) {
      const codexScope = runtimeScopes.codex ?? scope;
      const mode = skillInstallMode('codex', options);
      if (mode === 'project-rule' && !['project', 'both'].includes(codexScope)) {
        throw new RuntimeManagerError(
          'E_SKILL_MODE_SCOPE',
          'Codex project-rule mode requires project or both scope.',
          'Use --scope project or --scope both.',
        );
      }
      if (
        mode === 'unified-plugin' &&
        !['user', 'both'].includes(codexScope) &&
        !options.userScopeRuntimes?.includes('codex')
      ) {
        throw new RuntimeManagerError(
          'E_SKILL_MODE_SCOPE',
          `Codex ${mode} mode requires user or both scope.`,
          'Use --scope user or --scope both.',
        );
      }
    }
  }
  const commandPrefix = await resolveCommandPrefix(options);
  const retainedProject = options.preserveExistingScopes
    ? (await loadState()).projects[projectKey(options.projectDir)]
    : undefined;
  const packageRestores: RuntimePackageRestore[] = [];
  const actions = buildActions(options, runtimes, runtimeScopes, retainedProject, packageRestores);
  const packageRetirements = planPackageRetirements(packageRestores);
  assertActionCustody([...actions, ...packageRetirements], options.projectDir);
  const scopeRetirements = planScopeRetirements(
    options,
    (await loadState()).projects[projectKey(options.projectDir)],
    runtimes,
    actions,
  );
  const retiredProjectRules = [
    ...planRetiredCursorProjectRules(options.projectDir, runtimes, runtimeScopes),
    ...planRetiredClaudeProjectAgents(options.projectDir, runtimes, runtimeScopes),
  ];
  const needsTransitionState =
    runtimes.includes('codex') ||
    actions.some(
      (action) =>
        (action.runtime === 'codex' && action.scope === 'user') ||
        action.custody === 'professional-skill',
    );
  const transitionState = needsTransitionState ? await loadState() : undefined;
  if (transitionState) {
    assertProfessionalSkillTransition(transitionState, options.projectDir, actions);
  }
  const userBundleTransition = actions.some(
    (action) => action.runtime === 'codex' && action.scope === 'user',
  )
    ? planUserBundleTransition(transitionState as RuntimeState, actions)
    : { retired: [] };
  const manageClaudePlugins =
    options.manageExternalRuntimes !== false &&
    !options.minimal &&
    runtimes.includes('claude-code') &&
    (['user', 'both'].includes(runtimeScopes['claude-code'] ?? scope) ||
      options.userScopeRuntimes?.includes('claude-code')) &&
    (Boolean(options.claudeCommandRunner) ||
      detectRuntimes().some((runtime) => runtime.runtime === 'claude-code' && runtime.installed));
  const claudeInspection = manageClaudePlugins
    ? inspectBundledClaudePluginIntegration(bundledHostRoot('claude'), options.claudeCommandRunner)
    : undefined;
  const runtimeDiagnostics: SetupPreview['runtimeDiagnostics'] = [];
  if (claudeInspection) {
    if (claudeInspection.error) {
      runtimeDiagnostics.push({
        runtime: 'claude-code',
        status: 'fail',
        message: `Claude plugin state could not be inspected: ${claudeInspection.error}`,
        fix: `Update Claude Code, then rerun \`${CLI_COMMAND} setup --runtime claude --scope user\`.`,
      });
    } else if (claudeInspection.ready) {
      runtimeDiagnostics.push({
        runtime: 'claude-code',
        status: 'pass',
        message: 'Claude plugins match the OpenPlanr compatibility versions',
      });
    } else {
      runtimeDiagnostics.push({
        runtime: 'claude-code',
        status: 'warn',
        message: 'Claude plugins will be installed or updated after confirmation',
      });
    }
    if (claudeInspection.legacyPluginIds.length > 0) {
      runtimeDiagnostics.push({
        runtime: 'claude-code',
        status: 'warn',
        message: `Legacy Claude plugin installation detected: ${claudeInspection.legacyPluginIds.join(', ')}`,
        fix: 'After verifying the official plugin, remove the legacy plugin from Claude Code.',
      });
    }
    if (claudeInspection.duplicatePluginIds.length > 0) {
      runtimeDiagnostics.push({
        runtime: 'claude-code',
        status: 'warn',
        ...duplicateClaudePluginDiagnostic(claudeInspection),
      });
    }
  }
  const codexMode = runtimes.includes('codex') ? skillInstallMode('codex', options) : undefined;
  const previousCodexMode =
    transitionState?.userBundles?.codex?.installMode ??
    (transitionState?.userBundles?.codex ? 'direct' : undefined) ??
    transitionState?.projects[projectKey(options.projectDir)]?.skillModes?.codex;
  const manageCodexPlugin = Boolean(
    codexMode &&
      (['user', 'both'].includes(runtimeScopes.codex ?? scope) ||
        options.userScopeRuntimes?.includes('codex')) &&
      options.manageExternalRuntimes !== false &&
      (detectRuntimes().some((runtime) => runtime.runtime === 'codex' && runtime.installed) ||
        options.codexCommandRunner),
  );
  const codexInspection = manageCodexPlugin
    ? inspectCodexPluginIntegration(
        bundledHostRoot('openai'),
        codexMode as SkillInstallMode,
        previousCodexMode,
        options.codexCommandRunner,
      )
    : undefined;
  if (codexInspection) {
    if (codexInspection.error) {
      runtimeDiagnostics.push({
        runtime: 'codex',
        status: 'fail',
        message: `Codex plugin state could not be inspected: ${codexInspection.error}`,
        fix: `Repair the Codex marketplace state, then rerun ${CLI_COMMAND} setup --dry-run.`,
      });
    } else if (codexInspection.duplicates.length > 0) {
      runtimeDiagnostics.push({
        runtime: 'codex',
        status: 'warn',
        message: `Duplicate OpenPlanr Codex plugin discovery detected: ${codexInspection.duplicates.join(', ')}`,
        fix: codexInspection.duplicates.every((id) =>
          codexInspection.operations.some(
            (operation) => operation.kind === 'remove' && operation.id === id,
          ),
        )
          ? 'Confirm the listed managed plugin removals to keep the saved discovery choice.'
          : 'Remove or disable the unrelated duplicate after confirming which installation should remain active.',
      });
    } else if (codexInspection.ready) {
      runtimeDiagnostics.push({
        runtime: 'codex',
        status: 'pass',
        message: `Codex ${codexMode} discovery is current`,
      });
    } else if (codexInspection.operations.length > 0) {
      runtimeDiagnostics.push({
        runtime: 'codex',
        status: 'warn',
        message:
          'Codex integration will change after confirmation; see the plugin and file changes above',
      });
    }
  }
  if (userBundleTransition.retired.length > 0 && previousCodexMode !== codexMode) {
    runtimeDiagnostics.push({
      runtime: 'codex',
      status: 'warn',
      message: `${userBundleTransition.retired.length} OpenPlanr-managed individual Codex skill files will be backed up and removed`,
      fix: 'Review these removals, then confirm guided setup or rerun with --replace-managed.',
    });
  }
  return {
    ok: true,
    dryRun: Boolean(options.dryRun),
    minimal: Boolean(options.minimal),
    commandPrefix,
    skillModes: skillInstallModes(runtimes, options),
    ...(options.projectSkillMode
      ? { projectSkillModes: skillInstallModes(runtimes, options, 'project') }
      : {}),
    ...(options.userScopeRuntimes?.length ? { userScopeRuntimes: options.userScopeRuntimes } : {}),
    runtimes,
    runtimeScopes,
    scope,
    pipelineVersion: pipeline?.version ?? null,
    detectedRuntimes: detectRuntimes()
      .filter((item) => item.installed)
      .map((item) => item.runtime),
    unavailableRuntimes: detectRuntimes()
      .filter((item) => !item.installed)
      .map((item) => item.runtime),
    scopeIncompatibleRuntimes,
    projectContext,
    actions: [
      ...actions.map((action) => ({
        runtime: action.runtime,
        scope: action.scope,
        target: action.target,
        operation: operationFor(action),
        description: action.description,
      })),
      ...packageRetirements.map((action) => ({
        runtime: action.runtime,
        scope: action.scope,
        target: action.target,
        operation: 'retire' as const,
        description: action.description,
      })),
      ...retiredProjectRules.map((action) => ({
        runtime: action.runtime,
        scope: action.scope,
        target: action.target,
        operation: 'retire' as const,
        description: action.description,
      })),
      ...scopeRetirements.map((action) => ({
        runtime: action.runtime,
        scope: action.scope,
        target: action.target,
        operation: 'retire' as const,
        description: action.description,
      })),
      ...userBundleTransition.retired.map((file) => ({
        runtime: file.runtime,
        scope: file.scope ?? 'user',
        target: file.target,
        operation: 'retire' as const,
        description: 'Retire a previously owned global Codex skill asset',
      })),
    ],
    runtimeOperations: [
      ...(options.preserveExistingScopes && claudeInspection?.ready
        ? []
        : (claudeInspection?.operations ?? [])),
      ...(codexInspection?.operations ?? []),
    ],
    runtimeDiagnostics,
    ...(packageRestores.length > 0 ? { runtimePackageRestores: packageRestores } : {}),
  };
}

export async function applySetup(options: SetupOptions): Promise<
  SetupPreview & {
    backupDir?: string;
    appliedRuntimeOperations?: Array<ClaudePluginOperation | CodexPluginOperation>;
    restartRequired?: boolean;
  }
> {
  const preview = await previewSetup(options);
  if (options.dryRun || options.minimal) return preview;
  const inspectionFailure = preview.runtimeDiagnostics.find((entry) => entry.status === 'fail');
  if (inspectionFailure) {
    throw new RuntimeManagerError(
      inspectionFailure.runtime === 'codex'
        ? 'E_CODEX_PLUGIN_INSPECTION_FAILED'
        : 'E_CLAUDE_PLUGIN_INSPECTION_FAILED',
      inspectionFailure.message,
      inspectionFailure.fix,
    );
  }
  // Use the same saved discovery choice that produced the preview, including during repair.
  options = {
    ...options,
    skillMode: preview.skillModes.codex ?? options.skillMode,
    projectSkillMode: preview.projectSkillModes?.codex ?? options.projectSkillMode,
    userScopeRuntimes: preview.userScopeRuntimes ?? options.userScopeRuntimes,
  };
  assertApprovedTargetCustody(
    runtimeRoot(),
    runtimeRoot(),
    planrCustodyAnchor(),
    'E_MIGRATION_CONFLICT',
    'Global runtime root',
  );
  await mkdir(runtimeRoot(), { recursive: true });
  const lockPath = path.join(runtimeRoot(), 'setup.lock');
  let lockHandle: FileHandle;
  try {
    lockHandle = await open(lockPath, 'wx', 0o600);
  } catch {
    throw new RuntimeManagerError(
      'E_SETUP_BUSY',
      'Another OpenPlanr setup or migration is already running.',
      'Wait for it to finish. If no process is running, remove the verified stale setup lock.',
    );
  }
  let backup: { dir: string; manifest: BackupManifest } | undefined;
  try {
    const commandPrefix = await resolveCommandPrefix(options);
    const state = await loadState();
    const retainedProject = options.preserveExistingScopes
      ? state.projects[projectKey(options.projectDir)]
      : undefined;
    const packageRestores: RuntimePackageRestore[] = [];
    const actions = buildActions(
      options,
      preview.runtimes,
      preview.runtimeScopes,
      retainedProject,
      packageRestores,
    );
    const packageRetirements = planPackageRetirements(packageRestores);
    assertActionCustody([...actions, ...packageRetirements], options.projectDir);
    const restoredPackageTargets = new Set(
      packageRestores.flatMap((restore) =>
        restore.changed.map((file) => path.join(restore.root, file)),
      ),
    );
    const scopeRetirements = planScopeRetirements(
      options,
      state.projects[projectKey(options.projectDir)],
      preview.runtimes,
      actions,
    );
    const retiredProjectRules = [
      ...planRetiredCursorProjectRules(options.projectDir, preview.runtimes, preview.runtimeScopes),
      ...planRetiredClaudeProjectAgents(
        options.projectDir,
        preview.runtimes,
        preview.runtimeScopes,
      ),
    ];
    const previousCodexMode =
      state.userBundles?.codex?.installMode ??
      (state.userBundles?.codex ? 'direct' : undefined) ??
      state.projects[projectKey(options.projectDir)]?.skillModes?.codex;
    assertProfessionalSkillTransition(state, options.projectDir, actions);
    const transition = actions.some(
      (action) => action.runtime === 'codex' && action.scope === 'user',
    )
      ? planUserBundleTransition(state, actions)
      : { retired: [] };
    const replacesPlugin = preview.runtimeOperations.some(
      (operation) => operation.runtime === 'codex' && operation.kind === 'remove',
    );
    const replacesClaudePlugin = preview.runtimeOperations.some(
      (operation) => operation.runtime === 'claude-code' && operation.kind === 'remove',
    );
    const desiredCodexMode = preview.skillModes.codex;
    const changesInstallMode = Boolean(
      previousCodexMode && desiredCodexMode && previousCodexMode !== desiredCodexMode,
    );
    if (
      ((changesInstallMode && transition.retired.length > 0) ||
        replacesPlugin ||
        replacesClaudePlugin) &&
      !options.replaceManaged
    ) {
      throw new RuntimeManagerError(
        'E_INSTALL_MODE_CONFLICT',
        'Changing OpenPlanr discovery mode would retire existing OpenPlanr-managed content.',
        `Review ${CLI_COMMAND} setup --dry-run, then rerun with --replace-managed to replace only OpenPlanr-owned content.`,
      );
    }
    const expectedTargets = new Map(
      actions.map((action) => {
        if (!existsSync(action.target)) return [action.target, null] as const;
        const metadata = lstatSync(action.target);
        if (metadata.isSymbolicLink() || !metadata.isFile())
          throw new RuntimeManagerError(
            'E_MIGRATION_CONFLICT',
            `Managed target is no longer a regular file: ${action.target}.`,
            'Preserve the changed target and inspect it before rerunning setup.',
          );
        return [action.target, hash(readFileSync(action.target))] as const;
      }),
    );
    const changed = actions.filter((action) => operationFor(action) !== 'unchanged');
    const retirementActions: FileAction[] = transition.retired.map((file) => ({
      runtime: file.runtime,
      scope: 'user',
      target: file.target,
      content: Buffer.alloc(0),
      kind: file.kind,
      marker: file.marker,
      description: 'Retire a previously owned global Codex skill asset',
    }));
    const stateAction: FileAction = {
      runtime: 'core',
      scope: 'user',
      target: statePath(),
      content: Buffer.alloc(0),
      kind: 'file',
      description: 'Update global runtime ownership state',
    };
    const backupTargets = [
      ...changed,
      ...retirementActions,
      ...retiredProjectRules,
      ...packageRetirements,
      ...scopeRetirements,
      stateAction,
    ].filter(
      (action, index, list) =>
        list.findIndex((candidate) => candidate.target === action.target) === index,
    );
    try {
      backup = await createBackup(options.projectDir, backupTargets);
    } catch (cause) {
      throw new RuntimeManagerError(
        'E_BACKUP_FAILED',
        `Could not create byte-for-byte setup backup: ${cause instanceof Error ? cause.message : String(cause)}`,
        'No setup files were changed. Fix backup permissions and rerun setup.',
      );
    }

    const retiredTargets = new Set<string>();
    try {
      const owned: OwnedFile[] = [];
      for (const action of actions) {
        const verifyCurrent = () => {
          assertMutableOwnedTarget(action.target, options.projectDir, 'E_MIGRATION_CONFLICT');
          const targetExists = existsSync(action.target);
          const currentMetadata = targetExists ? lstatSync(action.target) : undefined;
          if (
            (targetExists && (currentMetadata?.isSymbolicLink() || !currentMetadata?.isFile())) ||
            (targetExists ? hash(readFileSync(action.target)) : null) !==
              expectedTargets.get(action.target)
          )
            throw new RuntimeManagerError(
              'E_MIGRATION_CONFLICT',
              `Managed bytes changed during setup: ${action.target}.`,
              'The concurrent edit was preserved; inspect it before rerunning setup.',
            );
        };
        verifyCurrent();
        const content = actionBytes(action);
        if (
          action.custody === 'runtime-package' &&
          !restoredPackageTargets.has(action.target) &&
          existsSync(action.target) &&
          !readFileSync(action.target).equals(content)
        ) {
          throw new RuntimeManagerError(
            'E_MIGRATION_CONFLICT',
            `Immutable runtime bytes changed during setup: ${action.target}.`,
            'Preserve the changed cache; rerun with the reviewed package after resolving its custody.',
          );
        }
        if (operationFor(action) !== 'unchanged')
          await atomicWrite(action.target, content, verifyCurrent);
        if (hash(readFileSync(action.target)) !== hash(content)) {
          throw new RuntimeManagerError(
            'E_SETUP_VERIFY_FAILED',
            `Installed bytes failed verification at ${action.target}.`,
          );
        }
        owned.push({
          runtime: action.runtime,
          scope: action.scope,
          target: action.target,
          kind: action.kind,
          marker: action.marker,
          hash: ownershipHash(content, action.kind, action.marker),
        });
        const entry = backup.manifest.files.find((candidate) => candidate.target === action.target);
        if (entry) entry.afterHash = hash(content);
      }
      for (const retired of transition.retired) {
        assertUserOwnedTarget(retired, 'codex', 'E_RUNTIME_STATE_INVALID');
        if (existsSync(retired.target)) {
          const metadata = lstatSync(retired.target);
          if (
            metadata.isSymbolicLink() ||
            !metadata.isFile() ||
            ownershipHash(readFileSync(retired.target), retired.kind, retired.marker) !==
              retired.hash
          ) {
            throw new RuntimeManagerError(
              'E_MIGRATION_CONFLICT',
              `Managed Codex bytes changed during retirement: ${retired.target}.`,
              'The concurrent edit was preserved. Inspect it before rerunning setup.',
            );
          }
          await unlink(retired.target);
          retiredTargets.add(retired.target);
        }
      }
      for (const retired of scopeRetirements) {
        assertMutableOwnedTarget(retired.target, options.projectDir, 'E_MIGRATION_CONFLICT');
        if (
          !existsSync(retired.target) ||
          lstatSync(retired.target).isSymbolicLink() ||
          !lstatSync(retired.target).isFile() ||
          hash(readFileSync(retired.target)) !== hash(retired.content)
        )
          throw new RuntimeManagerError(
            'E_MIGRATION_CONFLICT',
            `Managed project bytes changed during scope update: ${retired.target}.`,
            'The setup transaction restored its pre-setup bytes; inspect the file and rerun.',
          );
        if (retired.kind === 'managed-block') {
          const content = Buffer.from(
            removeManagedBlock(retired.content.toString('utf8'), retired.marker ?? 'runtime'),
          );
          await atomicWrite(retired.target, content, () => {
            assertMutableOwnedTarget(retired.target, options.projectDir, 'E_MIGRATION_CONFLICT');
            if (
              !existsSync(retired.target) ||
              lstatSync(retired.target).isSymbolicLink() ||
              !lstatSync(retired.target).isFile() ||
              hash(readFileSync(retired.target)) !== hash(retired.content)
            )
              throw new RuntimeManagerError(
                'E_MIGRATION_CONFLICT',
                `Managed project bytes changed during scope retirement: ${retired.target}.`,
                'The concurrent edit was preserved; inspect the retained backup before retrying.',
              );
          });
          const entry = backup.manifest.files.find(
            (candidate) => candidate.target === retired.target,
          );
          if (entry) entry.afterHash = hash(content);
        } else {
          await unlink(retired.target);
          retiredTargets.add(retired.target);
        }
      }
      for (const retired of retiredProjectRules) {
        assertMutableOwnedTarget(retired.target, options.projectDir, 'E_MIGRATION_CONFLICT');
        if (!existsSync(retired.target)) continue;
        const metadata = lstatSync(retired.target);
        if (
          metadata.isSymbolicLink() ||
          !metadata.isFile() ||
          hash(readFileSync(retired.target)) !== hash(retired.content)
        ) {
          throw new RuntimeManagerError(
            'E_MIGRATION_CONFLICT',
            `Retired project adapter bytes changed during setup: ${retired.target}.`,
            'The setup transaction restored the pre-setup bytes; inspect the file and rerun.',
          );
        }
        await unlink(retired.target);
        retiredTargets.add(retired.target);
      }
      for (const retired of packageRetirements) {
        assertMutableOwnedTarget(retired.target, options.projectDir, 'E_MIGRATION_CONFLICT');
        if (!existsSync(retired.target)) continue;
        const metadata = lstatSync(retired.target);
        if (
          metadata.isSymbolicLink() ||
          !metadata.isFile() ||
          hash(readFileSync(retired.target)) !== hash(retired.content)
        ) {
          throw new RuntimeManagerError(
            'E_MIGRATION_CONFLICT',
            `Runtime package bytes changed during setup: ${retired.target}.`,
            'The concurrent edit was preserved; inspect it before rerunning setup.',
          );
        }
        await unlink(retired.target);
        retiredTargets.add(retired.target);
      }

      const updatedAt = new Date().toISOString();
      state.schemaVersion = '2.0.0';
      state.userBundles ??= {};
      for (const runtime of preview.runtimes) {
        const userOwned = owned.filter((file) => file.runtime === runtime && file.scope === 'user');
        if (userOwned.length === 0) {
          if (runtime === 'codex' && transition.retired.length > 0) delete state.userBundles.codex;
          continue;
        }
        state.userBundles[runtime] = {
          runtime,
          scope: 'user',
          updatedAt,
          pipelineVersion: preview.pipelineVersion ?? 'planning-only',
          commandPrefix: runtime === 'codex' ? commandPrefix : 'namespaced',
          installMode: preview.skillModes[runtime],
          ownedFiles: userOwned,
        };
      }
      state.projects[projectKey(options.projectDir)] = {
        projectDir: path.resolve(options.projectDir),
        updatedAt,
        backupDir: backup.dir,
        backupManifestHash: backupManifestIdentity(backup.manifest),
        runtimes: [...new Set([...(retainedProject?.runtimes ?? []), ...preview.runtimes])],
        runtimeScopes: { ...retainedProject?.runtimeScopes, ...preview.runtimeScopes },
        skillModes: {
          ...retainedProject?.skillModes,
          ...(preview.projectSkillModes ?? preview.skillModes),
        },
        ...(preview.runtimes.includes('codex')
          ? { codexHome: effectiveCodexHome() }
          : retainedProject?.codexHome
            ? { codexHome: retainedProject.codexHome }
            : {}),
        ...(preview.runtimes.length === 1 ? { activeRuntime: preview.runtimes[0] } : {}),
        ownedFiles: [
          ...(retainedProject?.ownedFiles ?? []).filter(
            (file) =>
              !preview.runtimes.includes(file.runtime as RuntimeId) &&
              !owned.some((candidate) => candidate.target === file.target),
          ),
          ...owned.filter((file) => file.scope === 'project'),
        ],
      };
      const stateBytes = runtimeStateBytes(state);
      await atomicWrite(statePath(), stateBytes);
      const stateBackup = backup.manifest.files.find((entry) => entry.target === statePath());
      if (stateBackup) stateBackup.afterHash = hash(stateBytes);
      const backupManifestPath = path.join(backup.dir, 'migration-manifest.json');
      assertApprovedTargetCustody(
        backupManifestPath,
        backup.dir,
        planrCustodyAnchor(),
        'E_RUNTIME_STATE_INVALID',
        'Runtime backup manifest',
      );
      await atomicWrite(
        backupManifestPath,
        Buffer.from(`${JSON.stringify(backup.manifest, null, 2)}\n`),
      );
      assertClosedBackupTree(
        backup.dir,
        assertClosedBackupManifest(
          backup.manifest,
          backup.dir,
          options.projectDir,
          'E_RUNTIME_STATE_INVALID',
          true,
        ),
        options.projectDir,
        'E_RUNTIME_STATE_INVALID',
      );

      let appliedRuntimeOperations: Array<ClaudePluginOperation | CodexPluginOperation> | undefined;
      let restartRequired = false;
      const claudeOperations = preview.runtimeOperations.filter(
        (operation) => operation.runtime === 'claude-code',
      );
      if (claudeOperations.length > 0) {
        const inspection = inspectBundledClaudePluginIntegration(
          bundledHostRoot('claude'),
          options.claudeCommandRunner,
        );
        if (inspection.error) {
          throw new RuntimeManagerError(
            'E_CLAUDE_PLUGIN_INSPECTION_FAILED',
            `Could not inspect Claude plugins: ${inspection.error}`,
          );
        }
        let result: ReturnType<typeof applyBundledClaudePluginIntegration>;
        try {
          result = applyBundledClaudePluginIntegration(
            bundledHostRoot('claude'),
            inspection,
            options.claudeCommandRunner,
          );
        } catch (cause) {
          throw new RuntimeManagerError(
            'E_CLAUDE_PLUGIN_UPDATE_FAILED',
            cause instanceof Error ? cause.message : String(cause),
          );
        }
        appliedRuntimeOperations = result.operations;
        restartRequired = result.restartRequired;
      }
      const codexOperations = preview.runtimeOperations.filter(
        (operation) => operation.runtime === 'codex',
      );
      if (codexOperations.length > 0) {
        const inspection = inspectCodexPluginIntegration(
          bundledHostRoot('openai'),
          preview.skillModes.codex ?? 'direct',
          previousCodexMode,
          options.codexCommandRunner,
        );
        if (inspection.error)
          throw new RuntimeManagerError('E_CODEX_PLUGIN_INSPECTION_FAILED', inspection.error);
        try {
          const result = applyCodexPluginIntegration(
            bundledHostRoot('openai'),
            inspection,
            options.codexCommandRunner,
          );
          appliedRuntimeOperations = [...(appliedRuntimeOperations ?? []), ...result.operations];
          restartRequired ||= result.restartRequired;
        } catch (cause) {
          throw new RuntimeManagerError(
            'E_CODEX_PLUGIN_UPDATE_FAILED',
            cause instanceof Error ? cause.message : String(cause),
          );
        }
      }
      return {
        ...preview,
        backupDir: backup.dir,
        ...(appliedRuntimeOperations ? { appliedRuntimeOperations } : {}),
        restartRequired,
      };
    } catch (cause) {
      let restored: string[];
      try {
        restored = await restoreBackup(backup, retiredTargets);
      } catch (rollbackCause) {
        throw new RuntimeManagerError(
          'E_SETUP_ROLLBACK_FAILED',
          `Setup failed and automatic restore also failed: ${rollbackCause instanceof Error ? rollbackCause.message : String(rollbackCause)}`,
          `Current files were preserved. Compare them with the retained backup at ${backup.dir} before restoring any file.`,
        );
      }
      const detail = cause instanceof Error ? cause.message : String(cause);
      const causeCode = (cause as { code?: unknown } | undefined)?.code;
      throw new RuntimeManagerError(
        typeof causeCode === 'string' ? causeCode : 'E_SETUP_TRANSACTION_FAILED',
        detail,
        `Restored ${restored.length} file(s) to their exact pre-setup bytes: ${restored.join(', ')}.`,
      );
    }
  } finally {
    await lockHandle.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

function removeManagedBlock(existing: string, marker: string): string {
  const begin = `<!-- ##planr-${marker}:begin##`;
  const end = `<!-- ##planr-${marker}:end## -->`;
  const start = existing.indexOf(begin);
  const finish = existing.indexOf(end, start);
  if (start === -1 || finish === -1) return existing;
  return `${existing.slice(0, start).trimEnd()}${existing.slice(finish + end.length)}`.trimStart();
}

export async function rollbackRuntime(
  projectDir: string,
  backupDir?: string,
): Promise<{ ok: true; restored: string[]; retainedShared: string[] }> {
  const state = await loadState();
  const key = projectKey(projectDir);
  const project = state.projects[key];
  const recorded = project?.backupDir;
  const selected = backupDir ?? recorded;
  if (!selected || !recorded)
    throw new RuntimeManagerError(
      'E_ROLLBACK_NOT_FOUND',
      'No runtime backup is recorded for this project.',
    );
  assertRequestedProjectBinding(projectDir, key, project);
  if (path.resolve(selected) !== path.resolve(recorded)) {
    throw new RuntimeManagerError(
      'E_RUNTIME_STATE_INVALID',
      'The selected runtime backup is not the exact backup recorded for this project.',
      'Use the current project-owned backup recorded by OpenPlanr.',
    );
  }
  const directory = assertBackupDirectoryCustody(
    selected,
    projectDir,
    'E_RUNTIME_STATE_INVALID',
    true,
  );
  const manifestPath = path.join(directory, 'migration-manifest.json');
  const manifestBytes = await readCustodiedRegularFile(
    manifestPath,
    () =>
      assertApprovedTargetCustody(
        manifestPath,
        directory,
        planrCustodyAnchor(),
        'E_RUNTIME_STATE_INVALID',
        'Runtime backup manifest',
      ),
    'E_RUNTIME_STATE_INVALID',
    'Runtime backup manifest',
    4 * 1024 * 1024,
  );
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestBytes.toString('utf8')) as unknown;
  } catch {
    throw new RuntimeManagerError(
      'E_RUNTIME_STATE_INVALID',
      'Runtime backup manifest is not valid JSON.',
    );
  }
  const manifest = assertClosedBackupManifest(
    manifestValue,
    directory,
    projectDir,
    'E_RUNTIME_STATE_INVALID',
    true,
  );
  if (project.backupManifestHash !== backupManifestIdentity(manifest)) {
    throw new RuntimeManagerError(
      'E_RUNTIME_STATE_INVALID',
      'The selected runtime backup no longer matches its recorded manifest identity.',
      'Use the exact unmodified backup created by the recorded setup transaction.',
    );
  }
  assertClosedBackupTree(directory, manifest, projectDir, 'E_RUNTIME_STATE_INVALID');
  const restoreBytes = new Map<string, Buffer>();
  for (const entry of manifest.files) {
    assertMutableOwnedTarget(entry.target, projectDir, 'E_RUNTIME_STATE_INVALID');
    if (entry.existed) {
      restoreBytes.set(
        entry.target,
        await readBackupEntryBytes(directory, entry, projectDir, 'E_RUNTIME_STATE_INVALID'),
      );
    }
  }
  const restored: string[] = [];
  const retainedShared: string[] = [];
  const stateEntry = manifest.files.find(
    (entry) => path.resolve(entry.target) === path.resolve(statePath()),
  );
  if (!stateEntry?.afterHash) {
    throw new RuntimeManagerError(
      'E_RUNTIME_STATE_INVALID',
      'Runtime backup has no final ownership-state hash.',
    );
  }
  // Global ownership state may legitimately advance when another project reuses
  // the same user bundle. The current state was already structurally decoded,
  // target-confined, and used to authenticate this project's manifest identity;
  // rollback therefore merges it instead of requiring stale raw state bytes.
  let previousState: RuntimeState | undefined;
  if (stateEntry?.existed && stateEntry.backup) {
    const previousStateBytes = restoreBytes.get(stateEntry.target);
    if (!previousStateBytes) {
      throw new RuntimeManagerError(
        'E_RUNTIME_STATE_INVALID',
        'Backup preflight lost the validated ownership-state bytes.',
      );
    }
    try {
      previousState = decodeStoredRuntimeState(
        JSON.parse(previousStateBytes.toString('utf8')) as unknown,
      );
    } catch (cause) {
      if (cause instanceof RuntimeManagerError) throw cause;
      throw new RuntimeManagerError(
        'E_RUNTIME_STATE_INVALID',
        'Backed-up runtime ownership state is not valid JSON.',
      );
    }
  }
  const bundleRuntimeByTarget = new Map<string, RuntimeId>();
  for (const source of [state, previousState]) {
    for (const runtime of ['claude-code', 'codex', 'cursor'] as const) {
      for (const file of source?.userBundles?.[runtime]?.ownedFiles ?? []) {
        bundleRuntimeByTarget.set(path.resolve(file.target), runtime);
      }
    }
  }
  const otherProjectUsesUserRuntime = (runtime: RuntimeId): boolean =>
    Object.entries(state.projects).some(
      ([otherKey, otherProject]) =>
        otherKey !== key && projectUsesUserRuntime(otherProject, runtime),
    );
  const sharedTargets = new Set(
    manifest.files
      .filter((entry) => {
        const bundleRuntime = bundleRuntimeByTarget.get(path.resolve(entry.target));
        return (
          immutableRuntimeTarget(entry.target) ||
          (bundleRuntime !== undefined && otherProjectUsesUserRuntime(bundleRuntime)) ||
          Object.entries(state.projects).some(
            ([otherKey, otherProject]) =>
              otherKey !== key &&
              otherProject.ownedFiles.some((owned) => owned.target === entry.target),
          )
        );
      })
      .map((entry) => entry.target),
  );
  for (const entry of manifest.files) {
    if (path.resolve(entry.target) === path.resolve(statePath()) || sharedTargets.has(entry.target))
      continue;
    const targetExists = existsSync(entry.target);
    const targetChanged = entry.afterHash
      ? !targetExists || hash(await readFile(entry.target)) !== entry.afterHash
      : targetExists;
    if (targetChanged) {
      throw new RuntimeManagerError(
        'E_MIGRATION_CONFLICT',
        `Refusing to restore changed file ${entry.target}.`,
        'Restore it manually or choose a different backup.',
      );
    }
  }
  for (const entry of [...manifest.files].reverse()) {
    if (path.resolve(entry.target) === path.resolve(statePath())) continue;
    if (sharedTargets.has(entry.target)) {
      retainedShared.push(entry.target);
      continue;
    }
    const verifyCurrent = () => {
      assertMutableOwnedTarget(entry.target, projectDir, 'E_RUNTIME_STATE_INVALID');
      const present = existsSync(entry.target);
      const metadata = present ? lstatSync(entry.target) : undefined;
      if (
        (present && (metadata?.isSymbolicLink() || !metadata?.isFile())) ||
        (entry.afterHash
          ? !present || hash(readFileSync(entry.target)) !== entry.afterHash
          : present)
      )
        throw new RuntimeManagerError(
          'E_MIGRATION_CONFLICT',
          `Concurrent bytes prevent runtime rollback: ${entry.target}.`,
          'The current file was preserved; compare the retained backup before retrying.',
        );
    };
    verifyCurrent();
    if (entry.existed && entry.backup) {
      const bytes = restoreBytes.get(entry.target);
      if (!bytes)
        throw new RuntimeManagerError(
          'E_RUNTIME_STATE_INVALID',
          'Backup preflight lost validated bytes.',
        );
      await atomicWrite(entry.target, bytes, verifyCurrent);
    } else if (existsSync(entry.target)) {
      await unlink(entry.target);
    }
    restored.push(entry.target);
  }
  const affectedRuntimes = new Set<RuntimeId>([
    ...(project?.runtimes ?? []),
    ...[...bundleRuntimeByTarget.entries()]
      .filter(([target]) => manifest.files.some((entry) => path.resolve(entry.target) === target))
      .map(([, runtime]) => runtime),
  ]);
  state.userBundles ??= {};
  for (const runtime of affectedRuntimes) {
    if (otherProjectUsesUserRuntime(runtime)) continue;
    const previous = previousState?.userBundles?.[runtime];
    if (previous) state.userBundles[runtime] = previous;
    else delete state.userBundles[runtime];
  }
  const previousProject = previousState?.projects?.[key];
  if (previousProject) state.projects[key] = previousProject;
  else delete state.projects[key];
  await atomicWrite(statePath(), runtimeStateBytes(state));
  return { ok: true, restored, retainedShared };
}

export async function removeRuntime(
  runtime: RuntimeId,
  projectDir: string,
): Promise<{ ok: true; removed: string[]; retainedShared: string[] }> {
  const state = await loadState();
  const key = projectKey(projectDir);
  const project = state.projects[key];
  if (!project)
    throw new RuntimeManagerError(
      'E_RUNTIME_STATE_MISSING',
      'No managed runtime installation is recorded for this project.',
    );
  assertRequestedProjectBinding(projectDir, key, project);
  const removed: string[] = [];
  const retainedShared: string[] = [];
  const runtimeFiles = project.ownedFiles.filter((file) => file.runtime === runtime);
  const globalFiles = state.userBundles?.[runtime]?.ownedFiles ?? [];
  const hasOtherUserOwner = Object.entries(state.projects).some(
    ([otherKey, otherProject]) => otherKey !== key && projectUsesUserRuntime(otherProject, runtime),
  );
  const removalFiles = [...runtimeFiles, ...globalFiles];
  const sharedTargets = new Set(
    removalFiles
      .filter(
        (file) =>
          (hasOtherUserOwner && globalFiles.some((global) => global.target === file.target)) ||
          Object.entries(state.projects).some(
            ([otherKey, otherProject]) =>
              otherKey !== key &&
              otherProject.ownedFiles.some(
                (owned) => owned.runtime === runtime && owned.target === file.target,
              ),
          ),
      )
      .map((file) => file.target),
  );
  const lockFile = project.ownedFiles.find(
    (file) => file.runtime === 'core' && file.target.endsWith('runtime-lock.json'),
  );

  // Validate every owned byte before mutating anything so a late conflict cannot
  // leave the installation half-removed.
  for (const file of removalFiles) {
    if (!existsSync(file.target) || sharedTargets.has(file.target)) continue;
    const current = await readFile(file.target);
    if (ownershipHash(current, file.kind, file.marker) !== file.hash) {
      throw new RuntimeManagerError(
        'E_MIGRATION_CONFLICT',
        `Refusing to remove modified OpenPlanr file ${file.target}.`,
        'Run rollback or preserve the hand edits before removing the adapter.',
      );
    }
  }

  let lock:
    | {
        generatedAt: string;
        manifestDigest: string;
        protocolVersion: string;
        components: { pipeline: string };
        adapters: RuntimeLockAdapter[];
        skillModes?: Partial<Record<RuntimeId, SkillInstallMode>>;
      }
    | undefined;
  if (lockFile && existsSync(lockFile.target)) {
    const current = await readFile(lockFile.target);
    if (hash(current) !== lockFile.hash) {
      throw new RuntimeManagerError(
        'E_MIGRATION_CONFLICT',
        `Refusing to update modified OpenPlanr file ${lockFile.target}.`,
        'Run rollback or preserve the hand edits before removing the adapter.',
      );
    }
    try {
      lock = JSON.parse(current.toString('utf8')) as NonNullable<typeof lock>;
    } catch {
      throw new RuntimeManagerError(
        'E_MIGRATION_CONFLICT',
        `Refusing to update invalid runtime lock ${lockFile.target}.`,
        'Repair or roll back the runtime lock before removing the adapter.',
      );
    }
  }

  for (const file of removalFiles) {
    if (!existsSync(file.target)) continue;
    if (sharedTargets.has(file.target)) {
      retainedShared.push(file.target);
      continue;
    }
    const current = await readFile(file.target);
    if (file.kind === 'managed-block') {
      await atomicWrite(
        file.target,
        Buffer.from(removeManagedBlock(current.toString('utf8'), file.marker ?? 'runtime')),
      );
    } else {
      await unlink(file.target);
    }
    removed.push(file.target);
  }
  if (!hasOtherUserOwner && state.userBundles) delete state.userBundles[runtime];
  project.ownedFiles = project.ownedFiles.filter((file) => file.runtime !== runtime);
  project.runtimes = project.runtimes.filter((item) => item !== runtime);
  if (project.runtimeScopes) delete project.runtimeScopes[runtime];
  if (project.skillModes) delete project.skillModes[runtime];
  project.activeRuntime = project.runtimes.length === 1 ? project.runtimes[0] : undefined;
  project.updatedAt = new Date().toISOString();
  if (lockFile && lock) {
    lock.adapters = lock.adapters.filter((adapter) => adapter.runtime !== runtime);
    if (lock.skillModes) delete lock.skillModes[runtime];
    if (lock.adapters.length === 0) {
      await unlink(lockFile.target);
      project.ownedFiles = project.ownedFiles.filter((file) => file !== lockFile);
      removed.push(lockFile.target);
    } else {
      lock.generatedAt = new Date().toISOString();
      lock.manifestDigest = runtimeLockManifestDigest({
        protocolVersion: lock.protocolVersion,
        pipelineVersion: lock.components.pipeline,
        adapters: lock.adapters,
        skillModes: lock.skillModes,
      });
      const content = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`);
      await atomicWrite(lockFile.target, content);
      lockFile.hash = hash(content);
    }
  } else if (lockFile && project.runtimes.length === 0 && !existsSync(lockFile.target)) {
    project.ownedFiles = project.ownedFiles.filter((file) => file !== lockFile);
  }
  if (project.runtimes.length === 0 && project.ownedFiles.length === 0) delete state.projects[key];
  await atomicWrite(statePath(), runtimeStateBytes(state));
  return { ok: true, removed, retainedShared };
}

export async function managedRuntimesForProject(projectDir: string): Promise<RuntimeId[]> {
  const state = await loadState();
  const key = projectKey(projectDir);
  const project = state.projects[key];
  if (project) assertRequestedProjectBinding(projectDir, key, project);
  return [...(project?.runtimes ?? [])];
}

/** Coding agents OpenPlanr manages at user scope, then those this project manages at project scope. */
export async function installedRuntimeScopes(
  projectDir: string,
): Promise<Array<{ runtime: RuntimeId; scope: 'user' | 'project'; skillMode?: SkillInstallMode }>> {
  const state = await loadState();
  const installed: Array<{
    runtime: RuntimeId;
    scope: 'user' | 'project';
    skillMode?: SkillInstallMode;
  }> = [];
  for (const runtime of ['claude-code', 'codex', 'cursor'] as const) {
    const bundle = state.userBundles?.[runtime];
    if (bundle) {
      installed.push({
        runtime,
        scope: 'user',
        ...(bundle.installMode ? { skillMode: bundle.installMode } : {}),
      });
    }
  }
  const key = projectKey(projectDir);
  const project = state.projects[key];
  if (!project) return installed;
  assertRequestedProjectBinding(projectDir, key, project);
  for (const runtime of project.runtimes) {
    const scope =
      project.runtimeScopes?.[runtime] ?? inferRuntimeScope(project.ownedFiles, runtime);
    if (scope === 'user') continue;
    const skillMode = project.skillModes?.[runtime];
    installed.push({ runtime, scope: 'project', ...(skillMode ? { skillMode } : {}) });
  }
  return installed;
}

export function isOpenPlanrHome(projectDir: string): boolean {
  return canonicalProjectPath(projectDir) === canonicalProjectPath(userHome());
}

export async function cleanupHomeProjectInstall(): Promise<{ ok: true; removed: string[] }> {
  const state = await loadState();
  const key = projectKey(userHome());
  const project = state.projects[key];
  if (!project || canonicalProjectPath(project.projectDir) !== canonicalProjectPath(userHome())) {
    return { ok: true, removed: [] };
  }
  assertRequestedProjectBinding(userHome(), key, project);
  const projectFiles = project.ownedFiles.filter((file) => file.scope === 'project');
  for (const file of projectFiles) {
    if (!existsSync(file.target)) continue;
    const current = await readFile(file.target);
    if (ownershipHash(current, file.kind, file.marker) !== file.hash) {
      throw new RuntimeManagerError(
        'E_MIGRATION_CONFLICT',
        `Refusing to clean modified OpenPlanr content from ${file.target}.`,
        'Preserve the hand edits or use the recorded runtime backup before cleaning the home installation.',
      );
    }
  }

  const removed: string[] = [];
  for (const file of projectFiles) {
    if (!existsSync(file.target)) continue;
    if (file.kind === 'managed-block') {
      const remaining = removeManagedBlock(
        (await readFile(file.target, 'utf8')).toString(),
        file.marker ?? 'runtime',
      );
      if (remaining.trim()) await atomicWrite(file.target, Buffer.from(remaining));
      else await unlink(file.target);
    } else {
      await unlink(file.target);
    }
    removed.push(file.target);
  }

  project.ownedFiles = project.ownedFiles.filter((file) => file.scope !== 'project');
  for (const runtime of [...project.runtimes]) {
    const runtimeFiles = project.ownedFiles.filter((file) => file.runtime === runtime);
    if (runtimeFiles.length === 0) {
      project.runtimes = project.runtimes.filter((item) => item !== runtime);
      if (project.runtimeScopes) delete project.runtimeScopes[runtime];
    } else if (project.runtimeScopes) {
      project.runtimeScopes[runtime] = inferRuntimeScope(project.ownedFiles, runtime);
    }
  }
  project.updatedAt = new Date().toISOString();
  project.activeRuntime = project.runtimes.length === 1 ? project.runtimes[0] : undefined;
  if (project.runtimes.length === 0 && project.ownedFiles.length === 0) delete state.projects[key];
  await atomicWrite(statePath(), runtimeStateBytes(state));
  return { ok: true, removed };
}

export async function clearRuntimeStateForTests(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

export function bundledHostRoot(host: 'openai' | 'claude' | 'cursor'): string {
  return resolveBundledHostRoot(host);
}

export async function runtimeDoctor(
  projectDir: string,
  options: {
    pipelineRepair?: 'preview' | 'apply';
    claudeCommandRunner?: ClaudeCommandRunner;
    codexCommandRunner?: CodexCommandRunner;
    /** CLI root commands; enables the check for installed skills that still run `planr`. */
    commandRoots?: readonly string[];
  } = {},
): Promise<{
  ok: boolean;
  codexDiscovery?: CodexSkillDiscovery;
  repairs: Array<{ id: string; operation: 'remove'; target: string; applied: boolean }>;
  diagnostics: Array<{
    code: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    fix?: string;
  }>;
}> {
  return inspectRuntimeDoctor(projectDir, options);
}
