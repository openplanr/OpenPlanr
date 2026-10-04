import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIGEST = /^[a-f0-9]{64}$/u;
const MAX_FRAGMENT_BYTES = 128 * 1024;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_SOURCES = 256;
const MAX_SCOPES = 16;
const MAX_SCOPE_TEXT_BYTES = 4096;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const SCOPE_ID = /^[a-z][a-z0-9-]{0,63}$/u;

type Scope = { id: string; parent: string | null; open: string; close: string };
type Source = { path: string; scope: string; bytes: number; sha256: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * Read at most `limit` bytes from a regular file, or exactly `exact` bytes when given.
 * Size is checked before allocation, and growth after inspection is detected.
 */
function boundedRead(
  url: URL,
  label: string,
  { limit, exact, links = false }: { limit: number; exact?: number; links?: boolean },
): Buffer {
  if (!links) {
    const stat = lstatSync(url, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new Error(`${label} must be a regular file, not a link.`);
  }
  const descriptor = openSync(
    fileURLToPath(url),
    constants.O_RDONLY | (links ? 0 : (constants.O_NOFOLLOW ?? 0)),
  );
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new Error(`${label} must be a regular file, not a link.`);
    if (exact !== undefined ? stat.size !== exact : stat.size > limit)
      throw new Error(`${label} is ${stat.size} bytes; expected ${exact ?? `at most ${limit}`}.`);
    const capacity = (exact ?? Math.min(stat.size, limit)) + 1;
    const buffer = Buffer.alloc(capacity);
    let length = 0;
    for (let read = -1; read !== 0 && length < capacity; length += read)
      read = readSync(descriptor, buffer, length, capacity - length, null);
    if (length === capacity) throw new Error(`${label} changed size while it was read.`);
    if (exact !== undefined && length !== exact)
      throw new Error(`${label} changed size while it was read.`);
    return buffer.subarray(0, length);
  } finally {
    closeSync(descriptor);
  }
}

function sourceManifest(
  value: unknown,
  basename: string,
): { bytes: number; sha256: string; scopes: Scope[]; sources: Source[] } {
  const path = new RegExp(
    `^${basename.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\.sources/\\d{2,4}-[a-z0-9-]+\\.js$`,
    'u',
  );
  if (
    !isRecord(value) ||
    value.kind !== 'openplanr-runtime-asset-sources' ||
    value.schemaVersion !== '1.0.0' ||
    value.asset !== basename ||
    typeof value.sha256 !== 'string' ||
    !DIGEST.test(value.sha256) ||
    !Number.isSafeInteger(value.bytes) ||
    (value.bytes as number) <= 0 ||
    (value.bytes as number) > MAX_ASSET_BYTES ||
    !Array.isArray(value.scopes) ||
    !value.scopes.length ||
    value.scopes.length > MAX_SCOPES ||
    !Array.isArray(value.sources) ||
    !value.sources.length ||
    value.sources.length > MAX_SOURCES
  )
    throw new Error('Runtime source manifest is invalid.');
  const ids = new Set<string>();
  const scopes = value.scopes.map((scope: unknown, index: number) => {
    if (
      !isRecord(scope) ||
      typeof scope.id !== 'string' ||
      !SCOPE_ID.test(scope.id) ||
      ids.has(scope.id) ||
      (index === 0
        ? scope.parent !== null
        : typeof scope.parent !== 'string' || !ids.has(scope.parent)) ||
      typeof scope.open !== 'string' ||
      typeof scope.close !== 'string' ||
      Buffer.byteLength(scope.open) > MAX_SCOPE_TEXT_BYTES ||
      Buffer.byteLength(scope.close) > MAX_SCOPE_TEXT_BYTES
    )
      throw new Error('Runtime source scope is invalid.');
    ids.add(scope.id);
    return scope as Scope;
  });
  const paths = new Set<string>();
  const sources = value.sources.map((source: unknown) => {
    if (
      !isRecord(source) ||
      typeof source.path !== 'string' ||
      !path.test(source.path) ||
      paths.has(source.path) ||
      typeof source.scope !== 'string' ||
      !ids.has(source.scope) ||
      !Number.isSafeInteger(source.bytes) ||
      (source.bytes as number) <= 0 ||
      (source.bytes as number) >= MAX_SOURCE_BYTES ||
      typeof source.sha256 !== 'string' ||
      !DIGEST.test(source.sha256)
    )
      throw new Error('Runtime source identity is invalid.');
    paths.add(source.path);
    return source as Source;
  });
  return { bytes: value.bytes as number, sha256: value.sha256, scopes, sources };
}

/** Readable statement units join, in declared scope order, into one verified classic script. */
function readSourceUnits(url: URL, basename: string): Buffer {
  const manifestUrl = new URL(`${basename}.sources.json`, url);
  const manifest = boundedRead(manifestUrl, 'Runtime source manifest', {
    limit: MAX_MANIFEST_BYTES,
  });
  const expected = sourceManifest(JSON.parse(manifest.toString('utf8')), basename);
  const directory = lstatSync(new URL(`${basename}.sources`, url), { throwIfNoEntry: false });
  if (!directory?.isDirectory()) throw new Error('Runtime source directory must not be a link.');
  const byId = new Map(expected.scopes.map((scope) => [scope.id, scope]));
  const parts: Buffer[] = [];
  const open: Scope[] = [];
  const closed = new Set<string>();
  let total = 0;
  const append = (bytes: Buffer) => {
    total += bytes.length;
    if (total > expected.bytes) throw new Error('Runtime sources exceed their declared size.');
    parts.push(bytes);
  };
  const close = () => {
    const scope = open.pop();
    if (!scope) return;
    closed.add(scope.id);
    append(Buffer.from(scope.close, 'utf8'));
  };
  for (const source of expected.sources) {
    const chain: Scope[] = [];
    for (let scope = byId.get(source.scope); scope; scope = byId.get(scope.parent ?? ''))
      chain.unshift(scope);
    while (open.length && !chain.includes(open[open.length - 1])) close();
    for (const scope of chain.slice(open.length)) {
      if (closed.has(scope.id)) throw new Error('Runtime source scopes are not contiguous.');
      open.push(scope);
      append(Buffer.from(scope.open, 'utf8'));
    }
    const unitUrl = new URL(source.path, url);
    const bytes = boundedRead(unitUrl, `Runtime source unit ${source.path}`, {
      limit: MAX_SOURCE_BYTES,
      exact: source.bytes,
    });
    if (digest(bytes) !== source.sha256)
      throw new Error('Runtime source unit failed integrity verification.');
    append(bytes);
  }
  while (open.length) close();
  const bytes = Buffer.concat(parts);
  if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256)
    throw new Error('Runtime sources failed integrity verification.');
  return bytes;
}

