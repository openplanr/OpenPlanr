import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assert, sealDocument, sha256 } from './preservation-lib.mjs';

// Exact historical records covered by the approved public-source cleanup.
// Schemas, public contracts, and synthetic ADR fixtures are not in this list.
export const PRIVATE_DECISION_PATHS = Object.freeze([
  'docs/adrs/ADR-001-protocol-ownership.md',
  'docs/adrs/ADR-002-portable-pipeline-package.md',
  'docs/adrs/ADR-003-runtime-routing-and-migration.md',
  'docs/adrs/ADR-004-runtime-lock-and-provenance.md',
  'docs/adrs/ADR-005-artifact-review-sharing-security.md',
  'docs/adrs/ADR-008-cli-owned-guided-interactions.md',
  'docs/adrs/ADR-012-board-sync-identity-fields.md',
]);
const reason = 'private-decision-record-retained-in-verified-custody';

export async function excludePrivateDecisionRecords(source, { custodyRoot } = {}) {
  const inventory = structuredClone(source);
  for (const sourcePath of PRIVATE_DECISION_PATHS) {
    const mappingId = `planr-pipeline:cutoff:${sourcePath}`;
    const mapping = inventory.pathMappings.find(entry => entry.mappingId === mappingId);
    assert(mapping, `Private decision record is missing from source custody: ${mappingId}`);
    if (mapping.disposition === 'excluded' && mapping.reasonCode === reason) {
      assert(mapping.destinations.length === 0 && mapping.verification.policy === 'declared-absence', `Invalid private decision disposition: ${mappingId}`);
      continue;
    }
    assert(custodyRoot, `Reclassifying ${mappingId} requires --private-decision-custody with a verified restored snapshot.`);
    const bytes = await readFile(path.resolve(custodyRoot, 'packages/pipeline', sourcePath));
    assert(sha256(bytes) === mapping.included.sha256, `Restored custody bytes differ for ${mappingId}.`);
    mapping.disposition = 'excluded';
    mapping.reasonCode = reason;
    mapping.destinations = [];
    mapping.verification = { policy: 'declared-absence' };
  }
  inventory.coverage.dispositionCounts = {};
  for (const mapping of inventory.pathMappings) {
    inventory.coverage.dispositionCounts[mapping.disposition] = (inventory.coverage.dispositionCounts[mapping.disposition] ?? 0) + 1;
  }
  delete inventory.documentDigest;
  return sealDocument(inventory);
}
