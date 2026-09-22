import { clone, same, snapshot, elementIndex, validateAuthoringBundle } from './model.mjs';
import { wrapDiagramLabel } from '../rendering/layout.mjs';
import { MAX_DIAGRAM_SCENE_EXTENT } from '../rendering/theme.mjs';

export const AUTHORED_SCENE_ITEM_BUDGET = 256;
export const AUTHORED_MINIMUM_FONT_SIZE = 12;
const PADDING = 32;
const MAX_GEOMETRY_CHECKS = 100000;
const issue = (rule, detail, elementIds = [], severity = 'error') => ({ path: '$.presentation', rule, detail, elementIds, severity });
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const epsilon = 1e-7;

/** A saved side/offset is a boundary intent, resolved against the visible shape. */
export function resolveShapeAttachment(bounds, shape, attachment) {
  const { x, y, width, height } = bounds;
  const cx = x + width / 2, cy = y + height / 2;
  const vertical = attachment.side === 'left' || attachment.side === 'right';
  const sign = attachment.side === 'left' || attachment.side === 'top' ? -1 : 1;
  let px = vertical ? cx + sign * width / 2 : x + width * attachment.offset;
  let py = vertical ? y + height * attachment.offset : cy + sign * height / 2;
  if (shape === 'ellipse' || shape === 'diamond') {
    const relative = vertical ? Math.abs((py - cy) / (height / 2)) : Math.abs((px - cx) / (width / 2));
    const scale = shape === 'ellipse' ? Math.sqrt(Math.max(0, 1 - relative ** 2)) : Math.max(0, 1 - relative);
    if (vertical) px = cx + sign * width / 2 * scale;
    else py = cy + sign * height / 2 * scale;
  } else if (shape === 'rounded-rectangle') {
    const radius = Math.min(14, width / 2, height / 2);
    if (vertical && (py < y + radius || py > y + height - radius)) {
      const center = py < cy ? y + radius : y + height - radius;
      px = cx + sign * (width / 2 - radius + Math.sqrt(Math.max(0, radius ** 2 - (py - center) ** 2)));
    } else if (!vertical && (px < x + radius || px > x + width - radius)) {
      const center = px < cx ? x + radius : x + width - radius;
      py = cy + sign * (height / 2 - radius + Math.sqrt(Math.max(0, radius ** 2 - (px - center) ** 2)));
    }
  } else if (shape === 'cylinder') {
    const cap = Math.min(12, height / 4);
    if (!vertical) py = (sign < 0 ? y + cap : y + height - cap) + sign * cap * Math.sqrt(Math.max(0, 1 - ((px - cx) / (width / 2)) ** 2));
    else if (py < y + cap || py > y + height - cap) {
      const center = py < cy ? y + cap : y + height - cap;
      px = cx + sign * width / 2 * Math.sqrt(Math.max(0, 1 - ((py - center) / cap) ** 2));
    }
  }
  return { x: px, y: py };
}
function orthogonal(points, fromSide, toSide) {
  const result = [points[0]];
  for (let index = 1; index < points.length; index++) {
    const previous = result.at(-1), next = points[index];
    if (Math.abs(previous.x - next.x) > epsilon && Math.abs(previous.y - next.y) > epsilon) {
      const horizontal = index === 1 ? ['left', 'right'].includes(fromSide) : !['left', 'right'].includes(toSide);
      result.push(horizontal ? { x: next.x, y: previous.y } : { x: previous.x, y: next.y });
    }
    if (!same(result.at(-1), next)) result.push(next);
  }
  return result;
}
function routePoints(relation, placement, placements) {
  const route = placement.route;
  const from = placements.get(relation.from), to = placements.get(relation.to);
  const start = resolveShapeAttachment(from.bounds, from.appearance.shape, route.from);
  const end = resolveShapeAttachment(to.bounds, to.appearance.shape, route.to);
  if (route.mode === 'manual') {
    const authored = [start, ...route.points.slice(1, -1).map(clone), end];
    return route.strategy === 'orthogonal' ? orthogonal(authored, route.from.side, route.to.side) : authored;
  }
  if (relation.from === relation.to) {
    const outsideX = from.bounds.x + from.bounds.width + 40;
    const outsideY = from.bounds.y - 40;
    return orthogonal([start, { x: outsideX, y: start.y }, { x: outsideX, y: outsideY }, { x: end.x, y: outsideY }, end], route.from.side, route.to.side);
  }
  if (route.strategy === 'straight') return [start, end];
  if (Math.abs(start.x - end.x) < epsilon || Math.abs(start.y - end.y) < epsilon) return [start, end];
  const horizontal = ['left', 'right'].includes(route.from.side);
  return horizontal
    ? [start, { x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }, end]
    : [start, { x: start.x, y: (start.y + end.y) / 2 }, { x: end.x, y: (start.y + end.y) / 2 }, end];
}
function midpoint(points) {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let index = 0; index < lengths.length; index++) {
    if (remaining <= lengths[index] && lengths[index] > 0) {
      const scale = remaining / lengths[index];
      return { x: points[index].x + (points[index + 1].x - points[index].x) * scale, y: points[index].y + (points[index + 1].y - points[index].y) * scale };
    }
    remaining -= lengths[index];
  }
  return points[0];
}
// Conservative text estimate. No canvas/font loading or platform measurement occurs.
const textWidth = (text, size) => [...text].reduce((width, character) => width + (character.codePointAt(0) > 0x2e7f ? 1 : /[MW@#%]/u.test(character) ? 0.9 : /[il.,' ]/u.test(character) ? 0.32 : 0.62) * size, 0);
function resolveText(element, diagnostics) {
  const label = element.label;
  if (!label) return null;
  const size = element.appearance.fontSize;
  const lineHeight = size * 1.4;
  const anchor = element.savedLabel;
  const container = element.collection === 'groups' || element.collection === 'lanes';
  const inset = element.appearance.shape === 'diamond' || element.appearance.shape === 'ellipse' ? 0.22 : 0;
  const shapeWidth = element.bounds ? Math.max(1, element.bounds.width * (1 - inset * 2) - 24) : null;
  const available = anchor?.width ?? (element.bounds ? shapeWidth : Math.min(280, Math.max(72, textWidth(label, size) + 16)));
  let lines;
  try { lines = wrapDiagramLabel(label, Math.max(1, Math.floor(available / (size * 0.62)))); }
  catch { diagnostics.push(issue('text-budget', `Label ${element.id} exceeds the renderer text budget; move detail to a description.`, [element.id])); lines = [label]; }
  if (size < AUTHORED_MINIMUM_FONT_SIZE) diagnostics.push(issue('unreadable-text', `Element ${element.id} uses ${size}px text; readable export requires at least ${AUTHORED_MINIMUM_FONT_SIZE}px.`, [element.id]));
  const height = lines.length * lineHeight;
  const maximumLine = Math.max(...lines.map(line => textWidth(line, size)), 0);
  let bounds;
  if (anchor) bounds = { x: anchor.x, y: anchor.y, width: anchor.width, height };
  else if (element.bounds) {
    const width = shapeWidth;
    bounds = { x: element.bounds.x + (element.bounds.width - width) / 2, y: container ? element.bounds.y + 8 : element.bounds.y + (element.bounds.height - height) / 2, width, height };
  } else {
    const point = midpoint(element.points);
    bounds = { x: point.x - available / 2, y: point.y - height - 8, width: available, height };
  }
  if (maximumLine > bounds.width + 1 || (element.bounds && !anchor && height > element.bounds.height - (container ? 12 : 16))) diagnostics.push(issue('label-overflow', `Label ${element.id} does not fit its saved geometry at its saved font size.`, [element.id]));
  const align = element.appearance.textAlign;
  const x = bounds.x + (align === 'center' ? bounds.width / 2 : align === 'right' ? bounds.width : 0);
  if (element.bounds && !anchor && !container && lines.some((line, index) => {
    const width = textWidth(line, size), left = x - (align === 'center' ? width / 2 : align === 'right' ? width : 0);
    const top = bounds.y + index * lineHeight;
    return [[left, top], [left + width, top], [left, top + lineHeight], [left + width, top + lineHeight]].some(([px, py]) => shapeInterior({ x: px, y: py }, element) > epsilon);
  })) diagnostics.push(issue('label-overflow', `Label ${element.id} crosses its saved shape outline; enlarge the shape or shorten the label.`, [element.id]));
  return { lines, bounds, fontSize: size, lineHeight, align, x, baseline: bounds.y + size };
}
function segmentEntersBox(start, end, bounds) {
  let low = 0, high = 1;
  for (const [origin, delta, minimum, maximum] of [[start.x, end.x - start.x, bounds.x + 0.5, bounds.x + bounds.width - 0.5], [start.y, end.y - start.y, bounds.y + 0.5, bounds.y + bounds.height - 0.5]]) {
    if (delta === 0) { if (origin < minimum || origin > maximum) return false; }
    else { const a = (minimum - origin) / delta, b = (maximum - origin) / delta; low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b)); if (low > high) return false; }
  }
  return low <= high;
}
function shapeInterior(point, element) {
  const { x, y, width, height } = element.bounds;
  const dx = Math.abs(point.x - x - width / 2), dy = Math.abs(point.y - y - height / 2);
  const shape = element.appearance.shape;
  if (shape === 'ellipse') return (dx / (width / 2)) ** 2 + (dy / (height / 2)) ** 2 - 1;
  if (shape === 'diamond') return dx / (width / 2) + dy / (height / 2) - 1;
  if (shape === 'cylinder') {
    const cap = Math.min(12, height / 4);
    return (dx / (width / 2)) ** 2 + (Math.max(0, dy - (height / 2 - cap)) / cap) ** 2 - 1;
  }
  if (shape === 'rounded-rectangle') {
    const radius = Math.min(14, width / 2, height / 2);
    const qx = dx - (width / 2 - radius), qy = dy - (height / 2 - radius);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  }
  return Math.max(dx / (width / 2), dy / (height / 2)) - 1;
}
function segmentEntersShape(start, end, element) {
  if (!segmentEntersBox(start, end, element.bounds)) return false;
  // Every supported shape is convex. Minimize its convex interior function on
  // the segment, avoiding bounding-box false positives at curved attachments.
  const value = t => shapeInterior({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }, element);
  let low = 0, high = 1;
  for (let iteration = 0; iteration < 36; iteration++) {
    const left = low + (high - low) / 3, right = high - (high - low) / 3;
    if (value(left) < value(right)) high = right; else low = left;
  }
  return Math.min(value(0), value(1), value((low + high) / 2)) < -1e-5;
}
function geometryWork(elements) {
  let shapes = 0, labels = 0, relationLabels = 0, segments = 0, covers = 0;
  for (const element of elements) {
    if (element.collection === 'nodes' || element.collection === 'annotations') shapes++;
    if (element.text) labels++;
    if (element.collection === 'relations') {
      segments += Math.max(0, element.points.length - 1);
      if (element.text) relationLabels++;
    }
    if (['groups', 'lanes'].includes(element.collection) && element.appearance.fill !== 'transparent' && element.appearance.shape !== 'text') covers++;
  }
  // Upper bound the segment/shape and pairwise checks before entering them.
  return segments * (shapes + covers) + labels * (labels - 1) / 2 + shapes * (shapes - 1) / 2 + relationLabels * shapes + covers * elements.length;
}
function inspectGeometry(elements, diagnostics) {
  const shapes = elements.filter(element => element.collection === 'nodes' || element.collection === 'annotations');
  for (const element of elements) if (element.collection === 'relations') {
    if (element.appearance.stroke === 'none' || element.appearance.strokeWidth === 0) diagnostics.push(issue('invisible-connector', `Connector ${element.id} has no visible stroke; choose a stroke before export.`, [element.id]));
    if (element.points.length < 2 || element.points.every(point => same(point, element.points[0]))) diagnostics.push(issue('route-impossible', `Connector ${element.id} has no visible segment.`, [element.id]));
    for (const node of shapes) {
      if (element.points.slice(1).some((point, index) => segmentEntersShape(element.points[index], point, node))) diagnostics.push(issue('route-obstruction', `Connector ${element.id} crosses ${node.id}; revise its route.`, [element.id, node.id]));
    }
  }
  // A later opaque container can hide correctly routed content. Preserve the
  // saved stacking, but do not certify an export that loses that content.
  for (let top = 0; top < elements.length; top++) {
    const cover = elements[top];
    if (!['groups', 'lanes'].includes(cover.collection) || cover.appearance.fill === 'transparent' || cover.appearance.shape === 'text') continue;
    for (let lower = 0; lower < top; lower++) {
      const hidden = elements[lower];
      if (['groups', 'lanes'].includes(hidden.collection)) continue;
      const bounds = hidden.appearance.shape === 'text' ? hidden.text?.bounds : hidden.bounds;
      const covered = bounds && [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]].every(([x, y]) => shapeInterior({ x, y }, cover) < -epsilon);
      const routeCovered = hidden.points?.slice(1).some((point, index) => segmentEntersShape(hidden.points[index], point, cover));
      if (covered || routeCovered) diagnostics.push(issue('stacking-obstruction', `Opaque container ${cover.id} covers ${hidden.id}; put the container behind its content or use a transparent fill.`, [hidden.id, cover.id]));
    }
  }
  const labels = elements.filter(element => element.text);
  for (let a = 0; a < labels.length; a++) for (let b = a + 1; b < labels.length; b++) {
    if (overlaps(labels[a].text.bounds, labels[b].text.bounds)) diagnostics.push(issue('label-collision', `Labels ${labels[a].id} and ${labels[b].id} overlap.`, [labels[a].id, labels[b].id]));
  }
  for (const label of labels) if (label.collection === 'relations') for (const node of shapes) if (overlaps(label.text.bounds, node.bounds)) diagnostics.push(issue('label-obstruction', `Connector label ${label.id} overlaps ${node.id}.`, [label.id, node.id]));
  for (let a = 0; a < shapes.length; a++) for (let b = a + 1; b < shapes.length; b++) if (overlaps(shapes[a].bounds, shapes[b].bounds)) diagnostics.push(issue('shape-overlap', `Shapes ${shapes[a].id} and ${shapes[b].id} overlap.`, [shapes[a].id, shapes[b].id], 'warning'));
}

