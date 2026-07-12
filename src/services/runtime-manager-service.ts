import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { copyFile, mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spliceManagedBlock } from '../utils/splice-managed-block.js';
import { resolvePipelinePackage } from './pipeline-package-service.js';
import { readOpenPlanrVersion } from './provenance-service.js';

export type RuntimeId = 'claude-code' | 'codex' | 'cursor';
export type RuntimeChoice = RuntimeId | 'auto' | 'all';
export type InstallScope = 'user' | 'project' | 'both';

interface AdapterRegistryEntry {
  id: RuntimeId;
  version: string;
  capabilityLevel: 'artifact' | 'workflow' | 'product';
  installScopes: Array<'user' | 'project'>;
}

interface AdapterRegistry {
  protocolVersion: string;
  adapters: AdapterRegistryEntry[];
}

interface FileAction {
  runtime: RuntimeId | 'core';
  scope: 'user' | 'project';
  target: string;
  content: Buffer;
  kind: 'file' | 'managed-block';
  marker?: string;
  description: string;
}

interface OwnedFile {
  runtime: RuntimeId | 'core';
  scope?: 'user' | 'project';
  target: string;
  kind: 'file' | 'managed-block';
  marker?: string;
  hash: string;
}

interface RuntimeState {
  schemaVersion: '1.0.0';
  projects: Record<
    string,
    {
      projectDir: string;
      updatedAt: string;
      backupDir?: string;
      runtimes: RuntimeId[];
      runtimeScopes?: Partial<Record<RuntimeId, InstallScope>>;
      activeRuntime?: RuntimeId;
      ownedFiles: OwnedFile[];
    }
  >;
}

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
  scope?: InstallScope;
  minimal?: boolean;
  version?: string;
  dryRun?: boolean;
  /** Preserve already-managed adapters when installing or updating one runtime. */
  merge?: boolean;
}

export interface SetupPreview {
  ok: true;
  dryRun: boolean;
  minimal: boolean;
  runtimes: RuntimeId[];
  runtimeScopes: Partial<Record<RuntimeId, InstallScope>>;
  scope: InstallScope;
  pipelineVersion: string | null;
  actions: Array<{
    runtime: string;
    scope: string;
    target: string;
    operation: 'create' | 'update' | 'unchanged';
    description: string;
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

const executable: Record<RuntimeId, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor',
};

const skillNames = [
  'planr-plan',
  'planr-design',
  'planr-ship',
  'planr-dashboard',
  'planr-sync',
  'planr-doctor',
];

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

function projectKey(projectDir: string): string {
  return hash(path.resolve(projectDir)).slice(0, 16);
}

function runtimeRoot(): string {
  return path.join(userHome(), '.planr', 'runtime');
}

function userHome(): string {
  return process.env.OPENPLANR_HOME ?? os.homedir();
}

function statePath(): string {
  return path.join(runtimeRoot(), 'state.json');
}

function detectCommand(command: string): boolean {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true });
  return !result.error && result.status === 0;
}

export function detectRuntimes(): Array<{
  runtime: RuntimeId;
  installed: boolean;
  command: string;
}> {
  return (Object.keys(executable) as RuntimeId[]).map((runtime) => ({
    runtime,
    installed: detectCommand(executable[runtime]),
    command: executable[runtime],
  }));
}

