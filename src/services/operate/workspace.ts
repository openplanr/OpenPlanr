import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { access, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { canonicalDigest, canonicalize, sha256Digest } from './canonical.js';
import { assertOperatingArtifact } from './protocol.js';
import { minimalSubprocessEnvironment } from './subprocess-env.js';
import {
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingConfig,
  type OperatingWorkspaceComponent,
  type OperatingWorkspaceManifest,
  type OperatingWorkspaceRoots,
} from './types.js';

const execFileAsync = promisify(execFile);

export interface OperatingPaths {
  root: string;
  config: string;
  charter: string;
  workspace: string;
  // Protocol v1.3 (FR5/E-005) collapses the append-only internals under a single
  // dot-prefixed `.state/` directory: `events.jsonl`, the single-file
  // `records.jsonl` append log, and `checkpoint.json`.
  state: string;
  events: string;
  checkpoint: string;
  records: string;
  cycles: string;
  routes: string;
  outcomes: string;
  artifacts: string;
  migrations: string;
  // Readable top-level tree (FR5): one consolidated Markdown file per register
  // plus the evidence index, rendered above the `.state/` internals.
  brief: string;
  findingsDoc: string;
  decisionsDoc: string;
  gapsDoc: string;
  routesDoc: string;
  evidenceIndex: string;
  localRoot: string;
  roots: string;
  journals: string;
  transactions: string;
  locks: string;
  cache: string;
  evidence: string;
  advisors: string;
  quarantine: string;
  sessions: string;
  // FR7 (T-006): the OpenPlanr-owned scratch root. Keyed under the machine-local
  // `localRoot` (already project-and-machine-keyed) so a runtime never chooses its
  // own transport location; per-cycle scratch and its ownership manifest live under
  // `<localRoot>/scratch/<cycleId>/`.
  scratch: string;
}

export function projectMachineKey(projectRoot: string): string {
  const resolved = path.resolve(projectRoot);
  const canonical = (() => {
    try {
      return realpathSync.native(resolved);
    } catch {
      return resolved;
    }
  })();
  return sha256Digest(canonical).slice('sha256:'.length, 'sha256:'.length + 24);
}

export function resolveOperatingPaths(
  projectRoot: string,
  options: { localRoot?: string } = {},
): OperatingPaths {
  const resolvedProject = path.resolve(projectRoot);
  const root = path.join(resolvedProject, '.planr', 'operate');
  const state = path.join(root, '.state');
  const stateBase = path.resolve(
    options.localRoot ?? process.env.OPENPLANR_STATE_ROOT ?? path.join(homedir(), '.planr'),
  );
  const localRoot = path.join(stateBase, 'operate', projectMachineKey(resolvedProject));
  return {
    root,
    config: path.join(root, 'config.json'),
    charter: path.join(root, 'charter.md'),
    workspace: path.join(root, 'workspace.json'),
    state,
    events: path.join(state, 'events.jsonl'),
    checkpoint: path.join(state, 'checkpoint.json'),
    records: path.join(state, 'records.jsonl'),
    cycles: path.join(root, 'cycles'),
    routes: path.join(root, 'routes'),
    outcomes: path.join(root, 'outcomes'),
    artifacts: path.join(root, 'artifacts'),
    migrations: path.join(root, 'migrations'),
    brief: path.join(root, 'brief.md'),
    findingsDoc: path.join(root, 'findings.md'),
    decisionsDoc: path.join(root, 'decisions.md'),
    gapsDoc: path.join(root, 'gaps.md'),
    routesDoc: path.join(root, 'routes.md'),
    evidenceIndex: path.join(root, 'evidence-index.json'),
    localRoot,
    roots: path.join(localRoot, 'workspace-roots.json'),
    journals: path.join(localRoot, 'journals'),
    transactions: path.join(localRoot, 'transactions'),
    locks: path.join(localRoot, 'locks'),
    cache: path.join(localRoot, 'cache'),
    evidence: path.join(localRoot, 'evidence'),
    advisors: path.join(localRoot, 'advisors'),
    quarantine: path.join(localRoot, 'quarantine'),
    sessions: path.join(localRoot, 'sessions'),
    scratch: path.join(localRoot, 'scratch'),
  };
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function resolveContainedPath(
  projectRoot: string,
  relativePath: string,
  options: { mustExist?: boolean } = {},
): Promise<string> {
  if (path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new OperateError('E_OPERATE_PATH_ESCAPE', 'Operating paths must be relative.');
  }
  const root = await realpath(projectRoot);
  const candidate = path.resolve(root, relativePath);
  if (!isPathInside(root, candidate)) {
    throw new OperateError('E_OPERATE_PATH_ESCAPE', `Path escapes the project: ${relativePath}`);
  }
  if (options.mustExist) {
    const resolved = await realpath(candidate);
    if (!isPathInside(root, resolved)) {
      throw new OperateError(
        'E_OPERATE_PATH_ESCAPE',
        `Path follows a symlink outside the project: ${relativePath}`,
      );
    }
    const info = await stat(resolved);
    if (!info.isFile() && !info.isDirectory()) {
      throw new OperateError('E_OPERATE_PATH_ESCAPE', 'Devices and sockets are not evidence.');
    }
    return resolved;
  }
  let nearest = path.dirname(candidate);
  while (nearest !== root) {
    try {
      const resolvedParent = await realpath(nearest);
      if (!isPathInside(root, resolvedParent)) {
        throw new OperateError(
          'E_OPERATE_PATH_ESCAPE',
          `Destination parent follows a symlink outside the project: ${relativePath}`,
        );
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      nearest = path.dirname(nearest);
    }
  }
  return candidate;
}

async function git(projectRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: projectRoot,
    env: minimalSubprocessEnvironment({
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
    }),
    timeout: 15_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  return stdout.trim();
}

export async function resolveOperatingProject(projectRoot: string): Promise<string> {
  const requested = await realpath(projectRoot);
  if (requested === path.resolve(homedir())) {
    throw new OperateError('E_OPERATE_PROJECT_REQUIRED', 'The home directory is not a project.');
  }
  let gitFailure: string | null = null;
  try {
    return await realpath(await git(requested, ['rev-parse', '--show-toplevel']));
  } catch (error) {
    // Preserve why git could not answer. A bare catch here reports "not a Git
    // worktree" for causes that have nothing to do with the worktree — git not
    // on PATH, a refused spawn, or git declining the repository outright (for
    // example `detected dubious ownership`). Those are actionable, and
    // discarding them makes the failure undiagnosable from the message alone.
    const detail = error instanceof Error ? error.message : String(error);
    gitFailure = detail.replace(/\s+/g, ' ').trim().slice(0, 300) || null;
  }

  const config = path.join(requested, '.planr', 'config.json');
  if (
    await access(config).then(
      () => true,
      () => false,
    )
  ) {
    return requested;
  }
  throw new OperateError(
    'E_OPERATE_PROJECT_REQUIRED',
    gitFailure
      ? `Operating Board requires a Git worktree or initialized OpenPlanr project. git could not resolve one at ${requested}: ${gitFailure}`
      : 'Operating Board requires a Git worktree or initialized OpenPlanr project.',
    gitFailure ? { gitFailure, projectRoot: requested } : undefined,
  );
}

export async function assertOperatingProject(projectRoot: string): Promise<string> {
  return resolveOperatingProject(projectRoot);
}

function canonicalRemote(value: string): string {
  const trimmed = value.trim().replace(/\.git$/, '');
  const scp = trimmed.match(/^[^@]+@([^:]+):(.+)$/);
  if (scp?.[1] && scp[2]) {
    return `${scp[1].toLowerCase()}/${scp[2].replace(/^\/+/, '')}`;
  }
  try {
    const parsed = new URL(trimmed);
    const cleanPath = parsed.pathname.replace(/^\/+/, '');
    if (!cleanPath) throw new Error('missing remote path');
    return `${parsed.hostname.toLowerCase()}/${cleanPath}`;
  } catch {
    const clean = trimmed.replace(/^\/+/, '');
    if (!/^[A-Za-z0-9._/-]+$/.test(clean)) {
      throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Repository remote is not canonical.');
    }
    return clean;
  }
}

function stableComponentId(remote: string): string {
  const slug = remote
    .split('/')
    .at(-1)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug && /^[a-z]/.test(slug) ? slug : `repo-${canonicalDigest(remote).slice(7, 19)}`;
}

async function repositoryDescriptor(
  root: string,
  readOnly: boolean,
  ignoredPaths: string[] = [],
): Promise<{
  descriptor: OperatingWorkspaceComponent;
  branch: string;
}> {
  const [remote, revision, status, branch] = await Promise.all([
    git(root, ['remote', 'get-url', 'origin']).catch(() => path.basename(root)),
    // Git represents an unborn branch with no object ID. Preserve that state
    // using the standard null OID while the dirty fingerprint binds all
    // uncommitted workspace bytes.
    git(root, ['rev-parse', '--verify', 'HEAD']).catch(() => '0'.repeat(40)),
    git(root, ['status', '--porcelain=v1', '--untracked-files=all']),
    git(root, ['branch', '--show-current']).then((value) => value || '(detached)'),
  ]);
  const materialStatus = status
    .split('\n')
    .filter(Boolean)
    .filter((line) => {
      const candidate = line.slice(3).replace(/^"|"$/g, '');
      const ignored = ignoredPaths.some(
        (entry) => candidate === entry || candidate.startsWith(`${entry.replace(/\/$/, '')}/`),
      );
      return !ignored && candidate !== '.planr/operate' && !candidate.startsWith('.planr/operate/');
    })
    .join('\n');
  const normalizedRemote = canonicalRemote(remote);
  return {
    descriptor: {
      componentId: stableComponentId(normalizedRemote),
      canonicalRemote: normalizedRemote,
      configuredBranch: branch,
      pinnedRevision: revision,
      dirtyFingerprint: materialStatus ? canonicalDigest(materialStatus) : null,
      readOnly,
    },
    branch,
  };
}

export async function buildWorkspaceManifest(
  controlRoot: string,
  componentRoots: string[] = [],
  options: {
    capturedAt?: string;
    localRoot?: string;
    persistRoots?: boolean;
    ignoredControlPaths?: string[];
  } = {},
): Promise<OperatingWorkspaceManifest> {
  const resolvedControl = await resolveOperatingProject(controlRoot);
  const resolvedComponents = await Promise.all(
    componentRoots.map(async (candidate) => realpath(candidate)),
  );
  const control = await repositoryDescriptor(
    resolvedControl,
    false,
    options.ignoredControlPaths ?? [],
  );
  const components = await Promise.all(
    [...new Set(resolvedComponents.filter((candidate) => candidate !== resolvedControl))].map(
      async (root) => ({ root, ...(await repositoryDescriptor(root, true)) }),
    ),
  );
  const identities = [control.descriptor, ...components.map((entry) => entry.descriptor)];
  if (new Set(identities.map((entry) => entry.componentId)).size !== identities.length) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Workspace component IDs collide; configure distinct canonical remotes.',
    );
  }
  const capturedAt = options.capturedAt ?? new Date().toISOString();
  const manifest: OperatingWorkspaceManifest = {
    kind: 'operating-workspace-manifest',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    capturedAt,
    workspaceDigest: canonicalDigest({
      controlRepository: control.descriptor,
      components: components
        .map((entry) => entry.descriptor)
        .sort((a, b) => a.componentId.localeCompare(b.componentId)),
    }),
    controlRepository: { ...control.descriptor, readOnly: false },
    components: components
      .map((entry) => ({ ...entry.descriptor, readOnly: true as const }))
      .sort((a, b) => a.componentId.localeCompare(b.componentId)),
  };
  await assertOperatingArtifact('operating-workspace-manifest', manifest);
  const roots: OperatingWorkspaceRoots = {
    controlComponentId: manifest.controlRepository.componentId,
    roots: Object.fromEntries([
      [manifest.controlRepository.componentId, resolvedControl],
      ...components.map((entry) => [entry.descriptor.componentId, entry.root]),
    ]),
  };
  if (options.persistRoots) {
    const paths = resolveOperatingPaths(resolvedControl, options);
    await mkdir(paths.localRoot, { recursive: true, mode: 0o700 });
    await writeFile(paths.roots, `${canonicalize(roots)}\n`, { mode: 0o600 });
  }
  return manifest;
}

/**
 * Rebuilds the workspace identity from committed component metadata and the
 * machine-local root map. No roots or absolute paths enter committed state.
 */
export async function refreshOperatingWorkspaceManifest(
  projectRoot: string,
  options: { localRoot?: string; ignoredControlPaths?: string[] } = {},
): Promise<OperatingWorkspaceManifest> {
  const paths = resolveOperatingPaths(projectRoot, options);
  let roots: OperatingWorkspaceRoots;
  let committed: OperatingWorkspaceManifest;
  try {
    roots = JSON.parse(await readFile(paths.roots, 'utf8')) as OperatingWorkspaceRoots;
  } catch {
    throw new OperateError(
      'E_OPERATE_NOT_INITIALIZED',
      'Machine-local workspace roots are missing; run `planr operate init` on this machine.',
    );
  }
  try {
    committed = JSON.parse(await readFile(paths.workspace, 'utf8')) as OperatingWorkspaceManifest;
  } catch {
    throw new OperateError(
      'E_OPERATE_NOT_INITIALIZED',
      'Committed workspace metadata is missing; run `planr operate init`.',
    );
  }
  await assertOperatingArtifact('operating-workspace-manifest', committed);
  if (
    !roots ||
    typeof roots !== 'object' ||
    !roots.roots ||
    typeof roots.roots !== 'object' ||
    Array.isArray(roots.roots)
  ) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'The machine-local workspace root map is invalid.',
    );
  }
  const componentRoots = committed.components.map(
    (component) => roots.roots[component.componentId],
  );
  if (componentRoots.some((root) => typeof root !== 'string')) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'The workspace manifest and machine-local component roots disagree.',
    );
  }
  return buildWorkspaceManifest(projectRoot, componentRoots as string[], {
    localRoot: options.localRoot,
    persistRoots: false,
    ...(options.ignoredControlPaths ? { ignoredControlPaths: options.ignoredControlPaths } : {}),
  });
}

