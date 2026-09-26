import { DIAGRAM_ERROR_CODES, diagramFail } from '../errors.mjs';
import {
  diagramMetrics,
  MAX_DIAGRAM_SCENE_EXTENT,
  MAX_VISIBLE_LABEL_CHARACTERS,
  RASTER_SCALE,
  resolveDiagramTheme,
} from './theme.mjs';

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
const MAX_NODE_WIDTH = 420;
const CHARACTERS_PER_LINE = 32;
// A single word up to this length is kept whole even when it exceeds the
// per-line budget; "describes" must never render as "describe" + "s".
const UNBREAKABLE_WORD_LENGTH = 20;
// Relation labels prefer the approach to their target so a fan-out from one
// source reads unambiguously; this is the clearance kept from the arrowhead.
const LABEL_TARGET_CLEARANCE = 6;
// A lane band carries its title above its members: in the band's leading cross
// strip when lanes are rows, and in a flow-axis head strip when they are columns.
const LANE_PADDING = Object.freeze({ title: 40, edge: 26 });
const LANE_GAP = 20;
const LANE_SLOT_GAP = 112;
const LANE_STACK_GAP = 34;
const SEQUENCE_MESSAGE_LINE_HEIGHT = 18;
// Connectors whose ports differ by less than this across the flow are drawn
// straight; the jog would read as a kink rather than a turn.
const STRAIGHTEN_TOLERANCE = 12;
// Distance a feedback connector keeps outside everything it runs beside.
const FEEDBACK_CLEARANCE = 40;
const FEEDBACK_LABEL_LIMIT = 32;

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
    diagramFail(
      DIAGRAM_ERROR_CODES.RESOURCE_BUDGET_EXCEEDED,
      'Diagram label exceeds the renderer text budget.',
      {
        characters: value.length,
        maximum: MAX_VISIBLE_LABEL_CHARACTERS,
        repair: 'Shorten the label or move supporting detail into the item description.',
      },
    );
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
        for (let offset = 0; offset < word.length; offset += maximum)
          lines.push(word.slice(offset, offset + maximum));
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

/** Wrapped node lines; a hierarchy theme sets the first paragraph apart as the title. */
function nodeLines(
  label,
  metrics,
  titleWrap = metrics.node.titleWrap,
  subtitleWrap = metrics.node.subtitleWrap,
) {
  // Wrapping the whole label first enforces the text budget on the label as a whole.
  const lines = wrapDiagramLabel(label, titleWrap);
  if (!metrics.hierarchy) return { lines, titleLines: null };
  const [title, ...detail] = String(label).normalize('NFC').split(/\r?\n/u);
  const titleLines = wrapDiagramLabel(title, titleWrap);
  return {
    lines: [
      ...titleLines,
      ...(detail.length > 0 ? wrapDiagramLabel(detail.join('\n'), subtitleWrap) : []),
    ],
    titleLines: titleLines.length,
  };
}

const lineStyle = (metrics, titleLines, index) =>
  index < (titleLines ?? Number.POSITIVE_INFINITY) ? metrics.title : metrics.subtitle;

function textHeight(lines, titleLines, metrics) {
  return lines.reduce(
    (total, _, index) => total + lineStyle(metrics, titleLines, index).lineHeight,
    0,
  );
}

/** The narrowest wrap that keeps the line count of `maximum`, so no line ends as an orphan. */
function balancedLines(label, maximum) {
  const lines = wrapDiagramLabel(label, maximum);
  let best = lines;
  for (let width = maximum - 1; width > 0 && lines.length > 1; width -= 1) {
    const next = wrapDiagramLabel(label, width);
    if (next.length > lines.length) break;
    best = next;
  }
  return best;
}

function dimensions(lines, titleLines, metrics) {
  const { node } = metrics;
  const widest = Math.max(
    metrics.title.glyph,
    ...lines.map((line, index) => [...line].length * lineStyle(metrics, titleLines, index).glyph),
  );
  return {
    width: Math.max(node.minWidth, Math.min(node.maxWidth, widest + 2 * node.paddingX)),
    height: Math.max(node.minHeight, textHeight(lines, titleLines, metrics) + 2 * node.paddingY),
  };
}

function orient(box, direction, extent) {
  if (direction === 'left-right') return box;
  if (direction === 'right-left') return { ...box, x: extent.width - box.x - box.width };
  if (direction === 'bottom-up') return { ...box, x: box.y, y: extent.width - box.x - box.width };
  if (direction === 'radial') return box;
  return { ...box, x: box.y, y: box.x };
}

function createBox(item, metrics) {
  const { lines, titleLines } = nodeLines(item.label, metrics);
  return {
    id: item.id,
    kind: item.kind,
    label: item.label,
    description: item.description ?? null,
    lines,
    ...(titleLines === null ? {} : { titleLines }),
    x: 0,
    y: 0,
    ...dimensions(lines, titleLines, metrics),
  };
}

