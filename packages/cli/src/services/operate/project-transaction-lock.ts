import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertOperatePathCustody } from './path-custody.js';

const TRANSACTION_LOCK_FILE = '.operate-transaction-lock.json';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_MS = 25;

type TransactionRecord = Readonly<{
  kind: 'operate-project-transaction';
  schemaVersion: '1.0.0';
  pid: number;
  nonce: string;
  createdAt: number;
}>;

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function conflict(message: string): Error {
  return Object.assign(new Error(message), { code: 'OPERATE_STORE_CONFLICT' });
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function parseRecord(raw: string): TransactionRecord {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    throw conflict('The Operate transaction lock is unreadable.');
  }
  const value = candidate as Partial<TransactionRecord> | null;
  if (
    value === null ||
    typeof value !== 'object' ||
    value.kind !== 'operate-project-transaction' ||
    value.schemaVersion !== '1.0.0' ||
    !Number.isSafeInteger(value.pid) ||
    Number(value.pid) < 1 ||
    typeof value.nonce !== 'string' ||
    !/^[a-f0-9]{32}$/u.test(value.nonce) ||
    !Number.isSafeInteger(value.createdAt) ||
    Number(value.createdAt) < 0 ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(['createdAt', 'kind', 'nonce', 'pid', 'schemaVersion'])
  ) {
    throw conflict('The Operate transaction lock has an invalid identity.');
  }
  return value as TransactionRecord;
}

async function readLock(
  lockPath: string,
): Promise<Readonly<{ raw: string; record: TransactionRecord }> | null> {
  const metadata = await lstat(lockPath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (metadata === null) return null;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1024) {
    throw conflict('The Operate transaction lock is unsafe.');
  }
  const raw = await readFile(lockPath, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  return raw === null ? null : Object.freeze({ raw, record: parseRecord(raw) });
}

async function removeExactLock(lockPath: string, expectedRaw: string): Promise<boolean> {
  const current = await readLock(lockPath);
  if (current === null) return true;
  if (current.raw !== expectedRaw) return false;
  await rm(lockPath);
  return true;
}

/** Serializes every project-local Operate writer, migration, and rollback. */
export async function withOperateProjectTransaction<T>(
  projectDir: string,
  action: () => Promise<T>,
  options: Readonly<{ timeoutMs?: number; pollMs?: number }> = {},
): Promise<T> {
  const canonicalProject = path.resolve(projectDir);
  const planrRoot = path.join(canonicalProject, '.planr');
  const lockPath = path.join(planrRoot, TRANSACTION_LOCK_FILE);
  await assertOperatePathCustody(canonicalProject, lockPath, {
    code: 'OPERATE_STORE_INCOMPATIBLE',
    message: 'Operate transaction custody cannot traverse symbolic links.',
  });
  await mkdir(planrRoot, { recursive: true, mode: 0o700 });
  await assertOperatePathCustody(canonicalProject, planrRoot, {
    code: 'OPERATE_STORE_INCOMPATIBLE',
    message: 'Operate transaction custody cannot traverse symbolic links.',
    requireDirectory: true,
  });
  if (process.platform !== 'win32') await chmod(planrRoot, 0o700);

  const createdAt = Date.now();
  const record: TransactionRecord = Object.freeze({
    kind: 'operate-project-transaction',
    schemaVersion: '1.0.0',
    pid: process.pid,
    nonce: randomUUID().replaceAll('-', ''),
    createdAt,
  });
  const serialized = `${JSON.stringify(record)}\n`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;

  for (;;) {
    try {
      await writeFile(lockPath, serialized, { flag: 'wx', mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const current = await readLock(lockPath);
      if (current === null) continue;
      if (!processIsAlive(current.record.pid)) {
        if (await removeExactLock(lockPath, current.raw)) continue;
      }
      if (Date.now() - createdAt >= timeoutMs) {
        throw conflict('Timed out waiting for another Operate transaction to finish.');
      }
      await wait(pollMs);
    }
  }

  let outcome: Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }>;
  try {
    outcome = Object.freeze({ ok: true, value: await action() });
  } catch (error) {
    outcome = Object.freeze({ ok: false, error });
  }

  try {
    if (!(await removeExactLock(lockPath, serialized))) {
      throw conflict('Operate transaction ownership changed before release.');
    }
  } catch (releaseError) {
    throw Object.assign(conflict('Operate transaction ownership could not be released safely.'), {
      cause: releaseError,
      actionError: outcome.ok ? undefined : outcome.error,
    });
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
