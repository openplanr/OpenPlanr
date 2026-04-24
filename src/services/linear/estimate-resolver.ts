/**
 * Scale-aware snapping from OpenPlanr `storyPoints` → Linear `estimate` field.
 *
 * Linear's estimate field is numeric and must match the team's configured
 * scale (`fibonacci`, `linear`, `exponential`, or `tShirt`). A value that
 * isn't on the scale is rejected by the API, so we snap to the nearest
 * allowed value before sending. Callers use the returned snap event to emit
 * a debug log once per transformation.
 *
 * Scales mirror Linear's own SDK values — see `LinearIssueEstimationType`
 * in `src/models/types.ts`.
 */

import type { LinearIssueEstimationType } from '../../models/types.js';

const FIBONACCI_SCALE = [0, 1, 2, 3, 5, 8, 13, 21] as const;
const LINEAR_SCALE = [0, 1, 2, 3, 4, 5] as const;
const EXPONENTIAL_SCALE = [0, 1, 2, 4, 8, 16] as const;

function snapToNearest(value: number, scale: readonly number[]): number {
  let best = scale[0];
  let bestDistance = Math.abs(value - best);
  for (const candidate of scale) {
    const distance = Math.abs(value - candidate);
    // Break ties toward the larger value — under-estimating is a common
    // planning bias; snapping up ("4 is really a 5") leans against it.
    if (distance < bestDistance || (distance === bestDistance && candidate > best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Result of resolving a local estimate for a push. Exactly one of
 * `estimate` (mapped value, ready to send to Linear) or `reason` (why the
 * field is being omitted) is populated.
 */
export type EstimateResolution =
  | { kind: 'mapped'; estimate: number; originalValue: number; snapped: boolean }
  | { kind: 'skip-not-used' }
  | { kind: 'skip-t-shirt' }
  | { kind: 'skip-no-local-value' }
  | { kind: 'skip-invalid-value'; rawValue: unknown };

/**
 * Resolve a local `storyPoints` (or `estimatedPoints`) value to a Linear
 * `estimate` value given the team's scale.
 *
 * Precedence for the raw local value:
 *   1. `frontmatter.estimatedPoints` — canonical name written by
 *      `planr estimate --save` (see `src/cli/commands/estimate.ts`).
 *   2. `frontmatter.storyPoints` — alias accepted for hand-edited files or
 *      direct AI-response copies that used the schema field name verbatim.
 *
 * Returns one of:
 *   - `mapped` — include `estimate: <value>` in the push input
 *   - `skip-*` — omit the `estimate` field; `kind` carries the reason for
 *      logging / dry-run display
 */
export function resolveEstimateForPush(
  frontmatter: Record<string, unknown>,
  scale: LinearIssueEstimationType | string | undefined,
): EstimateResolution {
  if (scale === 'notUsed' || !scale) {
    return { kind: 'skip-not-used' };
  }
  if (scale === 'tShirt') {
    // No safe numeric → XS/S/M/L/XL mapping without user config. Skip.
    return { kind: 'skip-t-shirt' };
  }

  const rawLocal =
    frontmatter.estimatedPoints !== undefined
      ? frontmatter.estimatedPoints
      : frontmatter.storyPoints;
  if (rawLocal === undefined || rawLocal === null || rawLocal === '') {
    return { kind: 'skip-no-local-value' };
  }
  const parsed = typeof rawLocal === 'number' ? rawLocal : Number(rawLocal);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { kind: 'skip-invalid-value', rawValue: rawLocal };
  }

  const allowed =
    scale === 'fibonacci'
      ? FIBONACCI_SCALE
      : scale === 'linear'
        ? LINEAR_SCALE
        : scale === 'exponential'
          ? EXPONENTIAL_SCALE
          : undefined;
  if (!allowed) {
    // Unknown scale value returned by Linear — skip rather than guess.
    return { kind: 'skip-not-used' };
  }

  const snapped = snapToNearest(parsed, allowed);
  return {
    kind: 'mapped',
    estimate: snapped,
    originalValue: parsed,
    snapped: snapped !== parsed,
  };
}