function gridLayout(items, direction, metrics) {
  const horizontal = ['left-right', 'right-left'].includes(direction);
  const columns = horizontal
    ? Math.min(6, Math.max(1, items.length))
    : Math.min(3, Math.max(1, items.length));
  const sized = items.map((item) => createBox(item, metrics));
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

/**
 * Longest-path layers. A depth-first walk in document order marks each relation
 * that closes a cycle as feedback; feedback does not rank, so a loop back to an
 * earlier node leaves the rest of the graph layered by its forward flow.
 */
function graphRanks(items, relations) {
  const order = new Map(items.map(({ id }, index) => [id, index]));
  const outgoing = new Map(items.map(({ id }) => [id, []]));
  for (const relation of relations) {
    if (relation.from !== relation.to && order.has(relation.from) && order.has(relation.to))
      outgoing.get(relation.from).push(relation);
  }
  for (const list of outgoing.values())
    list.sort((left, right) => order.get(left.to) - order.get(right.to));
  const feedback = new Set();
  const state = new Map();
  const visit = (id) => {
    state.set(id, 'open');
    for (const relation of outgoing.get(id)) {
      const target = state.get(relation.to);
      if (target === 'open') feedback.add(relation.id);
      else if (target === undefined) visit(relation.to);
    }
    state.set(id, 'closed');
  };
  for (const { id } of items) if (!state.has(id)) visit(id);
  const incoming = new Map(items.map(({ id }) => [id, 0]));
  for (const list of outgoing.values())
    for (const relation of list)
      if (!feedback.has(relation.id)) incoming.set(relation.to, incoming.get(relation.to) + 1);
  const ranks = new Map(items.map(({ id }) => [id, 0]));
  const queue = items.filter(({ id }) => incoming.get(id) === 0).map(({ id }) => id);
  while (queue.length > 0) {
    const source = queue.shift();
    for (const relation of outgoing.get(source)) {
      if (feedback.has(relation.id)) continue;
      ranks.set(relation.to, Math.max(ranks.get(relation.to), ranks.get(source) + 1));
      incoming.set(relation.to, incoming.get(relation.to) - 1);
      if (incoming.get(relation.to) === 0) queue.push(relation.to);
    }
  }
  return { ranks, feedback };
}

// A long chain or a large ring takes one layer per node, so it would otherwise
// stretch the flow axis without bound.
// Bands wrap the layer sequence along the cross axis; the band length balances
// the scene toward a square so it stays inside the viewport budget.
function wrapLayers(layers, primarySize, crossSize, primaryGap) {
  const total = layers.reduce(
    (sum, layer, index) => sum + primarySize(layer) + (index === 0 ? 0 : primaryGap),
    0,
  );
  if (total <= BAND_WRAP_EXTENT) return [layers];
  const bandCross = Math.max(0, ...layers.map(crossSize)) + BAND_GAP;
  const target = Math.min(
    MAX_BAND_EXTENT,
    Math.max(BAND_WRAP_EXTENT, Math.sqrt(total * bandCross)),
  );
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

/**
 * Moves each block of adjacent boxes that share an anchor so the block is
 * centred on it, keeping order and gap; overlapping blocks settle together at
 * the mean of their wanted positions. Returns whether anything moved.
 */
function settleLayer(layer, anchorOf, { cross, size, gap }) {
  const blocks = [];
  for (const box of layer) {
    const anchor = anchorOf(box);
    const last = blocks.at(-1);
    if (anchor !== null && last?.anchor === anchor) last.members.push(box);
    else blocks.push({ anchor, members: [box] });
  }
  for (const block of blocks) {
    block.extent = block.members.reduce(
      (total, box, index) => total + box[size] + (index === 0 ? 0 : gap),
      0,
    );
    block.desired =
      block.anchor === null
        ? block.members[0][cross]
        : block.anchor[cross] + block.anchor[size] / 2 - block.extent / 2;
  }
  if (blocks.every(({ desired, members }) => Math.abs(desired - members[0][cross]) <= 1e-6))
    return false;
  const clusters = [];
  for (const block of blocks) {
    let cluster = { members: block.members, extent: block.extent, sum: block.desired, count: 1 };
    while (clusters.length > 0) {
      const previous = clusters.at(-1);
      if (previous.sum / previous.count + previous.extent + gap <= cluster.sum / cluster.count)
        break;
      clusters.pop();
      const offset = previous.extent + gap;
      cluster = {
        members: [...previous.members, ...cluster.members],
        extent: offset + cluster.extent,
        sum: previous.sum + cluster.sum - cluster.count * offset,
        count: previous.count + cluster.count,
      };
    }
    clusters.push(cluster);
  }
  for (const cluster of clusters) {
    let position = cluster.sum / cluster.count;
    for (const box of cluster.members) {
      box[cross] = position;
      position += box[size] + gap;
    }
  }
  return true;
}

/**
 * Straightens the chains of a vertical flow. Downward, siblings that share their
 * only predecessor are centred on it; upward, a node linked one-to-one with its
 * successor is centred over it, which absorbs a successor layer wider than its
 * own. Feedback and self relations do not anchor.
 */
function alignLayers(layers, relations, feedback, gap) {
  const geometry = { cross: 'x', size: 'width', gap };
  const layerOf = new Map(layers.flatMap((layer, index) => layer.map((box) => [box.id, index])));
  const boxById = new Map(layers.flat().map((box) => [box.id, box]));
  const predecessors = new Map();
  const successors = new Map();
  for (const relation of relations) {
    if (relation.from === relation.to || feedback.has(relation.id)) continue;
    if (!layerOf.has(relation.from) || !layerOf.has(relation.to)) continue;
    if (layerOf.get(relation.from) >= layerOf.get(relation.to)) continue;
    if (!predecessors.has(relation.to)) predecessors.set(relation.to, new Set());
    if (!successors.has(relation.from)) successors.set(relation.from, new Set());
    predecessors.get(relation.to).add(relation.from);
    successors.get(relation.from).add(relation.to);
  }
  const only = (set) => (set?.size === 1 ? [...set][0] : null);
  const parentOf = (box) => {
    const id = only(predecessors.get(box.id));
    return id === null ? null : boxById.get(id);
  };
  const childOf = (box) => {
    const id = only(successors.get(box.id));
    return id !== null && only(predecessors.get(id)) === box.id ? boxById.get(id) : null;
  };
  let moved = false;
  for (let index = 1; index < layers.length; index += 1)
    moved = settleLayer(layers[index], parentOf, geometry) || moved;
  for (let index = layers.length - 2; index >= 0; index -= 1)
    moved = settleLayer(layers[index], childOf, geometry) || moved;
  return moved;
}

function layeredGraphLayout(items, relations, direction, layerGap, metrics) {
  const horizontal = ['left-right', 'right-left'].includes(direction);
  const { ranks, feedback } = graphRanks(items, relations);
  const layers = new Map();
  for (const item of items) {
    const rank = ranks.get(item.id) ?? 0;
    if (!layers.has(rank)) layers.set(rank, []);
    layers.get(rank).push(createBox(item, metrics));
  }
  const orderedLayers = [...layers.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, boxes]) => boxes);
  const siblingGap = metrics.siblingGap;
  const layerCrossSize = (boxes) =>
    boxes.reduce(
      (total, box, index) =>
        total + (horizontal ? box.height : box.width) + (index === 0 ? 0 : siblingGap),
      0,
    );
  const layerPrimarySize = (boxes) =>
    Math.max(0, ...boxes.map((box) => (horizontal ? box.width : box.height)));
  const primaryGap = layerGap;
  const bands = wrapLayers(orderedLayers, layerPrimarySize, layerCrossSize, primaryGap);
  const raw = [];
  const bandById = new Map();
  let bandStart = PADDING;
  for (const [bandIndex, bandLayers] of bands.entries()) {
    const bandCrossSize = Math.max(0, ...bandLayers.map(layerCrossSize));
    const placedLayers = [];
    let primary = PADDING;
    for (const boxes of bandLayers) {
      let cross = bandStart + (bandCrossSize - layerCrossSize(boxes)) / 2;
      const placedLayer = [];
      for (const box of boxes) {
        const placed = { ...box, x: horizontal ? primary : cross, y: horizontal ? cross : primary };
        raw.push(placed);
        placedLayer.push(placed);
        bandById.set(box.id, bandIndex);
        cross += (horizontal ? box.height : box.width) + siblingGap;
      }
      placedLayers.push(placedLayer);
      primary += layerPrimarySize(boxes) + primaryGap;
    }
    // A horizontal flow keeps centred layers: its labels sit above a horizontal
    // run, and an aligned pair leaves no room beside the boxes for a long one.
    if (!horizontal && alignLayers(placedLayers, relations, feedback, siblingGap)) {
      const members = placedLayers.flat();
      const shift = bandStart - Math.min(...members.map(({ x }) => x));
      for (const box of members) box.x += shift;
      bandStart = Math.max(...members.map(({ x, width }) => x + width)) + BAND_GAP;
    } else bandStart += bandCrossSize + BAND_GAP;
  }
  const rawWidth = Math.max(640, ...raw.map((box) => box.x + box.width + PADDING));
  const rawHeight = Math.max(360, ...raw.map((box) => box.y + box.height + PADDING));
  const boxes = raw.map((box) =>
    direction === 'right-left'
      ? { ...box, x: rawWidth - box.x - box.width }
      : direction === 'bottom-up'
        ? { ...box, y: rawHeight - box.y - box.height }
        : box,
  );
  const bounds = bands.map((_, bandIndex) =>
    geometryBounds(boxes.filter((box) => bandById.get(box.id) === bandIndex)),
  );
  return {
    boxes,
    width: rawWidth,
    height: rawHeight,
    bands: { horizontal, byId: bandById, bounds },
    feedback,
  };
}

