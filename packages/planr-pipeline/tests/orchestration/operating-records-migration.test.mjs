import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { assertProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import {
  flattenReconstructedLayout,
  migrateRecordsDirectoryToJsonl,
  reconstructDirectoryLayoutFromJsonl,
} from '../../lib/operate/records-migration.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

const SAMPLE = 'conformance/fixtures/operating-board/legacy-directory-layout-sample';
const EXPECTED = 'conformance/fixtures/operating-board/records-jsonl-migrated-expected.jsonl';

function loadLegacyRecords() {
  return [
    readJson(`${SAMPLE}/records/ev/idence-metadata-sample.json`),
    readJson(`${SAMPLE}/records/fi/nding-sample.json`),
    readJson(`${SAMPLE}/records/de/cision-sample.json`),
  ];
}

test('migration produces byte-identical records.jsonl for the committed fixture', () => {
  const { lines } = migrateRecordsDirectoryToJsonl(loadLegacyRecords());
  const produced = `${lines.join('\n')}\n`;
  assert.equal(produced, readFileSync(join(root, EXPECTED), 'utf8'));
});

test('migration is deterministic regardless of source record order', () => {
  const records = loadLegacyRecords();
  const forward = migrateRecordsDirectoryToJsonl(records);
  const reversed = migrateRecordsDirectoryToJsonl([...records].reverse());
  assert.deepEqual(reversed.lines, forward.lines);
  assert.deepEqual(reversed.migrationRecord, forward.migrationRecord);
});

test('round-trip migrate then reconstruct reproduces identical digests for every record', () => {
  const records = loadLegacyRecords();
  const { lines } = migrateRecordsDirectoryToJsonl(records);
  const layout = reconstructDirectoryLayoutFromJsonl(lines);
  const reconstructed = flattenReconstructedLayout(layout);

  assert.deepEqual(
    reconstructed.map((record) => record.digest).sort(),
    records.map((record) => record.digest).sort(),
  );

  const byDigest = new Map(reconstructed.map((record) => [record.digest, record]));
  for (const record of records) {
    const restored = byDigest.get(record.digest);
    assert.ok(restored, `missing reconstruction for ${record.digest}`);
    // Reversible and lossless: the container is restored and content is untouched.
    assert.deepEqual(restored, record);
    assert.deepEqual(restored.content, record.content);
  }
});

test('recordCount is preserved and the migration record validates as v1.3', () => {
  const records = loadLegacyRecords();
  const { migrationRecord } = migrateRecordsDirectoryToJsonl(records);
  assertProtocolArtifact('operating-migration-record', migrationRecord, { protocolVersion: '1.3.0' });
  assert.equal(migrationRecord.recordCount.before, records.length);
  assert.equal(migrationRecord.recordCount.after, records.length);
  assert.equal(migrationRecord.recordCount.before, migrationRecord.recordCount.after);
  assert.equal(migrationRecord.eventCount.before, migrationRecord.eventCount.after);
  assert.equal(migrationRecord.sourceKind, 'protocol-upgrade');
  assert.equal(migrationRecord.sourceLayout, 'directory-per-digest-prefix');
  assert.equal(migrationRecord.targetLayout, 'records-jsonl');
  assert.equal(migrationRecord.state, 'previewed');
});

test('an explicit event-log size is preserved identically across the container migration', () => {
  const records = loadLegacyRecords();
  const { migrationRecord } = migrateRecordsDirectoryToJsonl(records, { eventCount: 128 });
  assertProtocolArtifact('operating-migration-record', migrationRecord, { protocolVersion: '1.3.0' });
  assert.equal(migrationRecord.eventCount.before, 128);
  assert.equal(migrationRecord.eventCount.after, 128);
});

test('migrating an empty record set produces an empty records.jsonl, not an error', () => {
  const { lines, migrationRecord } = migrateRecordsDirectoryToJsonl([]);
  assert.deepEqual(lines, []);
  assertProtocolArtifact('operating-migration-record', migrationRecord, { protocolVersion: '1.3.0' });
  assert.equal(migrationRecord.recordCount.before, 0);
  assert.equal(migrationRecord.recordCount.after, 0);
  assert.equal(migrationRecord.eventCount.before, 0);
  assert.deepEqual(migrationRecord.mappings, []);
  // Reconstructing an empty log yields an empty layout, not a throw.
  assert.equal(flattenReconstructedLayout(reconstructDirectoryLayoutFromJsonl(lines)).length, 0);
});

test('invalid input fails closed with a named migration error', () => {
  assert.throws(
    () => migrateRecordsDirectoryToJsonl('not-an-array'),
    { code: 'E_OPERATE_MIGRATION_INVALID' },
  );
  assert.throws(
    () => migrateRecordsDirectoryToJsonl([{ recordType: 'finding', content: {} }]),
    { code: 'E_OPERATE_MIGRATION_INVALID' },
  );
});
