import { sha256Hex } from '../../../protocol/canonical-json.mjs';

import { assertDiagramSvg } from '../accessibility.mjs';
import { DIAGRAM_ERROR_CODES, diagramFail } from '../errors.mjs';
import { layoutDiagram } from '../rendering/layout.mjs';
import { createFidelityReport } from '../rendering/reports.mjs';
import { escapeXml } from '../rendering/svg.mjs';
import { DIAGRAM_THEME } from '../rendering/theme.mjs';

const MAX_SCENE_ELEMENTS = 5_000;
const MAX_SCENE_BYTES = 5 * 1024 * 1024;
const ELEMENT_TYPES = new Set(['rectangle', 'text', 'arrow']);

function numericSeed(value) {
  return Number.parseInt(sha256Hex(value).slice(0, 8), 16) & 0x7fffffff;
}

function baseElement(id, type, geometry) {
  const seed = numericSeed(`${type}:${id}`);
  return {
    id,
    type,
    ...geometry,
    angle: 0,
    strokeColor: type === 'text' ? DIAGRAM_THEME.foreground : DIAGRAM_THEME.border,
    backgroundColor: type === 'rectangle' ? DIAGRAM_THEME.surface : 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: type === 'rectangle' ? { type: 3 } : null,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
    version: 1,
    versionNonce: seed,
    isDeleted: false,
    seed,
  };
}

export const EXCALIDRAW_EXPORT_CAPABILITIES = Object.freeze({
  flowchart: Object.freeze({
    grammarId: 'flowchart',
    status: 'editable',
    reason: 'The native scene projection preserves flowchart boxes, labels, arrows, and generated layout geometry.',
  }),
  sequence: Object.freeze({
    grammarId: 'sequence',
    status: 'editable',
    reason: 'The native scene projection preserves participants, lifelines, phases, ordered messages, notes, and generated chronology geometry.',
  }),
});

export function excalidrawCapability(grammarId) {
  return EXCALIDRAW_EXPORT_CAPABILITIES[grammarId] ?? Object.freeze({
    grammarId,
    status: 'unsupported',
    reason: `No production editable-scene projection is certified for the ${grammarId} grammar.`,
  });
}

export function assertExcalidrawScene(scene) {
  if (!scene || scene.type !== 'excalidraw' || scene.version !== 2 || !Array.isArray(scene.elements)) {
    diagramFail(DIAGRAM_ERROR_CODES.SCENE_INVALID, 'Editable scene does not satisfy the Excalidraw file envelope.');
  }
  const byteLength = Buffer.byteLength(JSON.stringify(scene));
  if (scene.elements.length > MAX_SCENE_ELEMENTS || byteLength > MAX_SCENE_BYTES) {
    diagramFail(DIAGRAM_ERROR_CODES.RESOURCE_BUDGET_EXCEEDED, 'Editable scene exceeds its resource budget.', {
      elements: scene.elements.length,
      maximumElements: MAX_SCENE_ELEMENTS,
      bytes: byteLength,
      maximumBytes: MAX_SCENE_BYTES,
    });
  }
  const ids = new Set();
  for (const element of scene.elements) {
    if (!element || !ELEMENT_TYPES.has(element.type) || typeof element.id !== 'string' || ids.has(element.id)) {
      diagramFail(DIAGRAM_ERROR_CODES.SCENE_INVALID, 'Editable scene contains an unsupported or duplicate element.', {
        elementId: element?.id ?? null,
        elementType: element?.type ?? null,
      });
    }
    ids.add(element.id);
    for (const field of ['x', 'y', 'width', 'height']) {
      if (!Number.isFinite(element[field]) || Math.abs(element[field]) > 1_000_000) {
        diagramFail(DIAGRAM_ERROR_CODES.SCENE_INVALID, `Editable scene has invalid ${field} geometry.`, { elementId: element.id });
      }
    }
    if (element.link !== null || element.fileId || element.type === 'image') {
      diagramFail(DIAGRAM_ERROR_CODES.SCENE_INVALID, 'Editable scenes may not contain links or external assets.', { elementId: element.id });
    }
    if (element.type === 'text' && (typeof element.text !== 'string' || element.text.length > 2_048)) {
      diagramFail(DIAGRAM_ERROR_CODES.SCENE_INVALID, 'Editable scene text is missing or exceeds the renderer limit.', { elementId: element.id });
    }
  }
  return scene;
}

