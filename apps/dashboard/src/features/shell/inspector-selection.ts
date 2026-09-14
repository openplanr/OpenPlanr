import { useSyncExternalStore } from 'react';

/*
 * The global inspector shows whatever a page last selected. Pages push a snapshot of the
 * real record (never a re-derived one); the shell renders it. Kept outside React context so
 * the pinned route-composition facades need no new props.
 */

export type InspectorNodeSnapshot = Readonly<{
  kind: 'node';
  id: string;
  type: string;
  title: string;
  status: string;
  sprintId: string | null;
  updated: string | null;
  dependsOn: readonly string[];
  ref: string | null;
  href: string | null;
}>;

export type InspectorActionSnapshot = Readonly<{
  kind: 'action';
  actionId: string;
  title: string;
  state: string;
  revision: number | string;
  route: string | null;
  executions: number;
  deepLink: string | null;
  href: string | null;
}>;

export type InspectorSelection = InspectorNodeSnapshot | InspectorActionSnapshot | null;

export type InspectorStore = Readonly<{ selection: InspectorSelection; openTick: number }>;

let store: InspectorStore = Object.freeze({ selection: null, openTick: 0 });
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Select a record for the inspector and ask the shell to open it. */
export function selectInspector(selection: InspectorNodeSnapshot | InspectorActionSnapshot): void {
  store = Object.freeze({ selection, openTick: store.openTick + 1 });
  emit();
}

export function clearInspector(): void {
  if (store.selection === null) return;
  store = Object.freeze({ selection: null, openTick: store.openTick });
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInspectorStore(): InspectorStore {
  return useSyncExternalStore(
    subscribe,
    () => store,
    () => store,
  );
}
