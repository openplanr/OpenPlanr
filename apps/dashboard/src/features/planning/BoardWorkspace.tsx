import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { SelectionBar } from '../../design-system/components/index.js';
import {
  usePlanningCopy,
  usePlanningPresentation,
  usePlanningShortcuts,
} from '../../lib/routing/planning-presentation.js';
import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import { clearInspector, useInspectorStore } from '../shell/inspector-selection.js';
import { BoardColumn, BoardColumnHead } from './BoardColumn.js';
import {
  BoardBlank,
  BoardHeader,
  BoardLaneHead,
  BoardPager,
  BoardStatusTabs,
} from './BoardParts.js';
import {
  retainGraphRevision,
  selectBoardLanes,
  selectBoardProjection,
} from './planning-board-projection.js';
import { boardSelectionItems, useBoardPhoneWidth, useBoardView } from './planning-board-view.js';
import {
  BOARD_COLUMN_CAP,
  BOARD_LANE_PAGE_SIZE,
  type BoardTarget,
  useBoardKeyboard,
} from './planning-board-window.js';
import {
  inspectPlanningNode,
  useLiveListOrder,
  useLiveListSelection,
  usePlanningViewFocus,
} from './planning-inspector.js';
import { PlanningNotice, type PlanningWorkspaceModel } from './planning-workspace.js';

const STATUS_ORDER = ['outstanding', 'in-progress', 'blocked', 'addressed', 'done'];

