import { verifyDocumentDigest, withDocumentDigest } from '@openplanr/protocol/canonical-json';

import { assertIsoDate, assertNonBlank, freezeJson } from './internal.mjs';
import {
  LIFECYCLE_PROTOCOL_VERSION,
  LIFECYCLE_RUNTIME_VERSION,
  LIFECYCLE_STATE_VERSION,
} from './compatibility.mjs';
import {
  LIFECYCLE_SESSION_DIRECTORY,
  prepareLifecycleEnvironment,
} from './environment.mjs';
import { checkpointSession } from './sessions.mjs';
import { listStateJson, readStateJson, writeStateJson } from './storage.mjs';

export const DEFAULT_PROGRESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const SESSION_ID = /^GIS-[A-Za-z0-9._-]{8,128}$/u;
const MAX_PROGRESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function nowDate(now) {
  const value = typeof now === 'function' ? now() : (now ?? new Date().toISOString());
  return new Date(assertIsoDate(value, 'now'));
}

function sessionPath(sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
    throw new TypeError('sessionId must be an internal Protocol session identifier.');
  }
  return `${LIFECYCLE_SESSION_DIRECTORY}/${sessionId}.json`;
}

function progressRecord(value) {
  const checkpoint = value?.checkpoint;
  const session = checkpoint?.session;
  return Boolean(
    value
    && typeof value === 'object'
    && value.kind === 'skill-progress-record'
    && typeof value.sessionId === 'string'
    && SESSION_ID.test(value.sessionId)
    && typeof value.skillId === 'string'
    && typeof value.checkpointedAt === 'string'
    && typeof value.expiresAt === 'string'
    && verifyDocumentDigest(value)
    && checkpoint
    && typeof checkpoint === 'object'
    && checkpoint.skillId === value.skillId
    && checkpoint.checkpointedAt === value.checkpointedAt
    && session
    && typeof session === 'object'
    && session.sessionId === value.sessionId,
  );
}

export function readProgressRecords({ projectRoot } = {}) {
  const records = [];
  const unreadable = [];
  for (const path of listStateJson(projectRoot, LIFECYCLE_SESSION_DIRECTORY)) {
    try {
      const record = readStateJson(projectRoot, path);
      if (progressRecord(record)) records.push({ path, record });
      else unreadable.push(path);
    } catch {
      unreadable.push(path);
    }
  }
  return { records, unreadable };
}

/** Create and atomically persist one bounded, expiring recovery checkpoint. */
export function persistSessionProgress({
  projectRoot,
  session,
  context,
  safeState = {},
  now,
  ttlMs = DEFAULT_PROGRESS_TTL_MS,
} = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > MAX_PROGRESS_TTL_MS) {
    throw new RangeError('ttlMs must be between one minute and thirty days.');
  }
  const clock = nowDate(now);
  const checkpointed = checkpointSession({
    session,
    context,
    safeState,
    checkpointedAt: clock.toISOString(),
  });
  if (checkpointed.status !== 'completed' || !checkpointed.checkpoint) {
    return freezeJson({
      status: 'partial',
      path: null,
      expiresAt: null,
      notice: checkpointed.notice,
    });
  }
  const environment = prepareLifecycleEnvironment({ projectRoot });
  if (!environment.stateAvailable || !environment.runtimeIgnored) {
    return freezeJson({
      status: 'partial',
      path: null,
      expiresAt: null,
      notice: 'Continued without persisted progress because a safe ignored path was unavailable.',
    });
  }
  const record = withDocumentDigest({
    kind: 'skill-progress-record',
    stateVersion: LIFECYCLE_STATE_VERSION,
    runtimeVersion: LIFECYCLE_RUNTIME_VERSION,
    protocolVersion: LIFECYCLE_PROTOCOL_VERSION,
    sessionId: checkpointed.checkpoint.session.sessionId,
    skillId: checkpointed.checkpoint.skillId,
    checkpointedAt: checkpointed.checkpoint.checkpointedAt,
    expiresAt: new Date(clock.getTime() + ttlMs).toISOString(),
    checkpoint: checkpointed.checkpoint,
  });
  const path = sessionPath(record.sessionId);
  try {
    writeStateJson(environment.projectRoot, path, record);
  } catch {
    return freezeJson({
      status: 'partial',
      path: null,
      expiresAt: null,
      notice: 'Continued without persisted progress because local state could not be written safely.',
    });
  }
  return freezeJson({
    status: 'completed',
    path,
    expiresAt: record.expiresAt,
    notice: 'Saved recoverable local progress.',
  });
}

/** Select the newest unexpired checkpoint for a skill; users never manage its ID. */
export function loadLatestSessionProgress({ projectRoot, skillId, now } = {}) {
  assertNonBlank(skillId, 'skillId');
  const clock = nowDate(now).getTime();
  const { records, unreadable } = readProgressRecords({ projectRoot });
  const selected = records
    .filter(({ record }) => record.skillId === skillId && Date.parse(record.expiresAt) > clock)
    .sort((left, right) => (
      Date.parse(right.record.checkpointedAt) - Date.parse(left.record.checkpointedAt)
      || right.path.localeCompare(left.path)
    ))[0] ?? null;
  if (!selected) {
    return freezeJson({
      status: 'unavailable',
      record: null,
      unreadable: unreadable.length,
      notice: 'No compatible local progress was selected.',
    });
  }
  return freezeJson({
    status: 'completed',
    record: selected.record,
    unreadable: unreadable.length,
    notice: 'Selected the latest local progress.',
  });
}

export function progressPathForSession(sessionId) {
  return sessionPath(sessionId);
}

export function isProgressRecord(value) {
  return progressRecord(value);
}
