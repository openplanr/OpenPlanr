import path from 'node:path';
import { excludeCustodyRecords } from './preservation-lib.mjs';

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

export function excludeArchivedDashboardRecords(source, { custodyRoot } = {}) {
  return excludeCustodyRecords(
    source,
    ARCHIVED_DASHBOARD_PATHS.map((sourcePath) => ({
      mappingId: `planr-pipeline:cutoff:${sourcePath}`,
      archivePath: path.basename(sourcePath),
    })),
    {
      reason: 'retired-dashboard-planning-retained-in-verified-custody',
      flag: '--archived-dashboard-custody',
      custodyRoot,
      label: 'Archived dashboard record',
    },
  );
}
