import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Card,
  CommandHint,
  DataTable,
  EmptyState,
  SelectionBar,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import { ListCheckbox, ListEmpty, ListGroupHeader, ListPagination } from './ListTableParts.js';
import { ListTitle, ListToolbar } from './ListToolbar.js';
import { LIST_COLUMNS } from './planning-columns.js';
import {
  inspectPlanningNode,
  useLiveListOrder,
  useLiveListSelection,
  usePlanningViewFocus,
} from './planning-inspector.js';
import {
  retainGraphRevision,
  selectListGroups,
  selectListMetadata,
  selectListProjection,
} from './planning-list-projection.js';
import {
  type ListClearableFilter,
  listActiveFilterCount,
  listFilterSentence,
  listSelectionItems,
} from './planning-list-view.js';
import {
  browserListPreferences,
  clearInspector,
  type ListPreferenceAdapter,
  type PlanningView,
  takeListStatus,
  useInspectorStore,
  useListKeyboardWindow,
  useListPresentation,
  useListRowViewport,
  useListScrollAnchor,
  usePlanningCopy,
  usePlanningShortcuts,
} from './planning-list-window.js';
import { type PlanningModelNode, planningDetailHref, planningDisplayId } from './planning-model.js';
import {
  PlanningNotice,
  PlanningRefusal,
  type PlanningWorkspaceModel,
  resolvePlanningWorkspace,
} from './planning-workspace.js';

export type ListPageProps = Readonly<{
  currentBinding: PlanningWorkspaceModel['binding'];
  current: DashboardProductState<unknown>;
  preferences?: ListPreferenceAdapter;
}>;

const EMPTY_NODES: readonly PlanningModelNode[] = Object.freeze([]);
const ALL = 'all';
const PAGE_SIZE = 100;

