import { createHash } from 'node:crypto';

import { SkillRuntimeError } from '../errors.mjs';

/** UTF-8 byte length of a string. */
export function byteLength(text) {
  return Buffer.byteLength(String(text), 'utf8');
}

/** sha256 over the exact literal bytes on disk (no line-ending normalization). */
export function sha256Bytes(text) {
  return `sha256:${createHash('sha256')
    .update(Buffer.from(String(text), 'utf8'))
    .digest('hex')}`;
}

/**
 * Build a source-map owner pointer.
 *
 * Pointer scheme (documented, not pre-frozen by the spec):
 *   - `template`     literal/separator bytes -> `<templateSourcePath>`
 *   - `source`       a substituted skill/module value -> `<sourcePath>#/<field/path>`
 *                    or `<sourcePath>` for a whole inline module body
 *   - `host-profile` a host overlay substitution from an authored profile document
 *                    -> `<hostProfileSourcePath>#/<overlay/path>`
 *   - `compiler`     a value baked into the compiler's own constant tables (not an
 *                    authored document) -> `<compilerSourcePath>#/<table/path>`
 * `version` is the contributing document's semver; `digest` is sha256 of its exact
 * source bytes.
 */
export function owner(ownerKind, pointer, version, digest) {
  if (!['template', 'source', 'host-profile', 'compiler'].includes(ownerKind)) {
    throw new SkillRuntimeError(
      'E_SOURCE_MAP_OWNER_INVALID',
      `Unknown source-map owner kind ${ownerKind}.`,
      { ownerKind },
    );
  }
  return Object.freeze({ ownerKind, pointer, version, digest });
}

/**
 * Accumulates output text with owned byte ranges so every emitted byte has one
 * owner. Ranges use inclusive startByte and exclusive endByte.
 */
export class SourceMapBuilder {
  #cursor = 0;

  #ranges = [];

  #chunks = [];

  append(text, rangeOwner) {
    const value = String(text);
    if (value.length === 0) return this;
    // Never retain a caller-owned object. `owner()` validates the public shape,
    // copies only the four contract fields, and freezes the copy, so nested or
    // later caller mutation cannot rewrite custody after append/build.
    const immutableOwner = owner(
      rangeOwner?.ownerKind,
      rangeOwner?.pointer,
      rangeOwner?.version,
      rangeOwner?.digest,
    );
    const start = this.#cursor;
    const end = start + byteLength(value);
    this.#ranges.push(Object.freeze({ startByte: start, endByte: end, owner: immutableOwner }));
    this.#chunks.push(value);
    this.#cursor = end;
    return this;
  }

  get text() {
    return this.#chunks.join('');
  }

  get byteLength() {
    return this.#cursor;
  }

  build() {
    // Each range (and its owner) is already frozen by append(). Return a fresh
    // frozen array over those frozen originals so a later append() cannot mutate a
    // previously-built map, and every returned range object stays immutable.
    const ranges = this.#ranges.slice();
    validateSourceMap(ranges, this.#cursor);
    return Object.freeze(ranges);
  }
}

/**
 * Validate that ranges are ordered, gap-free, non-overlapping, and jointly cover
 * every byte of an output of `totalBytes` exactly once.
 */
export function validateSourceMap(ranges, totalBytes) {
  let expected = 0;
  for (const range of ranges) {
    if (
      !Number.isInteger(range.startByte) ||
      !Number.isInteger(range.endByte) ||
      range.endByte <= range.startByte
    ) {
      throw new SkillRuntimeError(
        'E_SOURCE_MAP_RANGE_INVALID',
        'A source-map range must have integer startByte < endByte.',
        { range },
      );
    }
    if (range.startByte !== expected) {
      throw new SkillRuntimeError(
        'E_SOURCE_MAP_NOT_CONTIGUOUS',
        'Source-map ranges are not ordered and gap-free.',
        { expected, actual: range.startByte },
      );
    }
    expected = range.endByte;
  }
  if (expected !== totalBytes) {
    throw new SkillRuntimeError(
      'E_SOURCE_MAP_COVERAGE_INCOMPLETE',
      'Source-map ranges do not cover every output byte exactly once.',
      { covered: expected, totalBytes },
    );
  }
  return true;
}
