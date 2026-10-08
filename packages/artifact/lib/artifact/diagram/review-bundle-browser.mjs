import { LARGE_OBJECT_LIMITS } from '@openplanr/protocol/large-object-contracts';
import { assertVersionedDiagramReviewBundle } from '@openplanr/protocol/studio-presentation-contracts';
import { prepareDiagramSvg } from '../ui/diagram-svg.mjs';
import { sealBundle, validateAuthoringBundle } from './authoring/model.mjs';
import { renderAuthoredDiagramSvg } from './authoring/renderer.mjs';

function sceneCenter(element, viewBox) {
  const bounds = element.bounds ?? element.labelBounds;
  const point = bounds
    ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    : (element.points?.[Math.floor(element.points.length / 2)] ?? { x: viewBox.x, y: viewBox.y });
  return { x: point.x - viewBox.x, y: point.y - viewBox.y };
}
function fail(message, { code = 'E_DIAGRAM_REVIEW_BUNDLE', status = 422 } = {}) {
  const error = new Error(message);
  Object.assign(error, { code, status });
  throw error;
}
const relations = (document) =>
  (document.relations ?? []).map(({ id, from, to, label, kind }) => ({
    id,
    from,
    to,
    label: label ?? '',
    kind: kind ?? 'flow',
  }));
/** Project a verified authored copy without file access, publication or source mutation.
 * The review retains graph, geometry and source identity; private source correspondence stays local.
 * @type {typeof import('./review-bundle-browser.d.mts').prepareAuthoredDiagramReviewBundle}
 */
export function prepareAuthoredDiagramReviewBundle(source) {
  const checked = validateAuthoringBundle(source);
  if (!checked.ok) fail('The authored diagram failed its source custody checks.');
  // Closed source contracts have already rejected arbitrary state. Keep only the rendering
  // document and presentation; original source bytes and maps never enter a shared review.
  const authored = sealBundle({
    kind: source.kind,
    schemaVersion: source.schemaVersion,
    protocolVersion: source.protocolVersion,
    diagramId: source.diagramId,
    document: structuredClone(source.document),
    presentation: structuredClone(source.presentation),
    ...(source.studioPresentation
      ? { studioPresentation: structuredClone(source.studioPresentation) }
      : {}),
    originalSource: null,
    sourceMap: null,
    bundleDigest: source.bundleDigest,
  });
  const rendered = renderAuthoredDiagramSvg(authored);
  if (!rendered.ok) fail('The saved authored geometry cannot be rendered for review.');
  const drawing = prepareDiagramSvg(rendered.svg, { allowOffset: true });
  const viewBox = rendered.scene.viewBox;
  const bundle = {
    kind: 'openplanr-diagram-review-bundle',
    schemaVersion: source.studioPresentation ? '1.1.0' : '1.0.0',
    ...(source.studioPresentation
      ? { presentation: structuredClone(source.studioPresentation) }
      : {}),
    diagramId: source.diagramId,
    title: source.document.title,
    source: { kind: 'authoring', digest: source.bundleDigest },
    rendering: { ...rendered.renderer, fontFamily: 'Inter' },
    summary: source.document.summary,
    grammar: source.document.grammar.id,
    colorScheme:
      source.studioPresentation?.theme ??
      (source.presentation.theme.themeId === 'paper' ? 'light' : 'dark'),
    scene: {
      svg: drawing.svg,
      width: rendered.scene.width,
      height: rendered.scene.height,
      items: rendered.scene.elements.map((element) => ({
        id: element.id,
        label: element.label ?? '',
        kind:
          element.collection === 'relations'
            ? 'Connection'
            : element.collection === 'groups'
              ? 'Group'
              : element.collection === 'lanes'
                ? 'Lane'
                : element.collection === 'annotations'
                  ? 'Note'
                  : 'Item',
        ...sceneCenter(element, viewBox),
      })),
      relations: relations(source.document),
    },
    authored,
  };
  assertVersionedDiagramReviewBundle(bundle);
  if (
    new TextEncoder().encode(JSON.stringify(bundle)).byteLength + 16 >
    LARGE_OBJECT_LIMITS.decodedBytes
  )
    fail('The native diagram review exceeds the encrypted sharing limit.', {
      code: 'E_DIAGRAM_REVIEW_TOO_LARGE',
      status: 413,
    });
  return bundle;
}
