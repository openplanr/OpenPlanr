import { DIAGRAM_ERROR_CODES, diagramFail } from '../errors.mjs';

export const DIAGRAM_RENDERER = Object.freeze({
  id: 'openplanr-semantic-svg-resvg',
  version: '1.4.0',
});

export const DIAGRAM_THEME = Object.freeze({
  id: 'openplanr-default',
  version: '1.0.0',
  background: '#ffffff',
  surface: '#f8fafc',
  foreground: '#0f172a',
  border: '#475569',
  accent: '#2563eb',
  muted: '#64748b',
  fontFamily: 'Inter',
  fontSize: 16,
});

/**
 * Type scale and spacing for themes that declare no `metrics`. Kept off
 * DIAGRAM_THEME so the default asset receipt and its digest stay unchanged.
 * Glyph widths are the per-character advances the layout reserves.
 */
export const DIAGRAM_DEFAULT_METRICS = Object.freeze({
  hierarchy: false,
  siblingGap: 112,
  node: Object.freeze({
    minWidth: 220,
    maxWidth: 420,
    minHeight: 88,
    paddingX: 26,
    paddingY: 22,
    titleWrap: 32,
    subtitleWrap: 32,
    radius: 14,
  }),
  title: Object.freeze({ size: 16, weight: 600, lineHeight: 22, glyph: 9 }),
  subtitle: Object.freeze({ size: 16, weight: 600, lineHeight: 22, glyph: 9 }),
  label: Object.freeze({ size: 14, lineHeight: 18, glyph: 14, baseline: 18 }),
  message: Object.freeze({
    size: 14,
    lineHeight: 18,
    glyph: 7.5,
    wrapGlyph: 8,
    baseline: 18,
    minWidth: 220,
    balance: false,
  }),
  container: Object.freeze({
    size: 13,
    weight: 700,
    letterSpacing: 0.8,
    fontFamily: null,
    radius: 18,
    glyph: 8.6,
  }),
  phase: Object.freeze({ size: 13 }),
  sequence: Object.freeze({
    participantWidth: 220,
    participantGap: 96,
    phaseRail: 176,
    participantWrap: 24,
    participantMinHeight: 88,
    participantPaddingY: 36,
    headerGap: 72,
    phaseLead: 0,
    phaseGap: 52,
    messageGap: 34,
  }),
});

/** Palette slots every theme fills; the adaptive stylesheet remaps each one. */
export const DIAGRAM_PALETTE_KEYS = Object.freeze([
  'background',
  'surface',
  'foreground',
  'border',
  'accent',
  'muted',
]);

/**
 * Shape of the only stylesheet the renderer emits: hex fill and stroke remaps
 * inside a dark-scheme query. Anything else inside an SVG `<style>` is foreign.
 */
