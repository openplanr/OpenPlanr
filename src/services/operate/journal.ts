import { randomUUID } from 'node:crypto';
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { canonicalize, sha256Digest } from './canonical.js';
import { assertOperatingArtifact } from './protocol.js';
import {
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingEventHead,
  type OperatingTransactionJournal,
} from './types.js';
import { resolveContainedPath, resolveOperatingPaths } from './workspace.js';

export interface JournalWrite {
  relativePath: string;
  content: string | Uint8Array;
  operation?: 'create' | 'replace' | 'append';
  mode?: `0${string}`;
}

export interface PreparedJournal {
  root: string;
  manifestPath: string;
  record: OperatingTransactionJournal;
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r').catch(() => null);
  if (!handle) return;
  try {
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close();
  }
}

async function atomicBytes(target: string, bytes: Uint8Array, mode = 0o600): Promise<void> {
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(target)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  await syncDirectory(directory);
}

async function writeJournal(target: string, record: OperatingTransactionJournal): Promise<void> {
  await assertOperatingArtifact('operating-transaction-journal', record);
  await atomicBytes(target, Buffer.from(`${canonicalize(record)}\n`));
}

function parseMode(value: string): number {
  return Number.parseInt(value.slice(1), 8);
}

function headsEqual(left: OperatingEventHead, right: OperatingEventHead): boolean {
  return left.sequence === right.sequence && left.hash === right.hash;
}

export async function prepareJournalTransaction(
  projectRoot: string,
  input: {
    writes: JournalWrite[];
    eventHead: OperatingEventHead;
    previewDigest: `sha256:${string}`;
    transactionId?: string;
    localRoot?: string;
    now?: string;
  },
): Promise<PreparedJournal> {
  if (input.writes.length === 0) {
    throw new OperateError('E_OPERATE_TRANSACTION_INVALID', 'A transaction requires writes.');
  }
  if (new Set(input.writes.map((write) => write.relativePath)).size !== input.writes.length) {
    throw new OperateError(
      'E_OPERATE_TRANSACTION_INVALID',
      'A transaction cannot target the same path twice.',
    );
  }
  const transactionId = input.transactionId ?? `TXN-${randomUUID()}`;
  const root = path.join(
    resolveOperatingPaths(projectRoot, { localRoot: input.localRoot }).transactions,
    transactionId,
  );
  const beforeRoot = path.join(root, 'before');
  const afterRoot = path.join(root, 'after');
  await Promise.all([
    mkdir(beforeRoot, { recursive: true, mode: 0o700 }),
    mkdir(afterRoot, { recursive: true, mode: 0o700 }),
  ]);

  const materials: Array<{ before: Buffer | null; after: Buffer }> = [];
  const writes: OperatingTransactionJournal['writes'] = [];
  for (const write of input.writes) {
    const target = await resolveContainedPath(projectRoot, write.relativePath);
    const targetExists = await exists(target);
    if (targetExists) {
      const info = await lstat(target);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new OperateError(
          'E_OPERATE_PATH_ESCAPE',
          `Transaction target is not a regular file: ${write.relativePath}`,
        );
      }
    }
    const before = targetExists ? await readFile(target) : null;
    const supplied = Buffer.from(write.content);
    const operation = write.operation ?? (targetExists ? 'replace' : 'create');
    if (operation === 'create' && targetExists) {
      throw new OperateError(
        'E_OPERATE_TRANSACTION_INVALID',
        `Create destination already exists: ${write.relativePath}`,
      );
    }
    if (operation !== 'create' && !targetExists) {
      throw new OperateError(
        'E_OPERATE_TRANSACTION_INVALID',
        `${operation} destination does not exist: ${write.relativePath}`,
      );
    }
    const after = operation === 'append' ? Buffer.concat([before as Buffer, supplied]) : supplied;
    materials.push({ before, after });
    writes.push({
      path: write.relativePath,
      operation,
      beforeDigest: before ? sha256Digest(before) : null,
      afterDigest: sha256Digest(after),
      mode: write.mode ?? '0600',
    });
  }
  const now = input.now ?? new Date().toISOString();
  const record: OperatingTransactionJournal = {
    kind: 'operating-transaction-journal',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    transactionId,
    state: 'prepared',
    eventHead: structuredClone(input.eventHead),
    previewDigest: input.previewDigest,
    createdAt: now,
    updatedAt: now,
    writes,
  };
  const manifestPath = path.join(root, 'journal.json');
  await writeJournal(manifestPath, record);
  try {
    for (const [index, material] of materials.entries()) {
      if (material.before) await atomicBytes(path.join(beforeRoot, String(index)), material.before);
      await atomicBytes(path.join(afterRoot, String(index)), material.after);
    }
    await Promise.all([syncDirectory(beforeRoot), syncDirectory(afterRoot), syncDirectory(root)]);
    record.state = 'staged-fsynced';
    record.updatedAt = new Date().toISOString();
    await writeJournal(manifestPath, record);
  } catch (error) {
    record.state = 'failed';
    record.failureCode = 'E_OPERATE_TRANSACTION_INVALID';
    record.updatedAt = new Date().toISOString();
    await writeJournal(manifestPath, record).catch(() => undefined);
    throw error;
  }
  return { root, manifestPath, record };
}

