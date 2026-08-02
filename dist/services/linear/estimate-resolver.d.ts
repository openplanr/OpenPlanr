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
/**
 * Result of resolving a local estimate for a push. Exactly one of
 * `estimate` (mapped value, ready to send to Linear) or `reason` (why the
 * field is being omitted) is populated.
 */
export type EstimateResolution = {
    kind: 'mapped';
    estimate: number;
    originalValue: number;
    snapped: boolean;
} | {
    kind: 'skip-not-used';
} | {
    kind: 'skip-t-shirt';
} | {
    kind: 'skip-no-local-value';
} | {
    kind: 'skip-invalid-value';
    rawValue: unknown;
};
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
export declare function resolveEstimateForPush(frontmatter: Record<string, unknown>, scale: LinearIssueEstimationType | string | undefined): EstimateResolution;
//# sourceMappingURL=estimate-resolver.d.ts.map