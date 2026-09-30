import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const CUSTODY_SCHEMA_VERSION = '1.0.0';

export class CustodyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CustodyError';
    this.code = code;
    this.details = details;
  }
}

function pathName(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    value.includes('\0') ||
    isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new CustodyError('E_CUSTODY_PATH', 'A selected path must be a repository-relative path.');
  }
  if (value === '.git' || value.startsWith('.git/'))
    throw new CustodyError('E_CUSTODY_PATH', 'Git metadata cannot be selected.');
  return value;
}

function within(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

async function git(root, args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if (allowFailure) return null;
    throw new CustodyError('E_CUSTODY_GIT', `Git operation failed: ${args[0]}`, {
      operation: args[0],
      exitCode: error.code,
    });
  }
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function assertRepository(root) {
  const physical = await realpath(root);
  const top = (await git(physical, ['rev-parse', '--show-toplevel'])).toString('utf8').trim();
  if ((await realpath(top)) !== physical)
    throw new CustodyError('E_CUSTODY_ROOT', 'Writable root must be the Git worktree root.');
  return physical;
}

async function safeLocation(root, path, { allowAbsent = false } = {}) {
  pathName(path);
  const logical = resolve(root, path);
  if (!within(root, logical))
    throw new CustodyError('E_CUSTODY_PATH', 'Selected path escapes the repository.');
  let current = root;
  const segments = path.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    let item;
    try {
      item = await lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT' && allowAbsent) return logical;
      throw error;
    }
    if (item.isSymbolicLink()) {
      const physical = await realpath(current).catch(() => null);
      if (!physical || !within(root, physical))
        throw new CustodyError('E_CUSTODY_PATH', `Selected path has a symlink escape: ${path}`, {
          path,
        });
      if (index < segments.length - 1)
        throw new CustodyError('E_CUSTODY_PATH', `Selected parent is a symlink: ${path}`, { path });
    }
    if (index < segments.length - 1 && !item.isDirectory())
      throw new CustodyError('E_CUSTODY_PATH', `Selected parent is not a directory: ${path}`, {
        path,
      });
  }
  return logical;
}

async function fileState(root, path, { allowAbsent = true, includeBytes = true } = {}) {
  const location = await safeLocation(root, path, { allowAbsent });
  let item;
  try {
    item = await lstat(location);
  } catch (error) {
    if (error.code === 'ENOENT' && allowAbsent) return { kind: 'absent' };
    throw error;
  }
  if (item.isSymbolicLink()) {
    const target = await readlink(location);
    const state = { kind: 'symlink', mode: item.mode & 0o777, target };
    return includeBytes
      ? state
      : { ...state, targetDigest: digest(Buffer.from(target)), target: undefined };
  }
  if (!item.isFile())
    throw new CustodyError('E_CUSTODY_PATH', `Selected path is not a regular file: ${path}`, {
      path,
    });
  const bytes = await readFile(location);
  const state = {
    kind: 'file',
    mode: item.mode & 0o777,
    bytes: bytes.length,
    digest: digest(bytes),
  };
  if (includeBytes) state.contentBase64 = bytes.toString('base64');
  return state;
}

export async function captureFileState(root, path) {
  return fileState(await realpath(root), pathName(path));
}

// Canonical integration equality follows Git: content after clean filters and owner exec bit.
// A captured state may be supplied so hashing never rereads mutable source bytes.
export async function gitFileState(root, path, state) {
  pathName(path);
  const raw = state ?? (await captureFileState(root, path));
  if (raw.kind === 'absent') return { kind: 'absent' };
  if (raw.kind === 'symlink') return { kind: 'symlink', target: raw.target };
  if (raw.kind !== 'file' || typeof raw.contentBase64 !== 'string')
    throw new CustodyError(
      'E_CUSTODY_STATE',
      'Git equality requires captured regular-file bytes.',
      { path },
    );
  const bytes = Buffer.from(raw.contentBase64, 'base64');
  const hash = await new Promise((resolveHash, reject) => {
    const child = execFile(
      'git',
      ['hash-object', '--stdin', `--path=${path}`],
      { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error)
          reject(
            new CustodyError('E_CUSTODY_GIT', 'Git content normalization failed.', {
              operation: 'hash-object',
              path,
              exitCode: error.code,
            }),
          );
        else resolveHash(stdout.trim());
      },
    );
    child.stdin.on('error', (error) =>
      reject(
        new CustodyError('E_CUSTODY_GIT', 'Git normalization input failed.', {
          path,
          cause: error.code ?? 'unknown',
        }),
      ),
    );
    child.stdin.end(bytes);
  });
  return { kind: 'file', executable: Boolean(raw.mode & 0o100), gitDigest: hash };
}

