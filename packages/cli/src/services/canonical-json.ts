import { createHash } from 'node:crypto';

const hasOwn = (value: object, key: PropertyKey): boolean => Object.hasOwn(value, key);

function assertUnicodeScalarString(value: string, path: string): void {
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

function serializeJcs(value: unknown, path: string, seen: Set<object>): string {
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
      const entries: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!hasOwn(value, index)) {
          throw new TypeError(`JCS cannot canonicalize a sparse array at ${path}[${index}].`);
        }
        entries.push(serializeJcs(value[index], `${path}[${index}]`, seen));
      }
      return `[${entries.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`JCS requires a plain JSON object at ${path}.`);
    }
    const input = value as Record<string, unknown>;
    const entries = Object.keys(input)
      .sort()
      .map((key) => {
        assertUnicodeScalarString(key, `${path} key`);
        return `${JSON.stringify(key)}:${serializeJcs(input[key], `${path}.${key}`, seen)}`;
      });
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

/** RFC 8785 hashing kept local so global CLI/setup help works without the optional pipeline package. */
export function sha256CanonicalJson(value: unknown): `sha256:${string}` {
  const canonical = serializeJcs(value, '$', new Set<object>());
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}
