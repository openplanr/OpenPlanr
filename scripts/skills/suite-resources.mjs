import { readFileSync } from 'node:fs';
import { sha256Bytes } from '../../packages/skill-runtime/src/compiler/index.mjs';

/** Resources kept beside the host-readable entry. */
export function suiteLocalResources(packageInfo, host) {
  return packageInfo.resources
    .filter(({ hosts }) => hosts.includes(host))
    .map((resource) => ({ ...resource, bytes: readFileSync(resource.absolute) }));
}

/** Measured inventories replace authored resource totals that drift when dependencies change. */
export function resourceFootprint(entries) {
  const unique = new Map();
  let bytes = 0;
  for (const entry of entries) {
    const value = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes);
    bytes += value.length;
    unique.set(sha256Bytes(value), value.length);
  }
  const uniqueBytes = [...unique.values()].reduce((sum, size) => sum + size, 0);
  return {
    files: entries.length,
    bytes,
    uniqueFiles: unique.size,
    uniqueBytes,
    duplicateBytes: bytes - uniqueBytes,
  };
}
