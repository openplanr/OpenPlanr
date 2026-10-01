import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { invokeProcess } from './adapters/generic.mjs';
import { assertCredentialFreeText } from './context.mjs';
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

export async function resolveSelectedChecks(repositoryRoot, supplied, { legacy = false } = {}) {
  // Discovery is advice. Only the parent's explicit structured selection executes.
  if (supplied === undefined) return [];
  if (!Array.isArray(supplied) || supplied.length > 32)
    throw new IntegrationError(
      'E_INTEGRATION_CHECK_SELECTION',
      'Select at most 32 structured commands.',
    );
  const root = await realpath(repositoryRoot);
  const checks = [];
  for (let entry of supplied) {
    if (legacy) {
      const parsed = parseCheck(
        typeof entry === 'string' ? entry : [entry.command, ...(entry.args ?? [])].join(' '),
      );
      if (!parsed)
        throw new IntegrationError(
          'E_INTEGRATION_CHECK_SELECTION',
          'Experimental protocol v1 checks require a declared npm script or relative Node test.',
        );
      entry = {
        executable: parsed.command,
        args: parsed.args,
        cwd: entry?.cwd ?? '.',
        kind: parsed.kind,
      };
    }
    const executable = entry?.executable;
    const args = entry?.args;
    if (
      !entry ||
      typeof executable !== 'string' ||
      !executable ||
      executable.length > 512 ||
      /[\r\n\0]/u.test(executable) ||
      !Array.isArray(args) ||
      args.length > 128 ||
      args.some((arg) => typeof arg !== 'string' || arg.length > 4096 || /[\0]/u.test(arg))
    )
      throw new IntegrationError(
        'E_INTEGRATION_CHECK_SELECTION',
        'Use { executable, args, cwd, timeoutMs? }; shell command strings are not accepted.',
      );
    assertCredentialFreeText(JSON.stringify({ executable, args }), {
      code: 'E_INTEGRATION_CHECK_SELECTION',
      label: 'Command arguments',
    });
    const cwd = entry.cwd ?? '.';
    if (typeof cwd !== 'string' || isAbsolute(cwd) || cwd.includes('\0'))
      throw new IntegrationError(
        'E_INTEGRATION_CHECK_SELECTION',
        'Command cwd must resolve inside the candidate.',
      );
    const physical = await realpath(resolve(root, cwd)).catch((error) => {
      throw new IntegrationError(
        'E_INTEGRATION_CHECK_SELECTION',
        'Command directory cannot be inspected.',
        { path: cwd, causeCode: error.code },
      );
    });
    if (physical !== root && !physical.startsWith(`${root}${sep}`))
      throw new IntegrationError(
        'E_INTEGRATION_CHECK_SELECTION',
        'Command cwd escapes the candidate.',
      );
    if (
      entry.timeoutMs !== undefined &&
      (!Number.isSafeInteger(entry.timeoutMs) ||
        entry.timeoutMs < 1 ||
        entry.timeoutMs > 4 * 3600000)
    )
      throw new IntegrationError(
        'E_INTEGRATION_CHECK_SELECTION',
        'Command deadline must be between 1 ms and 4 hours.',
      );
    if (legacy && executable === 'npm') {
      const manifest = JSON.parse(await readFile(join(physical, 'package.json'), 'utf8'));
      if (typeof manifest.scripts?.[args[1]] !== 'string')
        throw new IntegrationError(
          'E_INTEGRATION_CHECK_SELECTION',
          'Legacy npm script is not declared.',
        );
    }
    const check = {
      executable,
      command: executable,
      args: [...args],
      cwd,
      kind: entry.kind ?? 'focused',
      ...(entry.timeoutMs ? { timeoutMs: entry.timeoutMs } : {}),
    };
    if (!checks.some((other) => JSON.stringify(other) === JSON.stringify(check)))
      checks.push(check);
  }
  return checks;
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

export function executionEnvironment() {
  // Parent-selected checks run under the parent host's normal execution controls.
  return { ...process.env };
}

function privateDiagnostic(text) {
  const bounded = Buffer.from(text ?? '')
    .subarray(-4096)
    .toString('utf8');
  try {
    assertCredentialFreeText(bounded, { label: 'Check output' });
    return bounded;
  } catch {
    return 'Output omitted because it contained credential material.';
  }
}

async function executeCheck(root, check, timeoutMs, home, signal, onProcess) {
  const start = Date.now();
  const startedAt = new Date(start).toISOString();
  const timing = () => ({
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  });
  const command = `${check.cwd && check.cwd !== '.' ? `${check.cwd}: ` : ''}${[check.command, ...check.args].join(' ')}`;
  try {
    if (check.executable) await resolveSelectedChecks(root, [check]);
    const result = await invokeProcess(check.command, check.args, {
      cwd: resolve(root, check.cwd ?? '.'),
      timeoutMs: check.timeoutMs ?? timeoutMs,
      env: executionEnvironment(home),
      signal,
      onProcess,
      retainStdout: true,
      captureStderr: true,
      withExitCode: true,
      maxOutputBytes: 8 * 1024 * 1024,
    });
    return {
      command,
      executable: check.executable ?? check.command,
      args: check.args,
      cwd: check.cwd ?? '.',
      kind: check.kind,
      status: result.exitCode === 0 ? 'passed' : 'failed',
      exitCode: result.exitCode,
      signal: result.signal,
      ...(result.exitCode ? { diagnostic: privateDiagnostic(result.output) } : {}),
      ...timing(),
    };
  } catch (error) {
    const timedOut = error.code === 'E_ADAPTER_TIMEOUT';
    return {
      command,
      executable: check.executable ?? check.command,
      args: check.args,
      cwd: check.cwd ?? '.',
      kind: check.kind,
      status: timedOut ? 'timed-out' : 'failed',
      code: error.code ?? 'E_INTEGRATION_CHECK',
      exitCode: error.details?.exitCode ?? null,
      signal: error.details?.signal ?? null,
      diagnostic: privateDiagnostic(error.details?.output ?? error.message),
      processTerminationConfirmed: error.processTerminationConfirmed !== false,
      ...(timedOut ? { timeoutMs: check.timeoutMs ?? timeoutMs } : {}),
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
  onProcess,
  stopOnFailure = false,
} = {}) {
  const results = [];
  for (const check of checks) {
    if (signal?.aborted)
      throw new IntegrationError('E_INTEGRATION_INTERRUPTED', 'Integration was interrupted.');
    const result = await executeCheck(repositoryRoot, check, timeoutMs, home, signal, onProcess);
    if (result.processTerminationConfirmed !== false) await onProcess?.(null);
    results.push(result);
    await onResult?.(result, results);
    if (
      result.processTerminationConfirmed === false ||
      (stopOnFailure && result.status !== 'passed')
    )
      break;
  }
  return results;
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
    generator.onProcess,
  );
  if (result.processTerminationConfirmed !== false) await generator.onProcess?.(null);
  const candidates = new Set([...beforePaths, ...(await workingPaths(root))]);
  const changes = [];
  for (const path of candidates) {
    const prior = before.get(path) ?? (await headFileState(root, path, 'HEAD'));
    const after = await captureFileState(root, path);
    if (!sameState(prior, after)) changes.push({ path, before: prior, after });
  }
  return { passed: result.status === 'passed', result, changes };
}
