import { validateDiagramSvg } from '../accessibility.mjs';
import { assertDiagramDocument } from '../model.mjs';
import { renderDiagramHtml } from './html.mjs';
import { renderDiagramPng } from './png.mjs';
import { createRenderQualityReport } from './reports.mjs';
import { renderDiagramSvg } from './svg.mjs';

export function renderDiagramOutputs(document) {
  assertDiagramDocument(document);
  const { svg, scene } = renderDiagramSvg(document);
  const png = renderDiagramPng(svg);
  const html = renderDiagramHtml(document, svg);
  const svgValidation = validateDiagramSvg(svg);
  const quality = createRenderQualityReport(document, { scene, png, svgValidation });
  return Object.freeze({ html, png, quality, scene, svg });
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
export { DIAGRAM_RENDERER, DIAGRAM_THEME, RASTER_SCALE } from './theme.mjs';
