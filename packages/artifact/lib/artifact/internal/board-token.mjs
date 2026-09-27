/**
 * Per-board capability tokens (board scoping).
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

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { daemonDir } from './paths.mjs';
import { writePrivateJsonState } from './server-util.mjs';

/** A valid token: lowercase hex, ≥16 chars (we mint 24 = 96 bits). */
const TOKEN_RE = /^[a-f0-9]{16,}$/;
const BASE64URL_TOKEN_RE = /^[A-Za-z0-9_-]+$/;

/** Mint a fixed-entropy capability token without coupling callers to board ids. */
export function mintCapabilityToken({
  bytes = 32,
  encoding = 'base64url',
  randomBytesImpl = randomBytes,
} = {}) {
  if (!Number.isInteger(bytes) || bytes < 12 || bytes > 64) {
    throw new RangeError('Capability tokens require 12 through 64 random bytes.');
  }
  if (!['base64url', 'hex'].includes(encoding)) {
    throw new TypeError(`Unsupported capability token encoding: ${String(encoding)}`);
  }
  const value = randomBytesImpl(bytes);
  if (!Buffer.isBuffer(value) || value.byteLength !== bytes) {
    throw new TypeError('Capability token random source returned the wrong byte length.');
  }
  return value.toString(encoding);
}

/** Strict fixed-size token validation used before constant-time comparison. */
export function isCapabilityToken(value, { bytes = 32, encoding = 'base64url' } = {}) {
  if (typeof value !== 'string') return false;
  if (encoding === 'hex') return value.length === bytes * 2 && /^[a-f0-9]+$/.test(value);
  if (encoding !== 'base64url' || !BASE64URL_TOKEN_RE.test(value)) return false;
  try {
    return (
      Buffer.from(value, 'base64url').byteLength === bytes &&
      Buffer.from(value, 'base64url').toString('base64url') === value
    );
  } catch {
    return false;
  }
}

/** Compare opaque tokens without leaking a matching prefix. */
export function timingSafeTokenEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function unreadableTokenStore(path, reason, cause) {
  return new Error(
    `The design board token store ${path} is unreadable: ${reason}. It was left unchanged; repair it, or move it aside so every board gets a new URL, then retry.`,
    { cause },
  );
}

/**
 * Read or mint the capability token for a board dir. Stable per dir: the same
 * dir always resolves to the same token until the store is cleared.
 * An unreadable store throws and is never rewritten, so other boards keep their tokens.
 *
 * @param {string} dir absolute (or resolvable) board directory
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {string} the token (lowercase hex)
 */
export function ensureBoardToken(dir, { env = process.env } = {}) {
  const stateDir = daemonDir(env);
  const store = join(stateDir, 'tokens.json');
  const key = resolve(dir);

  let bytes;
  try {
    bytes = readFileSync(store);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw unreadableTokenStore(store, error.code, error);
  }
  let tokens = {};
  if (bytes) {
    try {
      tokens = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      // A parse message quotes the file, which holds other boards' tokens.
      throw unreadableTokenStore(store, 'it is not valid JSON');
    }
  }
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens))
    throw unreadableTokenStore(store, 'expected an object mapping board directories to tokens');
  if (TOKEN_RE.test(tokens[key] || '')) return tokens[key];

  const token = mintCapabilityToken({ bytes: 12, encoding: 'hex' });
  tokens[key] = token;
  writePrivateJsonState(store, tokens);
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
