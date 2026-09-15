import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  constants as fsConstants,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spliceManagedBlock } from '../utils/splice-managed-block.js';
import {
  applyBundledClaudePluginIntegration,
  type ClaudeCommandRunner,
  type ClaudePluginOperation,
  inspectBundledClaudePluginIntegration,
} from './claude-plugin-service.js';
import {
  applyCodexPluginIntegration,
  type CodexCommandRunner,
  type CodexPluginOperation,
  inspectCodexPluginIntegration,
} from './codex-plugin-service.js';
import { resolvePipelinePackage } from './pipeline-package-service.js';
import { readOpenPlanrVersion } from './provenance-service.js';
import {
  classifyComponentDrift as classifyRuntimeComponentDrift,
  diagnoseManagedRuntimeFiles,
  diagnoseRuntimeProvenance,
} from './runtime-manager/doctor.js';
import {
  type CommandPrefix,
  type InstallScope,
  migrateLegacyGlobalRuntimeState,
  type OwnedFile,
  type RuntimeState,
  type SkillInstallMode,
} from './runtime-manager/global-state.js';
import {
  inventoryManagedSkillFiles,
  planCodexUserBundleTransition,
} from './runtime-manager/install-plan.js';
import {
  type AdapterRegistry,
  type AdapterRegistryEntry,
  detectInstalledRuntimes,
  inspectRuntimeProjectContext,
  listInstalledRuntimeAdapters,
  type RuntimeId,
} from './runtime-manager/inventory.js';

export type { RuntimeId } from './runtime-manager/inventory.js';
export type RuntimeChoice = RuntimeId | 'auto' | 'all';
export { classifyComponentDrift } from './runtime-manager/doctor.js';
export type { InstallScope, SkillInstallMode } from './runtime-manager/global-state.js';

interface FileAction {
  runtime: RuntimeId | 'core';
  scope: 'user' | 'project';
  target: string;
  content: Buffer;
  kind: 'file' | 'managed-block';
  marker?: string;
  custody?: 'professional-skill';
  description: string;
}

const RETIRED_CURSOR_WORKFLOW_RULES = [
  'planr-pipeline.mdc',
  'planr-pipeline-plan.mdc',
  'planr-pipeline-ship.mdc',
] as const;

const RETIRED_CURSOR_AGENT_RULES = [
  'backend-agent.md',
  'db-agent.md',
  'designer-agent.md',
  'devops-agent.md',
  'doc-gen-agent.md',
  'entity-scaffold-agent.md',
  'frontend-agent.md',
  'qa-agent.md',
  'specification-agent.md',
] as const;

interface BackupEntry {
  target: string;
  backup?: string;
  existed: boolean;
  beforeHash?: string;
  afterHash?: string;
}

interface BackupManifest {
  schemaVersion: '1.0.0';
  projectDir: string;
  createdAt: string;
  files: BackupEntry[];
}

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
  /** Disable external runtime package changes for owned-file-only repair flows. */
  manageExternalRuntimes?: boolean;
  /** Codex discovery layout; Claude and Cursor retain their native fixed modes. */
  skillMode?: SkillInstallMode;
  /** Permit replacement of only manifest-owned content when changing modes. */
  replaceManaged?: boolean;
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
   * re-running plain `planr setup` on a project that persisted `bare` otherwise had no
   * way to see which names they were about to get.
   */
  commandPrefix: CommandPrefix;
  skillModes: Partial<Record<RuntimeId, SkillInstallMode>>;
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
}

export class RuntimeManagerError extends Error {
  constructor(
    public code: string,
    message: string,
    public recovery?: string,
  ) {
    super(message);
    this.name = 'RuntimeManagerError';
  }

