import { createHash } from 'node:crypto';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function assertUnicodeScalarString(value, path) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`JCS cannot canonicalize a lone high surrogate at ${path}.`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`JCS cannot canonicalize a lone low surrogate at ${path}.`);
    }
  }
}

function serialize(value, path, seen) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    assertUnicodeScalarString(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`JCS requires a finite number at ${path}.`);
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new TypeError(`JCS cannot canonicalize ${typeof value} at ${path}.`);
  }
  if (seen.has(value)) throw new TypeError(`JCS cannot canonicalize a cycle at ${path}.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const entries = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!hasOwn(value, index)) throw new TypeError(`JCS cannot canonicalize a sparse array at ${path}[${index}].`);
        entries.push(serialize(value[index], `${path}[${index}]`, seen));
      }
      return `[${entries.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`JCS requires a plain JSON object at ${path}.`);
    }
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => {
      assertUnicodeScalarString(key, `${path} key`);
      return `${JSON.stringify(key)}:${serialize(value[key], `${path}.${key}`, seen)}`;
    });
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

/**
 * RFC 8785 JSON Canonicalization Scheme for already-parsed JSON values.
 * Object keys are ordered by UTF-16 code units, arrays retain order, and
 * non-JSON values, cycles, sparse arrays, non-finite numbers, and lone
 * surrogates are rejected instead of being silently coerced.
 */
export function canonicalizeJson(value) {
  return serialize(value, '$', new Set());
}

export function sha256Jcs(value) {
  return `sha256:${createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('hex')}`;
}
