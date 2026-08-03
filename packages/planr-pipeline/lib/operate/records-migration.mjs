import { PipelineError } from '../pipeline/errors.mjs';
import { canonicalizeJson, sha256Jcs } from '../protocol/jcs.mjs';

// Pure, deterministic mapping between the legacy directory-per-digest-prefix
// `operating-record` layout (SPEC-002) and the single-file `.state/records.jsonl`
// append-log layout (SPEC-004 FR5). The transform changes only the record
// container — never the record content — so the migration is lossless and, via
// `reconstructDirectoryLayoutFromJsonl`, mechanically reversible. The digest is
// carried through unchanged as a field on every log entry.
//
// This module owns the pure transform and projection only. The live filesystem
// migration during `planr operate init`/upgrade is engine work in the operate
// runtime and is verified separately there.

const OPERATING_RECORD_KIND = 'operating-record';
const RECORDS_LOG_ENTRY_KIND = 'operating-records-log-entry';
const SOURCE_PROTOCOL = '1.2.0';
const TARGET_PROTOCOL = '1.3.0';
const SOURCE_LAYOUT = 'directory-per-digest-prefix';
const TARGET_LAYOUT = 'records-jsonl';
const DIGEST_PREFIX = 'sha256:';
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
// Deterministic sentinel used only when migrating an empty record set with no
// caller-supplied timestamp, so the produced migration record stays pure.
const MIGRATION_EPOCH = '1970-01-01T00:00:00.000Z';

function migrationError(message) {
  return new PipelineError(
    'E_OPERATE_MIGRATION_INVALID',
    message,
    'Inspect the legacy operating-record layout before re-running the records.jsonl migration.',
  );
}

function digestHex(digest) {
  return digest.slice(DIGEST_PREFIX.length);
}

function assertLegacyRecord(record, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw migrationError(`Legacy operating record at index ${index} is not an object.`);
  }
  if (typeof record.digest !== 'string' || !DIGEST_PATTERN.test(record.digest)) {
    throw migrationError(`Legacy operating record at index ${index} has an invalid content-address digest.`);
  }
  if (typeof record.recordType !== 'string' || record.recordType.length === 0) {
    throw migrationError(`Legacy operating record at index ${index} is missing recordType.`);
  }
  if (!record.content || typeof record.content !== 'object' || Array.isArray(record.content)) {
    throw migrationError(`Legacy operating record at index ${index} is missing content.`);
  }
  return record;
}

// A records-log entry is the same field set as the v1.2 operating-record with a
// different container kind and protocol version. Content is copied by reference
// and never altered.
function toLogEntry(record) {
  return {
    kind: RECORDS_LOG_ENTRY_KIND,
    schemaVersion: record.schemaVersion,
    protocolVersion: TARGET_PROTOCOL,
    digest: record.digest,
    recordType: record.recordType,
    createdAt: record.createdAt,
    correlationId: record.correlationId,
    contentDigest: record.contentDigest,
    content: record.content,
  };
}

// Exact inverse of `toLogEntry`: restore the v1.2 operating-record container.
function toOperatingRecord(entry) {
  return {
    kind: OPERATING_RECORD_KIND,
    schemaVersion: entry.schemaVersion,
    protocolVersion: SOURCE_PROTOCOL,
    digest: entry.digest,
    recordType: entry.recordType,
    createdAt: entry.createdAt,
    correlationId: entry.correlationId,
    contentDigest: entry.contentDigest,
    content: entry.content,
  };
}

/**
 * Migrate an array of parsed legacy `operating-record` objects (as read from a
 * directory-per-digest-prefix tree) into the append-only records.jsonl layout.
 *
 * @param {Array<object>} legacyRecords
 * @param {{ migratedAt?: string, eventCount?: number }} [options]
 *   `migratedAt` pins the migration record timestamps (defaults to the newest
 *   record's `createdAt`). `eventCount` is the event-log size, which this
 *   container migration leaves untouched, so it is applied identically before
 *   and after (defaults to the record count).
 * @returns {{ lines: string[], migrationRecord: object }}
 *   `lines` is one canonical `operating-records-log-entry@1.3.0` per record,
 *   sorted by digest for deterministic output; `migrationRecord` is a
 *   previewed `operating-migration-record@1.3.0`.
 */
