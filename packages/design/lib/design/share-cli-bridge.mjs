/**
 * Design sharing for the skill helpers: every operation runs in the `openplanr` CLI, which holds the
 * owner keys and talks to the share host. This module reads no keys and makes no request itself.
 * It replaces `share.mjs` and `share-status.mjs` when the skill helpers are bundled.
 */
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { currentDesign } from './document-state.mjs';
import { DESIGN_SHARE_COMPAT } from './share-compat.mjs';

export { defaultDesignRecoveryOutput } from './recovery-location.mjs';

const CLI = 'openplanr';
// Creating or publishing uploads every frame, which can take long on a slow link.
const UPLOAD_TIMEOUT_MS = 30 * 60_000;
const TIMEOUT_MS = 120_000;
const STATUS_TIMEOUT_MS = 5_000;
const FAILED_HANDSHAKE_TTL_MS = 30_000;
const STATUS_TTL_MS = 10_000;
const INSTALL =
  'Install the OpenPlanr CLI with `npm install -g openplanr`, then retry; your local design is unchanged.';
const UNAVAILABLE = Object.freeze([
  'E_DESIGN_SHARE_CLI_REQUIRED',
  'E_DESIGN_SHARE_CLI_UNRESPONSIVE',
  'E_DESIGN_SHARE_RUNTIME_MISMATCH',
  'E_DESIGN_SHARE_PIPELINE_MISSING',
]);

function shareError(code, message, fix) {
  return Object.assign(new Error(fix ? `${message} ${fix}` : message), { code, name: code });
}

function cliMissing() {
  return shareError(
    'E_DESIGN_SHARE_CLI_REQUIRED',
    'Sharing runs in the OpenPlanr CLI, which is not installed.',
    INSTALL,
  );
}

function pathOf(env) {
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH');
  return key ? (env[key] ?? '') : '';
}

/**
 * How to start the CLI. On Windows npm installs a `.cmd` shim, which `execFile` cannot run without
 * a shell, so the CLI's own script runs under this Node instead. Returns null when none is found.
 */
export function cliLauncher({
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
} = {}) {
  if (platform !== 'win32') return { file: CLI, args: [] };
  for (const directory of pathOf(env).split(';').filter(Boolean)) {
    const shim = join(directory, `${CLI}.cmd`);
    if (!existsSync(shim)) continue;
    const target = /"%~?dp0%?\\([^"\r\n]+?\.js)"/iu.exec(readFileSync(shim, 'utf8'))?.[1];
    const script = target
      ? join(directory, ...target.split('\\'))
      : join(directory, 'node_modules', CLI, 'bin', `${CLI}.js`);
    if (existsSync(script)) return { file: execPath, args: [script] };
  }
  return null;
}

function lastJsonLine(stdout) {
  const line = String(stdout ?? '')
    .trim()
    .split('\n')
    .at(-1);
  try {
    return line ? JSON.parse(line) : null;
  } catch {
    return null;
  }
}

/** Turns one finished CLI run into its JSON result, or the error the CLI reported. */
function settle(command, timeout, error, stdout, stderr) {
  if (error?.code === 'ENOENT') throw cliMissing();
  if (error?.code === 'ETIMEDOUT' || error?.killed || error?.signal)
    throw shareError(
      'E_DESIGN_SHARE_CLI_UNRESPONSIVE',
      `The OpenPlanr CLI did not finish \`artifact ${command}\` within ${Math.round(timeout / 1000)} s.`,
      'Check that `openplanr --version` answers, then retry.',
    );
  const value = lastJsonLine(stdout);
  if (!error && value && value.ok !== false) return value;
  if (value && value.ok === false)
    throw shareError(
      value.code ?? 'E_DESIGN_SHARE_FAILED',
      value.problem ?? 'The OpenPlanr CLI could not complete the sharing operation.',
      value.recovery,
    );
  const detail =
    String(stderr ?? '')
      .trim()
      .split('\n')
      .at(-1) ||
    error?.message ||
    'no output';
  throw shareError(
    'E_DESIGN_SHARE_FAILED',
    `openplanr artifact ${command} failed without a JSON result: ${detail}`,
  );
}

