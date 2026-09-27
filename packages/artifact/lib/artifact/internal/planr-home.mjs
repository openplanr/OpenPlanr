/**
 * The OpenPlanr user state directory. `PLANR_HOME` names it (default `~/.planr`). The deprecated
 * `OPENPLANR_HOME` named the directory that holds `.planr` and is still read when `PLANR_HOME`
 * is unset. The CLI runs a generated copy of this file, `packages/cli/lib/planr-home.mjs`.
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Every copy of this module loaded into one process shares the flag, so the warning prints once.
const WARNED = Symbol.for('openplanr.home-variable-warning');

function nonBlank(value) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function warnOnce(message) {
  if (globalThis[WARNED]) return;
  globalThis[WARNED] = true;
  process.stderr.write(`Warning: ${message}\n`);
}

function homeVariables(env) {
  const home = nonBlank(env.PLANR_HOME);
  const legacy = nonBlank(env.OPENPLANR_HOME);
  if (legacy === undefined) return { home, legacy };
  const legacyHome = join(legacy, '.planr');
  if (home === undefined) {
    warnOnce(`OPENPLANR_HOME is deprecated; set PLANR_HOME=${legacyHome} instead.`);
    return { home, legacy };
  }
  warnOnce(
    resolve(home) === resolve(legacyHome)
      ? 'OPENPLANR_HOME is deprecated and ignored because PLANR_HOME is set; unset OPENPLANR_HOME.'
      : `PLANR_HOME=${home} and OPENPLANR_HOME=${legacy} name different OpenPlanr homes; using PLANR_HOME. OPENPLANR_HOME is deprecated; unset it.`,
  );
  return { home, legacy: undefined };
}

/** `PLANR_HOME`, else `$OPENPLANR_HOME/.planr`, else undefined. */
export function configuredPlanrHome(env = process.env) {
  const { home, legacy } = homeVariables(env);
  return home ?? (legacy === undefined ? undefined : join(legacy, '.planr'));
}

/** The OpenPlanr user state directory: the configured home, else `~/.planr`. */
export function planrHome(env = process.env) {
  return configuredPlanrHome(env) ?? join(homedir(), '.planr');
}

/** The user's home directory, which the deprecated `OPENPLANR_HOME` replaces when `PLANR_HOME` is unset. */
export function userHome(env = process.env) {
  return homeVariables(env).legacy ?? homedir();
}