export function migrateRecordsDirectoryToJsonl(legacyRecords, { migratedAt, eventCount } = {}) {
  if (!Array.isArray(legacyRecords)) {
    throw migrationError('migrateRecordsDirectoryToJsonl requires an array of operating records.');
  }
  const sorted = legacyRecords
    .map((record, index) => assertLegacyRecord(record, index))
    .slice()
    .sort((left, right) => left.digest.localeCompare(right.digest));

  const entries = sorted.map(toLogEntry);
  const lines = entries.map((entry) => canonicalizeJson(entry));

  const recordCount = sorted.length;
  const events = Number.isInteger(eventCount) ? eventCount : recordCount;
  const timestamp = migratedAt
    ?? sorted.reduce(
      (latest, record) => (record.createdAt > latest ? record.createdAt : latest),
      MIGRATION_EPOCH,
    );
  const sourceDigest = sha256Jcs(sorted);
  const previewDigest = sha256Jcs(entries);

  const migrationRecord = {
    kind: 'operating-migration-record',
    schemaVersion: '1.0.0',
    protocolVersion: TARGET_PROTOCOL,
    id: `MIG-records-jsonl-${digestHex(sourceDigest).slice(0, 12)}`,
    sourceKind: 'protocol-upgrade',
    sourceDigest,
    state: 'previewed',
    previewDigest,
    backupManifestDigest: sourceDigest,
    sourceLayout: SOURCE_LAYOUT,
    targetLayout: TARGET_LAYOUT,
    recordCount: { before: recordCount, after: recordCount },
    eventCount: { before: events, after: events },
    mappings: sorted.map((record) => ({
      sourceId: record.digest,
      targetId: record.digest,
      eventId: record.correlationId,
    })),
    conflicts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return { lines, migrationRecord };
}

/**
 * Inverse of {@link migrateRecordsDirectoryToJsonl}: rebuild the directory tree
 * keyed by digest prefix from records.jsonl lines. Used only to prove
 * reversibility in tests and conformance — the readable layout never regresses
 * to per-file storage in production.
 *
 * @param {string[]} lines
 * @returns {Map<string, Map<string, object>>}
 *   `prefix (first two hex digits) -> rest (remaining 62 hex digits) -> record`,
 *   mirroring `records/<prefix>/<rest>.json`.
 */
export function reconstructDirectoryLayoutFromJsonl(lines) {
  if (!Array.isArray(lines)) {
    throw migrationError('reconstructDirectoryLayoutFromJsonl requires an array of JSONL lines.');
  }
  const layout = new Map();
  for (const [index, line] of lines.entries()) {
    if (typeof line !== 'string') {
      throw migrationError(`records.jsonl line at index ${index} is not a string.`);
    }
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const entry = JSON.parse(trimmed);
    if (typeof entry.digest !== 'string' || !DIGEST_PATTERN.test(entry.digest)) {
      throw migrationError(`records.jsonl line at index ${index} has an invalid digest.`);
    }
    const record = toOperatingRecord(entry);
    const hex = digestHex(record.digest);
    const prefix = hex.slice(0, 2);
    const rest = hex.slice(2);
    if (!layout.has(prefix)) layout.set(prefix, new Map());
    const bucket = layout.get(prefix);
    if (bucket.has(rest)) {
      throw migrationError(`Duplicate record digest ${record.digest} during reconstruction.`);
    }
    bucket.set(rest, record);
  }
  return layout;
}

/**
 * Flatten a reconstructed directory layout into a digest-sorted array of
 * operating records — a small convenience for reversibility assertions.
 *
 * @param {Map<string, Map<string, object>>} layout
 * @returns {object[]}
 */
export function flattenReconstructedLayout(layout) {
  const records = [];
  for (const bucket of layout.values()) {
    for (const record of bucket.values()) records.push(record);
  }
  return records.sort((left, right) => left.digest.localeCompare(right.digest));
}