/**
 * Read the machine-local `workspace-roots.json` (component ID → absolute
 * checkout root) if present. Returns null when the map is absent or malformed —
 * callers treat a missing map as "no sibling components resolvable here" rather
 * than failing, so a single-repository project stays fully functional.
 */
export async function readOperatingWorkspaceRoots(
  projectRoot: string,
  options: { localRoot?: string } = {},
): Promise<OperatingWorkspaceRoots | null> {
  const paths = resolveOperatingPaths(projectRoot, options);
  try {
    const parsed = JSON.parse(await readFile(paths.roots, 'utf8')) as OperatingWorkspaceRoots;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.roots ||
      typeof parsed.roots !== 'object' ||
      Array.isArray(parsed.roots)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function ensureOperatingDirectories(
  projectRoot: string,
  options: { localRoot?: string } = {},
): Promise<OperatingPaths> {
  const paths = resolveOperatingPaths(projectRoot, options);
  await Promise.all(
    [
      paths.root,
      // `.state/` holds events.jsonl, records.jsonl, and checkpoint.json; a
      // single directory create covers all three (they share this parent).
      paths.state,
      paths.cycles,
      paths.routes,
      paths.outcomes,
      paths.artifacts,
      paths.migrations,
      paths.localRoot,
      paths.journals,
      paths.transactions,
      paths.locks,
      paths.cache,
      paths.evidence,
      paths.advisors,
      paths.quarantine,
      paths.sessions,
      paths.scratch,
    ].map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })),
  );
  return paths;
}

export async function writeOperatingConfig(
  projectRoot: string,
  config: OperatingConfig,
  options: { localRoot?: string } = {},
): Promise<void> {
  await assertOperatingArtifact('operating-config', config);
  const paths = await ensureOperatingDirectories(projectRoot, options);
  await writeFile(paths.config, `${canonicalize(config)}\n`, { mode: 0o600 });
}

export async function readOperatingConfig(
  projectRoot: string,
  options: { localRoot?: string } = {},
): Promise<OperatingConfig> {
  const paths = resolveOperatingPaths(projectRoot, options);
  let parsed: OperatingConfig;
  try {
    parsed = JSON.parse(await readFile(paths.config, 'utf8')) as OperatingConfig;
  } catch {
    throw new OperateError(
      'E_OPERATE_NOT_INITIALIZED',
      'Operating Board is not initialized for this project.',
    );
  }
  return assertOperatingArtifact('operating-config', parsed);
}
