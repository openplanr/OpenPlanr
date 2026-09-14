import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { assertProtocolArtifact } from '../protocol/contracts.mjs';

const PROJECTION_RELATIVE_PATH = 'operate/projections/runtime-state.json';
const CHECKPOINT_RELATIVE_PATH = 'operate/checkpoints/current.json';
const DEFAULT_MAX_BYTES = 1024 * 1024;
const V2 = '2.0.0';

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
 * Read an Operate 2.0 runtime projection only. This reader never loads,
 * translates, or reports a legacy board layout, and never repairs state.
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
    assertProtocolArtifact('operating-runtime-state', state, { protocolVersion: V2 });
  } catch (error) {
    return result('invalid', {
      state: null,
      error: String(error?.message ?? error),
      recovery: 'Inspect runtime integrity with the owning CLI; do not edit the projection by hand.',
    });
  }

  let expected = expectedEventHead;
  const checkpointPath = join(planrDir, CHECKPOINT_RELATIVE_PATH);
  if (!expected && existsSync(checkpointPath)) {
    try {
      const checkpoint = safeReadJson(checkpointPath, maxBytes);
      assertProtocolArtifact('operating-checkpoint', checkpoint, { protocolVersion: V2 });
      expected = checkpoint.eventHead;
    } catch (error) {
      return result('invalid', {
        state: null,
        error: `checkpoint: ${String(error?.message ?? error)}`,
        recovery: 'Inspect runtime integrity with the owning CLI; do not edit checkpoints manually.',
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
      recovery: 'The runtime projection and checkpoint disagree. Inspect integrity with the owning CLI.',
    });
  }

  return result('ready', { state });
}

export {
  CHECKPOINT_RELATIVE_PATH as OPERATING_CHECKPOINT_RELATIVE_PATH,
  DEFAULT_MAX_BYTES as OPERATING_PROJECTION_MAX_BYTES,
};

// Product routes consume the already actor/access-safe public view through the
// sibling reader. Re-exporting keeps dashboard callers on one read-only module
// boundary without teaching the legacy technical projection about presentation.
export { readOperateExperienceProjection } from './operate-experience-reader.mjs';
