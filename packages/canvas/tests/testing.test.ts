import { describe, expect, it } from 'vitest';
import type { RendererTraceEvent } from '../src/testing/index.mjs';
import {
  generateLayeredGraph,
  generateSvgDiagram,
  percentile95,
  rendererFrameWork,
} from '../src/testing/index.mjs';

describe('deterministic fixtures', () => {
  it.each([
    [708, 477],
    [708, 997],
    [5000, 8499],
    [5000, 7312],
  ] as const)('generates %i nodes and %i routed edges', (nodeCount, edgeCount) => {
    const fixture = generateLayeredGraph(nodeCount, edgeCount, 23);
    expect(fixture.nodes).toHaveLength(nodeCount);
    expect(fixture.edges).toHaveLength(edgeCount);
    expect(fixture).toEqual(generateLayeredGraph(nodeCount, edgeCount, 23));
    const nodes = new Map(fixture.nodes.map((node) => [node.id, node]));
    expect(nodes.size).toBe(nodeCount);
    expect(new Set(fixture.edges.map((edge) => `${edge.from}:${edge.to}`)).size).toBe(edgeCount);
    for (const edge of fixture.edges) {
      const from = nodes.get(edge.from);
      const to = nodes.get(edge.to);
      expect(from).toBeDefined();
      expect(to).toBeDefined();
      if (!from || !to) throw new Error('Fixture edge references an absent node');
      expect(from.rank).toBeLessThan(to.rank);
      expect(edge.points[0]).toEqual({
        x: from.bounds.x + from.bounds.width,
        y: from.bounds.y + from.bounds.height / 2,
      });
      expect(edge.points.at(-1)).toEqual({
        x: to.bounds.x,
        y: to.bounds.y + to.bounds.height / 2,
      });
    }
    for (const node of fixture.nodes) {
      expect(node.bounds.x).toBeGreaterThanOrEqual(fixture.bounds.x);
      expect(node.bounds.y).toBeGreaterThanOrEqual(fixture.bounds.y);
      expect(node.bounds.x + node.bounds.width).toBeLessThanOrEqual(fixture.bounds.width);
      expect(node.bounds.y + node.bounds.height).toBeLessThanOrEqual(fixture.bounds.height);
    }
  });

  it.each([708, 5000] as const)('generates %i diagram shapes reproducibly', (count) => {
    const fixture = generateSvgDiagram(count);
    expect(fixture.nodes).toHaveLength(count);
    expect(fixture).toEqual(generateSvgDiagram(count, 7));
    expect(fixture).not.toEqual(generateSvgDiagram(count, 8));
    expect(fixture.nodes[0].bounds).toEqual({ x: 0, y: 0, width: 180, height: 96 });
  });

  it('does not share mutable fixture data between calls', () => {
    const fixture = generateLayeredGraph(708, 477);
    expect(fixture).not.toBe(generateLayeredGraph(708, 477));
    expect(fixture.nodes[0]).not.toBe(generateLayeredGraph(708, 477).nodes[0]);
    expect(generateLayeredGraph(708, 0).edges).toEqual([]);
  });

  it.each([-1, 1.5, Infinity, NaN, 708 * 708])('rejects edgeCount %s', (edgeCount) => {
    expect(() => generateLayeredGraph(708, edgeCount)).toThrow(/edgeCount.*received/u);
  });

  it.each([NaN, Infinity, 0.1])('rejects seed %s', (seed) => {
    expect(() => generateLayeredGraph(708, 477, seed)).toThrow(/seed.*received/u);
  });
});

describe('trace statistics', () => {
  const event = (
    name: string,
    ts: number,
    rest: Partial<RendererTraceEvent> = {},
  ): RendererTraceEvent => ({ name, ts, pid: 1, tid: 2, ph: 'I', ...rest });
  const trace = (): RendererTraceEvent[] => [
    event('thread_name', 0, { ph: 'M', args: { name: 'CrRendererMain' } }),
    event('canvas-interaction-start', 1000),
    event('canvas-frame', 1000),
    event('canvas-frame', 11000),
    event('canvas-frame', 21000),
    event('canvas-interaction-end', 21000),
    event('RunTask', 0, { ph: 'X', dur: 3000 }),
    event('RunTask', 2000, { ph: 'X', dur: 4000 }),
    event('ThreadControllerImpl::RunTask', 5000, { ph: 'X', dur: 9000 }),
    event('RunTask', 18000, { ph: 'X', dur: 7000 }),
    event('RunTask', 1000, { ph: 'X', dur: 20000, tid: 3 }),
    event('RunTask', 1000, { ph: 'X', dur: 20000, pid: 3 }),
  ];

  it('uses nearest rank without mutating samples', () => {
    const samples = Array.from({ length: 100 }, (_, index) => 100 - index);
    expect(percentile95(samples)).toBe(95);
    expect(samples[0]).toBe(100);
    expect(percentile95([0])).toBe(0);
  });

  it.each([[], [NaN], [Infinity], [-1]])('rejects invalid samples %j', (samples) => {
    expect(() => percentile95(samples)).toThrow(TypeError);
  });

  it('clips work to frames and unions nested or overlapping main-thread tasks', () => {
    expect(rendererFrameWork(trace())).toEqual([10, 6]);
    expect(rendererFrameWork([...trace()].reverse())).toEqual([10, 6]);
  });

  it('supports custom frame and boundary marks', () => {
    const names = new Map([
      ['canvas-frame', 'custom-frame'],
      ['canvas-interaction-start', 'custom-start'],
      ['canvas-interaction-end', 'custom-end'],
    ]);
    const events = trace().map((sample) => ({
      ...sample,
      name: names.get(sample.name) ?? sample.name,
    }));
    expect(
      rendererFrameWork(events, {
        frame: 'custom-frame',
        start: 'custom-start',
        end: 'custom-end',
      }),
    ).toEqual([10, 6]);
  });

  it('rejects absent frame marks', () => {
    expect(() => rendererFrameWork([])).toThrow(/Frame marks canvas-frame are absent/u);
  });

  it('rejects absent renderer metadata', () => {
    expect(() => rendererFrameWork(trace().filter((sample) => sample.ph !== 'M'))).toThrow(
      'Renderer main thread metadata is absent.',
    );
  });

  it.each(['canvas-interaction-start', 'canvas-interaction-end'])(
    'rejects an absent %s boundary',
    (name) => {
      expect(() => rendererFrameWork(trace().filter((sample) => sample.name !== name))).toThrow(
        /Interaction trace boundaries/u,
      );
    },
  );

  it('rejects reversed interaction boundaries', () => {
    const events = trace().map((sample) =>
      sample.name === 'canvas-interaction-end' ? { ...sample, ts: 500 } : sample,
    );
    expect(() => rendererFrameWork(events)).toThrow(/boundaries.*invalid/u);
  });

  it('rejects incomplete frame or task samples', () => {
    expect(() => rendererFrameWork(trace().filter((sample) => sample.ph !== 'X'))).toThrow(
      'Renderer frame/task samples are absent.',
    );
    expect(() =>
      rendererFrameWork(
        trace().filter((sample) => sample.name !== 'canvas-frame' || sample.ts === 1000),
      ),
    ).toThrow('Renderer frame/task samples are absent.');
  });
});