/** Internal shared geometry for rendering and the editor index; inputs are validated. */
export function resolveDiagramSceneElement(entry, placement, placements, order, emphasisLevel = null, diagnostics = []) {
  const { collection, value } = entry;
  const element = { id: value.id, collection, semantic: clone(value), kind: value.kind ?? collection, label: value.label ?? value.text ?? '', description: value.description ?? '', bounds: clone(placement.bounds), savedLabel: clone(placement.label), zIndex: placement.zIndex, order, appearance: clone(placement.appearance), locks: clone(placement.locks), emphasis: emphasisLevel };
  if (placement.bounds) Object.assign(element, clone(placement.bounds));
  if (collection === 'relations') Object.assign(element, { from: value.from, to: value.to, direction: value.direction, route: clone(placement.route), points: routePoints(value, placement, placements) });
  element.text = resolveText(element, diagnostics);
  element.lines = element.text?.lines ?? [];
  if (element.points) {
    element.routePoints = element.points.map(({ x, y }) => [x, y]);
    element.x1 = element.points[0].x; element.y1 = element.points[0].y;
    element.x2 = element.points.at(-1).x; element.y2 = element.points.at(-1).y;
    element.labelBounds = element.text?.bounds ?? null;
    element.labelLines = element.lines;
  }
  return element;
}

