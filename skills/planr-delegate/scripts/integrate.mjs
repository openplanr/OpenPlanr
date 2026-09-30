import { execFile as execFileCallback } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rmdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { captureFileState, validateWorktreeCustody } from './custody.mjs';
import { closeRunRecord, compactIntegrationState, readRunRecord, updateRunRecord } from './run-record.mjs';
import { verifiedHelper } from './helper-snapshot.mjs';
import { readDelegateCustody, validateDelegateCapsule } from './runner.mjs';
import { implementationReport, reviewPresentation } from './presentation.mjs';

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
    if (sameState(before, after)) continue;
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
    if (!sameState(sourceBefore, sourceNow))
      violations.push({ code: 'E_INTEGRATION_SOURCE_DRIFT', path });
    changes.push({ path, before, after, sourceBefore });
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
      if (isAbsolute(state.target) || state.target.split('/').includes('..'))
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
    words.slice(2).every((part) => /^[A-Za-z0-9_./*-]+$/u.test(part) &&
      !part.split('/').includes('..') && !part.startsWith('-')) &&
    words.length > 2
  )
    return { command: 'node', args: words.slice(1), kind: 'focused' };
  return null;
}

async function resolveSelectedChecks(repositoryRoot, supplied, capsule, changedPaths) {
  if (supplied === undefined)
    return discoverDelegateChecks({ repositoryRoot, capsule, changedPaths });
  if (!Array.isArray(supplied) || supplied.length > 16)
    throw new IntegrationError('E_INTEGRATION_CHECK_SELECTION', 'Choose at most 16 explicit checks.');
  const checks = [];
  for (const entry of supplied) {
    const text = typeof entry === 'string' ? entry : Array.isArray(entry?.args)
      ? [entry.command, ...entry.args].join(' ') : entry?.command;
    const cwd = typeof entry === 'string' ? '.' : entry?.cwd ?? '.';
    const check = parseCheck(text);
    if (!check || (cwd !== '.' && (typeof cwd !== 'string' || !/^[A-Za-z0-9_./-]+$/u.test(cwd))))
      throw new IntegrationError('E_INTEGRATION_CHECK_SELECTION', 'Checks must be simple npm run or node --test commands with a safe package directory.');
    const relativeCwd = cwd === '.' ? '.' : safePath(cwd);
    const physical = await realpath(resolve(repositoryRoot, relativeCwd)).catch(() => null);
    if (!physical || (physical !== repositoryRoot && !physical.startsWith(`${repositoryRoot}${sep}`)))
      throw new IntegrationError('E_INTEGRATION_CHECK_SELECTION', 'Check directory must be inside the target checkout.');
    if (check.command === 'npm') {
      let scripts;
      try {
        scripts = JSON.parse(await readFile(join(physical, 'package.json'), 'utf8')).scripts ?? {};
      } catch {
        throw new IntegrationError('E_INTEGRATION_CHECK_SELECTION', 'Selected npm check has no readable package manifest.');
      }
      if (typeof scripts[check.args[1]] !== 'string')
        throw new IntegrationError('E_INTEGRATION_CHECK_SELECTION', 'Selected npm check is not declared by its package.');
    }
    checks.push({ ...check, cwd: relativeCwd });
  }
  return checks.filter((check, index, all) => all.findIndex((other) =>
    other.cwd === check.cwd && other.command === check.command && other.args.join(' ') === check.args.join(' ')) === index);
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

export async function runDelegateChecks({ repositoryRoot, checks, timeoutMs = 600000 } = {}) {
  const results = [];
  for (const check of checks) {
    const startedAt = new Date().toISOString();
    try {
      await execFile(check.command, check.args, {
        cwd: resolve(repositoryRoot, check.cwd ?? '.'),
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        env: process.env,
      });
      results.push({
        command: `${check.cwd && check.cwd !== '.' ? `${check.cwd}: ` : ''}${[check.command, ...check.args].join(' ')}`,
        kind: check.kind,
        status: 'passed',
        startedAt,
      });
    } catch (error) {
      const timedOut = error.killed === true || error.code === 'ETIMEDOUT';
      results.push({
        command: `${check.cwd && check.cwd !== '.' ? `${check.cwd}: ` : ''}${[check.command, ...check.args].join(' ')}`,
        kind: check.kind,
        status: timedOut ? 'timed-out' : 'failed',
        exitCode: timedOut ? null : error.code ?? null,
        ...(timedOut ? { timeoutMs } : {}),
        startedAt,
      });
    }
  }
  return results;
}

async function workingPaths(root) {
  const [tracked, untracked] = await Promise.all([
    git(root, 'diff', '--name-only', '-z', 'HEAD'),
    git(root, 'ls-files', '--others', '--exclude-standard', '-z'),
  ]);
  return [...new Set([...tracked.toString('utf8').split('\0'), ...untracked.toString('utf8').split('\0')]
    .filter(Boolean).map(safePath))].sort();
}

async function resolveSelectedGenerators(root, supplied, changedPaths, scopePaths, protectedPaths) {
  if (supplied === undefined) return [];
  if (!Array.isArray(supplied) || supplied.length > 4)
    throw new IntegrationError('E_INTEGRATION_GENERATOR_SELECTION', 'Choose at most four package generators.');
  const generators = [];
  const allOutputs = new Set();
  for (const entry of supplied) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new IntegrationError('E_INTEGRATION_GENERATOR_SELECTION', 'A generator needs a package path, script, and exact output paths.');
    const packagePath = safePath(entry.packagePath);
    const script = entry.script;
    const outputPaths = entry.outputPaths;
    if (!packagePath.startsWith('packages/') || !changedPaths.some((path) => covers(packagePath, path)) ||
      typeof script !== 'string' || !/^generate(?::[A-Za-z0-9:._-]+)?$/u.test(script) ||
      !Array.isArray(outputPaths) || outputPaths.length === 0 || outputPaths.length > 32) {
      throw new IntegrationError('E_INTEGRATION_GENERATOR_SELECTION', 'Generator must belong to the changed package and declare its outputs.');
    }
    const physical = await realpath(resolve(root, packagePath)).catch(() => null);
    if (!physical || !physical.startsWith(`${root}${sep}`))
      throw new IntegrationError('E_INTEGRATION_GENERATOR_SELECTION', 'Generator package escapes the target checkout.');
    let scripts;
    try {
      scripts = JSON.parse(await readFile(join(physical, 'package.json'), 'utf8')).scripts ?? {};
    } catch {
      throw new IntegrationError('E_INTEGRATION_GENERATOR_SELECTION', 'Generator package has no readable manifest.');
    }
    if (typeof scripts[script] !== 'string')
      throw new IntegrationError('E_INTEGRATION_GENERATOR_SELECTION', 'Generator script is not declared by its package.');
    const outputs = outputPaths.map(safePath);
    for (const path of outputs) {
      if (!covers(packagePath, path) || !scopePaths.some((rule) => covers(rule, path)) ||
        protectedPaths.some((rule) => covers(rule, path)) || changedPaths.includes(path) || allOutputs.has(path)) {
        throw new IntegrationError('E_INTEGRATION_GENERATOR_SELECTION', 'Generated output overlaps protected, undeclared, or delegate-owned source.');
      }
      const current = await captureFileState(root, path);
      const committed = await headFileState(root, path, 'HEAD');
      if (!sameState(current, committed))
        throw new IntegrationError('E_INTEGRATION_GENERATOR_DRIFT', 'Generated output has pre-existing local changes.', { path });
      allOutputs.add(path);
    }
    generators.push({ packagePath, script, outputPaths: outputs });
  }
  return generators;
}

async function runGenerator(root, generator, timeoutMs) {
  const beforePaths = new Set([...await workingPaths(root), ...generator.outputPaths]);
  const before = new Map();
  for (const path of beforePaths) before.set(path, await captureFileState(root, path));
  let passed = true;
  try {
    await execFile('npm', ['run', generator.script], {
      cwd: resolve(root, generator.packagePath), timeout: timeoutMs ?? 120000,
      maxBuffer: 8 * 1024 * 1024, env: process.env,
    });
  } catch {
    passed = false;
  }
  const candidates = new Set([...beforePaths, ...await workingPaths(root)]);
  const changes = [];
  for (const path of candidates) {
    const prior = before.get(path) ?? await headFileState(root, path, 'HEAD');
    const after = await captureFileState(root, path);
    if (!sameState(prior, after)) changes.push({ path, before: prior, after });
  }
  return { passed, changes };
}

async function workingSnapshot(root) {
  const paths = await workingPaths(root);
  const states = new Map();
  for (const path of paths) states.set(path, await captureFileState(root, path));
  return states;
}

async function changedSinceSnapshot(root, before) {
  const candidates = new Set([...before.keys(), ...await workingPaths(root)]);
  const changes = [];
  for (const path of candidates) {
    const prior = before.get(path) ?? await headFileState(root, path, 'HEAD');
    const after = await captureFileState(root, path);
    if (!sameState(prior, after)) changes.push({ path, before: prior, after });
  }
  return changes;
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
  injectFailureAt,
  onAccepted,
} = {}) {
  const review = await reviewDelegateDelta({ custody, run, scopePaths, preservePaths });
  if (!review.ready)
    return {
      status: 'blocked',
      ...review,
      nextAction: 'Inspect the retained worktree and resolve the reported conflicts.',
    };
  const delegatePaths = [...review.changedPaths];
  const selectedChecks = await resolveSelectedChecks(custody.repositoryRoot, checks, capsule, delegatePaths);
  const protectedPaths = [...(custody.preservePaths ?? []), ...(preservePaths ?? [])]
    .map((entry) => safePath(typeof entry === 'string' ? entry : entry.path));
  const selectedGenerators = await resolveSelectedGenerators(custody.repositoryRoot, generators,
    delegatePaths, scopePaths.map(safePath), protectedPaths);
  const applied = [];
  const createdDirectories = [];
  const generatorRollbacks = [];
  const checkRollbacks = [];
  const generatorRuns = [];
  const generatedPaths = [];
  const suffix = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    for (const [index, change] of review.changes.entries()) {
      const current = await captureFileState(custody.repositoryRoot, change.path);
      if (!sameState(current, change.sourceBefore))
        throw new IntegrationError(
          'E_INTEGRATION_SOURCE_DRIFT',
          'Source changed during integration.',
          { path: change.path },
        );
      await putState(custody.repositoryRoot, change.path, change.after, suffix, createdDirectories);
      applied.push(change);
      if (index === injectFailureAt)
        throw new IntegrationError(
          'E_INTEGRATION_APPLY',
          'Injected apply failure for recovery test.',
        );
    }
    for (const generator of selectedGenerators) {
      const result = await runGenerator(custody.repositoryRoot, generator, timeoutMs);
      generatorRollbacks.push(result.changes);
      generatorRuns.push({ packagePath: generator.packagePath, script: generator.script,
        status: result.passed ? 'passed' : 'failed' });
      if (!result.passed)
        throw new IntegrationError('E_INTEGRATION_GENERATION', 'A declared package generator failed.');
      const unexpected = result.changes.filter(({ path }) => !generator.outputPaths.includes(path));
      if (unexpected.length) {
        review.violations.push(...unexpected.map(({ path }) => ({ code: 'E_INTEGRATION_GENERATOR_SCOPE', path })));
        throw new IntegrationError('E_INTEGRATION_GENERATOR_SCOPE', 'Generator changed undeclared files.');
      }
      for (const change of result.changes) {
        generatedPaths.push(change.path);
        review.changedPaths.push(change.path);
        review.changes.push({ ...change, sourceBefore: change.before, origin: 'generator' });
        review.patch.push(change);
      }
    }
    const beforeChecks = await workingSnapshot(custody.repositoryRoot);
    const results = await runDelegateChecks({
      repositoryRoot: custody.repositoryRoot,
      checks: selectedChecks,
      timeoutMs,
    });
    const checkEffects = await changedSinceSnapshot(custody.repositoryRoot, beforeChecks);
    checkRollbacks.push(checkEffects);
    if (checkEffects.length) {
      review.violations.push(...checkEffects.map(({ path }) => ({ code: 'E_INTEGRATION_CHECK_SIDE_EFFECT', path })));
      throw new IntegrationError('E_INTEGRATION_CHECK_SIDE_EFFECT', 'A check modified repository files.', { results });
    }
    if (results.some((result) => result.status === 'timed-out'))
      throw new IntegrationError('E_INTEGRATION_CHECK_TIMEOUT', 'An independent check timed out.', { results });
    if (results.some((result) => result.status === 'failed'))
      throw new IntegrationError('E_INTEGRATION_CHECKS', 'Independent checks failed.', { results });
    if (onAccepted) {
      const states = {};
      for (const path of review.changedPaths)
        states[path] = compactIntegrationState(await captureFileState(custody.repositoryRoot, path));
      await onAccepted({ delegatePaths, generatedPaths, changedPaths: review.changedPaths,
        states, checks: results, generators: generatorRuns });
    }
    return {
      status: 'completed',
      ...review,
      checks: results,
      generatedPaths,
      generators: generatorRuns,
      nextAction: 'Review the uncommitted local diff.',
    };
  } catch (error) {
    const rollbackErrors = [];
    for (const changes of checkRollbacks.reverse()) {
      for (const change of changes.reverse()) {
        try {
          await putState(custody.repositoryRoot, change.path, change.before,
            `${suffix}-check-rollback`);
        } catch (rollbackError) {
          rollbackErrors.push({ path: change.path, code: rollbackError.code ?? 'E_ROLLBACK' });
        }
      }
    }
    for (const changes of generatorRollbacks.reverse()) {
      for (const change of changes.reverse()) {
        try {
          await putState(custody.repositoryRoot, change.path, change.before,
            `${suffix}-generator-rollback`);
        } catch (rollbackError) {
          rollbackErrors.push({ path: change.path, code: rollbackError.code ?? 'E_ROLLBACK' });
        }
      }
    }
    for (const change of applied.reverse()) {
      try {
        await putState(
          custody.repositoryRoot,
          change.path,
          change.sourceBefore,
          `${suffix}-rollback`,
        );
      } catch (rollbackError) {
        rollbackErrors.push({ path: change.path, code: rollbackError.code ?? 'E_ROLLBACK' });
      }
    }
    for (const directory of createdDirectories.reverse()) {
      try {
        await rmdir(directory);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOTEMPTY' && cleanupError.code !== 'ENOENT')
          rollbackErrors.push({
            path: directory,
            code: cleanupError.code ?? 'E_ROLLBACK_DIRECTORY',
          });
      }
    }
    let checkResults = error.details?.results ?? [];
    let failureCode = error.code ?? 'E_INTEGRATION_APPLY';
    if (error.code === 'E_INTEGRATION_CHECKS' && rollbackErrors.length === 0) {
      const failing = selectedChecks.filter((check, index) => checkResults[index]?.status === 'failed');
      const beforeBaseline = await workingSnapshot(custody.repositoryRoot);
      const baseline = await runDelegateChecks({ repositoryRoot: custody.repositoryRoot,
        checks: failing, timeoutMs });
      const baselineEffects = await changedSinceSnapshot(custody.repositoryRoot, beforeBaseline);
      for (const change of baselineEffects.reverse()) {
        try {
          await putState(custody.repositoryRoot, change.path, change.before,
            `${suffix}-baseline-rollback`);
        } catch (rollbackError) {
          rollbackErrors.push({ path: change.path, code: rollbackError.code ?? 'E_ROLLBACK' });
        }
      }
      if (baselineEffects.length) {
        failureCode = 'E_INTEGRATION_BASELINE_SIDE_EFFECT';
        review.violations.push(...baselineEffects.map(({ path }) =>
          ({ code: failureCode, path })));
      }
      let failureIndex = 0;
      checkResults = checkResults.map((result) => {
        if (result.status !== 'failed') return result;
        const baselineStatus = baselineEffects.length ? 'unverified' : baseline[failureIndex].status;
        failureIndex += 1;
        return { ...result, baselineStatus,
          classification: baselineStatus === 'unverified' ? 'unverified'
            : baselineStatus === 'failed' ? 'baseline-failure' : 'regression' };
      });
    }
    return {
      status: 'blocked',
      ...review,
      code: failureCode,
      checks: checkResults,
      generatedPaths,
      generators: generatorRuns,
      rollbackErrors,
      nextAction: rollbackErrors.length
        ? 'Recover the listed source paths from the retained worktree and backup state before continuing.'
        : failureCode === 'E_INTEGRATION_CHECK_TIMEOUT'
          ? 'Retry apply with a timeoutMs based on the measured check duration; the worktree remains available.'
        : 'Send the findings to the same delegate session for correction; the worktree remains available.',
    };
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
  if (!['review', 'apply'].includes(action)) {
    throw new IntegrationError('E_INTEGRATION_COMMAND', 'Unknown integration action.');
  }
  const record = await readRunRecord(input.runId, { directory: input.runDirectory });
  const pinned = await verifiedHelper(record);
  if (pinned && resolve(fileURLToPath(import.meta.url)) !== pinned.integrationPath) {
    const module = await import(pathToFileURL(pinned.integrationPath).href);
    return module.delegateIntegrationCommand(action, input);
  }
  if (action === 'apply' && record.integration?.status === 'applied') {
    throw new IntegrationError('E_INTEGRATION_ALREADY_APPLIED',
      'This run has already been integrated; review later changes as separate work.');
  }
  const scopePaths = input.scopePaths ?? record.integrationScopePaths;
  if (record.integrationScopePaths &&
    (!Array.isArray(scopePaths) || scopePaths.some((path) =>
      !record.integrationScopePaths.some((recorded) => covers(recorded, path))))) {
    throw new IntegrationError('E_INTEGRATION_SCOPE_WIDENED',
      'Integration scope cannot exceed the paths previewed before dispatch.');
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
      violations: [{ code: capsuleCheck.code, message: 'Prepared delegate context changed during the run.' }],
      patch: [],
      ...(action === 'apply'
        ? {
            checks: [],
            code: capsuleCheck.code,
            nextAction: 'Retain the worktree for review and prepare a new delegate run from trusted context.',
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
    const review = { runId: input.runId, ...publicReview(await reviewDelegateDelta(common)) };
    return { ...review, presentation: reviewPresentation(review) };
  }
  const capsule = await privateCapsule(record);
  const result = await integrateDelegateDelta({
    ...common,
    capsule,
    checks: input.checks,
    generators: input.generators,
    timeoutMs: input.timeoutMs,
    onAccepted: async (integration) => updateRunRecord(input.runId, {
      integration: { status: 'applied', at: new Date().toISOString(), ...integration },
    }, { directory: input.runDirectory }),
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

if (process.argv[1] && existsSync(resolve(process.argv[1])) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
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
      })}\n`,
    );
    process.exitCode = 1;
  }
}
