/** Private immutable binary spool: fsync exact request and chunks before network dispatch. */
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { canonicalizeJson } from '@openplanr/protocol/canonical-json';
import { assertLargeObjectContract } from '@openplanr/protocol/large-object-contracts';
import { uploadChunksFor } from './chunked-workspace-client.mjs';
import { ensurePrivateDirectory } from './owner-custody.mjs';
import { resourceSha256 } from './resource-pack.mjs';

function privateRead(path, limit) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > limit ||
      (process.platform !== 'win32' && (stat.mode & 0o077 || stat.uid !== process.getuid()))
    )
      throw new TypeError('Upload spool must contain bounded private regular files.');
    const bytes = new Uint8Array(Math.min(limit + 1, stat.size + 1));
    let size = 0;
    while (size < bytes.byteLength) {
      const count = readSync(fd, bytes, size, bytes.byteLength - size, null);
      if (!count) break;
      size += count;
    }
    const after = fstatSync(fd);
    if (
      size !== stat.size ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    ) {
      throw new TypeError('Upload spool changed during its bounded private read.');
    }
    return bytes.subarray(0, size);
  } finally {
    closeSync(fd);
  }
}
function writePrivate(path, bytes) {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function readPreparedUploadRequest(directory) {
  directory = resolve(directory);
  try {
    lstatSync(directory);
  } catch (cause) {
    const error = new TypeError('Prepared upload spool is missing or inaccessible.');
    if (cause?.code === 'ENOENT') error.code = 'ENOENT';
    throw error;
  }
  ensurePrivateDirectory(directory, { label: 'Upload' });
  try {
    const body = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        privateRead(join(directory, 'request.json'), 256 * 1024),
      ),
    );
    return assertLargeObjectContract(
      body,
      body?.manifest?.kind === 'openplanr-company-resource-manifest'
        ? 'company-resource-upload-prepare'
        : 'encrypted-upload-prepare',
    );
  } catch (cause) {
    const error = new TypeError('Prepared upload request is invalid or inaccessible.');
    if (cause?.code === 'ENOENT') error.code = 'ENOENT';
    throw error;
  }
}
export function spoolChunkReader(directory, body) {
  assertLargeObjectContract(
    body,
    body?.manifest?.kind === 'openplanr-company-resource-manifest'
      ? 'company-resource-upload-prepare'
      : 'encrypted-upload-prepare',
  );
  directory = resolve(directory);
  ensurePrivateDirectory(directory, { label: 'Upload' });
  const saved = readPreparedUploadRequest(directory);
  if (canonicalizeJson(saved) !== canonicalizeJson(body))
    throw new TypeError('Upload spool request differs from owner custody.');
  return async (index) => {
    const expected = body.manifest.chunks[index];
    if (!expected || expected.index !== index) throw new TypeError('Invalid spool chunk index.');
    const bytes = privateRead(join(directory, `${index}.bin`), expected.byteLength);
    if (
      bytes.byteLength !== expected.byteLength ||
      (await resourceSha256(bytes)) !== expected.sha256
    )
      throw new TypeError('Upload spool chunk is corrupt.');
    return bytes;
  };
}
export const preparedUploadChunkReader = spoolChunkReader;
export async function persistPreparedUploadSpool(body, chunks, directory) {
  assertLargeObjectContract(
    body,
    body?.manifest?.kind === 'openplanr-company-resource-manifest'
      ? 'company-resource-upload-prepare'
      : 'encrypted-upload-prepare',
  );
  if (!Array.isArray(chunks) || chunks.length !== body.manifest.chunks.length)
    throw new TypeError('Prepared upload chunk count differs.');
  directory = resolve(directory);
  ensurePrivateDirectory(directory, { label: 'Upload' });
  for (const part of body.manifest.chunks) {
    const path = join(directory, `${part.index}.bin`),
      bytes = chunks[part.index];
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength !== part.byteLength ||
      (await resourceSha256(bytes)) !== part.sha256
    )
      throw new TypeError('Prepared upload bytes differ.');
    if (existsSync(path)) {
      const existing = privateRead(path, part.byteLength);
      if (
        existing.byteLength !== part.byteLength ||
        (await resourceSha256(existing)) !== part.sha256
      )
        throw new TypeError('Existing upload spool will not be overwritten.');
    } else writePrivate(path, bytes);
  }
  const path = join(directory, 'request.json'),
    serialized = canonicalizeJson(body);
  if (existsSync(path)) {
    if (
      new TextDecoder('utf-8', { fatal: true }).decode(privateRead(path, 256 * 1024)) !== serialized
    )
      throw new TypeError('Existing spool request will not be overwritten.');
  } else writePrivate(path, new TextEncoder().encode(serialized));
  for (const ancestor of [directory, dirname(directory)]) {
    const fd = openSync(ancestor, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  return directory;
}
export async function persistUploadSpool(custody, root) {
  const body =
    custody.pendingCreate ??
    (custody.pendingMutation?.action === 'publish' ? custody.pendingMutation.body : null);
  if (!body) return;
  if (custody.spoolDirectory) {
    const reader = spoolChunkReader(custody.spoolDirectory, body);
    for (const part of body.manifest.chunks) await reader(part.index);
    return custody.spoolDirectory;
  }
  const chunks = uploadChunksFor(custody);
  if (!chunks)
    throw new TypeError('The pending upload has no durable spool; restore its recovery package.');
  const directory = await persistPreparedUploadSpool(
    body,
    chunks,
    join(resolve(root), custody.id, body.operationId),
  );
  for (let ancestor = dirname(directory); ; ancestor = dirname(ancestor)) {
    const fd = openSync(ancestor, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (ancestor === dirname(resolve(root))) break;
  }
  custody.spoolDirectory = directory;
  return directory;
}
export async function copyUploadSpool(custody, destination) {
  const body =
    custody.pendingCreate ??
    (custody.pendingMutation?.action === 'publish' ? custody.pendingMutation.body : null);
  if (!body) return null;
  if (existsSync(destination)) throw new TypeError('Recovery upload directory already exists.');
  const reader = spoolChunkReader(custody.spoolDirectory, body);
  ensurePrivateDirectory(destination, { label: 'Recovery upload' });
  for (const part of body.manifest.chunks)
    writePrivate(join(destination, `${part.index}.bin`), await reader(part.index));
  writePrivate(join(destination, 'request.json'), new TextEncoder().encode(canonicalizeJson(body)));
  const fd = openSync(destination, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return destination;
}
