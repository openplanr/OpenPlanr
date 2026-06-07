/**
 * Walkthrough navigation mode, chosen by screen count.
 *
 *   ≤ 8 screens → 'anchor'  (the muvi pattern: one long page, sidebar
 *                            smooth-scroll, all screens in the DOM)
 *   > 8 screens → 'lazy'    (discrete screen-switching; mount the active
 *                            screen + neighbors, lazy the rest)
 *
 * Resolved at the SPEC-015 final gate (#19: "support both, default lazy").
 * Anchor reads better for a small gallery; lazy keeps first paint fast once a
 * spec has many heavy screens. Pure, stdlib-only.
 */

/** Inclusive upper bound for the anchor-scroll nav mode. */
export const ANCHOR_MAX_SCREENS = 8;

/**
 * @param {number} screenCount
 * @returns {'anchor'|'lazy'}
 */
export function chooseWalkthroughNav(screenCount) {
  const n = Number.isFinite(screenCount) ? Math.trunc(screenCount) : 0;
  return n > ANCHOR_MAX_SCREENS ? 'lazy' : 'anchor';
}
