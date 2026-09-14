import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SEMVER_REGEX } from '../../packages/protocol/src/semver.mjs';
import { assert, sealDocument, sha256 } from './preservation-lib.mjs';

// Only these two public packages carry a captured pre-consolidation changelog.
// The new Protocol package has no historical source mapping to reinterpret.
export const RELEASE_CHANGELOG_PATHS = Object.freeze({
  'openplanr-cli:cutoff:CHANGELOG.md': 'packages/cli/CHANGELOG.md',
  'planr-pipeline:cutoff:CHANGELOG.md': 'packages/pipeline/CHANGELOG.md',
});
const policy = 'release-history-bound';
const reason = 'new-release-notes-preserve-captured-history';

function assertReleaseMapping(mapping) {
  const destination = RELEASE_CHANGELOG_PATHS[mapping.mappingId];
  assert(destination, `Not an approved release changelog: ${mapping.mappingId}`);
  assert(mapping.sourcePath === 'CHANGELOG.md', `Invalid changelog source: ${mapping.mappingId}`);
  assert(mapping.destinations.length === 1 && mapping.destinations[0].path === destination,
    `Release changelog destination drift: ${mapping.mappingId}`);
  assert(mapping.verification.sha256 === mapping.included.sha256,
    `Release changelog original digest drift: ${mapping.mappingId}`);
  return destination;
}

export function verifyReleaseChangelogHistory(mapping, bytes) {
  assertReleaseMapping(mapping);
  const verification = mapping.verification;
  assert(mapping.disposition === 'merged' && mapping.reasonCode === reason && verification.policy === policy,
    `Invalid release changelog preservation policy: ${mapping.mappingId}`);
  const { prefixBytes, historyBytes } = verification;
  assert(Number.isSafeInteger(prefixBytes) && prefixBytes > 0 && Number.isSafeInteger(historyBytes) && historyBytes > 0,
    `Invalid release changelog byte boundaries: ${mapping.mappingId}`);
  assert(bytes.length >= prefixBytes + historyBytes, `Release changelog history was truncated: ${mapping.mappingId}`);
  // Changesets inserts releases after the unchanged title line. Reconstruct
  // the complete captured file from that prefix and the untouched historical
  // suffix, then compare its original digest rather than a refreshed digest.
  const historyOffset = bytes.length - historyBytes;
  const original = Buffer.concat([bytes.subarray(0, prefixBytes), bytes.subarray(historyOffset)]);
  assert(sha256(original) === verification.sha256, `Captured changelog history changed: ${mapping.mappingId}`);
  const additions = bytes.subarray(prefixBytes, historyOffset).toString('utf8');
  if (additions) {
    const heading = /^\n## ([^\n]+)\n/u.exec(additions);
    assert(heading && SEMVER_REGEX.test(heading[1]), `Expected prepended release notes: ${mapping.mappingId}`);
  }
}

export async function preserveReleaseChangelogHistory(source, { custodyRoot } = {}) {
  const inventory = structuredClone(source);
  for (const [mappingId, destination] of Object.entries(RELEASE_CHANGELOG_PATHS)) {
    const mapping = inventory.pathMappings.find(entry => entry.mappingId === mappingId);
    assert(mapping, `Release changelog is missing from source custody: ${mappingId}`);
    assertReleaseMapping(mapping);
    if (mapping.verification.policy === policy) continue;
    assert(['exact', 'moved'].includes(mapping.disposition) && mapping.verification.policy === 'byte-bound',
      `Unexpected original changelog policy: ${mappingId}`);
    assert(custodyRoot, `Reclassifying ${mappingId} requires --release-changelog-custody with a verified restored snapshot.`);
    const original = await readFile(path.resolve(custodyRoot, destination));
    assert(sha256(original) === mapping.included.sha256, `Restored changelog custody bytes differ: ${mappingId}`);
    const prefixBytes = original.indexOf(10) + 1;
    assert(prefixBytes > 0 && prefixBytes < original.length, `Captured changelog has no title and history: ${mappingId}`);
    mapping.disposition = 'merged';
    mapping.reasonCode = reason;
    mapping.verification = {
      policy,
      requirement: 'any',
      sha256: mapping.included.sha256,
      prefixBytes,
      historyBytes: original.length - prefixBytes,
      executable: false,
    };
  }
  inventory.coverage.dispositionCounts = {};
  for (const mapping of inventory.pathMappings) {
    inventory.coverage.dispositionCounts[mapping.disposition] = (inventory.coverage.dispositionCounts[mapping.disposition] ?? 0) + 1;
  }
  delete inventory.documentDigest;
  return sealDocument(inventory);
}
