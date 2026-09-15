import { createHash } from 'node:crypto';

export function digestBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}
