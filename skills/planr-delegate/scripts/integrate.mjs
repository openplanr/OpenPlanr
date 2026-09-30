import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { invokeProcess } from './adapters/generic.mjs';
import {
  captureFileState,
  gitFileState,
  sameGitState,
  validateWorktreeCustody,
} from './custody.mjs';
import { verifiedHelper } from './helper-snapshot.mjs';
import { implementationReport, reviewPresentation } from './presentation.mjs';
import {
  assertRunRecordFits,
  closeRunRecord,
  compactIntegrationState,
  processIdentity,
  processIdentityState,
  readRunRecord,
  updateRunRecord,
  withRunTransitionLock,
} from './run-record.mjs';
import { readDelegateCustody, validateDelegateCapsule } from './runner.mjs';

const execFile = promisify(execFileCallback);
const gitOptions = { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 };

export class IntegrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IntegrationError';
    this.code = code;
    this.details = details;
  }
}

function safePath(path) {
  if (
    typeof path !== 'string' ||
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    isAbsolute(path) ||
    /^[A-Za-z]:/u.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new IntegrationError('E_INTEGRATION_PATH', 'A changed path must be repository-relative.');
  }
  return path;
}

function covers(rule, path) {
  const normalized = safePath(rule.replace(/\/$/u, ''));
  return path === normalized || path.startsWith(`${normalized}/`);
}

function sameState(left, right) {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === 'absent') return true;
  if (left.mode !== right.mode) return false;
  if (left.kind === 'symlink') return left.target === right.target;
  return left.contentBase64 === right.contentBase64;
}