export function listRuntimeAdapters(): AdapterRegistryEntry[] {
  const pipeline = resolvePipelinePackage(false);
  if (!pipeline) return [];
  const registry = JSON.parse(
    readFileSync(pipeline.adapterRegistryPath, 'utf8'),
  ) as AdapterRegistry;
  return registry.adapters.map((adapter) => structuredClone(adapter));
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

function readRegistry(): { root: string; version: string; registry: AdapterRegistry } {
  const pipeline = resolvePipelinePackage();
  if (!pipeline) throw new RuntimeManagerError('E_PIPELINE_NOT_INSTALLED', 'Pipeline missing.');
  return {
    root: pipeline.root,
    version: pipeline.version,
    registry: JSON.parse(readFileSync(pipeline.adapterRegistryPath, 'utf8')) as AdapterRegistry,
  };
}

function managedContent(text: string): string {
  return text
    .replace(/^<!-- openplanr:runtime:start -->\s*/m, '')
    .replace(/\s*<!-- openplanr:runtime:end -->\s*$/m, '')
    .trim();
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
  const hasUser = owned.some(
    (file) => file.scope === 'user' || (!file.scope && file.target.startsWith(runtimeRoot())),
  );
  const hasProject = owned.some(
    (file) => file.scope === 'project' || (!file.scope && !file.target.startsWith(runtimeRoot())),
  );
  return hasUser && hasProject ? 'both' : hasUser ? 'user' : 'project';
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
      runtimeScopes[runtime] ?? options.scope ?? 'both',
    );
    return {
      runtime,
      version: adapter.version,
      capabilityLevel: adapter.capabilityLevel,
      installScope,
    };
  });
  const digestInput = JSON.stringify({
    protocol: registry.protocolVersion,
    pipelineVersion,
    adapters,
  });
  const components = { cli: options.cliVersion, pipeline: pipelineVersion, skills: '1.12.0' };
  const manifestDigest = `sha256:${hash(digestInput)}`;
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
  const { root, version, registry } = readRegistry();
  if (options.version && options.version !== version) {
    throw new RuntimeManagerError(
      'E_VERSION_UNAVAILABLE',
      `Installed pipeline ${version} does not match requested ${options.version}.`,
      `Install @openplanr/pipeline@${options.version} and rerun setup.`,
    );
  }
  const actions: FileAction[] = [];

  for (const runtime of runtimes) {
    const adapter = registry.adapters.find((entry) => entry.id === runtime);
    if (!adapter)
      throw new RuntimeManagerError('E_ADAPTER_MISSING', `Adapter ${runtime} is absent.`);
    const scope = normalizeInstallScope(adapter, runtimeScopes[runtime] ?? options.scope ?? 'both');
    const installUser =
      (scope === 'user' || scope === 'both') && adapter.installScopes.includes('user');
    const installProject =
      (scope === 'project' || scope === 'both') && adapter.installScopes.includes('project');
    if (installUser) {
      if (runtime === 'codex') {
        for (const name of skillNames) {
          actions.push({
            runtime,
            scope: 'user',
            target: path.join(userHome(), '.codex', 'skills', name, 'SKILL.md'),
            content: readFileSync(path.join(root, 'adapters', 'codex', 'skills', name, 'SKILL.md')),
            kind: 'file',
            description: `Install Codex skill ${name}`,
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
        actions.push({
          runtime,
          scope: 'project',
          target: path.join(options.projectDir, 'AGENTS.md'),
          content: Buffer.from(
            managedContent(
              readFileSync(path.join(root, 'adapters', 'codex', 'project-guidance.md'), 'utf8'),
            ),
          ),
          kind: 'managed-block',
          marker: 'pipeline',
          description: 'Update concise Codex project policy',
        });
      } else if (runtime === 'cursor') {
        actions.push({
          runtime,
          scope: 'project',
          target: path.join(options.projectDir, '.cursor', 'rules', 'openplanr.mdc'),
          content: readFileSync(path.join(root, 'adapters', 'cursor', 'rules', 'openplanr.mdc')),
          kind: 'file',
          description: 'Install portable Cursor project rule',
        });
        const roleRegistry = JSON.parse(
          readFileSync(path.join(root, 'registry', 'roles.json'), 'utf8'),
        ) as {
          roles: Array<{
            id: string;
            phase: string;
            activation: string;
            capability: string;
            writeBoundary: string;
          }>;
        };
        for (const role of roleRegistry.roles) {
          actions.push({
            runtime,
            scope: 'project',
            target: path.join(
              options.projectDir,
              '.cursor',
              'rules',
              'openplanr-roles',
              `${role.id}.md`,
            ),
            content: Buffer.from(
              `# ${role.id}\n\nCapability tier: \`${role.capability}\`\nPhase: \`${role.phase}\`\nActivation: \`${role.activation}\`\n\n- ${role.writeBoundary}\n`,
            ),
            kind: 'file',
            description: `Install Cursor role ${role.id}`,
          });
        }
      } else {
        actions.push({
          runtime,
          scope: 'project',
          target: path.join(options.projectDir, 'CLAUDE.md'),
          content: Buffer.from(
            'Use the native planr-pipeline plugin for PLAN, Design, SHIP, dashboard, sync, and doctor. Portable procedures and deterministic state are supplied by @openplanr/pipeline. PLAN and SHIP remain separate user actions.',
          ),
          kind: 'managed-block',
          marker: 'pipeline',
          description: 'Update Claude Code project policy',
        });
      }
    }
  }

  if (
    runtimes.some((runtime) => {
      const scope = runtimeScopes[runtime] ?? options.scope ?? 'both';
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

async function loadState(): Promise<RuntimeState> {
  try {
    return JSON.parse(await readFile(statePath(), 'utf8')) as RuntimeState;
  } catch {
    return { schemaVersion: '1.0.0', projects: {} };
  }
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
  const dir = path.join(userHome(), '.planr', 'backups', projectKey(projectDir), stamp);
  const manifest: BackupManifest = {
    schemaVersion: '1.0.0',
    projectDir: path.resolve(projectDir),
    createdAt: new Date().toISOString(),
    files: [],
  };
  await mkdir(dir, { recursive: true });
  for (const [index, action] of actions.entries()) {
    const entry: BackupEntry = { target: action.target, existed: existsSync(action.target) };
    if (entry.existed) {
      const backup = path.join(
        dir,
        'files',
        `${String(index).padStart(3, '0')}-${path.basename(action.target)}`,
      );
      await mkdir(path.dirname(backup), { recursive: true });
      await copyFile(action.target, backup);
      entry.backup = backup;
      entry.beforeHash = hash(await readFile(action.target));
    }
    manifest.files.push(entry);
  }
  await atomicWrite(
    path.join(dir, 'migration-manifest.json'),
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
  );
  return { dir, manifest };
}

export async function previewSetup(options: SetupOptions): Promise<SetupPreview> {
  assertNodeVersion();
  if (!['user', 'project', 'both'].includes(options.scope ?? 'both')) {
    throw new RuntimeManagerError(
      'E_SCOPE_INVALID',
      `Install scope "${options.scope}" is invalid.`,
      'Choose user, project, or both.',
    );
  }
  const selectedRuntimes = options.minimal ? [] : chooseRuntimes(options.runtime ?? 'auto');
  let runtimes = selectedRuntimes;
  const runtimeScopes: Partial<Record<RuntimeId, InstallScope>> = {};
  if (options.merge && !options.minimal) {
    const state = await loadState();
    const project = state.projects[projectKey(options.projectDir)];
    const existing = project?.runtimes ?? [];
    for (const runtime of existing) {
      runtimeScopes[runtime] =
        project?.runtimeScopes?.[runtime] ?? inferRuntimeScope(project?.ownedFiles ?? [], runtime);
    }
    runtimes = [...new Set([...existing, ...runtimes])];
  }
  for (const runtime of selectedRuntimes) runtimeScopes[runtime] = options.scope ?? 'both';
  const pipeline = options.minimal ? null : resolvePipelinePackage();
  if (!options.minimal) {
    const { registry } = readRegistry();
    for (const runtime of runtimes) {
      const adapter = registry.adapters.find((entry) => entry.id === runtime);
      if (!adapter)
        throw new RuntimeManagerError('E_ADAPTER_MISSING', `Adapter ${runtime} is absent.`);
      runtimeScopes[runtime] = normalizeInstallScope(
        adapter,
        runtimeScopes[runtime] ?? options.scope ?? 'both',
      );
    }
  }
  const actions = buildActions(options, runtimes, runtimeScopes);
  return {
    ok: true,
    dryRun: Boolean(options.dryRun),
    minimal: Boolean(options.minimal),
    runtimes,
    runtimeScopes,
    scope: options.scope ?? 'both',
    pipelineVersion: pipeline?.version ?? null,
    actions: actions.map((action) => ({
      runtime: action.runtime,
      scope: action.scope,
      target: action.target,
      operation: operationFor(action),
      description: action.description,
    })),
  };
}

export async function applySetup(
  options: SetupOptions,
): Promise<SetupPreview & { backupDir?: string }> {
  const preview = await previewSetup(options);
  if (options.dryRun || options.minimal) return preview;
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
  try {
    const actions = buildActions(options, preview.runtimes, preview.runtimeScopes);
    const changed = actions.filter((action) => operationFor(action) !== 'unchanged');
    if (changed.length === 0) return preview;
    let backup: { dir: string; manifest: BackupManifest };
    try {
      backup = await createBackup(options.projectDir, changed);
    } catch (cause) {
      throw new RuntimeManagerError(
        'E_BACKUP_FAILED',
        `Could not create byte-for-byte migration backup: ${cause instanceof Error ? cause.message : String(cause)}`,
        'No setup files were changed. Fix backup permissions and rerun setup.',
      );
    }

    const owned: OwnedFile[] = [];
    for (const action of actions) {
      const content = actionBytes(action);
      await atomicWrite(action.target, content);
      owned.push({
        runtime: action.runtime,
        scope: action.scope,
        target: action.target,
        kind: action.kind,
        marker: action.marker,
        hash: ownershipHash(content, action.kind, action.marker),
      });
      const backupEntry = backup.manifest.files.find((entry) => entry.target === action.target);
      if (backupEntry) backupEntry.afterHash = hash(content);
    }
    await atomicWrite(
      path.join(backup.dir, 'migration-manifest.json'),
      Buffer.from(`${JSON.stringify(backup.manifest, null, 2)}\n`),
    );

    const state = await loadState();
    state.projects[projectKey(options.projectDir)] = {
      projectDir: path.resolve(options.projectDir),
      updatedAt: new Date().toISOString(),
      backupDir: backup.dir,
      runtimes: preview.runtimes,
      runtimeScopes: preview.runtimeScopes,
      ...(preview.runtimes.length === 1 ? { activeRuntime: preview.runtimes[0] } : {}),
      ownedFiles: owned,
    };
    await atomicWrite(statePath(), Buffer.from(`${JSON.stringify(state, null, 2)}\n`));
    return { ...preview, backupDir: backup.dir };
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
  const project = state.projects[projectKey(projectDir)];
  const selected = backupDir ?? project?.backupDir;
  if (!selected)
    throw new RuntimeManagerError(
      'E_ROLLBACK_NOT_FOUND',
      'No runtime backup is recorded for this project.',
    );
  const manifest = JSON.parse(
    await readFile(path.join(selected, 'migration-manifest.json'), 'utf8'),
  ) as BackupManifest;
  const restored: string[] = [];
  const retainedShared: string[] = [];
  const key = projectKey(projectDir);
  const sharedTargets = new Set(
    manifest.files
      .filter((entry) =>
        Object.entries(state.projects).some(
          ([otherKey, otherProject]) =>
            otherKey !== key &&
            otherProject.ownedFiles.some((owned) => owned.target === entry.target),
        ),
      )
      .map((entry) => entry.target),
  );
  for (const entry of manifest.files) {
    if (
      !sharedTargets.has(entry.target) &&
      !entry.existed &&
      existsSync(entry.target) &&
      entry.afterHash &&
      hash(await readFile(entry.target)) !== entry.afterHash
    ) {
      throw new RuntimeManagerError(
        'E_MIGRATION_CONFLICT',
        `Refusing to remove modified file ${entry.target}.`,
        'Restore it manually or choose a different backup.',
      );
    }
  }
  for (const entry of manifest.files) {
    if (sharedTargets.has(entry.target)) {
      retainedShared.push(entry.target);
      continue;
    }
    if (entry.existed && entry.backup) {
      await mkdir(path.dirname(entry.target), { recursive: true });
      await copyFile(entry.backup, entry.target);
    } else if (existsSync(entry.target)) {
      await unlink(entry.target);
    }
    restored.push(entry.target);
  }
  delete state.projects[key];
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
  const removed: string[] = [];
  const retainedShared: string[] = [];
  const runtimeFiles = project.ownedFiles.filter((file) => file.runtime === runtime);
  const sharedTargets = new Set(
    runtimeFiles
      .filter((file) =>
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
  for (const file of runtimeFiles) {
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
        adapters: Array<{ runtime: string }>;
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

  for (const file of runtimeFiles) {
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
  project.ownedFiles = project.ownedFiles.filter((file) => file.runtime !== runtime);
  project.runtimes = project.runtimes.filter((item) => item !== runtime);
  if (project.runtimeScopes) delete project.runtimeScopes[runtime];
  project.activeRuntime = project.runtimes.length === 1 ? project.runtimes[0] : undefined;
  project.updatedAt = new Date().toISOString();
  if (lockFile && lock) {
    lock.adapters = lock.adapters.filter((adapter) => adapter.runtime !== runtime);
    if (lock.adapters.length === 0) {
      await unlink(lockFile.target);
      project.ownedFiles = project.ownedFiles.filter((file) => file !== lockFile);
      removed.push(lockFile.target);
    } else {
      lock.generatedAt = new Date().toISOString();
      lock.manifestDigest = `sha256:${hash(
        JSON.stringify({
          protocol: lock.protocolVersion,
          pipelineVersion: lock.components.pipeline,
          adapters: lock.adapters,
        }),
      )}`;
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

export async function runtimeDoctor(projectDir: string): Promise<{
  ok: boolean;
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
  for (const result of detectRuntimes()) {
    diagnostics.push({
      code: `runtime-${result.runtime}`,
      status: result.installed ? 'pass' : 'warn',
      message: result.installed ? `${result.runtime} detected` : `${result.runtime} not detected`,
      ...(!result.installed
        ? { fix: `Install ${result.command} only if you intend to use this adapter.` }
        : {}),
    });
  }
  const pipeline = resolvePipelinePackage(false);
  diagnostics.push({
    code: 'pipeline-package',
    status: pipeline ? 'pass' : 'warn',
    message: pipeline ? `@openplanr/pipeline ${pipeline.version}` : 'Planning-only installation',
    ...(!pipeline ? { fix: 'Install openplanr without omitting optional dependencies.' } : {}),
  });
  const lock = path.join(projectDir, '.planr', 'runtime-lock.json');
  if (!existsSync(lock)) {
    diagnostics.push({
      code: 'runtime-lock',
      status: 'warn',
      message: 'Project runtime lock missing',
      fix: 'Run `planr setup --scope project`.',
    });
  } else {
    try {
      const value = JSON.parse(readFileSync(lock, 'utf8')) as {
        components?: { cli?: string; pipeline?: string };
        protocolVersion?: string;
        manifestDigest?: string;
        adapters?: Array<{
          runtime: RuntimeId;
          version: string;
          capabilityLevel: string;
          installScope: InstallScope;
        }>;
      };
      lockedAdapters = value.adapters;
      const cliVersion = readOpenPlanrVersion();
      const componentDrift =
        value.components?.cli !== cliVersion ||
        (pipeline && value.components?.pipeline !== pipeline.version);
      const expectedDigest = `sha256:${hash(
        JSON.stringify({
          protocol: value.protocolVersion,
          pipelineVersion: value.components?.pipeline,
          adapters: value.adapters,
        }),
      )}`;
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
      const drift = componentDrift || digestDrift || adapterDrift;
      diagnostics.push({
        code: drift ? 'lock-drift' : 'runtime-lock',
        status: drift ? 'fail' : 'pass',
        message: drift
          ? `Runtime lock drift detected (components: ${componentDrift}, digest: ${digestDrift}, adapters: ${adapterDrift})`
          : 'Project runtime lock matches installed component versions',
        ...(drift ? { fix: 'Run `planr runtime update all --scope project`.' } : {}),
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

  const state = await loadState();
  const installed = state.projects[projectKey(projectDir)];
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
    const conflicts: string[] = [];
    const missing: string[] = [];
    for (const file of installed.ownedFiles) {
      if (!existsSync(file.target)) missing.push(file.target);
      else if (ownershipHash(readFileSync(file.target), file.kind, file.marker) !== file.hash)
        conflicts.push(file.target);
    }
    diagnostics.push({
      code: conflicts.length ? 'migration-conflict' : 'managed-files',
      status: conflicts.length ? 'fail' : missing.length ? 'warn' : 'pass',
      message: conflicts.length
        ? `${conflicts.length} managed file(s) changed outside setup`
        : missing.length
          ? `${missing.length} managed file(s) are missing`
          : 'Managed runtime files match recorded ownership hashes',
      ...(conflicts.length || missing.length
        ? { fix: 'Run `planr setup --dry-run`, then explicitly approve repair or rollback.' }
        : {}),
    });
  } else if (lockedAdapters?.length) {
    diagnostics.push({
      code: 'runtime-state-missing',
      status: 'warn',
      message: 'The project has a runtime lock but this machine has no managed adapter state',
      fix: 'Run `planr setup` to install the locked runtime adapters on this machine.',
    });
  }

  const provenancePath = path.join(projectDir, '.planr', 'provenance.jsonl');
  if (existsSync(provenancePath)) {
    const invalidLines: number[] = [];
    const lines = readFileSync(provenancePath, 'utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as { event_id?: string; producer?: { product?: string } };
        if (!event.event_id || !event.producer?.product) invalidLines.push(index + 1);
      } catch {
        invalidLines.push(index + 1);
      }
    }
    diagnostics.push({
      code: invalidLines.length ? 'provenance-invalid' : 'provenance',
      status: invalidLines.length ? 'fail' : 'pass',
      message: invalidLines.length
        ? `Provenance contains invalid event lines: ${invalidLines.join(', ')}`
        : 'Provenance is append-only JSONL with identifiable producers',
      ...(invalidLines.length
        ? {
            fix: 'Repair the invalid bytes, then explicitly append a recovery event. Doctor will not invent history.',
          }
        : {}),
    });
  }

  if (pipeline) {
    const result = spawnSync(
      process.execPath,
      [path.join(pipeline.root, 'scripts', 'doctor.mjs'), '--json'],
      {
        cwd: projectDir,
        encoding: 'utf8',
        windowsHide: true,
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
      };
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
        fix: 'Run `planr pipeline doctor` for direct diagnostics.',
      });
    }
  }
  const fail = diagnostics.some((item) => item.status === 'fail');
  return { ok: !fail, diagnostics };
}

export async function clearRuntimeStateForTests(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
