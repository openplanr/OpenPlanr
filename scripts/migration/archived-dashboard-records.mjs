import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { assert, sealDocument, sha256 } from './preservation-lib.mjs';

// Only the retired SPEC-016 planning records covered by the approved cleanup.
// Current dashboard docs, schemas, fixtures, and runtime code remain public.
export const ARCHIVED_DASHBOARD_PATHS = Object.freeze([
  'docs/feat-dashboard/README.md',
  'docs/feat-dashboard/api.md',
  'docs/feat-dashboard/architecture.md',
  'docs/feat-dashboard/screens.md',
  'docs/feat-dashboard/us-001-dashboard-command-server-bootstrap.md',
  'docs/feat-dashboard/us-002-graph-data-engine.md',
  'docs/feat-dashboard/us-003-dashboard-shell-overview.md',
  'docs/feat-dashboard/us-004-dashboard-live-sync.md',
  'docs/feat-dashboard/us-005-dashboard-conformance-tests-docs-version.md',
  'docs/feat-dashboard/us-006-dashboard-graph-view.md',
  'docs/feat-dashboard/us-007-dashboard-board-list-search.md',
  'docs/feat-dashboard/us-008-dashboard-detail-sprint-activity.md',
]);
const reason = 'retired-dashboard-planning-retained-in-verified-custody';

export async function excludeArchivedDashboardRecords(source, { custodyRoot } = {}) {
  const inventory = structuredClone(source);
  for (const sourcePath of ARCHIVED_DASHBOARD_PATHS) {
    const mappingId = `planr-pipeline:cutoff:${sourcePath}`;
    const mapping = inventory.pathMappings.find(entry => entry.mappingId === mappingId);
    assert(mapping, `Archived dashboard record is missing from source custody: ${mappingId}`);
    if (mapping.disposition === 'excluded' && mapping.reasonCode === reason) {
      assert(mapping.destinations.length === 0 && mapping.verification.policy === 'declared-absence', `Invalid archived dashboard disposition: ${mappingId}`);
      continue;
    }
    assert(custodyRoot, `Reclassifying ${mappingId} requires --archived-dashboard-custody with the verified archive directory.`);
    const archivedPath = path.resolve(custodyRoot, path.basename(sourcePath));
    const stats = await lstat(archivedPath);
    assert(stats.isFile() && !stats.isSymbolicLink(), `Archived custody must be a regular file: ${mappingId}`);
    const bytes = await readFile(archivedPath);
    assert(sha256(bytes) === mapping.included.sha256, `Archived custody bytes differ for ${mappingId}.`);
    assert(Boolean(stats.mode & 0o111) === (mapping.included.mode === '100755'), `Archived custody mode differs for ${mappingId}.`);
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
