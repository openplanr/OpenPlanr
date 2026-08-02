import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertProtocolArtifact } from '../lib/protocol/contracts.mjs';
import {
  flattenReconstructedLayout,
  migrateRecordsDirectoryToJsonl,
  reconstructDirectoryLayoutFromJsonl,
} from '../lib/operate/records-migration.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

const SAMPLE = 'conformance/fixtures/operating-board/legacy-directory-layout-sample';
const EXPECTED = 'conformance/fixtures/operating-board/records-jsonl-migrated-expected.jsonl';

// Legacy directory-per-digest-prefix sample: one operating record per record
// type, read exactly as the SPEC-002 tree would surface them.
const legacyRecords = [
  readJson(`${SAMPLE}/records/ev/idence-metadata-sample.json`),
  readJson(`${SAMPLE}/records/fi/nding-sample.json`),
  readJson(`${SAMPLE}/records/de/cision-sample.json`),
];

// The source is a genuine v1.2 layout: every record validates as v1.2.
for (const record of legacyRecords) {
  assertProtocolArtifact('operating-record', record);
}

// ── Migration produces byte-for-byte the committed records.jsonl projection ──
const { lines, migrationRecord } = migrateRecordsDirectoryToJsonl(legacyRecords);
const produced = `${lines.join('\n')}\n`;
const expected = readFileSync(join(root, EXPECTED), 'utf8');
assert.equal(
  produced,
  expected,
  'Migrated records.jsonl is not byte-identical to records-jsonl-migrated-expected.jsonl.',
);

// ── Every produced entry validates as a v1.3 log entry with v1.2 content ──
// A container-only migration reshapes the envelope and nothing else, so a
// genuine v1.2 record must validate as an operating-records-log-entry@1.3.0
// without its embedded content being upgraded. The finding/data-gap/route/
// migration branches accept either content version for exactly this case.
for (const line of lines) {
  assertProtocolArtifact('operating-records-log-entry', JSON.parse(line), {
    protocolVersion: '1.3.0',
  });
}

// ── The migration record is a valid, lossless v1.3 protocol-upgrade preview ──
assertProtocolArtifact('operating-migration-record', migrationRecord, { protocolVersion: '1.3.0' });
assert.equal(migrationRecord.sourceKind, 'protocol-upgrade');
assert.equal(migrationRecord.sourceLayout, 'directory-per-digest-prefix');
assert.equal(migrationRecord.targetLayout, 'records-jsonl');
assert.equal(migrationRecord.state, 'previewed');
assert.equal(
  migrationRecord.recordCount.before,
  migrationRecord.recordCount.after,
  'recordCount must be identical before and after a lossless migration.',
);
assert.equal(
  migrationRecord.eventCount.before,
  migrationRecord.eventCount.after,
  'eventCount must be identical: the container migration never touches the event log.',
);
assert.equal(migrationRecord.recordCount.after, legacyRecords.length);

// ── Reversibility: reconstruct the directory layout and match every digest ──
const layout = reconstructDirectoryLayoutFromJsonl(lines);
const reconstructed = new Map(flattenReconstructedLayout(layout).map((record) => [record.digest, record]));
assert.equal(reconstructed.size, legacyRecords.length, 'Reconstruction dropped or merged records.');
for (const record of legacyRecords) {
  const restored = reconstructed.get(record.digest);
  assert.ok(restored, `Reconstruction is missing the record with digest ${record.digest}.`);
  assert.equal(restored.digest, record.digest, 'Reconstructed digest does not match its fixture file digest.');
  assert.deepEqual(restored, record, `Reconstructed record ${record.digest} is not byte-lossless.`);
}

process.stdout.write(
  `Operating records migration conformance passed (${legacyRecords.length} records: `
  + 'directory-per-digest-prefix -> records.jsonl is byte-exact, lossless, and reversible).\n',
);
