import type { ChromePanelState } from '@openplanr/canvas/react';

/**
 * Share of a focused element that must stay visible beside floating chrome before a remedy runs.
 * Matches the kit, which reveals a selection once more than half of it is covered.
 */
export const FOCUS_VISIBLE_THRESHOLD = 0.5;

/** Gap kept between a revealed element and the chrome, the kit's safe-area inset. */
const CLEARANCE = 12;

type Box = Readonly<{ left: number; top: number; right: number; bottom: number }>;
type Edge = 'top' | 'bottom' | 'left' | 'right';

/** One open chrome surface over the page, with its panel state when it is a panel. */
export type ChromeCover = Readonly<{
  slot: string;
  edge: Edge;
  rect: Box;
  panel: Readonly<{ id: string; pinned: boolean }> | null;
}>;

const SLOT_EDGES: Readonly<Record<string, Edge>> = {
  menu: 'top',
  toolbar: 'top',
  action: 'top',
  navigation: 'left',
  sidebar: 'right',
  zoom: 'bottom',
  history: 'bottom',
  help: 'bottom',
};

/** Open, visible chrome slots measured from the live layout. */
export function chromeCovers(
  panels: Readonly<Record<string, ChromePanelState>>,
  root: ParentNode = document,
): ChromeCover[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('.canvas-chrome-root [data-chrome-slot]'),
  ).flatMap((element) => {
    const slot = element.dataset.chromeSlot ?? '';
    const edge = SLOT_EDGES[slot];
    // The kit marks closed panels and focus-mode surfaces inert or hidden.
    if (
      !edge ||
      element.hidden ||
      element.inert ||
      getComputedStyle(element).visibility === 'hidden'
    )
      return [];
    const state = panels[slot];
    if ((edge === 'left' || edge === 'right') && !state?.open) return [];
    const { left, top, right, bottom } = element.getBoundingClientRect();
    if (right <= left || bottom <= top) return [];
    return [
      {
        slot,
        edge,
        rect: { left, top, right, bottom },
        panel: state ? { id: slot, pinned: state.pinned } : null,
      },
    ];
  });
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Share of `box` not covered by the union of `covers`; overlapping covers count once. */
export function visibleFraction(box: Box, covers: readonly Box[]): number {
  const area = (box.right - box.left) * (box.bottom - box.top);
  if (area <= 0) return 1;
  const clipped = covers
    .filter((cover) => overlaps(box, cover))
    .map((cover) => ({
      left: Math.max(box.left, cover.left),
      top: Math.max(box.top, cover.top),
      right: Math.min(box.right, cover.right),
      bottom: Math.min(box.bottom, cover.bottom),
    }));
  const xs = [...new Set(clipped.flatMap((cover) => [cover.left, cover.right]))].sort(
    (a, b) => a - b,
  );
  const ys = [...new Set(clipped.flatMap((cover) => [cover.top, cover.bottom]))].sort(
    (a, b) => a - b,
  );
  let covered = 0;
  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let j = 0; j < ys.length - 1; j += 1) {
      const x = ((xs[i] ?? 0) + (xs[i + 1] ?? 0)) / 2;
      const y = ((ys[j] ?? 0) + (ys[j + 1] ?? 0)) / 2;
      if (
        clipped.some(
          (cover) => x > cover.left && x < cover.right && y > cover.top && y < cover.bottom,
        )
      )
        covered += ((xs[i + 1] ?? 0) - (xs[i] ?? 0)) * ((ys[j + 1] ?? 0) - (ys[j] ?? 0));
    }
  }
  return 1 - covered / area;
}

/**
 * Where the owner's decision for a pinned panel over focus plugs in. Returns true once handled;
 * until decided, a pinned panel stays put and the page does not reflow.
 */
export function pinnedPanelCoversFocus(_panelId: string, _target: HTMLElement): boolean {
  return false;
}

function scrolls(element: HTMLElement, horizontal: boolean): boolean {
  const style = getComputedStyle(element);
  const overflow = horizontal ? style.overflowX : style.overflowY;
  return overflow === 'auto' || overflow === 'scroll';
}

/** Next scroller on one axis above `element`; horizontally, the shell's page scroller does not count. */
function scroller(element: HTMLElement, horizontal: boolean): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (horizontal && parent.matches('.pc-shell__scroll, main')) return null;
    if (scrolls(parent, horizontal)) return parent;
  }
  return null;
}

function span(box: Box, horizontal: boolean): readonly [number, number] {
  return horizontal ? [box.left, box.right] : [box.top, box.bottom];
}

