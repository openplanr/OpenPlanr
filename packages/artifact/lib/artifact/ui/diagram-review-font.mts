import { assertDiagramReviewBundle } from '@openplanr/protocol/diagram-review-contracts';
import { ensureDiagramFont } from './diagram-font.mjs';
import { prepareDiagramSvg } from './diagram-svg.mjs';
import { DIAGRAM_FONT_DATA_URL } from './generated/diagram-font.mjs';
export function ensureDiagramReviewFont(document: Document): Promise<void> {
  const window = document.defaultView as Window & typeof globalThis;
  const bytes = Uint8Array.from(window.atob(DIAGRAM_FONT_DATA_URL.split(',')[1]), (value) =>
    value.charCodeAt(0),
  );
  return ensureDiagramFont(document, bytes);
}
/** Export verified passive pixels and the same packaged font used by the native viewer. */
export function diagramReviewSvgExport(value: unknown): string {
  const bundle = assertDiagramReviewBundle(value);
  const drawing = prepareDiagramSvg(bundle.scene.svg, {
    allowOffset: bundle.source.kind === 'authoring',
  });
  const style = `<style>@font-face{font-family:Inter;src:url("${DIAGRAM_FONT_DATA_URL}") format("truetype");font-weight:400;font-style:normal}text,tspan{font-family:Inter,ui-sans-serif,system-ui,sans-serif}</style>`;
  return drawing.svg.replace(/(<svg[^>]*>)/u, `$1${style}`);
}