  toJSON() {
    return { ok: false, code: this.code, problem: this.message, recovery: this.recovery };
  }
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function managedBlockBytes(content: string | Buffer, marker = 'runtime'): Buffer {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : content;
  const begin = `<!-- ##planr-${marker}:begin##`;
  const end = `<!-- ##planr-${marker}:end## -->`;
  const start = text.indexOf(begin);
  const finish = text.indexOf(end, start);
  if (start === -1 || finish === -1) return Buffer.alloc(0);
  return Buffer.from(text.slice(start, finish + end.length));
}

function ownershipHash(
  content: string | Buffer,
  kind: FileAction['kind'],
  marker?: string,
): string {
  return hash(kind === 'managed-block' ? managedBlockBytes(content, marker) : content);
}

function canonicalProjectPath(projectDir: string): string {
  const resolved = path.resolve(projectDir);
  try {
    return realpathSync(resolved);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return resolved;
    throw cause;
  }
}

function projectKey(projectDir: string): string {
  return hash(canonicalProjectPath(projectDir)).slice(0, 16);
}

export function runtimeRoot(): string {
  return path.join(userHome(), '.planr', 'runtime');
}

function userHome(): string {
  return process.env.OPENPLANR_HOME ?? os.homedir();
}

function statePath(): string {
  return path.join(runtimeRoot(), 'state.json');
}

function codexSkillsRoot(): string {
  return path.join(userHome(), '.codex', 'skills');
}

function backupsRoot(): string {
  return path.join(userHome(), '.planr', 'backups');
}

function projectBackupsRoot(projectDir: string): string {
  return path.join(backupsRoot(), projectKey(projectDir));
}

function pathIsWithin(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertApprovedTargetCustody(
  target: string,
  approvedRoot: string,
  anchor: string,
  code: string,
  label: string,
): void {
  const selected = path.resolve(target);
  const root = path.resolve(approvedRoot);
  const boundary = path.resolve(anchor);
  if (!pathIsWithin(selected, root) || !pathIsWithin(root, boundary)) {
    throw new RuntimeManagerError(
      code,
      `${label} target ${selected} leaves its approved root ${root}.`,
      'Restore valid runtime ownership state and keep managed targets inside the exact approved bundle root.',
    );
  }
  let canonicalBoundary: string;
  try {
    const boundaryMetadata = lstatSync(boundary);
    if (boundaryMetadata.isSymbolicLink() || !boundaryMetadata.isDirectory())
      throw new Error('invalid boundary');
    canonicalBoundary = realpathSync(boundary);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new RuntimeManagerError(
      code,
      `${label} boundary ${boundary} is unavailable, non-directory, or symbolic.`,
      'Use one real user/project root and replace symbolic managed-root parents before retrying.',
    );
  }
  let current = boundary;
  const segments = path.relative(boundary, selected).split(path.sep).filter(Boolean);
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let metadata: ReturnType<typeof lstatSync>;
    try {
      metadata = lstatSync(current);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw cause;
    }
    if (metadata.isSymbolicLink()) {
      throw new RuntimeManagerError(
        code,
        `${label} target ${selected} traverses symbolic component ${current}.`,
        'Replace symbolic managed-root parents with real directories before retrying.',
      );
    }
    const isLeaf = index === segments.length - 1;
    if (!isLeaf && !metadata.isDirectory()) {
      throw new RuntimeManagerError(
        code,
        `${label} target ${selected} traverses non-directory component ${current}.`,
        'Repair the managed bundle root before retrying.',
      );
    }
    const canonical = realpathSync(current);
    if (
      canonical !== canonicalBoundary &&
      !canonical.startsWith(`${canonicalBoundary}${path.sep}`)
    ) {
      throw new RuntimeManagerError(
        code,
        `${label} target ${selected} escapes its canonical boundary.`,
        'Repair the managed bundle root before retrying.',
      );
    }
  }
}

function assertMutableOwnedTarget(target: string, projectDir: string, code: string): void {
  if (pathIsWithin(target, runtimeRoot())) {
    assertApprovedTargetCustody(
      target,
      runtimeRoot(),
      userHome(),
      code,
      'Global runtime ownership',
    );
    return;
  }
  if (pathIsWithin(target, codexSkillsRoot())) {
    assertApprovedTargetCustody(
      target,
      codexSkillsRoot(),
      userHome(),
      code,
      'Global Codex bundle ownership',
    );
    return;
  }
  if (pathIsWithin(target, projectDir)) {
    assertApprovedTargetCustody(target, projectDir, projectDir, code, 'Project runtime ownership');
    return;
  }
  throw new RuntimeManagerError(
    code,
    `Managed mutation target ${path.resolve(target)} is outside every approved runtime root.`,
    'Restore a valid ownership/backup manifest before retrying.',
  );
}

function assertBackupDirectoryCustody(
  selected: string,
  projectDir: string,
  code: string,
  requireExisting = false,
): string {
  const directory = path.resolve(selected);
  const approvedRoot = path.resolve(projectBackupsRoot(projectDir));
  if (path.dirname(directory) !== approvedRoot) {
    throw new RuntimeManagerError(
      code,
      `Runtime backup ${directory} is not one direct child of ${approvedRoot}.`,
      'Select only the exact project backup created by OpenPlanr.',
    );
  }
  assertApprovedTargetCustody(directory, approvedRoot, userHome(), code, 'Runtime backup');
  if (requireExisting) {
    let metadata: ReturnType<typeof lstatSync>;
    try {
      metadata = lstatSync(directory);
    } catch {
      throw new RuntimeManagerError(code, `Runtime backup ${directory} is unavailable.`);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new RuntimeManagerError(code, `Runtime backup ${directory} is not one real directory.`);
    }
  }
  return directory;
}

function backupEntryPath(directory: string, index: number, target: string): string {
  return path.join(
    directory,
    'files',
    `${String(index).padStart(3, '0')}-${path.basename(target)}`,
  );
}

function backupManifestIdentity(manifest: BackupManifest): string {
  return `sha256:${hash(
    JSON.stringify({
      schemaVersion: manifest.schemaVersion,
      projectDir: manifest.projectDir,
      createdAt: manifest.createdAt,
      files: manifest.files.map(({ target, backup, existed, beforeHash, afterHash }) => ({
        target,
        existed,
        ...(backup ? { backup } : {}),
        ...(beforeHash ? { beforeHash } : {}),
        ...(path.resolve(target) === path.resolve(statePath())
          ? {}
          : { expectedAfterHash: afterHash ?? null }),
      })),
    }),
  )}`;
}

function assertClosedBackupManifest(
  value: unknown,
  directory: string,
  projectDir: string,
  code: string,
  requireFinalStateHash = false,
): BackupManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeManagerError(code, 'Runtime backup manifest is not one closed object.');
  }
  const manifest = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(manifest).sort()) !==
      JSON.stringify(['createdAt', 'files', 'projectDir', 'schemaVersion']) ||
    manifest.schemaVersion !== '1.0.0' ||
    typeof manifest.projectDir !== 'string' ||
    canonicalProjectPath(manifest.projectDir) !== canonicalProjectPath(projectDir) ||
    typeof manifest.createdAt !== 'string' ||
    manifest.createdAt.length > 64 ||
    Number.isNaN(Date.parse(manifest.createdAt)) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 10_000
  ) {
    throw new RuntimeManagerError(code, 'Runtime backup manifest identity is invalid.');
  }
  const seenTargets = new Set<string>();
  const files = manifest.files.map((candidate, index): BackupEntry => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new RuntimeManagerError(code, 'Runtime backup manifest contains a non-object entry.');
    }
    const entry = candidate as Record<string, unknown>;
    const keys = Object.keys(entry).sort();
    if (
      keys.some(
        (key) => !['afterHash', 'backup', 'beforeHash', 'existed', 'target'].includes(key),
      ) ||
      !keys.includes('existed') ||
      !keys.includes('target') ||
      typeof entry.target !== 'string' ||
      path.resolve(entry.target) !== entry.target ||
      typeof entry.existed !== 'boolean' ||
      (entry.afterHash !== undefined &&
        (typeof entry.afterHash !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.afterHash)))
    ) {
      throw new RuntimeManagerError(code, 'Runtime backup manifest entry is invalid.');
    }
    assertMutableOwnedTarget(entry.target, projectDir, code);
    if (seenTargets.has(entry.target)) {
      throw new RuntimeManagerError(code, `Runtime backup repeats target ${entry.target}.`);
    }
    seenTargets.add(entry.target);
    if (entry.existed) {
      const expected = backupEntryPath(directory, index, entry.target);
      if (
        typeof entry.backup !== 'string' ||
        path.resolve(entry.backup) !== expected ||
        typeof entry.beforeHash !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(entry.beforeHash)
      ) {
        throw new RuntimeManagerError(
          code,
          `Runtime backup source for ${entry.target} is not exactly bound to its manifest slot.`,
        );
      }
      assertApprovedTargetCustody(
        entry.backup,
        path.join(directory, 'files'),
        directory,
        code,
        'Runtime backup file',
      );
    } else if (entry.backup !== undefined || entry.beforeHash !== undefined) {
      throw new RuntimeManagerError(
        code,
        `Runtime backup records bytes for absent target ${entry.target}.`,
      );
    }
    return {
      target: entry.target,
      existed: entry.existed,
      ...(typeof entry.backup === 'string' ? { backup: entry.backup } : {}),
      ...(typeof entry.beforeHash === 'string' ? { beforeHash: entry.beforeHash } : {}),
      ...(typeof entry.afterHash === 'string' ? { afterHash: entry.afterHash } : {}),
    };
  });
  const stateEntries = files.filter(
    (entry) => path.resolve(entry.target) === path.resolve(statePath()),
  );
  if (files.length === 0 || stateEntries.length !== 1) {
    throw new RuntimeManagerError(
      code,
      'Runtime backup manifest must bind exactly one global ownership-state target.',
    );
  }
  const [stateEntry] = stateEntries;
  if (
    (requireFinalStateHash && !stateEntry.afterHash) ||
    (!stateEntry.existed && files.every((entry) => entry === stateEntry))
  ) {
    throw new RuntimeManagerError(
      code,
      'Runtime backup manifest does not bind one complete setup transition.',
    );
  }
  return {
    schemaVersion: '1.0.0',
    projectDir: manifest.projectDir,
    createdAt: manifest.createdAt,
    files,
  };
}

function assertClosedBackupTree(
  directory: string,
  manifest: BackupManifest,
  projectDir: string,
  code: string,
): void {
  assertBackupDirectoryCustody(directory, projectDir, code, true);
  const expectedFiles = new Set(
    [
      path.join(directory, 'migration-manifest.json'),
      ...manifest.files.flatMap((entry) => (entry.backup ? [entry.backup] : [])),
    ].map((entry) => path.resolve(entry)),
  );
  const actualFiles = new Set<string>();
  const walk = (current: string): void => {
    assertApprovedTargetCustody(current, directory, userHome(), code, 'Runtime backup tree');
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const metadata = lstatSync(absolute);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
        throw new RuntimeManagerError(
          code,
          `Runtime backup tree contains an unsupported entry at ${absolute}.`,
        );
      }
      if (metadata.isDirectory()) walk(absolute);
      else actualFiles.add(path.resolve(absolute));
    }
  };
  walk(directory);
  if (
    actualFiles.size !== expectedFiles.size ||
    [...actualFiles].some((entry) => !expectedFiles.has(entry))
  ) {
    throw new RuntimeManagerError(
      code,
      'Runtime backup tree does not exactly match its closed manifest.',
    );
  }
}

