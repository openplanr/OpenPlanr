import { type RefObject, useLayoutEffect, useRef, useState } from 'react';
import type { PlanningModelNode } from './planning-model.js';

export function useListKeyboardWindow({
  root,
  appearances,
  pageSize,
  setPage,
  selected,
  setSelected,
  selectedId,
}: {
  root: RefObject<HTMLDivElement | null>;
  appearances: readonly { node: PlanningModelNode; group: { key: string }; index: number }[];
  pageSize: number;
  setPage: (page: number) => void;
  selected: readonly string[];
  setSelected: (ids: string[]) => void;
  selectedId?: string;
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
        setPage(Math.floor(appearances[next].index / pageSize));
        announce(`${appearances[next].node.id}, ${next + 1} of ${appearances.length}`);
      }
      request.preventDefault();
    };
    element.addEventListener('workspace-row-key', key);
    return () => element.removeEventListener('workspace-row-key', key);
  }, [root, appearances, pageSize, setPage, selected, selectedId, setSelected]);
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
    const mounted = () =>
      Array.from(scroller.querySelectorAll<HTMLElement>('[data-keyboard-item]'));
    const record = () => {
      const top = scroller.getBoundingClientRect().top;
      const row = mounted().find((row) => row.getBoundingClientRect().bottom > top + 36);
      if (row)
        previous.current = {
          key: presentationKey,
          id: row.dataset.keyboardItem ?? '',
          group: row.closest<HTMLElement>('[data-keyboard-group]')?.dataset.keyboardGroup ?? '',
          top: row.getBoundingClientRect().top - top,
          scrollTop: scroller.scrollTop,
        };
    };
    const before = previous.current;
    if (!revision) return;
    if (before?.key === presentationKey) {
      const row = mounted().find(
        (row) =>
          row.dataset.keyboardItem === before.id &&
          row.closest<HTMLElement>('[data-keyboard-group]')?.dataset.keyboardGroup === before.group,
      );
      if (row)
        scroller.scrollTop =
          before.scrollTop +
          row.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          before.top;
    }
    record();
    scroller.addEventListener('scroll', record, { passive: true });
    return () => scroller.removeEventListener('scroll', record);
  }, [root, presentationKey, revision]);
}