/** Resolve one immutable bundle without relayout or writes to authored geometry. */
export function resolveDiagramScene(bundle) {
  const checked = validateAuthoringBundle(bundle);
  if (!checked.ok) return { ok: false, code: 'invalid-bundle', diagnostics: checked.diagnostics };
  const byId = elementIndex(bundle.document);
  const placements = new Map(bundle.presentation.elements.map(value => [value.elementId, value]));
  const emphasis = new Map(bundle.document.emphasis.map(value => [value.targetId, value.level]));
  const diagnostics = [];
  const elements = bundle.presentation.elements.map((placement, order) => resolveDiagramSceneElement(byId.get(placement.elementId), placement, placements, order, emphasis.get(placement.elementId) ?? null, diagnostics)).sort((a, b) => a.zIndex - b.zIndex || a.order - b.order);
  // Valid bundles can contain more route points than JavaScript permits as
  // function arguments. Accumulate bounds without spreading or flattening them.
  let minimumX = 0, minimumY = 0, maximumX = 0, maximumY = 0;
  for (const element of elements) {
    for (const rect of [element.bounds, element.text?.bounds]) if (rect) {
      minimumX = Math.min(minimumX, rect.x); minimumY = Math.min(minimumY, rect.y);
      maximumX = Math.max(maximumX, rect.x + rect.width); maximumY = Math.max(maximumY, rect.y + rect.height);
    }
    for (const point of element.points ?? []) {
      minimumX = Math.min(minimumX, point.x); minimumY = Math.min(minimumY, point.y);
      maximumX = Math.max(maximumX, point.x); maximumY = Math.max(maximumY, point.y);
    }
  }
  const viewBox = { x: Math.floor(minimumX - PADDING), y: Math.floor(minimumY - PADDING), width: Math.max(1, Math.ceil(maximumX - minimumX + 2 * PADDING)), height: Math.max(1, Math.ceil(maximumY - minimumY + 2 * PADDING)) };
  let dense = elements.length > AUTHORED_SCENE_ITEM_BUDGET || Math.max(viewBox.width, viewBox.height) > MAX_DIAGRAM_SCENE_EXTENT;
  if (dense) diagnostics.push(issue('focused-output-required', `This ${elements.length}-element diagram exceeds the single-view presentation budget; export a focused view or split it without shrinking labels.`, [], 'warning'));
  else if (geometryWork(elements) > MAX_GEOMETRY_CHECKS) {
    dense = true;
    diagnostics.push(issue('focused-output-required', 'This scene exceeds the bounded geometry inspection budget; export a focused view or simplify its routes without discarding the saved draft.', [], 'warning'));
  } else inspectGeometry(elements, diagnostics);
  const status = elements.length === 0 ? 'no-visible-content' : dense ? 'focused-output-required' : diagnostics.some(value => value.severity === 'error') ? 'invalid' : diagnostics.length ? 'warning' : 'pass';
  if (!elements.length) diagnostics.push(issue('no-visible-content', 'This valid draft has no visible elements to export.', [], 'warning'));
  const scene = { kind: 'diagram-authored-scene', schemaVersion: '1.0.0', diagramId: bundle.diagramId, basis: snapshot(bundle), viewBox, width: viewBox.width, height: viewBox.height, elements,
    boxes: elements.filter(element => element.collection === 'nodes'), groups: elements.filter(element => element.collection === 'groups'), lanes: elements.filter(element => element.collection === 'lanes'), edges: elements.filter(element => element.collection === 'relations'), notes: elements.filter(element => element.collection === 'annotations'),
    labelBounds: elements.filter(element => element.text).map(element => ({ id: element.id, ...element.text.bounds })), quality: { status, diagnostics: diagnostics.slice(0, 128) } };
  return { ok: true, scene, diagnostics: [] };
}
