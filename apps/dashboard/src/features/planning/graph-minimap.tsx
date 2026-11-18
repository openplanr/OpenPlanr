import {
  type CanvasController,
  type CanvasNode,
  drawMinimap,
  type MinimapTransform,
  minimapToWorld,
  type OverviewStyle,
} from '@openplanr/canvas';
import { useChrome } from '@openplanr/canvas/react';
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { SIDEBAR_PANEL } from '../shell/floating-chrome-parts.js';

// The drawing inside the 200 x 128 minimap, less its 5 px padding and 1 px border.
const MINIMAP_WIDTH = 188;
const MINIMAP_HEIGHT = 116;
const EMPTY_VIEWPORT = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

/**
 * Overview and minimap fills per artifact type, read from the Graph tokens.
 * Cached per theme; the cache resets when the document theme or colour scheme changes.
 */
export function useGraphColors(scope: RefObject<HTMLElement | null>): OverviewStyle {
  const cache = useRef(new Map<string, string>());
  useEffect(() => {
    const reset = () => cache.current.clear();
    const observer = new MutationObserver(reset);
    observer.observe(document.documentElement, { attributes: true });
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', reset);
    return () => {
      observer.disconnect();
      scheme.removeEventListener('change', reset);
    };
  }, []);
  return useCallback(
    (node: CanvasNode) => {
      const kind = node.kind ?? 'other';
      let color = cache.current.get(kind);
      if (color === undefined) {
        const style = getComputedStyle(scope.current ?? document.documentElement);
        color =
          style.getPropertyValue(`--pc-graph-node-${kind}`).trim() ||
          style.getPropertyValue('--pc-graph-edge').trim() ||
          'GrayText';
        cache.current.set(kind, color);
      }
      return { fill: color, stroke: color };
    },
    [scope],
  );
}

/** Whole-graph minimap beside help; a click centres the stage on that world point. */
export function GraphMinimap({
  controller,
  nodes,
  style,
  selected,
  stageRoot,
  embedded = false,
}: Readonly<{
  controller: CanvasController;
  nodes: readonly CanvasNode[];
  style: OverviewStyle;
  selected: string | null;
  /** Element containing the canvas stage the minimap mirrors. */
  stageRoot: RefObject<HTMLElement | null>;
  /** Inside the phone tool bar's More: in flow, and not a chrome surface. */
  embedded?: boolean;
}>) {
  const chrome = useChrome();
  const { registerSurface, layout } = chrome;
  const button = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLSpanElement>(null);
  const transform = useRef<MinimapTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const mobile = layout === 'mobile' && !embedded;
  useLayoutEffect(() => {
    const element = button.current;
    if (!element || mobile || embedded) return;
    return registerSurface('graph-minimap', 'bottom', element, { persistent: true });
  }, [registerSurface, mobile, embedded]);
  useLayoutEffect(() => {
    const target = canvas.current;
    const context = target?.getContext('2d');
    if (!target || !context) return;
    const ratio = window.devicePixelRatio || 1;
    target.width = MINIMAP_WIDTH * ratio;
    target.height = MINIMAP_HEIGHT * ratio;
    transform.current = drawMinimap(
      context,
      { nodes, edges: [], selection: [], style, viewport: EMPTY_VIEWPORT },
      { width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT, devicePixelRatio: ratio },
    );
  }, [nodes, style]);
  useEffect(() => {
    const stage = stageRoot.current?.querySelector<HTMLElement>('.canvas-stage');
    if (!stage) return;
    let size = { width: stage.clientWidth, height: stage.clientHeight };
    // Camera frames write only this outline's style; React never renders per frame.
    const draw = () => {
      const frame = viewport.current;
      if (!frame) return;
      const start = controller.screenToWorld({ x: 0, y: 0 });
      const end = controller.screenToWorld({ x: size.width, y: size.height });
      const { scale, offsetX, offsetY } = transform.current;
      frame.style.transform = `translate(${start.x * scale + offsetX}px, ${start.y * scale + offsetY}px)`;
      frame.style.width = `${(end.x - start.x) * scale}px`;
      frame.style.height = `${(end.y - start.y) * scale}px`;
    };
    const observer = new ResizeObserver(() => {
      size = { width: stage.clientWidth, height: stage.clientHeight };
      draw();
    });
    observer.observe(stage);
    draw();
    const off = controller.on('camera', draw);
    return () => {
      off();
      observer.disconnect();
    };
  }, [controller, stageRoot]);
  if (mobile) return null;
  return (
    <button
      ref={button}
      type="button"
      className="pc-graph-minimap"
      data-sidebar-open={(!embedded && chrome.panels[SIDEBAR_PANEL]?.open) || undefined}
      aria-label="Graph minimap, center viewport"
      onClick={(event) => {
        // Keyboard activation has no pointer position: reveal the selection or fit the graph.
        if (event.detail === 0) {
          if (selected) controller.reveal(selected, { mode: 'center' });
          else controller.fit('all', { maxZoom: 1 });
          return;
        }
        const box = canvas.current?.getBoundingClientRect();
        if (!box) return;
        const world = minimapToWorld(transform.current, {
          x: event.clientX - box.left,
          y: event.clientY - box.top,
        });
        const stage = stageRoot.current?.querySelector('.canvas-stage');
        const { zoom } = controller.getCamera();
        controller.setCamera({
          x: world.x - (stage?.clientWidth ?? 0) / 2 / zoom,
          y: world.y - (stage?.clientHeight ?? 0) / 2 / zoom,
          zoom,
        });
      }}
    >
      <canvas ref={canvas} style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }} />
      <span ref={viewport} className="pc-graph-minimap__viewport" aria-hidden="true" />
    </button>
  );
}
