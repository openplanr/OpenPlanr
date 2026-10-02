import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { type FileHandle, link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { parseExternalJson } from '../utils/external-json.js';
import { withCredentialWriteLock } from './credential-write-lock.js';

const MAX_BYTES = 1024 * 1024;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const unsafe = (cause?: unknown) =>
  new Error(
    'Previous credential storage is unsafe or incomplete. Existing files were preserved; recover them in the previous OpenPlanr home before retrying.',
    { cause },
  );

async function normalizedDirectory(directory: string): Promise<string> {
  const resolved = path.resolve(directory);
  // macOS exposes these system directories through documented filesystem aliases.
  if (process.platform === 'darwin') {
    for (const alias of ['/tmp', '/var']) {
      if (resolved === alias || resolved.startsWith(`${alias}/`))
        return path.join(await realpath(alias), path.relative(alias, resolved));
    }
  }
  return resolved;
}

/** Validate private custody without repairing permissions or following user symlinks. */
export async function assertPrivateCredentialDirectory(directory: string): Promise<void> {
  directory = await normalizedDirectory(directory);
  const root = path.parse(directory).root;
  const segments = path.relative(root, directory).split(path.sep).filter(Boolean);
  if (segments.length > 128) throw unsafe();
  let ancestor = root;
  for (const segment of segments) {
    ancestor = path.join(ancestor, segment);
    const info = await lstat(ancestor);
    if (!info.isDirectory() || info.isSymbolicLink()) throw unsafe();
    // Only root or the current user may control an ancestor's directory entries.
    // Shared sticky directories such as /tmp protect entries from other users.
    // Writable non-sticky ancestors let other users replace a private custody leaf.
    if (
      process.platform !== 'win32' &&
      ((info.uid !== 0 && info.uid !== process.getuid?.()) ||
        ((info.mode & 0o022) !== 0 && (info.mode & 0o1000) === 0))
    )
      throw unsafe();
  }
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
  )
    throw unsafe();
}

async function privateBytes(file: string): Promise<Buffer | undefined> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.size < 1 ||
      before.size > MAX_BYTES ||
      (process.platform !== 'win32' &&
        ((before.mode & 0o077) !== 0 || before.uid !== process.getuid?.()))
    )
      throw unsafe();
    const bytes = Buffer.alloc(before.size);
    for (let offset = 0; offset < bytes.length; ) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw unsafe();
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw unsafe();
    return bytes;
  } catch (error) {
    if (missing(error)) return undefined;
    throw unsafe(error);
  } finally {
    await handle?.close();
  }
}

function validate(name: string, bytes: Buffer): void {
  if (name === '.credential-salt') {
    if (!/^[a-f0-9]{32}\s*$/iu.test(bytes.toString('utf8'))) throw unsafe();
    return;
  }
  try {
    parseExternalJson(
      bytes.toString('utf8'),
      z.record(z.string(), z.unknown()),
      'Previous credential record',
      { secret: true },
    );
  } catch (error) {
    throw unsafe(error);
  }
}

/** Copy previous CLI custody only when absent; keep original bytes for recovery. */
export async function migratePrivateCredentialHome(
  selected: string,
  legacy: string | undefined,
  names: readonly [string, ...string[]],
  store: 'encrypted' | 'legacy',
): Promise<void> {
  if (!legacy) return;
  selected = await normalizedDirectory(selected);
  legacy = await normalizedDirectory(legacy);
  if (selected === legacy) return;
  try {
    await assertPrivateCredentialDirectory(selected);
  } catch (error) {
    if (!missing(error)) throw unsafe(error);
  }
  const receipt = path.join(selected, `.migrated-${names[0]}.json`);
  const receiptBytes = Buffer.from(
    JSON.stringify({ version: 1, source: path.resolve(legacy), primary: names[0] }),
  );
  const validateCurrent = async () => {
    const primary = await privateBytes(path.join(selected, names[0]));
    if (!primary) return false;
    for (const name of names) {
      const bytes = await privateBytes(path.join(selected, name));
      if (!bytes) throw unsafe();
      validate(name, bytes);
    }
    return true;
  };
  const priorReceipt = await privateBytes(receipt);
  if (priorReceipt) {
    if (!priorReceipt.equals(receiptBytes)) throw unsafe();
    await validateCurrent();
    return;
  }
  try {
    await assertPrivateCredentialDirectory(legacy);
  } catch (error) {
    if (missing(error)) return;
    throw unsafe(error);
  }
  await mkdir(selected, { recursive: true, mode: 0o700 });
  await assertPrivateCredentialDirectory(selected);
  const roots = [selected, legacy].sort();
  const publish = async (target: string, bytes: Buffer) => {
    const prior = await privateBytes(target);
    if (prior) {
      if (!prior.equals(bytes)) throw unsafe();
      return;
    }
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporary, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = await privateBytes(target);
        if (!existing?.equals(bytes)) throw unsafe(error);
      }
    } finally {
      await unlink(temporary).catch((error) => {
        if (!missing(error)) throw error;
      });
    }
  };
  const copy = async () => {
    if (await validateCurrent()) return complete();
    const first = await privateBytes(path.join(legacy, names[0]));
    // Record an empty legacy store too: later reads can run inside its writer lock.
    if (!first) return complete();
    const snapshot = new Map<string, Buffer>([[names[0], first]]);
    for (const name of names.slice(1)) {
      const bytes = await privateBytes(path.join(legacy, name));
      if (!bytes) throw unsafe();
      snapshot.set(name, bytes);
    }
    for (const [name, bytes] of snapshot) validate(name, bytes);
    // Publish prerequisites before the primary record. An interrupted copy is retryable.
    for (const name of [...names.slice(1), names[0]]) {
      const bytes = snapshot.get(name);
      if (!bytes) throw unsafe();
      await publish(path.join(selected, name), bytes);
    }
    await complete();
  };
  const complete = async () => {
    await publish(receipt, receiptBytes);
    if (process.platform !== 'win32') {
      const directory = await open(selected, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  };
  await withCredentialWriteLock(
    roots[0],
    () => withCredentialWriteLock(roots[1], copy, 15000, store),
    15000,
    store,
  );
}
