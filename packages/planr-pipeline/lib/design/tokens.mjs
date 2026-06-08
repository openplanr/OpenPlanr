/**
 * Design tokens — the FIXED vocabulary the `/planr-pipeline:design` generator
 * authors with, and the scale `lib/design/lint.mjs` validates against
 * (SPEC-015 follow-up, v0.16.0).
 *
 * This is the engineering answer to "how do designers keep sizing/spacing
 * pixel-consistent?": a real design system constrains layout to a small, fixed
 * scale (the 4-point grid) and reuses shared component classes — so off-scale
 * values and same-type drift become *impossible*, not merely discouraged. We
 * encode that scale here once; the generator emits only these steps and the
 * linter fails anything off them.
 *
 * Pure, stdlib-only.
 */

/**
 * The 4-point grid. Legal spacing (padding / margin / gap / inset) is `0`, `2`
 * (hairline), or any multiple of 4 — every professional spacing system snaps to
 * a grid like this. `COMMON_SPACING` is the preferred subset the rubric shows;
 * the *rule* (below) is what the linter enforces, so on-grid large values like
 * 60 / 120 still pass.
 */
export const SPACING_STEP = 4;
export const COMMON_SPACING = [4, 8, 12, 16, 24, 32, 48, 64];

/**
 * Canonical artboard frames. ALL desktop screens use ONE frame (the fix for the
 * per-screen 760/700/820 height drift): width AND height are fixed, and content
 * taller than the frame scrolls inside the screen container. A consistent frame
 * is what makes a canvas read like a real Figma file — every screen directly
 * comparable.
 */
export const FRAMES = {
  desktop: { w: 1440, h: 1024 },
  mobile: { w: 390, h: 844 },
};

export const DEFAULT_FRAME = FRAMES.desktop;

/**
 * Is this pixel value on the 4-point grid? Negative values (e.g. a negative
 * margin) are judged by magnitude. Non-integers (e.g. `13.5px`) are never on
 * grid.
 * @param {number} px
 * @returns {boolean}
 */
export function isOnSpacingScale(px) {
  const n = Math.abs(Number(px));
  if (!Number.isInteger(n)) return false;
  return n === 0 || n === 2 || n % SPACING_STEP === 0;
}

/**
 * Snap an arbitrary px value to the nearest grid step — the auto-fix the
 * generator applies to a flagged value. Sign is preserved.
 * @param {number} px
 * @returns {number}
 */
export function nearestSpacing(px) {
  const v = Number(px) || 0;
  const n = Math.abs(v);
  const sign = v < 0 ? -1 : 1;
  // Candidates ascending, deduped; `<=` lets the larger step win a tie (snap a
  // 1px nudge up to the 2px hairline, not down to 0).
  const candidates = [...new Set([0, 2, Math.round(n / SPACING_STEP) * SPACING_STEP])].sort((a, b) => a - b);
  const best = candidates.reduce(
    (b, c) => (Math.abs(c - n) <= Math.abs(b - n) ? c : b),
    candidates[0],
  );
  return sign * best;
}

/**
 * Does a {w,h} match a canonical frame? The generator sets every desktop
 * artboard to `FRAMES.desktop`; the linter / tests assert it.
 * @param {{ w?: number, h?: number }} frame
 * @returns {boolean}
 */
export function isCanonicalFrame({ w, h } = {}) {
  return Object.values(FRAMES).some((f) => f.w === Number(w) && f.h === Number(h));
}

/**
 * Resolve the effective scale for a run. The canonical scale is fixed today;
 * `appCtx` is accepted so a future version can merge an app's real token scale
 * (e.g. a Tailwind spacing config read in preflight A.3.5) without changing call
 * sites.
 * @param {{ frame?: {w:number,h:number} }} [appCtx]
 */
export function resolveTokens(appCtx = {}) {
  return {
    spacingStep: SPACING_STEP,
    commonSpacing: COMMON_SPACING,
    frame: appCtx.frame || DEFAULT_FRAME,
  };
}
