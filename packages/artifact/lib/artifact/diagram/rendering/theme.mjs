export const DIAGRAM_RENDERER = Object.freeze({
  id: 'openplanr-semantic-svg-resvg',
  version: '1.3.0',
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
