import type { KeyboardEvent, ReactNode } from 'react';
import {
  createElement,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { NodeId } from '../index.mjs';
import { useChromeCanvas, useChromeNodeStore } from './chrome-provider.mjs';
import { useCanvasBinding } from './provider.mjs';

export interface OutlinePanelProps {
  ids?: readonly NodeId[];
  rowHeight: number;
  height: number;
  overscan?: number;
  renderRow: (id: NodeId, index: number) => ReactNode;
  label: string;
  onActivate?: (id: NodeId) => void | Promise<void>;
}

const emptyIds: readonly NodeId[] = [];

/** Provides a virtualized flat listbox with roving row focus. */
export function OutlinePanel({
  ids,
  rowHeight,
  height,
  overscan = 3,
  renderRow,
  label,
  onActivate,
}: OutlinePanelProps): ReactNode {
  if (!Number.isFinite(rowHeight) || rowHeight <= 0)
    throw new TypeError(`OutlinePanel rowHeight must be positive: ${rowHeight}`);
  if (!Number.isFinite(height) || height <= 0)
    throw new TypeError(`OutlinePanel height must be positive: ${height}`);
  if (!Number.isInteger(overscan) || overscan < 0)
    throw new TypeError(`OutlinePanel overscan must be a non-negative integer: ${overscan}`);
  const binding = useCanvasBinding();
  const registeredCanvas = useChromeCanvas();
  const nodeStore = useChromeNodeStore();
  const controller = binding?.controller ?? registeredCanvas;
  const list = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<number, HTMLDivElement>());
  const focusPending = useRef(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [active, setActive] = useState<{ id: NodeId | undefined; index: number }>({
    id: undefined,
    index: 0,
  });
  const prefix = useId();
  const store = useMemo(
    () => ({
      subscribe: (notify: () => void) => {
        if (!controller || ids) return () => {};
        const unmount = controller.on('mount', notify);
        const geometry = controller.on('geometry', notify);
        const nodes = binding?.subscribeNodes(notify) ?? nodeStore?.subscribe(notify);
        return () => {
          unmount();
          geometry();
          nodes?.();
        };
      },
      snapshot: () => ids ?? controller?.getOutline() ?? emptyIds,
    }),
    [binding, controller, ids, nodeStore],
  );
  const outline = useSyncExternalStore(store.subscribe, store.snapshot, () => ids ?? emptyIds);
  const found = active.id === undefined ? -1 : outline.indexOf(active.id);
  const current = found < 0 ? Math.min(active.index, Math.max(0, outline.length - 1)) : found;
  const currentId = outline[current];
  useLayoutEffect(() => {
    if (active.id !== currentId || active.index !== current)
      setActive({ id: currentId, index: current });
  }, [active, currentId, current]);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(outline.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  useLayoutEffect(() => {
    if (!focusPending.current) return;
    if (current < start || current >= end) return;
    const row = rows.current.get(current);
    if (row) {
      row.focus({ preventScroll: true });
      focusPending.current = false;
    }
  }, [current, start, end]);
  const move = (index: number) => {
    const next = Math.max(0, Math.min(outline.length - 1, index));
    const element = list.current;
    focusPending.current = true;
    if (element) {
      if (next * rowHeight < element.scrollTop) element.scrollTop = next * rowHeight;
      else if ((next + 1) * rowHeight > element.scrollTop + height)
        element.scrollTop = (next + 1) * rowHeight - height;
      setScrollTop(element.scrollTop);
    }
    setActive({ id: outline[next], index: next });
    if (next === current) {
      rows.current.get(next)?.focus({ preventScroll: true });
      focusPending.current = false;
    }
  };
  const activate = async (id: NodeId) => {
    if (onActivate) await onActivate(id);
    else if (controller) {
      await controller.focusNode(id);
      controller.setSelection([id]);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || !outline.length) return;
    let next: number | undefined;
    switch (event.key) {
      case 'ArrowUp':
        next = current - 1;
        break;
      case 'ArrowDown':
        next = current + 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = outline.length - 1;
        break;
      case 'PageUp':
        next = current - Math.max(1, Math.floor(height / rowHeight));
        break;
      case 'PageDown':
        next = current + Math.max(1, Math.floor(height / rowHeight));
        break;
      case 'Enter':
      case ' ': {
        const id = outline[current];
        if (id !== undefined) void activate(id);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (next !== undefined) move(next);
  };
  return createElement(
    'div',
    {
      ref: list,
      role: 'listbox',
      'aria-label': label,
      tabIndex: outline.length && current >= start && current < end ? -1 : 0,
      onKeyDown,
      onScroll: () => setScrollTop(list.current?.scrollTop ?? 0),
      style: { height, overflowY: 'auto', position: 'relative' },
    },
    createElement(
      'div',
      { role: 'presentation', style: { height: outline.length * rowHeight } },
      ...outline.slice(start, end).map((id, offset) => {
        const index = start + offset;
        return createElement(
          'div',
          {
            key: id,
            id: `${prefix}-${index}`,
            ref: (element: HTMLDivElement | null) => {
              if (element) rows.current.set(index, element);
              else rows.current.delete(index);
            },
            role: 'option',
            'aria-setsize': outline.length,
            'aria-posinset': index + 1,
            'aria-selected': index === current,
            tabIndex: index === current ? 0 : -1,
            onFocus: () => setActive({ id, index }),
            onClick: () => {
              setActive({ id, index });
              void activate(id);
            },
            style: {
              position: 'absolute',
              top: index * rowHeight,
              height: rowHeight,
              left: 0,
              right: 0,
            },
          },
          renderRow(id, index),
        );
      }),
    ),
  );
}