// Lanes are bands perpendicular to the flow axis: columns under a top-down flow,
// rows beside a left-right flow. A node's position along the flow axis is its
// relation rank, so a handoff between lanes lines up across them; without
// relations the declared member order decides it.
function laneLayout(document, metrics) {
  const direction = document.layout.direction;
  const horizontalFlow = ['left-right', 'right-left'].includes(direction);
  const reversed = ['right-left', 'bottom-up'].includes(direction);
  const flowSize = (box) => (horizontalFlow ? box.width : box.height);
  const crossSize = (box) => (horizontalFlow ? box.height : box.width);
  const boxes = document.nodes.map((item) => createBox(item, metrics));
  const byId = new Map(boxes.map((box) => [box.id, box]));
  const laneOf = new Map();
  for (const [index, lane] of document.lanes.entries()) {
    for (const member of lane.members ?? []) if (byId.has(member)) laneOf.set(member, index);
  }
  // Nodes outside every lane occupy a trailing strip that carries no band.
  const strips = document.lanes.map(() => []);
  const unassigned = [];
  for (const box of boxes) {
    const index = laneOf.get(box.id);
    if (index === undefined) unassigned.push(box);
    else strips[index].push(box);
  }
  const ranks =
    document.relations.length > 0 ? graphRanks(document.nodes, document.relations).ranks : null;
  const slotOf = (box, strip) => (ranks ? (ranks.get(box.id) ?? 0) : strip.indexOf(box));
  const allStrips = [...strips, unassigned];
  const slots = [
    ...new Set(allStrips.flatMap((strip) => strip.map((box) => slotOf(box, strip)))),
  ].sort((left, right) => left - right);
  const slotIndex = new Map(slots.map((slot, index) => [slot, index]));
  const cell = (strip, slot) => strip.filter((box) => slotOf(box, strip) === slot);

  const slotFlow = slots.map((slot) =>
    Math.max(0, ...allStrips.flatMap((strip) => cell(strip, slot).map(flowSize))),
  );
  const stripCross = allStrips.map((strip) =>
    Math.max(
      0,
      ...slots.map((slot) => {
        const members = cell(strip, slot);
        return members.reduce(
          (total, box, index) => total + crossSize(box) + (index === 0 ? 0 : LANE_STACK_GAP),
          0,
        );
      }),
    ),
  );

  // Columns carry their title at the top, which is the flow head; rows carry it
  // in the strip above their members, which is the leading cross edge.
  const flowHead = horizontalFlow ? LANE_PADDING.edge : LANE_PADDING.title;
  const crossHead = horizontalFlow ? LANE_PADDING.title : LANE_PADDING.edge;
  // The slot gap exists to hold a relation label between consecutive steps, so a
  // board with no relations packs its members instead.
  const slotGap = document.relations.length > 0 ? LANE_SLOT_GAP : LANE_STACK_GAP;
  const flowStart = PADDING + flowHead;
  const slotFlowStart = [];
  let flow = flowStart;
  for (const [index, size] of slotFlow.entries()) {
    slotFlowStart[index] = flow;
    flow += size + slotGap;
  }
  const flowExtent = Math.max(flow - slotGap + LANE_PADDING.edge, flowStart + 240);

  const lanes = [];
  const placed = [];
  let cross = PADDING;
  for (const [stripIndex, strip] of allStrips.entries()) {
    const lane = document.lanes[stripIndex] ?? null;
    const bandCross = stripCross[stripIndex] + (lane ? crossHead + LANE_PADDING.edge : 0);
    for (const slot of slots) {
      const members = cell(strip, slot);
      if (members.length === 0) continue;
      const used = members.reduce(
        (total, box, index) => total + crossSize(box) + (index === 0 ? 0 : LANE_STACK_GAP),
        0,
      );
      let memberCross = cross + (lane ? crossHead : 0) + (stripCross[stripIndex] - used) / 2;
      for (const box of members) {
        const flowPosition = slotFlowStart[slotIndex.get(slot)];
        placed.push({
          ...box,
          x: horizontalFlow ? flowPosition : memberCross,
          y: horizontalFlow ? memberCross : flowPosition,
        });
        memberCross += crossSize(box) + LANE_STACK_GAP;
      }
    }
    if (lane) {
      lanes.push({
        id: lane.id,
        label: lane.label,
        x: horizontalFlow ? PADDING : cross,
        y: horizontalFlow ? cross : PADDING,
        width: horizontalFlow ? flowExtent - PADDING : bandCross,
        height: horizontalFlow ? bandCross : flowExtent - PADDING,
        emphasis: document.emphasis.find(({ targetId }) => targetId === lane.id)?.level ?? null,
      });
    }
    cross += bandCross + (lane ? LANE_GAP : 0);
  }

  const width = horizontalFlow ? flowExtent + PADDING : cross + PADDING;
  const height = horizontalFlow ? cross + PADDING : flowExtent + PADDING;
  if (!reversed) return { boxes: placed, lanes, width, height };
  const mirror = (rect) =>
    horizontalFlow
      ? { ...rect, x: width - rect.x - rect.width }
      : { ...rect, y: height - rect.y - rect.height };
  return { boxes: placed.map(mirror), lanes: lanes.map(mirror), width, height };
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
  return points
    .slice(1)
    .some((point, index) => obstacles.some((box) => segmentEntersBox(points[index], point, box)));
}

function rectanglesOverlap(left, right) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function rectangleOverlapsBox(rectangle, boxes) {
  return boxes.some(
    (box) =>
      rectangle.x < box.x + box.width &&
      rectangle.x + rectangle.width > box.x &&
      rectangle.y < box.y + box.height &&
      rectangle.y + rectangle.height > box.y,
  );
}

