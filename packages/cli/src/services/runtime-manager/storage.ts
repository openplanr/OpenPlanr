import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  constants as fsConstants,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { type FileHandle, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RuntimeManagerError } from './errors.js';
import type { OwnedFile, RuntimeState } from './global-state.js';
import { actionBytes, type PlannedFileAction as FileAction } from './install-plan.js';
import type { RuntimeId } from './inventory.js';
import {
  canonicalProjectPath,
  codexBookkeepingTarget,
  codexRuntimeRoot,
  codexSkillsRoot,
  effectiveCodexHome,
  pathIsWithin,
  planrCustodyAnchor,
  projectBackupsRoot,
  projectKey,
  runtimeRoot,
  statePath,
} from './paths.js';

interface BackupEntry {
  target: string;
  backup?: string;
  existed: boolean;
  beforeHash?: string;
  afterHash?: string;
}

export interface BackupManifest {
  schemaVersion: '1.0.0';
  projectDir: string;
  createdAt: string;
  files: BackupEntry[];
}

export function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function managedBlockBytes(content: string | Buffer, marker = 'runtime'): Buffer {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : content;
  const begin = `<!-- ##planr-${marker}:begin##`;
  const end = `<!-- ##planr-${marker}:end## -->`;
  const start = text.indexOf(begin);
  const finish = text.indexOf(end, start);
  if (start === -1 || finish === -1) return Buffer.alloc(0);
  return Buffer.from(text.slice(start, finish + end.length));
}

export function ownershipHash(
  content: string | Buffer,
  kind: FileAction['kind'],
  marker?: string,
): string {
  return hash(kind === 'managed-block' ? managedBlockBytes(content, marker) : content);
}

