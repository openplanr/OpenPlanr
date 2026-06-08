/**
 * Design helpers for `/planr-pipeline:design` — the dependency-free, tested
 * core shared by all three format renderers (SPEC-015 finding H2: the genuine
 * "shared core" is the screen resolver, the escaping pass, and the manifest
 * writer — everything else is per-format).
 *
 * Barrel re-export; import named helpers from here or from the leaf modules.
 */

export { escapeHtml, embedJson, hasUnsafeHtml } from './escape.mjs';
export {
  recommendFormat, isExploratory, DESIGN_FORMATS, EXPLORATORY_KEYWORDS,
} from './recommendFormat.mjs';
export { resolveScreens, countScreens } from './screens.mjs';
export { chooseWalkthroughNav, ANCHOR_MAX_SCREENS } from './walkthroughNav.mjs';
export { decideThinSpec, isHeadless } from './interactivity.mjs';
export {
  buildManifest, validateManifest,
  DESIGN_SOURCES, CONTENT_PROVENANCE, FRAMEWORKS, NAV_MODES, SCHEMA_VERSION,
} from './manifest.mjs';
export {
  SPACING_STEP, COMMON_SPACING, FRAMES, DEFAULT_FRAME, BREAKPOINTS, RESPONSIVE_FRAMES,
  isOnSpacingScale, nearestSpacing, isCanonicalFrame, resolveTokens,
} from './tokens.mjs';
export { lintDesign, lintCanvasData } from './lint.mjs';
