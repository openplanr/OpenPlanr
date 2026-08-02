import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { validateOperatingCheckpoint } from '../operate/reducer.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';

const PROJECTION_RELATIVE_PATH = 'operate/projections/state.json';
const CHECKPOINT_RELATIVE_PATH = 'operate/checkpoints/current.json';
const DEFAULT_MAX_BYTES = 1024 * 1024;

function result(status, extra = {}) {
  return {
    available: status !== 'absent',
    readOnly: true,
    status,
    path: `.planr/${PROJECTION_RELATIVE_PATH}`,
    ...extra,
  };
}

function safeReadJson(path, maxBytes) {
  const stats = statSync(path);
  if (!stats.isFile()) throw new Error('projection path is not a regular file');
  if (stats.size > maxBytes) throw new Error(`projection exceeds ${maxBytes} bytes`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Read the reducer-generated Operating projection only. This function never
 * replays, repairs, or writes state. A checkpoint mismatch is surfaced as
 * `stale`, leaving CLI/doctor as the only authority for recovery.
 */
export function readOperatingProjection(planrDir, {
  maxBytes = DEFAULT_MAX_BYTES,
  expectedEventHead = null,
} = {}) {
  const projectionPath = join(planrDir, PROJECTION_RELATIVE_PATH);
  if (!existsSync(projectionPath)) return result('absent', { state: null });
  let state;
  try {
    state = safeReadJson(projectionPath, maxBytes);
    assertProtocolArtifact('operating-state', state);
  } catch (error) {
    return result('invalid', {
      state: null,
      error: String(error?.message ?? error),
      recovery: 'Run `planr operate integrity status`; do not edit the projection by hand.',
    });
  }

  let expected = expectedEventHead;
  const checkpointPath = join(planrDir, CHECKPOINT_RELATIVE_PATH);
  if (!expected && existsSync(checkpointPath)) {
    try {
      const checkpoint = safeReadJson(checkpointPath, maxBytes);
      validateOperatingCheckpoint(checkpoint);
      expected = checkpoint.eventHead;
    } catch (error) {
      return result('invalid', {
        state: null,
        error: `checkpoint: ${String(error?.message ?? error)}`,
        recovery: 'Run `planr operate integrity status`, then `planr operate cycles recover`; do not delete checkpoints manually.',
      });
    }
  }

  if (
    expected
    && (state.eventHead.sequence !== expected.sequence || state.eventHead.hash !== expected.hash)
  ) {
    return result('stale', {
      state,
      expectedEventHead: structuredClone(expected),
      actualEventHead: structuredClone(state.eventHead),
      recovery: 'Run `planr operate integrity status`, then `planr operate cycles recover` and explicitly approve recovery.',
    });
  }

  return result('ready', { state });
}

export {
  CHECKPOINT_RELATIVE_PATH as OPERATING_CHECKPOINT_RELATIVE_PATH,
  DEFAULT_MAX_BYTES as OPERATING_PROJECTION_MAX_BYTES,
};
