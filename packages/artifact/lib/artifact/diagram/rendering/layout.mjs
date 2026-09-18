import { DIAGRAM_ERROR_CODES, diagramFail } from '../errors.mjs';
import { MAX_DIAGRAM_SCENE_EXTENT, MAX_VISIBLE_LABEL_CHARACTERS, RASTER_SCALE } from './theme.mjs';

const PADDING = 64;
// A layer gap holds the source lane, the target lane, and a one-line relation
// label between them with clearance on both sides. Grouped layers add the group
// frame and its title band, so their lanes leave from the frame, not the box.
const COLUMN_GAP = 112;
const ROW_GAP = 112;
const GROUPED_LAYER_GAP = 168;
const GROUP_PADDING = Object.freeze({ side: 28, top: 46, bottom: 28 });
const BOX_LANE_OFFSET = 28;
const FRAME_LANE_OFFSET = 16;
// A band gap holds two routing lanes plus a two-line relation label.
const BAND_GAP = 144;
// Layered graphs longer than this along the flow axis wrap into bands.
const BAND_WRAP_EXTENT = 4_096;
// The longest band still rasterizes at RASTER_SCALE inside the viewport budget.
const MAX_BAND_EXTENT = MAX_DIAGRAM_SCENE_EXTENT / RASTER_SCALE;
const MIN_NODE_WIDTH = 220;
const MAX_NODE_WIDTH = 420;
const LINE_HEIGHT = 22;
const NODE_VERTICAL_PADDING = 44;
const CHARACTERS_PER_LINE = 32;
// A single word up to this length is kept whole even when it exceeds the
// per-line budget; "describes" must never render as "describe" + "s".
const UNBREAKABLE_WORD_LENGTH = 20;
// Relation labels prefer the approach to their target so a fan-out from one
// source reads unambiguously; this is the clearance kept from the arrowhead.
const LABEL_TARGET_CLEARANCE = 6;
const SEQUENCE_PARTICIPANT_WIDTH = 220;
const SEQUENCE_PARTICIPANT_GAP = 96;
const SEQUENCE_PHASE_RAIL = 176;
const SEQUENCE_MESSAGE_LINE_HEIGHT = 18;
const SEQUENCE_MESSAGE_GAP = 34;
// Reserve a full em for each relation-label glyph at 14px. This conservative
// bound covers wide Latin/full-width glyphs instead of assuming average text.
const GRAPH_LABEL_GLYPH_WIDTH = 14;

function semanticItems(document) {
  if (document.nodes.length > 0) return document.nodes;
  return [
    ...document.events.map((item) => ({ ...item, kind: 'event', description: null })),
    ...document.series.map((item) => ({ ...item, kind: 'series', description: null })),
    ...document.sets.map((item) => ({ ...item, kind: 'set', description: null })),
  ];
}

export function wrapDiagramLabel(label, maximum = CHARACTERS_PER_LINE) {
  const value = String(label).normalize('NFC');
  if (value.length > MAX_VISIBLE_LABEL_CHARACTERS) {
    diagramFail(DIAGRAM_ERROR_CODES.RESOURCE_BUDGET_EXCEEDED, 'Diagram label exceeds the renderer text budget.', {
      characters: value.length,
      maximum: MAX_VISIBLE_LABEL_CHARACTERS,
      repair: 'Shorten the label or move supporting detail into the item description.',
    });
  }
  const lines = [];
  for (const paragraph of value.split(/\r?\n/u)) {
    const words = paragraph.trim().split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      if (word.length > Math.max(maximum, UNBREAKABLE_WORD_LENGTH)) {
        // Only words no reader would recognise anyway are split mid-glyph.
        if (current) lines.push(current);
        for (let offset = 0; offset < word.length; offset += maximum) lines.push(word.slice(offset, offset + maximum));
        current = '';
      } else if (word.length > maximum) {
        if (current) lines.push(current);
        lines.push(word);
        current = '';
      } else if (!current) current = word;
      else if (`${current} ${word}`.length <= maximum) current = `${current} ${word}`;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

function dimensions(lines) {
  const longest = Math.max(1, ...lines.map((line) => [...line].length));
  return {
    width: Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, longest * 9 + 52)),
    height: Math.max(88, lines.length * LINE_HEIGHT + NODE_VERTICAL_PADDING),
  };
}

function orient(box, direction, extent) {
  if (direction === 'left-right') return box;
  if (direction === 'right-left') return { ...box, x: extent.width - box.x - box.width };
  if (direction === 'bottom-up') return { ...box, x: box.y, y: extent.width - box.x - box.width };
  if (direction === 'radial') return box;
  return { ...box, x: box.y, y: box.x };
}

function createBox(item) {
  const lines = wrapDiagramLabel(item.label);
  return {
    id: item.id,
    kind: item.kind,
    label: item.label,
    description: item.description ?? null,
    lines,
    x: 0,
    y: 0,
    ...dimensions(lines),
  };
}

function gridLayout(items, direction) {
  const horizontal = ['left-right', 'right-left'].includes(direction);
  const columns = horizontal ? Math.min(6, Math.max(1, items.length)) : Math.min(3, Math.max(1, items.length));
  const sized = items.map(createBox);
  const maximumNodeHeight = Math.max(88, ...sized.map(({ height }) => height));
  const raw = [];
  let maximumWidth = 0;
  let maximumHeight = 0;
  for (const [index, boxValue] of sized.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const box = {
      ...boxValue,
      x: PADDING + column * (MAX_NODE_WIDTH + COLUMN_GAP),
      y: PADDING + row * (maximumNodeHeight + ROW_GAP),
    };
    maximumWidth = Math.max(maximumWidth, box.x + box.width + PADDING);
    maximumHeight = Math.max(maximumHeight, box.y + box.height + PADDING);
    raw.push(box);
  }
  const extent = { width: Math.max(maximumWidth, 640), height: Math.max(maximumHeight, 360) };
  const boxes = raw.map((box) => orient(box, direction, extent));
  return {
    boxes,
    width: Math.max(640, ...boxes.map((box) => box.x + box.width + PADDING)),
    height: Math.max(360, ...boxes.map((box) => box.y + box.height + PADDING)),
  };
}

