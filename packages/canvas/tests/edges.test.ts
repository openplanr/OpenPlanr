// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildEdgeRoutes, createEdgeLayer, validateEdgeEndpoints } from '../src/edges.mjs';
import type { CanvasNode } from '../src/types.mjs';

const nodes: CanvasNode[] = [
  { id: 'a', bounds: { x: -110, y: 0, width: 20, height: 20 } },
  { id: 'b', bounds: { x: 190, y: 20, width: 20, height: 20 } },
  { id: 'c', bounds: { x: 1000, y: 1000, width: 20, height: 20 } },
];
const region = { x: 0, y: 0, width: 100, height: 100 };

describe('route culling and batching', () => {
  it('returns empty routes without reading nodes when there are no edges', () => {
    const untouched: Iterable<CanvasNode> = {
      [Symbol.iterator]() {
        throw new Error('nodes were indexed');
      },
    };
    const routes = buildEdgeRoutes(untouched, [], region);
    expect(routes.paths.size).toBe(0);
    expect(routes.bounds).toBeNull();
    expect(routes.diagnostics).toEqual([]);
  });

  it('batches segments by style and keeps a crossing with both endpoints outside', () => {
    const routes = buildEdgeRoutes(
      nodes,
      [
        { id: 'crossing', from: 'a', to: 'b', style: 'normal' },
        {
          id: 'bend',
          from: 'b',
          to: 'c',
          style: 'normal',
          points: [
            { x: 50, y: 50 },
            { x: 500, y: 500 },
          ],
        },
        { id: 'other', from: 'a', to: 'b', style: 'dashed' },
        { id: 'outside', from: 'b', to: 'c', style: 'outside' },
      ],
      region,
    );
    expect(routes.paths.size).toBe(2);
    expect(routes.paths.get('normal')).toBe('M-100 10 L200 30 M50 50 L500 500');
    expect(routes.paths.get('dashed')).toBe('M-100 10 L200 30');
    expect(routes.bounds).toEqual({ x: -100, y: 10, width: 600, height: 490 });
  });

  it('culls using every point of the route instead of the endpoints', () => {
    const routes = buildEdgeRoutes(
      nodes,
      [
        {
          id: 'detour',
          from: 'b',
          to: 'c',
          style: 'route',
          points: [
            { x: 200, y: 200 },
            { x: 20, y: 20 },
            { x: 1000, y: 1000 },
          ],
        },
      ],
      region,
    );
    expect(routes.paths.get('route')).toBe('M200 200 L20 20 L1000 1000');
  });

  it('reports the unresolved edge and endpoint and throws in strict mode', () => {
    const edges = [{ id: 'broken', from: 'missing', to: 'b', style: 'normal' }];
    expect(validateEdgeEndpoints(nodes, edges)).toEqual([
      {
        code: 'unknown-endpoint',
        id: 'broken',
        reason: 'Edge broken references unknown endpoint missing',
      },
    ]);
    expect(() => buildEdgeRoutes(nodes, edges, region, true)).toThrow(TypeError);
    expect(() => validateEdgeEndpoints(nodes, edges, true)).toThrow(/broken.*missing/u);
    expect(buildEdgeRoutes(nodes, edges, region).paths.size).toBe(0);
  });

  it('rejects malformed routes and duplicate edge IDs', () => {
    expect(() =>
      buildEdgeRoutes(
        nodes,
        [{ id: 'bad', from: 'a', to: 'b', style: 'normal', points: [] }],
        region,
      ),
    ).toThrow(/bad.points/u);
    expect(() =>
      buildEdgeRoutes(
        nodes,
        [
          {
            id: 'bad',
            from: 'a',
            to: 'b',
            style: 'normal',
            points: [
              { x: 0, y: 0 },
              { x: NaN, y: 1 },
            ],
          },
        ],
        region,
      ),
    ).toThrow(/points\[1\].x/u);
    const edge = { id: 'duplicate', from: 'a', to: 'b', style: 'normal' };
    expect(() => buildEdgeRoutes(nodes, [edge, edge], region)).toThrow(/edge.id.*duplicate/u);
  });
});

describe('SVG route layer', () => {
  it('sizes the SVG to drawn routes, reuses style paths and removes obsolete paths', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '77');
    svg.style.color = 'red';
    const originalStyle = svg.getAttribute('style');
    const layer = createEdgeLayer(svg);
    const edges = [
      { id: 'first', from: 'a', to: 'b', style: 'normal' },
      { id: 'second', from: 'a', to: 'b', style: 'normal' },
    ];
    layer.update(buildEdgeRoutes(nodes, edges, region));
    expect(svg.querySelectorAll('path')).toHaveLength(1);
    const path = svg.querySelector('path');
    expect(path?.getAttribute('d')?.match(/M/gu)).toHaveLength(2);
    expect(svg.getAttribute('viewBox')).toBe('-100 10 300 20');
    expect(svg.style.left).toBe('-100px');
    expect(svg.style.top).toBe('10px');
    expect(svg.style.width).toBe('300px');
    expect(svg.style.height).toBe('20px');
    expect(svg.style.overflow).toBe('hidden');
    layer.update(buildEdgeRoutes(nodes, edges.slice(0, 1), region));
    expect(svg.querySelector('path')).toBe(path);
    layer.update(buildEdgeRoutes(nodes, [], region));
    expect(svg.querySelectorAll('path')).toHaveLength(0);
    layer.dispose();
    expect(svg.getAttribute('width')).toBe('77');
    expect(svg.getAttribute('style')).toBe(originalStyle);
  });

  it.each([
    [{ x: 10, y: 20 }, { x: 100, y: 20 }, '10 19.5 90 1'],
    [{ x: 10, y: 20 }, { x: 10, y: 100 }, '9.5 20 1 80'],
  ] as const)('gives a flat route a nonzero viewport', (from, to, viewBox) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const layer = createEdgeLayer(svg);
    layer.update(
      buildEdgeRoutes(
        nodes,
        [{ id: 'flat', from: 'a', to: 'b', style: 'normal', points: [from, to] }],
        region,
      ),
    );
    expect(svg.querySelectorAll('path')).toHaveLength(1);
    expect(svg.getAttribute('viewBox')).toBe(viewBox);
    expect(Number(svg.getAttribute('width'))).toBeGreaterThan(0);
    expect(Number(svg.getAttribute('height'))).toBeGreaterThan(0);
  });
  it('provides a bounded child SVG for a group target', () => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const layer = createEdgeLayer(group);
    layer.update(
      buildEdgeRoutes(nodes, [{ id: 'crossing', from: 'a', to: 'b', style: 'normal' }], region),
    );
    expect(group.querySelector('svg')?.getAttribute('viewBox')).toBe('-100 10 300 20');
    layer.dispose();
    expect(group.children).toHaveLength(0);
  });
});