export function ListPage({
  currentBinding,
  current,
  preferences = browserListPreferences,
}: ListPageProps) {
  const {
    query,
    setQuery,
    type,
    status,
    compact,
    setCompact,
    sort,
    setSort,
    page,
    setPage,
    collapsedGroups,
    setCollapsedGroups,
    view,
    copyMessage,
    sharePending,
    share,
    clearFilters,
    setPresentation,
    selected,
    setSelected,
  } = useListPresentation(() => takeListStatus() ?? ALL);
  const inspector = useInspectorStore();

  const model = resolvePlanningWorkspace(current, currentBinding);
  const graph = model ? retainGraphRevision(model.graph, model.binding) : undefined;
  const focusNotice = usePlanningViewFocus(view, graph?.nodes);
  const all = graph?.nodes ?? EMPTY_NODES;
  const draftView: PlanningView = {
    schemaVersion: '1.0.0' as const,
    route: 'list' as const,
    filters: {
      ...(view?.filters.attention ? { attention: view.filters.attention } : {}),
      type:
        type === ALL
          ? view?.filters.type.length && view.filters.type.length > 1
            ? view.filters.type
            : []
          : [type],
      status:
        status === ALL
          ? view?.filters.status.length && view.filters.status.length > 1
            ? view.filters.status
            : []
          : [status],
      priority: view?.filters.priority ?? [],
      label: view?.filters.label ?? [],
      query,
      createdWithinDays: view?.filters.createdWithinDays ?? null,
      updatedWithinDays: view?.filters.updatedWithinDays ?? null,
    },
    groupBy: view?.groupBy ?? ('spec' as const),
    sort: {
      field: sort.key as 'id' | 'title' | 'status' | 'priority' | 'updated',
      direction: sort.dir,
    },
    density: compact ? ('compact' as const) : ('comfortable' as const),
    focusId: inspector.selection?.kind === 'node' ? inspector.selection.id : null,
  };
  const presentationKey = JSON.stringify({ ...draftView, focusId: null });
  const effectiveView = useMemo(
    () => JSON.parse(presentationKey) as PlanningView,
    [presentationKey],
  );
  const projection = graph ? selectListProjection(graph, effectiveView) : null;
  const rows = useLiveListOrder(projection?.rows ?? EMPTY_NODES, presentationKey);
  const { grouped, appearances, positions } = useMemo(
    () =>
      graph
        ? selectListGroups(graph, rows, effectiveView.groupBy)
        : { grouped: [], appearances: [], positions: new Map<string, Map<string, number>>() },
    [graph, rows, effectiveView.groupBy],
  );
  const pageCount = Math.max(1, Math.ceil(appearances.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const visibleRows = useMemo(
    () => appearances.slice(pageStart, pageStart + PAGE_SIZE),
    [appearances, pageStart],
  );
  const visibleGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; nodes: PlanningModelNode[] }>();
    for (const { group, node } of visibleRows) {
      const current = groups.get(group.key);
      if (current) current.nodes.push(node);
      else groups.set(group.key, { key: group.key, label: group.label, nodes: [node] });
    }
    return [...groups.values()];
  }, [visibleRows]);
  const appliedFocus = useRef<PlanningView | null>(null);
  useEffect(() => {
    if (appliedFocus.current === view) return;
    appliedFocus.current = view;
    if (!view?.focusId) return;
    const index = appearances.findIndex((entry) => entry.node.id === view.focusId);
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE));
  }, [view, appearances, setPage]);
  const resetPage = () => setPage(0);
  const selectedId = inspector.selection?.kind === 'node' ? inspector.selection.id : undefined;

  const { rootRef, removalNotice } = useLiveListSelection(
    all,
    visibleRows.map((entry) => entry.node),
    selectedId,
  );
  useListScrollAnchor(
    rootRef,
    `${presentationKey}:${currentPage}:${collapsedGroups.join()}`,
    graph,
  );
  const copy = usePlanningCopy();
  const shortcutsEnabled = usePlanningShortcuts();
  const [storageNotice, setStorageNotice] = useState('');
  const densityKey = `op-density:v1:${currentBinding.projectId}`;
  useEffect(() => {
    try {
      const stored = preferences.load(densityKey);
      if (stored !== null && stored !== 'compact' && stored !== 'comfortable')
        throw new Error('Invalid density');
      if (!view && stored !== null) setCompact(stored === 'compact');
    } catch {
      setStorageNotice(
        'Browser density preference unavailable. You can still change density for this session.',
      );
    }
  }, [densityKey, preferences, view, setCompact]);
  const changeDensity = (value: boolean) => {
    setCompact(value);
    try {
      preferences.save(densityKey, value ? 'compact' : 'comfortable');
      setStorageNotice('');
    } catch {
      setStorageNotice('Density changed for this session. Browser storage is unavailable.');
    }
  };
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedNodes = useMemo(
    () => all.filter((node) => selectedSet.has(node.id)),
    [all, selectedSet],
  );
  const inspectedNode = selectedId ? all.find((node) => node.id === selectedId) : undefined;
  const bar = useMemo(
    () => listSelectionItems(selectedNodes, inspectedNode),
    [selectedNodes, inspectedNode],
  );
  const keyboardAppearances = useMemo(
    () =>
      appearances
        .map((entry, index) => ({ ...entry, index }))
        .filter((entry) => !collapsedGroups.includes(entry.group.key)),
    [appearances, collapsedGroups],
  );
  const rowViewport = useListRowViewport({
    root: rootRef,
    groups: visibleGroups,
    positions,
    pageStart,
    compact,
    grouped: effectiveView.groupBy !== 'none',
    collapsedGroups,
    selectedId,
    scope: `${presentationKey}:${currentPage}`,
  });
  const keyboardNotice = useListKeyboardWindow({
    root: rootRef,
    appearances: keyboardAppearances,
    pageSize: PAGE_SIZE,
    setPage,
    selected,
    setSelected,
    selectedId,
    onNavigate: rowViewport.reveal,
  });
  const toggleSelection = (node: PlanningModelNode) =>
    setSelected((ids) =>
      ids.includes(node.id) ? ids.filter((id) => id !== node.id) : [...ids, node.id],
    );
  const updateFilters = (filters: Partial<PlanningView['filters']>) => {
    setPresentation({
      ...effectiveView,
      focusId: null,
      filters: { ...effectiveView.filters, ...filters },
    });
  };
  const clearChip = (field: ListClearableFilter) =>
    updateFilters(field === 'attention' ? { attention: undefined } : { [field]: null });
  const metadata = graph ? selectListMetadata(graph) : null;
  const totals = metadata?.totals;
  const labels = metadata?.labels ?? [];
  const progress = metadata?.progress;
  const hiddenDone = projection?.hiddenDone ?? 0;
  const dateExcluded = projection?.dateExcluded ?? 0;
  const dateNote = dateExcluded
    ? `${dateExcluded} items excluded: unknown, invalid or future authored dates.`
    : '';
  const activeFilterCount = listActiveFilterCount(effectiveView.filters);
  const allChecked = rows.length > 0 && rows.every((node) => selectedSet.has(node.id));
  const someChecked = !allChecked && rows.some((node) => selectedSet.has(node.id));
  useEffect(() => {
    const existing = metadata?.ids ?? new Set<string>();
    if (selected.some((id) => !existing.has(id)))
      setSelected(selected.filter((id) => existing.has(id)));
  }, [metadata, selected, setSelected]);
  if (!model) {
    return <PlanningRefusal routeKind="planning.list" title="Planning cannot be trusted" />;
  }
  const missingNote = bar.missing
    ? `${bar.missing} selected ${bar.missing === 1 ? 'item has' : 'items have'} no command.`
    : '';

  return (
    <div
      ref={rootRef}
      className="op-workspace op-planning pc-pipeline pc-list"
      data-route-kind="planning.list"
      data-managed-rows="true"
      data-checked={selected.length > 0 || undefined}
    >
      <PlanningNotice presentation={model.presentation} />
      {removalNotice ? (
        <p className="pc-visually-hidden" role="status">
          {removalNotice}
        </p>
      ) : null}
      <p className="pc-visually-hidden" role="status">
        {keyboardNotice}
      </p>
      {focusNotice ? <p role="status">{focusNotice}</p> : null}
      <p className="pc-visually-hidden pc-list__feedback" role="status">
        {[storageNotice, copyMessage, missingNote, dateNote].filter(Boolean).join(' ')}
      </p>
      {all.length === 0 ? (
        <>
          <h1 className="pc-visually-hidden">List</h1>
          <Card padding={0}>
            <EmptyState
              icon="list"
              title="No planning files yet"
              description="No planning artifacts were found in this snapshot. Shape intent into a spec, then plan its stories and tasks."
              action={<CommandHint command="/planr:spec" label="create the graph" size="sm" />}
            />
          </Card>
        </>
      ) : (
        <>
          <ListTitle
            shown={rows.length}
            total={all.length}
            view={effectiveView}
            counts={totals}
            onPreset={setPresentation}
          />
          <ListToolbar
            filters={effectiveView.filters}
            groupBy={effectiveView.groupBy}
            labels={labels}
            compact={compact}
            sharePending={sharePending}
            dateNote={dateNote}
            onQuery={(value) => {
              setQuery(value);
              resetPage();
            }}
            onFilters={updateFilters}
            onGroupBy={(groupBy) => setPresentation({ ...effectiveView, groupBy })}
            onClear={clearFilters}
            onClearChip={clearChip}
            onDensity={changeDensity}
            onShare={() => {
              void share({ ...effectiveView, focusId: selectedId ?? null });
            }}
          />
          <section
            data-keyboard-group="all"
            className="pc-list__surface"
            aria-label="Planning artifact index"
          >
            <div
              className="pc-list__window"
              data-scroll-context="list-window"
              data-empty={rows.length === 0 || undefined}
            >
              {rows.length > 0 ? (
                <DataTable
                  rows={visibleRows.map((entry) => entry.node)}
                  compact={compact}
                  groups={visibleGroups.map((group) => {
                    const headerOffset =
                      effectiveView.groupBy === 'none'
                        ? 0
                        : grouped.findIndex((entry) => entry.key === group.key) + 1;
                    const groupCollapsed = collapsedGroups.includes(group.key);
                    return {
                      ...group,
                      rows: group.nodes,
                      collapsed: groupCollapsed,
                      rowWindow: rowViewport.windows.get(group.key),
                      rowPosition: (node: PlanningModelNode) =>
                        (positions.get(group.key)?.get(node.id) ?? 1) + headerOffset,
                      headerRowPosition:
                        (positions.get(group.key)?.values().next().value ?? 1) + headerOffset,
                      header:
                        effectiveView.groupBy === 'none' ? undefined : (
                          <ListGroupHeader
                            groupKey={group.key}
                            label={group.label}
                            specTitle={
                              effectiveView.groupBy === 'spec'
                                ? metadata?.specs.get(group.key)?.title
                                : undefined
                            }
                            collapsed={groupCollapsed}
                            progress={
                              effectiveView.groupBy === 'spec'
                                ? progress?.get(group.key)
                                : undefined
                            }
                            onToggle={() =>
                              setCollapsedGroups((groups) =>
                                groups.includes(group.key)
                                  ? groups.filter((key) => key !== group.key)
                                  : [...groups, group.key],
                              )
                            }
                          />
                        ),
                    };
                  })}
                  selectedId={selectedId}
                  selectedIds={selectedSet}
                  onRowSelect={toggleSelection}
                  rowCount={
                    appearances.length + (effectiveView.groupBy === 'none' ? 0 : grouped.length)
                  }
                  rowHref={planningDetailHref}
                  sort={sort}
                  onSort={(key) => {
                    setSort((current) => ({
                      key,
                      dir: current.key === key && current.dir === 'desc' ? 'asc' : 'desc',
                    }));
                    resetPage();
                  }}
                  onRowClick={inspectPlanningNode}
                  onRowFocus={(node) => inspectPlanningNode(node, false)}
                  caption="Planning artifacts"
                  columns={[
                    {
                      key: 'select',
                      label: 'Select',
                      width: 40,
                      header: (
                        <ListCheckbox
                          label={`Select all ${rows.length} filtered items`}
                          checked={allChecked}
                          indeterminate={someChecked}
                          onChange={(checked) =>
                            setSelected(checked ? rows.map((node) => node.id) : [])
                          }
                        />
                      ),
                      render: (node: PlanningModelNode) => (
                        <ListCheckbox
                          label={`Select ${planningDisplayId(node)}`}
                          checked={selectedSet.has(node.id)}
                          onChange={() => toggleSelection(node)}
                        />
                      ),
                    },
                    ...LIST_COLUMNS,
                  ]}
                />
              ) : (
                <ListEmpty
                  sentence={[listFilterSentence(effectiveView.filters), dateNote]
                    .filter(Boolean)
                    .join(' ')}
                  activeFilterCount={activeFilterCount}
                  hiddenDone={hiddenDone}
                  onClear={clearFilters}
                  onShowDone={() => updateFilters({ status: ['done'] })}
                />
              )}
            </div>
            {all.length > PAGE_SIZE ? (
              <ListPagination
                start={pageStart}
                end={Math.min(pageStart + PAGE_SIZE, appearances.length)}
                total={appearances.length}
                page={currentPage}
                pageCount={pageCount}
                onPage={setPage}
              />
            ) : null}
          </section>
          <SelectionBar
            items={bar.items}
            onCopy={copy}
            shortcutsEnabled={shortcutsEnabled}
            onClear={() => {
              setSelected([]);
              clearInspector();
            }}
            onOpen={() => {
              const first = selectedNodes[0] ?? inspectedNode;
              if (first) inspectPlanningNode(first);
            }}
          />
        </>
      )}
    </div>
  );
}
