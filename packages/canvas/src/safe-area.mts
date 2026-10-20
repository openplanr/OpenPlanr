import type { ChromeSurface, Rect } from './types.mjs';

/** Open and close duration of chrome panels; camera moves caused by chrome match it. */
export const CHROME_TRANSITION_MS = 180;

export function computeSafeArea(
  stage: Readonly<{ width: number; height: number }>,
  surfaces: Iterable<ChromeSurface>,
): Rect {
  let top = 0;
  let left = 0;
  let right = stage.width;
  let bottom = stage.height;
  for (const surface of surfaces) {
    if (!surface.open) continue;
    const { rect, edge } = surface;
    if (edge === 'top') top = Math.max(top, rect.y + rect.height);
    else if (edge === 'left') left = Math.max(left, rect.x + rect.width);
    else if (edge === 'right') right = Math.min(right, rect.x);
    else bottom = Math.min(bottom, rect.y);
  }
  const x = Math.min(stage.width, left + 12);
  const y = Math.min(stage.height, top + 12);
  return {
    x,
    y,
    width: Math.max(0, right - 12 - x),
    height: Math.max(0, bottom - 12 - y),
  };
}
