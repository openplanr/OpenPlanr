import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

interface Writer {
  pid: number;
  ticket: number;
  name: string;
}

/**
 * A filesystem bakery lock: each writer owns a unique record, announces selection
 * with ticket zero, then waits for earlier (ticket, name) pairs. Unlike replacing
 * one shared lock, reclaiming a dead writer cannot unlink a new owner's lock.
 * This serializes the complete encrypted-file read/modify/write across processes.
 */
export async function withCredentialWriteLock<T>(
  planrDirectory: string,
  action: () => Promise<T>,
  timeoutMs = 15000,
): Promise<T> {
  const directory = path.join(planrDirectory, '.credential-writers');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(
      'The credential writer directory is unsafe. Existing credentials were preserved.',
    );
  const name = `${process.pid}-${randomUUID()}.json`;
  const file = path.join(directory, name);
  const deadline = Date.now() + timeoutMs;
  async function announce(ticket: number) {
    const temporary = `${file}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, ticket }));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async function writers(): Promise<Writer[]> {
    const result: Writer[] = [];
    for (const entry of await readdir(directory)) {
      if (!entry.endsWith('.json')) continue;
      const match = /^([1-9]\d*)-([a-f0-9-]{36})\.json$/.exec(entry);
      if (!match)
        throw new Error('Credential writer state is invalid. Existing credentials were preserved.');
      const entryPath = path.join(directory, entry);
      try {
        const info = await lstat(entryPath);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 1024)
          throw new Error(
            'Credential writer state is unsafe. Existing credentials were preserved.',
          );
        const value = JSON.parse(await readFile(entryPath, 'utf8')) as Writer;
        if (
          value.pid !== Number(match[1]) ||
          !Number.isSafeInteger(value.pid) ||
          !Number.isSafeInteger(value.ticket) ||
          value.ticket < 0
        )
          throw new Error(
            'Credential writer state is invalid. Existing credentials were preserved.',
          );
        let dead = false;
        try {
          process.kill(value.pid, 0);
        } catch (error) {
          dead = (error as NodeJS.ErrnoException).code === 'ESRCH';
        }
        if (dead) {
          // Names are never reused, so overlapping reclaimers cannot remove a new owner.
          await unlink(entryPath).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
          });
          continue;
        }
        result.push({ ...value, name: entry });
      } catch (error) {
        // A writer can finish between directory enumeration and opening its record.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return result;
  }
  try {
    await announce(0);
    const ticket = Math.max(0, ...(await writers()).map((writer) => writer.ticket)) + 1;
    if (!Number.isSafeInteger(ticket)) throw new Error('Credential writer ticket limit reached.');
    await announce(ticket);
    for (;;) {
      const blocked = (await writers()).some(
        (writer) =>
          writer.name !== name &&
          (writer.ticket === 0 ||
            writer.ticket < ticket ||
            (writer.ticket === ticket && writer.name < name)),
      );
      if (!blocked) break;
      if (Date.now() >= deadline)
        throw new Error(
          'Another credential update is still running. Retry after it finishes; existing credentials were preserved.',
        );
      await delay(20);
    }
    return await action();
  } finally {
    await unlink(file).catch(() => {});
  }
}