export function sameGitState(left, right) {
  return (
    left.kind === right.kind &&
    (left.kind === 'absent' ||
      (left.kind === 'symlink'
        ? left.target === right.target
        : left.executable === right.executable && left.gitDigest === right.gitDigest))
  );
}

export async function captureEngineConfiguration(root) {
  const state = {};
  for (const path of ['.claude', '.codex', '.mcp.json'])
    state[path] = await protectedState(root, path, { includeIgnored: true });
  return state;
}

async function protectedState(root, path, { includeIgnored = false } = {}) {
  const location = await safeLocation(root, path, { allowAbsent: true });
  let entry;
  try {
    entry = await lstat(location);
  } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'absent' };
    throw error;
  }
  if (!entry.isDirectory()) return fileState(root, path, { includeBytes: false });
  const children = {};
  async function walk(relativePath) {
    const names = await readdir(join(root, relativePath));
    for (const name of names.sort()) {
      const child = `${relativePath}/${name}`;
      const item = await lstat(join(root, child));
      if (
        !includeIgnored &&
        ((await isIgnored(root, child)) ||
          (['.DS_Store', 'node_modules'].includes(name) &&
            !(await git(root, ['ls-files', '--cached', '-z', '--', child])).length))
      )
        continue;
      if (item.isDirectory()) {
        children[child] = { kind: 'directory', mode: item.mode & 0o777 };
        await walk(child);
      } else children[child] = await fileState(root, child, { includeBytes: false });
    }
  }
  await walk(path);
  return { kind: 'directory', mode: entry.mode & 0o777, children };
}

async function tracked(root, path) {
  const names = (await git(root, ['ls-files', '--cached', '-z', '--', path]))
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  return names.includes(path);
}

async function isIgnored(root, path) {
  return (await git(root, ['check-ignore', '-q', '--', path], { allowFailure: true })) !== null;
}

async function indexState(root) {
  return digest(await git(root, ['ls-files', '--stage', '-z']));
}

async function status(root) {
  const bytes = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const tokens = bytes.toString('utf8').split('\0');
  const changed = new Set();
  const staged = [];
  for (let index = 0; index < tokens.length && tokens[index]; index += 1) {
    const row = tokens[index];
    const code = row.slice(0, 2);
    const path = row.slice(3);
    if (code[0] !== ' ' && code[0] !== '?') staged.push(path);
    changed.add(path);
    if (code.includes('R') || code.includes('C')) changed.add(tokens[++index]);
  }
  return { changedPaths: [...changed].sort(), stagedPaths: staged.sort() };
}

function selectedFromCapsule(capsule) {
  if (
    !capsule ||
    capsule.kind !== 'openplanr-delegation-context-capsule' ||
    !Array.isArray(capsule.inventory)
  )
    throw new CustodyError('E_CUSTODY_CAPSULE', 'A valid context capsule inventory is required.');
  return capsule.inventory
    .filter(
      (file) =>
        file.repositoryKey === 'project' &&
        file.roles?.includes('selected-source') &&
        !file.path.startsWith('.planr/'),
    )
    .map((file) => file.path);
}

function preserveFromCapsule(capsule) {
  const task = capsule?.files?.find(
    (file) => file.repositoryKey === 'project' && file.roles?.includes('task'),
  );
  if (!task) return [];
  const body = Buffer.from(task.contentBase64, 'base64').toString('utf8');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(body)?.[1] ?? '';
  const block = /^preserve:\s*\r?\n((?:[ \t].*\r?\n?)*)/mu.exec(frontmatter)?.[1] ?? '';
  const entries = [
    ...block.matchAll(
      /^\s+-\s+repositoryKey:\s*["']?([^\s"']+)["']?\s*\r?\n\s+path:\s*["']?([^\r\n"']+)["']?\s*$/gmu,
    ),
  ];
  if (block.trim() && !entries.length)
    throw new CustodyError('E_CUSTODY_PRESERVE', 'Task Preserve entries could not be parsed.');
  return entries.filter(([, key]) => key === 'project').map(([, , path]) => path.trim());
}