async function restoreWrite(
  projectRoot: string,
  prepared: PreparedJournal,
  index: number,
): Promise<void> {
  const write = prepared.record.writes[index];
  const target = await resolveContainedPath(projectRoot, write.path);
  if (write.beforeDigest === null) {
    await unlink(target).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
    await syncDirectory(path.dirname(target));
    return;
  }
  const before = await readFile(path.join(prepared.root, 'before', String(index)));
  if (sha256Digest(before) !== write.beforeDigest) {
    throw new OperateError(
      'E_OPERATE_TRANSACTION_INVALID',
      `Transaction backup ${index} failed integrity verification.`,
    );
  }
  await atomicBytes(target, before, parseMode(write.mode));
}

export async function rollbackJournalTransaction(
  projectRoot: string,
  prepared: PreparedJournal,
): Promise<OperatingTransactionJournal> {
  for (let index = prepared.record.writes.length - 1; index >= 0; index -= 1) {
    const write = prepared.record.writes[index];
    const target = await resolveContainedPath(projectRoot, write.path);
    const current = await readFile(target).catch(() => null);
    if (current && sha256Digest(current) === write.afterDigest) {
      await restoreWrite(projectRoot, prepared, index);
    }
  }
  prepared.record.state = 'rolled-back';
  prepared.record.updatedAt = new Date().toISOString();
  await writeJournal(prepared.manifestPath, prepared.record);
  return prepared.record;
}

export async function applyJournalTransaction(
  projectRoot: string,
  prepared: PreparedJournal,
  options: {
    currentEventHead: OperatingEventHead;
    revalidateEventHead?: () => Promise<OperatingEventHead>;
    beforeTransition?: (
      transition: 'promote-write' | 'promoted' | 'committed',
      index?: number,
    ) => Promise<void> | void;
  },
): Promise<OperatingTransactionJournal> {
  if (
    prepared.record.state !== 'staged-fsynced' ||
    !headsEqual(prepared.record.eventHead, options.currentEventHead)
  ) {
    throw new OperateError('E_OPERATE_ROUTE_DRIFT', 'Transaction preview is stale.');
  }
  try {
    for (const [index, write] of prepared.record.writes.entries()) {
      const currentHead = options.revalidateEventHead
        ? await options.revalidateEventHead()
        : options.currentEventHead;
      if (!headsEqual(prepared.record.eventHead, currentHead)) {
        throw new OperateError(
          'E_OPERATE_ROUTE_DRIFT',
          'Event head changed while promoting a transaction.',
        );
      }
      await options.beforeTransition?.('promote-write', index);
      const target = await resolveContainedPath(projectRoot, write.path);
      const current = await readFile(target).catch(() => null);
      const currentDigest = current ? sha256Digest(current) : null;
      if (currentDigest !== write.beforeDigest) {
        throw new OperateError(
          'E_OPERATE_ROUTE_DRIFT',
          `Destination changed after preview: ${write.path}`,
        );
      }
      const after = await readFile(path.join(prepared.root, 'after', String(index)));
      if (sha256Digest(after) !== write.afterDigest) {
        throw new OperateError(
          'E_OPERATE_TRANSACTION_INVALID',
          `Staged write ${index} failed integrity verification.`,
        );
      }
      await atomicBytes(target, after, parseMode(write.mode));
      await chmod(target, parseMode(write.mode));
    }
    await options.beforeTransition?.('promoted');
    prepared.record.state = 'promoted';
    prepared.record.updatedAt = new Date().toISOString();
    await writeJournal(prepared.manifestPath, prepared.record);
    await options.beforeTransition?.('committed');
    prepared.record.state = 'committed';
    prepared.record.updatedAt = new Date().toISOString();
    await writeJournal(prepared.manifestPath, prepared.record);
    return prepared.record;
  } catch (error) {
    await rollbackJournalTransaction(projectRoot, prepared).catch(() => undefined);
    throw error;
  }
}

export async function readJournal(manifestPath: string): Promise<OperatingTransactionJournal> {
  const record = JSON.parse(await readFile(manifestPath, 'utf8')) as OperatingTransactionJournal;
  return assertOperatingArtifact('operating-transaction-journal', record);
}

export async function assertCommittedOperatingView(
  projectRoot: string,
  options: { localRoot?: string } = {},
): Promise<void> {
  const transactions = resolveOperatingPaths(projectRoot, options).transactions;
  const names = await readdir(transactions).catch(() => []);
  for (const name of names) {
    const manifest = path.join(transactions, name, 'journal.json');
    const record = await readJournal(manifest).catch(() => null);
    if (record && !['committed', 'rolled-back', 'failed'].includes(record.state)) {
      throw new OperateError(
        'E_OPERATE_TRANSACTION_INVALID',
        `Transaction ${record.transactionId} is not committed; readers will not expose partial state.`,
        { transactionId: record.transactionId, state: record.state },
      );
    }
  }
}

export async function recoverOperatingTransactions(
  projectRoot: string,
  options: { localRoot?: string } = {},
): Promise<string[]> {
  const transactions = resolveOperatingPaths(projectRoot, options).transactions;
  const recovered: string[] = [];
  for (const name of await readdir(transactions).catch(() => [])) {
    const root = path.join(transactions, name);
    const manifestPath = path.join(root, 'journal.json');
    const record = await readJournal(manifestPath).catch(() => null);
    if (!record || ['committed', 'rolled-back', 'failed'].includes(record.state)) continue;
    await rollbackJournalTransaction(projectRoot, { root, manifestPath, record });
    recovered.push(record.transactionId);
  }
  return recovered.sort();
}