async function git(cwd, ...args) {
  const { stdout } = await execFile('git', args, { ...gitOptions, cwd });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

async function headFileState(root, path, revision) {
  const output = await git(root, 'ls-tree', '-z', revision, '--', path);
  const line = output
    .toString('utf8')
    .split('\0')
    .find((entry) => entry.endsWith(`\t${path}`));
  if (!line) return { kind: 'absent' };
  const match = /^(100644|100755|120000) blob ([a-f0-9]+)\t(.+)$/u.exec(line);
  if (!match || match[3] !== path)
    throw new IntegrationError('E_INTEGRATION_TREE', 'Unsupported Git tree entry.', { path });
  const bytes = await git(root, 'cat-file', 'blob', match[2]);
  if (match[1] === '120000')
    return { kind: 'symlink', mode: 0o777, target: bytes.toString('utf8') };
  return {
    kind: 'file',
    mode: match[1] === '100755' ? 0o755 : 0o644,
    bytes: bytes.length,
    contentBase64: bytes.toString('base64'),
  };
}

async function candidatePaths(custody) {
  const diff = await git(custody.worktreePath, 'diff', '--name-only', '-z', custody.initialHead);
  const untracked = await git(
    custody.worktreePath,
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  );
  return [
    ...new Set(
      [
        ...diff.toString('utf8').split('\0'),
        ...untracked.toString('utf8').split('\0'),
        ...Object.keys(custody.startingFiles ?? {}),
      ]
        .filter(Boolean)
        .map(safePath),
    ),
  ].sort();
}

function completed(run) {
  return run?.status === 'completed' || run?.state === 'completed';
}

export async function reviewDelegateDelta({
  custody,
  run,
  scopePaths = [],
  preservePaths = [],
} = {}) {
  if (!custody?.repositoryRoot || !custody?.worktreePath)
    throw new IntegrationError('E_INTEGRATION_RECORD', 'A custody record is required.');
  if (!completed(run))
    throw new IntegrationError(
      'E_INTEGRATION_RUN',
      'Only a completed delegate run can be reviewed.',
    );
  if (!Array.isArray(scopePaths) || scopePaths.length === 0)
    throw new IntegrationError(
      'E_INTEGRATION_SCOPE',
      'Explicit writable scope paths are required.',
    );
  const allowed = scopePaths.map(safePath);
  const protectedPaths = [...(custody.preservePaths ?? []), ...preservePaths].map((entry) =>
    safePath(typeof entry === 'string' ? entry : entry.path),
  );
  const custodyCheck = await validateWorktreeCustody(custody);
  const violations = [
    ...(custodyCheck.violations ?? []).map((violation) =>
      typeof violation === 'string'
        ? { code: 'E_INTEGRATION_CUSTODY', message: violation }
        : violation,
    ),
  ];
  const changes = [];
  for (const path of await candidatePaths(custody)) {
    const before =
      custody.startingFiles?.[path] ??
      (await headFileState(custody.worktreePath, path, custody.initialHead));
    let after;
    try {
      after = await captureFileState(custody.worktreePath, path);
    } catch (error) {
      violations.push({
        code: 'E_INTEGRATION_UNSAFE_WORKTREE_PATH',
        path,
        reason: error.code ?? 'unreadable',
      });
      continue;
    }
    if (
      sameGitState(
        await gitFileState(custody.worktreePath, path, before),
        await gitFileState(custody.worktreePath, path, after),
      )
    )
      continue;
    if (!allowed.some((rule) => covers(rule, path)))
      violations.push({ code: 'E_INTEGRATION_SCOPE', path });
    if (protectedPaths.some((rule) => covers(rule, path)))
      violations.push({ code: 'E_INTEGRATION_PRESERVE', path });
    const sourceBefore =
      custody.sourceFiles?.[path] ??
      (await headFileState(custody.repositoryRoot, path, custody.initialHead));
    let sourceNow;
    try {
      sourceNow = await captureFileState(custody.repositoryRoot, path);
    } catch (error) {
      violations.push({
        code: 'E_INTEGRATION_UNSAFE_SOURCE_PATH',
        path,
        reason: error.code ?? 'unreadable',
      });
      continue;
    }
    if (
      !sameGitState(
        await gitFileState(custody.repositoryRoot, path, sourceBefore),
        await gitFileState(custody.repositoryRoot, path, sourceNow),
      )
    )
      violations.push({ code: 'E_INTEGRATION_SOURCE_DRIFT', path });
    changes.push({ path, before, after, sourceBefore: sourceNow });
  }
  return {
    ready: violations.length === 0,
    changedPaths: changes.map(({ path }) => path),
    changes,
    violations,
    patch: changes.map(({ path, before, after }) => ({ path, before, after })),
  };
}

async function safeDestination(root, path) {
  const full = resolve(root, safePath(path));
  if (!full.startsWith(`${resolve(root)}${sep}`))
    throw new IntegrationError('E_INTEGRATION_PATH', 'Destination escapes repository.');
  let parent = dirname(full);
  while (parent !== resolve(root)) {
    try {
      const info = await lstat(parent);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new IntegrationError(
          'E_INTEGRATION_PATH',
          'Destination parent is not a real directory.',
          { path },
        );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    parent = dirname(parent);
  }
  return full;
}

async function putState(root, path, state, suffix, createdDirectories = []) {
  const target = await safeDestination(root, path);
  if (state.kind === 'absent') {
    await rm(target, { force: true });
    return;
  }
  const missing = [];
  let directory = dirname(target);
  while (directory !== resolve(root)) {
    try {
      await lstat(directory);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.push(directory);
      directory = dirname(directory);
    }
  }
  for (const created of missing.reverse()) {
    await mkdir(created);
    createdDirectories.push(created);
  }
  const temporary = `${target}.planr-delegate-${suffix}`;
  try {
    if (state.kind === 'file') {
      await writeFile(temporary, Buffer.from(state.contentBase64, 'base64'), {
        mode: 0o600,
        flag: 'wx',
      });
      await chmod(temporary, state.mode);
    } else if (state.kind === 'symlink') {
      if (
        isAbsolute(state.target) ||
        !resolve(dirname(target), state.target).startsWith(`${resolve(root)}${sep}`)
      )
        throw new IntegrationError('E_INTEGRATION_LINK', 'Delegate symlink target is unsafe.', {
          path,
        });
      await symlink(state.target, temporary);
    } else throw new IntegrationError('E_INTEGRATION_STATE', 'Unsupported file state.', { path });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function parseCheck(raw) {
  if (typeof raw !== 'string' || raw.length > 512 || /[\r\n\0]/u.test(raw)) return null;
  const words = raw.trim().split(/\s+/u);
  if (
    words[0] === 'npm' &&
    words[1] === 'run' &&
    /^[a-zA-Z0-9:._-]+$/u.test(words[2] ?? '') &&
    words.length === 3
  )
    return {
      command: 'npm',
      args: ['run', words[2]],
      kind: words[2].includes('test') ? 'focused' : 'regression',
    };
  if (
    words[0] === 'node' &&
    words[1] === '--test' &&
    words
      .slice(2)
      .every(
        (part) =>
          /^[A-Za-z0-9_./*-]+$/u.test(part) &&
          !part.split('/').includes('..') &&
          !part.startsWith('-'),
      ) &&
    words.length > 2
  )
    return { command: 'node', args: words.slice(1), kind: 'focused' };
  return null;
}

async function resolveSelectedChecks(repositoryRoot, supplied, capsule, changedPaths) {
  if (supplied === undefined)
    return discoverDelegateChecks({ repositoryRoot, capsule, changedPaths });
  if (!Array.isArray(supplied) || supplied.length > 16)
    throw new IntegrationError(
      'E_INTEGRATION_CHECK_SELECTION',
      'Choose at most 16 explicit checks.',
    );
  const checks = [];
  for (const entry of supplied) {
    const text =
      typeof entry === 'string'
        ? entry
        : Array.isArray(entry?.args)
          ? [entry.command, ...entry.args].join(' ')
          : entry?.command;
    const cwd = typeof entry === 'string' ? '.' : (entry?.cwd ?? '.');
    const check = parseCheck(text);
    if (!check || (cwd !== '.' && (typeof cwd !== 'string' || !/^[A-Za-z0-9_./-]+$/u.test(cwd))))
      throw new IntegrationError(
        'E_INTEGRATION_CHECK_SELECTION',
        'Checks must be simple npm run or node --test commands with a safe package directory.',
      );
    const relativeCwd = cwd === '.' ? '.' : safePath(cwd);
    let physical;
    try {
      physical = await realpath(resolve(repositoryRoot, relativeCwd));
    } catch (error) {
      throw new IntegrationError(
        'E_INTEGRATION_CHECK_SELECTION',
        'Selected check directory could not be inspected.',
        { path: relativeCwd, causeCode: error.code ?? 'E_DIRECTORY_INSPECTION' },
      );
    }
    if (
      !physical ||
      (physical !== repositoryRoot && !physical.startsWith(`${repositoryRoot}${sep}`))
    )
      throw new IntegrationError(
        'E_INTEGRATION_CHECK_SELECTION',
        'Check directory must be inside the target checkout.',
      );
    if (check.command === 'npm') {
      let scripts;
      try {
        scripts = JSON.parse(await readFile(join(physical, 'package.json'), 'utf8')).scripts ?? {};
      } catch (error) {
        throw new IntegrationError(
          'E_INTEGRATION_CHECK_SELECTION',
          'Selected npm check has no readable package manifest.',
          { path: join(relativeCwd, 'package.json'), causeCode: error.code ?? 'E_MANIFEST_PARSE' },
        );
      }
      if (typeof scripts[check.args[1]] !== 'string')
        throw new IntegrationError(
          'E_INTEGRATION_CHECK_SELECTION',
          'Selected npm check is not declared by its package.',
        );
    }
    checks.push({ ...check, cwd: relativeCwd });
  }
  return checks.filter(
    (check, index, all) =>
      all.findIndex(
        (other) =>
          other.cwd === check.cwd &&
          other.command === check.command &&
          other.args.join(' ') === check.args.join(' '),
      ) === index,
  );
}

export async function discoverDelegateChecks({
  repositoryRoot,
  capsule,
  taskText,
  changedPaths = [],
} = {}) {
  const taskCopy = capsule?.files?.find((entry) => entry.roles?.includes('task'));
  const text =
    taskText ?? (taskCopy ? Buffer.from(taskCopy.contentBase64, 'base64').toString('utf8') : '');
  const requirements = /## Test Requirements\s*([\s\S]*?)(?=\n## |$)/u.exec(text)?.[1] ?? '';
  const found = [...requirements.matchAll(/`([^`\n]+)`/gu)]
    .map((match) => parseCheck(match[1]))
    .filter(Boolean);
  let scripts = {};
  try {
    scripts =
      JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')).scripts ?? {};
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!found.some((check) => check.kind === 'regression') && scripts['check:boundaries'])
    found.push({ command: 'npm', args: ['run', 'check:boundaries'], kind: 'regression' });
  if (!found.some((check) => check.kind === 'focused') && scripts['test:focused'])
    found.push({ command: 'npm', args: ['run', 'test:focused'], kind: 'focused' });
  if (!found.some((check) => check.kind === 'focused') && scripts.test)
    found.push({ command: 'npm', args: ['run', 'test'], kind: 'focused' });
  // CI and repository guidance can advertise relevant scripts without executing arbitrary shell fragments.
  for (const file of ['AGENTS.md', '.github/workflows/ci.yml', '.github/workflows/ci.yaml']) {
    let guidance = '';
    try {
      guidance = await readFile(join(repositoryRoot, file), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const match of guidance.matchAll(/\bnpm run ([a-zA-Z0-9:._-]+)/gu)) {
      if (
        scripts[match[1]] &&
        /test|check|verify|lint/u.test(match[1]) &&
        !found.some((check) => check.command === 'npm' && check.args[1] === match[1])
      ) {
        if (
          changedPaths.some((path) => path.startsWith('skills/')) &&
          /skill|boundar/u.test(match[1])
        )
          found.push({ command: 'npm', args: ['run', match[1]], kind: 'regression' });
      }
    }
  }
  return found.filter(
    (check, index, all) =>
      all.findIndex(
        (other) => other.command === check.command && other.args.join(' ') === check.args.join(' '),
      ) === index,
  );
}

function executionEnvironment(home) {
  const env = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    TMPDIR: home,
    LANG: 'C.UTF-8',
    CI: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    npm_config_cache: join(home, 'npm-cache'),
    npm_config_userconfig: join(home, '.npmrc'),
  };
  if (process.platform === 'win32') {
    for (const key of ['SystemRoot', 'COMSPEC', 'PATHEXT'])
      if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function executeCheck(root, check, timeoutMs, home, signal) {
  const startedAt = new Date().toISOString();
  const command = `${check.cwd && check.cwd !== '.' ? `${check.cwd}: ` : ''}${[check.command, ...check.args].join(' ')}`;
  try {
    const result = await invokeProcess(check.command, check.args, {
      cwd: resolve(root, check.cwd ?? '.'),
      timeoutMs,
      env: executionEnvironment(home),
      signal,
      retainStdout: false,
      onStdoutLine: () => {},
      withExitCode: true,
      maxOutputBytes: 8 * 1024 * 1024,
    });
    return {
      command,
      kind: check.kind,
      status: result.exitCode === 0 ? 'passed' : 'failed',
      ...(result.exitCode === 0 ? {} : { exitCode: result.exitCode, signal: result.signal }),
      startedAt,
    };
  } catch (error) {
    const timedOut = error.code === 'E_ADAPTER_TIMEOUT';
    return {
      command,
      kind: check.kind,
      status: timedOut ? 'timed-out' : 'failed',
      code: error.code ?? 'E_INTEGRATION_CHECK',
      exitCode: error.details?.exitCode ?? null,
      signal: error.details?.signal ?? null,
      ...(timedOut ? { timeoutMs } : {}),
      startedAt,
    };
  }
}

export async function runDelegateChecks({
  repositoryRoot,
  checks,
  timeoutMs = 600000,
  home,
  signal,
} = {}) {
  const ownedHome = home ? null : await mkdtemp(join(tmpdir(), 'planr-check-home-'));
  try {
    const results = [];
    for (const check of checks) {
      if (signal?.aborted)
        throw new IntegrationError('E_INTEGRATION_INTERRUPTED', 'Integration was interrupted.');
      results.push(await executeCheck(repositoryRoot, check, timeoutMs, home ?? ownedHome, signal));
    }
    return results;
  } finally {
    if (ownedHome) await rm(ownedHome, { recursive: true, force: true });
  }
}

async function workingPaths(root) {
  const [tracked, untracked] = await Promise.all([
    git(root, 'diff', '--name-only', '-z', 'HEAD'),
    git(root, 'ls-files', '--others', '--exclude-standard', '-z'),
  ]);
  return [
    ...new Set(
      [...tracked.toString('utf8').split('\0'), ...untracked.toString('utf8').split('\0')]
        .filter(Boolean)
        .map(safePath),
    ),
  ].sort();
}

async function resolveSelectedGenerators(root, supplied, changedPaths, scopePaths, protectedPaths) {
  if (supplied === undefined) return [];
  if (!Array.isArray(supplied) || supplied.length > 4)
    throw new IntegrationError(
      'E_INTEGRATION_GENERATOR_SELECTION',
      'Choose at most four package generators.',
    );
  const generators = [];
  const allOutputs = new Set();
  for (const entry of supplied) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new IntegrationError(
        'E_INTEGRATION_GENERATOR_SELECTION',
        'A generator needs a package path, script, and exact output paths.',
      );
    const packagePath = safePath(entry.packagePath);
    const script = entry.script;
    const outputPaths = entry.outputPaths;
    if (
      !packagePath.startsWith('packages/') ||
      !changedPaths.some((path) => covers(packagePath, path)) ||
      typeof script !== 'string' ||
      !/^generate(?::[A-Za-z0-9:._-]+)?$/u.test(script) ||
      !Array.isArray(outputPaths) ||
      outputPaths.length === 0 ||
      outputPaths.length > 32
    ) {
      throw new IntegrationError(
        'E_INTEGRATION_GENERATOR_SELECTION',
        'Generator must belong to the changed package and declare its outputs.',
      );
    }
    let physical;
    try {
      physical = await realpath(resolve(root, packagePath));
    } catch (error) {
      throw new IntegrationError(
        'E_INTEGRATION_GENERATOR_SELECTION',
        'Generator package could not be inspected.',
        { path: packagePath, causeCode: error.code ?? 'E_DIRECTORY_INSPECTION' },
      );
    }
    if (!physical || !physical.startsWith(`${root}${sep}`))
      throw new IntegrationError(
        'E_INTEGRATION_GENERATOR_SELECTION',
        'Generator package escapes the target checkout.',
      );
    let scripts;
    try {
      scripts = JSON.parse(await readFile(join(physical, 'package.json'), 'utf8')).scripts ?? {};
    } catch (error) {
      throw new IntegrationError(
        'E_INTEGRATION_GENERATOR_SELECTION',
        'Generator package has no readable manifest.',
        { path: join(packagePath, 'package.json'), causeCode: error.code ?? 'E_MANIFEST_PARSE' },
      );
    }
    if (typeof scripts[script] !== 'string')
      throw new IntegrationError(
        'E_INTEGRATION_GENERATOR_SELECTION',
        'Generator script is not declared by its package.',
      );
    const outputs = outputPaths.map(safePath);
    for (const path of outputs) {
      if (
        !covers(packagePath, path) ||
        !scopePaths.some((rule) => covers(rule, path)) ||
        protectedPaths.some((rule) => covers(rule, path)) ||
        changedPaths.includes(path) ||
        allOutputs.has(path)
      ) {
        throw new IntegrationError(
          'E_INTEGRATION_GENERATOR_SELECTION',
          'Generated output overlaps protected, undeclared, or delegate-owned source.',
        );
      }
      const current = await captureFileState(root, path);
      const committed = await headFileState(root, path, 'HEAD');
      if (
        !sameGitState(
          await gitFileState(root, path, current),
          await gitFileState(root, path, committed),
        )
      )
        throw new IntegrationError(
          'E_INTEGRATION_GENERATOR_DRIFT',
          'Generated output has pre-existing local changes.',
          { path },
        );
      allOutputs.add(path);
    }
    generators.push({ packagePath, script, outputPaths: outputs });
  }
  return generators;
}

async function runGenerator(root, generator, timeoutMs) {
  const beforePaths = new Set([...(await workingPaths(root)), ...generator.outputPaths]);
  const before = new Map();
  for (const path of beforePaths) before.set(path, await captureFileState(root, path));
  const result = await executeCheck(
    root,
    {
      command: 'npm',
      args: ['run', generator.script],
      cwd: generator.packagePath,
      kind: 'generator',
    },
    timeoutMs ?? 120000,
    generator.home,
    generator.signal,
  );
  const candidates = new Set([...beforePaths, ...(await workingPaths(root))]);
  const changes = [];
  for (const path of candidates) {
    const prior = before.get(path) ?? (await headFileState(root, path, 'HEAD'));
    const after = await captureFileState(root, path);
    if (!sameState(prior, after)) changes.push({ path, before: prior, after });
  }
  return { passed: result.status === 'passed', result, changes };
}

async function workingSnapshot(root) {
  const paths = await workingPaths(root);
  const states = new Map();
  for (const path of paths) states.set(path, await captureFileState(root, path));
  return states;
}

async function changedSinceSnapshot(root, before) {
  const candidates = new Set([...before.keys(), ...(await workingPaths(root))]);
  const changes = [];
  for (const path of candidates) {
    const prior = before.get(path) ?? (await headFileState(root, path, 'HEAD'));
    const after = await captureFileState(root, path);
    if (!sameState(prior, after)) changes.push({ path, before: prior, after });
  }
  return changes;
}

function patchDigest(review) {
  return createHash('sha256').update(JSON.stringify(review.patch)).digest('hex');
}

async function createScratch(source) {
  const base = await mkdtemp(join(tmpdir(), 'planr-integration-'));
  await chmod(base, 0o700);
  const root = join(base, 'checkout');
  const home = join(base, 'home');
  await mkdir(root, { mode: 0o700 });
  await mkdir(home, { mode: 0o700 });
  try {
    const paths = (
      await git(source, 'ls-files', '-z', '--cached', '--others', '--exclude-standard')
    )
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
    for (const path of new Set(paths)) {
      const state = await captureFileState(source, safePath(path));
      await putState(root, path, state, randomUUID());
    }
    const env = executionEnvironment(home);
    await execFile('git', ['init', '-q'], { cwd: root, env });
    await execFile('git', ['-c', 'core.hooksPath=/dev/null', 'add', '--all'], { cwd: root, env });
    await execFile(
      'git',
      [
        '-c',
        'user.name=OpenPlanr',
        '-c',
        'user.email=delegate@localhost',
        '-c',
        'core.hooksPath=/dev/null',
        'commit',
        '-qm',
        'Integration baseline',
        '--allow-empty',
      ],
      { cwd: root, env },
    );
    // Dependencies are copied, never symlinked back to the owner's checkout.
    try {
      await cp(join(source, 'node_modules'), join(root, 'node_modules'), { recursive: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return { base, root, home };
  } catch (error) {
    await rm(base, { recursive: true, force: true });
    throw error;
  }
}

async function checkoutLock(root) {
  const path = join(
    tmpdir(),
    `planr-integration-lock-${createHash('sha256').update(root).digest('hex')}`,
  );
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'));
    if (!['exited', 'reused'].includes(await processIdentityState(owner)))
      throw new IntegrationError(
        'E_INTEGRATION_LOCKED',
        'Another integration holds this checkout.',
      );
    await rm(path, { recursive: true });
    await mkdir(path, { mode: 0o700 });
  }
  await writeFile(join(path, 'owner.json'), JSON.stringify(await processIdentity()), {
    flag: 'wx',
    mode: 0o600,
  });
  return () => rm(path, { recursive: true });
}

async function assertSafeChanges(root, changes) {
  for (const change of changes) {
    await safeDestination(root, change.path);
    const target = change.after?.target;
    if (
      change.after.kind === 'symlink' &&
      (typeof target !== 'string' ||
        isAbsolute(target) ||
        target.includes('\\') ||
        !resolve(dirname(resolve(root, change.path)), target).startsWith(`${resolve(root)}${sep}`))
    )
      throw new IntegrationError('E_INTEGRATION_LINK', 'Delegate symlink target is unsafe.', {
        path: change.path,
      });
  }
}

async function rollbackWritten(root, changes, suffix) {
  const errors = [];
  for (const change of [...changes].reverse()) {
    try {
      const current = await captureFileState(root, change.path);
      if (sameState(current, change.sourceBefore)) continue;
      if (!sameState(current, change.after)) {
        errors.push({ path: change.path, code: 'E_INTEGRATION_ROLLBACK_CONFLICT' });
        continue;
      }
      await putState(root, change.path, change.sourceBefore, suffix);
    } catch (error) {
      errors.push({ path: change.path, code: error.code ?? 'E_INTEGRATION_ROLLBACK' });
    }
  }
  return errors;
}

export async function integrateDelegateDelta({
  custody,
  run,
  scopePaths,
  preservePaths,
  capsule,
  checks,
  generators,
  timeoutMs,
  reviewedDigest,
  beforeApply,
  onProgress,
  onAccepted,
  onRolledBack,
} = {}) {
  const review = await reviewDelegateDelta({ custody, run, scopePaths, preservePaths });
  if (!review.ready)
    return {
      status: 'blocked',
      ...review,
      nextAction: 'Inspect the retained worktree and resolve the reported conflicts.',
    };
  if (reviewedDigest && reviewedDigest !== patchDigest(review))
    throw new IntegrationError(
      'E_INTEGRATION_REVIEW_DRIFT',
      'The delegate patch changed since review; review it again.',
    );
  const release = await checkoutLock(custody.repositoryRoot);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let scratch;
  const applied = [],
    createdDirectories = [],
    generatorRuns = [],
    generatedPaths = [];
  const delegatePaths = [...review.changedPaths];
  let results = [],
    failureCode,
    rollbackErrors = [];
  try {
    const selectedChecks = await resolveSelectedChecks(
      custody.repositoryRoot,
      checks,
      capsule,
      delegatePaths,
    );
    const protectedPaths = [...(custody.preservePaths ?? []), ...(preservePaths ?? [])].map(
      (entry) => safePath(typeof entry === 'string' ? entry : entry.path),
    );
    const selectedGenerators = await resolveSelectedGenerators(
      custody.repositoryRoot,
      generators,
      delegatePaths,
      scopePaths.map(safePath),
      protectedPaths,
    );
    await assertSafeChanges(custody.repositoryRoot, review.changes);
    scratch = await createScratch(custody.repositoryRoot);
    for (const change of review.changes)
      await putState(scratch.root, change.path, change.after, randomUUID());
    for (const generator of selectedGenerators) {
      const result = await runGenerator(
        scratch.root,
        { ...generator, home: scratch.home, signal: controller.signal },
        timeoutMs,
      );
      generatorRuns.push({
        packagePath: generator.packagePath,
        script: generator.script,
        ...result.result,
      });
      if (!result.passed)
        throw new IntegrationError('E_INTEGRATION_GENERATION', 'A declared generator failed.', {
          results: [result.result],
        });
      const unexpected = result.changes.filter(({ path }) => !generator.outputPaths.includes(path));
      if (unexpected.length) {
        review.violations.push(
          ...unexpected.map(({ path }) => ({ code: 'E_INTEGRATION_GENERATOR_SCOPE', path })),
        );
        throw new IntegrationError(
          'E_INTEGRATION_GENERATOR_SCOPE',
          'Generator changed undeclared files.',
        );
      }
      for (const change of result.changes) {
        const sourceBefore = await captureFileState(custody.repositoryRoot, change.path);
        generatedPaths.push(change.path);
        review.changedPaths.push(change.path);
        review.changes.push({ ...change, sourceBefore, origin: 'generator' });
        review.patch.push(change);
      }
    }
    const beforeChecks = await workingSnapshot(scratch.root);
    results = await runDelegateChecks({
      repositoryRoot: scratch.root,
      checks: selectedChecks,
      timeoutMs,
      home: scratch.home,
      signal: controller.signal,
    });
    const checkEffects = await changedSinceSnapshot(scratch.root, beforeChecks);
    if (checkEffects.length) {
      review.violations.push(
        ...checkEffects.map(({ path }) => ({ code: 'E_INTEGRATION_CHECK_SIDE_EFFECT', path })),
      );
      throw new IntegrationError(
        'E_INTEGRATION_CHECK_SIDE_EFFECT',
        'A check modified scratch repository files.',
      );
    }
    if (results.some((result) => result.status === 'timed-out'))
      throw new IntegrationError('E_INTEGRATION_CHECK_TIMEOUT', 'An independent check timed out.');
    if (results.some((result) => result.status === 'failed')) {
      for (const change of review.changes)
        await putState(scratch.root, change.path, change.before, randomUUID());
      const beforeBaseline = await workingSnapshot(scratch.root);
      const failing = selectedChecks.filter((check, index) => results[index]?.status === 'failed');
      const baseline = await runDelegateChecks({
        repositoryRoot: scratch.root,
        checks: failing,
        timeoutMs,
        home: scratch.home,
        signal: controller.signal,
      });
      const effects = await changedSinceSnapshot(scratch.root, beforeBaseline);
      let index = 0;
      results = results.map((result) => {
        if (result.status !== 'failed') return result;
        const baselineStatus = effects.length ? 'unverified' : baseline[index++].status;
        return {
          ...result,
          baselineStatus,
          classification:
            baselineStatus === 'failed'
              ? 'baseline-failure'
              : baselineStatus === 'passed'
                ? 'regression'
                : 'unverified',
        };
      });
      if (effects.length)
        review.violations.push(
          ...effects.map(({ path }) => ({ code: 'E_INTEGRATION_BASELINE_SIDE_EFFECT', path })),
        );
      throw new IntegrationError(
        effects.length ? 'E_INTEGRATION_BASELINE_SIDE_EFFECT' : 'E_INTEGRATION_CHECKS',
        'Independent checks failed.',
      );
    }
    if (controller.signal.aborted)
      throw new IntegrationError('E_INTEGRATION_INTERRUPTED', 'Integration was interrupted.');
    await assertSafeChanges(custody.repositoryRoot, review.changes);
    for (const change of review.changes) {
      if (
        !sameState(await captureFileState(custody.repositoryRoot, change.path), change.sourceBefore)
      )
        throw new IntegrationError(
          'E_INTEGRATION_SOURCE_DRIFT',
          'A destination changed while checks ran.',
          { path: change.path },
        );
      // Keep physical non-executable permissions; only the Git executable bit belongs to the delta.
      if (change.after.kind === 'file' && change.sourceBefore.kind === 'file') {
        change.after = {
          ...change.after,
          mode: (change.sourceBefore.mode & ~0o111) | (change.after.mode & 0o111),
        };
      }
    }
    const states = Object.fromEntries(
      review.changes.map(({ path, after }) => [path, compactIntegrationState(after)]),
    );
    const accepted = {
      delegatePaths,
      generatedPaths,
      changedPaths: review.changedPaths,
      states,
      checks: results,
      generators: generatorRuns,
    };
    await beforeApply?.({ ...accepted, changes: review.changes });
    for (const change of review.changes) {
      if (controller.signal.aborted)
        throw new IntegrationError('E_INTEGRATION_INTERRUPTED', 'Integration was interrupted.');
      if (
        !sameState(await captureFileState(custody.repositoryRoot, change.path), change.sourceBefore)
      )
        throw new IntegrationError(
          'E_INTEGRATION_SOURCE_DRIFT',
          'A destination changed during source writes.',
          { path: change.path },
        );
      // The journal records all intended states before this first write, including crash recovery.
      await onProgress?.(change.path, 'before');
      applied.push(change);
      await putState(
        custody.repositoryRoot,
        change.path,
        change.after,
        randomUUID(),
        createdDirectories,
      );
      await onProgress?.(change.path, 'after');
    }
    await onAccepted?.(accepted);
    return {
      status: 'completed',
      ...review,
      checks: results,
      generatedPaths,
      generators: generatorRuns,
      nextAction: 'Review the uncommitted local diff; worktree cleanup is a separate action.',
    };
  } catch (error) {
    if (
      [
        'E_INTEGRATION_CHECK_SELECTION',
        'E_INTEGRATION_GENERATOR_SELECTION',
        'E_INTEGRATION_GENERATOR_DRIFT',
      ].includes(error.code)
    )
      throw error;
    failureCode = error.code ?? 'E_INTEGRATION_APPLY';
    if (error.details?.path)
      review.violations.push({ code: failureCode, path: error.details.path });
    rollbackErrors = await rollbackWritten(custody.repositoryRoot, applied, randomUUID());
    for (const directory of createdDirectories.reverse()) {
      try {
        await rmdir(directory);
      } catch (cleanupError) {
        if (!['ENOTEMPTY', 'ENOENT'].includes(cleanupError.code))
          rollbackErrors.push({ path: directory, code: cleanupError.code });
      }
    }
    await onRolledBack?.({ rollbackErrors, code: failureCode });
    return {
      status: 'blocked',
      ...review,
      code: failureCode,
      checks: results,
      generatedPaths,
      generators: generatorRuns,
      rollbackErrors,
      nextAction: rollbackErrors.length
        ? 'Resolve the integration journal conflicts before continuing.'
        : failureCode === 'E_INTEGRATION_CHECK_TIMEOUT'
          ? 'Retry apply with a measured timeoutMs.'
          : 'Send the findings to the same delegate session for correction; the worktree remains available.',
    };
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (scratch) await rm(scratch.base, { recursive: true, force: true });
    await release();
  }
}

function publicReview(review) {
  return {
    ready: review.ready,
    changedPaths: review.changedPaths,
    violations: review.violations,
    patch: review.patch.map(({ path, before, after }) => ({
      path,
      before: { kind: before.kind, mode: before.mode ?? null, bytes: before.bytes ?? null },
      after: { kind: after.kind, mode: after.mode ?? null, bytes: after.bytes ?? null },
    })),
  };
}

async function privateCapsule(record) {
  if (!record.capsulePath?.startsWith(`${record.runPath}${sep}`)) {
    throw new IntegrationError('E_INTEGRATION_CAPSULE', 'Run capsule pointer is invalid.');
  }
  const info = await lstat(record.capsulePath);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 32 * 1024 * 1024) {
    throw new IntegrationError('E_INTEGRATION_CAPSULE', 'Run capsule is unsafe or oversized.');
  }
  const capsule = JSON.parse(await readFile(record.capsulePath, 'utf8'));
  if (capsule.kind !== 'openplanr-delegation-context-capsule') {
    throw new IntegrationError('E_INTEGRATION_CAPSULE', 'Run capsule has an unsupported format.');
  }
  return capsule;
}

export async function delegateIntegrationCommand(action, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !input.runId) {
    throw new IntegrationError('E_INTEGRATION_INPUT', 'A run identifier is required.');
  }
  if (!['review', 'apply', 'recover'].includes(action)) {
    throw new IntegrationError('E_INTEGRATION_COMMAND', 'Unknown integration action.');
  }
  const record = await readRunRecord(input.runId, { directory: input.runDirectory });
  const pinned = await verifiedHelper(record);
  if (pinned && resolve(fileURLToPath(import.meta.url)) !== pinned.integrationPath) {
    const module = await import(pathToFileURL(pinned.integrationPath).href);
    return module.delegateIntegrationCommand(action, input);
  }
  if (!pinned && action !== 'recover')
    throw new IntegrationError(
      'E_DELEGATE_HELPER_REQUIRED',
      'This record has no pinned helper; inspect it read-only and prepare a new run.',
    );
  return withRunTransitionLock(input.runId, { directory: input.runDirectory }, async () => {
    const current = await readRunRecord(input.runId, { directory: input.runDirectory });
    return integrationCommandLocked(action, input, current);
  });
}

async function writeJournal(path, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > 32 * 1024 * 1024)
    throw new IntegrationError(
      'E_INTEGRATION_JOURNAL_LIMIT',
      'Integration recovery states exceed the private limit.',
    );
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
  return createHash('sha256').update(bytes).digest('hex');
}

async function recoverIntegration(input, record) {
  const integration = record.integration;
  if (!['applying', 'interrupted'].includes(integration?.status))
    throw new IntegrationError('E_INTEGRATION_RECOVERY', 'This run has no unresolved integration.');
  if (integration.journalPath !== join(record.runPath, 'integration-journal.json'))
    throw new IntegrationError(
      'E_INTEGRATION_JOURNAL',
      'Integration recovery journal pointer is invalid.',
    );
  const details = await lstat(integration.journalPath);
  if (!details.isFile() || details.mode & 0o077 || details.size > 32 * 1024 * 1024)
    throw new IntegrationError('E_INTEGRATION_JOURNAL', 'Integration recovery journal is unsafe.');
  const bytes = await readFile(integration.journalPath);
  if (createHash('sha256').update(bytes).digest('hex') !== integration.journalDigest)
    throw new IntegrationError('E_INTEGRATION_JOURNAL', 'Integration recovery journal changed.');
  const journal = JSON.parse(bytes.toString('utf8'));
  if (journal.runId !== record.runId || journal.repositoryRoot !== record.repositoryRoot)
    throw new IntegrationError(
      'E_INTEGRATION_JOURNAL',
      'Integration recovery journal identity differs.',
    );
  const release = await checkoutLock(record.repositoryRoot);
  try {
    if (input.resolution === 'accept') {
      if (integration.cursor !== journal.changes.length || integration.pendingPath)
        throw new IntegrationError(
          'E_INTEGRATION_RECOVERY_INCOMPLETE',
          'Source writes did not complete; recover with rollback.',
        );
      for (const change of journal.changes) {
        if (!sameState(await captureFileState(record.repositoryRoot, change.path), change.after))
          throw new IntegrationError(
            'E_INTEGRATION_RECOVERY_CONFLICT',
            'Accepted source changed after interruption.',
            { path: change.path },
          );
      }
      await updateRunRecord(
        record.runId,
        { integration: { status: 'applied', at: new Date().toISOString(), ...journal.accepted } },
        { directory: input.runDirectory },
      );
      await closeRunRecord(record.runId, {
        disposition: 'integrated',
        directory: input.runDirectory,
      });
      return {
        runId: record.runId,
        status: 'completed',
        report: implementationReport({ status: 'completed', ...journal.accepted }, record.selector),
        recovered: 'accepted',
      };
    }
    if (input.resolution && input.resolution !== 'rollback')
      throw new IntegrationError(
        'E_INTEGRATION_RECOVERY',
        'Recovery resolution must be rollback or accept.',
      );
    const count = integration.cursor + (integration.pendingPath ? 1 : 0);
    const rollbackErrors = await rollbackWritten(
      record.repositoryRoot,
      journal.changes.slice(0, count),
      randomUUID(),
    );
    await updateRunRecord(
      record.runId,
      {
        integration: {
          ...integration,
          status: rollbackErrors.length ? 'interrupted' : 'rolled-back',
          rollbackErrors,
        },
      },
      { directory: input.runDirectory },
    );
    return {
      runId: record.runId,
      status: rollbackErrors.length ? 'blocked' : 'completed',
      recovered: rollbackErrors.length ? 'conflicts' : 'rolled-back',
      rollbackErrors,
      nextAction: rollbackErrors.length
        ? 'Preserve conflicting host edits and resolve the listed paths explicitly.'
        : 'Review the retained patch again before retrying apply.',
    };
  } finally {
    await release();
  }
}

async function integrationCommandLocked(action, input, record) {
  if (action === 'recover') return recoverIntegration(input, record);
  if (['applying', 'interrupted'].includes(record.integration?.status))
    throw new IntegrationError(
      'E_RUN_INTEGRATION_RECOVERY',
      'Integration is unresolved; use integrate recover before review or apply.',
    );
  if (action === 'apply' && record.integration?.status === 'applied') {
    throw new IntegrationError(
      'E_INTEGRATION_ALREADY_APPLIED',
      'This run has already been integrated; review later changes as separate work.',
    );
  }
  const scopePaths = input.scopePaths ?? record.integrationScopePaths;
  if (
    record.integrationScopePaths &&
    (!Array.isArray(scopePaths) ||
      scopePaths.some(
        (path) => !record.integrationScopePaths.some((recorded) => covers(recorded, path)),
      ))
  ) {
    throw new IntegrationError(
      'E_INTEGRATION_SCOPE_WIDENED',
      'Integration scope cannot exceed the paths previewed before dispatch.',
    );
  }
  const capsuleCheck = await validateDelegateCapsule({
    runId: input.runId,
    runDirectory: input.runDirectory,
  });
  if (!capsuleCheck.valid) {
    const blocked = {
      runId: input.runId,
      ...(action === 'apply' ? { status: 'blocked' } : {}),
      ready: false,
      changedPaths: [],
      violations: [
        { code: capsuleCheck.code, message: 'Prepared delegate context changed during the run.' },
      ],
      patch: [],
      ...(action === 'apply'
        ? {
            checks: [],
            code: capsuleCheck.code,
            nextAction:
              'Retain the worktree for review and prepare a new delegate run from trusted context.',
          }
        : {}),
    };
    return action === 'review'
      ? { ...blocked, presentation: reviewPresentation(blocked) }
      : { ...blocked, report: implementationReport(blocked) };
  }
  const custody = await readDelegateCustody({
    runId: input.runId,
    runDirectory: input.runDirectory,
  });
  const common = {
    custody,
    run: record,
    scopePaths,
    preservePaths: input.preservePaths,
  };
  if (action === 'review') {
    const observed = await reviewDelegateDelta(common);
    if (observed.ready)
      await updateRunRecord(
        input.runId,
        {
          reviewedPatch: {
            digest: patchDigest(observed),
            at: new Date().toISOString(),
            scopePaths,
          },
        },
        { directory: input.runDirectory },
      );
    const review = { runId: input.runId, ...publicReview(observed) };
    return { ...review, presentation: reviewPresentation(review) };
  }
  if (!record.reviewedPatch?.digest)
    throw new IntegrationError(
      'E_INTEGRATION_REVIEW_REQUIRED',
      'Review the exact delegate patch before apply.',
    );
  const capsule = await privateCapsule(record);
  const result = await integrateDelegateDelta({
    ...common,
    capsule,
    checks: input.checks,
    generators: input.generators,
    timeoutMs: input.timeoutMs,
    reviewedDigest: record.reviewedPatch.digest,
    beforeApply: async ({ changes, ...accepted }) => {
      assertRunRecordFits({
        ...record,
        integration: { status: 'applied', ...accepted },
        status: 'closed',
        disposition: 'integrated',
        closedAt: new Date().toISOString(),
      });
      const journalPath = join(record.runPath, 'integration-journal.json');
      const journalDigest = await writeJournal(journalPath, {
        schemaVersion: '1.0.0',
        runId: record.runId,
        repositoryRoot: record.repositoryRoot,
        changes,
        accepted,
      });
      await updateRunRecord(
        record.runId,
        {
          integration: {
            status: 'applying',
            phase: 'source-write',
            journalPath,
            journalDigest,
            changedPaths: accepted.changedPaths,
            cursor: 0,
            pendingPath: null,
          },
        },
        { directory: input.runDirectory },
      );
    },
    onProgress: async (path, phase) => {
      const current = await readRunRecord(record.runId, { directory: input.runDirectory });
      await updateRunRecord(
        record.runId,
        {
          integration: {
            ...current.integration,
            cursor: current.integration.cursor + (phase === 'after' ? 1 : 0),
            pendingPath: phase === 'before' ? path : null,
          },
        },
        { directory: input.runDirectory },
      );
    },
    onAccepted: async (integration) =>
      updateRunRecord(
        input.runId,
        {
          integration: { status: 'applied', at: new Date().toISOString(), ...integration },
        },
        { directory: input.runDirectory },
      ),
    onRolledBack: async ({ rollbackErrors, code }) => {
      const current = await readRunRecord(record.runId, { directory: input.runDirectory });
      if (current.integration?.status !== 'applying') return;
      await updateRunRecord(
        record.runId,
        {
          integration: {
            ...current.integration,
            status: rollbackErrors.length ? 'interrupted' : 'rolled-back',
            rollbackErrors,
            code,
          },
        },
        { directory: input.runDirectory },
      );
    },
  });
  const output = {
    runId: input.runId,
    status: result.status,
    ...publicReview(result),
    checks: result.checks ?? [],
    generatedPaths: result.generatedPaths ?? [],
    generators: result.generators ?? [],
    code: result.code ?? null,
    rollbackErrors: result.rollbackErrors ?? [],
    nextAction: result.nextAction,
  };
  if (result.status === 'completed') {
    await closeRunRecord(input.runId, { disposition: 'integrated', directory: input.runDirectory });
  }
  return {
    ...output,
    planning: record.planning ? { ...record.planning, status: 'not-updated' } : null,
    report: implementationReport(output, capsule.selector),
  };
}

if (
  process.argv[1] &&
  existsSync(resolve(process.argv[1])) &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
) {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 64 * 1024)
        throw new IntegrationError('E_INTEGRATION_INPUT', 'Command input is oversized.');
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    process.stdout.write(
      `${JSON.stringify(await delegateIntegrationCommand(process.argv[2], input))}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        code: typeof error?.code === 'string' ? error.code : 'E_INTEGRATION_UNKNOWN',
        message:
          typeof error?.code === 'string'
            ? error.message
            : 'Integration failed; inspect retained custody.',
        ...(error.details ? { details: error.details } : {}),
      })}\n`,
    );
    process.exitCode = 1;
  }
}
