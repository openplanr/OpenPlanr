import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { validateJson } from '../../../conformance/json-schema-validate.mjs';
import { contrastRatio } from '../../design/contrast.mjs';

export const ARTIFACT_THEME_REGISTRY_PATH = fileURLToPath(
  new URL('../../../registry/artifact-theme.json', import.meta.url),
);
export const ARTIFACT_THEME_SCHEMA_PATH = fileURLToPath(
  new URL('../../../schemas/v1.1.0/artifact-theme.schema.json', import.meta.url),
);

export const ARTIFACT_THEME_ERROR_CODES = Object.freeze({
  PARSE: 'E_ARTIFACT_THEME_PARSE',
  SCHEMA: 'E_ARTIFACT_THEME_SCHEMA',
  TOKEN_MISSING: 'E_ARTIFACT_THEME_TOKEN_MISSING',
  TOKEN_UNKNOWN: 'E_ARTIFACT_THEME_TOKEN_UNKNOWN',
  FORMAT: 'E_ARTIFACT_THEME_FORMAT',
  LAYOUT: 'E_ARTIFACT_THEME_LAYOUT',
  MOTION: 'E_ARTIFACT_THEME_MOTION',
  CONTRAST: 'E_ARTIFACT_THEME_CONTRAST',
});

export class ArtifactThemeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ArtifactThemeError';
    this.code = code;
    this.details = details;
  }
}

export const TYPOGRAPHY_KEYS = Object.freeze(['display', 'body', 'mono']);
export const LAYOUT_KEYS = Object.freeze([
  'toolbarHeight',
  'reviewRailWidth',
  'radiusSmall',
  'radiusMedium',
  'radiusLarge',
  'motionFastMs',
  'motionBaseMs',
]);
export const THEME_NAMES = Object.freeze(['dark', 'light']);
export const COLOR_KEYS = Object.freeze([
  'background',
  'chrome',
  'panel',
  'raised',
  'stage',
  'rule',
  'text',
  'textMuted',
  'primary',
  'primaryStrong',
  'warning',
  'danger',
  'onDanger',
  'question',
  'onQuestion',
  'resolved',
  'onResolved',
  'onImprove',
]);

const AA_PAIRS = Object.freeze([
  ['text', 'background'],
  ['text', 'chrome'],
  ['text', 'panel'],
  ['text', 'raised'],
  ['text', 'stage'],
  ['textMuted', 'background'],
  ['textMuted', 'panel'],
  ['primary', 'background'],
  ['primaryStrong', 'background'],
  ['warning', 'background'],
  ['danger', 'background'],
  ['onDanger', 'danger'],
  ['onQuestion', 'question'],
  ['onResolved', 'resolved'],
  ['onImprove', 'primaryStrong'],
]);

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ArtifactThemeError(
      ARTIFACT_THEME_ERROR_CODES.PARSE,
      `Unable to parse ${label}: ${error.message}`,
      { path },
    );
  }
}

function schemaCode(issue) {
  if (issue.rule === 'required') return ARTIFACT_THEME_ERROR_CODES.TOKEN_MISSING;
  if (issue.rule === 'additionalProperties') return ARTIFACT_THEME_ERROR_CODES.TOKEN_UNKNOWN;
  if (issue.rule === 'pattern') return ARTIFACT_THEME_ERROR_CODES.FORMAT;
  if (issue.path.includes('.layout.motion')) return ARTIFACT_THEME_ERROR_CODES.MOTION;
  if (issue.path.includes('.layout.')) return ARTIFACT_THEME_ERROR_CODES.LAYOUT;
  return ARTIFACT_THEME_ERROR_CODES.SCHEMA;
}

function assertSchema(theme, schema) {
  const issues = validateJson(theme, schema);
  if (issues.length === 0) return;
  const first = issues[0];
  throw new ArtifactThemeError(
    schemaCode(first),
    `Invalid artifact theme at ${first.path}: ${first.detail}`,
    { issues },
  );
}

function assertLayout(layout) {
  if (layout.toolbarHeight !== 48 || layout.reviewRailWidth !== 344) {
    throw new ArtifactThemeError(
      ARTIFACT_THEME_ERROR_CODES.LAYOUT,
      'Artifact shell layout must keep a 48px toolbar and 344px review rail.',
      { toolbarHeight: layout.toolbarHeight, reviewRailWidth: layout.reviewRailWidth },
    );
  }

  const radii = ['radiusSmall', 'radiusMedium', 'radiusLarge'].map((key) => [key, layout[key]]);
  const invalidRadius = radii.find(([, value]) => !Number.isInteger(value) || value < 0 || value > 32);
  if (invalidRadius) {
    throw new ArtifactThemeError(
      ARTIFACT_THEME_ERROR_CODES.LAYOUT,
      `${invalidRadius[0]} must be an integer from 0 through 32.`,
      { token: invalidRadius[0], value: invalidRadius[1] },
    );
  }
  if (!(layout.radiusSmall <= layout.radiusMedium && layout.radiusMedium <= layout.radiusLarge)) {
    throw new ArtifactThemeError(
      ARTIFACT_THEME_ERROR_CODES.LAYOUT,
      'Artifact shell radii must be ordered small <= medium <= large.',
      { radii: Object.fromEntries(radii) },
    );
  }
}

