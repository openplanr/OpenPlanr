import { canonicalizeJson } from '@openplanr/protocol/canonical-json';

const MAX_SERIALIZED_BYTES = 64 * 1024;

export function assertNonBlank(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

export function assertIsoDate(value, label) {
  assertNonBlank(value, label);
  if (Number.isNaN(Date.parse(value))) throw new TypeError(`${label} must be an ISO date-time string.`);
  return value;
}

export function cloneJson(value, label = 'value') {
  let canonical;
  try {
    canonical = canonicalizeJson(value);
  } catch (error) {
    throw new TypeError(`${label} must contain only canonical JSON values.`, { cause: error });
  }
  if (new TextEncoder().encode(canonical).byteLength > MAX_SERIALIZED_BYTES) {
    throw new RangeError(`${label} exceeds the 64 KiB lifecycle-state limit.`);
  }
  return JSON.parse(canonical);
}

export function freezeJson(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

export function immutableJson(value, label) {
  return freezeJson(cloneJson(value, label));
}

export function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
