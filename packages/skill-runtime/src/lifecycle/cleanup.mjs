import { assertIsoDate, freezeJson } from './internal.mjs';
import { isProgressRecord, progressPathForSession, readProgressRecords } from './progress.mjs';
import { removeOwnedStateJson } from './storage.mjs';

function nowMs(now) {
  const value = typeof now === 'function' ? now() : (now ?? new Date().toISOString());
  return Date.parse(assertIsoDate(value, 'now'));
}

/** Remove only expired files that are recognizably owned by this lifecycle runtime. */
export function cleanupLifecycleProgress({ projectRoot, now } = {}) {
  const clock = nowMs(now);
  const { records, unreadable } = readProgressRecords({ projectRoot });
  const removed = [];
  let retained = 0;
  for (const { path, record } of records) {
    if (Date.parse(record.expiresAt) > clock) {
      retained += 1;
      continue;
    }
    if (removeOwnedStateJson(projectRoot, path, isProgressRecord)) removed.push(path);
  }
  return freezeJson({
    status: unreadable.length > 0 ? 'partial' : 'completed',
    removed,
    retained,
    unreadable: unreadable.length,
    notice:
      removed.length > 0
        ? `Removed ${removed.length} expired local progress ${removed.length === 1 ? 'file' : 'files'}.`
        : 'No expired local progress needed cleanup.',
  });
}

/** Close one exact internal session without touching configuration or learning. */
export function closeSessionProgress({ projectRoot, sessionId } = {}) {
  const path = progressPathForSession(sessionId);
  const removed = removeOwnedStateJson(
    projectRoot,
    path,
    (record) => isProgressRecord(record) && record.sessionId === sessionId,
  );
  return freezeJson({
    status: 'completed',
    removed,
    notice: removed
      ? 'Removed closed-session progress.'
      : 'No closed-session progress was present.',
  });
}