function graphComponents(items, relations) {
  const order = new Map(items.map(({ id }, index) => [id, index]));
  const adjacency = new Map(items.map(({ id }) => [id, []]));
  for (const relation of relations) {
    if (relation.from !== relation.to && adjacency.has(relation.from) && adjacency.has(relation.to)) {
      adjacency.get(relation.from).push(relation.to);
    }
  }
  for (const targets of adjacency.values()) targets.sort((left, right) => order.get(left) - order.get(right));
  let nextIndex = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  const visit = (id) => {
    indices.set(id, nextIndex);
    lowLinks.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);
    for (const target of adjacency.get(id)) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(id, Math.min(lowLinks.get(id), lowLinks.get(target)));
      } else if (onStack.has(target)) lowLinks.set(id, Math.min(lowLinks.get(id), indices.get(target)));
    }
    if (lowLinks.get(id) !== indices.get(id)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    component.sort((left, right) => order.get(left) - order.get(right));
    components.push(component);
  };
  for (const { id } of items) if (!indices.has(id)) visit(id);
  return components.sort((left, right) => order.get(left[0]) - order.get(right[0]));
}

function graphRanks(items, relations) {
  const order = new Map(items.map(({ id }, index) => [id, index]));
  const components = graphComponents(items, relations);
  const componentById = new Map();
  components.forEach((component, index) => component.forEach((id) => componentById.set(id, index)));
  const successors = new Map(components.map((_, index) => [index, new Set()]));
  const incoming = new Map(components.map((_, index) => [index, 0]));
  for (const relation of relations) {
    const source = componentById.get(relation.from);
    const target = componentById.get(relation.to);
    if (source === undefined || target === undefined || source === target || successors.get(source).has(target)) continue;
    successors.get(source).add(target);
    incoming.set(target, incoming.get(target) + 1);
  }
  const componentOrder = (index) => Math.min(...components[index].map((id) => order.get(id)));
  const queue = [...incoming].filter(([, count]) => count === 0).map(([index]) => index)
    .sort((left, right) => componentOrder(left) - componentOrder(right));
  const bases = new Map(components.map((_, index) => [index, 0]));
  while (queue.length > 0) {
    const source = queue.shift();
    for (const target of [...successors.get(source)].sort((left, right) => componentOrder(left) - componentOrder(right))) {
      bases.set(target, Math.max(bases.get(target), bases.get(source) + components[source].length));
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) {
        queue.push(target);
        queue.sort((left, right) => componentOrder(left) - componentOrder(right));
      }
    }
  }
  const ranks = new Map();
  components.forEach((component, componentIndex) => {
    component.forEach((id, offset) => ranks.set(id, bases.get(componentIndex) + offset));
  });
  return ranks;
}

// Every strongly connected component occupies one layer per member, so a long
// chain or a large cycle would otherwise stretch the flow axis without bound.
// Bands wrap the layer sequence along the cross axis; the band length balances
// the scene toward a square so it stays inside the viewport budget.
function wrapLayers(layers, primarySize, crossSize, primaryGap) {
  const total = layers.reduce((sum, layer, index) => sum + primarySize(layer) + (index === 0 ? 0 : primaryGap), 0);
  if (total <= BAND_WRAP_EXTENT) return [layers];
  const bandCross = Math.max(0, ...layers.map(crossSize)) + BAND_GAP;
  const target = Math.min(MAX_BAND_EXTENT, Math.max(BAND_WRAP_EXTENT, Math.sqrt(total * bandCross)));
  const bands = [];
  let band = [];
  let extent = 0;
  for (const layer of layers) {
    const size = primarySize(layer);
    if (band.length > 0 && extent + primaryGap + size > target) {
      bands.push(band);
      band = [];
      extent = 0;
    }
    extent += (band.length === 0 ? 0 : primaryGap) + size;
    band.push(layer);
  }
  bands.push(band);
  return bands;
}

function layeredGraphLayout(items, relations, direction, layerGap = ROW_GAP) {
  const horizontal = ['left-right', 'right-left'].includes(direction);
  const ranks = graphRanks(items, relations);
  const layers = new Map();
  for (const item of items) {
    const rank = ranks.get(item.id) ?? 0;
    if (!layers.has(rank)) layers.set(rank, []);
    layers.get(rank).push(createBox(item));
  }
  const orderedLayers = [...layers.entries()].sort(([left], [right]) => left - right).map(([, boxes]) => boxes);
  const layerCrossSize = (boxes) => boxes.reduce((total, box, index) => total + (horizontal ? box.height : box.width)
    + (index === 0 ? 0 : horizontal ? ROW_GAP : COLUMN_GAP), 0);
  const layerPrimarySize = (boxes) => Math.max(0, ...boxes.map((box) => horizontal ? box.width : box.height));
  const primaryGap = layerGap;
  const bands = wrapLayers(orderedLayers, layerPrimarySize, layerCrossSize, primaryGap);
  const raw = [];
  const bandById = new Map();
  let bandStart = PADDING;
  for (const [bandIndex, bandLayers] of bands.entries()) {
    const bandCrossSize = Math.max(0, ...bandLayers.map(layerCrossSize));
    let primary = PADDING;
    for (const boxes of bandLayers) {
      let cross = bandStart + (bandCrossSize - layerCrossSize(boxes)) / 2;
      for (const box of boxes) {
        raw.push({ ...box, x: horizontal ? primary : cross, y: horizontal ? cross : primary });
        bandById.set(box.id, bandIndex);
        cross += (horizontal ? box.height + ROW_GAP : box.width + COLUMN_GAP);
      }
      primary += layerPrimarySize(boxes) + primaryGap;
    }
    bandStart += bandCrossSize + BAND_GAP;
  }
  const rawWidth = Math.max(640, ...raw.map((box) => box.x + box.width + PADDING));
  const rawHeight = Math.max(360, ...raw.map((box) => box.y + box.height + PADDING));
  const boxes = raw.map((box) => direction === 'right-left'
    ? { ...box, x: rawWidth - box.x - box.width }
    : direction === 'bottom-up' ? { ...box, y: rawHeight - box.y - box.height } : box);
  const bounds = bands.map((_, bandIndex) => geometryBounds(boxes.filter((box) => bandById.get(box.id) === bandIndex)));
  return { boxes, width: rawWidth, height: rawHeight, bands: { horizontal, byId: bandById, bounds } };
}

