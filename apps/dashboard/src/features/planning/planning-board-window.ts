import { type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BoardLane } from './planning-board-projection.js';
import { inspectPlanningNode } from './planning-inspector.js';
import type { PlanningModelNode } from './planning-model.js';

export const BOARD_LANE_PAGE_SIZE = 6;
export const BOARD_COLUMN_CAP = 4;
export type BoardLayout = 'columns' | 'lanes' | 'phone';
const BOARD_CARD_HEIGHT: Readonly<Record<BoardLayout, number>> = {
  columns: 118,
  lanes: 107,
  phone: 116,
};
const BOARD_CARD_GAP = 8;
export const BOARD_CARD_PITCH = BOARD_CARD_HEIGHT.columns + BOARD_CARD_GAP;
export type BoardTarget = { cell: string; id: string; ordinal: number };
export const boardCellKey = (lane: string, status: string) => `${lane}:${status}`;

export function useBoardCellWindow(
  nodes: readonly PlanningModelNode[],
  selectedId: string | undefined,
  target: BoardTarget | null,
  layout: BoardLayout,
) {
  const gap = BOARD_CARD_GAP;
  const pitch = BOARD_CARD_HEIGHT[layout] + gap;
  const height = BOARD_COLUMN_CAP * pitch;
  const root = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height });
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const before = anchor.current;
    const index = before ? nodes.findIndex((node) => node.id === before.id) : -1;
    if (index >= 0 && before) element.scrollTop = index * pitch + before.offset;
    const read = () => {
      const index = Math.min(nodes.length - 1, Math.floor(element.scrollTop / pitch));
      anchor.current = nodes[index]
        ? { id: nodes[index].id, offset: element.scrollTop - index * pitch }
        : null;
      setViewport({ top: element.scrollTop, height: element.clientHeight || height });
    };
    read();
    element.addEventListener('scroll', read, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    observer?.observe(element);
    return () => {
      element.removeEventListener('scroll', read);
      observer?.disconnect();
    };
  }, [nodes, pitch, height]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !target) return;
    const top = target.ordinal * pitch;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + pitch > element.scrollTop + viewport.height)
      element.scrollTop = top + pitch - viewport.height;
    setViewport((current) => ({ ...current, top: element.scrollTop }));
  }, [target, viewport.height, pitch]);
  const start = Math.max(0, Math.floor(viewport.top / pitch) - 2);
  const end = Math.min(nodes.length, Math.ceil((viewport.top + viewport.height) / pitch) + 2);
  const mounted = useMemo(() => {
    const indices = new Set<number>();
    for (let index = start; index < end; index++) indices.add(index);
    const retained = nodes.findIndex((node) => node.id === selectedId);
    if (retained >= 0) indices.add(retained);
    if (target && nodes[target.ordinal]?.id === target.id) indices.add(target.ordinal);
    return [...indices].sort((a, b) => a - b).map((index) => ({ node: nodes[index], index }));
  }, [nodes, start, end, selectedId, target]);
  return { root, pitch, gap, mounted };
}

function findTarget(root: HTMLElement | null, target: BoardTarget) {
  const cell = Array.from(root?.querySelectorAll<HTMLElement>('[data-board-cell]') ?? []).find(
    (entry) => entry.dataset.boardCell === target.cell,
  );
  return Array.from(cell?.querySelectorAll<HTMLElement>('[data-keyboard-item]') ?? []).find(
    (entry) => entry.dataset.keyboardItem === target.id,
  );
}

type BoardPosition = { lane: number; column: number; ordinal: number };
type BoardPositions = ReadonlyMap<string, BoardPosition>;

function locatePosition(
  lanes: readonly BoardLane[],
  positions: BoardPositions,
  id: string,
  cell?: string,
) {
  const existing = positions.get(id);
  if (existing || !cell) return existing;
  for (const [laneIndex, lane] of lanes.entries()) {
    const column = lane.columns.findIndex((column) => boardCellKey(lane.key, column.key) === cell);
    if (column >= 0) return { lane: laneIndex, column, ordinal: 0 };
  }
  return undefined;
}

