import { assertDiagramSvg } from '../accessibility.mjs';
import { layoutDiagram } from './layout.mjs';
import { DIAGRAM_THEME } from './theme.mjs';

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function renderEdge(edge, theme) {
  const labelX = edge.labelBounds ? edge.labelBounds.x + edge.labelBounds.width / 2 : (edge.x1 + edge.x2) / 2;
  const labelY = (edge.y1 + edge.y2) / 2 - 8;
  const bounds = edge.labelBounds;
  const lines = edge.labelLines ?? (edge.label ? [edge.label] : []);
  const firstBaseline = bounds ? bounds.y + 18 : labelY;
  const label = lines.length > 0
    ? `${bounds ? `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="8" fill="${theme.background}"/>` : ''}<text x="${labelX}" y="${firstBaseline}" text-anchor="middle" font-family="${theme.fontFamily}" font-size="14" fill="${theme.muted}">${lines.map((line, index) => `<tspan x="${labelX}" y="${firstBaseline + index * 18}">${escapeXml(line)}</tspan>`).join('')}</text>`
    : '';
  const stroke = edge.emphasis === 'primary' ? theme.accent : theme.border;
  const dash = edge.kind === 'flow' ? ' stroke-dasharray="7 5"' : '';
  const path = (edge.routePoints ?? [[edge.x1, edge.y1], [edge.x2, edge.y2]])
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  return `<g data-relation-id="${escapeXml(edge.id)}"><path d="${path}" fill="none" stroke="${stroke}" stroke-width="${edge.emphasis === 'primary' ? 3 : 2}"${dash} marker-end="url(#diagram-arrow)"/>${label}</g>`;
}

function renderBox(box, theme) {
  const firstBaseline = box.y + (box.height - (box.lines.length - 1) * 22) / 2 + 5;
  const lines = box.lines.map((line, index) => (
    `<tspan x="${box.x + box.width / 2}" y="${firstBaseline + index * 22}">${escapeXml(line)}</tspan>`
  )).join('');
  const stroke = box.emphasis ? theme.accent : theme.border;
  return `<g data-item-id="${escapeXml(box.id)}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="14" fill="${theme.surface}" stroke="${stroke}" stroke-width="${box.emphasis === 'primary' ? 3 : 2}"/><text aria-label="${escapeXml(box.label)}" text-anchor="middle" font-family="${theme.fontFamily}" font-size="${theme.fontSize}" font-weight="600" fill="${theme.foreground}">${lines}</text></g>`;
}

function renderGroup(group, theme) {
  const stroke = group.emphasis ? theme.accent : theme.border;
  return `<g data-group-id="${escapeXml(group.id)}"><rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="18" fill="none" stroke="${stroke}" stroke-width="${group.emphasis === 'primary' ? 3 : 1.5}" stroke-dasharray="8 6"/><text x="${group.x + 18}" y="${group.y + 27}" font-family="${theme.fontFamily}" font-size="13" font-weight="700" letter-spacing="0.8" fill="${stroke}">${escapeXml(group.label)}</text></g>`;
}

function renderPhase(phase, theme) {
  return `<g data-phase-id="${escapeXml(phase.id)}"><text x="${phase.x1}" y="${phase.y - 10}" font-family="${theme.fontFamily}" font-size="13" font-weight="700" letter-spacing="1.2" fill="${theme.accent}">${escapeXml(phase.label.toUpperCase())}</text><line x1="${phase.x1}" y1="${phase.y}" x2="${phase.x2}" y2="${phase.y}" stroke="${theme.border}" stroke-width="1" opacity="0.28"/></g>`;
}

function renderLifeline(lifeline, theme) {
  return `<line data-lifeline-id="${escapeXml(lifeline.id)}" x1="${lifeline.x}" y1="${lifeline.y1}" x2="${lifeline.x}" y2="${lifeline.y2}" stroke="${theme.border}" stroke-width="1.5" stroke-dasharray="5 7" opacity="0.48"/>`;
}

function renderNote(note, theme) {
  const firstBaseline = note.y + 22;
  const stroke = note.emphasis === 'muted' ? theme.border : theme.accent;
  const target = typeof note.targetId === 'string' ? ` data-target-id="${escapeXml(note.targetId)}"` : '';
  const connector = Number.isFinite(note.anchorX) && Number.isFinite(note.anchorY)
    ? `<line x1="${note.anchorX}" y1="${note.anchorY}" x2="${note.x}" y2="${note.y + note.height / 2}" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4 5"/>`
    : '';
  return `<g data-annotation-id="${escapeXml(note.id)}"${target}><rect x="${note.x}" y="${note.y}" width="${note.width}" height="${note.height}" rx="12" fill="${theme.surface}" stroke="${stroke}" stroke-width="${note.emphasis === 'primary' ? 3 : 1.5}"/>${connector}<text x="${note.x + 16}" y="${firstBaseline}" font-family="${theme.fontFamily}" font-size="13" fill="${theme.foreground}">${note.lines.map((line, index) => `<tspan x="${note.x + 16}" y="${firstBaseline + index * 18}">${escapeXml(line)}</tspan>`).join('')}</text></g>`;
}

export function renderDiagramSvg(document, { theme = DIAGRAM_THEME } = {}) {
  const scene = layoutDiagram(document);
  const titleId = `${document.diagramId}-title`;
  const descriptionId = `${document.diagramId}-description`;
  const bytes = [
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${titleId} ${descriptionId}" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}">`,
    `<title id="${titleId}">${escapeXml(document.accessibility.title)}</title>`,
    `<desc id="${descriptionId}">${escapeXml(document.accessibility.description)}</desc>`,
    `<defs><marker id="diagram-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${theme.border}"/></marker></defs>`,
    `<rect width="${scene.width}" height="${scene.height}" fill="${theme.background}"/>`,
    ...scene.groups.map((group) => renderGroup(group, theme)),
    ...scene.phases.map((phase) => renderPhase(phase, theme)),
    ...scene.lifelines.map((lifeline) => renderLifeline(lifeline, theme)),
    ...scene.edges.map((edge) => renderEdge(edge, theme)),
    ...scene.notes.map((note) => renderNote(note, theme)),
    ...scene.boxes.map((box) => renderBox(box, theme)),
    '</svg>',
  ].join('');
  assertDiagramSvg(bytes, { foreground: theme.foreground, background: theme.background });
  return Object.freeze({ svg: `${bytes}\n`, scene });
}
