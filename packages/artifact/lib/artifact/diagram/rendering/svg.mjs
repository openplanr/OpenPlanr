import { assertDiagramSvg } from '../accessibility.mjs';
import { layoutDiagram } from './layout.mjs';
import {
  DIAGRAM_PALETTE_KEYS,
  diagramMetrics,
  isDashedRelation,
  resolveDiagramTheme,
} from './theme.mjs';

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const coordinate = (value) => Math.round(value * 100) / 100;

function renderEdge(edge, theme, style) {
  const labelX = edge.labelBounds
    ? edge.labelBounds.x + edge.labelBounds.width / 2
    : (edge.x1 + edge.x2) / 2;
  const labelY = (edge.y1 + edge.y2) / 2 - 8;
  const bounds = edge.labelBounds;
  const lines = edge.labelLines ?? (edge.label ? [edge.label] : []);
  const firstBaseline = bounds ? bounds.y + style.baseline : labelY;
  const label =
    lines.length > 0
      ? `${bounds ? `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="8" fill="${theme.background}"/>` : ''}<text x="${labelX}" y="${firstBaseline}" text-anchor="middle" font-family="${theme.fontFamily}" font-size="${style.size}" fill="${theme.muted}">${lines.map((line, index) => `<tspan x="${labelX}" y="${firstBaseline + index * style.lineHeight}">${escapeXml(line)}</tspan>`).join('')}</text>`
      : '';
  const stroke = edge.emphasis === 'primary' ? theme.accent : theme.border;
  const dash = isDashedRelation(edge.kind) ? ' stroke-dasharray="7 5"' : '';
  const path = (
    edge.routePoints ?? [
      [edge.x1, edge.y1],
      [edge.x2, edge.y2],
    ]
  )
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ');
  return `<g data-relation-id="${escapeXml(edge.id)}"><path d="${path}" fill="none" stroke="${stroke}" stroke-width="${edge.emphasis === 'primary' ? 3 : 2}"${dash} marker-end="url(#diagram-arrow)"/>${label}</g>`;
}

function renderBoxText(box, theme) {
  const firstBaseline = box.y + (box.height - (box.lines.length - 1) * 22) / 2 + 5;
  const lines = box.lines
    .map(
      (line, index) =>
        `<tspan x="${box.x + box.width / 2}" y="${firstBaseline + index * 22}">${escapeXml(line)}</tspan>`,
    )
    .join('');
  return `<text aria-label="${escapeXml(box.label)}" text-anchor="middle" font-family="${theme.fontFamily}" font-size="${theme.fontSize}" font-weight="600" fill="${theme.foreground}">${lines}</text>`;
}

/** Title lines in the foreground at the title weight, detail lines in the muted colour below. */
function renderTitledBoxText(box, theme, metrics) {
  const styles = box.lines.map((_, index) =>
    index < box.titleLines
      ? { ...metrics.title, fill: theme.foreground }
      : { ...metrics.subtitle, fill: theme.muted },
  );
  let top =
    box.y + (box.height - styles.reduce((total, { lineHeight }) => total + lineHeight, 0)) / 2;
  const lines = box.lines
    .map((line, index) => {
      const { size, weight, lineHeight, fill } = styles[index];
      const baseline = top + lineHeight / 2 + size * 0.35;
      top += lineHeight;
      return `<tspan x="${coordinate(box.x + box.width / 2)}" y="${coordinate(baseline)}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</tspan>`;
    })
    .join('');
  return `<text aria-label="${escapeXml(box.label)}" text-anchor="middle" font-family="${theme.fontFamily}">${lines}</text>`;
}

function renderBox(box, theme, metrics) {
  const stroke = box.emphasis ? theme.accent : theme.border;
  const text =
    box.titleLines === undefined
      ? renderBoxText(box, theme)
      : renderTitledBoxText(box, theme, metrics);
  return `<g data-item-id="${escapeXml(box.id)}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${metrics.node.radius}" fill="${theme.surface}" stroke="${stroke}" stroke-width="${box.emphasis === 'primary' ? 3 : 2}"/>${text}</g>`;
}

const containerTitle = (theme, { size, weight, letterSpacing, fontFamily }) =>
  `font-family="${fontFamily ?? theme.fontFamily}" font-size="${size}" font-weight="${weight}" letter-spacing="${letterSpacing}"`;

function renderGroup(group, theme, metrics) {
  const stroke = group.emphasis ? theme.accent : theme.border;
  return `<g data-group-id="${escapeXml(group.id)}"><rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="${metrics.container.radius}" fill="none" stroke="${stroke}" stroke-width="${group.emphasis === 'primary' ? 3 : 1.5}" stroke-dasharray="8 6"/><text x="${group.x + group.titleOffset}" y="${group.y + 27}" ${containerTitle(theme, metrics.container)} fill="${stroke}">${escapeXml(group.label)}</text></g>`;
}