function movePosition(
  lanes: readonly BoardLane[],
  position: BoardPosition,
  key: string,
  doneExpanded: boolean,
) {
  let { lane, column, ordinal } = position;
  if (key === 'arrowleft' || key === 'arrowright') {
    column += key === 'arrowleft' ? -1 : 1;
    return { lane, column, ordinal };
  }
  ordinal += key === 'arrowup' || key === 'k' ? -1 : 1;
  const current = lanes[lane].columns[column];
  const count = current.key === 'done' && !doneExpanded ? 1 : current.nodes.length;
  if (ordinal < 0) {
    lane--;
    ordinal = Math.max(0, (lanes[lane]?.columns[column].nodes.length ?? 1) - 1);
  } else if (ordinal >= Math.max(1, count)) {
    lane++;
    ordinal = 0;
  }
  return { lane, column, ordinal };
}

function positionTarget(
  lanes: readonly BoardLane[],
  position: BoardPosition,
  doneExpanded: boolean,
) {
  const lane = lanes[position.lane];
  const column = lane?.columns[position.column];
  if (!column) return null;
  const collapsed = column.key === 'done' && !doneExpanded && column.nodes.length > 0;
  const ordinal = collapsed ? 0 : Math.min(position.ordinal, Math.max(0, column.nodes.length - 1));
  const cell = boardCellKey(lane.key, column.key);
  const node = collapsed ? undefined : column.nodes[ordinal];
  const empty = collapsed ? `${column.nodes.length} done, collapsed` : 'No cards';
  return {
    target: { cell, id: node?.id ?? `empty:${cell}`, ordinal },
    message: node
      ? `${node.id}, ${ordinal + 1} of ${column.nodes.length} in ${column.label}`
      : `${lane.label}, ${column.label}: ${empty}`,
  };
}

function recoveryNode(lanes: readonly BoardLane[], positions: BoardPositions, prior: BoardTarget) {
  const position = positions.get(prior.id);
  if (position) return lanes[position.lane].columns[position.column].nodes[position.ordinal];
  for (const lane of lanes) {
    const column = lane.columns.find((column) => boardCellKey(lane.key, column.key) === prior.cell);
    if (column) return column.nodes[Math.min(prior.ordinal, column.nodes.length - 1)];
  }
  return undefined;
}

