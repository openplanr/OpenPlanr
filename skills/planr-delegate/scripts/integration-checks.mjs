import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { invokeProcess } from './adapters/generic.mjs';
import { captureFileState, gitFileState, headFileState, sameGitState } from './custody.mjs';
import {
  covers,
  IntegrationError,
  safePath,
  sameState,
  workingPaths,
} from './integration-files.mjs';

function safeCheckArgument(value) {
  // File selectors only: runner flags, shell fragments and traversal are not accepted.
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9_./*-]+$/u.test(value) &&
    !value.startsWith('-') &&
    !value.startsWith('/') &&
    !value.split('/').includes('..')
  );
}

function parseCheck(raw) {
  if (typeof raw !== 'string' || raw.length > 512 || /[\r\n\0]/u.test(raw)) return null;
  const words = raw.trim().split(/\s+/u);
  if (
    words[0] === 'npm' &&
    words[1] === 'run' &&
    /^[a-zA-Z0-9:._-]+$/u.test(words[2] ?? '') &&
    (words.length === 3 ||
      (words[3] === '--' && words.length > 4 && words.slice(4).every(safeCheckArgument)))
  )
    return {
      command: 'npm',
      args: words.slice(1),
      kind: words[2].includes('test') ? 'focused' : 'regression',
    };
  if (
    words[0] === 'node' &&
    words[1] === '--test' &&
    words.slice(2).every(safeCheckArgument) &&
    words.length > 2
  )
    return { command: 'node', args: words.slice(1), kind: 'focused' };
  return null;
}

export async function resolveSelectedChecks(repositoryRoot, supplied, capsule, changedPaths) {
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

export function executionEnvironment(home) {
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
  const start = Date.now();
  const startedAt = new Date(start).toISOString();
  const timing = () => ({
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  });
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
      exitCode: result.exitCode,
      signal: result.signal,
      ...timing(),
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
      ...timing(),
    };
  }
}

export async function runDelegateChecks({
  repositoryRoot,
  checks,
  timeoutMs = 600000,
  home,
  signal,
  onResult,
  stopOnFailure = false,
} = {}) {
  const ownedHome = home ? null : await mkdtemp(join(tmpdir(), 'planr-check-home-'));
  try {
    const results = [];
    for (const check of checks) {
      if (signal?.aborted)
        throw new IntegrationError('E_INTEGRATION_INTERRUPTED', 'Integration was interrupted.');
      const result = await executeCheck(
        repositoryRoot,
        check,
        timeoutMs,
        home ?? ownedHome,
        signal,
      );
      results.push(result);
      await onResult?.(result, results);
      if (stopOnFailure && result.status !== 'passed') break;
    }
    return results;
  } finally {
    if (ownedHome) await rm(ownedHome, { recursive: true, force: true });
  }
}

export async function resolveSelectedGenerators(
  root,
  supplied,
  changedPaths,
  scopePaths,
  protectedPaths,
) {
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
    if (!physical?.startsWith(`${root}${sep}`))
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

export async function runGenerator(root, generator, timeoutMs) {
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
