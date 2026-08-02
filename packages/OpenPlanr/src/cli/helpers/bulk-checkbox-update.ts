/**
 * Shared helpers for `--all-done` / `--all-pending` flags on `planr <type>
 * update` commands. The flag flips every `N.M` task checkbox in the
 * artifact body to one canonical state and sets the matching frontmatter
 * `status` value, in a single user-facing operation.
 *
 * BL-015 — closes the gap where shipping a feature meant manually ticking
 * every subtask checkbox after `planr <type> update --status done`.
 */

import type { ArtifactType, OpenPlanrConfig } from '../../models/types.js';
import {
  readArtifactRaw,
  updateArtifact,
  updateArtifactFields,
} from '../../services/artifact-service.js';
import { logger } from '../../utils/logger.js';
import { applyAllCheckboxes } from '../../utils/markdown.js';

export interface BulkCheckboxApplyResult {
  /** The status value written to frontmatter (derived from the flag). */
  status: 'done' | 'pending';
  /** True when the body actually contained any checkboxes that flipped. */
  flippedAny: boolean;
}

/**
 * Validate that `--status`, `--all-done`, and `--all-pending` aren't
 * combined in mutually-exclusive ways. Returns the resolved status value
 * to write (or `null` to use the explicit `--status` path), or throws a
 * user-friendly error.
 */
export function resolveBulkStatusIntent(opts: {
  status?: string;
  allDone?: boolean;
  allPending?: boolean;
}): { useBulk: false; status?: string } | { useBulk: true; bulkStatus: 'done' | 'pending' } {
  const flagsSet = [opts.allDone, opts.allPending].filter(Boolean).length;
  if (flagsSet > 1) {
    throw new Error('--all-done and --all-pending are mutually exclusive.');
  }
  if (flagsSet === 0) {
    return { useBulk: false, status: opts.status };
  }
  // Bulk flag set — --status is implied, so combining adds noise (or worse,
  // a contradiction). Reject the combo with a clear pointer.
  if (opts.status) {
    throw new Error(
      `--status and ${opts.allDone ? '--all-done' : '--all-pending'} are mutually exclusive — the bulk flag implies a status. Use one or the other.`,
    );
  }
  return { useBulk: true, bulkStatus: opts.allDone ? 'done' : 'pending' };
}

/**
 * Apply the bulk-checkbox flag to one artifact: rewrite the body (flip every
 * `N.M` checkbox) and set the matching frontmatter status. Atomic per write
 * (body + frontmatter are two separate atomic-write calls; a failure between
 * them leaves the body flipped but status untouched — recoverable).
 */
export async function applyBulkCheckboxes(
  projectDir: string,
  config: OpenPlanrConfig,
  type: ArtifactType,
  id: string,
  bulkStatus: 'done' | 'pending',
): Promise<BulkCheckboxApplyResult> {
  const raw = await readArtifactRaw(projectDir, config, type, id);
  if (raw === null) {
    throw new Error(`${type} ${id} not found.`);
  }

  const newContent = applyAllCheckboxes(raw, bulkStatus === 'done');
  const flippedAny = newContent !== raw;

  if (flippedAny) {
    await updateArtifact(projectDir, config, type, id, newContent);
  } else {
    logger.dim(`  ${id}: no task checkboxes to flip — only frontmatter status will change.`);
  }

  await updateArtifactFields(projectDir, config, type, id, { status: bulkStatus });

  return { status: bulkStatus, flippedAny };
}