function argv(command, file, flags) {
  return ['artifact', command, ...flags, '--json', ...(file === undefined ? [] : ['--', file])];
}

function launch(env) {
  const launcher = cliLauncher({ env });
  if (!launcher) throw cliMissing();
  return launcher;
}

function runSync(command, file, flags, { env = process.env, timeout = STATUS_TIMEOUT_MS } = {}) {
  const { file: program, args } = launch(env);
  let stdout;
  try {
    stdout = execFileSync(program, [...args, ...argv(command, file, flags)], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      windowsHide: true,
    });
  } catch (error) {
    return settle(command, timeout, error, error?.stdout, error?.stderr);
  }
  return settle(command, timeout, null, stdout, '');
}

function runAsync(command, file, flags, { env = process.env, input, timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const { file: program, args } = launch(env);
    const child = execFile(
      program,
      [...args, ...argv(command, file, flags)],
      { env, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        try {
          resolve(settle(command, timeout, error, stdout, stderr));
        } catch (failure) {
          reject(failure);
        }
      },
    );
    child.stdin?.end(input ?? '');
  });
}

/** The handshake outcome for one `share-runtime` result or failure. */
function compatibility(runtime, error) {
  if (error) {
    if (UNAVAILABLE.includes(error.code)) return { error };
    // Releases before the sharing runtime report read `share-runtime` as an artifact path.
    return {
      error: shareError(
        'E_DESIGN_SHARE_RUNTIME_MISMATCH',
        `The installed OpenPlanr CLI is too old to share designs for this skill (${error.message}).`,
        'Update the CLI with `npm install -g openplanr`, then retry.',
      ),
    };
  }
  if (runtime.designShareCompat === DESIGN_SHARE_COMPAT) return { runtime };
  const older =
    typeof runtime.designShareCompat !== 'number' ||
    runtime.designShareCompat < DESIGN_SHARE_COMPAT;
  return {
    error: shareError(
      'E_DESIGN_SHARE_RUNTIME_MISMATCH',
      `The installed OpenPlanr CLI (${runtime.cli}) shares designs in format ${runtime.designShareCompat ?? 'unknown'}, but this skill uses format ${DESIGN_SHARE_COMPAT}.`,
      older
        ? 'Update the CLI with `npm install -g openplanr`, then retry.'
        : 'Update the OpenPlanr plugin or skills to match the CLI, then retry.',
    ),
  };
}

// Keyed by PATH, which decides which CLI answers. A failure is retried after a short wait so
// installing the CLI takes effect without restarting the studio.
const handshakes = new Map();

function remembered(env) {
  const known = handshakes.get(pathOf(env));
  if (known?.outcome?.error && Date.now() - known.at > FAILED_HANDSHAKE_TTL_MS) {
    handshakes.delete(pathOf(env));
    return undefined;
  }
  return known;
}

function remember(env, outcome) {
  handshakes.set(pathOf(env), { at: Date.now(), outcome });
  return outcome;
}

function outcomeOf(outcome) {
  if (outcome.error) throw outcome.error;
  return outcome.runtime;
}

/** Refuses to share through a CLI whose sharing formats differ from this helper's. */
function requireCompatibleRuntime(env = process.env) {
  const known = remembered(env);
  if (known?.outcome) return outcomeOf(known.outcome);
  let outcome;
  try {
    outcome = compatibility(runSync('share-runtime', undefined, [], { env }));
  } catch (error) {
    outcome = compatibility(null, error);
  }
  return outcomeOf(remember(env, outcome));
}

async function requireCompatibleRuntimeAsync(env = process.env) {
  const known = remembered(env);
  if (known?.outcome) return outcomeOf(known.outcome);
  if (known?.pending) return outcomeOf(await known.pending);
  const pending = runAsync('share-runtime', undefined, [], {
    env,
    timeout: STATUS_TIMEOUT_MS,
  }).then(
    (runtime) => remember(env, compatibility(runtime)),
    (error) => remember(env, compatibility(null, error)),
  );
  handshakes.set(pathOf(env), { at: Date.now(), pending });
  return outcomeOf(await pending);
}