/** Signed scroll that moves `target` clear of `cover`, or null when it cannot fit beside it. */
function clearanceDelta(target: HTMLElement, container: HTMLElement, cover: ChromeCover) {
  const horizontal = cover.edge === 'left' || cover.edge === 'right';
  const [start, end] = span(target.getBoundingClientRect(), horizontal);
  const [frameStart, frameEnd] = span(container.getBoundingClientRect(), horizontal);
  const [coverStart, coverEnd] = span(cover.rect, horizontal);
  if (cover.edge === 'right' || cover.edge === 'bottom')
    return end - start > coverStart - CLEARANCE - frameStart ? null : end + CLEARANCE - coverStart;
  return end - start > frameEnd - coverEnd - CLEARANCE ? null : start - CLEARANCE - coverEnd;
}

function sameBox(a: DOMRect, b: DOMRect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/** Adds trailing inline padding; false, and undone, when it would reflow the scroller's content. */
function extendTrailingRange(target: HTMLElement, container: HTMLElement, shortfall: number) {
  const computed = getComputedStyle(container).paddingInlineEnd;
  const padding = Number.parseFloat(computed);
  if (!Number.isFinite(padding))
    throw new Error(`Cannot extend a scroller whose inline-end padding reads "${computed}"`);
  const inline = container.style.paddingInlineEnd;
  const before = target.getBoundingClientRect();
  container.style.paddingInlineEnd = `${padding + shortfall}px`;
  // Fluid content shrinks into new padding; restoring before the next frame paints no shift.
  if (sameBox(before, target.getBoundingClientRect())) return true;
  container.style.paddingInlineEnd = inline;
  return false;
}

/** Scrolls `container` by `delta`, extending a horizontal one's trailing range when it runs out. */
function scrollBy(
  target: HTMLElement,
  container: HTMLElement,
  delta: number,
  horizontal: boolean,
  extended: Map<HTMLElement, string>,
): boolean {
  const position = horizontal ? container.scrollLeft : container.scrollTop;
  const room =
    delta < 0
      ? position
      : (horizontal
          ? container.scrollWidth - container.clientWidth
          : container.scrollHeight - container.clientHeight) - position;
  if (Math.abs(delta) > room) {
    const original = container.style.paddingInlineEnd;
    if (!horizontal || delta < 0 || !extendTrailingRange(target, container, delta - room))
      return false;
    if (!extended.has(container)) extended.set(container, original);
  }
  const [start] = span(target.getBoundingClientRect(), horizontal);
  if (horizontal) container.scrollLeft = position + delta;
  else container.scrollTop = position + delta;
  const [moved] = span(target.getBoundingClientRect(), horizontal);
  if (Math.abs(start - moved - delta) < 1) return true;
  if (horizontal) container.scrollLeft = position;
  else container.scrollTop = position;
  return false;
}

/**
 * Scrolls the nearest scroller on the cover's axis that can move `target` clear of it. A nested
 * horizontal scroller gains trailing range through inline padding, recorded in `extended`.
 */
export function scrollClear(
  target: HTMLElement,
  cover: ChromeCover,
  extended: Map<HTMLElement, string>,
): boolean {
  const horizontal = cover.edge === 'left' || cover.edge === 'right';
  for (
    let container = scroller(target, horizontal);
    container;
    container = scroller(container, horizontal)
  ) {
    const delta = clearanceDelta(target, container, cover);
    if (delta !== null && scrollBy(target, container, delta, horizontal, extended)) return true;
  }
  return false;
}

/**
 * Clears focus that chrome leaves less than the threshold visible: scrolls it clear, else closes an
 * unpinned panel that was open before focus moved, else hands a pinned panel to its branch point.
 */
export function clearFocus(
  target: HTMLElement,
  panels: Readonly<Record<string, ChromePanelState>>,
  openAtFocus: ReadonlySet<string>,
  extended: Map<HTMLElement, string>,
  closePanel: (id: string) => void,
): void {
  const box = target.getBoundingClientRect();
  const covers = chromeCovers(panels).filter(({ rect }) => overlaps(box, rect));
  // Acting only below the threshold while clearing fully keeps small shifts from re-triggering.
  if (
    covers.length === 0 ||
    visibleFraction(
      box,
      covers.map(({ rect }) => rect),
    ) >= FOCUS_VISIBLE_THRESHOLD
  )
    return;
  for (const cover of covers) {
    if (scrollClear(target, cover, extended) || !cover.panel) continue;
    // A panel that opened with this focus, such as the inspector for the focused row, stays.
    if (!cover.panel.pinned && openAtFocus.has(cover.panel.id)) closePanel(cover.panel.id);
    else if (cover.panel.pinned) pinnedPanelCoversFocus(cover.panel.id, target);
  }
}

/** Restores the trailing range of scrollers that no longer hold `focused`. */
export function releaseExtended(extended: Map<HTMLElement, string>, focused: Node | null): void {
  for (const [container, padding] of extended) {
    if (focused && container.contains(focused)) continue;
    container.style.paddingInlineEnd = padding;
    extended.delete(container);
  }
}
