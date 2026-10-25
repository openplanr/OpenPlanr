import type { ReactNode } from 'react';
import { createElement, useLayoutEffect, useRef } from 'react';
import { useChromeBridge } from './chrome-provider.mjs';
import { useCanvas } from './provider.mjs';

export interface CanvasStageProps {
  className?: string;
  children?: ReactNode;
}

/** Attaches the controller to its stage, world, edges and overview layers. */
export function CanvasStage({ className, children }: CanvasStageProps): ReactNode {
  const controller = useCanvas();
  const chrome = useChromeBridge();
  const stage = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const edges = useRef<SVGSVGElement>(null);
  const overview = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (!controller || !stage.current || !world.current || !edges.current || !overview.current)
      return;
    controller.attach({
      stage: stage.current,
      world: world.current,
      edges: edges.current,
      overview: overview.current,
    });
    const unregister = chrome?.registerRegion('canvas', stage.current);
    return () => {
      unregister?.();
      controller.detach();
    };
  }, [controller, chrome]);
  return createElement(
    'div',
    { ref: stage, className: ['canvas-stage', className].filter(Boolean).join(' ') },
    createElement('canvas', {
      ref: overview,
      className: 'canvas-overview',
      'data-canvas-overview': '',
      'aria-hidden': true,
      style: { visibility: 'hidden' },
    }),
    createElement(
      'div',
      { ref: world, className: 'canvas-world', 'data-world': '' },
      createElement('svg', {
        ref: edges,
        className: 'canvas-edges',
        'aria-hidden': true,
      }),
      children,
    ),
  );
}
