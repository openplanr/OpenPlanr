import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PlanningModelNode } from './planning-model.js';

export function useListKeyboardWindow({
  root,
  appearances,
  pageSize,
  setPage,
  selected,
  setSelected,
  selectedId,
  onNavigate,
}: {
  root: RefObject<HTMLDivElement | null>;
  appearances: readonly { node: PlanningModelNode; group: { key: string }; index: number }[];
  pageSize: number;
  setPage: (page: number) => void;
  selected: readonly string[];
  setSelected: (ids: string[]) => void;
  selectedId?: string;
  onNavigate?: (index: number) => void;
}) {
  const anchor = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const [announcement, announce] = useState('');
  useLayoutEffect(() => {
    const target = pending.current;
    if (target === null) return;
    const entry = appearances[target];
    const group = Array.from(
      root.current?.querySelectorAll<HTMLElement>('[data-keyboard-group]') ?? [],
    ).find((group) => group.dataset.keyboardGroup === entry?.group.key);
    const row = Array.from(group?.querySelectorAll<HTMLElement>('[data-keyboard-item]') ?? []).find(
      (row) => row.dataset.keyboardItem === entry?.node.id,
    );
    if (!row) return;
    pending.current = null;
    row.focus({ preventScroll: true });
    row.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  });
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const key = (request: Event) => {
      const { event, target } = (
        request as CustomEvent<{ event: KeyboardEvent; target: Element | null }>
      ).detail;
      const row = target?.closest<HTMLElement>('[data-keyboard-item]');
      const inInspector = target?.closest('.pc-shell-inspector, .pc-inspector-sheet');
      if (event.key !== 'Escape' && target?.closest('button, a, [role="tab"]') && !inInspector)
        return;
      const groupKey = row?.closest<HTMLElement>('[data-keyboard-group]')?.dataset.keyboardGroup;
      let index = appearances.findIndex(
        (entry) =>
          entry.node.id === (row?.dataset.keyboardItem ?? selectedId) &&
          (groupKey === undefined || entry.group.key === groupKey),
      );
      if (event.key === 'Escape') {
        if (!selected.length) return;
        setSelected([]);
        anchor.current = null;
        announce('Selection cleared');
      } else if (event.key === ' ') {
        if (!row || index < 0) return;
        const id = appearances[index].node.id;
        const ids = selected.includes(id)
          ? selected.filter((value) => value !== id)
          : [...selected, id];
        setSelected(ids);
        anchor.current = index;
        announce(`${ids.length} selected`);
      } else {
        const forward = event.key === 'ArrowDown' || event.key.toLowerCase() === 'j';
        const next =
          index < 0 ? (forward ? 0 : appearances.length - 1) : index + (forward ? 1 : -1);
        if (next < 0 || next >= appearances.length) {
          announce('No item in that direction.');
          request.preventDefault();
          return;
        }
        if (event.shiftKey && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
          if (index < 0) index = next;
          anchor.current ??= index;
          setSelected([
            ...new Set(
              appearances
                .slice(Math.min(anchor.current, next), Math.max(anchor.current, next) + 1)
                .map((entry) => entry.node.id),
            ),
          ]);
        } else anchor.current = null;
        pending.current = next;
        onNavigate?.(appearances[next].index);
        setPage(Math.floor(appearances[next].index / pageSize));
        announce(`${appearances[next].node.id}, ${next + 1} of ${appearances.length}`);
      }
      request.preventDefault();
    };
    element.addEventListener('workspace-row-key', key);
    return () => element.removeEventListener('workspace-row-key', key);
  }, [root, appearances, pageSize, setPage, selected, selectedId, setSelected, onNavigate]);
  return announcement;
}

export {
  browserListPreferences,
  type ListPreferenceAdapter,
  useListPresentation,
  usePlanningCopy,
} from '../../lib/routing/planning-presentation.js';
export type { PlanningView } from '../../lib/routing/planning-view-codec.js';
export { useInspectorStore } from '../shell/inspector-selection.js';