/** Directory skills preserve runtime bytes as readable source units or legacy verified fragments. */
export function readRuntimeAsset(file: URL | string): Buffer {
  const url = typeof file === 'string' ? pathToFileURL(resolve(file)) : file;
  if (existsSync(url)) return readFileSync(url);
  const basename = url.pathname.split('/').at(-1);
  if (!basename) throw new Error('Studio runtime asset identity is invalid.');
  if (lstatSync(new URL(`${basename}.sources.json`, url), { throwIfNoEntry: false }))
    return readSourceUnits(url, basename);
  const manifest: unknown = JSON.parse(
    boundedRead(new URL(`${basename}.parts.json`, url), 'Studio runtime fragment manifest', {
      limit: MAX_MANIFEST_BYTES,
      links: true,
    }).toString('utf8'),
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
    const bytes = boundedRead(new URL(part.name as string, url), 'Studio runtime fragment', {
      limit: MAX_FRAGMENT_BYTES,
      links: true,
    });
    if (createHash('sha256').update(bytes).digest('hex') !== part.sha256)
      throw new Error('Studio runtime fragment failed integrity verification.');
    return bytes;
  });
  const bytes = Buffer.concat(parts);
  if (createHash('sha256').update(bytes).digest('hex') !== manifest.sha256)
    throw new Error('Studio runtime failed integrity verification.');
  return bytes;
}
