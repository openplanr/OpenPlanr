import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { minimalSubprocessEnvironment } from './subprocess-env.js';
import type { OperatingState } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * FR7 — cycle integrity as a first-class surface.
 *
 * The integrity summary is assembled directly from committed state (the cycle's
 * governed data gaps), never from any advisory lens's own prose. In the audited
 * run the only integrity signal reached the operator because two lenses happened
 * to restate a citation rejection in their narrative; a lens that stayed silent
 * would have hidden it entirely. This module derives the same signal
 * deterministically so both `reports.ts` (the readable-tree section and its own
 * file) and `doctor.ts` (the regression guard) render it from one source and can
 * never drift.
 *
 * The signals:
 *  - citation rejections — `unresolvable-citation` gaps opened when a cited
 *    location could not be resolved to evidence at the pinned revision;
 *  - boundary refusals — the subset of those refused because the citation
 *    reached outside the pinned read boundary (uncommitted working-tree content,
 *    a root escape, or an above-ceiling read);
 *  - not_evaluated roles — a role whose citation-bearing response grounded zero
 *    evidence commits a schema-legal `quiet` result plus a governed
 *    `missing-evidence` gap naming it; that gap is the committed source of truth
 *    for the role's real not_evaluated reason.
 */

/** A rejected/refused citation, sourced from an `unresolvable-citation` gap. */
export interface OperatingIntegrityCitationEntry {
  gapId: string;
  reason: string;
  detail: string;
  affectedRoles: string[];
}

/** A role recorded not_evaluated, with its real gap reason (not lens prose). */
export interface OperatingIntegrityNotEvaluatedRole {
  roleId: string;
  gapId: string;
  reason: string;
  detail: string;
}

export interface OperatingIntegritySummary {
  cycleId: string;
  citationRejections: OperatingIntegrityCitationEntry[];
  boundaryRefusals: OperatingIntegrityCitationEntry[];
  notEvaluatedRoles: OperatingIntegrityNotEvaluatedRole[];
  /** True when any integrity signal is present for the cycle. */
  hasConcerns: boolean;
}

function field(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim() : '';
}

function roleList(record: Record<string, unknown>): string[] {
  const value = record.affectedRoles;
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))].sort()
    : [];
}

// A citation refused because it reached outside the pinned read boundary — the
// dirty working tree, a root escape, or an above-ceiling read — rather than
// simply not resolving. Classified from the gap's machine `reason`/text so the
// operator sees a boundary refusal named distinctly from a plain rejection.
const BOUNDARY_REASON = /dirty-working-tree|boundary|root-escape|above-ceiling|out-of-boundary/i;

function isBoundaryRefusal(gap: Record<string, unknown>): boolean {
  if (field(gap, 'category') === 'boundary-refusal') return true;
  return BOUNDARY_REASON.test(`${field(gap, 'reason')} ${field(gap, 'question')}`);
}

/**
 * Assemble the cycle's integrity summary from committed state. Pure over
 * `OperatingState`, so `reports.ts` and `doctor.ts` produce identical results.
 */
export function buildOperatingIntegritySummary(
  state: OperatingState,
  cycleId: string,
): OperatingIntegritySummary {
  const gaps = state.dataGaps.filter((gap) => gap.cycleId === undefined || gap.cycleId === cycleId);
  const citationRejections: OperatingIntegrityCitationEntry[] = [];
  const boundaryRefusals: OperatingIntegrityCitationEntry[] = [];
  const notEvaluatedRoles: OperatingIntegrityNotEvaluatedRole[] = [];

  for (const gap of gaps) {
    const category = field(gap, 'category');
    if (category === 'unresolvable-citation' || category === 'boundary-refusal') {
      const entry: OperatingIntegrityCitationEntry = {
        gapId: String(gap.id),
        reason: field(gap, 'reason') || 'unresolvable',
        detail: field(gap, 'question') || 'A cited location could not be resolved to evidence.',
        affectedRoles: roleList(gap),
      };
      if (isBoundaryRefusal(gap)) boundaryRefusals.push(entry);
      else citationRejections.push(entry);
      continue;
    }
    if (category === 'missing-evidence') {
      const reason =
        field(gap, 'reason') || 'The role grounded no evidence and is recorded not_evaluated.';
      const detail = field(gap, 'question') || 'The role resolved zero citations to evidence.';
      const roles = roleList(gap);
      for (const roleId of roles.length > 0 ? roles : ['unknown']) {
        notEvaluatedRoles.push({ roleId, gapId: String(gap.id), reason, detail });
      }
    }
  }

  const byGapId = (left: { gapId: string }, right: { gapId: string }): number =>
    left.gapId.localeCompare(right.gapId);
  citationRejections.sort(byGapId);
  boundaryRefusals.sort(byGapId);
  notEvaluatedRoles.sort(
    (left, right) => left.roleId.localeCompare(right.roleId) || byGapId(left, right),
  );

  return {
    cycleId,
    citationRejections,
    boundaryRefusals,
    notEvaluatedRoles,
    hasConcerns: citationRejections.length + boundaryRefusals.length + notEvaluatedRoles.length > 0,
  };
}

