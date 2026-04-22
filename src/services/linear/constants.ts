/**
 * Linear integration constants + id-shape validators + input-safety helpers.
 *
 * All field-limit values here are enforced at the SDK-wrapper layer in
 * `src/services/linear-service.ts` so that every caller gets the guard for
 * free. Shape validators (`isLikelyLinear*Id`) fence off stale frontmatter
 * before it reaches the Linear API.
 */

import { logger } from '../../utils/logger.js';

/** Credential-service provider key under which the Linear PAT is stored. */
export const LINEAR_CREDENTIAL_KEY = 'linear' as const;

/**
 * Linear's backend enforces per-field length limits on every create/update
 * mutation. Defend at the SDK-wrapper layer so callers don't have to think
 * about them. Names / titles: confirmed or best-known caps; descriptions:
 * conservative floors well under Linear's real ceilings (markdown + HTML
 * are both accepted; real limits are in the tens of thousands).
 */
export const LINEAR_FIELD_LIMITS = {
  /** ProjectMilestone.name — confirmed 80 by `Argument Validation Error`. */
  milestoneName: 80,
  /** IssueLabel.name — Linear team labels cap ~64 chars. */
  labelName: 64,
  /** Project.name — generous cap. */
  projectName: 256,
  /** Issue.title — Linear issue title cap ~255. */
  issueTitle: 255,
  /** Project.description — conservative floor; real Linear ceiling is higher. */
  projectDescription: 50_000,
  /** ProjectMilestone.description. */
  milestoneDescription: 50_000,
  /** IssueLabel.description — labels rarely need long descriptions. */
  labelDescription: 500,
  /** Issue.description (markdown body). */
  issueDescription: 65_000,
} as const;

/**
 * Truncate a string to Linear's character limit for a given field. Logs a
 * warning on truncation so the operator can spot it in the push output.
 */
export function truncateForLinear(value: string, maxLen: number, fieldLabel: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const truncated = trimmed.slice(0, maxLen);
  logger.warn(
    `${fieldLabel} truncated from ${trimmed.length} → ${maxLen} chars to satisfy Linear's limit.`,
  );
  return truncated;
}

/**
 * Non-empty guard for required Linear name/title fields. Fails fast with an
 * actionable message before the API would reject the call.
 */
export function requireNonEmpty(value: string | null | undefined, fieldLabel: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw new Error(
      `${fieldLabel} is empty — Linear requires a non-empty value. Add a title to the OpenPlanr artifact and re-run.`,
    );
  }
  return trimmed;
}

/**
 * Heuristic: Linear workflow state id (uuid) vs human-readable state name.
 * The `/i` flag is intentional — Linear's API canonicalizes UUIDs to
 * lowercase, but defensive acceptance of uppercase hex matches RFC 4122
 * and protects against tools that normalize differently.
 */
export function isLikelyLinearWorkflowStateId(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s.trim(),
  );
}

/**
 * Validate that a value plausibly identifies a Linear issue. Two valid shapes:
 *   1. UUIDv4 (e.g. `9b2f4c3e-...`) — canonical API form
 *   2. Linear identifier (e.g. `ENG-42`) — human-readable, also accepted by `client.issue()`
 * Anything else is treated as stale/corrupted frontmatter and skipped before
 * hitting the API.
 */
export function isLikelyLinearIssueId(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length === 0) return false;
  if (isLikelyLinearWorkflowStateId(trimmed)) return true;
  return /^[A-Z]{2,}-\d+$/.test(trimmed);
}
