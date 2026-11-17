import type { CanvasController } from '@openplanr/canvas';
import { useChrome } from '@openplanr/canvas/react';
import { type ReactNode, type RefObject, useLayoutEffect, useRef } from 'react';
import { type RouteTool, routeSlotRef } from '../shell/route-tools.js';

const ZOOM_STEP = 1.25;

/**
 * The phone shell has no floating chrome: lenses, fit and zoom sit in one bar under the top bar,
 * and the remaining tools, the focus summary and the Outline open from More.
 */
export function GraphPhoneTools({
  tools,
  canvas,
  children,
}: Readonly<{
  tools: readonly RouteTool[];
  canvas: RefObject<CanvasController | null>;
  children: ReactNode;
}>) {
  const bar = useRef<HTMLDivElement>(null);
  const { registerSurface } = useChrome();
  // A persistent top surface: fits and reveals keep the selection below the bar.
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    return registerSurface('graph-phone-tools', 'top', element, { persistent: true });
  }, [registerSurface]);
  const primary = tools.filter((tool) => tool.group || tool.shortcut);
  const secondary = tools.filter((tool) => !primary.includes(tool));
  const button = (tool: RouteTool) => (
    <button key={tool.id} type="button" aria-pressed={tool.active === true} onClick={tool.run}>
      {tool.glyph ?? tool.label}
    </button>
  );
  return (
    <div ref={bar} className="pc-graph-phone" role="toolbar" aria-label="Graph tools">
      {primary.map(button)}
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => canvas.current?.zoomAt(1 / ZOOM_STEP)}
      >
        −
      </button>
      <button type="button" aria-label="Zoom in" onClick={() => canvas.current?.zoomAt(ZOOM_STEP)}>
        +
      </button>
      <details>
        <summary>More</summary>
        <div className="pc-graph-phone__more">
          {secondary.map(button)}
          <div ref={routeSlotRef('minimap')} />
          {children}
          <div ref={routeSlotRef('outline')} />
        </div>
      </details>
    </div>
  );
}
