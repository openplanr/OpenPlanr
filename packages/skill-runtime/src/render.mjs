// Compatibility facade. The single markdown rendering implementation now lives in
// the compiler; this module re-exports the leaf primitives and the
// source-map-aware compile entry points so existing `@openplanr/skill-runtime/render`
// consumers keep working without a second renderer.

export { compileComposedV1, compileMarkdownV1 } from './compiler/compile.mjs';

export { composeIncludes, renderSkillForHost } from './compiler/composition.mjs';
export {
  assertPortableAsset,
  assertSafeSourcePath,
  canonicalText,
  parseMarkdownAsset,
  renderCodexSkill,
  renderCursorSkill,
  renderHostTokens,
  renderRoleAsset,
  renderTemplate,
  sha256,
} from './compiler/render-primitives.mjs';
export { SourceMapBuilder, validateSourceMap } from './compiler/source-map.mjs';
