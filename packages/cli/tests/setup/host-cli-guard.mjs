/**
 * Blocks tests from spawning a real host CLI from the developer's PATH.
 * A host command that resolves outside the temporary directory is redirected to a missing
 * path, so it fails with ENOENT, and is appended to the log in `OPENPLANR_TEST_HOST_GUARD_LOG`.
 */
import childProcess from 'node:child_process';
import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const HOST_GUARD_LOG = 'OPENPLANR_TEST_HOST_GUARD_LOG';
export const GUARDED_COMMANDS = Object.freeze([
  'agent',
  'claude',
  'codex',
  'cursor',
  'cursor-agent',
  'gh',
]);

const INSTALLED = Symbol.for('openplanr.test.hostCliGuard');
const windows = process.platform === 'win32';
const stubRoot = realpathSync(process.env.OPENPLANR_TEST_HOST_GUARD_ROOT || tmpdir());

function commandName(command) {
  const name = basename(command).toLowerCase();
  return windows ? name.replace(/\.(exe|cmd|bat|com)$/u, '') : name;
}

function executable(file) {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, windows ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCommand(command, env, cwd) {
  if (command.includes('/') || (windows && command.includes('\\'))) {
    const file = resolve(cwd ?? process.cwd(), command);
    return executable(file) ? file : null;
  }
  const extensions = windows ? ['', ...(env?.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')] : [''];
  const candidates = (env?.PATH ?? env?.Path ?? '')
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      extensions.map((extension) =>
        resolve(cwd ?? process.cwd(), directory, `${command}${extension}`),
      ),
    );
  return candidates.find(executable) ?? null;
}

function insideStubRoot(file) {
  let directory;
  try {
    directory = dirname(realpathSync(file));
  } catch {
    return false;
  }
  const path = relative(stubRoot, directory);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function optionsOf(args) {
  for (const candidate of args.slice(1, 3)) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate;
  }
  return {};
}

function guardedCommand(args) {
  const [command] = args;
  if (typeof command !== 'string') return args;
  const options = optionsOf(args);
  if (options.shell || !GUARDED_COMMANDS.includes(commandName(command))) return args;
  const found = resolveCommand(command, options.env ?? process.env, options.cwd);
  if (!found || insideStubRoot(found)) return args;
  const entry = { command, resolved: found, pid: process.pid, argv: process.argv.slice(1) };
  const log = process.env[HOST_GUARD_LOG];
  if (log) appendFileSync(log, `${JSON.stringify(entry)}\n`);
  process.stderr.write(
    `host CLI guard: blocked \`${command}\` (${found}) spawned by ${entry.argv.join(' ')}; use a stub binary under ${stubRoot} or an injected runner.\n`,
  );
  return [join(stubRoot, 'openplanr-blocked-host-cli', basename(command)), ...args.slice(1)];
}

/** Patches `node:child_process` in this process; idempotent. */
export function installHostCliGuard() {
  if (globalThis[INSTALLED]) return;
  globalThis[INSTALLED] = true;
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
    const original = childProcess[name];
    const wrapped = function (...args) {
      return original.apply(this, guardedCommand(args));
    };
    if (original[promisify.custom]) {
      const custom = original[promisify.custom];
      wrapped[promisify.custom] = (...args) => custom(...guardedCommand(args));
    }
    childProcess[name] = wrapped;
  }
  syncBuiltinESMExports();
}

/** Guards this process and every Node descendant, logging violations under `directory`. */
export function enableHostCliGuard(directory) {
  process.env[HOST_GUARD_LOG] ??= join(directory, 'host-cli-guard.log');
  const preload = `--import=${pathToFileURL(import.meta.filename).href}`;
  if (!(process.env.NODE_OPTIONS ?? '').includes(preload))
    process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, preload].filter(Boolean).join(' ');
  installHostCliGuard();
}

/** Returns and clears the recorded violations. */
export function takeHostCliViolations() {
  const log = process.env[HOST_GUARD_LOG];
  if (!log || !existsSync(log)) return [];
  const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  writeFileSync(log, '');
  return lines.map((line) => JSON.parse(line));
}

export function formatHostCliViolations(violations) {
  return [
    `Tests spawned ${violations.length} real host CLI process(es) from PATH:`,
    ...violations.map(
      ({ command, resolved, argv }) => `  ${command} -> ${resolved} (from ${argv.join(' ')})`,
    ),
  ].join('\n');
}

if (process.env[HOST_GUARD_LOG]) installHostCliGuard();
