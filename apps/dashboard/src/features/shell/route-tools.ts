import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { PcIconName } from '../../design-system/components/index.js';

/** Physical key binding shared by the keyboard coordinator and the chrome's shortcut hints. */
export type RouteToolShortcut = Readonly<{
  code: string;
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}>;

/** List view bindings; the coordinator matches `key` and the tool pill formats `code`. */
export const LIST_TOOL_SHORTCUTS = Object.freeze({
  groupSpec: { code: 'Digit1', key: '1' },
  groupStatus: { code: 'Digit2', key: '2' },
  groupType: { code: 'Digit3', key: '3' },
  filter: { code: 'KeyF', key: 'f' },
  density: { code: 'KeyD', key: 'd' },
  collapse: { code: 'BracketLeft', key: '[' },
  expand: { code: 'BracketRight', key: ']' },
} satisfies Record<string, RouteToolShortcut>);

/** A view control a route publishes into the floating tool pill. */
export type RouteTool = Readonly<{
  id: string;
  label: string;
  icon?: PcIconName;
  /** Short visible text in place of an icon, such as an artifact prefix. */
  glyph?: string;
  shortcut?: RouteToolShortcut;
  active?: boolean;
  /** Group tools share one menu in the compact tool pill. */
  group?: string;
  /** Names the group in the compact tool pill; defaults to "Group by". */
  groupLabel?: string;
  run: () => void;
}>;

const EMPTY: readonly RouteTool[] = Object.freeze([]);
let tools: readonly RouteTool[] = EMPTY;
const listeners = new Set<() => void>();

function publish(next: readonly RouteTool[]): void {
  tools = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publishes the mounted route's tools; handlers always run the latest render's closure. */
export function usePublishRouteTools(next: readonly RouteTool[]): void {
  const latest = useRef(next);
  latest.current = next;
  const signature = next
    .map((tool) => `${tool.id}\u0000${tool.label}\u0000${tool.active === true}`)
    .join('\u0001');
  // biome-ignore lint/correctness/useExhaustiveDependencies: republish only when the visible tool model changes.
  useEffect(() => {
    const published = Object.freeze(
      latest.current.map((tool) => ({
        ...tool,
        run: () => latest.current.find((current) => current.id === tool.id)?.run(),
      })),
    );
    publish(published);
    return () => {
      if (tools === published) publish(EMPTY);
    };
  }, [signature]);
}

export function useRouteTools(): readonly RouteTool[] {
  return useSyncExternalStore(
    subscribe,
    () => tools,
    () => tools,
  );
}

/** Runs a published tool by ID; false when the current route has no such tool. */
export function runRouteTool(id: string): boolean {
  const tool = tools.find((candidate) => candidate.id === id);
  if (!tool) return false;
  tool.run();
  return true;
}

/** Chrome places a route may render into: the left panel, the Outline tab, phone minimap and zoom. */
export type RouteSlotName = 'panel' | 'outline' | 'minimap' | 'zoom';

const slots = new Map<RouteSlotName, HTMLElement>();
let canvasMounted = false;
const slotListeners = new Set<() => void>();

function notifySlots(): void {
  for (const listener of slotListeners) listener();
}

function subscribeSlots(listener: () => void): () => void {
  slotListeners.add(listener);
  return () => {
    slotListeners.delete(listener);
  };
}

const slotRefs = new Map<RouteSlotName, (element: HTMLElement | null) => void>();

/** Stable callback ref for a chrome element that hosts route content. */
export function routeSlotRef(name: RouteSlotName): (element: HTMLElement | null) => void {
  let ref = slotRefs.get(name);
  if (!ref) {
    ref = (element) => {
      if (element) slots.set(name, element);
      else if (slots.get(name)) slots.delete(name);
      notifySlots();
    };
    slotRefs.set(name, ref);
  }
  return ref;
}

/** The mounted chrome element for a route slot, or null when the shell has none. */
export function useRouteSlot(name: RouteSlotName): HTMLElement | null {
  return useSyncExternalStore(
    subscribeSlots,
    () => slots.get(name) ?? null,
    () => null,
  );
}

/** Marks a canvas stage as mounted so the shell defers focus regions and dismissal to the kit. */
export function usePublishCanvasRoute(mounted: boolean): void {
  useEffect(() => {
    if (!mounted) return;
    canvasMounted = true;
    notifySlots();
    return () => {
      canvasMounted = false;
      notifySlots();
    };
  }, [mounted]);
}

/** True while a route renders a canvas stage. */
export function useCanvasRoute(): boolean {
  return useSyncExternalStore(
    subscribeSlots,
    () => canvasMounted,
    () => false,
  );
}
