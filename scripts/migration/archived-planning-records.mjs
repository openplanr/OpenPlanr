import { excludeCustodyRecords } from './preservation-lib.mjs';

// Internal planning material retired from the public tree: design plans, PRDs,
// review verdicts, approval receipts, continuation plans, and the superseded CLI
// architecture note. Archive copies keep the package layout under
// `.planr/archive/docs/<pipeline|cli>/` without the leading `docs/` segment.
const PIPELINE_PLANNING_PATHS = Object.freeze([
  'docs/artifact-review-approval.md',
  'docs/dashboard-prd.md',
  'docs/design-command-plan.md',
  'docs/feat-native-parallel-dispatch/README.md',
  'docs/feat-native-parallel-dispatch/architecture.md',
  'docs/feat-native-parallel-dispatch/how-to-dispatch.md',
  'docs/feat-native-parallel-dispatch/us-001-remove-worktree-isolation.md',
  'docs/feat-native-parallel-dispatch/us-002-remove-dag-wave-scheduler.md',
  'docs/feat-native-parallel-dispatch/us-003-native-parallel-dispatch.md',
  'docs/feat-native-parallel-dispatch/us-004-conformance-ci-docs-version.md',
  'docs/feat-parallel-dispatch/README.md',
  'docs/feat-parallel-dispatch/api.md',
  'docs/feat-parallel-dispatch/architecture.md',
  'docs/feat-parallel-dispatch/conformance.md',
  'docs/feat-parallel-dispatch/us-001-native-dispatch-core.md',
  'docs/operate/AGENTIC_EXECUTIVE_BOARD.md',
  'docs/operate/CONTINUATION_PLAN.md',
  'docs/operate/README.md',
  'docs/reviews/SPEC-003-security-review.md',
]);
const CLI_PLANNING_PATHS = Object.freeze([
  'docs/ARCHITECTURE.md',
  'docs/proposals/spec-driven-mode.md',
]);

const archivePath = (directory, sourcePath) => `${directory}/${sourcePath.replace(/^docs\//u, '')}`;

export const ARCHIVED_PLANNING_RECORDS = Object.freeze([
  ...PIPELINE_PLANNING_PATHS.map((sourcePath) => ({
    mappingId: `planr-pipeline:cutoff:${sourcePath}`,
    archivePath: archivePath('pipeline', sourcePath),
  })),
  ...CLI_PLANNING_PATHS.map((sourcePath) => ({
    mappingId: `openplanr-cli:cutoff:${sourcePath}`,
    archivePath: archivePath('cli', sourcePath),
  })),
]);

export function excludeArchivedPlanningRecords(source, { custodyRoot } = {}) {
  return excludeCustodyRecords(source, ARCHIVED_PLANNING_RECORDS, {
    reason: 'retired-internal-planning-retained-in-verified-custody',
    flag: '--archived-planning-custody',
    custodyRoot,
    label: 'Archived planning record',
  });
}