export function exportDiagramExcalidraw(document) {
  const capability = excalidrawCapability(document.grammar.id);
  if (capability.status !== 'editable') {
    return Object.freeze({
      scene: null,
      report: createFidelityReport(document, {
        targetFormat: 'excalidraw',
        status: capability.status,
        omitted: [{ source: document.grammar.id, reason: capability.reason }],
        notes: ['No editable file was emitted; canonical SVG, HTML, and PNG remain available.'],
      }),
    });
  }
  const layout = layoutDiagram(document);
  const emphasized = new Map(document.emphasis.map(({ targetId, level }) => [targetId, level]));
  const rectangles = layout.boxes.map((box) => ({
    ...baseElement(`box-${box.id}`, 'rectangle', {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    }),
    strokeColor: emphasized.has(box.id) ? DIAGRAM_THEME.accent : DIAGRAM_THEME.border,
    strokeWidth: emphasized.get(box.id) === 'primary' ? 3 : 2,
  }));
  const texts = layout.boxes.map((box) => ({
    ...baseElement(`text-${box.id}`, 'text', {
      x: box.x + 16,
      y: box.y + 20,
      width: box.width - 32,
      height: box.height - 40,
    }),
    text: box.label,
    originalText: box.label,
    fontSize: 20,
    fontFamily: 1,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: `box-${box.id}`,
    lineHeight: 1.25,
    autoResize: true,
  }));
  const arrows = layout.edges.map((edge) => {
    const points = edge.routePoints ?? [[edge.x1, edge.y1], [edge.x2, edge.y2]];
    const left = Math.min(...points.map(([x]) => x));
    const top = Math.min(...points.map(([, y]) => y));
    const width = Math.max(...points.map(([x]) => x)) - left;
    const height = Math.max(...points.map(([, y]) => y)) - top;
    return {
      ...baseElement(`arrow-${edge.id}`, 'arrow', {
        x: left,
        y: top,
        width,
        height,
        points: points.map(([x, y]) => [x - left, y - top]),
        startBinding: { elementId: `box-${edge.from}`, focus: 0, gap: 1 },
        endBinding: { elementId: `box-${edge.to}`, focus: 0, gap: 1 },
        startArrowhead: null,
        endArrowhead: 'arrow',
      }),
      strokeColor: emphasized.has(edge.id) ? DIAGRAM_THEME.accent : DIAGRAM_THEME.border,
      strokeWidth: emphasized.get(edge.id) === 'primary' ? 3 : 2,
      strokeStyle: edge.kind === 'flow' ? 'dashed' : 'solid',
    };
  });
  const edgeTexts = layout.edges.flatMap((edge) => {
    const bounds = edge.labelBounds;
    const label = (edge.labelLines ?? (edge.label ? [edge.label] : [])).join('\n');
    if (!label) return [];
    const width = bounds?.width ?? Math.max(120, Math.abs(edge.x2 - edge.x1) - 32);
    const height = bounds?.height ?? 28;
    return [{
      ...baseElement(`label-${edge.id}`, 'text', {
        x: bounds?.x ?? (edge.x1 + edge.x2) / 2 - width / 2,
        y: bounds?.y ?? (edge.y1 + edge.y2) / 2 - height - 8,
        width,
        height,
      }),
      text: label,
      originalText: label,
      fontSize: 14,
      fontFamily: 1,
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId: null,
      lineHeight: 1.25,
      autoResize: true,
    }];
  });
  const lifelines = layout.lifelines.map((lifeline) => ({
    ...baseElement(`lifeline-${lifeline.id}`, 'arrow', {
      x: lifeline.x,
      y: lifeline.y1,
      width: 0,
      height: lifeline.y2 - lifeline.y1,
      points: [[0, 0], [0, lifeline.y2 - lifeline.y1]],
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: null,
    }),
    strokeWidth: 1,
    strokeStyle: 'dashed',
    opacity: 55,
  }));
  const phaseLines = layout.phases.map((phase) => ({
    ...baseElement(`phase-line-${phase.id}`, 'arrow', {
      x: phase.x1,
      y: phase.y,
      width: phase.x2 - phase.x1,
      height: 0,
      points: [[0, 0], [phase.x2 - phase.x1, 0]],
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: null,
    }),
    strokeWidth: 1,
    opacity: 40,
  }));
  const phaseTexts = layout.phases.map((phase) => ({
    ...baseElement(`phase-text-${phase.id}`, 'text', {
      x: phase.x1,
      y: phase.y - 30,
      width: Math.max(140, phase.x2 - phase.x1),
      height: 24,
    }),
    text: phase.label,
    originalText: phase.label,
    fontSize: 14,
    fontFamily: 1,
    textAlign: 'left',
    verticalAlign: 'middle',
    containerId: null,
    lineHeight: 1.25,
    autoResize: true,
    strokeColor: DIAGRAM_THEME.accent,
  }));
  const noteRectangles = layout.notes.map((note) => ({
    ...baseElement(`note-${note.id}`, 'rectangle', {
      x: note.x,
      y: note.y,
      width: note.width,
      height: note.height,
    }),
    strokeColor: DIAGRAM_THEME.accent,
    strokeWidth: 1,
  }));
  const noteTexts = layout.notes.map((note) => {
    const text = note.lines.join('\n');
    return {
      ...baseElement(`note-text-${note.id}`, 'text', {
        x: note.x + 16,
        y: note.y + 12,
        width: note.width - 32,
        height: note.height - 24,
      }),
      text,
      originalText: text,
      fontSize: 13,
      fontFamily: 1,
      textAlign: 'left',
      verticalAlign: 'middle',
      containerId: `note-${note.id}`,
      lineHeight: 1.25,
      autoResize: true,
    };
  });
  const scene = assertExcalidrawScene({
    type: 'excalidraw',
    version: 2,
    source: 'openplanr',
    elements: [
      ...phaseLines,
      ...lifelines,
      ...arrows,
      ...rectangles,
      ...noteRectangles,
      ...texts,
      ...edgeTexts,
      ...phaseTexts,
      ...noteTexts,
    ],
    appState: { viewBackgroundColor: DIAGRAM_THEME.background },
    files: {},
  });
  return Object.freeze({
    scene,
    report: createFidelityReport(document, {
      targetFormat: 'excalidraw',
      status: 'editable',
      interpreted: [
        ...document.nodes.map((node) => ({ source: `node:${node.id}`, targetId: node.id, construct: 'node' })),
        ...document.relations.map((relation) => ({ source: `relation:${relation.id}`, targetId: relation.id, construct: 'relation' })),
        ...document.events.map((event) => ({ source: `event:${event.id}`, targetId: event.id, construct: 'phase' })),
        ...document.annotations.map((annotation) => ({ source: `annotation:${annotation.id}`, targetId: annotation.id, construct: 'note' })),
        ...document.emphasis.map((emphasis) => ({ source: `emphasis:${emphasis.targetId}`, targetId: emphasis.targetId, construct: 'emphasis' })),
      ],
      notes: [capability.reason, 'Free-form scene edits become scene-owned and do not claim semantic round-trip equivalence.'],
    }),
  });
}

