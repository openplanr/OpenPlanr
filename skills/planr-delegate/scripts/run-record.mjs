import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { captureFileState } from './custody.mjs';

export const RUN_RECORD_SCHEMA_VERSION = '1.0.0';
export const MAX_RUN_RECORD_BYTES = 64 * 1024;
export const CLOSED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/u;
const CREDENTIAL = /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}/iu;

export class RunRecordError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RunRecordError';
    this.code = code;
  }
}

export function defaultRunDirectory() {
  return join(homedir(), '.openplanr', 'delegate', 'runs');
}

function checkedId(runId) {
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) {
    throw new RunRecordError('E_RUN_ID', 'Invalid delegated run identifier.');
  }
  return runId;
}

async function privateRoot(directory, create = false) {
  const path = resolve(directory ?? defaultRunDirectory());
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const physical = await realpath(path);
  const details = await stat(physical);
  if (!details.isDirectory() || (details.mode & 0o077) !== 0) {
    throw new RunRecordError('E_RUN_PRIVATE', 'Delegated run storage must be a private directory.');
  }
  return physical;
}

function encoded(record) {
  if (
    !record ||
    record.kind !== 'openplanr-delegation-run' ||
    record.schemaVersion !== RUN_RECORD_SCHEMA_VERSION ||
    !RUN_ID.test(record.runId ?? '')
  ) {
    throw new RunRecordError('E_RUN_FORMAT', 'Invalid delegated run record.');
  }
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
  if (bytes.length > MAX_RUN_RECORD_BYTES) {
    throw new RunRecordError('E_RUN_LIMIT', 'Delegated run record exceeds its private size limit.');
  }
  if (CREDENTIAL.test(bytes.toString('utf8'))) {
    throw new RunRecordError('E_RUN_CREDENTIAL', 'Credential material cannot enter a run record.');
  }
  return bytes;
}

export async function createRunRecord(record, { directory } = {}) {
  const root = await privateRoot(directory, true);
  const runId = checkedId(record?.runId ?? randomUUID());
  const normalized = {
    ...record,
    kind: 'openplanr-delegation-run',
    schemaVersion: RUN_RECORD_SCHEMA_VERSION,
    runId,
    createdAt: record?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const runPath = join(root, runId);
  await mkdir(runPath, { mode: 0o700 });
  try {
    await writeFile(join(runPath, 'record.json'), encoded(normalized), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await rm(runPath, { recursive: true, force: true });
    throw error;
  }
  return normalized;
}

export async function readRunRecord(runId, { directory } = {}) {
  const root = await privateRoot(directory);
  const runPath = join(root, checkedId(runId));
  const physical = await realpath(runPath);
  if (!physical.startsWith(`${root}${sep}`)) {
    throw new RunRecordError('E_RUN_PATH', 'Delegated run path escapes private storage.');
  }
  const file = join(physical, 'record.json');
  const details = await lstat(file);
  if (!details.isFile() || (details.mode & 0o077) !== 0 || details.size > MAX_RUN_RECORD_BYTES) {
    throw new RunRecordError('E_RUN_PRIVATE', 'Delegated run record is unsafe or oversized.');
  }
  let record;
  try {
    record = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new RunRecordError('E_RUN_FORMAT', 'Delegated run record cannot be parsed.');
  }
  encoded(record);
  if (record.runId !== runId) {
    throw new RunRecordError('E_RUN_FORMAT', 'Delegated run identifier does not match its record.');
  }
  return record;
}

export async function updateRunRecord(runId, changes, { directory } = {}) {
  const current = await readRunRecord(runId, { directory });
  const root = await privateRoot(directory);
  const next = {
    ...current,
    ...changes,
    kind: current.kind,
    schemaVersion: current.schemaVersion,
    runId: current.runId,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const temporary = join(root, runId, `.record-${randomUUID()}.tmp`);
  await writeFile(temporary, encoded(next), { flag: 'wx', mode: 0o600 });
  try {
    await rename(temporary, join(root, runId, 'record.json'));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return next;
}

export function compactIntegrationState(state) {
  if (state.kind === 'absent') return { kind: 'absent' };
  if (state.kind === 'symlink')
    return { kind: 'symlink', mode: state.mode, target: state.target };
  return { kind: 'file', mode: state.mode, digest: state.digest };
}

export async function verifyIntegrationState(record) {
  if (record.integration?.status !== 'applied' || !record.integration.states)
    return { recorded: false, driftPaths: [] };
  const driftPaths = [];
  for (const [path, expected] of Object.entries(record.integration.states)) {
    try {
      const actual = compactIntegrationState(await captureFileState(record.repositoryRoot, path));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) driftPaths.push(path);
    } catch {
      driftPaths.push(path);
    }
  }
  return { recorded: true, driftPaths };
}

export async function closeRunRecord(runId, { disposition, directory } = {}) {
  if (!['integrated', 'abandoned'].includes(disposition)) {
    throw new RunRecordError('E_RUN_CLOSE', 'Closure requires integrated or abandoned disposition.');
  }
  const record = await readRunRecord(runId, { directory });
  if (record.status === 'closed') {
    if (record.disposition === disposition) return record;
    throw new RunRecordError('E_RUN_CLOSE', 'Closed run has a different disposition.');
  }
  if (record.status === 'running' || record.status === 'resuming') {
    throw new RunRecordError('E_RUN_ACTIVE', 'An active delegated run cannot be closed.');
  }
  if (disposition === 'integrated') {
    if (record.status !== 'completed' || record.integration?.status !== 'applied')
      throw new RunRecordError('E_RUN_NOT_INTEGRATED', 'An integrated closure requires a completed run applied through the integration helper.');
    const verification = await verifyIntegrationState(record);
    if (verification.driftPaths.length)
      throw new RunRecordError('E_RUN_INTEGRATION_DRIFT', 'Accepted source files changed after integration; review them as separate host-authored work.');
  } else if (record.integration?.status === 'applied') {
    throw new RunRecordError('E_RUN_ALREADY_INTEGRATED', 'An applied run cannot be abandoned without separately reviewing its source diff.');
  }
  return updateRunRecord(
    runId,
    { status: 'closed', disposition, closedAt: new Date().toISOString(), activePid: null },
    { directory },
  );
}

export async function pruneClosedRunRecords({ directory, now = Date.now(), retentionMs = CLOSED_RETENTION_MS } = {}) {
  if (!Number.isSafeInteger(retentionMs) || retentionMs < 0) {
    throw new RunRecordError('E_RUN_RETENTION', 'Retention must be a nonnegative duration.');
  }
  const root = await privateRoot(directory);
  const removed = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !RUN_ID.test(entry.name)) continue;
    let record;
    try {
      record = await readRunRecord(entry.name, { directory: root });
    } catch {
      continue;
    }
    if (
      record.status !== 'closed' ||
      !['integrated', 'abandoned'].includes(record.disposition) ||
      !Number.isFinite(Date.parse(record.closedAt ?? '')) ||
      now - Date.parse(record.closedAt) < retentionMs
    ) continue;
    await rm(join(root, entry.name), { recursive: true });
    removed.push(entry.name);
  }
  return removed;
}
