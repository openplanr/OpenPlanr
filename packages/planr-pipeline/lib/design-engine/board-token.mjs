/**
 * Per-board capability tokens (SPEC-017 / board scoping).
 *
 * The board daemon is one shared, persistent localhost server: a flat registry
 * maps board id → dir, and any registered board is reachable at /boards/<id>/.
 * To stop one project's review URL (or the root index) from exposing every other
 * project's boards, each board's URL carries an unguessable token — the URL is
 * the capability. Only the exact `<slug>--<token>` id reaches the board.
 *
 * The token is persisted in the daemon STATE dir (under planrHome), NOT in the
 * board dir, so it is stable across daemon restarts / re-registration yet never
 * lands in a project's git tree. Keyed by the board's absolute dir.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { daemonDir } from './paths.mjs';

/** A valid token: lowercase hex, ≥16 chars (we mint 24 = 96 bits). */
const TOKEN_RE = /^[a-f0-9]{16,}$/;

/**
 * Read or mint the capability token for a board dir. Stable per dir: the same
 * dir always resolves to the same token until the store is cleared.
 *
 * @param {string} dir absolute (or resolvable) board directory
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {string} the token (lowercase hex)
 */
export function ensureBoardToken(dir, { env = process.env } = {}) {
  const stateDir = daemonDir(env);
  const store = join(stateDir, 'tokens.json');
  const key = resolve(dir);

  let tokens = {};
  try {
    if (existsSync(store)) tokens = JSON.parse(readFileSync(store, 'utf-8')) || {};
  } catch {
    tokens = {};
  }
  if (TOKEN_RE.test(tokens[key] || '')) return tokens[key];

  const token = randomBytes(12).toString('hex');
  tokens[key] = token;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(store, `${JSON.stringify(tokens, null, 2)}\n`);
  return token;
}

/**
 * The capability board id: the human-readable slug plus the unguessable token,
 * joined by `--`. The daemon treats this whole string as an opaque key, so the
 * slug stays recognisable in the URL while the token scopes access.
 *
 * @param {string} slug human label (e.g. the feature slug)
 * @param {string} dir absolute board directory
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {string} `${slug}--${token}`
 */
export function publicBoardId(slug, dir, opts) {
  return `${slug}--${ensureBoardToken(dir, opts)}`;
}
