export class DashboardValidationError extends Error {
  readonly code = 'DASHBOARD_RESPONSE_INVALID';

  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`);
    this.name = 'DashboardValidationError';
  }
}

// Product-state data has already crossed a domain-specific wire boundary before
// it reaches this generic wrapper. Keep a second finite inspection budget, but
// size it for the documented large-workspace target instead of rejecting valid
// Planning graphs after only a few hundred richly annotated artifacts.
const MAX_SAFE_INSPECTION_DEPTH = 96;
const MAX_SAFE_INSPECTION_NODES = 250_000;

/** Prove structured-clone traversal cannot invoke nested accessors or executable values. */
function assertCloneSafe(value: unknown, path: string): void {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const inspect = (entry: unknown, depth: number): void => {
    if (entry === null || (typeof entry !== 'object' && typeof entry !== 'function')) return;
    if (typeof entry === 'function') {
      throw new DashboardValidationError(path, 'contains an executable value');
    }
    nodes += 1;
    if (depth > MAX_SAFE_INSPECTION_DEPTH || nodes > MAX_SAFE_INSPECTION_NODES) {
      throw new DashboardValidationError(path, 'contains an over-complex object graph');
    }
    if (seen.has(entry)) {
      throw new DashboardValidationError(path, 'contains a repeated or cyclic object reference');
    }
    seen.add(entry);
    const prototype = Object.getPrototypeOf(entry);
    const expectedPrototype = Array.isArray(entry) ? Array.prototype : Object.prototype;
    if (prototype !== expectedPrototype && prototype !== null) {
      throw new DashboardValidationError(path, 'contains a non-plain nested object');
    }
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') {
        throw new DashboardValidationError(path, 'contains a symbol field');
      }
      const descriptor = descriptors[key];
      if (descriptor?.get !== undefined || descriptor?.set !== undefined) {
        throw new DashboardValidationError(path, 'contains a nested accessor field');
      }
      inspect(descriptor?.value, depth + 1);
    }
  };
  inspect(value, 0);
}

export function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DashboardValidationError(path, 'expected an object');
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new DashboardValidationError(path, 'expected a plain object');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some(
        (key) =>
          typeof key !== 'string' ||
          descriptors[key]?.get !== undefined ||
          descriptors[key]?.set !== undefined,
      )
    ) {
      throw new DashboardValidationError(path, 'contains an accessor or symbol field');
    }
    const actual = Object.keys(descriptors).sort();
    const expected = [...keys].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new DashboardValidationError(path, 'contains missing or unknown fields');
    }
    // After the full graph is descriptor-audited, structured clone rejects transparent
    // Proxy objects (including nested ones) without allowing a hidden `get` trap.
    assertCloneSafe(value, path);
    structuredClone(value);
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
    );
  } catch (error) {
    if (error instanceof DashboardValidationError) throw error;
    throw new DashboardValidationError(path, 'could not be inspected safely');
  }
}

/** Inspect a plain record without allowing getters, setters, symbols, or exceptional proxy traps. */
export function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DashboardValidationError(path, 'expected an object');
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new DashboardValidationError(path, 'expected a plain object');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some(
        (key) =>
          typeof key !== 'string' ||
          descriptors[key]?.get !== undefined ||
          descriptors[key]?.set !== undefined,
      )
    ) {
      throw new DashboardValidationError(path, 'contains an accessor or symbol field');
    }
    assertCloneSafe(value, path);
    structuredClone(value);
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
    );
  } catch (error) {
    if (error instanceof DashboardValidationError) throw error;
    throw new DashboardValidationError(path, 'could not be inspected safely');
  }
}

export function exactString(value: unknown, path: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new DashboardValidationError(path, 'contains an invalid string');
  }
  return value;
}

export function nullableExactString(value: unknown, path: string, pattern: RegExp): string | null {
  return value === null ? null : exactString(value, path, pattern);
}

export function exactBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new DashboardValidationError(path, 'expected a boolean');
  }
  return value;
}

const MAX_DASHBOARD_JSON_BYTES = 64 * 1024;
const MAX_DASHBOARD_JSON_DEPTH = 64;
const MAX_DASHBOARD_JSON_NODES = 4096;

/** Parse bounded JSON while rejecting duplicate object members before JSON.parse can collapse them. */
export function parseExactJson(text: string): unknown {
  try {
    if (typeof text !== 'string') {
      throw new DashboardValidationError('$', 'expected a JSON string');
    }
    if (new TextEncoder().encode(text).byteLength > MAX_DASHBOARD_JSON_BYTES) {
      throw new DashboardValidationError('$', 'response exceeds the dashboard JSON limit');
    }
    let index = 0;
    let nodes = 0;
    const whitespace = () => {
      while (/\s/u.test(text[index] ?? '')) index += 1;
    };
    const stringToken = (): string => {
      if (text[index] !== '"') throw new DashboardValidationError('$', 'invalid JSON string');
      const start = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') index += 2;
        else if (text[index] === '"') {
          index += 1;
          try {
            return JSON.parse(text.slice(start, index)) as string;
          } catch {
            throw new DashboardValidationError('$', 'invalid JSON string');
          }
        } else index += 1;
      }
      throw new DashboardValidationError('$', 'unterminated JSON string');
    };
    const value = (depth: number): void => {
      nodes += 1;
      if (depth > MAX_DASHBOARD_JSON_DEPTH || nodes > MAX_DASHBOARD_JSON_NODES) {
        throw new DashboardValidationError(
          '$',
          'response exceeds the dashboard JSON complexity limit',
        );
      }
      whitespace();
      if (text[index] === '{') {
        index += 1;
        whitespace();
        const keys = new Set<string>();
        if (text[index] === '}') {
          index += 1;
          return;
        }
        while (index < text.length) {
          whitespace();
          const key = stringToken();
          if (keys.has(key)) {
            throw new DashboardValidationError('$', 'response contains duplicate object members');
          }
          keys.add(key);
          whitespace();
          if (text[index] !== ':') throw new DashboardValidationError('$', 'invalid JSON object');
          index += 1;
          value(depth + 1);
          whitespace();
          if (text[index] === '}') {
            index += 1;
            return;
          }
          if (text[index] !== ',') throw new DashboardValidationError('$', 'invalid JSON object');
          index += 1;
        }
      } else if (text[index] === '[') {
        index += 1;
        whitespace();
        if (text[index] === ']') {
          index += 1;
          return;
        }
        while (index < text.length) {
          value(depth + 1);
          whitespace();
          if (text[index] === ']') {
            index += 1;
            return;
          }
          if (text[index] !== ',') throw new DashboardValidationError('$', 'invalid JSON array');
          index += 1;
        }
      } else if (text[index] === '"') {
        stringToken();
        return;
      } else {
        const token = text
          .slice(index)
          .match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u)?.[0];
        if (!token) throw new DashboardValidationError('$', 'invalid JSON value');
        index += token.length;
        return;
      }
      throw new DashboardValidationError('$', 'unterminated JSON value');
    };
    value(0);
    whitespace();
    if (index !== text.length) throw new DashboardValidationError('$', 'trailing JSON bytes');
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof DashboardValidationError) throw error;
    throw new DashboardValidationError('$', 'invalid JSON response');
  }
}
