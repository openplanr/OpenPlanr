import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { canonicalize } from '../canonical.js';
import { normalizeOperatingInitializationAnswers } from '../config.js';
import { parseStrictJson } from '../evidence-import.js';
import { OperateError, type OperatingInitAnswers } from '../types.js';

const MAX_REPLAY_BYTES = 64 * 1024;
// Leave headroom below the Windows 32,767-character command-line ceiling for
// the command, timestamp, confirmation digest, and JSON flags.
const MAX_TOKEN_LENGTH = 24 * 1024;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Encode the already-reviewed, non-secret initialization answers into a
 * shell-safe replay token. The confirmation digest still provides authority
 * and detects any token modification before a write.
 */
export function encodeOperatingInitializationReplay(answers: OperatingInitAnswers): string {
  const normalized = normalizeOperatingInitializationAnswers(answers);
  const raw = Buffer.from(canonicalize(normalized), 'utf8');
  if (raw.byteLength > MAX_REPLAY_BYTES) {
    throw new OperateError(
      'E_OPERATE_INPUT_TOO_LARGE',
      `Initialization answers exceed the ${MAX_REPLAY_BYTES}-byte replay limit.`,
    );
  }
  const token = deflateRawSync(raw, { level: 9 }).toString('base64url');
  if (token.length > MAX_TOKEN_LENGTH) {
    throw new OperateError(
      'E_OPERATE_INPUT_TOO_LARGE',
      'Encoded initialization replay token exceeds the supported command limit.',
    );
  }
  return token;
}

export function decodeOperatingInitializationReplay(token: string): OperatingInitAnswers {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH || !BASE64URL.test(token)) {
    throw new OperateError(
      token.length > MAX_TOKEN_LENGTH ? 'E_OPERATE_INPUT_TOO_LARGE' : 'E_OPERATE_SESSION_INVALID',
      'Initialization replay token is malformed or exceeds the supported limit.',
    );
  }
  try {
    const compressed = Buffer.from(token, 'base64url');
    if (compressed.toString('base64url') !== token) {
      throw new Error('non-canonical base64url');
    }
    const raw = inflateRawSync(compressed, {
      maxOutputLength: MAX_REPLAY_BYTES,
    }).toString('utf8');
    const parsed = parseStrictJson(raw, {
      maxBytes: MAX_REPLAY_BYTES,
      maxDepth: 12,
      maxScalars: 512,
      maxStringLength: 4096,
    });
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('replay payload is not an object');
    }
    const normalized = normalizeOperatingInitializationAnswers(parsed as OperatingInitAnswers);
    // Raw DEFLATE decoders may accept and ignore trailing bytes. Re-encode the
    // validated payload so every accepted token has exactly one canonical byte
    // representation and appended data cannot survive as a valid replay.
    if (encodeOperatingInitializationReplay(normalized) !== token) {
      throw new Error('non-canonical replay token');
    }
    return normalized;
  } catch (error) {
    if (error instanceof OperateError) throw error;
    throw new OperateError(
      'E_OPERATE_SESSION_INVALID',
      'Initialization replay token is invalid or corrupted.',
    );
  }
}
