import type { CanvasController } from '@openplanr/canvas';
import * as canvasCore from '@openplanr/canvas';
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import { useRouteTools } from '../../../../../apps/dashboard/src/features/shell/route-tools.js';

/** Captures every controller the Graph creates, newest last. */
export function captureCanvasControllers(): CanvasController[] {
  const created: CanvasController[] = [];
  const create = canvasCore.createCanvas;
  vi.spyOn(canvasCore, 'createCanvas').mockImplementation((options) => {
    const controller = create(options);
    created.push(controller);
    return controller;
  });
  return created;
}

/**
 * Gives every canvas stage a measured size; other elements keep jsdom's empty box.
 * Reports reduced motion unless `motion` is set, so camera moves land in one frame.
 */
export function stubStageSize(
  size: { width: number; height: number },
  { motion = false }: { motion?: boolean } = {},
): void {
  if (!motion && !vi.isMockFunction(window.matchMedia)) {
    const media = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
      query === '(prefers-reduced-motion: reduce)'
        ? ({ ...media(query), matches: true } as MediaQueryList)
        : media(query),
    );
  }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('canvas-stage')
      ? new DOMRect(0, 0, size.width, size.height)
      : new DOMRect(0, 0, 0, 0);
  });
}

export function liveController(created: readonly CanvasController[]): CanvasController {
  const controller = created.at(-1);
  if (!controller) throw new Error('The Graph did not create a canvas controller.');
  return controller;
}

/** Waits real animation frames so engine mounts, camera animations and fits settle. */
export async function settleFrames(count = 45): Promise<void> {
  for (let index = 0; index < count; index += 1)
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

/** Stand-in for the floating tool pill: the published route tools as toggle buttons. */
export function RouteToolProbe() {
  const tools = useRouteTools();
  return (
    <div>
      {tools.map((tool) => (
        <button key={tool.id} type="button" aria-pressed={tool.active === true} onClick={tool.run}>
          {tool.label}
        </button>
      ))}
    </div>
  );
}
