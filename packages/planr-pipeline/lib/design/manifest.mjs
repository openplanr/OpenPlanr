/**
 * Build + structurally validate the design manifest (`finalized.json`) written
 * alongside every generated design artifact.
 *
 * The discriminator field is `design_format`, NOT `format` — `format` is a
 * reserved JSON-Schema validation keyword and collides with tooling
 * (SPEC-015 finding T2). The canonical schema is
 * `schemas/v1.0.0/design-manifest.schema.json`; `validateManifest()` mirrors
 * it so conformance/tests can check a manifest with zero dependencies.
 *
 * Field style is snake_case to match the sibling operational metadata files
 * (`run-manifest` records, gstack `finalized.json`). Pure, stdlib-only.
 */

import { DESIGN_FORMATS } from './recommendFormat.mjs';

/** How the design was sourced — mirrors the `--from` flag values. */
export const DESIGN_SOURCES = Object.freeze(['spec', 'png', 'describe']);

/** Whether screen content came from the spec or was inferred to fill a thin spec. */
export const CONTENT_PROVENANCE = Object.freeze(['spec', 'inferred']);

/** Render substrate. prototype/walkthrough = vanilla + Pretext; canvas = React. */
export const FRAMEWORKS = Object.freeze(['vanilla', 'react']);

/** Walkthrough nav modes (null for non-walkthrough formats). */
export const NAV_MODES = Object.freeze(['anchor', 'lazy']);

export const SCHEMA_VERSION = '1.0.0';

/** Default substrate for a format. */
function defaultFramework(designFormat) {
  return designFormat === 'canvas' ? 'react' : 'vanilla';
}

/**
 * Assemble a design manifest object. Required inputs throw early; optional
 * fields are omitted when empty so the manifest stays terse.
 *
 * @param {object} input
 * @param {'prototype'|'walkthrough'|'canvas'} input.designFormat
 * @param {'spec'|'png'|'describe'} input.source
 * @param {string} input.generatedAt              ISO-8601 timestamp
 * @param {string[]} [input.screens]
 * @param {'spec'|'inferred'} [input.contentProvenance]
 * @param {'vanilla'|'react'} [input.framework]
 * @param {'anchor'|'lazy'|null} [input.navMode]
 * @param {string} [input.screenName]
 * @param {number} [input.iterations]
 * @param {string} [input.branch]
 * @param {string} [input.specId]
 * @param {string} [input.htmlFile]
 * @param {string} [input.pretextTier]
 * @returns {object}
 */
export function buildManifest({
  designFormat,
  source,
  generatedAt,
  screens = [],
  contentProvenance = 'spec',
  framework,
  navMode = null,
  screenName = '',
  iterations = 0,
  branch = '',
  specId = '',
  htmlFile = '',
  pretextTier = '',
} = {}) {
  if (!designFormat) throw new Error('buildManifest: designFormat is required');
  if (!source) throw new Error('buildManifest: source is required');
  if (!generatedAt) throw new Error('buildManifest: generatedAt is required');

  const manifest = {
    schema_version: SCHEMA_VERSION,
    design_format: designFormat,
    source,
    content_provenance: contentProvenance,
    framework: framework ?? defaultFramework(designFormat),
    screens: [...screens],
    screen_count: screens.length,
    iterations,
    generated_at: generatedAt,
  };
  if (navMode) manifest.nav_mode = navMode;
  if (screenName) manifest.screen_name = screenName;
  if (branch) manifest.branch = branch;
  if (specId) manifest.spec_id = specId;
  if (htmlFile) manifest.html_file = htmlFile;
  if (pretextTier) manifest.pretext_tier = pretextTier;
  return manifest;
}

/**
 * Dependency-free structural validation mirroring the JSON schema.
 *
 * @param {unknown} manifest
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateManifest(manifest) {
  const errors = [];
  const m = manifest;
  if (typeof m !== 'object' || m === null) {
    return { ok: false, errors: ['manifest must be an object'] };
  }
  if (m.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version must be "${SCHEMA_VERSION}"`);
  }
  if (!DESIGN_FORMATS.includes(m.design_format)) {
    errors.push(`design_format must be one of ${DESIGN_FORMATS.join(', ')}`);
  }
  if (!DESIGN_SOURCES.includes(m.source)) {
    errors.push(`source must be one of ${DESIGN_SOURCES.join(', ')}`);
  }
  if (!CONTENT_PROVENANCE.includes(m.content_provenance)) {
    errors.push(`content_provenance must be one of ${CONTENT_PROVENANCE.join(', ')}`);
  }
  if (!FRAMEWORKS.includes(m.framework)) {
    errors.push(`framework must be one of ${FRAMEWORKS.join(', ')}`);
  }
  if (!Array.isArray(m.screens) || m.screens.some((s) => typeof s !== 'string')) {
    errors.push('screens must be an array of strings');
  }
  if (typeof m.generated_at !== 'string' || m.generated_at.trim() === '') {
    errors.push('generated_at must be a non-empty string');
  }
  if (m.nav_mode !== undefined && !NAV_MODES.includes(m.nav_mode)) {
    errors.push(`nav_mode, when present, must be one of ${NAV_MODES.join(', ')}`);
  }
  if (m.framework === 'react' && m.design_format !== 'canvas') {
    errors.push('framework "react" is only valid for design_format "canvas"');
  }
  return { ok: errors.length === 0, errors };
}
