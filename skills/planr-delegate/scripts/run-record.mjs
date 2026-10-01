import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { captureFileState } from './custody.mjs';

export const RUN_RECORD_SCHEMA_VERSION = '1.0.0';
export const MAX_RUN_RECORD_BYTES = 64 * 1024;
export const CLOSED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/u;
const CREDENTIAL =
  /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}/iu;

const execute = promisify(execFile);

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

export function assertRunRecordFits(record) {
  encoded(record);
  return record;
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
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
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
  if (state.kind === 'symlink') return { kind: 'symlink', mode: state.mode, target: state.target };
  return { kind: 'file', mode: state.mode, digest: state.digest };
}

export async function verifyIntegrationState(record) {
  if (record.integration?.status !== 'applied' || !record.integration.states)
    return { recorded: false, driftPaths: [] };
  const driftPaths = [];
  const inspectionFailures = [];
  for (const [path, expected] of Object.entries(record.integration.states)) {
    try {
      const actual = compactIntegrationState(await captureFileState(record.repositoryRoot, path));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) driftPaths.push(path);
    } catch (error) {
      driftPaths.push(path);
      inspectionFailures.push({
        path,
        code: error.code ?? error.name,
        cause: error.details?.cause ?? error.code ?? error.name,
      });
    }
  }
  return {
    recorded: true,
    driftPaths,
    ...(inspectionFailures.length ? { inspectionFailures } : {}),
  };
}

export async function closeRunRecord(runId, { disposition, directory } = {}) {
  if (!['integrated', 'abandoned'].includes(disposition)) {
    throw new RunRecordError(
      'E_RUN_CLOSE',
      'Closure requires integrated or abandoned disposition.',
    );
  }
  const record = await readRunRecord(runId, { directory });
  if (['applying', 'interrupted'].includes(record.integration?.status)) {
    throw new RunRecordError(
      'E_RUN_INTEGRATION_RECOVERY',
      'Integration is unresolved; use the integration recovery action before closing.',
    );
  }
  if (record.status === 'closed') {
    if (record.disposition === disposition) return record;
    throw new RunRecordError('E_RUN_CLOSE', 'Closed run has a different disposition.');
  }
  if (record.status === 'running' || record.status === 'resuming') {
    throw new RunRecordError('E_RUN_ACTIVE', 'An active delegated run cannot be closed.');
  }
  if (disposition === 'integrated') {
    if (record.status !== 'completed' || record.integration?.status !== 'applied')
      throw new RunRecordError(
        'E_RUN_NOT_INTEGRATED',
        'An integrated closure requires a completed run applied through the integration helper.',
      );
    const verification = await verifyIntegrationState(record);
    if (verification.driftPaths.length)
      throw new RunRecordError(
        'E_RUN_INTEGRATION_DRIFT',
        'Accepted source files changed after integration; review them as separate host-authored work.',
      );
  } else if (record.integration?.status === 'applied') {
    throw new RunRecordError(
      'E_RUN_ALREADY_INTEGRATED',
      'An applied run cannot be abandoned without separately reviewing its source diff.',
    );
  }
  return updateRunRecord(
    runId,
    { status: 'closed', disposition, closedAt: new Date().toISOString(), activePid: null },
    { directory },
  );
}

export async function pruneClosedRunRecords({
  directory,
  now = Date.now(),
  retentionMs = CLOSED_RETENTION_MS,
} = {}) {
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
    } catch (error) {
      throw new RunRecordError(
        error.code ?? 'E_RUN_PRUNE_RECORD',
        `Cannot inspect run ${entry.name} for pruning: ${error.message}`,
      );
    }
    if (
      record.status !== 'closed' ||
      !['integrated', 'abandoned'].includes(record.disposition) ||
      !Number.isFinite(Date.parse(record.closedAt ?? '')) ||
      now - Date.parse(record.closedAt) < retentionMs
    )
      continue;
    if (
      (await pathExists(join(root, entry.name, 'transition.lock'))) ||
      (await pathExists(join(root, entry.name, 'transition.acquire')))
    )
      throw new RunRecordError(
        'E_RUN_LOCKED',
        `Run ${entry.name} has an active transition; retry pruning later.`,
      );
    if (record.worktreePath && (await pathExists(record.worktreePath))) {
      throw new RunRecordError(
        'E_RUN_WORKTREE_RETAINED',
        `Run ${entry.name} retains its worktree; run cleanup before pruning.`,
      );
    }
    await rm(join(root, entry.name), { recursive: true });
    removed.push(entry.name);
  }
  return removed;
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// A PID alone can be reused. Linux exposes monotonic start ticks; macOS ps
// provides the process start timestamp. Store no command line or environment.
export async function processIdentity(pid = process.pid) {
  if (!Number.isSafeInteger(pid) || pid < 1)
    throw new RunRecordError('E_RUN_PROCESS_IDENTITY', 'Invalid process identifier.');
  if (process.platform === 'linux') {
    try {
      const source = await readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = source
        .slice(source.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/u);
      return { pid, started: fields[19], source: 'proc-start-ticks' };
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
      throw new RunRecordError('E_RUN_PROCESS_IDENTITY', 'Cannot inspect process start identity.');
    }
  }
  try {
    const { stdout } = await execute('ps', ['-p', String(pid), '-o', 'lstart='], {
      timeout: 5000,
      maxBuffer: 4096,
    });
    const started = stdout.trim();
    return started ? { pid, started, source: 'ps-start-time' } : null;
  } catch (error) {
    if (error.code === 1) return null;
    throw new RunRecordError('E_RUN_PROCESS_IDENTITY', 'Cannot inspect process start identity.');
  }
}

