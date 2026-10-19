import { invalid, point } from './camera.mjs';
import { intersects } from './spatial-grid.mjs';
import type { CanvasEdge, CanvasNode, Diagnostic, Point, Rect } from './types.mjs';

export type EdgeRoutes = Readonly<{
  paths: ReadonlyMap<string, string>;
  bounds: Rect | null;
  diagnostics: readonly Diagnostic[];
}>;

function boundsOf(points: readonly Point[]): Rect {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const value of points) {
    left = Math.min(left, value.x);
    top = Math.min(top, value.y);
    right = Math.max(right, value.x);
    bottom = Math.max(bottom, value.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function buildEdgeRoutes(
  nodes: Iterable<CanvasNode>,
  edges: readonly CanvasEdge[],
  region: Rect,
  strict = false,
): EdgeRoutes {
  const byId = new Map(Array.from(nodes, (node) => [node.id, node]));
  const grouped = new Map<string, string[]>();
  const diagnostics: Diagnostic[] = [];
  const drawnBounds: Point[] = [];
  const ids = new Set<string>();
  for (const edge of edges) {
    if (!edge || typeof edge !== 'object') invalid('edge', edge);
    for (const field of ['id', 'from', 'to', 'style'] as const) {
      if (typeof edge[field] !== 'string' || !edge[field].length)
        invalid(`edge.${field}`, edge[field]);
    }
    if (ids.has(edge.id)) invalid('edge.id', edge.id);
    ids.add(edge.id);
    if (edge.points !== undefined) {
      if (!Array.isArray(edge.points) || edge.points.length < 2)
        invalid(`edge.${edge.id}.points`, edge.points);
      edge.points.forEach((value, index) => {
        point(`edge.${edge.id}.points[${index}]`, value);
      });
    }
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) {
      const unknown = [!from ? edge.from : null, !to ? edge.to : null].filter((id) => id !== null);
      const reason = `Edge ${edge.id} references unknown endpoint ${unknown.join(', ')}`;
      if (strict) throw new TypeError(`edge.${edge.id}: ${reason}`);
      diagnostics.push({ code: 'unknown-endpoint', id: edge.id, reason });
      continue;
    }
    const points = edge.points ?? [
      { x: from.bounds.x + from.bounds.width / 2, y: from.bounds.y + from.bounds.height / 2 },
      { x: to.bounds.x + to.bounds.width / 2, y: to.bounds.y + to.bounds.height / 2 },
    ];
    const bounds = boundsOf(points);
    if (!intersects(bounds, region)) continue;
    drawnBounds.push(
      { x: bounds.x, y: bounds.y },
      {
        x: bounds.x + bounds.width,
        y: bounds.y + bounds.height,
      },
    );
    const path = points
      .map((value, index) => `${index === 0 ? 'M' : 'L'}${value.x} ${value.y}`)
      .join(' ');
    const paths = grouped.get(edge.style);
    if (paths) paths.push(path);
    else grouped.set(edge.style, [path]);
  }
  return {
    paths: new Map(Array.from(grouped, ([style, paths]) => [style, paths.join(' ')])),
    bounds: drawnBounds.length ? boundsOf(drawnBounds) : null,
    diagnostics,
  };
}

export function validateEdgeEndpoints(
  nodes: Iterable<CanvasNode>,
  edges: readonly CanvasEdge[],
  strict = false,
): readonly Diagnostic[] {
  return buildEdgeRoutes(nodes, edges, { x: 0, y: 0, width: 0, height: 0 }, strict).diagnostics;
}

export function createEdgeLayer(element: SVGSVGElement | SVGGElement): {
  update(routes: EdgeRoutes): void;
  dispose(): void;
} {
  const document = element.ownerDocument;
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = element.localName === 'svg' ? element : document.createElementNS(namespace, 'svg');
  if (svg !== element) element.append(svg);
  const paths = new Map<string, SVGPathElement>();
  const attributes = new Map(
    ['x', 'y', 'width', 'height', 'viewBox'].map((name) => [name, svg.getAttribute(name)]),
  );
  const originalStyle = svg.getAttribute('style');
  Object.assign(svg.style, { position: 'absolute', overflow: 'hidden', pointerEvents: 'none' });
  return {
    update(routes) {
      const routeBounds = routes.bounds;
      // Flat routes still need room for their stroke inside the SVG viewport.
      const bounds = routeBounds
        ? {
            x: routeBounds.x - (routeBounds.width === 0 ? 0.5 : 0),
            y: routeBounds.y - (routeBounds.height === 0 ? 0.5 : 0),
            width: routeBounds.width || 1,
            height: routeBounds.height || 1,
          }
        : { x: 0, y: 0, width: 0, height: 0 };
      svg.setAttribute('x', String(bounds.x));
      svg.setAttribute('y', String(bounds.y));
      svg.setAttribute('width', String(bounds.width));
      svg.setAttribute('height', String(bounds.height));
      svg.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
      Object.assign(svg.style, {
        left: `${bounds.x}px`,
        top: `${bounds.y}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      });
      for (const [style, path] of paths) {
        if (!routes.paths.has(style)) {
          path.remove();
          paths.delete(style);
        }
      }
      for (const [style, data] of routes.paths) {
        let path = paths.get(style);
        if (!path) {
          path = document.createElementNS(namespace, 'path');
          path.setAttribute('data-canvas-edge-style', style);
          path.setAttribute('class', style);
          path.setAttribute('fill', 'none');
          svg.append(path);
          paths.set(style, path);
        }
        if (path.getAttribute('d') !== data) path.setAttribute('d', data);
      }
    },
    dispose() {
      for (const path of paths.values()) path.remove();
      if (svg !== element) svg.remove();
      else {
        for (const [name, value] of attributes) {
          if (value === null) svg.removeAttribute(name);
          else svg.setAttribute(name, value);
        }
        if (originalStyle === null) svg.removeAttribute('style');
        else svg.setAttribute('style', originalStyle);
      }
    },
  };
}