function assertMotion(layout) {
  for (const token of ['motionFastMs', 'motionBaseMs']) {
    const value = layout[token];
    if (!Number.isInteger(value) || value < 120 || value > 200) {
      throw new ArtifactThemeError(
        ARTIFACT_THEME_ERROR_CODES.MOTION,
        `${token} must be an integer from 120 through 200 milliseconds.`,
        { token, value },
      );
    }
  }
  if (layout.motionFastMs > layout.motionBaseMs) {
    throw new ArtifactThemeError(
      ARTIFACT_THEME_ERROR_CODES.MOTION,
      'motionFastMs must not exceed motionBaseMs.',
      { motionFastMs: layout.motionFastMs, motionBaseMs: layout.motionBaseMs },
    );
  }
}

function assertContrast(themes) {
  for (const themeName of THEME_NAMES) {
    const colors = themes[themeName];
    for (const [foreground, background] of AA_PAIRS) {
      const ratio = contrastRatio(colors[foreground], colors[background]);
      if (ratio == null || ratio < 4.5) {
        throw new ArtifactThemeError(
          ARTIFACT_THEME_ERROR_CODES.CONTRAST,
          `${themeName}.${foreground} on ${themeName}.${background} must meet WCAG AA (4.5:1).`,
          { theme: themeName, foreground, background, ratio },
        );
      }
    }
  }
}

/**
 * Validate the canonical artifact-review theme. JSON Schema owns structure and
 * token formats; these runtime checks enforce ordering, bounded motion, and
 * cross-token WCAG requirements that the dependency-free schema validator
 * intentionally does not model.
 */
export function validateArtifactTheme(theme, { schema } = {}) {
  const contract = schema ?? readJson(ARTIFACT_THEME_SCHEMA_PATH, 'artifact theme schema');
  assertSchema(theme, contract);
  assertLayout(theme.layout);
  assertMotion(theme.layout);
  assertContrast(theme.themes);
  return theme;
}

function pick(source, keys) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

/** Return a fresh registry value with canonical key ordering. */
export function normalizeArtifactTheme(theme) {
  validateArtifactTheme(theme);
  return {
    schemaVersion: theme.schemaVersion,
    name: theme.name,
    typography: pick(theme.typography, TYPOGRAPHY_KEYS),
    layout: pick(theme.layout, LAYOUT_KEYS),
    themes: Object.fromEntries(
      THEME_NAMES.map((themeName) => [themeName, pick(theme.themes[themeName], COLOR_KEYS)]),
    ),
  };
}

export function loadArtifactTheme({
  registryPath = ARTIFACT_THEME_REGISTRY_PATH,
  schemaPath = ARTIFACT_THEME_SCHEMA_PATH,
} = {}) {
  const registry = readJson(registryPath, 'artifact theme registry');
  const schema = readJson(schemaPath, 'artifact theme schema');
  validateArtifactTheme(registry, { schema });
  return normalizeArtifactTheme(registry);
}

function kebab(value) {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function colorVariables(colors) {
  return COLOR_KEYS.map((key) => `  --planr-color-${kebab(key)}: ${colors[key]};`).join('\n');
}

/** Render portable, newline-normalized CSS derived only from validated tokens. */
export function renderArtifactThemeCss(theme) {
  const value = normalizeArtifactTheme(theme);
  const { typography, layout, themes } = value;
  const foundations = [
    `  --planr-font-display: "${typography.display}", ui-sans-serif, system-ui, sans-serif;`,
    `  --planr-font-body: "${typography.body}", ui-sans-serif, system-ui, sans-serif;`,
    `  --planr-font-mono: "${typography.mono}", ui-monospace, SFMono-Regular, Consolas, monospace;`,
    `  --planr-toolbar-height: ${layout.toolbarHeight}px;`,
    `  --planr-review-rail-width: ${layout.reviewRailWidth}px;`,
    `  --planr-radius-small: ${layout.radiusSmall}px;`,
    `  --planr-radius-medium: ${layout.radiusMedium}px;`,
    `  --planr-radius-large: ${layout.radiusLarge}px;`,
    `  --planr-motion-fast: ${layout.motionFastMs}ms;`,
    `  --planr-motion-base: ${layout.motionBaseMs}ms;`,
  ].join('\n');

  return [
    '/* Generated by scripts/generate-artifact-shell.mjs. Do not edit. */',
    ':root,',
    '[data-planr-theme="dark"] {',
    foundations,
    colorVariables(themes.dark),
    '}',
    '',
    '[data-planr-theme="light"] {',
    colorVariables(themes.light),
    '}',
    '',
    '@media (prefers-color-scheme: light) {',
    '  :root:not([data-planr-theme]),',
    '  [data-planr-theme="auto"] {',
    colorVariables(themes.light).replaceAll(/^/gm, '  '),
    '  }',
    '}',
    '',
    '@media (prefers-reduced-motion: reduce) {',
    '  :root {',
    '    --planr-motion-fast: 0ms;',
    '    --planr-motion-base: 0ms;',
    '  }',
    '}',
    '',
  ].join('\n');
}

/** Render a portable JSON payload with canonical ordering and one final LF. */
export function renderArtifactThemeJson(theme) {
  return `${JSON.stringify(normalizeArtifactTheme(theme), null, 2)}\n`;
}
