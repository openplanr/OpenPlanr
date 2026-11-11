// Sign-in state of a native CLI, read from its own status command. Only the state and the
// kind of sign-in leave this module; account names, emails and organizations never do.
import { invokeProcess } from './generic.mjs';

const LOGIN_COMMANDS = Object.freeze({
  claude: 'claude auth login',
  codex: 'codex login',
  cursor: 'agent login',
});

function notChecked(reason) {
  return { state: 'not-checked', reason };
}

/** Claude Code `auth status --json`: reads only `loggedIn`, `authMethod` and `apiProvider`. */
export function claudeIdentity(output) {
  let status;
  try {
    status = JSON.parse(output);
  } catch {
    return notChecked('unrecognized-output');
  }
  if (!status || typeof status !== 'object' || typeof status.loggedIn !== 'boolean')
    return notChecked('unrecognized-output');
  if (typeof status.apiProvider === 'string' && status.apiProvider !== 'firstParty')
    return { state: 'provider-managed' };
  if (!status.loggedIn) return { state: 'signed-out' };
  if (status.authMethod === 'claude.ai') return { state: 'account' };
  if (typeof status.authMethod === 'string' && /api.?key|console/iu.test(status.authMethod))
    return { state: 'api-key' };
  return notChecked('unrecognized-method');
}

/** Codex `login status`: matches known status lines only and discards the rest of each line. */
export function codexIdentity(output) {
  for (const line of output.split(/\r?\n/u).map((text) => text.trim())) {
    if (/^Logged in using ChatGPT\b/u.test(line)) return { state: 'account' };
    if (/^Logged in using an API key\b/iu.test(line)) return { state: 'api-key' };
    if (/^Not logged in\b/iu.test(line)) return { state: 'signed-out' };
  }
  return notChecked('unrecognized-output');
}

/** Cursor `status --format json`: reads only `isAuthenticated` and `hasAccessToken`. */
export function cursorIdentity(status) {
  if (!status || typeof status !== 'object' || typeof status.isAuthenticated !== 'boolean')
    return notChecked('unrecognized-output');
  if (!status.isAuthenticated) return { state: 'signed-out' };
  return status.hasAccessToken === true ? { state: 'account' } : notChecked('unrecognized-method');
}

/**
 * Adds the next action for a signed-out engine; a local destination needs no vendor sign-in.
 */
export function identityForDestination(kind, identity, destination) {
  if (identity.state !== 'signed-out') return identity;
  if (destination?.class === 'local') return { state: 'not-required' };
  return {
    state: 'signed-out',
    nextAction: `Run ${LOGIN_COMMANDS[kind]} in your terminal, then probe again.`,
  };
}

/**
 * Runs a native status command with the agent's environment and parses its output.
 * A failed, slow or unrecognized command reports `not-checked`; cancellation still throws.
 */
export async function readNativeIdentity(executable, args, parse, options) {
  const { cwd, env, signal, timeoutMs } = options;
  let result;
  try {
    result = await invokeProcess(executable, args, {
      cwd,
      env,
      signal,
      timeoutMs: Math.min(timeoutMs ?? 10000, 10000),
      maxOutputBytes: 16 * 1024,
      withExitCode: true,
      captureStderr: true,
    });
  } catch (error) {
    if (error?.code === 'E_ADAPTER_CANCELLED') throw error;
    return notChecked(typeof error?.code === 'string' ? error.code : 'status-failed');
  }
  return parse(result.output);
}