async function readCustodiedRegularFile(
  target: string,
  custody: () => void,
  code: string,
  label: string,
  maxBytes = 64 * 1024 * 1024,
): Promise<Buffer> {
  custody();
  let handle: FileHandle;
  try {
    handle = await open(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    throw new RuntimeManagerError(
      code,
      `${label} ${target} cannot be opened as a real file: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maxBytes) {
      throw new RuntimeManagerError(code, `${label} ${target} is not one bounded regular file.`);
    }
    const bytes = await handle.readFile();
    custody();
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readBackupEntryBytes(
  directory: string,
  entry: BackupEntry,
  _projectDir: string,
  code: string,
): Promise<Buffer> {
  if (!entry.backup || !entry.beforeHash) {
    throw new RuntimeManagerError(code, `Runtime backup for ${entry.target} has no byte custody.`);
  }
  const bytes = await readCustodiedRegularFile(
    entry.backup,
    () =>
      assertApprovedTargetCustody(
        entry.backup as string,
        path.join(directory, 'files'),
        directory,
        code,
        'Runtime backup file',
      ),
    code,
    'Runtime backup file',
  );
  if (hash(bytes) !== entry.beforeHash) {
    throw new RuntimeManagerError(
      code,
      `Runtime backup bytes for ${entry.target} do not match their recorded hash.`,
    );
  }
  return bytes;
}

function assertUserOwnedTarget(
  file: Pick<OwnedFile, 'runtime' | 'target'>,
  runtime: RuntimeId | 'core',
  code = 'E_RUNTIME_STATE_INVALID',
): void {
  if (pathIsWithin(file.target, runtimeRoot())) {
    assertApprovedTargetCustody(
      file.target,
      runtimeRoot(),
      userHome(),
      code,
      'Global runtime ownership',
    );
    return;
  }
  if (runtime === 'codex' && pathIsWithin(file.target, codexSkillsRoot())) {
    assertApprovedTargetCustody(
      file.target,
      codexSkillsRoot(),
      userHome(),
      code,
      'Global Codex bundle ownership',
    );
    return;
  }
  throw new RuntimeManagerError(
    code,
    `Global ${runtime} ownership target ${path.resolve(file.target)} is outside every approved bundle root.`,
    'Restore valid global ownership state before setup, rollback, retirement, or removal.',
  );
}

function assertActionCustody(actions: readonly FileAction[], projectDir: string): void {
  for (const action of actions) {
    if (action.scope === 'user') {
      assertUserOwnedTarget(action, action.runtime, 'E_MIGRATION_CONFLICT');
    } else {
      assertApprovedTargetCustody(
        action.target,
        projectDir,
        projectDir,
        'E_MIGRATION_CONFLICT',
        'Project runtime ownership',
      );
    }
  }
}

function assertRuntimeStateCustody(state: RuntimeState): void {
  for (const runtime of ['claude-code', 'codex', 'cursor'] as const) {
    for (const file of state.userBundles?.[runtime]?.ownedFiles ?? []) {
      assertUserOwnedTarget(file, runtime);
    }
  }
  for (const project of Object.values(state.projects)) {
    for (const file of project.ownedFiles) {
      const runtime = file.runtime;
      if (file.scope === 'user' || (runtime !== 'core' && isUserOwnedFile(file, runtime))) {
        assertUserOwnedTarget(file, runtime);
      } else {
        assertApprovedTargetCustody(
          file.target,
          project.projectDir,
          project.projectDir,
          'E_RUNTIME_STATE_INVALID',
          'Project runtime ownership',
        );
      }
    }
  }
}

function assertRuntimeStateValue(
  value: unknown,
  code = 'E_RUNTIME_STATE_INVALID',
  allowLegacyProjectKeys = false,
): RuntimeState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeManagerError(code, 'Runtime ownership state is not one closed object.');
  }
  const state = value as Record<string, unknown>;
  if (
    Object.keys(state).some((key) => !['projects', 'schemaVersion', 'userBundles'].includes(key)) ||
    !['1.0.0', '2.0.0'].includes(String(state.schemaVersion)) ||
    state.projects === null ||
    typeof state.projects !== 'object' ||
    Array.isArray(state.projects) ||
    (state.userBundles !== undefined &&
      (state.userBundles === null ||
        typeof state.userBundles !== 'object' ||
        Array.isArray(state.userBundles)))
  ) {
    throw new RuntimeManagerError(code, 'Runtime ownership state identity is invalid.');
  }
  const legacyProjectKeysAllowed = allowLegacyProjectKeys && state.schemaVersion === '1.0.0';
  const runtimeIds = new Set<RuntimeId>(['claude-code', 'codex', 'cursor']);
  const assertOwnedFile = (candidate: unknown): candidate is OwnedFile => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate))
      return false;
    const file = candidate as Record<string, unknown>;
    return (
      Object.keys(file).every((key) =>
        ['hash', 'kind', 'marker', 'runtime', 'scope', 'target'].includes(key),
      ) &&
      ['claude-code', 'codex', 'core', 'cursor'].includes(String(file.runtime)) &&
      ['file', 'managed-block'].includes(String(file.kind)) &&
      (file.scope === undefined || ['user', 'project'].includes(String(file.scope))) &&
      (file.marker === undefined || typeof file.marker === 'string') &&
      typeof file.target === 'string' &&
      path.resolve(file.target) === file.target &&
      typeof file.hash === 'string' &&
      /^[a-f0-9]{64}$/u.test(file.hash)
    );
  };
  const canonicalProjects = new Set<string>();
  for (const [key, project] of Object.entries(state.projects as Record<string, unknown>)) {
    if (project === null || typeof project !== 'object' || Array.isArray(project)) {
      throw new RuntimeManagerError(code, 'Runtime project ownership record is invalid.');
    }
    const record = project as Record<string, unknown>;
    const canonicalProject =
      typeof record.projectDir === 'string' ? canonicalProjectPath(record.projectDir) : '';
    if (
      Object.keys(record).some(
        (key) =>
          ![
            'activeRuntime',
            'backupDir',
            'backupManifestHash',
            'commandPrefix',
            'ownedFiles',
            'projectDir',
            'runtimeScopes',
            'runtimes',
            'skillModes',
            'updatedAt',
          ].includes(key),
      ) ||
      typeof record.projectDir !== 'string' ||
      path.resolve(record.projectDir) !== record.projectDir ||
      (!legacyProjectKeysAllowed && key !== projectKey(canonicalProject)) ||
      canonicalProjects.has(canonicalProject) ||
      typeof record.updatedAt !== 'string' ||
      !Array.isArray(record.runtimes) ||
      record.runtimes.some((runtime) => !runtimeIds.has(runtime as RuntimeId)) ||
      !Array.isArray(record.ownedFiles) ||
      record.ownedFiles.some((file) => !assertOwnedFile(file)) ||
      (record.backupDir !== undefined && typeof record.backupDir !== 'string') ||
      (record.backupManifestHash !== undefined &&
        (typeof record.backupManifestHash !== 'string' ||
          !/^sha256:[a-f0-9]{64}$/u.test(record.backupManifestHash))) ||
      (record.commandPrefix !== undefined &&
        !['bare', 'namespaced'].includes(String(record.commandPrefix))) ||
      (record.skillModes !== undefined &&
        (record.skillModes === null ||
          typeof record.skillModes !== 'object' ||
          Array.isArray(record.skillModes) ||
          Object.entries(record.skillModes as Record<string, unknown>).some(
            ([runtime, mode]) =>
              !runtimeIds.has(runtime as RuntimeId) ||
              !['direct', 'unified-plugin', 'project-rule'].includes(String(mode)),
          ))) ||
      (record.activeRuntime !== undefined && !runtimeIds.has(record.activeRuntime as RuntimeId))
    ) {
      throw new RuntimeManagerError(code, 'Runtime project ownership record is invalid.');
    }
    canonicalProjects.add(canonicalProject);
  }
  const bundles = (state.userBundles ?? {}) as Record<string, unknown>;
  if (Object.keys(bundles).some((runtime) => !runtimeIds.has(runtime as RuntimeId))) {
    throw new RuntimeManagerError(code, 'Runtime global ownership bundle identity is invalid.');
  }
  for (const [runtime, candidate] of Object.entries(bundles)) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new RuntimeManagerError(code, 'Runtime global ownership bundle is invalid.');
    }
    const bundle = candidate as Record<string, unknown>;
    if (
      Object.keys(bundle).some(
        (key) =>
          ![
            'commandPrefix',
            'installMode',
            'ownedFiles',
            'pipelineVersion',
            'runtime',
            'scope',
            'updatedAt',
          ].includes(key),
      ) ||
      bundle.runtime !== runtime ||
      bundle.scope !== 'user' ||
      typeof bundle.updatedAt !== 'string' ||
      typeof bundle.pipelineVersion !== 'string' ||
      !['bare', 'namespaced'].includes(String(bundle.commandPrefix)) ||
      (bundle.installMode !== undefined &&
        !['direct', 'unified-plugin', 'project-rule'].includes(String(bundle.installMode))) ||
      !Array.isArray(bundle.ownedFiles) ||
      bundle.ownedFiles.some((file) => !assertOwnedFile(file))
    ) {
      throw new RuntimeManagerError(code, 'Runtime global ownership bundle is invalid.');
    }
  }
  const decoded = value as RuntimeState;
  assertRuntimeStateCustody(decoded);
  return decoded;
}

function isUserOwnedFile(file: OwnedFile, runtime: RuntimeId): boolean {
  if (file.scope) return file.scope === 'user';
  if (pathIsWithin(file.target, runtimeRoot())) return true;
  return runtime === 'codex' && pathIsWithin(file.target, codexSkillsRoot());
}

function projectUsesUserRuntime(
  project: RuntimeState['projects'][string],
  runtime: RuntimeId,
): boolean {
  if (!project.runtimes.includes(runtime)) return false;
  const recorded = project.runtimeScopes?.[runtime];
  if (recorded) return recorded === 'user' || recorded === 'both';
  return project.ownedFiles.some(
    (file) => file.runtime === runtime && isUserOwnedFile(file, runtime),
  );
}

function assertRequestedProjectBinding(
  projectDir: string,
  key: string,
  project: RuntimeState['projects'][string],
): void {
  const canonical = canonicalProjectPath(projectDir);
  if (key !== projectKey(canonical) || canonicalProjectPath(project.projectDir) !== canonical) {
    throw new RuntimeManagerError(
      'E_RUNTIME_STATE_INVALID',
      'Runtime ownership state is bound to a different canonical project.',
      'Repair the project ownership record before preview, rollback, removal, or cleanup.',
    );
  }
}

function inferLegacyCodexPrefix(
  project: RuntimeState['projects'][string],
): CommandPrefix | undefined {
  if (!projectUsesUserRuntime(project, 'codex')) return undefined;
  if (project.commandPrefix) return project.commandPrefix;
  const roots = project.ownedFiles
    .filter((file) => file.runtime === 'codex' && pathIsWithin(file.target, codexSkillsRoot()))
    .map((file) => path.relative(codexSkillsRoot(), file.target).split(path.sep)[0])
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
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    throw new RuntimeManagerError(
      'E_NODE_VERSION',
      `Node.js 20 or newer is required; found ${process.versions.node}.`,
      'Install Node.js 20+ and rerun `planr setup`. OpenPlanr will not modify Node.js for you.',
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

function readRegistry(): {
  root: string;
  version: string;
  pluginVersion: string;
  registry: AdapterRegistry;
} {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const registryPath = path.join(root, 'lib', 'host-packages', 'adapter-registry.json');
  if (!existsSync(registryPath)) {
    throw new RuntimeManagerError(
      'E_HOST_PACKAGE_MISSING',
      'The OpenPlanr host-package inventory is missing.',
      'Reinstall the OpenPlanr utility CLI or run the workspace skill generator.',
    );
  }
  const document = JSON.parse(readFileSync(registryPath, 'utf8')) as AdapterRegistry & {
    pipelineVersion: string;
    pluginVersion: string;
  };
  return {
    root,
    version: document.pipelineVersion,
    pluginVersion: document.pluginVersion,
    registry: document,
  };
}

interface BundledHostAsset {
  skillId: string;
  targetName: string;
  relativePath: string;
  content: Buffer;
}

function bundledHostRoot(host: 'openai' | 'claude' | 'cursor'): string {
  const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const root = path.join(cliRoot, 'lib', 'host-packages', host);
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) {
    throw new RuntimeManagerError(
      'E_HOST_PACKAGE_MISSING',
      `The bundled ${host} OpenPlanr package is missing or unsafe.`,
      'Reinstall the OpenPlanr utility CLI or run the workspace skill generator.',
    );
  }
  return root;
}

function bundledSkillAssets(runtime: RuntimeId): BundledHostAsset[] {
  if (runtime === 'cursor') {
    const rulesRoot = path.join(bundledHostRoot('cursor'), 'openplanr', 'rules');
    return inventoryRegularFiles(rulesRoot).map((absolutePath) => {
      const relativePath = path.relative(rulesRoot, absolutePath);
      const first = relativePath.split(path.sep)[0];
      const skillId = first.endsWith('.mdc') ? first.slice(0, -'.mdc'.length) : first;
      return {
        skillId,
        targetName: skillId,
        relativePath,
        content: readFileSync(absolutePath),
      };
    });
  }
  const host = runtime === 'claude-code' ? 'claude' : 'openai';
  const skillsRoot = path.join(bundledHostRoot(host), 'openplanr', 'skills');
  return inventoryRegularFiles(skillsRoot).map((absolutePath) => {
    const sourcePath = path.relative(skillsRoot, absolutePath);
    const [skillId, ...segments] = sourcePath.split(path.sep);
    return {
      skillId,
      targetName: skillId,
      relativePath: segments.join(path.sep),
      content: readFileSync(absolutePath),
    };
  });
}

function actionBytes(action: FileAction): Buffer {
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

function normalizeInstallScope(
  adapter: AdapterRegistryEntry,
  requested: InstallScope,
): InstallScope {
  const supportsUser = adapter.installScopes.includes('user');
  const supportsProject = adapter.installScopes.includes('project');
  if (requested === 'user' && !supportsUser) {
    throw new RuntimeManagerError(
      'E_SCOPE_UNSUPPORTED',
      `${adapter.id} does not support user-scope installation.`,
      `Run \`planr runtime install ${adapter.id} --scope project\`.`,
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

function inferRuntimeScope(files: OwnedFile[], runtime: RuntimeId): InstallScope {
  const owned = files.filter((file) => file.runtime === runtime);
  const hasUser = owned.some((file) => isUserOwnedFile(file, runtime));
  const hasProject = owned.some((file) => !isUserOwnedFile(file, runtime));
  return hasUser && hasProject ? 'both' : hasUser ? 'user' : 'project';
}

function skillInstallMode(runtime: RuntimeId, options: SetupOptions): SkillInstallMode {
  if (runtime === 'claude-code') return 'unified-plugin';
  if (runtime === 'cursor') return 'project-rule';
  return options.skillMode ?? (options.scope === 'project' ? 'project-rule' : 'direct');
}

function skillInstallModes(
  runtimes: RuntimeId[],
  options: SetupOptions,
): Partial<Record<RuntimeId, SkillInstallMode>> {
  return Object.fromEntries(
    runtimes.map((runtime) => [runtime, skillInstallMode(runtime, options)]),
  );
}

interface RuntimeLockAdapter {
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

function runtimeLockManifestDigest(input: RuntimeLockDigestInput): string {
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
  const skillModes = skillInstallModes(runtimes, options);
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
  const lockPath = path.join(options.projectDir, '.planr', 'runtime-lock.json');
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
        JSON.stringify(existing.adapters) === JSON.stringify(adapters)
      ) {
        return readFileSync(lockPath);
      }
    } catch {
      // Invalid locks are replaced after backup during setup.
    }
  }
  return Buffer.from(
    `${JSON.stringify(
      {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        manifestDigest,
        protocolVersion: registry.protocolVersion,
        components,
        adapters,
        skillModes,
      },
      null,
      2,
    )}\n`,
  );
}

function buildActions(
  options: SetupOptions,
  runtimes: RuntimeId[],
  runtimeScopes: Partial<Record<RuntimeId, InstallScope>>,
): FileAction[] {
  if (options.minimal) return [];
  const { version, registry } = readRegistry();
  if (options.version && options.version !== version) {
    throw new RuntimeManagerError(
      'E_VERSION_UNAVAILABLE',
      `Installed pipeline ${version} does not match requested ${options.version}.`,
      `Install planr-pipeline@${options.version} and rerun setup.`,
    );
  }
  const actions: FileAction[] = [];

  for (const runtime of runtimes) {
    const adapter = registry.adapters.find((entry) => entry.id === runtime);
    if (!adapter)
      throw new RuntimeManagerError('E_ADAPTER_MISSING', `Adapter ${runtime} is absent.`);
    const scope = normalizeInstallScope(adapter, runtimeScopes[runtime] ?? options.scope ?? 'user');
    const installUser =
      (scope === 'user' || scope === 'both') && adapter.installScopes.includes('user');
    const installProject =
      (scope === 'project' || scope === 'both') && adapter.installScopes.includes('project');
    let skillAssets: BundledHostAsset[];
    try {
      skillAssets = bundledSkillAssets(runtime);
    } catch (cause) {
      throw new RuntimeManagerError(
        'E_SKILL_DISTRIBUTION_INVALID',
        `The generated ${runtime} skill distribution is invalid: ${cause instanceof Error ? cause.message : String(cause)}`,
        'Reinstall the OpenPlanr utility CLI or regenerate the host packages.',
      );
    }
    if (installUser) {
      if (runtime === 'codex') {
        const mode = skillInstallMode(runtime, options);
        if (mode === 'direct') {
          for (const asset of skillAssets) {
            actions.push({
              runtime,
              scope: 'user',
              target: path.join(
                userHome(),
                '.codex',
                'skills',
                asset.targetName,
                asset.relativePath,
              ),
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
            target: path.join(runtimeRoot(), 'install-modes', 'codex.json'),
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
        target: path.join(runtimeRoot(), 'adapters', `${runtime}.json`),
        content: runtimeMarker(runtime, version),
        kind: 'file',
        description: `Record ${runtime} adapter installation`,
      });
    }

    if (installProject) {
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
            content: readFileSync(absolutePath),
            kind: 'file',
            description: `Install project Claude role agent ${relativePath}`,
          });
        }
      }
    }
  }

  if (
    runtimes.some((runtime) => {
      const scope = runtimeScopes[runtime] ?? options.scope ?? 'user';
      return scope === 'project' || scope === 'both';
    })
  ) {
    actions.push({
      runtime: 'core',
      scope: 'project',
      target: path.join(options.projectDir, '.planr', 'runtime-lock.json'),
      content: buildRuntimeLock(options, runtimes, runtimeScopes, registry, version),
      kind: 'file',
      description: 'Write exact runtime compatibility lock',
    });
  }
  return actions;
}

function operationFor(action: FileAction): 'create' | 'update' | 'unchanged' {
  if (!existsSync(action.target)) return 'create';
  return hash(readFileSync(action.target)) === hash(actionBytes(action)) ? 'unchanged' : 'update';
}

function isRetiredGeneratedCursorRule(target: string, content: Buffer): boolean {
  const source = content.toString('utf8');
  const parent = path.basename(path.dirname(target));
  if (parent === 'agents') {
    const [header, provenance] = source.split(/\r?\n/u);
    return (
      header ===
        '> **Cursor adapter — synthesized from planr-pipeline.** Agent role system prompt (body-only). Used by `/cursor/rules/planr-pipeline.mdc` for Composer subagent dispatch.' &&
      provenance.startsWith('> Source: `planr-pipeline/agents/')
    );
  }
  const generatedFooter = source.trimEnd().split(/\r?\n/u).at(-1) ?? '';
  const deprecatedAlias =
    '---\ndescription: Deprecated OpenPlanr pipeline alias\nalwaysApply: false\n---\n\nThis compatibility alias is deprecated. Use the portable `openplanr.mdc` rule.\n';
  return (
    (generatedFooter.startsWith(
      '*Generated by `planr rules generate --target cursor --scope pipeline`.',
    ) &&
      generatedFooter.endsWith('*')) ||
    source === deprecatedAlias
  );
}

function planRetiredCursorProjectRules(
  projectDir: string,
  runtimes: RuntimeId[],
  runtimeScopes: Partial<Record<RuntimeId, InstallScope>>,
): FileAction[] {
  if (
    !runtimes.includes('cursor') ||
    !['project', 'both'].includes(runtimeScopes.cursor ?? 'project')
  ) {
    return [];
  }
  const rulesRoot = path.join(projectDir, '.cursor', 'rules');
  const candidates = [
    ...RETIRED_CURSOR_WORKFLOW_RULES.map((name) => path.join(rulesRoot, name)),
    ...RETIRED_CURSOR_AGENT_RULES.map((name) => path.join(rulesRoot, 'agents', name)),
  ];
  return candidates.flatMap((target) => {
    if (!existsSync(target)) return [];
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new RuntimeManagerError(
        'E_MIGRATION_CONFLICT',
        `Retired Cursor workflow path is not one regular generated file: ${target}.`,
        'Move the foreign path aside and rerun setup.',
      );
    }
    const content = readFileSync(target);
    if (!isRetiredGeneratedCursorRule(target, content)) return [];
    return [
      {
        runtime: 'cursor' as const,
        scope: 'project' as const,
        target,
        content,
        kind: 'file' as const,
        description: 'Retire an unreachable generated Cursor workflow copy',
      },
    ];
  });
}