/**
 * Render the integrity signals as the body of the `# Integrity` section embedded
 * in the cycle report and the standalone `cycles/<id>/integrity.md`. Every entry
 * is named explicitly; a clean cycle states so plainly rather than omitting the
 * section, so the operator can always confirm integrity was evaluated.
 */
export function renderOperatingIntegritySection(summary: OperatingIntegritySummary): string {
  if (!summary.hasConcerns) {
    return 'No citation rejections, boundary refusals, or not_evaluated roles were recorded for this cycle.';
  }
  const lines: string[] = [];
  lines.push('## Citation rejections', '');
  lines.push(
    ...(summary.citationRejections.length > 0
      ? summary.citationRejections.map(
          (entry) =>
            `- **${entry.gapId}** (${entry.reason}): ${entry.detail}${
              entry.affectedRoles.length > 0 ? ` Affected: ${entry.affectedRoles.join(', ')}.` : ''
            }`,
        )
      : ['- None.']),
  );
  lines.push('', '## Boundary refusals', '');
  lines.push(
    ...(summary.boundaryRefusals.length > 0
      ? summary.boundaryRefusals.map(
          (entry) =>
            `- **${entry.gapId}** (${entry.reason}): ${entry.detail}${
              entry.affectedRoles.length > 0 ? ` Affected: ${entry.affectedRoles.join(', ')}.` : ''
            }`,
        )
      : ['- None.']),
  );
  lines.push('', '## Not-evaluated roles', '');
  lines.push(
    ...(summary.notEvaluatedRoles.length > 0
      ? summary.notEvaluatedRoles.map(
          (role) => `- **${role.roleId}** (${role.gapId}): ${role.reason}`,
        )
      : ['- None.']),
  );
  return lines.join('\n');
}

/**
 * The standalone `cycles/<id>/integrity.md` body — the dedicated readable-tree
 * file guaranteeing the integrity signal survives independently of any report or
 * lens. Emitted only for a cycle that actually has integrity signals (a clean
 * cycle writes no integrity file), keeping the readable tree free of empty
 * artifacts.
 */
export function renderOperatingIntegrityDocument(summary: OperatingIntegritySummary): string {
  return [
    `# Cycle integrity — ${summary.cycleId}`,
    '',
    'Assembled from the cycle’s governed data gaps, independent of any advisory',
    'lens’s own prose. Each citation rejection, boundary refusal, and',
    'not_evaluated role below is a committed integrity signal for this cycle.',
    '',
    renderOperatingIntegritySection(summary),
  ].join('\n');
}

/**
 * FR9 — honest workspace claims. Detect whether the project's `.planr/`
 * directory is gitignored, and state plainly what that means for versioning the
 * Operating Board. A gitignored `.planr/` is a legitimate choice (the board can
 * be a machine-local artifact), but the CLI must not imply the sanitized,
 * safe-to-commit board content is being tracked when git is configured to ignore
 * it. A project that is not a git worktree, or a git binary that cannot answer,
 * yields `ignored: false` with a neutral statement rather than a false claim.
 */
export interface OperatingWorkspaceVersioning {
  ignored: boolean;
  message: string;
}

export async function detectGitignoredWorkspace(
  projectRoot: string,
): Promise<OperatingWorkspaceVersioning> {
  try {
    await execFileAsync('git', ['check-ignore', '--quiet', '.planr'], {
      cwd: path.resolve(projectRoot),
      env: minimalSubprocessEnvironment({
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
      }),
      timeout: 15_000,
    });
    // Exit 0: `.planr` is ignored by git.
    return {
      ignored: true,
      message:
        'This project’s `.planr/` is gitignored, so the Operating Board is not tracked or ' +
        'versioned by git. The board content is sanitized for safe committing, but with `.planr/` ' +
        'ignored it stays a machine-local artifact — commit it explicitly (or remove the ignore ' +
        'rule) if you want the board versioned alongside the code.',
    };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    // git check-ignore exits 1 when the path is NOT ignored — that is the healthy
    // path, not a failure. Any other exit (git missing, not a worktree) leaves the
    // status undetermined; report it neutrally rather than asserting either way.
    if (code === 1) {
      return {
        ignored: false,
        message:
          '`.planr/` is not gitignored; the sanitized Operating Board content is eligible to be ' +
          'committed and versioned alongside the code.',
      };
    }
    return {
      ignored: false,
      message:
        'Git tracking status for `.planr/` could not be determined (this may not be a git ' +
        'worktree); the Operating Board content is sanitized for safe committing where git tracks it.',
    };
  }
}
