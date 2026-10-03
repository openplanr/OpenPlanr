import { assertPlainData } from './canonical-json.mjs';

/** Bound hostile input before any resource schema reader or contract field access.
 * @type {typeof import('./bounded-json-data.d.mts').assertLargeObjectData}
 */
export function assertLargeObjectData(value) {
  const pending = [[value, 0]],
    visited = new Set();
  let nodes = 0;
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [item, depth, exit] = next;
    if (exit) {
      visited.delete(item);
      continue;
    }
    if (++nodes > 250000 || depth > 40)
      throw new RangeError('Large object complexity exceeds its limit.');
    if (item && typeof item === 'object') {
      if (visited.has(item)) throw new TypeError('Large objects require acyclic plain data.');
      visited.add(item);
      pending.push([item, depth, true]);
      const array = Array.isArray(item);
      const prototype = Object.getPrototypeOf(item);
      if (
        array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
      )
        throw new TypeError('Large objects require plain data.');
      const descriptors = Object.getOwnPropertyDescriptors(item);
      const keys = Reflect.ownKeys(descriptors);
      const length = array ? descriptors.length.value : null;
      if (array && keys.length !== length + 1)
        throw new TypeError('Large objects require dense JSON arrays.');
      for (const key of keys) {
        if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))
          throw new TypeError('Large objects cannot contain unsafe or symbolic keys.');
        const descriptor = descriptors[key];
        if (!('value' in descriptor))
          throw new TypeError('Large objects cannot contain accessors.');
        if (!(array && key === 'length') && !descriptor.enumerable)
          throw new TypeError('Large objects require enumerable JSON fields.');
        if (
          array &&
          key !== 'length' &&
          (!Number.isSafeInteger(Number(key)) ||
            Number(key) < 0 ||
            Number(key) >= length ||
            String(Number(key)) !== key)
        )
          throw new TypeError('Large objects require numeric JSON array indices.');
        pending.push([descriptor.value, depth + 1]);
      }
    }
  }
  assertPlainData(value, 'Large object data');
  return value;
}
