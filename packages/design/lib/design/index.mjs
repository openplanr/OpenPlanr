/**
 * Design helpers for `/planr-pipeline:design` — the dependency-free, tested
 * core shared by all three format renderers (SPEC-015 finding H2: the genuine
 * "shared core" is the screen resolver, the escaping pass, and the manifest
 * writer — everything else is per-format).
 *
 * Barrel re-export; import named helpers from here or from the leaf modules.
 */

export { prepareCompanyDesignPublication } from './company-publication.mjs';
export {
  AA_LARGE,
  AA_NORMAL,
  contrastRatio,
  isReadable,
  parseColor,
  relativeLuminance,
} from './contrast.mjs';
export { projectDesignDeliveryStatus } from './delivery-status.mjs';
export { prepareDesignPlanHandoff } from './design-plan-handoff.mjs';
export {
  DS_PACKAGE_FILES,
  designSystemStatus,
  resolveDesignSystem,
  summarizeDesignSystem,
} from './designSystem.mjs';
export { embedJson, escapeHtml, hasUnsafeHtml } from './escape.mjs';
export {
  canContinueDesignHandoff,
  compileDesignHandoffReadiness,
  designHandoffReadinessAbsence,
  designHandoffReadinessDigest,
} from './handoff-readiness.mjs';
export {
  canApproveDesignHandoffResolution,
  compileDesignHandoffResolution,
  designHandoffResolutionDigest,
} from './handoff-resolution.mjs';
export {
  assertImplementationHandoffProjection,
  composeImplementationHandoff,
  createRepositorySourceResolver,
  deriveImplementationRequirementId,
  exportImplementationHandoffPackage,
  implementationHandoffPaths,
  importImplementationHandoffPackage,
  readImplementationHandoffDraft,
  recoverImplementationHandoffDraft,
  verifyImplementationHandoffSources,
  writeImplementationHandoffDraft,
} from './implementation-handoff.mjs';
export {
  approveImplementationHandoff,
  compareImplementationHandoffVersions,
  IMPLEMENTATION_HANDOFF_APPROVE_CAPABILITY,
  IMPLEMENTATION_HANDOFF_REVOKE_CAPABILITY,
  implementationHandoffApprovalPaths,
  listImplementationHandoffHistory,
  previewImplementationHandoffApproval,
  readImplementationHandoffLifecycle,
  readImplementationHandoffVersion,
  recoverImplementationHandoffApproval,
  regenerateImplementationHandoffDraft,
  revokeImplementationHandoff,
  supersedeImplementationHandoff,
} from './implementation-handoff-approval.mjs';
export { decideThinSpec, isHeadless } from './interactivity.mjs';
export { lintCanvasData, lintDesign } from './lint.mjs';
export {
  buildManifest,
  CONTENT_PROVENANCE,
  DESIGN_SOURCES,
  FRAMEWORKS,
  NAV_MODES,
  SCHEMA_VERSION,
  validateManifest,
} from './manifest.mjs';
export {
  DESIGN_FORMATS,
  EXPLORATORY_KEYWORDS,
  isExploratory,
  recommendFormat,
} from './recommendFormat.mjs';
export { countScreens, resolveScreens } from './screens.mjs';
export {
  BREAKPOINTS,
  COMMON_SPACING,
  DEFAULT_FRAME,
  FRAMES,
  isCanonicalFrame,
  isOnSpacingScale,
  nearestSpacing,
  RESPONSIVE_FRAMES,
  resolveTokens,
  SPACING_STEP,
} from './tokens.mjs';
export { ANCHOR_MAX_SCREENS, chooseWalkthroughNav } from './walkthroughNav.mjs';