export function BoardWorkspace({
  model,
  presentation,
}: {
  model: PlanningWorkspaceModel;
  presentation: PlanningView | null;
}) {
  const [doneExpanded, setDoneExpanded] = usePlanningPresentation('board:done', () => false);
  const [page, setPage] = usePlanningPresentation('board:page', () => 0);
  const [expanded, setExpanded] = usePlanningPresentation<readonly string[]>(
    'board:expanded',
    () => [],
  );
  const [chosenStatus, setActiveStatus] = usePlanningPresentation<string | null>(
    'board:status',
    () => null,
  );
  const { swimlanes, changeView, storageNotice } = useBoardView(presentation, setPage);
  const phone = useBoardPhoneWidth();
  const layout = phone ? 'phone' : swimlanes ? 'lanes' : 'columns';
  const inspector = useInspectorStore();
  const selectedId = inspector.selection?.kind === 'node' ? inspector.selection.id : undefined;
  const graph = retainGraphRevision(model.graph, model.binding);
  const projection = selectBoardProjection(graph, presentation, 'status');
  const presentationKey = JSON.stringify([presentation?.filters, presentation?.sort, swimlanes]);
  const items = useLiveListOrder(projection.items, presentationKey);
  const allLanes = selectBoardLanes(graph, items, swimlanes);
  const activeStatus =
    chosenStatus ??
    projection.columns.find((column) => column.nodes.length > 0)?.key ??
    'outstanding';
  const lanes = useMemo(
    () =>
      phone || (swimlanes && !doneExpanded)
        ? allLanes
            .map((lane) => ({
              ...lane,
              columns: lane.columns.filter((column) =>
                phone ? column.key === activeStatus : column.key !== 'done',
              ),
            }))
            .filter((lane) => !swimlanes || lane.columns.some((column) => column.nodes.length > 0))
        : allLanes,
    [allLanes, phone, swimlanes, doneExpanded, activeStatus],
  );
  const pages = Math.max(1, Math.ceil(lanes.length / BOARD_LANE_PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visibleLanes = lanes.slice(
    currentPage * BOARD_LANE_PAGE_SIZE,
    (currentPage + 1) * BOARD_LANE_PAGE_SIZE,
  );
  const missingFocus = usePlanningViewFocus(presentation, graph.nodes);
  const { rootRef, removalNotice } = useLiveListSelection(graph.nodes, items, selectedId);
  const expand = useCallback(
    (cell: string) =>
      setExpanded((current) => (current.includes(cell) ? current : [...current, cell])),
    [setExpanded],
  );
  const reveal = useCallback(
    (target: BoardTarget, status: string) => {
      if (target.id.startsWith('empty:')) return;
      if (status === 'done') setDoneExpanded(true);
      if (target.ordinal >= BOARD_COLUMN_CAP) expand(target.cell);
    },
    [expand, setDoneExpanded],
  );
  const stepped = useRef(false);
  const stepColumn = useCallback(
    (delta: number) => {
      const next = STATUS_ORDER[STATUS_ORDER.indexOf(activeStatus) + delta];
      if (!next) return;
      stepped.current = true;
      setActiveStatus(next);
    },
    [activeStatus, setActiveStatus],
  );
  const { target, notice } = useBoardKeyboard({
    root: rootRef,
    lanes,
    selectedId,
    focusId: presentation?.focusId,
    doneExpanded,
    reveal,
    setPage,
    stepColumn: phone ? stepColumn : undefined,
  });
  useLayoutEffect(() => {
    if (!stepped.current) return;
    stepped.current = false;
    rootRef.current?.querySelector<HTMLElement>('[data-board-cell] [data-keyboard-item]')?.focus();
  });
  const focusStatus = items.find((entry) => entry.id === presentation?.focusId)?.status;
  useEffect(() => {
    if (focusStatus === 'done') setDoneExpanded(true);
    if (phone && focusStatus && STATUS_ORDER.includes(focusStatus)) setActiveStatus(focusStatus);
  }, [phone, focusStatus, setActiveStatus, setDoneExpanded]);
  const selected = useMemo(() => items.find((node) => node.id === selectedId), [items, selectedId]);
  const barItems = useMemo(() => boardSelectionItems(selected), [selected]);
  const copy = usePlanningCopy();
  const shortcuts = usePlanningShortcuts();
  const statusHeads = useMemo(
    () => projection.columns.filter((column) => doneExpanded || column.key !== 'done'),
    [projection.columns, doneExpanded],
  );
  return (
    <div
      ref={rootRef}
      className="op-workspace op-planning op-planning--board pc-pipeline"
      data-route-kind="planning.board"
      data-managed-rows
      data-density={presentation?.density}
      data-board-layout={layout}
    >
      <PlanningNotice presentation={model.presentation} />
      <BoardHeader
        count={items.length}
        lanes={swimlanes}
        phone={phone}
        hideDone={!doneExpanded}
        onView={changeView}
        onHideDone={(hidden) => setDoneExpanded(!hidden)}
      />
      <div className="pc-visually-hidden" role="status" aria-live="polite">
        {notice || removalNotice || missingFocus || storageNotice}
      </div>
      {phone && items.length ? (
        <BoardStatusTabs
          columns={projection.columns}
          value={activeStatus}
          onChange={setActiveStatus}
        />
      ) : null}
      {items.length === 0 ? (
        <BoardBlank filtered={graph.nodes.length > 0} />
      ) : (
        <div
          data-scroll-context="board"
          data-swimlanes={swimlanes}
          data-done-expanded={doneExpanded}
          className="pc-status-board"
        >
          {layout === 'lanes' ? (
            <div className="pc-status-board__lanes-head pc-status-board__lane-grid">
              <span>Spec</span>
              {statusHeads.map((column) => (
                <BoardColumnHead key={column.key} group={column} total={items.length} />
              ))}
            </div>
          ) : null}
          {visibleLanes.map((lane) => (
            <section
              key={lane.key}
              className={
                swimlanes
                  ? 'pc-status-board__lane pc-status-board__lane-grid'
                  : 'pc-status-board__lane'
              }
              aria-label={lane.label}
            >
              {swimlanes ? <BoardLaneHead lane={lane} /> : null}
              <div className="pc-status-board__columns" data-done-expanded={doneExpanded}>
                {lane.columns.map((group) => (
                  <BoardColumn
                    key={group.key}
                    group={group}
                    graph={graph}
                    laneKey={lane.key}
                    laneLabel={swimlanes ? lane.label : null}
                    selectedId={selectedId}
                    collapsed={group.key === 'done' && !doneExpanded && group.nodes.length > 0}
                    expanded={expanded.includes(`${lane.key}:${group.key}`)}
                    head={layout === 'columns' ? items.length : null}
                    layout={layout}
                    toggleDone={() => setDoneExpanded(!doneExpanded)}
                    expand={expand}
                    target={target}
                  />
                ))}
              </div>
            </section>
          ))}
          <BoardPager page={currentPage} pages={pages} lanes={lanes.length} setPage={setPage} />
        </div>
      )}
      <SelectionBar
        items={barItems}
        onCopy={copy}
        shortcutsEnabled={shortcuts}
        onClear={clearInspector}
        onOpen={() => {
          if (selected) inspectPlanningNode(selected);
        }}
      />
    </div>
  );
}
