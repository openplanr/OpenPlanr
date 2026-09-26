import { validateDiagramSvg } from '../accessibility.mjs';
import { escapeXml } from '../rendering/svg.mjs';
import { DIAGRAM_THEME } from '../rendering/theme.mjs';
import { inspectPlainData } from './model.mjs';
import { resolveDiagramScene } from './scene.mjs';

export const AUTHORED_DIAGRAM_RENDERER = Object.freeze({
  id: 'openplanr-authored-svg',
  version: '1.0.0',
});
const palettes = {
  paper: {
    ...DIAGRAM_THEME,
    id: 'paper',
    version: '1.0.0',
    accent: '#1d4ed8',
    success: '#166534',
    warning: '#854d0e',
    danger: '#b91c1c',
    fills: {
      surface: '#f8fafc',
      accent: '#dbeafe',
      success: '#dcfce7',
      warning: '#fef3c7',
      danger: '#fee2e2',
      transparent: 'none',
    },
  },
  slate: {
    ...DIAGRAM_THEME,
    id: 'slate',
    version: '1.0.0',
    background: '#17212d',
    surface: '#233141',
    foreground: '#f1f5f9',
    border: '#a9bbcf',
    accent: '#7dd3fc',
    muted: '#cbd5e1',
    success: '#86efac',
    warning: '#fde68a',
    danger: '#fca5a5',
    fills: {
      surface: '#233141',
      accent: '#123e55',
      success: '#164434',
      warning: '#4a3818',
      danger: '#54252a',
      transparent: 'none',
    },
  },
  midnight: {
    ...DIAGRAM_THEME,
    id: 'midnight',
    version: '1.0.0',
    background: '#0b1015',
    surface: '#151e28',
    foreground: '#e5edf5',
    border: '#94a3b8',
    accent: '#67e8f9',
    muted: '#b8c7d9',
    success: '#86efac',
    warning: '#fcd34d',
    danger: '#fca5a5',
    fills: {
      surface: '#151e28',
      accent: '#0c3640',
      success: '#12392d',
      warning: '#493817',
      danger: '#4f2529',
      transparent: 'none',
    },
  },
};
/** Internal renderer palette shared by static output and the live editor. */
export function authoredDiagramPalette(themeId = 'paper') {
  const theme = palettes[themeId] ?? palettes.paper;
  return { ...theme, fills: { ...theme.fills } };
}
const strokeColor = (appearance, theme) =>
  ({
    default: theme.border,
    accent: theme.accent,
    muted: theme.muted,
    danger: theme.danger,
    none: 'none',
  })[appearance.stroke];
