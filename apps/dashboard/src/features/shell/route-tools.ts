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
  shortcut?: RouteToolShortcut;
  active?: boolean;
  /** Group tools share one menu in the compact tool pill. */
  group?: string;
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
