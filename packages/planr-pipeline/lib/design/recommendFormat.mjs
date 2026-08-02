/**
 * Format-recommendation rule for `/planr-pipeline:design`.
 *
 * Prototype (one screen), walkthrough (multi-screen gallery) and canvas
 * (Figma-like board) are all real user surfaces, but a non-designer can't pick
 * between them cold. This rule pre-selects the right default from the spec's
 * screen count + intent, so the clarification prompt shows ONE recommended
 * option with a plain-language "why" (the user can still override via
 * `--format`). (SPEC-015 findings Design-F2 / DX-F2.)
 *
 *   0–2 screens               → prototype   (a gallery for one screen is absurd)
 *   3+ screens, exploratory   → canvas      ("options" / "concept" / "explore")
 *   3+ screens, linear flow   → walkthrough (the default for a real flow)
 *
 * Pure, stdlib-only.
 */

/** Canonical format identifiers, in presentation order. */
export const DESIGN_FORMATS = Object.freeze(['prototype', 'walkthrough', 'canvas']);

/** Words in a brief that signal exploratory (non-linear) intent. */
export const EXPLORATORY_KEYWORDS = Object.freeze([
  'option', 'options', 'concept', 'concepts', 'explore', 'exploration',
  'variant', 'variants', 'moodboard', 'brainstorm', 'compare', 'comparison',
]);

/**
 * Whether a brief reads as exploratory rather than a defined linear flow.
 * @param {string} intentText
 * @returns {boolean}
 */
export function isExploratory(intentText) {
  const text = String(intentText ?? '').toLowerCase();
  return EXPLORATORY_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`).test(text));
}

/**
 * Recommend a default design format from the resolved screen count + intent.
 *
 * @param {{ screenCount?: number, intentText?: string }} [input]
 * @returns {{ format: 'prototype'|'walkthrough'|'canvas', reason: string }}
 */
export function recommendFormat({ screenCount = 0, intentText = '' } = {}) {
  const n = Number.isFinite(screenCount) ? Math.max(0, Math.trunc(screenCount)) : 0;

  if (n <= 2) {
    return {
      format: 'prototype',
      reason: n === 0
        ? 'no screens resolved yet → a single prototype page to react to'
        : `${n} screen${n === 1 ? '' : 's'} → a single prototype page fits better than a gallery`,
    };
  }
  if (isExploratory(intentText)) {
    return { format: 'canvas', reason: `${n} screens + exploratory intent → an Explore board (canvas)` };
  }
  return { format: 'walkthrough', reason: `${n} screens in a flow → a click-through Walkthrough` };
}