const svgNumber = (value) => String(Number(value.toFixed(6)));
function attributes(element, theme, fill = theme.fills[element.appearance.fill]) {
  const { appearance } = element;
  const dash =
    appearance.strokeStyle === 'dashed'
      ? ' stroke-dasharray="7 5"'
      : appearance.strokeStyle === 'dotted'
        ? ' stroke-dasharray="2 4" stroke-linecap="round"'
        : '';
  return `fill="${fill}" stroke="${strokeColor(appearance, theme)}" stroke-width="${appearance.strokeWidth}"${dash}`;
}
function shape(element, theme) {
  const { x, y, width, height } = element.bounds;
  const common = attributes(element, theme);
  const n = svgNumber;
  switch (element.appearance.shape) {
    case 'text':
      return '';
    case 'ellipse':
      return `<ellipse cx="${n(x + width / 2)}" cy="${n(y + height / 2)}" rx="${n(width / 2)}" ry="${n(height / 2)}" ${common}/>`;
    case 'diamond':
      return `<path d="M ${n(x + width / 2)} ${n(y)} L ${n(x + width)} ${n(y + height / 2)} L ${n(x + width / 2)} ${n(y + height)} L ${n(x)} ${n(y + height / 2)} Z" ${common}/>`;
    case 'cylinder': {
      const cap = Math.min(12, height / 4),
        rx = width / 2;
      return `<path d="M ${n(x)} ${n(y + cap)} A ${n(rx)} ${n(cap)} 0 0 1 ${n(x + width)} ${n(y + cap)} L ${n(x + width)} ${n(y + height - cap)} A ${n(rx)} ${n(cap)} 0 0 1 ${n(x)} ${n(y + height - cap)} Z" ${common}/><path d="M ${n(x)} ${n(y + cap)} A ${n(rx)} ${n(cap)} 0 0 0 ${n(x + width)} ${n(y + cap)}" ${attributes(element, theme, 'none')}/>`;
    }
    default:
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" rx="${element.appearance.shape === 'rounded-rectangle' ? n(Math.min(14, width / 2, height / 2)) : 0}" ${common}/>`;
  }
}
function text(element, theme) {
  if (!element.text) return '';
  const { lines, x, baseline, lineHeight, fontSize, align, bounds } = element.text;
  const anchor = { left: 'start', center: 'middle', right: 'end' }[align];
  const background =
    element.collection === 'relations'
      ? `<rect x="${svgNumber(bounds.x)}" y="${svgNumber(bounds.y)}" width="${svgNumber(bounds.width)}" height="${svgNumber(bounds.height)}" fill="${theme.background}"/>`
      : '';
  return `${background}<text aria-label="${escapeXml(element.label)}" text-anchor="${anchor}" font-family="${theme.fontFamily}" font-size="${fontSize}" font-weight="${element.emphasis === 'primary' ? 700 : element.emphasis === 'muted' ? 400 : 500}" fill="${theme.foreground}">${lines.map((line, index) => `<tspan x="${svgNumber(x)}" y="${svgNumber(baseline + index * lineHeight)}">${escapeXml(line)}</tspan>`).join('')}</text>`;
}
export function renderAuthoredSceneElement(element, theme, diagramId) {
  const attributes = `data-element-id="${escapeXml(element.id)}" data-collection="${element.collection}" data-semantic-kind="${escapeXml(element.kind)}" data-shape="${element.appearance.shape}" data-z-index="${element.zIndex}"${element.emphasis ? ` data-emphasis="${element.emphasis}"` : ''}`;
  if (element.collection !== 'relations')
    return `<g ${attributes}>${shape(element, theme)}${text(element, theme)}</g>`;
  const color = strokeColor(element.appearance, theme);
  const marker = `${diagramId}-${element.id}-arrow`;
  const markerDefinition =
    element.direction === 'none'
      ? ''
      : `<defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="${color}"/></marker></defs>`;
  const start = element.direction === 'both' ? ` marker-start="url(#${marker})"` : '';
  const end = element.direction !== 'none' ? ` marker-end="url(#${marker})"` : '';
  const dash =
    element.appearance.strokeStyle === 'dashed'
      ? ' stroke-dasharray="7 5"'
      : element.appearance.strokeStyle === 'dotted'
        ? ' stroke-dasharray="2 4" stroke-linecap="round"'
        : '';
  const path = element.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${svgNumber(point.x)} ${svgNumber(point.y)}`)
    .join(' ');
  return `<g ${attributes} data-direction="${element.direction}">${markerDefinition}<path d="${path}" fill="none" stroke="${color}" stroke-width="${element.appearance.strokeWidth}"${dash}${start}${end}/>${text(element, theme)}</g>`;
}

/** Render only at saved coordinates and saved text sizes; quality never resizes data. */
export function renderAuthoredDiagramSvg(bundle, options = {}) {
  const optionDiagnostics = inspectPlainData(options);
  if (optionDiagnostics.length)
    return { ok: false, code: 'invalid-options', diagnostics: optionDiagnostics };
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => key !== 'theme') ||
    (options.theme !== undefined && !Object.hasOwn(palettes, options.theme))
  )
    return {
      ok: false,
      code: 'invalid-options',
      diagnostics: [
        { path: '$.options', rule: 'theme', detail: 'Choose the paper, slate or midnight theme.' },
      ],
    };
  const resolved = resolveDiagramScene(bundle);
  if (!resolved.ok) return resolved;
  const { scene } = resolved,
    quality = scene.quality;
  if (['no-visible-content', 'focused-output-required', 'invalid'].includes(quality.status))
    return {
      ok: false,
      code: quality.status === 'invalid' ? 'invalid-geometry' : quality.status,
      scene,
      quality,
      diagnostics: quality.diagnostics,
    };
  const theme = {
    ...palettes[options.theme ?? bundle.presentation.theme.themeId],
    fills: { ...palettes[options.theme ?? bundle.presentation.theme.themeId].fills },
  };
  const titleId = `${bundle.diagramId}-title`,
    descriptionId = `${bundle.diagramId}-description`;
  const viewBox = scene.viewBox;
  const bytes = [
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${titleId} ${descriptionId}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}" width="${scene.width}" height="${scene.height}">`,
    `<title id="${titleId}">${escapeXml(bundle.document.accessibility.title || bundle.document.title || 'Diagram')}</title>`,
    `<desc id="${descriptionId}">${escapeXml(bundle.document.accessibility.description || bundle.document.summary || 'An authored diagram.')}</desc>`,
    `<rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}" fill="${theme.background}"/>`,
    ...scene.elements.map((element) =>
      renderAuthoredSceneElement(element, theme, bundle.diagramId),
    ),
    '</svg>\n',
  ].join('');
  const accessible = validateDiagramSvg(bytes, {
    foreground: theme.foreground,
    background: theme.background,
  });
  if (!accessible.ok)
    return {
      ok: false,
      code: 'invalid-geometry',
      scene,
      quality,
      diagnostics: accessible.errors.map((rule) => ({
        path: '$.svg',
        rule,
        detail: 'Rendered SVG did not pass accessibility verification.',
      })),
    };
  return {
    ok: true,
    svg: bytes,
    scene,
    quality,
    renderer: { ...AUTHORED_DIAGRAM_RENDERER },
    theme,
    diagnostics: [],
  };
}