function segmentEntersBox([x1, y1], [x2, y2], box) {
  let low = 0;
  let high = 1;
  for (const [start, delta, minimum, maximum] of [
    [x1, x2 - x1, box.x + 1, box.x + box.width - 1],
    [y1, y2 - y1, box.y + 1, box.y + box.height - 1],
  ]) {
    if (delta === 0) {
      if (start < minimum || start > maximum) return false;
    } else {
      const first = (minimum - start) / delta;
      const last = (maximum - start) / delta;
      low = Math.max(low, Math.min(first, last));
      high = Math.min(high, Math.max(first, last));
      if (low > high) return false;
    }
  }
  return low <= high;
}

function routeHitsBoxes(points, boxes, source, target) {
  const obstacles = boxes.filter((box) => box !== source && box !== target);
  return points.slice(1).some((point, index) => obstacles.some((box) => segmentEntersBox(points[index], point, box)));
}

function rectanglesOverlap(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

function rectangleOverlapsBox(rectangle, boxes) {
  return boxes.some((box) => rectangle.x < box.x + box.width && rectangle.x + rectangle.width > box.x
    && rectangle.y < box.y + box.height && rectangle.y + rectangle.height > box.y);
}

function routeLength(points) {
  return points.slice(1).reduce((total, [x, y], index) => total
    + Math.abs(x - points[index][0]) + Math.abs(y - points[index][1]), 0);
}

/**
 * Each preferred spot centred on its segment, then beside the segment, then the
 * same spots nudged along the flow, so labels that converge on one node stack or
 * step aside instead of forcing a detour route. `across` is the axis
 * perpendicular to the segment the label annotates.
 */
function stacked(placements, across = 'x') {
  const along = across === 'x' ? 'y' : 'x';
  const size = (bounds, axis) => (axis === 'x' ? bounds.width : bounds.height);
  const shift = (bounds, axis, step) => ({ ...bounds, [axis]: bounds[axis] + step });
  const beside = placements.flatMap((bounds) => [
    shift(bounds, across, size(bounds, across) / 2 + LABEL_TARGET_CLEARANCE),
    shift(bounds, across, -(size(bounds, across) / 2 + LABEL_TARGET_CLEARANCE)),
  ]);
  const nudged = [...placements, ...beside].flatMap((bounds) => [
    shift(bounds, along, -(size(bounds, along) + 4)),
    shift(bounds, along, size(bounds, along) + 4),
  ]);
  return [...placements, ...beside, ...nudged];
}

function placeLabel(label, placements, boxes, allocatedLabelBounds) {
  if (!label.lines.length) return placements[0];
  return placements.find((bounds) => labelFits(bounds, boxes, allocatedLabelBounds)) ?? placements[0];
}

function labelFits(bounds, boxes, allocatedLabelBounds) {
  return !rectangleOverlapsBox(bounds, boxes)
    && !allocatedLabelBounds.some((allocated) => rectanglesOverlap(bounds, allocated));
}

function selectRoute(candidates, boxes, source, target, allocatedLabelBounds, label = null) {
  // Candidates are ordered by length before validation so a graph with many
  // relations never validates every lane when the shortest one already fits. A
  // candidate is valid when its path clears every other node and, for a labelled
  // relation, at least one of its label placements is free.
  const labelled = Boolean(label?.lines?.length);
  return [...candidates].sort((left, right) => routeLength(left.points) - routeLength(right.points))
    .find(({ points, placements }) => !routeHitsBoxes(points, boxes, source, target)
      && (!labelled || placements.some((bounds) => labelFits(bounds, boxes, allocatedLabelBounds)))) ?? candidates[0];
}

// The rectangle an edge must clear when leaving or entering a box: the box
// itself, or the frame of every group that contains it.
function boxEnvelopes(document, boxes) {
  const envelopes = new Map(boxes.map((box) => [box.id, { x: box.x, y: box.y, width: box.width, height: box.height, framed: false }]));
  for (const group of document.groups) {
    const members = group.members.map((id) => boxes.find((box) => box.id === id)).filter(Boolean);
    if (members.length === 0) continue;
    const bounds = geometryBounds(members);
    const frame = { x: bounds.x - GROUP_PADDING.side, y: bounds.y - GROUP_PADDING.top,
      width: bounds.width + 2 * GROUP_PADDING.side, height: bounds.height + GROUP_PADDING.top + GROUP_PADDING.bottom };
    for (const member of members) {
      const current = envelopes.get(member.id);
      const x = Math.min(current.x, frame.x);
      const y = Math.min(current.y, frame.y);
      envelopes.set(member.id, { x, y, framed: true, groups: [...(current.groups ?? []), group.id],
        width: Math.max(current.x + current.width, frame.x + frame.width) - x,
        height: Math.max(current.y + current.height, frame.y + frame.height) - y });
    }
  }
  return envelopes;
}

// An edge that stays inside one set of groups routes between the boxes; only an
// edge that crosses a group boundary has to clear the frame and its title band.
function crossesFrame(envelopes, source, target) {
  const groupsOf = (box) => (envelopes.get(box.id)?.groups ?? []).join('\u0000');
  return groupsOf(source) !== groupsOf(target);
}

function graphEdges(document, boxes, bands = null, flowAxis = null) {
  const boxIndex = new Map(boxes.map((box) => [box.id, box]));
  const envelopes = boxEnvelopes(document, boxes);
  const envelope = (box) => envelopes.get(box.id);
  const laneOffset = (layer, framed) => (framed && layer.some((box) => envelope(box)?.framed) ? FRAME_LANE_OFFSET : BOX_LANE_OFFSET);
  const sceneBounds = geometryBounds(boxes);
  const bandOf = (box) => bands?.byId.get(box.id) ?? 0;
  const bandBounds = (box) => bands?.bounds[bandOf(box)] ?? sceneBounds;
  const sameBand = (left, right) => bandOf(left) === bandOf(right);
  const pairs = new Map();
  for (const relation of document.relations) {
    if (!boxIndex.has(relation.from) || !boxIndex.has(relation.to)) continue;
    // Both directions share one allocation so reciprocal messages cannot land
    // on the same lane. Stable source order supplies deterministic lane order.
    const key = JSON.stringify([relation.from, relation.to].sort());
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(relation);
  }
  const byId = new Map();
  const allocatedLabelBounds = [];
  const outgoing = new Map();
  const incoming = new Map();
  for (const relation of document.relations) {
    if (!boxIndex.has(relation.from) || !boxIndex.has(relation.to)) continue;
    outgoing.set(relation.from, (outgoing.get(relation.from) ?? 0) + 1);
    incoming.set(relation.to, (incoming.get(relation.to) ?? 0) + 1);
  }
  const fanOut = (relation) => (outgoing.get(relation.from) ?? 0) > 1;
  const fanIn = (relation) => (incoming.get(relation.to) ?? 0) > 1;
  for (const relations of pairs.values()) {
    const first = boxIndex.get(relations[0].from);
    const second = boxIndex.get(relations[0].to);
    // Bands stack along the cross axis, so a relation between bands leaves
    // through the band gap perpendicular to the flow direction.
    const crossBand = bands !== null && !sameBand(first, second);
    // In a layered layout an edge between two layers follows the flow axis so
    // it enters its target through the port readers expect, even when the
    // boxes are farther apart across the flow than along it. Only edges inside
    // one layer, and grid layouts, fall back to the geometric choice.
    const layeredAcross = flowAxis === 'vertical' ? Math.abs(first.y - second.y) >= 0.5
      : flowAxis === 'horizontal' ? Math.abs(first.x - second.x) >= 0.5 : null;
    const horizontal = crossBand ? !bands.horizontal
      : layeredAcross === true ? flowAxis === 'horizontal'
        : Math.abs(first.x + first.width / 2 - second.x - second.width / 2)
          >= Math.abs(first.y + first.height / 2 - second.y - second.height / 2);
    const gap = horizontal
      ? Math.max(first.x, second.x) - Math.min(first.x + first.width, second.x + second.width)
      : Math.max(first.y, second.y) - Math.min(first.y + first.height, second.y + second.height);
    const labelLimit = first === second ? 24 : horizontal
      ? Math.max(8, Math.min(32, Math.floor((gap - 64) / GRAPH_LABEL_GLYPH_WIDTH))) : 24;
    const labels = relations.map((relation) => {
      const lines = relation.label ? wrapDiagramLabel(relation.label, labelLimit) : [];
      return { lines, width: lines.length ? Math.max(...lines.map((line) => [...line].length)) * GRAPH_LABEL_GLYPH_WIDTH + 24 : 0,
        height: lines.length ? lines.length * 18 + 14 : 0 };
    });
    const spacing = Math.max(48, ...labels.map((label) => (horizontal ? label.height : label.width) + 24));
    for (const [index, relation] of relations.entries()) {
      const source = boxIndex.get(relation.from);
      const target = boxIndex.get(relation.to);
      const label = labels[index];
      const slot = index - (relations.length - 1) / 2;
      const fraction = relations.length > 1 ? slot / relations.length : 0;
      let routePoints;
      let labelX;
      let labelY;
      if (source === target) {
        // Self messages need an actual loop; a zero-length edge has no arrow.
        const y = source.y - 32 - index * spacing;
        const x = source.x + source.width + 40 + index * 24;
        routePoints = [[source.x + source.width, source.y + source.height / 2],
          [x, source.y + source.height / 2], [x, y], [source.x + source.width / 2, y],
          [source.x + source.width / 2, source.y]];
        labelX = (x + source.x + source.width / 2) / 2;
        labelY = y - label.height - 8;
      } else if (horizontal) {
        const sign = source.x < target.x ? 1 : -1;
        const x1 = source.x + (sign > 0 ? source.width : 0);
        const x2 = target.x + (sign > 0 ? 0 : target.width);
        const y1 = source.y + source.height / 2 + fraction * (source.height - 24);
        const y2 = target.y + target.height / 2 + fraction * (target.height - 24);
        const sourceLayer = crossBand ? [bandBounds(source)]
          : boxes.filter((box) => sameBand(box, source) && Math.abs(box.x - source.x) < 0.5);
        const targetLayer = crossBand ? [bandBounds(target)]
          : boxes.filter((box) => sameBand(box, target) && Math.abs(box.x - target.x) < 0.5);
        const framed = !crossBand && crossesFrame(envelopes, source, target);
        const extent = (box) => (framed ? envelope(box) ?? box : box);
        const sourceLane = sign > 0
          ? Math.max(...sourceLayer.map((box) => extent(box).x + extent(box).width)) + laneOffset(sourceLayer, framed)
          : Math.min(...sourceLayer.map((box) => extent(box).x)) - laneOffset(sourceLayer, framed);
        const targetLane = sign > 0
          ? Math.min(...targetLayer.map((box) => extent(box).x)) - laneOffset(targetLayer, framed)
          : Math.max(...targetLayer.map((box) => extent(box).x + extent(box).width)) + laneOffset(targetLayer, framed);
        const middle = (source.y + source.height / 2 + target.y + target.height / 2) / 2 + slot * spacing;
        // Detours prefer the gap around the source band before the scene edge.
        const outer = (bounds) => [bounds.y - 48, bounds.y + bounds.height + label.height + 48];
        const [top, bottom] = outer(crossBand ? sceneBounds : bandBounds(source));
        const [sceneTop, sceneBottom] = outer(sceneBounds);
        const lanes = [...new Set([middle, ...Array.from({ length: allocatedLabelBounds.length + 2 }, (_, laneIndex) => [
          top - laneIndex * spacing,
          bottom + laneIndex * spacing,
          sceneTop - laneIndex * spacing,
          sceneBottom + laneIndex * spacing,
        ]).flat()])];
        const size = { width: label.width, height: label.height };
        const nearTarget = { ...size, y: y2 - label.height - LABEL_TARGET_CLEARANCE,
          x: sign > 0 ? targetLane - label.width - LABEL_TARGET_CLEARANCE : targetLane + LABEL_TARGET_CLEARANCE };
        const onDrop = { ...size, x: (x1 + targetLane) / 2 - label.width / 2, y: y1 - label.height - LABEL_TARGET_CLEARANCE };
        const onApproach = { ...size, x: (sourceLane + x2) / 2 - label.width / 2, y: y2 - label.height - LABEL_TARGET_CLEARANCE };
        const dropFirst = { lane: y1, points: [[x1, y1], [targetLane, y1], [targetLane, y2], [x2, y2]],
          placements: stacked([onDrop, nearTarget], 'y') };
        const acrossFirst = { lane: y2, points: [[x1, y1], [sourceLane, y1], [sourceLane, y2], [x2, y2]],
          placements: stacked([nearTarget, onApproach], 'y') };
        const preferred = fanIn(relation) && !fanOut(relation) ? [dropFirst, acrossFirst] : [acrossFirst, dropFirst];
        const candidates = [...preferred, ...lanes.map((lane) => {
          const points = [[x1, y1], [sourceLane, y1], [sourceLane, lane],
            [targetLane, lane], [targetLane, y2], [x2, y2]];
          const midpoint = { ...size, x: (sourceLane + targetLane) / 2 - label.width / 2, y: lane - label.height - 8 };
          return { lane, points, placements: stacked([nearTarget, midpoint], 'y') };
        })];
        const candidate = selectRoute(candidates, boxes, source, target, allocatedLabelBounds, label);
        routePoints = candidate.points;
        const placement = placeLabel(label, candidate.placements, boxes, allocatedLabelBounds);
        labelX = placement.x + label.width / 2;
        labelY = placement.y;
      } else {
        const sign = source.y < target.y ? 1 : -1;
        const x1 = source.x + source.width / 2 + fraction * (source.width - 24);
        const x2 = target.x + target.width / 2 + fraction * (target.width - 24);
        const y1 = source.y + (sign > 0 ? source.height : 0);
        const y2 = target.y + (sign > 0 ? 0 : target.height);
        const sourceLayer = crossBand ? [bandBounds(source)]
          : boxes.filter((box) => sameBand(box, source) && Math.abs(box.y - source.y) < 0.5);
        const targetLayer = crossBand ? [bandBounds(target)]
          : boxes.filter((box) => sameBand(box, target) && Math.abs(box.y - target.y) < 0.5);
        const framed = !crossBand && crossesFrame(envelopes, source, target);
        const extent = (box) => (framed ? envelope(box) ?? box : box);
        const sourceLane = sign > 0
          ? Math.max(...sourceLayer.map((box) => extent(box).y + extent(box).height)) + laneOffset(sourceLayer, framed)
          : Math.min(...sourceLayer.map((box) => extent(box).y)) - laneOffset(sourceLayer, framed);
        const targetLane = sign > 0
          ? Math.min(...targetLayer.map((box) => extent(box).y)) - laneOffset(targetLayer, framed)
          : Math.max(...targetLayer.map((box) => extent(box).y + extent(box).height)) + laneOffset(targetLayer, framed);
        const middle = (source.x + source.width / 2 + target.x + target.width / 2) / 2 + slot * spacing;
        const outer = (bounds) => [bounds.x - label.width / 2 - 48, bounds.x + bounds.width + label.width / 2 + 48];
        const [left, right] = outer(crossBand ? sceneBounds : bandBounds(source));
        const [sceneLeft, sceneRight] = outer(sceneBounds);
        const lanes = [...new Set([middle, ...Array.from({ length: allocatedLabelBounds.length + 2 }, (_, laneIndex) => [
          left - laneIndex * spacing,
          right + laneIndex * spacing,
          sceneLeft - laneIndex * spacing,
          sceneRight + laneIndex * spacing,
        ]).flat()])];
        // One turn beats two. A fan-in merges at the target lane so each source
        // keeps its own drop; a fan-out splits at the source lane so each target
        // keeps its own approach. The label goes on the segment that is unique to
        // this relation, which is what makes a fan read unambiguously.
        const size = { width: label.width, height: label.height };
        const nearTarget = { ...size, x: x2 - label.width / 2,
          y: sign > 0 ? targetLane - label.height - LABEL_TARGET_CLEARANCE : targetLane + LABEL_TARGET_CLEARANCE };
        const onDrop = { ...size, x: x1 - label.width / 2, y: (y1 + targetLane) / 2 - label.height / 2 };
        const onApproach = { ...size, x: x2 - label.width / 2, y: (sourceLane + y2) / 2 - label.height / 2 };
        const dropFirst = { lane: x1, points: [[x1, y1], [x1, targetLane], [x2, targetLane], [x2, y2]],
          placements: stacked([onDrop, nearTarget]) };
        const acrossFirst = { lane: x2, points: [[x1, y1], [x1, sourceLane], [x2, sourceLane], [x2, y2]],
          placements: stacked([nearTarget, onApproach]) };
        const preferred = fanIn(relation) && !fanOut(relation) ? [dropFirst, acrossFirst] : [acrossFirst, dropFirst];
        const candidates = [...preferred, ...lanes.map((lane) => {
          const points = [[x1, y1], [x1, sourceLane], [lane, sourceLane],
            [lane, targetLane], [x2, targetLane], [x2, y2]];
          const midpoint = { ...size, x: lane - label.width / 2, y: (sourceLane + targetLane) / 2 - label.height / 2 };
          return { lane, points, placements: stacked([nearTarget, midpoint]) };
        })];
        const candidate = selectRoute(candidates, boxes, source, target, allocatedLabelBounds, label);
        routePoints = candidate.points;
        const placement = placeLabel(label, candidate.placements, boxes, allocatedLabelBounds);
        labelX = placement.x + label.width / 2;
        labelY = placement.y;
      }
      routePoints = routePoints.filter(([x, y], pointIndex) => pointIndex === 0
        || x !== routePoints[pointIndex - 1][0] || y !== routePoints[pointIndex - 1][1]);
      const [[x1, y1]] = routePoints;
      const [x2, y2] = routePoints.at(-1);
      const labelBounds = label.lines.length ? { id: relation.id, x: labelX - label.width / 2, y: labelY,
        width: label.width, height: label.height } : null;
      if (labelBounds) allocatedLabelBounds.push(labelBounds);
      byId.set(relation.id, { ...relation, x1, y1, x2, y2, routePoints, labelLines: label.lines,
        emphasis: document.emphasis.find(({ targetId }) => targetId === relation.id)?.level ?? null,
        labelBounds });
    }
  }
  return document.relations.flatMap((relation) => byId.has(relation.id) ? [byId.get(relation.id)] : []);
}

function geometryBounds(entries) {
  if (entries.length === 0) return null;
  const left = Math.min(...entries.map(({ x }) => x));
  const top = Math.min(...entries.map(({ y }) => y));
  const right = Math.max(...entries.map(({ x, width }) => x + width));
  const bottom = Math.max(...entries.map(({ y, height }) => y + height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function edgeBounds(edge) {
  const points = edge.routePoints ?? [[edge.x1, edge.y1], [edge.x2, edge.y2]];
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const route = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
  };
  return geometryBounds([route, ...(edge.labelBounds ? [edge.labelBounds] : [])]);
}

function graphGroups(document, boxes, edges) {
  const geometry = new Map(boxes.map((box) => [box.id, box]));
  for (const edge of edges) geometry.set(edge.id, edgeBounds(edge));
  const byId = new Map();
  const pending = new Set(document.groups.map(({ id }) => id));
  for (let pass = 0; pass < document.groups.length && pending.size > 0; pass += 1) {
    for (const group of document.groups) {
      if (!pending.has(group.id)) continue;
      const members = group.members.map((id) => geometry.get(id));
      if (members.some((member) => !member)) continue;
      const bounds = geometryBounds(members);
      const rendered = {
        ...group,
        x: bounds.x - GROUP_PADDING.side,
        y: bounds.y - GROUP_PADDING.top,
        width: bounds.width + 2 * GROUP_PADDING.side,
        height: bounds.height + GROUP_PADDING.top + GROUP_PADDING.bottom,
        emphasis: document.emphasis.find(({ targetId }) => targetId === group.id)?.level ?? null,
      };
      byId.set(group.id, rendered);
      geometry.set(group.id, rendered);
      pending.delete(group.id);
    }
  }
  return document.groups.flatMap(({ id }) => byId.has(id) ? [byId.get(id)] : [])
    .sort((left, right) => right.width * right.height - left.width * left.height);
}

function graphNotes(document, boxes, edges, groups) {
  if (document.annotations.length === 0) return [];
  const geometry = new Map([...boxes, ...groups].map((item) => [item.id, item]));
  for (const edge of edges) geometry.set(edge.id, edgeBounds(edge));
  const right = Math.max(PADDING, ...Array.from(geometry.values(), ({ x, width }) => x + width));
  let y = PADDING;
  return document.annotations.map((annotation) => {
    const lines = wrapDiagramLabel(annotation.text, 42);
    const width = 340;
    const height = lines.length * SEQUENCE_MESSAGE_LINE_HEIGHT + 28;
    const target = annotation.targetId ? geometry.get(annotation.targetId) : null;
    const note = {
      id: annotation.id,
      targetId: annotation.targetId,
      lines,
      x: right + 64,
      y,
      width,
      height,
      anchorX: target ? target.x + target.width : null,
      anchorY: target ? target.y + target.height / 2 : null,
      emphasis: document.emphasis.find(({ targetId }) => targetId === annotation.id)?.level ?? null,
    };
    y += height + 16;
    return note;
  });
}

function sequenceTimeline(document) {
  const events = new Map(document.events.map((event) => [event.id, event]));
  const relations = new Map(document.relations.map((relation) => [relation.id, relation]));
  const readingOrder = document.accessibility.readingOrder.filter((id) => events.has(id) || relations.has(id));
  const hasOrderedRelations = readingOrder.some((id) => relations.has(id));
  const timeline = [];
  const seen = new Set();
  if (hasOrderedRelations) {
    for (const id of readingOrder) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (events.has(id)) timeline.push({ type: 'phase', value: events.get(id) });
      else if (relations.has(id)) timeline.push({ type: 'message', value: relations.get(id) });
    }
  } else {
    const orderedEvents = [...document.events].sort((left, right) => left.order - right.order);
    for (const [index, relation] of document.relations.entries()) {
      const event = orderedEvents[index];
      if (event && !seen.has(event.id)) {
        seen.add(event.id);
        timeline.push({ type: 'phase', value: event });
      }
      seen.add(relation.id);
      timeline.push({ type: 'message', value: relation });
    }
  }
  for (const event of [...document.events].sort((left, right) => left.order - right.order)) {
    if (!seen.has(event.id)) timeline.push({ type: 'phase', value: event });
  }
  for (const relation of document.relations) {
    if (!seen.has(relation.id)) timeline.push({ type: 'message', value: relation });
  }
  return timeline;
}

function sequenceLayout(document) {
  const reversed = ['right-left', 'bottom-up'].includes(document.layout.direction);
  const participants = reversed ? [...document.nodes].reverse() : [...document.nodes];
  const participantLines = participants.map((participant) => wrapDiagramLabel(participant.label, 24));
  const participantHeight = Math.max(88, ...participantLines.map((lines) => lines.length * LINE_HEIGHT + 36));
  const participantStart = PADDING + SEQUENCE_PHASE_RAIL;
  const participantSpan = SEQUENCE_PARTICIPANT_WIDTH + SEQUENCE_PARTICIPANT_GAP;
  const boxes = participants.map((participant, index) => ({
    id: participant.id,
    kind: participant.kind,
    label: participant.label,
    description: participant.description ?? null,
    lines: participantLines[index],
    x: participantStart + index * participantSpan,
    y: PADDING,
    width: SEQUENCE_PARTICIPANT_WIDTH,
    height: participantHeight,
    emphasis: document.emphasis.find(({ targetId }) => targetId === participant.id)?.level ?? null,
  }));
  const boxIndex = new Map(boxes.map((box) => [box.id, box]));
  const phaseEnd = boxes.at(-1).x + boxes.at(-1).width;
  const annotations = new Map();
  for (const annotation of document.annotations) {
    annotations.set(annotation.targetId, [...(annotations.get(annotation.targetId) ?? []), annotation]);
  }
  const phases = [];
  const edges = [];
  const notes = [];
  const labelBounds = [];
  let y = PADDING + participantHeight + 72;
  for (const entry of sequenceTimeline(document)) {
    if (entry.type === 'phase') {
      phases.push({
        id: entry.value.id,
        label: entry.value.label,
        x1: PADDING,
        x2: phaseEnd,
        y,
      });
      y += 52;
      continue;
    }
    const relation = entry.value;
    const source = boxIndex.get(relation.from);
    const target = boxIndex.get(relation.to);
    if (!source || !target) continue;
    const x1 = source.x + source.width / 2;
    const x2 = target.x + target.width / 2;
    const maximum = Math.max(18, Math.min(46, Math.floor(Math.max(220, Math.abs(x2 - x1)) / 8)));
    const labelLines = relation.label ? wrapDiagramLabel(relation.label, maximum) : [];
    const labelWidth = labelLines.length === 0
      ? 0
      : Math.min(Math.max(120, Math.max(...labelLines.map((line) => [...line].length)) * 7.5 + 28), Math.max(220, Math.abs(x2 - x1) - 24));
    const labelHeight = labelLines.length * SEQUENCE_MESSAGE_LINE_HEIGHT + (labelLines.length > 0 ? 14 : 0);
    const messageY = y + labelHeight + 10;
    const labelBoundsValue = labelLines.length > 0 ? {
      id: relation.id,
      x: (x1 + x2) / 2 - labelWidth / 2,
      y,
      width: labelWidth,
      height: labelHeight,
    } : null;
    const emphasis = document.emphasis.find(({ targetId }) => targetId === relation.id)?.level ?? null;
    edges.push({
      ...relation,
      x1,
      y1: messageY,
      x2,
      y2: messageY,
      labelLines,
      labelBounds: labelBoundsValue,
      emphasis,
    });
    if (labelBoundsValue) labelBounds.push(labelBoundsValue);
    const relationNotes = annotations.get(relation.id) ?? [];
    let noteY = messageY + 18;
    for (const annotation of relationNotes) {
      const lines = wrapDiagramLabel(annotation.text, 48);
      const width = 360;
      const height = lines.length * SEQUENCE_MESSAGE_LINE_HEIGHT + 28;
      notes.push({
        id: annotation.id,
        targetId: relation.id,
        lines,
        x: phaseEnd + 48,
        y: noteY,
        width,
        height,
        emphasis: document.emphasis.find(({ targetId }) => targetId === annotation.id)?.level ?? null,
      });
      noteY += height + 12;
    }
    y = Math.max(messageY + SEQUENCE_MESSAGE_GAP, noteY + 12);
  }
  for (const annotation of document.annotations.filter(({ targetId }) => boxIndex.has(targetId))) {
    const lines = wrapDiagramLabel(annotation.text, 48);
    const width = 360;
    const height = lines.length * SEQUENCE_MESSAGE_LINE_HEIGHT + 28;
    notes.push({ id: annotation.id, targetId: annotation.targetId, lines, x: phaseEnd + 48, y, width, height,
      emphasis: document.emphasis.find(({ targetId }) => targetId === annotation.id)?.level ?? null });
    y += height + 12;
  }
  const notesWidth = notes.length > 0 ? 456 : PADDING;
  const height = Math.max(480, y + PADDING);
  const lifelines = boxes.map((box) => ({
    id: box.id,
    x: box.x + box.width / 2,
    y1: box.y + box.height,
    y2: height - PADDING,
  }));
  return {
    kind: 'sequence',
    width: Math.ceil(phaseEnd + notesWidth),
    height: Math.ceil(height),
    boxes,
    edges,
    phases,
    lifelines,
    notes,
    groups: [],
    lanes: [],
    axes: [],
    labelBounds,
  };
}

// Viewers and the rasterizer reject larger viewports, so an oversized scene
// fails here with a repair instead of producing unusable artifacts.
function assertSceneExtent(width, height) {
  if (width <= MAX_DIAGRAM_SCENE_EXTENT && height <= MAX_DIAGRAM_SCENE_EXTENT) return;
  diagramFail(DIAGRAM_ERROR_CODES.RESOURCE_BUDGET_EXCEEDED, 'Diagram layout exceeds the renderer viewport budget.', {
    width,
    height,
    maximum: MAX_DIAGRAM_SCENE_EXTENT,
    repair: 'Split the source into multiple named diagrams before rendering.',
  });
}

export function layoutDiagram(document) {
  if (document.grammar.id === 'sequence') {
    const scene = sequenceLayout(document);
    assertSceneExtent(scene.width, scene.height);
    return Object.freeze({
      ...scene,
      boxes: Object.freeze(scene.boxes.map(Object.freeze)),
      edges: Object.freeze(scene.edges.map(Object.freeze)),
      phases: Object.freeze(scene.phases.map(Object.freeze)),
      lifelines: Object.freeze(scene.lifelines.map(Object.freeze)),
      notes: Object.freeze(scene.notes.map(Object.freeze)),
      labelBounds: Object.freeze(scene.labelBounds.map(Object.freeze)),
    });
  }
  const items = semanticItems(document);
  if (items.length === 0) {
    diagramFail(DIAGRAM_ERROR_CODES.RENDER_FAILED, 'The diagram has no renderable semantic items.', {
      repair: 'Add a node, event, series, or set before rendering.',
    });
  }
  const useLayeredGraph = document.nodes.length === items.length
    && document.relations.length > 0
    && document.layout.direction !== 'radial';
  const layout = useLayeredGraph
    ? layeredGraphLayout(items, document.relations, document.layout.direction,
      document.groups.length > 0 ? GROUPED_LAYER_GAP : ['left-right', 'right-left'].includes(document.layout.direction) ? COLUMN_GAP : ROW_GAP)
    : gridLayout(items, document.layout.direction);
  for (const box of layout.boxes) {
    box.emphasis = document.emphasis.find(({ targetId }) => targetId === box.id)?.level ?? null;
  }
  const flowAxis = !useLayeredGraph ? null
    : ['left-right', 'right-left'].includes(document.layout.direction) ? 'horizontal' : 'vertical';
  const edges = graphEdges(document, layout.boxes, layout.bands ?? null, flowAxis);
  const groups = graphGroups(document, layout.boxes, edges);
  const notes = graphNotes(document, layout.boxes, edges, groups);
  const labelBounds = edges.flatMap((edge) => edge.labelBounds ? [edge.labelBounds] : []);
  const points = edges.flatMap((edge) => edge.routePoints);
  const rectangles = [...layout.boxes, ...groups, ...notes, ...labelBounds];
  // Lanes may extend above or left of the original grid. Translate the scene
  // once, including labels, then size the viewport from the routed geometry.
  const dx = Math.max(0, PADDING - Math.min(...rectangles.map(({ x }) => x), ...points.map(([x]) => x)));
  const dy = Math.max(0, PADDING - Math.min(...rectangles.map(({ y }) => y), ...points.map(([, y]) => y)));
  const width = Math.max(layout.width, ...rectangles.map((rect) => rect.x + rect.width + PADDING), ...points.map(([x]) => x + PADDING)) + dx;
  const height = Math.max(layout.height, ...rectangles.map((rect) => rect.y + rect.height + PADDING), ...points.map(([, y]) => y + PADDING)) + dy;
  for (const rect of rectangles) { rect.x += dx; rect.y += dy; }
  for (const edge of edges) {
    edge.x1 += dx; edge.y1 += dy; edge.x2 += dx; edge.y2 += dy;
    edge.routePoints = Object.freeze(edge.routePoints.map(([x, y]) => Object.freeze([x + dx, y + dy])));
  }
  for (const note of notes) {
    if (Number.isFinite(note.anchorX)) note.anchorX += dx;
    if (Number.isFinite(note.anchorY)) note.anchorY += dy;
  }
  assertSceneExtent(Math.ceil(width), Math.ceil(height));
  return Object.freeze({
    kind: 'graph',
    width: Math.ceil(width),
    height: Math.ceil(height),
    boxes: Object.freeze(layout.boxes.map(Object.freeze)),
    edges: Object.freeze(edges.map(Object.freeze)),
    groups: Object.freeze(groups.map(Object.freeze)),
    lanes: Object.freeze([]),
    axes: Object.freeze([]),
    phases: Object.freeze([]),
    lifelines: Object.freeze([]),
    notes: Object.freeze(notes.map(Object.freeze)),
    labelBounds: Object.freeze(labelBounds.map(Object.freeze)),
  });
}