export function useListScrollAnchor(
  root: RefObject<HTMLDivElement | null>,
  presentationKey: string,
  revision: unknown,
) {
  const previous = useRef<{
    key: string;
    id: string;
    group: string;
    top: number;
    scrollTop: number;
  } | null>(null);
  useLayoutEffect(() => {
    const scroller = root.current?.querySelector<HTMLElement>('.pc-list__window');
    if (!scroller) return;
    if (!revision) return;
    const rows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-keyboard-item]'));
    let frame: number | null = null;
    const record = () => {
      frame = null;
      const top = scroller.getBoundingClientRect().top;
      // Rows are in vertical document order. Locate the first visible row without
      // measuring the entire mounted page on every scroll.
      let low = 0;
      let high = rows.length;
      const rects = new Map<number, DOMRect>();
      const rect = (index: number) => {
        let value = rects.get(index);
        if (!value) {
          value = rows[index].getBoundingClientRect();
          rects.set(index, value);
        }
        return value;
      };
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (rect(middle).bottom > top + 36) high = middle;
        else low = middle + 1;
      }
      const row = rows[low];
      if (row)
        previous.current = {
          key: presentationKey,
          id: row.dataset.keyboardItem ?? '',
          group: row.closest<HTMLElement>('[data-keyboard-group]')?.dataset.keyboardGroup ?? '',
          top: rect(low).top - top,
          scrollTop: scroller.scrollTop,
        };
    };
    const before = previous.current;
    const row =
      before?.key === presentationKey
        ? rows.find(
            (row) =>
              row.dataset.keyboardItem === before.id &&
              row.closest<HTMLElement>('[data-keyboard-group]')?.dataset.keyboardGroup ===
                before.group,
          )
        : null;
    if (row && before) {
      const offset = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const next = Math.max(0, scroller.scrollTop + offset - before.top);
      // All geometry reads finish before the restore write. Predict the new
      // anchor position rather than reading layout again after changing scroll.
      previous.current = { ...before, top: offset - (next - scroller.scrollTop), scrollTop: next };
      scroller.scrollTop = next;
    } else record();
    const scroll = () => {
      const saved = previous.current;
      const next = scroller.scrollTop;
      if (saved?.key === presentationKey)
        previous.current = { ...saved, top: saved.top - (next - saved.scrollTop), scrollTop: next };
      if (frame === null) frame = requestAnimationFrame(record);
    };
    scroller.addEventListener('scroll', scroll, { passive: true });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', scroll);
    };
  }, [root, presentationKey, revision]);
}

export function useListRowViewport({
  root,
  groups,
  positions,
  pageStart,
  compact,
  grouped,
  collapsedGroups,
  selectedId,
  scope,
}: {
  root: RefObject<HTMLDivElement | null>;
  groups: readonly { key: string; nodes: readonly PlanningModelNode[] }[];
  positions: ReadonlyMap<string, ReadonlyMap<string, number>>;
  pageStart: number;
  compact: boolean;
  grouped: boolean;
  collapsedGroups: readonly string[];
  selectedId?: string;
  scope: string;
}) {
  const [viewport, setViewport] = useState({ scope, top: 0, height: 560, mobile: false });
  const [target, setTarget] = useState<number | null>(null);
  const rowHeight = compact && !viewport.mobile ? 36 : 46;
  const geometry = useMemo(() => {
    let top = 0;
    return groups.map((group) => {
      const header = grouped ? 44 : 0;
      const collapsed = collapsedGroups.includes(group.key);
      const value = { key: group.key, top, body: top + header + 44, nodes: group.nodes, collapsed };
      top += header + (collapsed ? 0 : 44 + group.nodes.length * rowHeight);
      return value;
    });
  }, [groups, grouped, collapsedGroups, rowHeight]);
  const savedTop = viewport.scope === scope ? viewport.top : 0;
  let top = savedTop;
  if (target !== null && target >= pageStart) {
    for (const group of geometry) {
      const index = group.nodes.findIndex(
        (node) => (positions.get(group.key)?.get(node.id) ?? 0) - 1 === target,
      );
      if (index < 0) continue;
      const offset = group.body + index * rowHeight;
      if (offset < top + 44) top = Math.max(0, offset - 44);
      else if (offset + rowHeight > top + viewport.height)
        top = offset + rowHeight - viewport.height;
      break;
    }
  }
  useLayoutEffect(() => {
    const scroller = root.current?.querySelector<HTMLElement>('.pc-list__window');
    if (!scroller) return;
    scroller.scrollTop = top;
    const read = () => {
      setViewport({
        scope,
        top: scroller.scrollTop,
        height: scroller.clientHeight || 560,
        mobile: typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches,
      });
    };
    read();
    const scroll = () => {
      setTarget(null);
      read();
    };
    scroller.addEventListener('scroll', scroll, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', scroll);
      observer?.disconnect();
    };
  }, [root, scope, top]);
  const windows = new Map(
    geometry.map((group) => [
      group.key,
      {
        start: Math.max(0, Math.floor((top - group.body) / rowHeight) - 4),
        end: Math.max(
          0,
          Math.min(
            group.nodes.length,
            Math.ceil((top + viewport.height - group.body) / rowHeight) + 4,
          ),
        ),
        rowHeight,
        retainedId: selectedId,
      },
    ]),
  );
  return { windows, reveal: useCallback((index: number) => setTarget(index), []) };
}