export function assertApprovedTargetCustody(
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

export function assertMutableOwnedTarget(target: string, projectDir: string, code: string): void {
  if (pathIsWithin(target, runtimeRoot())) {
    assertApprovedTargetCustody(
      target,
      runtimeRoot(),
      planrCustodyAnchor(),
      code,
      'Global runtime ownership',
    );
    return;
  }
  if (pathIsWithin(target, codexSkillsRoot())) {
    assertApprovedTargetCustody(
      target,
      codexSkillsRoot(),
      effectiveCodexHome(),
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

export function assertBackupDirectoryCustody(
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
  assertApprovedTargetCustody(
    directory,
    approvedRoot,
    planrCustodyAnchor(),
    code,
    'Runtime backup',
  );
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

export function backupManifestIdentity(manifest: BackupManifest): string {
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

export function assertClosedBackupManifest(
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

export function assertClosedBackupTree(
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
    assertApprovedTargetCustody(
      current,
      directory,
      planrCustodyAnchor(),
      code,
      'Runtime backup tree',
    );
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

export async function readCustodiedRegularFile(
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

export async function readBackupEntryBytes(
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

export function assertUserOwnedTarget(
  file: Pick<OwnedFile, 'runtime' | 'target'>,
  runtime: RuntimeId | 'core',
  code = 'E_RUNTIME_STATE_INVALID',
  nativeHome = effectiveCodexHome(),
): void {
  const approvedRoot = runtime === 'codex' ? codexRuntimeRoot(nativeHome) : runtimeRoot();
  if (
    runtime === 'codex'
      ? codexBookkeepingTarget(file.target, nativeHome)
      : pathIsWithin(file.target, approvedRoot)
  ) {
    assertApprovedTargetCustody(
      file.target,
      approvedRoot,
      planrCustodyAnchor(),
      code,
      'Global runtime ownership',
    );
    return;
  }
  if (runtime === 'codex' && pathIsWithin(file.target, path.join(nativeHome, 'skills'))) {
    assertApprovedTargetCustody(
      file.target,
      path.join(nativeHome, 'skills'),
      nativeHome,
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

export function assertActionCustody(actions: readonly FileAction[], projectDir: string): void {
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

function assertRuntimeStateCustody(state: RuntimeState, nativeHome = effectiveCodexHome()): void {
  for (const runtime of ['claude-code', 'codex', 'cursor'] as const) {
    for (const file of state.userBundles?.[runtime]?.ownedFiles ?? []) {
      assertUserOwnedTarget(file, runtime, 'E_RUNTIME_STATE_INVALID', nativeHome);
    }
  }
  for (const project of Object.values(state.projects)) {
    for (const file of project.ownedFiles) {
      const runtime = file.runtime;
      if (file.scope === 'user' || (runtime !== 'core' && isUserOwnedFile(file, runtime))) {
        assertUserOwnedTarget(file, runtime, 'E_RUNTIME_STATE_INVALID', nativeHome);
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

export function assertRuntimeStateValue(
  value: unknown,
  code = 'E_RUNTIME_STATE_INVALID',
  allowLegacyProjectKeys = false,
  nativeHome = effectiveCodexHome(),
  inspectCustody = true,
): RuntimeState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeManagerError(code, 'Runtime ownership state is not one closed object.');
  }
  const state = value as Record<string, unknown>;
  if (
    Object.keys(state).some(
      (key) => !['projects', 'schemaVersion', 'userBundles', 'codexProfiles'].includes(key),
    ) ||
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
            'codexHome',
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
      (record.codexHome !== undefined &&
        (typeof record.codexHome !== 'string' ||
          path.resolve(record.codexHome) !== record.codexHome)) ||
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
      bundle.ownedFiles.some((file) => !assertOwnedFile(file)) ||
      (runtime === 'codex' &&
        bundle.ownedFiles.some((file) => {
          const target = (file as OwnedFile).target;
          return (
            !codexBookkeepingTarget(target, nativeHome) &&
            !pathIsWithin(target, path.join(nativeHome, 'skills'))
          );
        }))
    ) {
      throw new RuntimeManagerError(code, 'Runtime global ownership bundle is invalid.');
    }
  }
  if (state.codexProfiles !== undefined) {
    if (
      !state.codexProfiles ||
      typeof state.codexProfiles !== 'object' ||
      Array.isArray(state.codexProfiles)
    )
      throw new RuntimeManagerError(code, 'Codex profile ownership is invalid.');
    for (const [key, candidate] of Object.entries(state.codexProfiles)) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
        throw new RuntimeManagerError(code, 'Codex profile ownership is invalid.');
      const profile = candidate as Record<string, unknown>;
      if (
        Object.keys(profile).some((field) => !['home', 'bundle'].includes(field)) ||
        typeof profile.home !== 'string' ||
        path.resolve(profile.home) !== profile.home ||
        hash(profile.home).slice(0, 16) !== key
      )
        throw new RuntimeManagerError(code, 'Codex profile identity is invalid.');
      // Decode every record, but only inspect the selected native home's filesystem.
      if (profile.bundle !== undefined)
        assertRuntimeStateValue(
          { schemaVersion: '2.0.0', projects: {}, userBundles: { codex: profile.bundle } },
          code,
          false,
          profile.home,
          profile.home === effectiveCodexHome(),
        );
    }
  }
  const decoded = value as RuntimeState;
  if (inspectCustody) assertRuntimeStateCustody(decoded, nativeHome);
  return decoded;
}

export function isUserOwnedFile(
  file: OwnedFile,
  runtime: RuntimeId,
  nativeHome = effectiveCodexHome(),
): boolean {
  if (file.scope) return file.scope === 'user';
  if (pathIsWithin(file.target, runtimeRoot())) return true;
  return runtime === 'codex' && pathIsWithin(file.target, path.join(nativeHome, 'skills'));
}

export function assertRequestedProjectBinding(
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

/** Preserve modified or unknown professional project assets for every coding agent. */
export function assertProfessionalSkillTransition(
  state: RuntimeState,
  projectDir: string,
  actions: readonly FileAction[],
): void {
  const desired = actions.filter(
    (action) => action.scope === 'project' && action.custody === 'professional-skill',
  );
  if (desired.length === 0) return;
  const tracked = new Map(
    (state.projects[projectKey(projectDir)]?.ownedFiles ?? []).map((file) => [
      path.resolve(file.target),
      file,
    ]),
  );
  for (const action of desired) {
    assertMutableOwnedTarget(action.target, projectDir, 'E_MIGRATION_CONFLICT');
    if (!existsSync(action.target)) continue;
    const metadata = lstatSync(action.target);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new RuntimeManagerError(
        'E_MIGRATION_CONFLICT',
        `Refusing to replace non-file professional skill target ${action.target}.`,
        'Preserve or move the existing entry outside the managed skill directory before rerunning setup.',
      );
    }
    const currentHash = ownershipHash(readFileSync(action.target), action.kind, action.marker);
    const owned = tracked.get(path.resolve(action.target));
    if (owned) {
      if (currentHash !== owned.hash) {
        throw new RuntimeManagerError(
          'E_MIGRATION_CONFLICT',
          `Refusing to replace modified managed professional skill ${action.target}.`,
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

export async function atomicWrite(
  target: string,
  content: Buffer,
  verifyCurrent?: () => void,
): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  verifyCurrent?.();
  const stagedPackage = immutableRuntimeTarget(target);
  const stagingRoot = path.join(runtimeRoot(), 'setup-staging');
  if (stagedPackage) {
    assertApprovedTargetCustody(
      stagingRoot,
      runtimeRoot(),
      planrCustodyAnchor(),
      'E_MIGRATION_CONFLICT',
      'Runtime package staging',
    );
    await mkdir(stagingRoot, { recursive: true });
  }
  const temp = stagedPackage
    ? path.join(stagingRoot, `${randomUUID()}.tmp`)
    : `${target}.${process.pid}.tmp`;
  const verifyStaging = () => {
    if (stagedPackage)
      assertApprovedTargetCustody(
        temp,
        runtimeRoot(),
        planrCustodyAnchor(),
        'E_MIGRATION_CONFLICT',
        'Runtime package staging',
      );
  };
  let staged = false;
  try {
    verifyStaging();
    await writeFile(temp, content, { mode: 0o600, flag: 'wx' });
    staged = true;
    verifyCurrent?.();
    verifyStaging();
    await rename(temp, target);
    staged = false;
  } finally {
    if (staged) {
      verifyStaging();
      await unlink(temp);
    }
  }
}

/** Immutable packages are retained beyond discovery rollback, including pins held by other projects or runs. */
export function immutableRuntimeTarget(target: string): boolean {
  return pathIsWithin(target, path.join(runtimeRoot(), 'packages'));
}

export async function createBackup(
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
    planrCustodyAnchor(),
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

function assertRestoreTargetIdentity(
  entry: BackupEntry,
  retiredTargets: ReadonlySet<string>,
): void {
  const present = existsSync(entry.target);
  const currentHash = present ? hash(readFileSync(entry.target)) : undefined;
  const matches = present
    ? currentHash === entry.beforeHash || currentHash === entry.afterHash
    : !entry.existed || retiredTargets.has(entry.target);
  if (!matches)
    throw new RuntimeManagerError(
      'E_MIGRATION_CONFLICT',
      `Concurrent bytes prevent automatic restoration: ${entry.target}.`,
      'Your current files were preserved. Compare the retained backup before retrying.',
    );
}

export async function restoreBackup(
  backup: { dir: string; manifest: BackupManifest },
  retiredTargets: ReadonlySet<string>,
): Promise<string[]> {
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
    if (immutableRuntimeTarget(entry.target)) continue;
    assertRestoreTargetIdentity(entry, retiredTargets);
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
    if (immutableRuntimeTarget(entry.target)) continue;
    const verifyCurrent = () => {
      assertMutableOwnedTarget(entry.target, manifest.projectDir, 'E_RUNTIME_STATE_INVALID');
      assertRestoreTargetIdentity(entry, retiredTargets);
    };
    verifyCurrent();
    if (entry.existed && entry.backup) {
      const bytes = restoreBytes.get(entry.target);
      if (!bytes)
        throw new RuntimeManagerError(
          'E_RUNTIME_STATE_INVALID',
          'Backup preflight lost validated bytes.',
        );
      await mkdir(path.dirname(entry.target), { recursive: true });
      assertMutableOwnedTarget(entry.target, manifest.projectDir, 'E_RUNTIME_STATE_INVALID');
      await atomicWrite(entry.target, bytes, verifyCurrent);
    } else if (existsSync(entry.target)) {
      await unlink(entry.target);
    }
    restored.push(entry.target);
  }
  return restored;
}
