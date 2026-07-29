import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { canonicalize } from './canonical.js';
import { minimalSubprocessEnvironment } from './subprocess-env.js';
import { OperateError, type OperatingEventHead, type OperatingLockRecord } from './types.js';
import { resolveOperatingPaths } from './workspace.js';

const execFileAsync = promisify(execFile);
const DEFAULT_LEASE_DURATION_MS = 30_000;
const MINIMUM_LEASE_DURATION_MS = 5_000;
const MAXIMUM_LEASE_DURATION_MS = 5 * 60_000;

export interface OperatingLock {
  readonly record: OperatingLockRecord;
  readonly path: string;
  assertEventHead(currentEventHead: OperatingEventHead): void;
  advanceEventHead(
    currentEventHead: OperatingEventHead,
    nextEventHead: OperatingEventHead,
  ): Promise<void>;
  heartbeat(currentEventHead: OperatingEventHead, now?: Date): Promise<void>;
  release(): Promise<void>;
}

export interface AcquireLockOptions {
  projectKey: string;
  name?: string;
  now?: Date;
  leaseDurationMs?: number;
  expectedEventHead: OperatingEventHead;
  currentEventHead: OperatingEventHead;
  localRoot?: string;
}

function assertLeaseDuration(value: number): void {
  if (
    !Number.isInteger(value) ||
    value < MINIMUM_LEASE_DURATION_MS ||
    value > MAXIMUM_LEASE_DURATION_MS
  ) {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `Lock lease must be ${MINIMUM_LEASE_DURATION_MS}-${MAXIMUM_LEASE_DURATION_MS}ms.`,
    );
  }
}

async function writeRecord(handle: FileHandle, record: OperatingLockRecord): Promise<void> {
  const bytes = Buffer.from(`${canonicalize(record)}\n`);
  await handle.truncate(0);
  await handle.write(bytes, 0, bytes.length, 0);
  await handle.sync();
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Returns null where the platform offers no `ps` — notably Windows. Callers
 * treat a null identity as "cannot corroborate", so lock ownership falls back
 * to the lease and heartbeat rather than to a fabricated identity.
 */
export async function readProcessStartIdentity(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      env: minimalSubprocessEnvironment({ LANG: 'C', LC_ALL: 'C' }),
      timeout: 2_000,
      maxBuffer: 4096,
    });
    const identity = stdout.trim().replace(/\s+/g, ' ');
    return identity || null;
  } catch {
    return null;
  }
}

function headsEqual(left: OperatingEventHead, right: OperatingEventHead): boolean {
  return left.sequence === right.sequence && left.hash === right.hash;
}

function assertHead(expected: OperatingEventHead, current: OperatingEventHead): void {
  if (!headsEqual(expected, current)) {
    throw new OperateError(
      'E_OPERATE_ROUTE_DRIFT',
      'The operating event head changed after preview.',
      { expected, actual: current },
    );
  }
}

export async function readOperatingLock(lockPath: string): Promise<OperatingLockRecord> {
  const record = JSON.parse(await readFile(lockPath, 'utf8')) as OperatingLockRecord;
  if (
    typeof record.projectKey !== 'string' ||
    typeof record.nonce !== 'string' ||
    record.nonce.length < 32 ||
    !Number.isInteger(record.pid) ||
    typeof record.host !== 'string' ||
    typeof record.processStartedAt !== 'string' ||
    typeof record.heartbeatAt !== 'string' ||
    !Number.isFinite(Date.parse(record.leaseExpiresAt)) ||
    !Number.isInteger(record.leaseDurationMs) ||
    !record.expectedEventHead ||
    !Number.isInteger(record.expectedEventHead.sequence)
  ) {
    throw new OperateError('E_OPERATE_STATE_INVALID', 'Operating lock is malformed.');
  }
  assertLeaseDuration(record.leaseDurationMs);
  return record;
}

