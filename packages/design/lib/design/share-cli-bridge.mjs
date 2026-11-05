/**
 * Design sharing for the skill helpers: every operation runs in the `openplanr` CLI, which holds the
 * owner keys and talks to the share host. This module reads no keys and makes no request itself.
 * It replaces `share.mjs` and `share-status.mjs` when the skill helpers are bundled.
 */
import { execFile, execFileSync } from 'node:child_process';
import { DESIGN_SHARE_COMPAT } from './share-compat.mjs';

const CLI = 'openplanr';
const TIMEOUT_MS = 120_000;
const STATUS_TIMEOUT_MS = 30_000;
const INSTALL =
  'Install the OpenPlanr CLI with `npm install -g openplanr`, then retry; your local design is unchanged.';

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
function settle(command, error, stdout, stderr) {
  if (error?.code === 'ENOENT') throw cliMissing();
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

function runSync(command, file, flags, { env = process.env, timeout = STATUS_TIMEOUT_MS } = {}) {
  let stdout;
  try {
    stdout = execFileSync(CLI, argv(command, file, flags), {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      windowsHide: true,
    });
  } catch (error) {
    return settle(command, error, error?.stdout, error?.stderr);
  }
  return settle(command, null, stdout, '');
}

function runAsync(command, file, flags, { env = process.env, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      CLI,
      argv(command, file, flags),
      {
        env,
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        try {
          resolve(settle(command, error, stdout, stderr));
        } catch (failure) {
          reject(failure);
        }
      },
    );
    child.stdin?.end(input ?? '');
  });
}

let checked;

/** Refuses to share through a CLI whose sharing formats differ from this helper's. */
function requireCompatibleRuntime(env) {
  if (checked) return checked;
  let runtime;
  try {
    runtime = runSync('share-runtime', undefined, [], { env });
  } catch (error) {
    if (['E_DESIGN_SHARE_CLI_REQUIRED', 'E_DESIGN_SHARE_PIPELINE_MISSING'].includes(error.code))
      throw error;
    // Releases before the sharing runtime report read `share-runtime` as an artifact path.
    throw shareError(
      'E_DESIGN_SHARE_RUNTIME_MISMATCH',
      `The installed OpenPlanr CLI is too old to share designs for this skill (${error.message}).`,
      'Update the CLI with `npm install -g openplanr`, then retry.',
    );
  }
  if (runtime.designShareCompat !== DESIGN_SHARE_COMPAT) {
    const older =
      typeof runtime.designShareCompat !== 'number' ||
      runtime.designShareCompat < DESIGN_SHARE_COMPAT;
    throw shareError(
      'E_DESIGN_SHARE_RUNTIME_MISMATCH',
      `The installed OpenPlanr CLI (${runtime.cli}) shares designs in format ${runtime.designShareCompat ?? 'unknown'}, but this skill uses format ${DESIGN_SHARE_COMPAT}.`,
      older
        ? 'Update the CLI with `npm install -g openplanr`, then retry.'
        : 'Update the OpenPlanr plugin or skills to match the CLI, then retry.',
    );
  }
  checked = runtime;
  return runtime;
}

async function share(command, file, flags = [], options = {}) {
  requireCompatibleRuntime(options.env);
  return runAsync(command, file, flags, options);
}

export async function shareDesign(file, options = {}) {
  return share('share', file, ['--yes', '--no-open'], options);
}

export async function publishDesignShare(file, options = {}) {
  return share('publish', file, ['--yes'], options);
}

/** With `unavailable: 'skip'`, a missing or mismatched CLI returns `{ skipped }` instead of failing. */
export async function syncDesignShare(file, options = {}) {
  try {
    return await share('sync', file, [], options);
  } catch (error) {
    if (
      options.unavailable === 'skip' &&
      [
        'E_DESIGN_SHARE_CLI_REQUIRED',
        'E_DESIGN_SHARE_RUNTIME_MISMATCH',
        'E_DESIGN_SHARE_PIPELINE_MISSING',
      ].includes(error.code)
    )
      return { ok: true, skipped: error.code, reason: error.message };
    throw error;
  }
}

export async function manageDesignShare(file, action, options = {}) {
  return share('manage', file, ['--action', action, '--yes'], options);
}

export async function exportDesignShareRecovery(file, { output, ...options } = {}) {
  return share(
    'manage',
    file,
    ['--action', 'recovery', ...(output ? ['--output', output] : [])],
    options,
  );
}

export async function importDesignShareRecovery(file, { input, ...options } = {}) {
  return share('manage', file, ['--action', 'restore', '--input', input, '--yes'], options);
}

export async function publishDesignReviewMetadata(file, payload, { revisionId, ...options } = {}) {
  return share('review-metadata', file, ['--revision', revisionId, '--input', '-'], {
    ...options,
    input: JSON.stringify(payload),
  });
}

/**
 * Status from the CLI. When the CLI cannot answer, the design reads as not shared and
 * `unavailable` says why, so local review keeps working.
 */
export function getDesignShareStatus(file, { env } = {}) {
  try {
    requireCompatibleRuntime(env);
    return runSync('status', file, [], { env });
  } catch (error) {
    if (
      [
        'E_DESIGN_SHARE_CLI_REQUIRED',
        'E_DESIGN_SHARE_RUNTIME_MISMATCH',
        'E_DESIGN_SHARE_PIPELINE_MISSING',
      ].includes(error.code)
    )
      return { ok: true, shared: false, unavailable: { code: error.code, message: error.message } };
    throw error;
  }
}