const statuses = new Map();

function statusKey(file, env) {
  try {
    return `${pathOf(env)}\0${file}\0${currentDesign(file).revision}`;
  } catch {
    return null;
  }
}

function forget(file) {
  for (const key of statuses.keys()) if (key.split('\0')[1] === file) statuses.delete(key);
}

function cachedStatus(key) {
  const known = key && statuses.get(key);
  return known && Date.now() - known.at <= STATUS_TTL_MS ? known.value : undefined;
}

function unavailableStatus(error) {
  if (!UNAVAILABLE.includes(error.code)) throw error;
  return { ok: true, shared: false, unavailable: { code: error.code, message: error.message } };
}

function required(value, flag, action) {
  if (typeof value !== 'string' || !value)
    throw shareError('E_DESIGN_SHARE_INPUT_INVALID', `${action} requires ${flag}.`);
  return value;
}

async function share(command, file, flags = [], options = {}) {
  await requireCompatibleRuntimeAsync(options.env);
  try {
    return await runAsync(command, file, flags, options);
  } finally {
    forget(file);
  }
}

/** Throws the reason sharing cannot run right now, so a caller can refuse before writing locally. */
export function assertDesignShareAvailable({ env } = {}) {
  requireCompatibleRuntime(env);
}

export async function shareDesign(file, options = {}) {
  return share('share', file, ['--yes', '--no-open'], { ...options, timeout: UPLOAD_TIMEOUT_MS });
}

export async function publishDesignShare(file, options = {}) {
  return share('publish', file, ['--yes'], { ...options, timeout: UPLOAD_TIMEOUT_MS });
}

/** With `unavailable: 'skip'`, a missing, unresponsive or mismatched CLI returns `{ skipped }`. */
export async function syncDesignShare(file, options = {}) {
  try {
    return await share('sync', file, [], options);
  } catch (error) {
    if (options.unavailable === 'skip' && UNAVAILABLE.includes(error.code))
      return { ok: true, skipped: error.code, reason: error.message };
    throw error;
  }
}

export async function manageDesignShare(file, action, options = {}) {
  return share('manage', file, ['--action', action, '--yes'], options);
}

/** Without `output`, the CLI writes a new private file under `PLANR_HOME/design-recovery`. */
export async function exportDesignShareRecovery(file, { output, ...options } = {}) {
  return share(
    'manage',
    file,
    ['--action', 'recovery', ...(output ? ['--output', output] : [])],
    options,
  );
}

export async function importDesignShareRecovery(file, { input, ...options } = {}) {
  const path = required(input, '--input <private recovery file>', 'Recovery restore');
  return share('manage', file, ['--action', 'restore', '--input', path, '--yes'], options);
}

export async function publishDesignReviewMetadata(file, payload, { revisionId, ...options } = {}) {
  const revision = required(
    revisionId,
    '--revision <shared revision>',
    'Publishing review metadata',
  );
  return share('review-metadata', file, ['--revision', revision, '--input', '-'], {
    ...options,
    input: JSON.stringify(payload),
  });
}

/**
 * Status from the CLI. When the CLI cannot answer, the design reads as not shared and
 * `unavailable` says why, so local review keeps working.
 */
export function getDesignShareStatus(file, { env } = {}) {
  const key = statusKey(file, env);
  const known = cachedStatus(key);
  if (known) return known;
  let value;
  try {
    requireCompatibleRuntime(env);
    value = runSync('status', file, [], { env });
  } catch (error) {
    value = unavailableStatus(error);
  }
  if (key) statuses.set(key, { at: Date.now(), value });
  return value;
}

/** The same status without blocking the caller's event loop while the CLI starts. */
export async function getDesignShareStatusAsync(file, { env } = {}) {
  const key = statusKey(file, env);
  const known = cachedStatus(key);
  if (known) return known;
  let value;
  try {
    await requireCompatibleRuntimeAsync(env);
    value = await runAsync('status', file, [], { env, timeout: STATUS_TIMEOUT_MS });
  } catch (error) {
    value = unavailableStatus(error);
  }
  if (key) statuses.set(key, { at: Date.now(), value });
  return value;
}
