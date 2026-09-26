import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CompanySyncError, releasedLock } from './company-common.js';

export type StoredCredentialSource = 'keychain' | 'encrypted-file';
export interface CompanyCredentialStore {
  save(provider: string, content: string): Promise<StoredCredentialSource>;
  read(provider: string, source: StoredCredentialSource): Promise<string | undefined>;
  remove(provider: string, source: StoredCredentialSource): Promise<boolean>;
  manual(origin: string): Promise<string | undefined>;
  saveManual(origin: string, token: string): Promise<StoredCredentialSource>;
  clearManual(origin: string): Promise<void>;
}

/** Private metadata only. Token material stays in the existing credential service. */
export class CompanyAuthStore {
  constructor(readonly directory = path.join(os.homedir(), '.planr', 'company-auth')) {}

  private async prepare(): Promise<void> {
    const parent = path.dirname(this.directory);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    for (const directory of [parent, this.directory]) {
      await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new CompanySyncError(
          'E_COMPANY_AUTH_STORE',
          'Authentication storage must be a private directory without symbolic links.',
        );
    }
    await chmod(this.directory, 0o700);
  }

  private recordPath(origin: string): string {
    return path.join(this.directory, `${createHash('sha256').update(origin).digest('hex')}.json`);
  }

  async read(origin: string): Promise<unknown | undefined> {
    await this.prepare();
    const file = this.recordPath(origin);
    try {
      const info = await lstat(file);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 65536 ||
        (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      )
        throw new Error('unsafe metadata');
      return JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new CompanySyncError(
        'E_COMPANY_AUTH_STORE',
        'Stored sign-in metadata is invalid or unsafe. No tokens were sent.',
      );
    }
  }

  async write(origin: string, value: unknown): Promise<void> {
    await this.prepare();
    await this.atomicWrite(this.recordPath(origin), JSON.stringify(value));
  }

  private async atomicWrite(file: string, content: string): Promise<void> {
    if (Buffer.byteLength(content) > 65536)
      throw new CompanySyncError(
        'E_COMPANY_AUTH_STORE',
        'Authentication metadata exceeds its supported size.',
      );
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, file);
      if (process.platform !== 'win32') {
        const directory = await open(path.dirname(file), 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  /** Across CLI processes, only one company credential write/refresh can run at once. */
  async locked<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.prepare();
    const lock = path.join(this.directory, '.lock');
    const nonce = randomUUID();
    const ownerPath = `${lock}.${nonce}.owner`;
    const owner = JSON.stringify({ pid: process.pid, nonce });
    await this.atomicWrite(ownerPath, owner);
    const deadline = Date.now() + 30000;
    let acquired = false;
    try {
      while (!acquired) {
        if (signal?.aborted)
          throw new CompanySyncError('E_COMPANY_AUTH_CANCELLED', 'Sign-in was cancelled.');
        try {
          await link(ownerPath, lock);
          acquired = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const info = await lstat(lock).catch(releasedLock);
          if (info === null) continue;
          if (!info.isFile() || info.isSymbolicLink() || info.size > 1024)
            throw new CompanySyncError('E_COMPANY_AUTH_STORE', 'Authentication lock is invalid.');
          const raw = await readFile(lock, 'utf8').catch(releasedLock);
          if (raw === null) continue;
          let previous: { pid: number; nonce: string };
          try {
            previous = JSON.parse(raw);
          } catch {
            throw new CompanySyncError('E_COMPANY_AUTH_STORE', 'Authentication lock is invalid.');
          }
          if (
            !Number.isSafeInteger(previous.pid) ||
            previous.pid < 1 ||
            !/^[a-f0-9-]{36}$/.test(previous.nonce)
          )
            throw new CompanySyncError(
              'E_COMPANY_AUTH_STORE',
              'Authentication lock owner is invalid.',
            );
          let terminated = false;
          try {
            process.kill(previous.pid, 0);
          } catch (check) {
            terminated = (check as NodeJS.ErrnoException).code === 'ESRCH';
          }
          if (terminated) {
            const recoveryPath = `${lock}.recovery-${previous.nonce}`;
            const recovery = await open(recoveryPath, 'wx', 0o600).catch(() => undefined);
            if (recovery) {
              try {
                if ((await readFile(lock, 'utf8')) === raw) await unlink(lock);
              } catch (check) {
                if ((check as NodeJS.ErrnoException).code !== 'ENOENT') throw check;
              } finally {
                await recovery.close();
                await unlink(recoveryPath);
              }
              continue;
            }
          }
          if (Date.now() >= deadline)
            throw new CompanySyncError(
              'E_COMPANY_AUTH_BUSY',
              'Another authentication operation is still running. Retry after it finishes.',
            );
          await delay(50, undefined, { signal }).catch(() => {
            throw new CompanySyncError('E_COMPANY_AUTH_CANCELLED', 'Sign-in was cancelled.');
          });
        }
      }
      return await action();
    } finally {
      if (acquired && (await readFile(lock, 'utf8').catch(() => '')) === owner) await unlink(lock);
      await unlink(ownerPath).catch(() => {});
    }
  }
}
