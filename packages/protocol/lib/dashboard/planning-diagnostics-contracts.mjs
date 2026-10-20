import { deepFreeze, exactJson, safeDataClone } from './closed-json-contract.mjs';
import {
  PLANNING_FILE_LINK_ERROR_CODES,
  validPlanningFilePath,
} from './planning-file-link-contracts.mjs';

export const PLANNING_DIAGNOSTICS_MAX_BYTES = 256 * 1024;
export const PLANNING_DIAGNOSTICS_MAX_COUNT = 500;
export const PLANNING_DIAGNOSTIC_REASONS = Object.freeze([
  'missing-reference',
  'ambiguous-reference',
  'invalid-date',
  'missing-date',
  'closed-before-start',
  'end-before-start',
  'dependency-cycle',
  'containment-cycle',
  'duplicate-identity',
]);
const FIELDS = new Set([
  'epicId',
  'featureId',
  'storyId',
  'specId',
  'dependsOn',
  'taskIds',
  'startDate',
  'endDate',
  'closedAt',
  'releaseCut',
  'parent',
  'id',
]);
const keys = (record, expected) =>
  record !== null &&
  typeof record === 'object' &&
  !Array.isArray(record) &&
  Object.keys(record).sort().join(',') === [...expected].sort().join(',');
const text = (value, limit) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= limit &&
  ![...value].some(
    (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
  );

// The caller supplies the already verified graph identity so diagnostics cannot introduce new authority.
export function assertPlanningDiagnosticsEnvelope(value, expected) {
  const record = safeDataClone(value);
  if (
    !keys(record, [
      'kind',
      'schemaVersion',
      'binding',
      'cursor',
      'sourceViewHash',
      'state',
      'reason',
      'errorCode',
      'diagnostics',
      'totalCount',
      'truncated',
    ]) ||
    record.kind !== 'planning-diagnostics' ||
    record.schemaVersion !== '1.0.0' ||
    !exactJson(record.binding, expected.binding) ||
    !exactJson(record.cursor, expected.cursor) ||
    record.sourceViewHash !== expected.cursor.viewHash ||
    !['available', 'unavailable', 'error'].includes(record.state) ||
    typeof record.truncated !== 'boolean' ||
    !Array.isArray(record.diagnostics) ||
    record.diagnostics.length > PLANNING_DIAGNOSTICS_MAX_COUNT ||
    record.diagnostics.some(
      (entry) =>
        !keys(entry, ['nodeId', 'sourcePath', 'field', 'reason', 'classification']) ||
        !text(entry.nodeId, 256) ||
        !validPlanningFilePath(entry.nodeId) ||
        !validPlanningFilePath(entry.sourcePath) ||
        !FIELDS.has(entry.field) ||
        !PLANNING_DIAGNOSTIC_REASONS.includes(entry.reason) ||
        entry.classification !== 'source-data',
    ) ||
    (record.state === 'available'
      ? !Number.isSafeInteger(record.totalCount) ||
        record.totalCount < record.diagnostics.length ||
        record.truncated !== record.totalCount > record.diagnostics.length ||
        (record.truncated ? !text(record.reason, 500) : record.reason !== null) ||
        record.errorCode !== null
      : record.diagnostics.length !== 0 ||
        record.totalCount !== null ||
        record.truncated ||
        !text(record.reason, 500) ||
        (record.state === 'error'
          ? !PLANNING_FILE_LINK_ERROR_CODES.includes(record.errorCode)
          : record.errorCode !== null)) ||
    new TextEncoder().encode(JSON.stringify(record)).byteLength > PLANNING_DIAGNOSTICS_MAX_BYTES
  ) {
    throw new TypeError('Invalid Planning diagnostics envelope.');
  }
  return deepFreeze(record);
}
