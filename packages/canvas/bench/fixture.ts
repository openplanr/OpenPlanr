import type { CanvasNode } from '../src/index.mts';
import { generateLayeredGraph, generateSvgDiagram } from '../src/testing/index.mts';

export function readBenchFixture(params: URLSearchParams) {
  const fixtureName = params.get('fixture') ?? '708-997';
  const validFixtures = ['708-477', '708-997', '5000-8499', '5000-7312', 'svg-708', 'svg-5000', 'stress-50000'];
  if (!validFixtures.includes(fixtureName)) throw new TypeError(`fixture: ${fixtureName}`);
  const fixture = fixtureName === 'stress-50000'
    ? {
        nodes: Array.from({ length: 50_000 }, (_, index) => ({
          id: `node-${index + 1}`, title: `Stress ${index + 1}`, rank: Math.floor(index / 250),
          bounds: { x: Math.floor(index / 250) * 294, y: (index % 250) * 94, width: 230, height: 66 },
        })),
        edges: [],
        bounds: { x: 0, y: 0, width: 199 * 294 + 230, height: 249 * 94 + 66 },
      }
    : fixtureName.startsWith('svg-')
    ? generateSvgDiagram(fixtureName === 'svg-708' ? 708 : 5000)
    : generateLayeredGraph(
        fixtureName.startsWith('708-') ? 708 : 5000,
        Number(fixtureName.split('-')[1]),
      );
  const worldType = params.get('world') ?? 'html';
  if (worldType !== 'html' && worldType !== 'svg') throw new TypeError(`world: ${worldType}`);
  const overviewRenderer = params.get('overviewRenderer') ?? 'canvas';
  if (overviewRenderer !== 'canvas' && overviewRenderer !== 'worker')
    throw new TypeError(`overviewRenderer: ${overviewRenderer}`);
  const pointerMode = params.get('pointerMode') ?? 'pan';
  if (pointerMode !== 'pan' && pointerMode !== 'none')
    throw new TypeError(`pointerMode: ${pointerMode}`);
  let nodes: readonly CanvasNode[] = fixture.nodes.map(({ id, bounds }) => ({ id, bounds }));
  const frameCount = Number(params.get('frames') ?? (params.get('frame') === '1' ? 1 : 0));
  if (!Number.isInteger(frameCount) || frameCount < 0 || frameCount > 15)
    throw new TypeError(`frames: ${frameCount}`);
  if (frameCount > 0) {
    if (worldType !== 'html') throw new TypeError('frames: requires html world');
    nodes = [
      ...nodes,
      ...Array.from({ length: frameCount }, (_, index) => ({
        id: index === 0 ? 'preview-frame' : `preview-frame-${index + 1}`,
        bounds: {
          x: 80 + (index % 5) * 240,
          y: 80 + Math.floor(index / 5) * 240,
          width: frameCount === 1 ? 320 : 220,
          height: 200,
        },
        frame: true,
      })),
    ];
  }
  return { fixtureName, fixture, worldType, overviewRenderer, pointerMode, nodes } as const;
}
