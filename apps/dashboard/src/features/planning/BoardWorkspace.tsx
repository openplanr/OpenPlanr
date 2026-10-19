import { useCallback, useEffect, useMemo } from 'react';
import {
  ArtifactStatus,
  Button,
  ChipToggle,
  CommandHint,
  EmptyState,
  SectionHeader,
  Select,
  Toolbar,
  WorkItemChip,
} from '../../design-system/components/index.js';
import {
  usePlanningCopy,
  usePlanningPresentation,
  usePlanningShortcuts,
} from '../../lib/routing/planning-presentation.js';
import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import { useInspectorStore } from '../shell/inspector-selection.js';
import { BoardColumn } from './BoardColumn.js';
import {
  retainGraphRevision,
  selectBoardLanes,
  selectBoardProjection,
} from './planning-board-projection.js';
import { BOARD_LANE_PAGE_SIZE, useBoardKeyboard } from './planning-board-window.js';
import {
  useLiveListOrder,
  useLiveListSelection,
  usePlanningViewFocus,
} from './planning-inspector.js';
import { bulkListCommands } from './planning-list-filter.js';
import { PlanningNotice, type PlanningWorkspaceModel } from './planning-workspace.js';

export function BoardWorkspace({
  model,
  presentation,
}: {
  model: PlanningWorkspaceModel;
  presentation: PlanningView | null;
}) {
  const [swimlanes, setSwimlanes] = usePlanningPresentation(
    'board:swimlanes',
    () => presentation?.groupBy === 'spec',
  );
  const [doneExpanded, setDoneExpanded] = usePlanningPresentation('board:done', () => false);
  const [page, setPage] = usePlanningPresentation('board:page', () => 0);
  const expandDone = useCallback(() => setDoneExpanded(true), [setDoneExpanded]);
  const inspector = useInspectorStore();
  const selectedId = inspector.selection?.kind === 'node' ? inspector.selection.id : undefined;
  const graph = retainGraphRevision(model.graph, model.binding);
  const projection = selectBoardProjection(graph, presentation, 'status');
  const presentationKey = JSON.stringify([presentation?.filters, presentation?.sort, swimlanes]);
  const items = useLiveListOrder(projection.items, presentationKey);
  const lanes = selectBoardLanes(graph, items, swimlanes);
  const pages = Math.max(1, Math.ceil(lanes.length / BOARD_LANE_PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visibleLanes = lanes.slice(
    currentPage * BOARD_LANE_PAGE_SIZE,
    (currentPage + 1) * BOARD_LANE_PAGE_SIZE,
  );
  const missingFocus = usePlanningViewFocus(presentation, graph.nodes);
  const { rootRef, removalNotice } = useLiveListSelection(graph.nodes, items, selectedId);
  const { target, notice } = useBoardKeyboard({
    root: rootRef,
    lanes,
    selectedId,
    focusId: presentation?.focusId,
    doneExpanded,
    expandDone,
    setPage,
  });
  const selected = useMemo(() => items.find((node) => node.id === selectedId), [items, selectedId]);
  const statusCopy = useMemo(
    () => (selected ? bulkListCommands([selected], selected.status) : null),
    [selected],
  );
  const copy = usePlanningCopy();
  const shortcuts = usePlanningShortcuts();
  useEffect(() => {
    if (!presentation) return;
    setSwimlanes(presentation.groupBy === 'spec');
    if (!presentation.focusId) setPage(0);
  }, [presentation, setPage, setSwimlanes]);
  return (
    <div
      ref={rootRef}
      className="op-workspace op-planning op-planning--board pc-pipeline"
      data-route-kind="planning.board"
      data-managed-rows
      data-density={presentation?.density}
    >
      <PlanningNotice presentation={model.presentation} />
      <SectionHeader
        headingLevel={1}
        eyebrow="Plan"
        title="Board"
        count={`${items.length} artifacts`}
        description="Read-only · cards do not drag"
      />
      <div className="pc-visually-hidden" role="status" aria-live="polite">
        {notice || removalNotice || missingFocus}
      </div>
      <Toolbar>
        <Select
          ariaLabel="Columns"
          value="status"
          onChange={() => undefined}
          options={[{ value: 'status', label: 'Columns: status' }]}
        />
        <Select
          value={swimlanes ? 'spec' : 'none'}
          onChange={(value) => {
            setSwimlanes(value === 'spec');
            setPage(0);
          }}
          options={[
            { value: 'none', label: 'Lanes: none' },
            { value: 'spec', label: 'Lanes: spec' },
          ]}
          ariaLabel="Swimlanes"
          size="sm"
          clearValue="none"
        />
        <ChipToggle checked={!doneExpanded} onChange={(hidden) => setDoneExpanded(!hidden)}>
          Hide done
        </ChipToggle>
      </Toolbar>
      {items.length === 0 ? (
        <div className="pc-status-board__blank">
          <EmptyState
            icon="columns-3"
            title={graph.nodes.length ? 'No matching artifacts' : 'No artifacts yet'}
            description={
              graph.nodes.length
                ? 'The shared presentation filters exclude all Board cards. Open Board without filters to see the full plan.'
                : 'The board fills in as the plan gains artifacts.'
            }
            action={
              graph.nodes.length ? (
                <a href="#/board" className="op-inline-action">
                  Clear filters
                </a>
              ) : (
                <CommandHint command="/planr:spec" label="Shape the next spec" size="sm" />
              )
            }
          />
        </div>
      ) : (
        <div data-scroll-context="board" className="pc-status-board">
          <section
            className="pc-status-board__totals"
            data-done-expanded={doneExpanded}
            aria-label="Status totals"
          >
            {projection.columns.map((column) => (
              <div key={column.key}>
                <ArtifactStatus status={column.key} size="sm" />
                <span>{column.nodes.length}</span>
              </div>
            ))}
          </section>
          {visibleLanes.map((lane) => (
            <section key={lane.key} className="pc-status-board__lane" aria-label={lane.label}>
              {swimlanes ? (
                <header className="pc-status-board__lane-head">
                  {lane.spec ? <WorkItemChip type="spec" id={lane.key} /> : null}
                  <h2>{lane.spec?.title ?? lane.label}</h2>
                  <span>{lane.nodes.length} artifacts</span>
                  {lane.spec ? (
                    <span>
                      {lane.progress?.total
                        ? `${lane.progress.done} of ${lane.progress.total} tasks done`
                        : 'No tasks'}
                    </span>
                  ) : null}
                  {lane.spec && lane.progress?.total ? (
                    <progress
                      aria-label={`${lane.key} task progress`}
                      value={lane.progress.done}
                      max={lane.progress.total}
                    />
                  ) : null}
                </header>
              ) : null}
              <div className="pc-status-board__columns" data-done-expanded={doneExpanded}>
                {lane.columns.map((group) => (
                  <BoardColumn
                    key={group.key}
                    group={group}
                    laneKey={lane.key}
                    selectedId={selectedId}
                    collapsed={
                      group.key === 'done' && doneExpanded === false && group.nodes.length > 0
                    }
                    expandDone={expandDone}
                    target={target}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <div className="pc-status-board__pager">
        {pages > 1 ? (
          <>
            <Button
              size="sm"
              disabled={currentPage === 0}
              disabledReason={currentPage === 0 ? 'First page of spec lanes' : undefined}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous lanes
            </Button>
            <span>
              Lanes {currentPage * BOARD_LANE_PAGE_SIZE + 1}-
              {Math.min(lanes.length, (currentPage + 1) * BOARD_LANE_PAGE_SIZE)} of {lanes.length}
            </span>
            <Button
              size="sm"
              disabled={currentPage + 1 === pages}
              disabledReason={currentPage + 1 === pages ? 'Last page of spec lanes' : undefined}
              onClick={() => setPage(currentPage + 1)}
            >
              Next lanes
            </Button>
          </>
        ) : null}
      </div>
      <div className="pc-status-board__command">
        <CommandHint
          command={statusCopy?.commands[0] ?? ''}
          label="Copy status command"
          disabled={!statusCopy?.commands.length}
          disabledReason={
            statusCopy?.skipped[0] ??
            (selected ? undefined : 'Focus a card to inspect its status command.')
          }
          onCopy={copy}
          shortcutsEnabled={shortcuts}
          size="sm"
        />
      </div>
      <p className="pc-status-board__proposal">
        Proposed for Phase 2: drag a card to copy a status command, with a keyboard equivalent.
        Cards remain read-only.
      </p>
    </div>
  );
}