export async function processIdentityState(identity) {
  if (!identity?.pid || !identity.started) return 'unknown';
  try {
    process.kill(identity.pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return 'exited';
    if (error.code === 'EPERM') return 'unknown';
    throw error;
  }
  const current = await processIdentity(identity.pid);
  if (!current) return 'exited';
  return current.started === identity.started && current.source === identity.source
    ? 'alive'
    : 'reused';
}

async function claimRunTransitionLock(runId, { directory } = {}, assertGate = async () => {}) {
  const root = await privateRoot(directory);
  const runPath = join(root, checkedId(runId));
  const lock = join(runPath, 'transition.lock');
  const token = randomUUID();
  const owner = await processIdentity();
  const claim = async () => {
    await assertGate();
    await mkdir(lock, { mode: 0o700 });
    await writeFile(join(lock, 'owner.json'), `${JSON.stringify({ token, owner })}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  };
  try {
    await claim();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const metadata = await lstat(lock);
    if (!metadata.isDirectory() || (metadata.mode & 0o077) !== 0)
      throw new RunRecordError(
        'E_RUN_LOCKED',
        'Run transition lock is unsafe; inspect private run storage.',
      );
    let held;
    try {
      held = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
    } catch (readError) {
      if (readError.code === 'ENOENT' || readError instanceof SyntaxError)
        throw new RunRecordError(
          'E_RUN_LOCKED',
          'Run transition lock is being acquired or cannot be verified.',
        );
      throw readError;
    }
    const state = await processIdentityState(held.owner);
    if (!['exited', 'reused'].includes(state))
      throw new RunRecordError(
        'E_RUN_LOCKED',
        'Another host operation holds this run transition lock.',
      );
    // Rename is atomic; a concurrent stale-lock recovery cannot remove our claim.
    const stale = `${lock}.stale-${token}`;
    try {
      await assertGate();
      await rename(lock, stale);
    } catch (renameError) {
      if (renameError.code === 'ENOENT')
        throw new RunRecordError(
          'E_RUN_LOCKED',
          'Another operation recovered this run lock; retry later.',
        );
      throw renameError;
    }
    const moved = JSON.parse(await readFile(join(stale, 'owner.json'), 'utf8'));
    if (moved.token !== held.token) {
      await rename(stale, lock);
      throw new RunRecordError(
        'E_RUN_LOCKED',
        'Run lock ownership changed during recovery; retry later.',
      );
    }
    await rm(stale, { recursive: true });
    try {
      await claim();
    } catch (claimError) {
      if (claimError.code === 'EEXIST')
        throw new RunRecordError(
          'E_RUN_LOCKED',
          'Another operation acquired this run transition lock.',
        );
      throw claimError;
    }
  }
  try {
    await assertGate();
  } catch (error) {
    const own = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
    if (own.token === token) await rm(lock, { recursive: true });
    throw error;
  }
  return async () => {
    const held = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
    if (held.token !== token)
      throw new RunRecordError('E_RUN_LOCKED', 'Run transition lock ownership changed.');
    await rm(lock, { recursive: true });
  };
}

export async function acquireRunTransitionLock(runId, options = {}) {
  const root = await privateRoot(options.directory);
  const runPath = join(root, checkedId(runId));
  const gate = join(runPath, 'transition.acquire');
  const token = randomUUID();
  const prepared = join(runPath, `.transition-acquire-${token}`);
  // Publish a fully written owner atomically: a crash cannot leave an empty gate.
  await mkdir(prepared, { mode: 0o700 });
  await writeFile(
    join(prepared, 'owner.json'),
    `${JSON.stringify({ token, owner: await processIdentity() })}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  let acquired = false;
  try {
    for (let attempt = 0; attempt < 2 && !acquired; attempt += 1) {
      try {
        await rename(prepared, gate);
        acquired = true;
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        const info = await lstat(gate);
        if (!info.isDirectory() || (info.mode & 0o077) !== 0)
          throw new RunRecordError('E_RUN_LOCKED', 'Run acquisition gate is unsafe.');
        const held = JSON.parse(await readFile(join(gate, 'owner.json'), 'utf8'));
        if (!['exited', 'reused'].includes(await processIdentityState(held.owner)))
          throw new RunRecordError(
            'E_RUN_LOCKED',
            'Another operation is acquiring this run transition lock.',
          );
        const stale = `${gate}.stale-${token}`;
        await rename(gate, stale);
        const moved = JSON.parse(await readFile(join(stale, 'owner.json'), 'utf8'));
        if (moved.token !== held.token) {
          await rename(stale, gate);
          throw new RunRecordError(
            'E_RUN_LOCKED',
            'Acquisition ownership changed during recovery; retry later.',
          );
        }
        await rm(stale, { recursive: true });
      }
    }
    if (!acquired)
      throw new RunRecordError('E_RUN_LOCKED', 'Run acquisition gate could not be acquired.');
    const assertGate = async () => {
      const held = JSON.parse(await readFile(join(gate, 'owner.json'), 'utf8'));
      if (held.token !== token)
        throw new RunRecordError('E_RUN_LOCKED', 'Run acquisition gate ownership changed.');
    };
    return await claimRunTransitionLock(runId, options, assertGate);
  } finally {
    if (acquired) {
      const held = JSON.parse(await readFile(join(gate, 'owner.json'), 'utf8'));
      if (held.token === token) await rm(gate, { recursive: true });
    } else await rm(prepared, { recursive: true, force: true });
  }
}

export async function withRunTransitionLock(runId, options, operation) {
  const release = await acquireRunTransitionLock(runId, options);
  try {
    return await operation();
  } finally {
    await release();
  }
}
