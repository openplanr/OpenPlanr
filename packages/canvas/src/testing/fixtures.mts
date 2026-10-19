export type FixtureNode = Readonly<{
  id: string;
  title: string;
  rank: number;
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;

export type FixtureEdge = Readonly<{
  id: string;
  from: string;
  to: string;
  points: readonly Readonly<{ x: number; y: number }>[];
}>;

export type CanvasFixture = Readonly<{
  nodes: readonly FixtureNode[];
  edges: readonly FixtureEdge[];
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;

function randomSource(seed: number): () => number {
  if (!Number.isSafeInteger(seed))
    throw new TypeError(`seed must be a safe integer; received ${seed}`);
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function generateEdges(
  nodes: readonly FixtureNode[],
  rows: number,
  edgeCount: number,
  random: () => number,
): FixtureEdge[] {
  const capacity = nodes.reduce((sum, node) => sum + node.rank * rows, 0);
  if (!Number.isSafeInteger(edgeCount) || edgeCount < 0 || edgeCount > capacity)
    throw new TypeError(
      `edgeCount must be an integer from 0 to ${capacity}; received ${edgeCount}`,
    );
  const edges: FixtureEdge[] = [];
  const offsets = nodes.map(() => Math.floor(random() * rows));
  for (let distance = 1; edges.length < edgeCount; distance += 1) {
    for (let rowOffset = 0; rowOffset < rows && edges.length < edgeCount; rowOffset += 1) {
      for (let target = rows; target < nodes.length && edges.length < edgeCount; target += 1) {
        const to = nodes[target];
        if (to.rank < distance) continue;
        const from = nodes[(to.rank - distance) * rows + ((offsets[target] + rowOffset) % rows)];
        const start = {
          x: from.bounds.x + from.bounds.width,
          y: from.bounds.y + from.bounds.height / 2,
        };
        const end = { x: to.bounds.x, y: to.bounds.y + to.bounds.height / 2 };
        const middleX = (start.x + end.x) / 2;
        edges.push({
          id: `edge-${edges.length + 1}`,
          from: from.id,
          to: to.id,
          points: [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end],
        });
      }
    }
  }
  return edges;
}

function generate(
  nodeCount: 708 | 5000,
  edgeCount: number,
  seed: number,
  diagram: boolean,
): CanvasFixture {
  if (nodeCount !== 708 && nodeCount !== 5000)
    throw new TypeError(`nodeCount must be 708 or 5000; received ${nodeCount}`);
  const random = randomSource(seed);
  const rows = Math.ceil(Math.sqrt(nodeCount * 2));
  const width = diagram ? 180 : 230;
  const height = diagram ? 96 : 66;
  const columnStep = width + (diagram ? 80 : 64);
  const rowStep = height + (diagram ? 40 : 28);
  const nodes: FixtureNode[] = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index + 1}`,
    title: `${diagram ? 'Diagram' : 'Graph'} ${1 + Math.floor(random() * 10_000)}`,
    rank: Math.floor(index / rows),
    bounds: {
      x: Math.floor(index / rows) * columnStep,
      y: (index % rows) * rowStep,
      width,
      height,
    },
  }));
  return {
    nodes,
    edges: generateEdges(nodes, rows, edgeCount, random),
    bounds: {
      x: 0,
      y: 0,
      width: (Math.ceil(nodeCount / rows) - 1) * columnStep + width,
      height: (rows - 1) * rowStep + height,
    },
  };
}

/** Returns a deterministic dependency graph with the requested cardinalities. */
export function generateLayeredGraph(
  nodeCount: 708 | 5000,
  edgeCount: number,
  seed = 7,
): CanvasFixture {
  return generate(nodeCount, edgeCount, seed, false);
}

/** Returns a deterministic diagram fixture with one shape per node. */
export function generateSvgDiagram(count: 708 | 5000, seed = 7): CanvasFixture {
  return generate(count, count === 708 ? 997 : 7312, seed, true);
}