export async function acquireOperatingLock(
  projectRoot: string,
  options: AcquireLockOptions,
): Promise<OperatingLock> {
  assertHead(options.expectedEventHead, options.currentEventHead);
  const paths = resolveOperatingPaths(projectRoot, { localRoot: options.localRoot });
  await mkdir(paths.locks, { recursive: true, mode: 0o700 });
  const lockPath = path.join(paths.locks, `${options.name ?? 'project'}.lock`);
  const now = options.now ?? new Date();
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  assertLeaseDuration(leaseDurationMs);
  const processIdentity =
    (await readProcessStartIdentity(process.pid)) ??
    `unverified-self:${new Date(now.getTime() - process.uptime() * 1000).toISOString()}`;
  const record: OperatingLockRecord = {
    projectKey: options.projectKey,
    nonce: randomBytes(32).toString('base64url'),
    pid: process.pid,
    host: hostname(),
    processStartedAt: processIdentity,
    createdAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
    leaseDurationMs,
    leaseExpiresAt: new Date(now.getTime() + leaseDurationMs).toISOString(),
    expectedEventHead: structuredClone(options.expectedEventHead),
  };

  let handle: FileHandle;
  try {
    handle = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const owner = await readOperatingLock(lockPath).catch(() => undefined);
    throw new OperateError('E_OPERATE_CYCLE_ACTIVE', 'Another operating run owns the project.', {
      owner,
    });
  }
  try {
    await writeRecord(handle, record);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
    throw error;
  }
  let released = false;

  const verifyOwnership = async (): Promise<void> => {
    const current = await readOperatingLock(lockPath);
    if (
      current.nonce !== record.nonce ||
      current.pid !== record.pid ||
      current.host !== record.host ||
      current.processStartedAt !== record.processStartedAt
    ) {
      throw new OperateError('E_OPERATE_CYCLE_ACTIVE', 'Operating lock ownership changed.');
    }
  };

  return {
    record,
    path: lockPath,
    assertEventHead(currentEventHead) {
      assertHead(record.expectedEventHead, currentEventHead);
    },
    async advanceEventHead(currentEventHead, nextEventHead) {
      if (released) {
        throw new OperateError('E_OPERATE_CYCLE_ACTIVE', 'Cannot advance a released lock.');
      }
      assertHead(record.expectedEventHead, currentEventHead);
      await verifyOwnership();
      record.expectedEventHead = structuredClone(nextEventHead);
      await writeRecord(handle, record);
    },
    async heartbeat(currentEventHead, heartbeatNow = new Date()) {
      if (released) {
        throw new OperateError('E_OPERATE_CYCLE_ACTIVE', 'Cannot heartbeat a released lock.');
      }
      assertHead(record.expectedEventHead, currentEventHead);
      await verifyOwnership();
      if (heartbeatNow.getTime() > Date.parse(record.leaseExpiresAt)) {
        throw new OperateError(
          'E_OPERATE_CYCLE_ACTIVE',
          'Operating lock lease expired before heartbeat.',
        );
      }
      record.heartbeatAt = heartbeatNow.toISOString();
      record.leaseExpiresAt = new Date(
        heartbeatNow.getTime() + record.leaseDurationMs,
      ).toISOString();
      await writeRecord(handle, record);
    },
    async release() {
      if (released) return;
      await verifyOwnership();
      released = true;
      await handle.close();
      await unlink(lockPath);
    },
  };
}

export async function recoverStaleOperatingLock(
  projectRoot: string,
  options: {
    projectKey: string;
    name?: string;
    expectedNonce: string;
    expectedProcessStartedAt?: string;
    now?: Date;
    localRoot?: string;
    processIdentityReader?: (pid: number) => Promise<string | null>;
  },
): Promise<void> {
  const lockPath = path.join(
    resolveOperatingPaths(projectRoot, { localRoot: options.localRoot }).locks,
    `${options.name ?? 'project'}.lock`,
  );
  const record = await readOperatingLock(lockPath);
  const now = options.now ?? new Date();
  if (
    record.projectKey !== options.projectKey ||
    record.nonce !== options.expectedNonce ||
    (options.expectedProcessStartedAt &&
      record.processStartedAt !== options.expectedProcessStartedAt)
  ) {
    throw new OperateError(
      'E_OPERATE_STALE_LOCK_UNSAFE',
      'The lock changed after stale-lock preview.',
    );
  }
  if (record.host !== hostname()) {
    throw new OperateError(
      'E_OPERATE_STALE_LOCK_UNSAFE',
      'Cross-host locks require manual owner verification and are never auto-removed.',
    );
  }
  if (now.getTime() <= Date.parse(record.leaseExpiresAt)) {
    throw new OperateError('E_OPERATE_STALE_LOCK_UNSAFE', 'The operating lease is active.');
  }
  if (processIsAlive(record.pid)) {
    const liveIdentity = await (options.processIdentityReader ?? readProcessStartIdentity)(
      record.pid,
    );
    if (!liveIdentity || liveIdentity === record.processStartedAt) {
      throw new OperateError(
        'E_OPERATE_STALE_LOCK_UNSAFE',
        liveIdentity
          ? 'The lock owner process is still alive.'
          : 'The live process start identity cannot be proven; refusing automatic recovery.',
      );
    }
    // A different start identity proves PID reuse; the expired lease is stale.
  }
  const rechecked = await readOperatingLock(lockPath);
  if (
    rechecked.nonce !== options.expectedNonce ||
    rechecked.processStartedAt !== record.processStartedAt ||
    rechecked.heartbeatAt !== record.heartbeatAt ||
    rechecked.leaseExpiresAt !== record.leaseExpiresAt
  ) {
    throw new OperateError(
      'E_OPERATE_STALE_LOCK_UNSAFE',
      'The lock changed immediately before recovery.',
    );
  }
  await unlink(lockPath);
}

export async function withOperatingLock<T>(
  projectRoot: string,
  options: AcquireLockOptions,
  operation: (lock: OperatingLock) => Promise<T>,
): Promise<T> {
  const lock = await acquireOperatingLock(projectRoot, options);
  try {
    return await operation(lock);
  } finally {
    await lock.release();
  }
}
