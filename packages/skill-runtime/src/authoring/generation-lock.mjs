import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { SkillAuthoringError } from './diagnostics.mjs';

const LOCK_DIR = '.openplanr-generate.lock';
const CANDIDATE_PREFIX = '.openplanr-generate-candidate-';
const RECLAIM_DIR = '.openplanr-generate-reclaim';
const RECLAIMED_PREFIX = '.openplanr-generate-reclaimed-';
const OWNER_FILE = 'owner.json';
const WAIT_INTERVAL_MS = 25;
const WAIT_TIMEOUT_MS = 15_000;
const MALFORMED_LOCK_STALE_MS = 30_000;
const sleepState = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

function sleep(milliseconds) {
  Atomics.wait(sleepState, 0, 0, milliseconds);
}

function readOwner(lockPath) {
  try {
    const value = JSON.parse(readFileSync(join(lockPath, OWNER_FILE), 'utf8'));
    if (Number.isInteger(value.pid) && value.pid > 0 && typeof value.token === 'string') return value;
  } catch {
    // A legacy or externally damaged lock may be missing valid ownership data.
    // Its directory age determines whether it is safe to reclaim below.
  }
  return null;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function fileIdentity(stat) {
  return `${stat.dev}:${stat.ino}`;
}

function sameOwner(left, right) {
  return Boolean(left && right && left.pid === right.pid && left.token === right.token);
}

function readReclaimOwner(claimPath) {
  try {
    const value = JSON.parse(readFileSync(join(claimPath, OWNER_FILE), 'utf8'));
    if (
      Number.isInteger(value.pid)
      && value.pid > 0
      && typeof value.token === 'string'
      && typeof value.lockIdentity === 'string'
    ) return value;
  } catch {
    // A claimant may crash between mkdir and writing its owner record. A later
    // claimant nests an exclusive recovery claim after the directory ages out.
  }
  return null;
}

function observeStaleLock(lockPath) {
  let before;
  try {
    before = lstatSync(lockPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!before.isDirectory() || before.isSymbolicLink()) return null;

  const owner = readOwner(lockPath);
  if (owner ? processIsAlive(owner.pid) : Date.now() - before.mtimeMs < MALFORMED_LOCK_STALE_MS) {
    return null;
  }

  let current;
  try {
    current = lstatSync(lockPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (
    fileIdentity(current) !== fileIdentity(before)
    || current.mtimeMs !== before.mtimeMs
  ) return null;

  const currentOwner = readOwner(lockPath);
  if (owner ? !sameOwner(currentOwner, owner) : currentOwner !== null) return null;
  return Object.freeze({
    lockIdentity: fileIdentity(before),
    owner,
  });
}

function assertReclaimPath(claimPath) {
  let stat;
  try {
    stat = lstatSync(claimPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new SkillAuthoringError(
      'E_SKILL_GENERATION_LOCK_INVALID',
      `${claimPath} is not a valid OpenPlanr generation reclaim claim.`,
      { path: claimPath, repair: `Move the existing ${LOCK_DIR} path, then run generation again.` },
    );
  }
  return stat;
}

function createReclaimClaim(claimPath, claimant, observation) {
  try {
    mkdirSync(claimPath);
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    if (error?.code === 'ENOENT') return null;
    throw new SkillAuthoringError(
      'E_SKILL_GENERATION_LOCK_FAILED',
      `Unable to claim the stale generation lock: ${error.message}`,
      { path: claimPath, repair: 'Check directory permissions and run generation again.' },
    );
  }

  try {
    writeFileSync(join(claimPath, OWNER_FILE), `${JSON.stringify({
      ...claimant,
      lockIdentity: observation.lockIdentity,
    })}\n`, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    // Do not remove a claim through the well-known lock path. If the process
    // dies here, the aged malformed claim is recoverable by a nested claimant.
    throw new SkillAuthoringError(
      'E_SKILL_GENERATION_LOCK_FAILED',
      `Unable to record the stale generation lock claim: ${error.message}`,
      { path: claimPath, repair: 'Check directory permissions and run generation again.' },
    );
  }
  return true;
}

function acquireReclaimClaim(lockPath, observation, claimant) {
  let claimPath = join(lockPath, RECLAIM_DIR);
  while (true) {
    const created = createReclaimClaim(claimPath, claimant, observation);
    if (created === null) return null;
    if (created) return claimPath;

    const stat = assertReclaimPath(claimPath);
    if (!stat) return null;
    const owner = readReclaimOwner(claimPath);
    if (
      owner
      && owner.lockIdentity === observation.lockIdentity
      && sameOwner(owner, claimant)
    ) return claimPath;
    if (
      owner
      && owner.lockIdentity === observation.lockIdentity
      && processIsAlive(owner.pid)
    ) return null;
    if (!owner && Date.now() - stat.mtimeMs < MALFORMED_LOCK_STALE_MS) return null;

    // A dead, malformed, or wrong-inode claimant is never removed in place.
    // Contenders race to create one child claim; only its owner may quarantine
    // the fixed lock. Repeated crashes remain recoverable by further nesting.
    claimPath = join(claimPath, RECLAIM_DIR);
  }
}

function observationStillStale(lockPath, observation, claimPath, claimant) {
  let current;
  try {
    current = lstatSync(lockPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (fileIdentity(current) !== observation.lockIdentity) return false;

  const claimOwner = readReclaimOwner(claimPath);
  if (
    !claimOwner
    || claimOwner.lockIdentity !== observation.lockIdentity
    || !sameOwner(claimOwner, claimant)
  ) return false;

  const currentOwner = readOwner(lockPath);
  if (observation.owner) {
    return sameOwner(currentOwner, observation.owner) && !processIsAlive(currentOwner.pid);
  }
  return currentOwner === null;
}

function reclaimStaleLock(skillDir, lockPath, observation, claimant) {
  const claimPath = acquireReclaimClaim(lockPath, observation, claimant);
  if (!claimPath || !observationStillStale(lockPath, observation, claimPath, claimant)) return false;

  const quarantinePath = join(skillDir, `${RECLAIMED_PREFIX}${claimant.token}`);
  try {
    // The exclusive claim is inside the observed lock inode. Cooperative
    // reclaimers cannot replace that inode before this atomic move, so this
    // rename cannot quarantine a newly acquired fixed lock.
    renameSync(lockPath, quarantinePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw new SkillAuthoringError(
      'E_SKILL_GENERATION_LOCK_FAILED',
      `Unable to quarantine the stale generation lock: ${error.message}`,
      { path: lockPath, repair: 'Check directory permissions and run generation again.' },
    );
  }
  rmSync(quarantinePath, { recursive: true, force: true });
  return true;
}

function prepareCandidate(skillDir, owner) {
  const candidate = mkdtempSync(join(skillDir, CANDIDATE_PREFIX));
  try {
    writeFileSync(join(candidate, OWNER_FILE), `${JSON.stringify(owner)}\n`, 'utf8');
    return candidate;
  } catch (error) {
    rmSync(candidate, { recursive: true, force: true });
    throw error;
  }
}

function assertLockPath(lockPath) {
  try {
    const stat = lstatSync(lockPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new SkillAuthoringError(
        'E_SKILL_GENERATION_LOCK_INVALID',
        `${lockPath} is not a valid OpenPlanr generation lock.`,
        { path: lockPath, repair: `Move the existing ${LOCK_DIR} path, then run generation again.` },
      );
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
}

/** Serialize one composed skill's output swap across concurrent processes. */
export function acquireGenerationLock(skillDir, { beforeReclaimClaim } = {}) {
  const lockPath = join(skillDir, LOCK_DIR);
  const owner = { pid: process.pid, token: randomUUID() };
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  while (true) {
    if (!existsSync(lockPath)) {
      let candidate;
      let acquired = false;
      try {
        candidate = prepareCandidate(skillDir, owner);
        renameSync(candidate, lockPath);
        acquired = true;
      } catch (error) {
        if (candidate && existsSync(candidate)) rmSync(candidate, { recursive: true, force: true });
        if (!['EEXIST', 'ENOTEMPTY'].includes(error?.code)) {
          throw new SkillAuthoringError(
            'E_SKILL_GENERATION_LOCK_FAILED',
            `Unable to acquire the generation lock for ${skillDir}: ${error.message}`,
            { path: lockPath, repair: 'Check directory permissions and run generation again.' },
          );
        }
      }
      if (acquired) {
        return () => {
          const current = readOwner(lockPath);
          if (!current || current.pid !== owner.pid || current.token !== owner.token) {
            throw new SkillAuthoringError(
              'E_SKILL_GENERATION_LOCK_LOST',
              `Generation lock ownership changed before ${skillDir} finished writing.`,
              { path: lockPath, repair: 'Inspect the temporary lock path, then run generation again.' },
            );
          }
          rmSync(lockPath, { recursive: true, force: true });
        };
      }
    }

    assertLockPath(lockPath);
    if (!existsSync(lockPath)) continue;
    const observation = observeStaleLock(lockPath);
    if (observation) {
      // Narrow synchronization seam for deterministic process-race coverage.
      beforeReclaimClaim?.();
      if (reclaimStaleLock(skillDir, lockPath, observation, owner)) continue;
    }
    if (Date.now() >= deadline) {
      throw new SkillAuthoringError(
        'E_SKILL_GENERATION_BUSY',
        `Another process is still generating ${skillDir}.`,
        { path: lockPath, repair: 'Wait for the active generation to finish, then run the command again.' },
      );
    }
    sleep(WAIT_INTERVAL_MS);
  }
}