export function planWritableScopes({ repositories, contractOwnerKey } = {}) {
  if (!Array.isArray(repositories) || repositories.length === 0)
    throw new CustodyError('E_CUSTODY_SCOPE', 'At least one repository is required.');
  const seen = new Set();
  for (const item of repositories) {
    if (
      !item ||
      typeof item.repositoryKey !== 'string' ||
      seen.has(item.repositoryKey) ||
      !item.root ||
      (item.selectedContext !== undefined && !Array.isArray(item.selectedContext))
    )
      throw new CustodyError(
        'E_CUSTODY_SCOPE',
        'Repository keys, roots, and selected context must be valid and unique.',
      );
    seen.add(item.repositoryKey);
  }
  const writable = repositories.filter((item) => item.writable === true);
  if (
    !writable.length ||
    !contractOwnerKey ||
    !writable.some((item) => item.repositoryKey === contractOwnerKey)
  )
    throw new CustodyError('E_CUSTODY_SCOPE', 'A writable contract owner must be identified.');
  const owner = writable.find((item) => item.repositoryKey === contractOwnerKey);
  return [owner, ...writable.filter((item) => item !== owner)].map((item) => ({
    writableRepository: { repositoryKey: item.repositoryKey, root: item.root },
    readOnlyRepositories: repositories
      .filter((other) => other !== item && other.selectedContext?.length)
      .map((other) => ({
        repositoryKey: other.repositoryKey,
        root: other.root,
        selectedContext: other.selectedContext.map(pathName),
        writable: false,
      })),
  }));
}

export async function createWorktreeCustody({
  repositoryRoot,
  capsule,
  selectedPaths,
  preservePaths = [],
  readOnlyRepositories = [],
  worktreeParent,
  runId = randomUUID(),
} = {}) {
  if (
    !repositoryRoot ||
    !worktreeParent ||
    !Array.isArray(preservePaths) ||
    !Array.isArray(readOnlyRepositories) ||
    readOnlyRepositories.some((source) => source.writable !== false)
  )
    throw new CustodyError(
      'E_CUSTODY_SCOPE',
      'Provide one writable root and only explicitly read-only secondary repositories.',
    );
  const root = await assertRepository(repositoryRoot);
  const paths = [...new Set((selectedPaths ?? selectedFromCapsule(capsule)).map(pathName))].sort();
  if (selectedPaths && capsule) {
    const allowed = new Set(selectedFromCapsule(capsule));
    if (paths.some((path) => !allowed.has(path)))
      throw new CustodyError(
        'E_CUSTODY_SCOPE',
        'Selected dirty paths must occur in the capsule source inventory.',
      );
  }
  const protectedPaths = [
    ...new Set([...preserveFromCapsule(capsule), ...preservePaths].map(pathName)),
  ].sort();
  if (
    paths.some((path) =>
      protectedPaths.some(
        (protectedPath) => path === protectedPath || path.startsWith(`${protectedPath}/`),
      ),
    )
  )
    throw new CustodyError('E_CUSTODY_PRESERVE', 'Selected dirty state overlaps a Preserve path.');
  const physicalParent = await realpath(worktreeParent);
  if (within(root, physicalParent) || within(physicalParent, root))
    throw new CustodyError(
      'E_CUSTODY_SCOPE',
      'Worktree parent must be separate from the source repository.',
    );
  if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(runId))
    throw new CustodyError('E_CUSTODY_SCOPE', 'Run identifier must be a short safe token.');
  const initialHead = (await git(root, ['rev-parse', 'HEAD'])).toString('utf8').trim();
  const sourceIndex = await indexState(root);
  const sourceFiles = {};
  for (const path of paths) {
    const registered = await tracked(root, path);
    if (!registered && (await isIgnored(root, path)))
      throw new CustodyError(
        'E_CUSTODY_IGNORED',
        `Ignored untracked path cannot be selected: ${path}`,
        { path },
      );
    const state = await fileState(root, path);
    if (!registered && state.kind === 'absent')
      throw new CustodyError(
        'E_CUSTODY_PATH',
        `Selected path is neither tracked nor present: ${path}`,
        { path },
      );
    sourceFiles[path] = { ...state, tracked: registered };
  }
  const base = await mkdtemp(join(physicalParent, `planr-delegate-${runId}-`));
  const worktreePath = join(base, 'worktree');
  const custodyToken = randomUUID();
  try {
    await writeFile(
      join(base, 'ownership.json'),
      JSON.stringify({ runId, custodyToken, repositoryRoot: root, worktreePath }),
      { mode: 0o600, flag: 'wx' },
    );
    await git(root, ['worktree', 'add', '--detach', '--', worktreePath, initialHead]);
    const startingFiles = {};
    for (const path of paths) {
      const source = sourceFiles[path];
      const target = await safeLocation(worktreePath, path, { allowAbsent: true });
      if (source.kind === 'absent') await rm(target, { force: true });
      else {
        await mkdir(dirname(target), { recursive: true });
        await rm(target, { force: true });
        if (source.kind === 'symlink') await symlink(source.target, target);
        else {
          await writeFile(target, Buffer.from(source.contentBase64, 'base64'), {
            mode: source.mode,
          });
          await chmod(target, source.mode);
        }
      }
      startingFiles[path] = await fileState(worktreePath, path);
    }
    const preservedFiles = {};
    for (const path of protectedPaths)
      preservedFiles[path] = await protectedState(worktreePath, path);
    const record = {
      kind: 'openplanr-delegation-worktree-custody',
      schemaVersion: CUSTODY_SCHEMA_VERSION,
      runId,
      custodyToken,
      repositoryRoot: root,
      worktreePath,
      initialHead,
      initialIndex: await indexState(worktreePath),
      sourceIndex,
      selectedPaths: paths,
      sourceFiles,
      startingFiles,
      preservePaths: protectedPaths,
      preservedFiles,
      engineConfiguration: await captureEngineConfiguration(worktreePath),
      readOnlyRepositories: readOnlyRepositories.map(
        ({ repositoryKey, root: otherRoot, selectedContext = [] }) => ({
          repositoryKey,
          root: otherRoot,
          selectedContext: selectedContext.map(pathName),
        }),
      ),
    };
    return record;
  } catch (error) {
    // A failed preparation has no delegate output, but retain the directory for inspection.
    throw new CustodyError('E_CUSTODY_PREPARE', `Worktree preparation failed; inspect ${base}.`, {
      path: base,
      cause: error.code ?? 'unknown',
    });
  }
}

