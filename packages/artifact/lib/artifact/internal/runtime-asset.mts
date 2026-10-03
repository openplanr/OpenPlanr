import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DIGEST = /^[a-f0-9]{64}$/u;
const MAX_FRAGMENT_BYTES = 128 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Directory skills preserve identical runtime bytes in bounded, verified fragments. */
export function readRuntimeAsset(file: URL | string): Buffer {
  const url = typeof file === 'string' ? pathToFileURL(resolve(file)) : file;
  if (existsSync(url)) return readFileSync(url);
  const basename = url.pathname.split('/').at(-1);
  if (!basename) throw new Error('Studio runtime asset identity is invalid.');
  const manifest: unknown = JSON.parse(
    readFileSync(new URL(`${basename}.parts.json`, url), 'utf8'),
  );
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== '1.0.0' ||
    typeof manifest.sha256 !== 'string' ||
    !DIGEST.test(manifest.sha256) ||
    !Array.isArray(manifest.parts) ||
    !manifest.parts.length ||
    manifest.parts.length > 64
  )
    throw new Error('Studio runtime fragment manifest is invalid.');
  const parts = manifest.parts.map((part: unknown, index: number) => {
    if (
      !isRecord(part) ||
      part.name !== `${basename}.part-${String(index + 1).padStart(3, '0')}` ||
      typeof part.sha256 !== 'string' ||
      !DIGEST.test(part.sha256)
    )
      throw new Error('Studio runtime fragment identity is invalid.');
    const bytes = readFileSync(new URL(part.name as string, url));
    if (
      bytes.length > MAX_FRAGMENT_BYTES ||
      createHash('sha256').update(bytes).digest('hex') !== part.sha256
    )
      throw new Error('Studio runtime fragment failed integrity verification.');
    return bytes;
  });
  const bytes = Buffer.concat(parts);
  if (createHash('sha256').update(bytes).digest('hex') !== manifest.sha256)
    throw new Error('Studio runtime failed integrity verification.');
  return bytes;
}