export const DIAGRAM_ADAPTIVE_STYLE_PATTERN =
  /^@media \(prefers-color-scheme: dark\)\{(?:\[(?:fill|stroke)="#[0-9A-Fa-f]{6}"\]\{(?:fill|stroke):#[0-9A-Fa-f]{6}\})+\}$/u;

export const OPENPLANR_BRAND_TOKENS = Object.freeze({
  ink: '#08080C',
  teal: '#5EEAD4',
  tealOnLight: '#237A72',
  paper: '#F5F7F7',
});

/**
 * Blend ratios from the background toward the named token. Border and muted
 * double as label text, so their ratios keep WCAG AA on the background.
 */
const BRAND_BLEND = Object.freeze({
  surface: 0.06,
  border: 0.6,
  muted: 0.66,
  wash: 0.03,
  rule: 0.14,
});

const BRAND_BODY_FONT = 'DM Sans, Inter, system-ui, -apple-system, Helvetica, Arial, sans-serif';
const BRAND_HEADLINE_FONT = `Outfit, ${BRAND_BODY_FONT}`;

/**
 * A compact, README-scale density: larger type on a narrower scene. The first
 * line of a node label is its title and the rest its muted subtitle. Glyph
 * widths cover the widest Latin face in the stack's system fallbacks.
 */
const BRAND_METRICS = Object.freeze({
  hierarchy: true,
  siblingGap: 48,
  node: Object.freeze({
    minWidth: 176,
    maxWidth: 420,
    minHeight: 84,
    paddingX: 24,
    paddingY: 20,
    titleWrap: 34,
    subtitleWrap: 44,
    radius: 16,
  }),
  title: Object.freeze({ size: 18, weight: 600, lineHeight: 24, glyph: 9.6 }),
  subtitle: Object.freeze({ size: 15, weight: 400, lineHeight: 20, glyph: 7.8 }),
  label: Object.freeze({ size: 15, lineHeight: 20, glyph: 8, baseline: 22 }),
  message: Object.freeze({
    size: 16,
    lineHeight: 22,
    glyph: 8.4,
    wrapGlyph: 8.4,
    baseline: 23,
    minWidth: 360,
    balance: true,
  }),
  container: Object.freeze({
    size: 15,
    weight: 600,
    letterSpacing: 0.2,
    fontFamily: BRAND_HEADLINE_FONT,
    radius: 20,
    glyph: 8.4,
  }),
  phase: Object.freeze({ size: 16 }),
  sequence: Object.freeze({
    participantWidth: 184,
    participantGap: 40,
    phaseRail: 0,
    participantWrap: 17,
    participantMinHeight: 64,
    participantPaddingY: 32,
    headerGap: 56,
    phaseLead: 28,
    phaseGap: 44,
    messageGap: 16,
  }),
});

const channels = (hex) =>
  [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));

/** Linear sRGB-channel blend of two `#RRGGBB` colors, `ratio` of the way from `from` to `to`. */
export function mixHex(from, to, ratio) {
  const start = channels(from);
  const end = channels(to);
  return `#${start
    .map((value, index) =>
      Math.round(value + (end[index] - value) * ratio)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase(),
    )
    .join('')}`;
}

function brandPalette({ background, foreground, accent, colorScheme, shadow }) {
  return Object.freeze({
    background,
    surface: mixHex(background, accent, BRAND_BLEND.surface),
    foreground,
    border: mixHex(background, foreground, BRAND_BLEND.border),
    accent,
    muted: mixHex(background, foreground, BRAND_BLEND.muted),
    page: Object.freeze({
      colorScheme,
      wash: mixHex(background, foreground, BRAND_BLEND.wash),
      canvas: background,
      rule: mixHex(background, foreground, BRAND_BLEND.rule),
      shadow,
      headlineFontFamily: BRAND_HEADLINE_FONT,
    }),
  });
}

const BRAND_LIGHT = brandPalette({
  background: OPENPLANR_BRAND_TOKENS.paper,
  foreground: OPENPLANR_BRAND_TOKENS.ink,
  accent: OPENPLANR_BRAND_TOKENS.tealOnLight,
  colorScheme: 'light',
  shadow: 'rgba(8,8,12,.08)',
});

const BRAND_DARK = brandPalette({
  background: OPENPLANR_BRAND_TOKENS.ink,
  foreground: OPENPLANR_BRAND_TOKENS.paper,
  accent: OPENPLANR_BRAND_TOKENS.teal,
  colorScheme: 'dark',
  shadow: 'rgba(0,0,0,.45)',
});

function brandTheme(mode, palette, dark = null) {
  return Object.freeze({
    id: 'openplanr',
    version: '1.0.0',
    mode,
    ...palette,
    fontFamily: BRAND_BODY_FONT,
    fontSize: 16,
    metrics: BRAND_METRICS,
    ...(dark ? { dark } : {}),
  });
}

/**
 * The brand theme by mode. `auto` carries the light palette in presentation
 * attributes and the dark palette in an inline media query, so one SVG follows
 * the viewer's color scheme while resvg keeps the light values.
 */
export const OPENPLANR_THEME = Object.freeze({
  light: brandTheme('light', BRAND_LIGHT),
  dark: brandTheme('dark', BRAND_DARK),
  auto: brandTheme('auto', BRAND_LIGHT, BRAND_DARK),
});

export const DIAGRAM_THEMES = Object.freeze([
  Object.freeze({
    id: DIAGRAM_THEME.id,
    version: DIAGRAM_THEME.version,
    modes: Object.freeze(['light']),
    description: 'Neutral light palette. Every mode renders the same bytes.',
  }),
  Object.freeze({
    id: OPENPLANR_THEME.light.id,
    version: OPENPLANR_THEME.light.version,
    modes: Object.freeze(['light', 'dark', 'auto']),
    description:
      'OpenPlanr brand palette. Light is Ink on Paper, dark is Paper on Ink, auto follows the viewer.',
  }),
]);

export function resolveDiagramTheme(theme) {
  const themeId = theme?.themeId;
  if (themeId === DIAGRAM_THEME.id) return DIAGRAM_THEME;
  if (themeId === OPENPLANR_THEME.light.id) {
    const resolved = Object.hasOwn(OPENPLANR_THEME, theme.mode)
      ? OPENPLANR_THEME[theme.mode]
      : null;
    if (resolved) return resolved;
    diagramFail(DIAGRAM_ERROR_CODES.SCHEMA_INVALID, `Unknown diagram theme mode: ${theme.mode}`, {
      themeId,
      mode: theme.mode,
      modes: Object.keys(OPENPLANR_THEME),
      repair: 'Set theme.mode to light, dark, or auto.',
    });
  }
  diagramFail(DIAGRAM_ERROR_CODES.SCHEMA_INVALID, `Unknown diagram theme: ${themeId}`, {
    themeId,
    themes: DIAGRAM_THEMES.map(({ id }) => id),
    repair: `Set theme.themeId to one of ${DIAGRAM_THEMES.map(({ id }) => id).join(', ')}.`,
  });
}

export function diagramMetrics(theme) {
  return theme.metrics ?? DIAGRAM_DEFAULT_METRICS;
}

/**
 * Relation kinds drawn dashed. Flow, message and transition are the primary
 * paths of a diagram and stay solid; dependency and association are the
 * secondary, "uses" relations that every mainstream notation draws dashed.
 */
export const DASHED_RELATION_KINDS = Object.freeze(new Set(['dependency', 'association']));

export function isDashedRelation(kind) {
  return DASHED_RELATION_KINDS.has(kind);
}

export const RASTER_SCALE = 2;
export const MAX_VISIBLE_LABEL_CHARACTERS = 2_048;
/** Largest scene width or height, in SVG user units, that viewers and the rasterizer accept. */
export const MAX_DIAGRAM_SCENE_EXTENT = 16_384;