function focusFallback(root: HTMLElement | null, prior: BoardTarget) {
  const slot = findTarget(root, { ...prior, id: `empty:${prior.cell}` });
  if (slot) slot.focus({ preventScroll: true });
  else {
    const heading = root?.querySelector<HTMLElement>('h1');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

function copyBoardCommand(element: HTMLElement, announce: (text: string) => void) {
  const button = element.querySelector<HTMLButtonElement>('.pc-selection-bar__copy');
  if (button && !button.disabled) button.click();
  else announce('This item has no command to copy.');
}

function boardKeyRequest(
  request: Event,
  context: {
    element: HTMLElement;
    lanes: readonly BoardLane[];
    positions: BoardPositions;
    selectedId?: string;
    doneExpanded: boolean;
    navigate: (position: BoardPosition, target: BoardTarget) => void;
    announce: (text: string) => void;
    stepColumn?: (delta: number) => void;
  },
) {
  const { event, target: source } = (
    request as CustomEvent<{ event: KeyboardEvent; target: Element | null }>
  ).detail;
  const row = source?.closest<HTMLElement>('[data-keyboard-item]');
  if (!row && !source?.closest('.pc-shell-inspector, .pc-inspector-sheet, .pc-selection-bar'))
    return;
  const key = event.key.toLowerCase();
  if (key === 'c') {
    if (row?.dataset.keyboardItem?.startsWith('empty:')) return;
    copyBoardCommand(context.element, context.announce);
    request.preventDefault();
    return;
  }
  if (!['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'j', 'k'].includes(key)) return;
  if (context.stepColumn && (key === 'arrowleft' || key === 'arrowright')) {
    request.preventDefault();
    context.stepColumn(key === 'arrowleft' ? -1 : 1);
    return;
  }
  const cell = row?.closest<HTMLElement>('[data-board-cell]')?.dataset.boardCell;
  const position = locatePosition(
    context.lanes,
    context.positions,
    row?.dataset.keyboardItem ?? context.selectedId ?? '',
    cell,
  );
  if (!position) return;
  const next = movePosition(context.lanes, position, key, context.doneExpanded);
  const result = positionTarget(context.lanes, next, context.doneExpanded);
  request.preventDefault();
  if (!result) context.announce('No item in that direction.');
  else {
    context.navigate(next, result.target);
    context.announce(result.message);
  }
}

export function useBoardKeyboard({
  root,
  lanes,
  selectedId,
  focusId,
  doneExpanded,
  reveal,
  setPage,
  stepColumn,
}: {
  root: RefObject<HTMLDivElement | null>;
  lanes: readonly BoardLane[];
  selectedId?: string;
  focusId?: string | null;
  doneExpanded: boolean;
  reveal: (target: BoardTarget, status: string) => void;
  setPage: (page: number) => void;
  stepColumn?: (delta: number) => void;
}) {
  const [target, setTarget] = useState<BoardTarget | null>(null);
  const [notice, announce] = useState('');
  const focused = useRef<BoardTarget | null>(null);
  const pending = useRef(false);
  const appliedFocus = useRef('');
  const positions = useMemo(() => {
    const result = new Map<string, BoardPosition>();
    lanes.forEach((lane, laneIndex) => {
      lane.columns.forEach((column, columnIndex) => {
        column.nodes.forEach((node, ordinal) => {
          result.set(node.id, { lane: laneIndex, column: columnIndex, ordinal });
        });
      });
    });
    return result;
  }, [lanes]);
  useLayoutEffect(() => {
    const key = `${focusId}:${lanes[0]?.key}`;
    if (appliedFocus.current === key) return;
    const position = focusId ? positions.get(focusId) : null;
    if (!position || !focusId) return;
    appliedFocus.current = key;
    const lane = lanes[position.lane];
    const column = lane.columns[position.column];
    const next = {
      cell: boardCellKey(lane.key, column.key),
      id: focusId,
      ordinal: position.ordinal,
    };
    reveal(next, column.key);
    setPage(Math.floor(position.lane / BOARD_LANE_PAGE_SIZE));
    setTarget(next);
  }, [focusId, lanes, positions, reveal, setPage]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const remember = (event: FocusEvent) => {
      const row = (event.target as Element)?.closest<HTMLElement>('[data-keyboard-item]');
      const cell = row?.closest<HTMLElement>('[data-board-cell]');
      focused.current =
        row && cell
          ? {
              cell: cell.dataset.boardCell ?? '',
              id: row.dataset.keyboardItem ?? '',
              ordinal: Number(row.closest<HTMLElement>('[data-ordinal]')?.dataset.ordinal ?? 0),
            }
          : null;
    };
    element.addEventListener('focusin', remember);
    return () => element.removeEventListener('focusin', remember);
  }, [root]);
  useLayoutEffect(() => {
    const prior = focused.current;
    if (!prior || prior.id.startsWith('empty:')) return;
    const active = document.activeElement;
    if (active?.isConnected && active !== document.body) return;
    const node = recoveryNode(lanes, positions, prior);
    if (!positions.has(prior.id))
      announce(`${prior.id} was removed from this board.${node ? ` Selected ${node.id}.` : ''}`);
    const next = node ? positions.get(node.id) : null;
    if (!node || !next) {
      focusFallback(root.current, prior);
      return;
    }
    const lane = lanes[next.lane];
    const column = lane.columns[next.column];
    const recovered = {
      cell: boardCellKey(lane.key, column.key),
      id: node.id,
      ordinal: next.ordinal,
    };
    reveal(recovered, column.key);
    setPage(Math.floor(next.lane / BOARD_LANE_PAGE_SIZE));
    setTarget(recovered);
    pending.current = true;
    inspectPlanningNode(node, false);
  }, [lanes, positions, root, reveal, setPage]);
  useLayoutEffect(() => {
    if (!pending.current || !target) return;
    const row = findTarget(root.current, target);
    if (!row) return;
    pending.current = false;
    row.focus({ preventScroll: true });
    row.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  });
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const key = (request: Event) =>
      boardKeyRequest(request, {
        element,
        lanes,
        positions,
        selectedId,
        doneExpanded,
        announce,
        stepColumn,
        navigate: (position, target) => {
          reveal(target, lanes[position.lane].columns[position.column].key);
          setPage(Math.floor(position.lane / BOARD_LANE_PAGE_SIZE));
          pending.current = true;
          setTarget(target);
        },
      });
    element.addEventListener('workspace-row-key', key);
    return () => element.removeEventListener('workspace-row-key', key);
  }, [root, lanes, positions, selectedId, doneExpanded, reveal, setPage, stepColumn]);
  return { target, notice };
}