function inventoryRegularFiles(root: string): string[] {
  return inventoryManagedSkillFiles(root, (message, recovery) => {
    throw new RuntimeManagerError('E_MIGRATION_CONFLICT', message, recovery);
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

/**
 * Applies the Codex bundle's adopt-only-if-identical ownership rule to the four
 * project-scoped Cursor professional assets. Unknown bytes are user-owned, while
 * recorded assets may advance only when their current bytes still match state.
 */
function assertCursorProfessionalSkillTransition(
  state: RuntimeState,
  projectDir: string,
  actions: readonly FileAction[],
): void {
  const desired = actions.filter(
    (action) =>
      action.runtime === 'cursor' &&
      action.scope === 'project' &&
      action.custody === 'professional-skill',
  );
  if (desired.length === 0) return;
  const tracked = new Map(
    (state.projects[projectKey(projectDir)]?.ownedFiles ?? [])
      .filter((file) => file.runtime === 'cursor')
      .map((file) => [path.resolve(file.target), file]),
  );
  for (const action of desired) {
    assertMutableOwnedTarget(action.target, projectDir, 'E_MIGRATION_CONFLICT');
    if (!existsSync(action.target)) continue;
    const metadata = lstatSync(action.target);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new RuntimeManagerError(
        'E_MIGRATION_CONFLICT',
        `Refusing to replace non-file Cursor professional skill target ${action.target}.`,
        'Preserve or move the existing entry outside the managed Cursor rules directory before rerunning setup.',
      );
    }
    const currentHash = ownershipHash(readFileSync(action.target), action.kind, action.marker);
    const owned = tracked.get(path.resolve(action.target));
    if (owned) {
      if (currentHash !== owned.hash) {
        throw new RuntimeManagerError(
          'E_MIGRATION_CONFLICT',
          `Refusing to replace modified managed Cursor professional skill ${action.target}.`,
          'Preserve the modified file or restore the last managed bytes before rerunning setup.',
        );
      }
      continue;
    }
    const expectedHash = ownershipHash(actionBytes(action), action.kind, action.marker);
    if (currentHash !== expectedHash) {
      throw new RuntimeManagerError(
        'E_MIGRATION_CONFLICT',
        `Refusing to overwrite unknown Cursor professional skill bytes at ${action.target}.`,
        'Move the user-owned file aside or explicitly reconcile it before rerunning setup.',
      );
    }
  }
}

async function loadState(): Promise<RuntimeState> {
  assertApprovedTargetCustody(
    statePath(),
    runtimeRoot(),
    userHome(),
    'E_RUNTIME_STATE_INVALID',
    'Runtime ownership state',
  );
  try {
    const state = assertRuntimeStateValue(
      JSON.parse(await readFile(statePath(), 'utf8')) as unknown,
      'E_RUNTIME_STATE_INVALID',
      true,
    );
    migrateLegacyGlobalRuntimeState(state, {
      inferRuntimeScope,
      inferLegacyCodexPrefix,
      isUserOwnedFile,
      projectKey,
      conflict: (code, message, recovery) => {
        throw new RuntimeManagerError(code, message, recovery);
      },
    });
    return assertRuntimeStateValue(state);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schemaVersion: '2.0.0', projects: {}, userBundles: {} };
    }
    if (error instanceof RuntimeManagerError) throw error;
    throw new RuntimeManagerError(
      'E_RUNTIME_STATE_INVALID',
      `Runtime ownership state is invalid: ${error instanceof Error ? error.message : String(error)}`,
      'Restore the recorded state backup before running setup again.',
    );
  }
}

