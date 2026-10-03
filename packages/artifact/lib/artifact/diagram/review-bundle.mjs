import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { LARGE_OBJECT_LIMITS } from '@openplanr/protocol/large-object-contracts';
import { assertVersionedDiagramReviewBundle } from '@openplanr/protocol/studio-presentation-contracts';
import { prepareDiagramSvg } from '../ui/diagram-svg.mjs';
import { sealBundle, validateAuthoringBundle } from './authoring/model.mjs';
import { renderAuthoredDiagramSvg } from './authoring/renderer.mjs';
import { createDiagramArtifactEnvelope } from './integration.mjs';

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
function items(document, drawing) {
  const semantic = new Map(
    [
      'nodes',
      'relations',
      'groups',
      'lanes',
      'events',
      'annotations',
      'axes',
      'series',
      'sets',
    ].flatMap((key) => (document[key] ?? []).map((item) => [item.id, item])),
  );
  const unique = new Map();
  for (const item of drawing.items) {
    const source = semantic.get(item.id);
    unique.set(item.id, {
      id: item.id,
      label: source?.label ?? item.label,
      kind: item.kind,
      x: item.x,
      y: item.y,
    });
  }
  for (const relation of document.relations ?? [])
    for (const id of [relation.from, relation.to]) {
      if (!unique.has(id)) {
        const source = semantic.get(id);
        unique.set(id, { id, label: source?.label ?? id, kind: 'Item', x: 0, y: 0 });
      }
    }
  return [...unique.values()];
}
async function readSource(file) {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024)
      fail('A diagram share input must be a bounded regular file.');
    return JSON.parse(await handle.readFile('utf8'));
  } finally {
    await handle.close();
  }
}
/** Produce an inert, whitelisted native scene without publishing or rewriting the source. */
async function projectDiagramShareBundle(file) {
  const source = await readSource(file);
  let bundle;
  if (source.kind === 'diagram-authoring-bundle') {
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
    bundle = {
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
  } else if (source.kind === 'diagram-manifest') {
    const prepared = await createDiagramArtifactEnvelope(file, { nativeViewport: true });
    bundle = {
      kind: 'openplanr-diagram-review-bundle',
      schemaVersion: '1.0.0',
      diagramId: prepared.document.diagramId,
      title: prepared.document.title,
      source: { kind: 'manifest', digest: prepared.manifest.documentDigest },
      rendering: {
        id: 'openplanr-diagram-svg',
        version: prepared.manifest.renderer?.version ?? '1.0.0',
        fontFamily: 'Inter',
      },
      summary: prepared.document.summary,
      grammar: prepared.document.grammar.id,
      colorScheme: prepared.document.theme.mode === 'dark' ? 'dark' : 'light',
      scene: {
        svg: prepared.drawing.svg,
        ...prepared.drawing.scene,
        items: items(prepared.document, prepared.drawing),
        relations: relations(prepared.document),
      },
    };
  } else
    fail(
      'Share a verified diagram manifest or authored bundle, rather than a generated HTML wrapper.',
    );
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

export async function prepareDiagramShareBundle(file) {
  try {
    return await projectDiagramShareBundle(file);
  } catch (cause) {
    if (cause?.status || ['ENOENT', 'EACCES', 'EPERM'].includes(cause?.code)) throw cause;
    throw Object.assign(
      new Error(
        cause instanceof Error ? cause.message : 'The diagram could not be rendered for sharing.',
        { cause },
      ),
      {
        code: cause?.code ?? 'E_DIAGRAM_REVIEW_BUNDLE',
        status: 422,
      },
    );
  }
}