function routeLength(points) {
  return points
    .slice(1)
    .reduce(
      (total, [x, y], index) =>
        total + Math.abs(x - points[index][0]) + Math.abs(y - points[index][1]),
      0,
    );
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

// A label further than this from its own path reads as loose text; the
// quality report measures the same distance so layout and report agree.
export const LABEL_EDGE_DISTANCE = 28;

// Height of the strip at the top of a group or lane frame that holds its title;
// the quality report reserves the same strip.
export const CONTAINER_TITLE_BAND = 34;
// Half the width of the strip along a container border that labels keep clear of.
const FRAME_BORDER_HALF_WIDTH = 1;

function distanceToSegment([px, py], [x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Whether a label rectangle sits on the polyline it names. */
export function labelAttached(bounds, points) {
  const centre = [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
  const nearest = Math.min(
    ...points.slice(1).map((point, index) => distanceToSegment(centre, points[index], point)),
  );
  return nearest <= LABEL_EDGE_DISTANCE + Math.max(bounds.width, bounds.height) / 2;
}

function placeLabel(label, { placements, points }, boxes, allocatedLabelBounds) {
  if (!label.lines.length) return placements[0];
  return (
    placements.find(
      (bounds) => labelAttached(bounds, points) && labelFits(bounds, boxes, allocatedLabelBounds),
    ) ?? placements[0]
  );
}

function labelFits(bounds, boxes, allocatedLabelBounds) {
  return (
    !rectangleOverlapsBox(bounds, boxes) &&
    !allocatedLabelBounds.some((allocated) => rectanglesOverlap(bounds, allocated))
  );
}

// Two routes sharing this much of a straight run read as one line; the quality
// report measures the same length so layout and report agree.
export const SHARED_SEGMENT_LENGTH = 48;

function sharedRun([[ax1, ay1], [ax2, ay2]], [[bx1, by1], [bx2, by2]]) {
  if (ay1 === ay2 && by1 === by2 && ay1 === by1) {
    return Math.max(
      0,
      Math.min(Math.max(ax1, ax2), Math.max(bx1, bx2)) -
        Math.max(Math.min(ax1, ax2), Math.min(bx1, bx2)),
    );
  }
  if (ax1 === ax2 && bx1 === bx2 && ax1 === bx1) {
    return Math.max(
      0,
      Math.min(Math.max(ay1, ay2), Math.max(by1, by2)) -
        Math.max(Math.min(ay1, ay2), Math.min(by1, by2)),
    );
  }
  return 0;
}

/** Whether two polylines share an axis-aligned run long enough to read as one line. */
export function routesMerge(left, right) {
  const segments = (points) => points.slice(1).map((point, index) => [points[index], point]);
  return segments(left).some((first) =>
    segments(right).some((second) => sharedRun(first, second) >= SHARED_SEGMENT_LENGTH),
  );
}

function validRoute(
  candidates,
  boxes,
  source,
  target,
  allocatedLabelBounds,
  label = null,
  routed = [],
  blockers = boxes,
) {
  // Candidates are ordered by length before validation so a graph with many
  // relations never validates every lane when the shortest one already fits. A
  // candidate is valid when its path clears every other node, does not ride a
  // run already used by a relation with a different source and target, and, for
  // a labelled relation, at least one of its label placements is free.
  const labelled = Boolean(label?.lines?.length);
  const unrelated = routed.filter((edge) => edge.from !== source.id && edge.to !== target.id);
  return [...candidates]
    .sort((left, right) => routeLength(left.points) - routeLength(right.points))
    .find(
      ({ points, placements }) =>
        !routeHitsBoxes(points, boxes, source, target) &&
        !unrelated.some((edge) => routesMerge(points, edge.routePoints)) &&
        (!labelled ||
          placements.some(
            (bounds) =>
              labelAttached(bounds, points) && labelFits(bounds, blockers, allocatedLabelBounds),
          )),
    );
}

/**
 * Side-port routes for a relation that runs against the flow: out of the
 * source's side, along a lane beyond everything between the two layers, and
 * into the target's side. `alongX` is true when the flow runs across the page.
 */
function feedbackRoutes(source, target, alongX, obstacles, label) {
  const [flow, crossAxis, flowSize, crossSize] = alongX
    ? ['x', 'y', 'width', 'height']
    : ['y', 'x', 'height', 'width'];
  const low = Math.min(source[flow], target[flow]);
  const high = Math.max(source[flow] + source[flowSize], target[flow] + target[flowSize]);
  const beside = obstacles.filter(
    (bounds) => bounds[flow] < high && bounds[flow] + bounds[flowSize] > low,
  );
  const point = (flowValue, crossValue) =>
    alongX ? [flowValue, crossValue] : [crossValue, flowValue];
  const rect = (flowValue, crossValue, flowExtent, crossExtent) =>
    alongX
      ? { x: flowValue, y: crossValue, width: flowExtent, height: crossExtent }
      : { x: crossValue, y: flowValue, width: crossExtent, height: flowExtent };
  const labelFlow = alongX ? label.width : label.height;
  const labelCross = alongX ? label.height : label.width;
  const sourceMiddle = source[flow] + source[flowSize] / 2;
  const targetMiddle = target[flow] + target[flowSize] / 2;
  return [1, -1].map((side) => {
    const edge = (box) => (side > 0 ? box[crossAxis] + box[crossSize] : box[crossAxis]);
    const lane =
      side > 0
        ? Math.max(...beside.map(edge)) + FEEDBACK_CLEARANCE
        : Math.min(...beside.map(edge)) - FEEDBACK_CLEARANCE;
    const entry = edge(target);
    const onEntry = rect(
      targetMiddle - labelFlow - LABEL_TARGET_CLEARANCE,
      (entry + lane) / 2 - labelCross / 2,
      labelFlow,
      labelCross,
    );
    const nearTarget = rect(
      targetMiddle - labelFlow - LABEL_TARGET_CLEARANCE,
      side > 0 ? entry + LABEL_TARGET_CLEARANCE : entry - labelCross - LABEL_TARGET_CLEARANCE,
      labelFlow,
      labelCross,
    );
    const onLane = rect(
      (sourceMiddle + targetMiddle) / 2 - labelFlow / 2,
      side > 0 ? lane + LABEL_TARGET_CLEARANCE : lane - labelCross - LABEL_TARGET_CLEARANCE,
      labelFlow,
      labelCross,
    );
    return {
      lane,
      points: [
        point(sourceMiddle, edge(source)),
        point(sourceMiddle, lane),
        point(targetMiddle, lane),
        point(targetMiddle, entry),
      ],
      // A label reads best along a horizontal run: the entry into the target in
      // a vertical flow, the long outside lane in a horizontal one.
      placements: alongX ? [onLane, onEntry, nearTarget] : [onEntry, nearTarget, onLane],
    };
  });
}

/**
 * A two-turn route whose ports differ by less than STRAIGHTEN_TOLERANCE across
 * the flow, as one straight segment. Only a port this relation owns alone
 * moves, so a shared fan-in or fan-out port stays where its siblings meet.
 */
function straightenRoute(points, across, source, target, { sourceShared, targetShared }) {
  if (points.length !== 4) return null;
  const along = 1 - across;
  const [first, bend, turn, last] = points;
  if (
    first[across] !== bend[across] ||
    turn[across] !== last[across] ||
    bend[along] !== turn[along]
  )
    return null;
  const delta = last[across] - first[across];
  if (delta === 0 || Math.abs(delta) >= STRAIGHTEN_TOLERANCE) return null;
  const side = across === 0 ? ['x', 'width'] : ['y', 'height'];
  const within = (box, value) =>
    value >= box[side[0]] + STRAIGHTEN_TOLERANCE &&
    value <= box[side[0]] + box[side[1]] - STRAIGHTEN_TOLERANCE;
  const at = (value, point) => (across === 0 ? [value, point[1]] : [point[0], value]);
  if (!sourceShared && within(source, last[across]))
    return { points: [at(last[across], first), last], from: first[across], to: last[across] };
  if (!targetShared && within(target, first[across]))
    return { points: [first, at(first[across], last)], from: last[across], to: first[across] };
  return null;
}

/** The four edges of a container frame, as thin strips a label must not cross. */
function frameBorders({ x, y, width, height }) {
  const half = FRAME_BORDER_HALF_WIDTH;
  return [
    { x: x - half, y: y - half, width: width + 2 * half, height: 2 * half },
    { x: x - half, y: y + height - half, width: width + 2 * half, height: 2 * half },
    { x: x - half, y: y - half, width: 2 * half, height: height + 2 * half },
    { x: x + width - half, y: y - half, width: 2 * half, height: height + 2 * half },
  ];
}

/** Whether a label box crosses a container border instead of lying inside or outside it. */
export function labelStraddlesFrame(label, frame) {
  return frameBorders(frame).some((border) => rectanglesOverlap(label, border));
}

/** Each group's frame around its member boxes, before relations are routed. */
function boxFrames(document, boxes) {
  return document.groups.flatMap((group) => {
    const members = group.members.map((id) => boxes.find((box) => box.id === id)).filter(Boolean);
    if (members.length === 0) return [];
    const bounds = geometryBounds(members);
    return [
      {
        members,
        frame: {
          x: bounds.x - GROUP_PADDING.side,
          y: bounds.y - GROUP_PADDING.top,
          width: bounds.width + 2 * GROUP_PADDING.side,
          height: bounds.height + GROUP_PADDING.top + GROUP_PADDING.bottom,
        },
        id: group.id,
      },
    ];
  });
}

// The rectangle an edge must clear when leaving or entering a box: the box
// itself, or the frame of every group that contains it.
function boxEnvelopes(document, boxes) {
  const envelopes = new Map(
    boxes.map((box) => [
      box.id,
      { x: box.x, y: box.y, width: box.width, height: box.height, framed: false },
    ]),
  );
  for (const { members, frame, id } of boxFrames(document, boxes)) {
    const group = { id };
    for (const member of members) {
      const current = envelopes.get(member.id);
      const x = Math.min(current.x, frame.x);
      const y = Math.min(current.y, frame.y);
      envelopes.set(member.id, {
        x,
        y,
        framed: true,
        groups: [...(current.groups ?? []), group.id],
        width: Math.max(current.x + current.width, frame.x + frame.width) - x,
        height: Math.max(current.y + current.height, frame.y + frame.height) - y,
      });
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

function graphEdges(
  document,
  boxes,
  { bands = null, flowAxis = null, lanes = [], metrics, feedback },
) {
  const boxIndex = new Map(boxes.map((box) => [box.id, box]));
  const envelopes = boxEnvelopes(document, boxes);
  // Labels keep off nodes, container title bands, and container borders.
  const containers = [...boxFrames(document, boxes).map(({ frame }) => frame), ...lanes];
  const blockers = [
    ...boxes,
    ...containers.flatMap((frame) => [
      { x: frame.x, y: frame.y, width: frame.width, height: CONTAINER_TITLE_BAND },
      ...frameBorders(frame),
    ]),
  ];
  const envelope = (box) => envelopes.get(box.id);
  const laneOffset = (layer, framed) =>
    framed && layer.some((box) => envelope(box)?.framed) ? FRAME_LANE_OFFSET : BOX_LANE_OFFSET;
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
  const routed = () => [...byId.values()];
  const measureLabel = (text, limit) => {
    const lines = text ? wrapDiagramLabel(text, limit) : [];
    return {
      lines,
      width: lines.length
        ? Math.max(...lines.map((line) => [...line].length)) * metrics.label.glyph + 24
        : 0,
      height: lines.length ? lines.length * metrics.label.lineHeight + 14 : 0,
    };
  };
  const obstacles = () => [
    ...boxes.map((box) => envelope(box)),
    ...allocatedLabelBounds,
    ...routed().flatMap((edge) =>
      edge.routePoints.map(([x, y]) => ({ x, y, width: 0, height: 0 })),
    ),
  ];
  // A feedback route carries its label on a straight run across the flow, so
  // the label keeps the wider limit of a horizontal run.
  const routeFeedback = (relation, source, target, alongX) => {
    const label = measureLabel(relation.label, FEEDBACK_LABEL_LIMIT);
    const candidate = validRoute(
      feedbackRoutes(source, target, alongX, obstacles(), label),
      boxes,
      source,
      target,
      allocatedLabelBounds,
      label,
      routed(),
      blockers,
    );
    return candidate ? { ...candidate, label } : undefined;
  };
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
    const layeredAcross =
      flowAxis === 'vertical'
        ? Math.abs(first.y - second.y) >= 0.5
        : flowAxis === 'horizontal'
          ? Math.abs(first.x - second.x) >= 0.5
          : null;
    const horizontal = crossBand
      ? !bands.horizontal
      : layeredAcross === true
        ? flowAxis === 'horizontal'
        : Math.abs(first.x + first.width / 2 - second.x - second.width / 2) >=
          Math.abs(first.y + first.height / 2 - second.y - second.height / 2);
    const gap = horizontal
      ? Math.max(first.x, second.x) - Math.min(first.x + first.width, second.x + second.width)
      : Math.max(first.y, second.y) - Math.min(first.y + first.height, second.y + second.height);
    const labelLimit =
      first === second
        ? 24
        : horizontal
          ? Math.max(8, Math.min(32, Math.floor((gap - 64) / metrics.label.glyph)))
          : 24;
    const labels = relations.map((relation) => measureLabel(relation.label, labelLimit));
    const spacing = Math.max(
      48,
      ...labels.map((label) => (horizontal ? label.height : label.width) + 24),
    );
    for (const [index, relation] of relations.entries()) {
      const source = boxIndex.get(relation.from);
      const target = boxIndex.get(relation.to);
      let label = labels[index];
      const slot = index - (relations.length - 1) / 2;
      const fraction = relations.length > 1 ? slot / relations.length : 0;
      let routePoints;
      let labelX;
      let labelY;
      if (source === target) {
        // Self messages need an actual loop; a zero-length edge has no arrow.
        const y = source.y - 32 - index * spacing;
        const x = source.x + source.width + 40 + index * 24;
        routePoints = [
          [source.x + source.width, source.y + source.height / 2],
          [x, source.y + source.height / 2],
          [x, y],
          [source.x + source.width / 2, y],
          [source.x + source.width / 2, source.y],
        ];
        labelX = (x + source.x + source.width / 2) / 2;
        labelY = y - label.height - 8;
      } else if (horizontal) {
        const sign = source.x < target.x ? 1 : -1;
        const x1 = source.x + (sign > 0 ? source.width : 0);
        const x2 = target.x + (sign > 0 ? 0 : target.width);
        const y1 = source.y + source.height / 2 + fraction * (source.height - 24);
        const y2 = target.y + target.height / 2 + fraction * (target.height - 24);
        const sourceLayer = crossBand
          ? [bandBounds(source)]
          : boxes.filter((box) => sameBand(box, source) && Math.abs(box.x - source.x) < 0.5);
        const targetLayer = crossBand
          ? [bandBounds(target)]
          : boxes.filter((box) => sameBand(box, target) && Math.abs(box.x - target.x) < 0.5);
        const framed = !crossBand && crossesFrame(envelopes, source, target);
        const extent = (box) => (framed ? (envelope(box) ?? box) : box);
        const sourceLane =
          sign > 0
            ? Math.max(...sourceLayer.map((box) => extent(box).x + extent(box).width)) +
              laneOffset(sourceLayer, framed)
            : Math.min(...sourceLayer.map((box) => extent(box).x)) -
              laneOffset(sourceLayer, framed);
        const targetLane =
          sign > 0
            ? Math.min(...targetLayer.map((box) => extent(box).x)) - laneOffset(targetLayer, framed)
            : Math.max(...targetLayer.map((box) => extent(box).x + extent(box).width)) +
              laneOffset(targetLayer, framed);
        const middle =
          (source.y + source.height / 2 + target.y + target.height / 2) / 2 + slot * spacing;
        // Detours prefer the gap around the source band before the scene edge.
        const outer = (bounds) => [bounds.y - 48, bounds.y + bounds.height + label.height + 48];
        const [top, bottom] = outer(crossBand ? sceneBounds : bandBounds(source));
        const [sceneTop, sceneBottom] = outer(sceneBounds);
        const lanes = [
          ...new Set([
            middle,
            ...Array.from({ length: allocatedLabelBounds.length + 2 }, (_, laneIndex) => [
              top - laneIndex * spacing,
              bottom + laneIndex * spacing,
              sceneTop - laneIndex * spacing,
              sceneBottom + laneIndex * spacing,
            ]).flat(),
          ]),
        ];
        const size = { width: label.width, height: label.height };
        const nearTarget = {
          ...size,
          y: y2 - label.height - LABEL_TARGET_CLEARANCE,
          x:
            sign > 0
              ? targetLane - label.width - LABEL_TARGET_CLEARANCE
              : targetLane + LABEL_TARGET_CLEARANCE,
        };
        // A relation that crosses a group boundary labels only its run between
        // the frames, so the label never sits on a frame border.
        const dropStart = framed
          ? sign > 0
            ? extent(source).x + extent(source).width
            : extent(source).x
          : x1;
        const approachEnd = framed
          ? sign > 0
            ? extent(target).x
            : extent(target).x + extent(target).width
          : x2;
        const onDrop = {
          ...size,
          x: (dropStart + targetLane) / 2 - label.width / 2,
          y: y1 - label.height - LABEL_TARGET_CLEARANCE,
        };
        const onApproach = {
          ...size,
          x: (sourceLane + approachEnd) / 2 - label.width / 2,
          y: y2 - label.height - LABEL_TARGET_CLEARANCE,
        };
        const dropFirst = {
          lane: y1,
          points: [
            [x1, y1],
            [targetLane, y1],
            [targetLane, y2],
            [x2, y2],
          ],
          placements: stacked([onDrop, nearTarget], 'y'),
        };
        const acrossFirst = {
          lane: y2,
          points: [
            [x1, y1],
            [sourceLane, y1],
            [sourceLane, y2],
            [x2, y2],
          ],
          placements: stacked([nearTarget, onApproach], 'y'),
        };
        const preferred =
          fanIn(relation) && !fanOut(relation)
            ? [dropFirst, acrossFirst]
            : [acrossFirst, dropFirst];
        const candidates = [
          ...preferred,
          ...lanes.map((lane) => {
            const points = [
              [x1, y1],
              [sourceLane, y1],
              [sourceLane, lane],
              [targetLane, lane],
              [targetLane, y2],
              [x2, y2],
            ];
            const midpoint = {
              ...size,
              x: (sourceLane + targetLane) / 2 - label.width / 2,
              y: lane - label.height - 8,
            };
            return { lane, points, placements: stacked([nearTarget, midpoint], 'y') };
          }),
        ];
        const candidate =
          validRoute(
            candidates,
            boxes,
            source,
            target,
            allocatedLabelBounds,
            label,
            routed(),
            blockers,
          ) ??
          (feedback.has(relation.id) && !crossBand
            ? routeFeedback(relation, source, target, true)
            : undefined) ??
          candidates[0];
        label = candidate.label ?? label;
        routePoints = candidate.points;
        const placement = placeLabel(label, candidate, blockers, allocatedLabelBounds);
        labelX = placement.x + label.width / 2;
        labelY = placement.y;
      } else {
        const sign = source.y < target.y ? 1 : -1;
        const x1 = source.x + source.width / 2 + fraction * (source.width - 24);
        const x2 = target.x + target.width / 2 + fraction * (target.width - 24);
        const y1 = source.y + (sign > 0 ? source.height : 0);
        const y2 = target.y + (sign > 0 ? 0 : target.height);
        const sourceLayer = crossBand
          ? [bandBounds(source)]
          : boxes.filter((box) => sameBand(box, source) && Math.abs(box.y - source.y) < 0.5);
        const targetLayer = crossBand
          ? [bandBounds(target)]
          : boxes.filter((box) => sameBand(box, target) && Math.abs(box.y - target.y) < 0.5);
        const framed = !crossBand && crossesFrame(envelopes, source, target);
        const extent = (box) => (framed ? (envelope(box) ?? box) : box);
        const sourceLane =
          sign > 0
            ? Math.max(...sourceLayer.map((box) => extent(box).y + extent(box).height)) +
              laneOffset(sourceLayer, framed)
            : Math.min(...sourceLayer.map((box) => extent(box).y)) -
              laneOffset(sourceLayer, framed);
        const targetLane =
          sign > 0
            ? Math.min(...targetLayer.map((box) => extent(box).y)) - laneOffset(targetLayer, framed)
            : Math.max(...targetLayer.map((box) => extent(box).y + extent(box).height)) +
              laneOffset(targetLayer, framed);
        const middle =
          (source.x + source.width / 2 + target.x + target.width / 2) / 2 + slot * spacing;
        const outer = (bounds) => [
          bounds.x - label.width / 2 - 48,
          bounds.x + bounds.width + label.width / 2 + 48,
        ];
        const [left, right] = outer(crossBand ? sceneBounds : bandBounds(source));
        const [sceneLeft, sceneRight] = outer(sceneBounds);
        const lanes = [
          ...new Set([
            middle,
            ...Array.from({ length: allocatedLabelBounds.length + 2 }, (_, laneIndex) => [
              left - laneIndex * spacing,
              right + laneIndex * spacing,
              sceneLeft - laneIndex * spacing,
              sceneRight + laneIndex * spacing,
            ]).flat(),
          ]),
        ];
        // One turn beats two. A fan-in merges at the target lane so each source
        // keeps its own drop; a fan-out splits at the source lane so each target
        // keeps its own approach. The label goes on the segment that is unique to
        // this relation, which is what makes a fan read unambiguously.
        const size = { width: label.width, height: label.height };
        const nearTarget = {
          ...size,
          x: x2 - label.width / 2,
          y:
            sign > 0
              ? targetLane - label.height - LABEL_TARGET_CLEARANCE
              : targetLane + LABEL_TARGET_CLEARANCE,
        };
        const dropStart = framed
          ? sign > 0
            ? extent(source).y + extent(source).height
            : extent(source).y
          : y1;
        const approachEnd = framed
          ? sign > 0
            ? extent(target).y
            : extent(target).y + extent(target).height
          : y2;
        const onDrop = {
          ...size,
          x: x1 - label.width / 2,
          y: (dropStart + targetLane) / 2 - label.height / 2,
        };
        const onApproach = {
          ...size,
          x: x2 - label.width / 2,
          y: (sourceLane + approachEnd) / 2 - label.height / 2,
        };
        const dropFirst = {
          lane: x1,
          points: [
            [x1, y1],
            [x1, targetLane],
            [x2, targetLane],
            [x2, y2],
          ],
          placements: stacked([onDrop, nearTarget]),
        };
        const acrossFirst = {
          lane: x2,
          points: [
            [x1, y1],
            [x1, sourceLane],
            [x2, sourceLane],
            [x2, y2],
          ],
          placements: stacked([nearTarget, onApproach]),
        };
        const preferred =
          fanIn(relation) && !fanOut(relation)
            ? [dropFirst, acrossFirst]
            : [acrossFirst, dropFirst];
        const candidates = [
          ...preferred,
          ...lanes.map((lane) => {
            const points = [
              [x1, y1],
              [x1, sourceLane],
              [lane, sourceLane],
              [lane, targetLane],
              [x2, targetLane],
              [x2, y2],
            ];
            const midpoint = {
              ...size,
              x: lane - label.width / 2,
              y: (sourceLane + targetLane) / 2 - label.height / 2,
            };
            return { lane, points, placements: stacked([nearTarget, midpoint]) };
          }),
        ];
        const candidate =
          validRoute(
            candidates,
            boxes,
            source,
            target,
            allocatedLabelBounds,
            label,
            routed(),
            blockers,
          ) ??
          (feedback.has(relation.id) && !crossBand
            ? routeFeedback(relation, source, target, false)
            : undefined) ??
          candidates[0];
        label = candidate.label ?? label;
        routePoints = candidate.points;
        const placement = placeLabel(label, candidate, blockers, allocatedLabelBounds);
        labelX = placement.x + label.width / 2;
        labelY = placement.y;
      }
      if (source !== target && relations.length === 1) {
        const straight = straightenRoute(routePoints, horizontal ? 1 : 0, source, target, {
          sourceShared: fanOut(relation),
          targetShared: fanIn(relation),
        });
        if (straight) {
          const centre = horizontal ? labelY + label.height / 2 : labelX;
          const shift =
            Math.abs(centre - straight.from) < Math.abs(centre - straight.to)
              ? straight.to - straight.from
              : 0;
          const moved = {
            x: labelX - label.width / 2 + (horizontal ? 0 : shift),
            y: labelY + (horizontal ? shift : 0),
            width: label.width,
            height: label.height,
          };
          if (!label.lines.length || labelFits(moved, blockers, allocatedLabelBounds)) {
            routePoints = straight.points;
            if (horizontal) labelY += shift;
            else labelX += shift;
          }
        }
      }
      routePoints = routePoints.filter(
        ([x, y], pointIndex) =>
          pointIndex === 0 ||
          x !== routePoints[pointIndex - 1][0] ||
          y !== routePoints[pointIndex - 1][1],
      );
      const [[x1, y1]] = routePoints;
      const [x2, y2] = routePoints.at(-1);
      const labelBounds = label.lines.length
        ? {
            id: relation.id,
            x: labelX - label.width / 2,
            y: labelY,
            width: label.width,
            height: label.height,
          }
        : null;
      if (labelBounds) allocatedLabelBounds.push(labelBounds);
      byId.set(relation.id, {
        ...relation,
        x1,
        y1,
        x2,
        y2,
        routePoints,
        labelLines: label.lines,
        emphasis: document.emphasis.find(({ targetId }) => targetId === relation.id)?.level ?? null,
        labelBounds,
      });
    }
  }
  return document.relations.flatMap((relation) =>
    byId.has(relation.id) ? [byId.get(relation.id)] : [],
  );
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
  const points = edge.routePoints ?? [
    [edge.x1, edge.y1],
    [edge.x2, edge.y2],
  ];
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

// Where a group title starts inside its frame, and the band it occupies.
const GROUP_TITLE = Object.freeze({ inset: 18, top: 8, bottom: 34, clearance: 6 });

/**
 * Keeps a group title off the connectors that cross its title band. A small
 * growth of the frame on its title side comes first, so the title keeps its
 * corner; then the first gap between crossings that holds the title; then any
 * growth that takes in no other node.
 */
function placeGroupTitle(frame, edges, boxes, glyph) {
  const width = [...frame.label].length * glyph;
  const top = frame.y + GROUP_TITLE.top;
  const bottom = frame.y + GROUP_TITLE.bottom;
  const blocked = edges
    .flatMap(({ routePoints }) =>
      routePoints.slice(1).map((point, index) => [routePoints[index], point]),
    )
    .filter(([[, y1], [, y2]]) => Math.min(y1, y2) <= bottom && Math.max(y1, y2) >= top)
    .map(([[x1], [x2]]) => [
      Math.min(x1, x2) - GROUP_TITLE.clearance,
      Math.max(x1, x2) + GROUP_TITLE.clearance,
    ])
    .sort(([left], [right]) => left - right);
  const inset = frame.x + GROUP_TITLE.inset;
  const clear = (start) => blocked.every(([low, high]) => high <= start || low >= start + width);
  const inside = (start) => start + width <= frame.x + frame.width - GROUP_TITLE.inset;
  if (clear(inset) && inside(inset)) return { titleOffset: GROUP_TITLE.inset };
  const crossing = blocked.find(([low, high]) => high > inset && low < inset + width);
  const grown = (() => {
    if (!crossing) return null;
    // Whole units keep the scene translation that follows free of float noise.
    const x = Math.floor(crossing[0] - width - GROUP_TITLE.inset);
    const start = x + GROUP_TITLE.inset;
    const strip = { x, y: frame.y, width: frame.x - x, height: frame.height };
    if (x >= frame.x || !clear(start) || boxes.some((box) => rectanglesOverlap(strip, box)))
      return null;
    return { x, width: frame.width + frame.x - x, titleOffset: GROUP_TITLE.inset };
  })();
  if (grown && frame.x - grown.x <= 2 * GROUP_PADDING.side) return grown;
  const gap = blocked
    .map(([, high]) => high + GROUP_TITLE.inset - GROUP_TITLE.clearance)
    .find((start) => start >= inset && clear(start) && inside(start));
  if (gap !== undefined) return { titleOffset: gap - frame.x };
  return grown ?? { titleOffset: GROUP_TITLE.inset };
}

function graphGroups(document, boxes, edges, metrics) {
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
      Object.assign(rendered, placeGroupTitle(rendered, edges, boxes, metrics.container.glyph));
      byId.set(group.id, rendered);
      geometry.set(group.id, rendered);
      pending.delete(group.id);
    }
  }
  return document.groups
    .flatMap(({ id }) => (byId.has(id) ? [byId.get(id)] : []))
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
  const readingOrder = document.accessibility.readingOrder.filter(
    (id) => events.has(id) || relations.has(id),
  );
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

function sequenceLayout(document, metrics) {
  const { sequence } = metrics;
  const reversed = ['right-left', 'bottom-up'].includes(document.layout.direction);
  const participants = reversed ? [...document.nodes].reverse() : [...document.nodes];
  const participantLines = participants.map((participant) =>
    nodeLines(participant.label, metrics, sequence.participantWrap),
  );
  const participantHeight = Math.max(
    sequence.participantMinHeight,
    ...participantLines.map(
      ({ lines, titleLines }) =>
        textHeight(lines, titleLines, metrics) + sequence.participantPaddingY,
    ),
  );
  const participantStart = PADDING + sequence.phaseRail;
  const participantSpan = sequence.participantWidth + sequence.participantGap;
  const boxes = participants.map((participant, index) => ({
    id: participant.id,
    kind: participant.kind,
    label: participant.label,
    description: participant.description ?? null,
    lines: participantLines[index].lines,
    ...(participantLines[index].titleLines === null
      ? {}
      : { titleLines: participantLines[index].titleLines }),
    x: participantStart + index * participantSpan,
    y: PADDING,
    width: sequence.participantWidth,
    height: participantHeight,
    emphasis: document.emphasis.find(({ targetId }) => targetId === participant.id)?.level ?? null,
  }));
  const boxIndex = new Map(boxes.map((box) => [box.id, box]));
  const phaseEnd = boxes.at(-1).x + boxes.at(-1).width;
  const annotations = new Map();
  for (const annotation of document.annotations) {
    annotations.set(annotation.targetId, [
      ...(annotations.get(annotation.targetId) ?? []),
      annotation,
    ]);
  }
  const phases = [];
  const edges = [];
  const notes = [];
  const labelBounds = [];
  let y = PADDING + participantHeight + sequence.headerGap;
  for (const entry of sequenceTimeline(document)) {
    if (entry.type === 'phase') {
      if (phases.length > 0) y += sequence.phaseLead;
      phases.push({
        id: entry.value.id,
        label: entry.value.label,
        x1: PADDING,
        x2: phaseEnd,
        y,
      });
      y += sequence.phaseGap;
      continue;
    }
    const relation = entry.value;
    const source = boxIndex.get(relation.from);
    const target = boxIndex.get(relation.to);
    if (!source || !target) continue;
    const x1 = source.x + source.width / 2;
    const x2 = target.x + target.width / 2;
    const maximum = Math.max(
      18,
      Math.min(
        46,
        Math.floor(
          Math.max(metrics.message.minWidth, Math.abs(x2 - x1)) / metrics.message.wrapGlyph,
        ),
      ),
    );
    const labelLines = relation.label
      ? metrics.message.balance
        ? balancedLines(relation.label, maximum)
        : wrapDiagramLabel(relation.label, maximum)
      : [];
    const labelWidth =
      labelLines.length === 0
        ? 0
        : Math.min(
            Math.max(
              120,
              Math.max(...labelLines.map((line) => [...line].length)) * metrics.message.glyph + 28,
            ),
            Math.max(metrics.message.minWidth, Math.abs(x2 - x1) - 24),
          );
    const labelHeight =
      labelLines.length * metrics.message.lineHeight + (labelLines.length > 0 ? 14 : 0);
    const messageY = y + labelHeight + 10;
    const labelBoundsValue =
      labelLines.length > 0
        ? {
            id: relation.id,
            x: Math.min(Math.max(PADDING, (x1 + x2) / 2 - labelWidth / 2), phaseEnd - labelWidth),
            y,
            width: labelWidth,
            height: labelHeight,
          }
        : null;
    const emphasis =
      document.emphasis.find(({ targetId }) => targetId === relation.id)?.level ?? null;
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
        emphasis:
          document.emphasis.find(({ targetId }) => targetId === annotation.id)?.level ?? null,
      });
      noteY += height + 12;
    }
    y = Math.max(messageY + sequence.messageGap, relationNotes.length > 0 ? noteY + 12 : 0);
  }
  for (const annotation of document.annotations.filter(({ targetId }) => boxIndex.has(targetId))) {
    const lines = wrapDiagramLabel(annotation.text, 48);
    const width = 360;
    const height = lines.length * SEQUENCE_MESSAGE_LINE_HEIGHT + 28;
    notes.push({
      id: annotation.id,
      targetId: annotation.targetId,
      lines,
      x: phaseEnd + 48,
      y,
      width,
      height,
      emphasis: document.emphasis.find(({ targetId }) => targetId === annotation.id)?.level ?? null,
    });
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
  diagramFail(
    DIAGRAM_ERROR_CODES.RESOURCE_BUDGET_EXCEEDED,
    'Diagram layout exceeds the renderer viewport budget.',
    {
      width,
      height,
      maximum: MAX_DIAGRAM_SCENE_EXTENT,
      repair: 'Split the source into multiple named diagrams before rendering.',
    },
  );
}

export function layoutDiagram(document, { theme = resolveDiagramTheme(document.theme) } = {}) {
  const metrics = diagramMetrics(theme);
  if (document.grammar.id === 'sequence') {
    const scene = sequenceLayout(document, metrics);
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
    diagramFail(
      DIAGRAM_ERROR_CODES.RENDER_FAILED,
      'The diagram has no renderable semantic items.',
      {
        repair: 'Add a node, event, series, or set before rendering.',
      },
    );
  }
  const useLanes =
    document.lanes.length > 0 &&
    document.nodes.length === items.length &&
    document.layout.direction !== 'radial';
  const useLayeredGraph =
    !useLanes &&
    document.nodes.length === items.length &&
    document.relations.length > 0 &&
    document.layout.direction !== 'radial';
  const layout = useLanes
    ? laneLayout(document, metrics)
    : useLayeredGraph
      ? layeredGraphLayout(
          items,
          document.relations,
          document.layout.direction,
          document.groups.length > 0
            ? GROUPED_LAYER_GAP
            : ['left-right', 'right-left'].includes(document.layout.direction)
              ? COLUMN_GAP
              : ROW_GAP,
          metrics,
        )
      : gridLayout(items, document.layout.direction, metrics);
  for (const box of layout.boxes) {
    box.emphasis = document.emphasis.find(({ targetId }) => targetId === box.id)?.level ?? null;
  }
  const flowAxis =
    !useLayeredGraph && !useLanes
      ? null
      : ['left-right', 'right-left'].includes(document.layout.direction)
        ? 'horizontal'
        : 'vertical';
  const edges = graphEdges(document, layout.boxes, {
    bands: layout.bands ?? null,
    flowAxis,
    metrics,
    lanes: layout.lanes ?? [],
    feedback: layout.feedback ?? new Set(),
  });
  const groups = graphGroups(document, layout.boxes, edges, metrics);
  const lanes = layout.lanes ?? [];
  const notes = graphNotes(document, layout.boxes, edges, groups);
  const labelBounds = edges.flatMap((edge) => (edge.labelBounds ? [edge.labelBounds] : []));
  const points = edges.flatMap((edge) => edge.routePoints);
  const rectangles = [...layout.boxes, ...groups, ...lanes, ...notes, ...labelBounds];
  // Lanes may extend above or left of the original grid. Translate the scene
  // once, including labels, then size the viewport from the routed geometry.
  const dx = Math.max(
    0,
    PADDING - Math.min(...rectangles.map(({ x }) => x), ...points.map(([x]) => x)),
  );
  const dy = Math.max(
    0,
    PADDING - Math.min(...rectangles.map(({ y }) => y), ...points.map(([, y]) => y)),
  );
  const width =
    Math.max(
      layout.width,
      ...rectangles.map((rect) => rect.x + rect.width + PADDING),
      ...points.map(([x]) => x + PADDING),
    ) + dx;
  const height =
    Math.max(
      layout.height,
      ...rectangles.map((rect) => rect.y + rect.height + PADDING),
      ...points.map(([, y]) => y + PADDING),
    ) + dy;
  for (const rect of rectangles) {
    rect.x += dx;
    rect.y += dy;
  }
  for (const edge of edges) {
    edge.x1 += dx;
    edge.y1 += dy;
    edge.x2 += dx;
    edge.y2 += dy;
    edge.routePoints = Object.freeze(
      edge.routePoints.map(([x, y]) => Object.freeze([x + dx, y + dy])),
    );
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
    lanes: Object.freeze(lanes.map(Object.freeze)),
    axes: Object.freeze([]),
    phases: Object.freeze([]),
    lifelines: Object.freeze([]),
    notes: Object.freeze(notes.map(Object.freeze)),
    labelBounds: Object.freeze(labelBounds.map(Object.freeze)),
  });
}