function renderLane(lane, theme, metrics) {
  const stroke = lane.emphasis ? theme.accent : theme.border;
  return `<g data-lane-id="${escapeXml(lane.id)}"><rect x="${lane.x}" y="${lane.y}" width="${lane.width}" height="${lane.height}" rx="16" fill="${theme.surface}" fill-opacity="0.45" stroke="${stroke}" stroke-width="${lane.emphasis === 'primary' ? 3 : 1.5}"/><text x="${lane.x + 20}" y="${lane.y + 30}" ${containerTitle(theme, metrics.container)} fill="${stroke}">${escapeXml(lane.label)}</text></g>`;
}

function renderPhase(phase, theme, metrics) {
  return `<g data-phase-id="${escapeXml(phase.id)}"><text x="${phase.x1}" y="${phase.y - 10}" font-family="${theme.fontFamily}" font-size="${metrics.phase.size}" font-weight="700" letter-spacing="1.2" fill="${theme.accent}">${escapeXml(phase.label.toUpperCase())}</text><line x1="${phase.x1}" y1="${phase.y}" x2="${phase.x2}" y2="${phase.y}" stroke="${theme.border}" stroke-width="1" opacity="0.28"/></g>`;
}

function renderLifeline(lifeline, theme) {
  return `<line data-lifeline-id="${escapeXml(lifeline.id)}" x1="${lifeline.x}" y1="${lifeline.y1}" x2="${lifeline.x}" y2="${lifeline.y2}" stroke="${theme.border}" stroke-width="1.5" stroke-dasharray="5 7" opacity="0.48"/>`;
}

function renderNote(note, theme) {
  const firstBaseline = note.y + 22;
  const stroke = note.emphasis === 'muted' ? theme.border : theme.accent;
  const target =
    typeof note.targetId === 'string' ? ` data-target-id="${escapeXml(note.targetId)}"` : '';
  const connector =
    Number.isFinite(note.anchorX) && Number.isFinite(note.anchorY)
      ? `<line x1="${note.anchorX}" y1="${note.anchorY}" x2="${note.x}" y2="${note.y + note.height / 2}" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4 5"/>`
      : '';
  return `<g data-annotation-id="${escapeXml(note.id)}"${target}><rect x="${note.x}" y="${note.y}" width="${note.width}" height="${note.height}" rx="12" fill="${theme.surface}" stroke="${stroke}" stroke-width="${note.emphasis === 'primary' ? 3 : 1.5}"/>${connector}<text x="${note.x + 16}" y="${firstBaseline}" font-family="${theme.fontFamily}" font-size="13" fill="${theme.foreground}">${note.lines.map((line, index) => `<tspan x="${note.x + 16}" y="${firstBaseline + index * 18}">${escapeXml(line)}</tspan>`).join('')}</text></g>`;
}

/**
 * Dark-scheme remap for an adaptive theme. Presentation attributes carry the
 * light palette; any CSS rule outranks them, so matching each light value
 * swaps the whole drawing without structural hooks. resvg skips at-rules, so
 * the PNG keeps the light values.
 */
function renderAdaptiveStyle(theme) {
  if (!theme.dark) return '';
  const rules = DIAGRAM_PALETTE_KEYS.flatMap((key) => [
    `[fill="${theme[key]}"]{fill:${theme.dark[key]}}`,
    `[stroke="${theme[key]}"]{stroke:${theme.dark[key]}}`,
  ]).join('');
  return `<style>@media (prefers-color-scheme: dark){${rules}}</style>`;
}

export function renderDiagramSvg(document, { theme = resolveDiagramTheme(document.theme) } = {}) {
  const scene = layoutDiagram(document, { theme });
  const metrics = diagramMetrics(theme);
  const labelStyle = scene.kind === 'sequence' ? metrics.message : metrics.label;
  const titleId = `${document.diagramId}-title`;
  const descriptionId = `${document.diagramId}-description`;
  const bytes = [
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${titleId} ${descriptionId}" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}">`,
    `<title id="${titleId}">${escapeXml(document.accessibility.title)}</title>`,
    `<desc id="${descriptionId}">${escapeXml(document.accessibility.description)}</desc>`,
    `<defs>${renderAdaptiveStyle(theme)}<marker id="diagram-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${theme.border}"/></marker></defs>`,
    `<rect width="${scene.width}" height="${scene.height}" fill="${theme.background}"/>`,
    ...scene.lanes.map((lane) => renderLane(lane, theme, metrics)),
    ...scene.groups.map((group) => renderGroup(group, theme, metrics)),
    ...scene.phases.map((phase) => renderPhase(phase, theme, metrics)),
    ...scene.lifelines.map((lifeline) => renderLifeline(lifeline, theme)),
    ...scene.edges.map((edge) => renderEdge(edge, theme, labelStyle)),
    ...scene.notes.map((note) => renderNote(note, theme)),
    ...scene.boxes.map((box) => renderBox(box, theme, metrics)),
    '</svg>',
  ].join('');
  assertDiagramSvg(bytes, { foreground: theme.foreground, background: theme.background });
  return Object.freeze({ svg: `${bytes}\n`, scene });
}
