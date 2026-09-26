import { validateDiagramSvg } from '../accessibility.mjs';
import { assertDiagramDocument } from '../model.mjs';
import { renderDiagramHtml } from './html.mjs';
import { renderDiagramPng } from './png.mjs';
import { createRenderQualityReport } from './reports.mjs';
import { renderDiagramSvg } from './svg.mjs';
import { resolveDiagramTheme } from './theme.mjs';

export function renderDiagramOutputs(document) {
  assertDiagramDocument(document);
  const theme = resolveDiagramTheme(document.theme);
  const { svg, scene } = renderDiagramSvg(document, { theme });
  const png = renderDiagramPng(svg, { theme });
  const html = renderDiagramHtml(document, svg, { theme });
  const svgValidation = validateDiagramSvg(svg);
  const quality = createRenderQualityReport(document, { scene, png, svgValidation });
  return Object.freeze({ html, png, quality, scene, svg, theme });
}

export { renderDiagramHtml } from './html.mjs';
export { layoutDiagram, wrapDiagramLabel } from './layout.mjs';
export {
  DIAGRAM_FONT,
  DIAGRAM_RASTERIZER,
  inspectDiagramPng,
  MAX_DIAGRAM_PNG_BYTES,
  renderDiagramPng,
} from './png.mjs';
export { createFidelityReport, createRenderQualityReport } from './reports.mjs';
export { escapeXml, renderDiagramSvg } from './svg.mjs';
export {
  DIAGRAM_RENDERER,
  DIAGRAM_THEME,
  DIAGRAM_THEMES,
  MAX_DIAGRAM_SCENE_EXTENT,
  OPENPLANR_BRAND_TOKENS,
  OPENPLANR_THEME,
  RASTER_SCALE,
  resolveDiagramTheme,
} from './theme.mjs';