async function resolveCommandPrefix(options: SetupOptions): Promise<CommandPrefix> {
  return skillInstallMode('codex', options) === 'direct' ? 'bare' : 'namespaced';
}

async function atomicWrite(target: string, content: Buffer): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, target);
}

async function createBackup(
  projectDir: string,
  actions: FileAction[],
): Promise<{ dir: string; manifest: BackupManifest }> {
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const dir = assertBackupDirectoryCustody(
    path.join(projectBackupsRoot(projectDir), stamp),
    projectDir,
    'E_BACKUP_FAILED',
  );
  const manifest: BackupManifest = {
    schemaVersion: '1.0.0',
    projectDir: path.resolve(projectDir),
    createdAt: new Date().toISOString(),
    files: [],
  };
  await mkdir(dir, { recursive: true, mode: 0o700 });
  assertBackupDirectoryCustody(dir, projectDir, 'E_BACKUP_FAILED', true);
  for (const [index, action] of actions.entries()) {
    assertMutableOwnedTarget(action.target, projectDir, 'E_MIGRATION_CONFLICT');
    const entry: BackupEntry = { target: action.target, existed: existsSync(action.target) };
    if (entry.existed) {
      const backup = backupEntryPath(dir, index, action.target);
      const bytes = await readCustodiedRegularFile(
        action.target,
        () => assertMutableOwnedTarget(action.target, projectDir, 'E_MIGRATION_CONFLICT'),
        'E_BACKUP_FAILED',
        'Managed setup source',
      );
      assertApprovedTargetCustody(
        backup,
        path.join(dir, 'files'),
        dir,
        'E_BACKUP_FAILED',
        'Runtime backup file',
      );
      await mkdir(path.dirname(backup), { recursive: true, mode: 0o700 });
      assertApprovedTargetCustody(
        path.dirname(backup),
        path.join(dir, 'files'),
        dir,
        'E_BACKUP_FAILED',
        'Runtime backup files directory',
      );
      await atomicWrite(backup, bytes);
      assertApprovedTargetCustody(
        backup,
        path.join(dir, 'files'),
        dir,
        'E_BACKUP_FAILED',
        'Runtime backup file',
      );
      entry.backup = backup;
      entry.beforeHash = hash(bytes);
    }
    manifest.files.push(entry);
  }
  const manifestPath = path.join(dir, 'migration-manifest.json');
  assertApprovedTargetCustody(
    manifestPath,
    dir,
    userHome(),
    'E_BACKUP_FAILED',
    'Runtime backup manifest',
  );
  await atomicWrite(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  assertClosedBackupTree(
    dir,
    assertClosedBackupManifest(manifest, dir, projectDir, 'E_BACKUP_FAILED'),
    projectDir,
    'E_BACKUP_FAILED',
  );
  return { dir, manifest };
}

async function restoreBackup(backup: { dir: string; manifest: BackupManifest }): Promise<string[]> {
  const directory = assertBackupDirectoryCustody(
    backup.dir,
    backup.manifest.projectDir,
    'E_RUNTIME_STATE_INVALID',
    true,
  );
  const manifest = assertClosedBackupManifest(
    backup.manifest,
    directory,
    backup.manifest.projectDir,
    'E_RUNTIME_STATE_INVALID',
  );
  assertClosedBackupTree(
    directory,
    manifest,
    backup.manifest.projectDir,
    'E_RUNTIME_STATE_INVALID',
  );
  const restoreBytes = new Map<string, Buffer>();
  for (const entry of manifest.files) {
    assertMutableOwnedTarget(entry.target, manifest.projectDir, 'E_RUNTIME_STATE_INVALID');
    if (entry.existed) {
      restoreBytes.set(
        entry.target,
        await readBackupEntryBytes(
          directory,
          entry,
          manifest.projectDir,
          'E_RUNTIME_STATE_INVALID',
        ),
      );
    }
  }
  const restored: string[] = [];
  for (const entry of [...manifest.files].reverse()) {
    if (entry.existed && entry.backup) {
      const bytes = restoreBytes.get(entry.target);
      if (!bytes)
        throw new RuntimeManagerError(
          'E_RUNTIME_STATE_INVALID',
          'Backup preflight lost validated bytes.',
        );
      await mkdir(path.dirname(entry.target), { recursive: true });
      assertMutableOwnedTarget(entry.target, manifest.projectDir, 'E_RUNTIME_STATE_INVALID');
      await atomicWrite(entry.target, bytes);
    } else if (existsSync(entry.target)) {
      await unlink(entry.target);
    }
    restored.push(entry.target);
  }
  return restored;
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
  if ((scope === 'project' || scope === 'both') && !projectContext.valid) {
    throw new RuntimeManagerError(
      'E_PROJECT_CONTEXT_REQUIRED',
      `Project-scoped setup requires a Git worktree or initialized OpenPlanr project; ${projectContext.path} is neither.`,
      'Change into a project, run `planr init`, or use `planr setup --scope user`.',
    );
  }
  let selectedRuntimes = options.minimal
    ? []
    : options.runtimes
      ? [...new Set(options.runtimes)]
      : chooseRuntimes(options.runtime ?? 'auto');
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
        'Change into a Git or initialized OpenPlanr project and run `planr setup --scope project`.',
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
    runtimes = [...new Set([...existing, ...runtimes])];
  }
  if (!options.preserveExistingScopes) {
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
      if (mode !== 'project-rule' && !['user', 'both'].includes(codexScope)) {
        throw new RuntimeManagerError(
          'E_SKILL_MODE_SCOPE',
          `Codex ${mode} mode requires user or both scope.`,
          'Use --scope user or --scope both.',
        );
      }
    }
  }
  const commandPrefix = await resolveCommandPrefix(options);
  const actions = buildActions(options, runtimes, runtimeScopes);
  assertActionCustody(actions, options.projectDir);
  const retiredProjectRules = planRetiredCursorProjectRules(
    options.projectDir,
    runtimes,
    runtimeScopes,
  );
  const needsTransitionState =
    runtimes.includes('codex') ||
    actions.some(
      (action) =>
        (action.runtime === 'codex' && action.scope === 'user') ||
        action.custody === 'professional-skill',
    );
  const transitionState = needsTransitionState ? await loadState() : undefined;
  if (transitionState) {
    assertCursorProfessionalSkillTransition(transitionState, options.projectDir, actions);
  }
  const userBundleTransition = runtimes.includes('codex')
    ? planUserBundleTransition(transitionState as RuntimeState, actions)
    : { retired: [] };
  const manageClaudePlugins =
    options.manageExternalRuntimes !== false &&
    !options.minimal &&
    runtimes.includes('claude-code') &&
    ['user', 'both'].includes(runtimeScopes['claude-code'] ?? scope) &&
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
        fix: 'Update Claude Code, then rerun `planr setup --runtime claude --scope user`.',
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
  }
  const codexMode = runtimes.includes('codex') ? skillInstallMode('codex', options) : undefined;
  const previousCodexMode =
    transitionState?.userBundles?.codex?.installMode ??
    (transitionState?.userBundles?.codex ? 'direct' : undefined) ??
    transitionState?.projects[projectKey(options.projectDir)]?.skillModes?.codex;
  const manageCodexPlugin = Boolean(
    codexMode &&
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
        fix: 'Repair the Codex marketplace state, then rerun planr setup --dry-run.',
      });
    } else if (codexInspection.duplicates.length > 0) {
      runtimeDiagnostics.push({
        runtime: 'codex',
        status: 'warn',
        message: `Duplicate OpenPlanr Codex plugin discovery detected: ${codexInspection.duplicates.join(', ')}`,
        fix: 'Remove or disable the unrelated duplicate after confirming which installation should remain active.',
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
        message: `Codex will switch to ${codexMode} discovery after confirmation`,
      });
    }
  }
  if (userBundleTransition.retired.length > 0 && previousCodexMode !== codexMode) {
    runtimeDiagnostics.push({
      runtime: 'codex',
      status: 'warn',
      message: `${userBundleTransition.retired.length} manifest-owned direct Codex asset(s) will be retired`,
      fix: 'Rerun with --replace-managed after reviewing this dry-run.',
    });
  }
  return {
    ok: true,
    dryRun: Boolean(options.dryRun),
    minimal: Boolean(options.minimal),
    commandPrefix,
    skillModes: skillInstallModes(runtimes, options),
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
      ...retiredProjectRules.map((action) => ({
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
      ...(claudeInspection?.operations ?? []),
      ...(codexInspection?.operations ?? []),
    ],
    runtimeDiagnostics,
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
  assertApprovedTargetCustody(
    runtimeRoot(),
    runtimeRoot(),
    userHome(),
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
    const actions = buildActions(options, preview.runtimes, preview.runtimeScopes);
    assertActionCustody(actions, options.projectDir);
    const retiredProjectRules = planRetiredCursorProjectRules(
      options.projectDir,
      preview.runtimes,
      preview.runtimeScopes,
    );
    const state = await loadState();
    const previousCodexMode =
      state.userBundles?.codex?.installMode ??
      (state.userBundles?.codex ? 'direct' : undefined) ??
      state.projects[projectKey(options.projectDir)]?.skillModes?.codex;
    assertCursorProfessionalSkillTransition(state, options.projectDir, actions);
    const transition = preview.runtimes.includes('codex')
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
        'Review planr setup --dry-run, then rerun with --replace-managed to replace only OpenPlanr-owned content.',
      );
    }
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

    try {
      const owned: OwnedFile[] = [];
      for (const action of actions) {
        const content = actionBytes(action);
        if (operationFor(action) !== 'unchanged') await atomicWrite(action.target, content);
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
        if (existsSync(retired.target)) await unlink(retired.target);
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
            `Retired Cursor workflow bytes changed during setup: ${retired.target}.`,
            'The setup transaction restored the pre-setup bytes; inspect the file and rerun.',
          );
        }
        await unlink(retired.target);
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
        runtimes: preview.runtimes,
        runtimeScopes: preview.runtimeScopes,
        skillModes: preview.skillModes,
        ...(preview.runtimes.length === 1 ? { activeRuntime: preview.runtimes[0] } : {}),
        ownedFiles: owned.filter((file) => file.scope === 'project'),
      };
      const stateBytes = Buffer.from(`${JSON.stringify(state, null, 2)}\n`);
      await atomicWrite(statePath(), stateBytes);
      const stateBackup = backup.manifest.files.find((entry) => entry.target === statePath());
      if (stateBackup) stateBackup.afterHash = hash(stateBytes);
      const backupManifestPath = path.join(backup.dir, 'migration-manifest.json');
      assertApprovedTargetCustody(
        backupManifestPath,
        backup.dir,
        userHome(),
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
        restored = await restoreBackup(backup);
      } catch (rollbackCause) {
        throw new RuntimeManagerError(
          'E_SETUP_ROLLBACK_FAILED',
          `Setup failed and automatic restore also failed: ${rollbackCause instanceof Error ? rollbackCause.message : String(rollbackCause)}`,
          `Restore the exact previous files from ${backup.dir}.`,
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
        userHome(),
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
      previousState = assertRuntimeStateValue(
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
    if (entry.existed && entry.backup) {
      const bytes = restoreBytes.get(entry.target);
      if (!bytes)
        throw new RuntimeManagerError(
          'E_RUNTIME_STATE_INVALID',
          'Backup preflight lost validated bytes.',
        );
      await mkdir(path.dirname(entry.target), { recursive: true });
      assertMutableOwnedTarget(entry.target, projectDir, 'E_RUNTIME_STATE_INVALID');
      await atomicWrite(entry.target, bytes);
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
  await atomicWrite(statePath(), Buffer.from(`${JSON.stringify(state, null, 2)}\n`));
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
  await atomicWrite(statePath(), Buffer.from(`${JSON.stringify(state, null, 2)}\n`));
  return { ok: true, removed, retainedShared };
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

export async function managedRuntimesForProject(projectDir: string): Promise<RuntimeId[]> {
  const state = await loadState();
  const key = projectKey(projectDir);
  const project = state.projects[key];
  if (project) assertRequestedProjectBinding(projectDir, key, project);
  return [...(project?.runtimes ?? [])];
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
  await atomicWrite(statePath(), Buffer.from(`${JSON.stringify(state, null, 2)}\n`));
  return { ok: true, removed };
}

export async function runtimeDoctor(
  projectDir: string,
  options: {
    pipelineRepair?: 'preview' | 'apply';
    claudeCommandRunner?: ClaudeCommandRunner;
  } = {},
): Promise<{
  ok: boolean;
  repairs: Array<{ id: string; operation: 'remove'; target: string; applied: boolean }>;
  diagnostics: Array<{
    code: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    fix?: string;
  }>;
}> {
  const diagnostics: Array<{
    code: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    fix?: string;
  }> = [];
  const repairs: Array<{ id: string; operation: 'remove'; target: string; applied: boolean }> = [];
  let lockedAdapters:
    | Array<{
        runtime: RuntimeId;
        version: string;
        capabilityLevel: string;
        installScope: InstallScope;
      }>
    | undefined;
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  diagnostics.push({
    code: 'node-version',
    status: nodeMajor >= 20 ? 'pass' : 'fail',
    message: `Node.js ${process.versions.node}`,
    ...(nodeMajor < 20 ? { fix: 'Install Node.js 20 or newer.' } : {}),
  });
  const state = await loadState();
  const installed = state.projects[projectKey(projectDir)];
  const detectedRuntimes = detectRuntimes();
  for (const result of detectedRuntimes) {
    const configured = installed?.runtimes.includes(result.runtime) ?? false;
    diagnostics.push({
      code: `runtime-${result.runtime}`,
      status: result.installed || !configured ? 'pass' : 'warn',
      message: result.installed
        ? `${result.runtime} detected`
        : configured
          ? `${result.runtime} is configured but not detected`
          : `${result.runtime} is not installed or configured`,
      ...(!result.installed && configured
        ? { fix: `Install ${result.command} only if you intend to use this adapter.` }
        : {}),
    });
  }
  const pipeline = resolvePipelinePackage(false);
  diagnostics.push({
    code: 'pipeline-package',
    status: pipeline ? 'pass' : 'warn',
    message: pipeline
      ? `Optional deterministic pipeline utilities ${pipeline.version}`
      : 'Optional deterministic pipeline utilities are not installed',
    ...(!pipeline
      ? { fix: 'Install optional dependencies only if you need pipeline utilities.' }
      : {}),
  });
  const registry = listRuntimeAdapters();
  for (const adapter of registry) {
    const detected = detectedRuntimes.find((entry) => entry.runtime === adapter.id)?.installed;
    const configured = installed?.runtimes.includes(adapter.id) ?? false;
    if (!detected && !configured) continue;
    const mode = adapter.capabilities?.interactiveQuestions;
    diagnostics.push({
      code: `runtime-interaction-${adapter.id}`,
      status: mode ? 'pass' : 'fail',
      message: mode
        ? `${adapter.id} uses ${mode} host-native questions`
        : `${adapter.id} does not declare a host-native question capability`,
      ...(!mode ? { fix: 'Reinstall the OpenPlanr utility CLI host package.' } : {}),
    });
  }
  try {
    const counts = {
      claude: new Set(bundledSkillAssets('claude-code').map(({ skillId }) => skillId)).size,
      codex: new Set(bundledSkillAssets('codex').map(({ skillId }) => skillId)).size,
      cursor: new Set(bundledSkillAssets('cursor').map(({ skillId }) => skillId)).size,
    };
    const uniqueCounts = new Set(Object.values(counts));
    const current = uniqueCounts.size === 1 && counts.claude > 0;
    diagnostics.push({
      code: 'host-skill-packages',
      status: current ? 'pass' : 'fail',
      message: current
        ? `Claude Code, Codex, and Cursor each expose all ${counts.claude} host-native skills`
        : `Host skill package membership drifted (${JSON.stringify(counts)})`,
      ...(!current ? { fix: 'Reinstall the CLI or regenerate its host packages.' } : {}),
    });
  } catch (cause) {
    diagnostics.push({
      code: 'host-skill-packages',
      status: 'fail',
      message: cause instanceof Error ? cause.message : String(cause),
      fix: 'Reinstall the CLI or regenerate its host packages.',
    });
  }
  const claudeManagedAtUserScope = Object.values(state.projects).some(
    (project) =>
      project.runtimes.includes('claude-code') &&
      ['user', 'both'].includes(
        project.runtimeScopes?.['claude-code'] ??
          inferRuntimeScope(project.ownedFiles, 'claude-code'),
      ),
  );
  const claudeDetected =
    Boolean(options.claudeCommandRunner) ||
    (detectedRuntimes.find((runtime) => runtime.runtime === 'claude-code')?.installed ?? false);
  if (claudeDetected && claudeManagedAtUserScope) {
    const inspection = inspectBundledClaudePluginIntegration(
      bundledHostRoot('claude'),
      options.claudeCommandRunner,
    );
    if (inspection.error) {
      diagnostics.push({
        code: 'runtime-claude-plugins',
        status: 'fail',
        message: `Claude plugin state could not be inspected: ${inspection.error}`,
        fix: 'Update Claude Code, then run `planr runtime update claude --scope user`.',
      });
    } else {
      const drift = inspection.plugins.filter(
        (plugin) =>
          !plugin.installed ||
          !plugin.enabled ||
          !plugin.identityValid ||
          plugin.installedVersion !== plugin.expectedVersion,
      );
      diagnostics.push({
        code: 'runtime-claude-plugins',
        status: inspection.ready ? 'pass' : 'fail',
        message: inspection.ready
          ? `Claude plugins match compatibility versions (${inspection.plugins
              .map((plugin) => `${plugin.name} ${plugin.expectedVersion}`)
              .join(', ')})`
          : `Claude plugin drift detected: ${drift
              .map(
                (plugin) =>
                  `${plugin.id} ${plugin.installedVersion ?? 'missing'} → ${plugin.expectedVersion}${
                    !plugin.identityValid ? ' (invalid identity)' : ''
                  }`,
              )
              .join(', ')}`,
        ...(!inspection.ready
          ? { fix: 'Run `planr runtime update claude --scope user` and restart Claude Code.' }
          : {}),
      });
      if (inspection.legacyPluginIds.length > 0) {
        diagnostics.push({
          code: 'runtime-claude-legacy-plugin',
          status: 'warn',
          message: `Legacy Claude plugin installation detected: ${inspection.legacyPluginIds.join(', ')}`,
          fix: 'Verify `planr@openplanr-local`, then remove the legacy plugin from Claude Code.',
        });
      }
    }
  }
  const expectsProjectLock =
    installed?.ownedFiles.some((file) => file.scope === 'project') ?? false;
  const lock = path.join(projectDir, '.planr', 'runtime-lock.json');
  if (!existsSync(lock)) {
    const lockStatus = expectsProjectLock ? 'warn' : installed ? 'pass' : 'warn';
    diagnostics.push({
      code: 'runtime-lock',
      status: lockStatus,
      message: expectsProjectLock
        ? 'Project runtime lock missing'
        : installed
          ? 'User-scope setup does not require a project runtime lock'
          : 'No managed runtime setup found for this directory',
      ...(expectsProjectLock
        ? { fix: 'Run `planr setup --scope project`.' }
        : !installed
          ? { fix: 'Run `planr setup`.' }
          : {}),
    });
  } else {
    try {
      const value = JSON.parse(readFileSync(lock, 'utf8')) as {
        components?: { cli?: string; pipeline?: string; skills?: string };
        protocolVersion?: string;
        manifestDigest?: string;
        adapters?: RuntimeLockAdapter[];
        skillModes?: Partial<Record<RuntimeId, SkillInstallMode>>;
      };
      lockedAdapters = value.adapters;
      const cliVersion = readOpenPlanrVersion();
      const cliDrift = value.components?.cli !== cliVersion;
      const componentDrift =
        cliDrift ||
        (pipeline && value.components?.pipeline !== pipeline.version) ||
        value.components?.skills !== readRegistry().pluginVersion;
      const expectedDigest = runtimeLockManifestDigest({
        protocolVersion: value.protocolVersion,
        pipelineVersion: value.components?.pipeline,
        adapters: value.adapters,
        skillModes: value.skillModes,
      });
      const digestDrift = value.manifestDigest !== expectedDigest;
      const registry = listRuntimeAdapters();
      const adapterDrift = (value.adapters ?? []).some((locked) => {
        const current = registry.find((adapter) => adapter.id === locked.runtime);
        return (
          !current ||
          current.version !== locked.version ||
          current.capabilityLevel !== locked.capabilityLevel
        );
      });
      // FR11: an OpenPlanr upgrade advances the CLI version the lock recorded.
      // When the CLI component trails the installed build and nothing that
      // governs runtime dispatch (runtime adapters, manifest digest)
      // diverged, the lock is simply behind an expected upgrade — surface it as
      // an informational `warn`, not a `fail` implying the board is broken. A
      // digest/adapter drift, or a component drift that does not include the CLI
      // (for example a pinned obsolete skill bundle), remains a genuine `fail`.
      // The warn/fail derivation lives in the single `classifyComponentDrift`
      // helper so `planr upgrade status` reuses this exact distinction (SPEC-006
      // FR3) rather than re-deriving it; a digest/adapter drift is doctor's
      // flavour of an incompatible tuple.
      const { drift, genuineDrift, upgradeOnlyDrift, status } = classifyRuntimeComponentDrift({
        cliDrift,
        componentDrift: Boolean(componentDrift),
        incompatibleDrift: digestDrift || adapterDrift,
      });
      diagnostics.push({
        code: drift ? 'lock-drift' : 'runtime-lock',
        status,
        message: genuineDrift
          ? `Runtime lock drift detected (components: ${componentDrift}, digest: ${digestDrift}, adapters: ${adapterDrift})`
          : upgradeOnlyDrift
            ? `Runtime lock component versions trail an OpenPlanr upgrade (components: ${componentDrift}); this is expected after upgrading and does not affect runtime execution`
            : drift
              ? `Runtime lock drift detected (components: ${componentDrift}, digest: ${digestDrift}, adapters: ${adapterDrift})`
              : 'Project runtime lock matches installed component versions',
        ...(drift
          ? {
              fix: upgradeOnlyDrift
                ? 'Run `planr runtime update all --scope project` to refresh the lock to the upgraded component versions.'
                : 'Run `planr runtime update all --scope project`.',
            }
          : {}),
      });
    } catch {
      diagnostics.push({
        code: 'runtime-lock-invalid',
        status: 'fail',
        message: 'Project runtime lock is not valid JSON',
        fix: 'Run `planr setup --scope project` after reviewing the existing lock.',
      });
    }
  }

  if (installed) {
    if (lockedAdapters) {
      const lockedState = lockedAdapters
        .map((adapter) => `${adapter.runtime}:${adapter.installScope}`)
        .sort();
      const installedState = installed.runtimes
        .map(
          (runtime) =>
            `${runtime}:${installed.runtimeScopes?.[runtime] ?? inferRuntimeScope(installed.ownedFiles, runtime)}`,
        )
        .sort();
      const stateDrift = JSON.stringify(lockedState) !== JSON.stringify(installedState);
      diagnostics.push({
        code: stateDrift ? 'lock-state-drift' : 'lock-state',
        status: stateDrift ? 'fail' : 'pass',
        message: stateDrift
          ? 'Runtime lock adapters do not match the managed installation state'
          : 'Runtime lock adapters match the managed installation state',
        ...(stateDrift ? { fix: 'Run `planr setup --dry-run`, then approve the repair.' } : {}),
      });
    }
  } else if (lockedAdapters?.length) {
    diagnostics.push({
      code: 'runtime-state-missing',
      status: 'warn',
      message: 'The project has a runtime lock but this machine has no managed adapter state',
      fix: 'Run `planr setup` to install the locked runtime adapters on this machine.',
    });
  }

  const globallyOwned = Object.values(state.userBundles ?? {}).flatMap(
    (bundle) => bundle?.ownedFiles ?? [],
  );
  const managedFiles = [
    ...(installed?.ownedFiles ?? []),
    ...globallyOwned.filter(
      (file, index, files) =>
        files.findIndex((candidate) => candidate.target === file.target) === index,
    ),
  ];
  const managedFileDiagnostic = diagnoseManagedRuntimeFiles(managedFiles, ownershipHash);
  if (managedFileDiagnostic) diagnostics.push(managedFileDiagnostic);

  const codexBundle = state.userBundles?.codex;
  if (detectRuntimes().some((runtime) => runtime.runtime === 'codex' && runtime.installed)) {
    const configuredMode = codexBundle?.installMode ?? installed?.skillModes?.codex ?? 'direct';
    const inspection = inspectCodexPluginIntegration(
      bundledHostRoot('openai'),
      configuredMode,
      configuredMode,
    );
    const directSkillFiles =
      codexBundle?.ownedFiles.filter((file) => pathIsWithin(file.target, codexSkillsRoot()))
        .length ?? 0;
    if (inspection.error) {
      diagnostics.push({
        code: 'runtime-codex-plugin',
        status: 'warn',
        message: `Codex plugin state could not be inspected: ${inspection.error}`,
        fix: 'Run `planr setup --runtime codex --dry-run` for an exact repair preview.',
      });
    } else {
      diagnostics.push({
        code: 'runtime-codex-install-mode',
        status: inspection.ready ? 'pass' : 'warn',
        message: inspection.ready
          ? `Codex ${configuredMode} discovery is current`
          : `Codex ${configuredMode} discovery has ${inspection.operations.length} pending repair operation(s)`,
        ...(inspection.ready
          ? {}
          : {
              fix: 'Run `planr setup --runtime codex --dry-run`, then apply the reviewed repair.',
            }),
      });
      if ((directSkillFiles > 0 && inspection.installed) || inspection.duplicates.length > 0) {
        diagnostics.push({
          code: 'runtime-codex-duplicate-discovery',
          status: 'warn',
          message: `Codex has duplicate OpenPlanr discovery ownership${inspection.duplicates.length ? `: ${inspection.duplicates.join(', ')}` : ' across direct skills and the unified plugin'}`,
          fix: 'Choose direct or unified-plugin mode, preview setup, and use --replace-managed only for manifest-owned content.',
        });
      }
    }
  }
  const accidentalHomeFiles = await previewHomeProjectCleanup();
  if (accidentalHomeFiles.length > 0) {
    diagnostics.push({
      code: 'home-project-install',
      status: 'warn',
      message: `${accidentalHomeFiles.length} project-scoped managed file(s) were installed in the home directory`,
      fix: 'Run `planr doctor --fix` to preview and remove only recorded OpenPlanr-owned project content.',
    });
  }

  const provenanceDiagnostic = diagnoseRuntimeProvenance(projectDir);
  if (provenanceDiagnostic) diagnostics.push(provenanceDiagnostic);

  if (pipeline) {
    const result = spawnSync(
      process.execPath,
      [
        path.join(pipeline.root, 'scripts', 'doctor.mjs'),
        '--json',
        ...(options.pipelineRepair === 'preview' ? ['--repair-preview'] : []),
        ...(options.pipelineRepair === 'apply' ? ['--fix'] : []),
      ],
      {
        cwd: projectDir,
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, PLANR_HOME: path.join(userHome(), '.planr') },
      },
    );
    try {
      const report = JSON.parse(result.stdout) as {
        checks?: Array<{
          id: string;
          status: 'ok' | 'warn' | 'fail';
          message: string;
          fix?: string;
        }>;
        repairs?: Array<{
          id: string;
          operation: 'remove';
          target: string;
          applied: boolean;
        }>;
      };
      repairs.push(...(report.repairs ?? []));
      for (const check of report.checks ?? []) {
        if (check.status === 'ok') continue;
        diagnostics.push({
          code: `pipeline-${check.id}`,
          status: check.status,
          message: check.message,
          ...(check.fix ? { fix: check.fix } : {}),
        });
      }
    } catch {
      diagnostics.push({
        code: 'pipeline-doctor-unavailable',
        status: 'warn',
        message: 'The pipeline doctor did not return valid JSON',
        fix: 'Run `planr doctor` for direct diagnostics.',
      });
    }
  }
  const fail = diagnostics.some((item) => item.status === 'fail');
  return { ok: !fail, diagnostics, repairs };
}

export async function clearRuntimeStateForTests(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
