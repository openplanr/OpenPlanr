import type { CanvasController } from '@openplanr/canvas';
import { useChrome } from '@openplanr/canvas/react';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { PcIcon } from '../../design-system/components/index.js';
import { type RouteTool, routeSlotRef } from '../shell/route-tools.js';

const ZOOM_STEP = 1.25;
/** Phone-width lens labels; the full names stay the accessible names. */
const SHORT_LABEL: Readonly<Record<string, string>> = {
  'graph.lens.dependencies': 'Deps',
  'graph.lens.project': 'All',
};

/**
 * The phone shell has no floating chrome: lenses, fit and More sit in one bar under the top bar,
 * zoom in its own pill above the bottom navigation, and the remaining tools, the focus summary
 * and the Outline open from More.
 */
export function GraphPhoneTools({
  tools,
  children,
}: Readonly<{
  tools: readonly RouteTool[];
  children: ReactNode;
}>) {
  const bar = useRef<HTMLDivElement>(null);
  const zoom = useRef<HTMLDivElement>(null);
  const { registerSurface } = useChrome();
  const zoomRef = useCallback((element: HTMLDivElement | null) => {
    zoom.current = element;
    routeSlotRef('zoom')(element);
  }, []);
  // Persistent surfaces: fits and reveals keep the selection between the bar and the zoom pill.
  useLayoutEffect(() => {
    const top = bar.current;
    const bottom = zoom.current;
    if (!top || !bottom) return;
    const offTop = registerSurface('graph-phone-tools', 'top', top, { persistent: true });
    const offBottom = registerSurface('graph-phone-zoom', 'bottom', bottom, { persistent: true });
    return () => {
      offTop();
      offBottom();
    };
  }, [registerSurface]);
  const fit = tools.find((tool) => tool.shortcut);
  const lenses = tools.filter((tool) => tool.group);
  const secondary = tools.filter((tool) => tool !== fit && !tool.group);
  const button = (tool: RouteTool) => {
    const short = SHORT_LABEL[tool.id];
    return (
      <button
        key={tool.id}
        type="button"
        aria-label={short ? tool.label : undefined}
        aria-pressed={tool.active === true}
        onClick={tool.run}
      >
        {short ?? tool.glyph ?? tool.label}
      </button>
    );
  };
  return (
    <>
      <div ref={bar} className="pc-graph-phone" role="toolbar" aria-label="Graph tools">
        {lenses.map(button)}
        {fit ? (
          <button type="button" aria-label={fit.label} onClick={fit.run}>
            <PcIcon name="target" size={16} />
          </button>
        ) : null}
        <details>
          <summary aria-label="More">⋮</summary>
          <div className="pc-graph-phone__more">
            {secondary.map(button)}
            <div ref={routeSlotRef('minimap')} />
            {children}
            <div ref={routeSlotRef('outline')} />
          </div>
        </details>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: the zoom pill groups buttons and a readout, not form fields. */}
      <div
        ref={zoomRef}
        className="pc-graph-phone pc-graph-phone__zoom"
        role="group"
        aria-label="Zoom"
      />
    </>
  );
}

/** The phone zoom pill's controls, rendered by the canvas that owns the camera. */
export function GraphZoom({ controller }: Readonly<{ controller: CanvasController }>) {
  const output = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    const update = (camera: Readonly<{ zoom: number }>) => {
      if (output.current) output.current.textContent = `${Math.round(camera.zoom * 100)}%`;
    };
    update(controller.getCamera());
    return controller.on('camera', update);
  }, [controller]);
  return (
    <>
      <button type="button" aria-label="Zoom out" onClick={() => controller.zoomAt(1 / ZOOM_STEP)}>
        <PcIcon name="minus" size={16} />
      </button>
      <output ref={output} aria-label="Zoom percentage" />
      <button type="button" aria-label="Zoom in" onClick={() => controller.zoomAt(ZOOM_STEP)}>
        <PcIcon name="plus" size={16} />
      </button>
    </>
  );
}