export async function headFileState(root, path, revision) {
  const output = await git(root, ['ls-tree', '-z', revision, '--', path]);
  const line = output
    .toString('utf8')
    .split('\0')
    .find((entry) => entry.endsWith(`\t${path}`));
  if (!line) return { kind: 'absent' };
  const match = /^(100644|100755|120000) blob ([a-f0-9]+)\t(.+)$/u.exec(line);
  if (!match || match[3] !== path)
    throw new CustodyError('E_INTEGRATION_TREE', 'Unsupported Git tree entry.', { path });
  const bytes = await git(root, ['cat-file', 'blob', match[2]]);
  if (match[1] === '120000')
    return { kind: 'symlink', mode: 0o777, target: bytes.toString('utf8') };
  return {
    kind: 'file',
    mode: match[1] === '100755' ? 0o755 : 0o644,
    bytes: bytes.length,
    contentBase64: bytes.toString('base64'),
  };
}

// Dependency setup has its own baseline. It never changes source custody.
export async function inspectWorktreeSetup(record) {
  const current = await validateWorktreeCustody(record);
  if (!current.valid)
    throw new CustodyError('E_CUSTODY_SETUP', 'Setup changed protected custody.', {
      violations: current.violations,
    });
  const files = {};
  const paths = [
    ...new Set([...current.changedPaths, ...Object.keys(record.startingFiles ?? {})]),
  ].sort();
  for (const path of paths) {
    const before =
      record.setupFiles?.[path] ??
      record.startingFiles?.[path] ??
      (await headFileState(record.worktreePath, path, record.initialHead));
    const after = await captureFileState(record.worktreePath, path);
    if (
      !sameGitState(
        await gitFileState(record.worktreePath, path, before),
        await gitFileState(record.worktreePath, path, after),
      )
    )
      files[path] = after;
  }
  return { files, digest: digest(Buffer.from(JSON.stringify(files))) };
}