function sceneBounds(elements) {
  const maximumX = Math.max(640, ...elements.map((element) => element.x + Math.max(0, element.width)));
  const maximumY = Math.max(360, ...elements.map((element) => element.y + Math.max(0, element.height)));
  return { width: Math.ceil(maximumX + 64), height: Math.ceil(maximumY + 64) };
}

export function renderExcalidrawSceneSvg(scene, {
  title = 'Edited diagram',
  description = 'An edited Excalidraw scene rendered by OpenPlanr.',
} = {}) {
  assertExcalidrawScene(scene);
  const bounds = sceneBounds(scene.elements);
  const elements = scene.elements.map((element) => {
    if (element.type === 'rectangle') return `<rect data-scene-id="${escapeXml(element.id)}" x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="14" fill="${escapeXml(element.backgroundColor)}" stroke="${escapeXml(element.strokeColor)}" stroke-width="${element.strokeWidth}"/>`;
    if (element.type === 'arrow') {
      const points = element.points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${element.x + x} ${element.y + y}`).join(' ');
      const dash = element.strokeStyle === 'dashed' ? ' stroke-dasharray="6 6"' : '';
      const marker = element.endArrowhead ? ' marker-end="url(#diagram-arrow)"' : '';
      return `<path data-scene-id="${escapeXml(element.id)}" d="${points}" fill="none" stroke="${escapeXml(element.strokeColor)}" stroke-width="${element.strokeWidth}" opacity="${element.opacity / 100}"${dash}${marker}/>`;
    }
    const lines = element.text.split('\n');
    const x = element.textAlign === 'left' ? element.x : element.x + element.width / 2;
    const anchor = element.textAlign === 'left' ? 'start' : 'middle';
    const firstY = element.y + element.height / 2 - ((lines.length - 1) * element.fontSize * (element.lineHeight ?? 1.25)) / 2;
    return `<text data-scene-id="${escapeXml(element.id)}" x="${x}" y="${firstY}" text-anchor="${anchor}" dominant-baseline="middle" font-family="${DIAGRAM_THEME.fontFamily}" font-size="${element.fontSize}" fill="${escapeXml(element.strokeColor === 'transparent' ? DIAGRAM_THEME.foreground : element.strokeColor)}">${lines.map((line, index) => `<tspan x="${x}" y="${firstY + index * element.fontSize * (element.lineHeight ?? 1.25)}">${escapeXml(line)}</tspan>`).join('')}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="scene-title scene-description" viewBox="0 0 ${bounds.width} ${bounds.height}" width="${bounds.width}" height="${bounds.height}"><title id="scene-title">${escapeXml(title)}</title><desc id="scene-description">${escapeXml(description)}</desc><defs><marker id="diagram-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${DIAGRAM_THEME.border}"/></marker></defs><rect width="${bounds.width}" height="${bounds.height}" fill="${DIAGRAM_THEME.background}"/>${elements}</svg>\n`;
  assertDiagramSvg(svg);
  return Object.freeze({
    svg,
    scene: Object.freeze({
      width: bounds.width,
      height: bounds.height,
      boxes: Object.freeze(scene.elements.filter(({ type }) => type === 'rectangle')),
      edges: Object.freeze(scene.elements.filter(({ type }) => type === 'arrow')),
    }),
  });
}