export async function validateWorktreeCustody(record) {
  if (!record || record.kind !== 'openplanr-delegation-worktree-custody')
    throw new CustodyError('E_CUSTODY_RECORD', 'A custody record is required.');
  const root = await assertRepository(record.worktreePath);
  const violations = [];
  await assertRepository(record.repositoryRoot);
  // Source HEAD/index may advance on unrelated paths; integration checks each destination.
  const head = (await git(root, ['rev-parse', 'HEAD'])).toString('utf8').trim();
  if (head !== record.initialHead)
    violations.push({ code: 'E_CUSTODY_HEAD', expected: record.initialHead, actual: head });
  const currentIndex = await indexState(root);
  if (currentIndex !== record.initialIndex) violations.push({ code: 'E_CUSTODY_INDEX' });
  if (record.engineConfiguration) {
    const currentConfiguration = await captureEngineConfiguration(root);
    for (const path of Object.keys(record.engineConfiguration))
      if (
        JSON.stringify(currentConfiguration[path]) !==
        JSON.stringify(record.engineConfiguration[path])
      )
        violations.push({ code: 'E_CUSTODY_ENGINE_CONFIGURATION', path });
  }
  const currentStatus = await status(root);
  if (currentStatus.stagedPaths.length)
    violations.push({ code: 'E_CUSTODY_STAGED', paths: currentStatus.stagedPaths });
  for (const path of record.preservePaths) {
    let now;
    try {
      now = await protectedState(root, path);
    } catch (error) {
      if (error.code === 'E_CUSTODY_PATH' || error.code === 'ENOENT') {
        violations.push({ code: 'E_CUSTODY_PRESERVE', path });
        continue;
      }
      throw error;
    }
    if (JSON.stringify(now) !== JSON.stringify(record.preservedFiles[path]))
      violations.push({ code: 'E_CUSTODY_PRESERVE', path });
  }
  for (const [path, expected] of Object.entries(record.setupFiles ?? {})) {
    const current = await captureFileState(root, path);
    if (
      !sameGitState(
        await gitFileState(root, path, expected),
        await gitFileState(root, path, current),
      )
    )
      violations.push({ code: 'E_CUSTODY_SETUP_CHANGED', path });
  }
  return { valid: violations.length === 0, violations, changedPaths: currentStatus.changedPaths };
}

export async function cleanupWorktreeCustody(record, { disposition } = {}) {
  if (
    !record ||
    record.kind !== 'openplanr-delegation-worktree-custody' ||
    !['accepted', 'abandoned'].includes(disposition)
  )
    throw new CustodyError(
      'E_CUSTODY_CLEANUP',
      'Cleanup requires an accepted or abandoned custody record.',
    );
  const root = await assertRepository(record.repositoryRoot);
  const target = record.worktreePath;
  if (
    !isAbsolute(target) ||
    resolve(target) !== target ||
    basename(target) !== 'worktree' ||
    !basename(dirname(target)).startsWith(`planr-delegate-${record.runId}-`) ||
    within(root, target)
  )
    throw new CustodyError('E_CUSTODY_CLEANUP', 'Custody target is not a managed worktree.');
  const listed = (await git(root, ['worktree', 'list', '--porcelain'])).toString('utf8');
  const registered = listed.split('\n').includes(`worktree ${target}`);
  let physicalParent;
  try {
    physicalParent = await realpath(dirname(target));
  } catch (error) {
    if (error.code === 'ENOENT' && !registered)
      return { removed: target, disposition, alreadyRemoved: true };
    throw new CustodyError(
      'E_CUSTODY_CLEANUP',
      'Managed worktree ownership directory is unavailable.',
      { cause: error.code ?? error.name },
    );
  }
  if (physicalParent !== dirname(target))
    throw new CustodyError('E_CUSTODY_CLEANUP', 'Managed worktree ownership directory changed.');
  let present = true;
  try {
    if ((await realpath(target)) !== target)
      throw new CustodyError('E_CUSTODY_CLEANUP', 'Managed worktree target changed.');
  } catch (error) {
    if (error.code === 'ENOENT') present = false;
    else throw error;
  }
  let owner;
  try {
    owner = JSON.parse(await readFile(join(physicalParent, 'ownership.json'), 'utf8'));
  } catch (error) {
    throw new CustodyError('E_CUSTODY_CLEANUP', 'Managed worktree ownership could not be read.', {
      cause: error.code ?? error.name,
    });
  }
  if (
    owner.runId !== record.runId ||
    owner.custodyToken !== record.custodyToken ||
    owner.repositoryRoot !== root ||
    owner.worktreePath !== target
  )
    throw new CustodyError('E_CUSTODY_CLEANUP', 'Custody record does not own this worktree.');
  if (registered) await git(root, ['worktree', 'remove', '--force', '--', target]);
  else if (present)
    throw new CustodyError(
      'E_CUSTODY_CLEANUP',
      'Present worktree is not registered to this repository.',
    );
  await rm(physicalParent, { recursive: true, force: true });
  return {
    removed: target,
    disposition,
    ...(!present && !registered ? { alreadyRemoved: true } : {}),
  };
}
