import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ARTIFACT_STATUS_ORDER,
  Button,
  Card,
  CommandHint,
  DataTable,
  EmptyState,
  Input,
  SectionHeader,
  Select,
  Switch,
  Toolbar,
  ToolbarDivider,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import { LIST_COLUMNS } from './planning-columns.js';
import {
  inspectPlanningNode,
  useLiveListOrder,
  useLiveListSelection,
  usePlanningViewFocus,
} from './planning-inspector.js';
import {
  BACKLOG_STATUSES,
  bulkListCommands,
  LIST_PRESETS,
  listPreset,
  takeListStatus,
} from './planning-list-filter.js';
import {
  retainGraphRevision,
  selectListGroups,
  selectListMetadata,
  selectListProjection,
} from './planning-list-projection.js';
import {
  browserListPreferences,
  type ListPreferenceAdapter,
  type PlanningView,
  useInspectorStore,
  useListKeyboardWindow,
  useListPresentation,
  useListRowViewport,
  useListScrollAnchor,
  usePlanningCopy,
} from './planning-list-window.js';
import {
  type PlanningArtifactType,
  type PlanningModelNode,
  planningDetailHref,
} from './planning-model.js';
import {
  PlanningNotice,
  PlanningRefusal,
  type PlanningWorkspaceModel,
  resolvePlanningWorkspace,
} from './planning-workspace.js';
import './planning.css';
import './list.css';

export type ListPageProps = Readonly<{
  currentBinding: PlanningWorkspaceModel['binding'];
  current: DashboardProductState<unknown>;
  preferences?: ListPreferenceAdapter;
}>;

const EMPTY_NODES: readonly PlanningModelNode[] = Object.freeze([]);
const ALL = 'all';
const PAGE_SIZE = 100;
const TYPES: readonly PlanningArtifactType[] = Object.freeze([
  'epic',
  'feature',
  'story',
  'task',
  'spec',
  'backlog',
  'quick',
  'sprint',
  'adr',
]);
const TYPE_OPTIONS = Object.freeze([
  { value: ALL, label: 'All types' },
  ...TYPES.map((type) => ({ value: type, label: type })),
]);
const STATUS_OPTIONS = Object.freeze([
  { value: ALL, label: 'All statuses' },
  ...ARTIFACT_STATUS_ORDER.map((status) => ({ value: status, label: status })),
]);
const PRIORITIES = ['P0', 'P1', 'P2', 'P3', 'critical', 'high', 'medium', 'low'];

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
    collapsed,
    setCollapsed,
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
    groupBy: view?.groupBy ?? ('none' as const),
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
  if (visibleGroups.length === 0)
    visibleGroups.push({ key: 'all', label: 'All artifacts', nodes: [] });

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
    `${presentationKey}:${currentPage}:${collapsed}:${collapsedGroups.join()}`,
    graph,
  );
  const copy = usePlanningCopy();
  const [copyState, setCopyState] = useState('');
  const [copyPending, setCopyPending] = useState(false);
  const copyLock = useRef(false);
  const [bulkStatus, setBulkStatus] = useState('in-progress');
  const [storageNotice, setStorageNotice] = useState('');
  const [dateError, setDateError] = useState('');
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
  const bulk = useMemo(
    () => bulkListCommands(selectedNodes, bulkStatus),
    [selectedNodes, bulkStatus],
  );
  const keyboardAppearances = useMemo(
    () =>
      appearances
        .map((entry, index) => ({ ...entry, index }))
        .filter((entry) => !collapsed && !collapsedGroups.includes(entry.group.key)),
    [appearances, collapsed, collapsedGroups],
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
  const copyText = async (text: string) => {
    if (copyLock.current) return;
    copyLock.current = true;
    setCopyPending(true);
    try {
      if (!copy) throw new Error('Clipboard unavailable');
      await copy(text);
      setCopyState(`Copied: ${text}`);
    } catch {
      setCopyState(`Copy blocked. Select and copy manually: ${text}`);
    } finally {
      copyLock.current = false;
      setCopyPending(false);
    }
  };
  const updateFilters = (filters: Partial<PlanningView['filters']>) =>
    setPresentation({
      ...effectiveView,
      focusId: null,
      filters: { ...effectiveView.filters, ...filters },
    });
  const metadata = graph ? selectListMetadata(graph) : null;
  const totals = metadata?.totals;
  const labels = metadata?.labels ?? [];
  const progress = metadata?.progress;
  const hiddenDone = projection?.hiddenDone ?? 0;
  const dateExcluded = projection?.dateExcluded ?? 0;
  useEffect(() => {
    const existing = metadata?.ids ?? new Set<string>();
    if (selected.some((id) => !existing.has(id)))
      setSelected(selected.filter((id) => existing.has(id)));
  }, [metadata, selected, setSelected]);
  if (!model) {
    return <PlanningRefusal routeKind="planning.list" title="Planning cannot be trusted" />;
  }

  return (
    <div
      ref={rootRef}
      className="op-workspace op-planning pc-pipeline pc-list"
      data-route-kind="planning.list"
      data-managed-rows="true"
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
      <SectionHeader
        headingLevel={1}
        eyebrow="planr-plan · list"
        title="List"
        count={`${rows.length} of ${all.length}`}
        description="Every node in the graph, filterable by text, type and status."
      />
      {all.length === 0 ? (
        <Card padding={0}>
          <EmptyState
            icon="list"
            title="No planning files yet"
            description="No planning artifacts were found in this snapshot. Shape intent into a spec, then plan its stories and tasks."
            action={<CommandHint command="/planr:spec" label="create the graph" size="sm" />}
          />
        </Card>
      ) : (
        <section
          data-keyboard-group="all"
          className="pc-list__surface"
          aria-label="Planning artifact index"
        >
          <fieldset className="pc-list__presets" aria-label="List presets">
            {LIST_PRESETS.map(([key, label]) => {
              const preset = listPreset(key);
              const active =
                JSON.stringify(effectiveView.filters) === JSON.stringify(preset.filters) &&
                effectiveView.groupBy === preset.groupBy;
              return (
                <Button
                  key={key}
                  size="sm"
                  variant="ghost"
                  aria-pressed={active}
                  onClick={() => setPresentation({ ...preset, density: effectiveView.density })}
                >
                  {label} <span className="pc-list__preset-count">{totals?.get(key)}</span>
                </Button>
              );
            })}
          </fieldset>
          <Toolbar
            right={<Switch size="sm" checked={compact} onChange={changeDensity} label="Compact" />}
          >
            <Input
              size="sm"
              icon="search"
              width={220}
              placeholder="Filter by id or title"
              ariaLabel="Filter by id or title"
              value={query}
              onChange={(value) => {
                setQuery(value.slice(0, 200));
                resetPage();
              }}
            />
            <Select
              size="sm"
              width={128}
              ariaLabel="Filter by type"
              value={type}
              onChange={(value) => {
                updateFilters({ type: value === ALL ? [] : [value] });
                resetPage();
              }}
              options={TYPE_OPTIONS.map((option) =>
                option.value === ALL && effectiveView.filters.type.length > 1
                  ? { ...option, label: `Types: ${effectiveView.filters.type.join(', ')}` }
                  : option,
              )}
            />
            <Select
              size="sm"
              width={138}
              ariaLabel="Filter by status"
              value={status}
              onChange={(value) => {
                updateFilters({ status: value === ALL ? [] : [value] });
                resetPage();
              }}
              options={STATUS_OPTIONS.map((option) =>
                option.value === ALL && effectiveView.filters.status.length > 1
                  ? { ...option, label: `Status: ${effectiveView.filters.status.join(', ')}` }
                  : option,
              )}
            />
            <Select
              size="sm"
              ariaLabel="Filter by priority"
              value={
                effectiveView.filters.priority.length === 1
                  ? effectiveView.filters.priority[0]
                  : ALL
              }
              onChange={(value) => updateFilters({ priority: value === ALL ? [] : [value] })}
              options={[
                {
                  value: ALL,
                  label:
                    effectiveView.filters.priority.length > 1
                      ? `Priority: ${effectiveView.filters.priority.join(', ')}`
                      : 'All priorities',
                },
                ...PRIORITIES.map((value) => ({ value, label: value })),
              ]}
            />
            <Select
              size="sm"
              ariaLabel="Filter by label"
              value={
                effectiveView.filters.label.length === 1 ? effectiveView.filters.label[0] : ALL
              }
              onChange={(value) => updateFilters({ label: value === ALL ? [] : [value] })}
              options={[
                {
                  value: ALL,
                  label:
                    effectiveView.filters.label.length > 1
                      ? `Labels: ${effectiveView.filters.label.join(', ')}`
                      : 'All labels',
                },
                ...labels.map((value) => ({ value, label: value })),
              ]}
            />
            <Select
              size="sm"
              ariaLabel="Group by"
              value={effectiveView.groupBy}
              onChange={(value) =>
                setPresentation({ ...effectiveView, groupBy: value as PlanningView['groupBy'] })
              }
              options={['none', 'spec', 'type', 'status', 'label'].map((value) => ({
                value,
                label: `Group: ${value}`,
              }))}
            />
            <ToolbarDivider />
            <Button
              size="sm"
              variant="ghost"
              disabled={sharePending}
              onClick={() => {
                void share({ ...effectiveView, focusId: selectedId ?? null });
              }}
            >
              Copy filter link
            </Button>
            {view?.filters.attention ? (
              <Button size="sm" variant="ghost" onClick={clearFilters}>
                Clear attention filter: {view.filters.attention}
              </Button>
            ) : null}
            <span className="pc-list__note">read-only view of .planr/</span>
          </Toolbar>
          <fieldset className="pc-list__dates" aria-label="Relative date filters">
            {(['createdWithinDays', 'updatedWithinDays'] as const).map((field) => (
              <label className="pc-list__relative" key={field}>
                {field === 'createdWithinDays' ? 'Created' : 'Updated'} within UTC days
                <input
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  placeholder="Any"
                  aria-label={
                    field === 'createdWithinDays'
                      ? 'Created within UTC days'
                      : 'Updated within UTC days'
                  }
                  value={effectiveView.filters[field] ?? ''}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    const days = value ? Number(value) : null;
                    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) {
                      setDateError('Relative dates must be whole UTC days from 1 to 365.');
                      return;
                    }
                    setDateError('');
                    updateFilters({ [field]: days });
                  }}
                />
              </label>
            ))}
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          </fieldset>
          <fieldset className="pc-list__selection" aria-label="Bulk command copy">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(rows.map((node) => node.id))}
            >
              Select all {rows.length} filtered
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              Clear selection
            </Button>
            <span className="pc-list__selection-count">
              {selectedNodes.length} selected · {bulk.commands.length} eligible ·{' '}
              {bulk.skipped.length} skipped
            </span>
            <Select
              size="sm"
              ariaLabel="Suggested backlog status"
              value={bulkStatus}
              onChange={setBulkStatus}
              options={BACKLOG_STATUSES.map((value) => ({ value, label: value }))}
            />
            <Button
              size="sm"
              data-copy-command="true"
              disabled={!bulk.commands.length || copyPending}
              onClick={() => void copyText(bulk.commands.join('\n'))}
            >
              Copy bulk commands
            </Button>
            <Button
              size="sm"
              data-copy-command="true"
              disabled={copyPending}
              onClick={() => void copyText('/planr:sprint')}
            >
              Copy sprint command
            </Button>
          </fieldset>
          <details className="pc-list__commands">
            <summary>Review {bulk.commands.length} commands to copy</summary>
            <pre>{bulk.commands.join('\n')}</pre>
          </details>
          <code className="pc-list__sprint-command">/planr:sprint</code>
          <details className="pc-list__skipped">
            <summary>Why {bulk.skipped.length} items are skipped</summary>
            <ul>
              {bulk.skipped.slice(0, 20).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            {bulk.skipped.length > 20 ? (
              <p>{bulk.skipped.length - 20} more items have no verified status writer.</p>
            ) : null}
          </details>
          <p className="pc-list__feedback" role="status">
            {dateError ||
              storageNotice ||
              copyState ||
              copyMessage ||
              (dateExcluded
                ? `${dateExcluded} items excluded: unknown, invalid or future authored dates.`
                : 'J/K move · Enter opens panel · Space selects · Shift+Up/Down extends · / filters · C copies ID')}
          </p>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? 'Expand artifacts' : 'Collapse artifacts'}
          </Button>
          <div className="pc-list__window" data-scroll-context="list-window" hidden={collapsed}>
            {visibleGroups.map((group) => (
              <section key={group.key} aria-label={group.label} data-keyboard-group={group.key}>
                <div className="pc-list__group-header" hidden={effectiveView.groupBy === 'none'}>
                  {effectiveView.groupBy !== 'none' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={!collapsedGroups.includes(group.key)}
                      onClick={() =>
                        setCollapsedGroups((groups) =>
                          groups.includes(group.key)
                            ? groups.filter((key) => key !== group.key)
                            : [...groups, group.key],
                        )
                      }
                    >
                      {group.label}
                    </Button>
                  ) : null}
                  {effectiveView.groupBy !== 'none' ? (
                    <span className="pc-list__group-meta">
                      {grouped.find((entry) => entry.key === group.key)?.nodes.length} items
                      {effectiveView.groupBy === 'spec'
                        ? (() => {
                            const value = progress?.get(group.key);
                            return value ? (
                              <>
                                {' '}
                                ·{' '}
                                <progress
                                  max={value.total}
                                  value={value.done}
                                  aria-label={`${group.label} task progress`}
                                />{' '}
                                {value.done}/{value.total} tasks
                              </>
                            ) : (
                              ' · No tasks'
                            );
                          })()
                        : ''}
                    </span>
                  ) : null}
                </div>
                <div hidden={collapsedGroups.includes(group.key)}>
                  <DataTable
                    rows={group.nodes}
                    compact={compact}
                    selectedId={selectedId}
                    selectedIds={selectedSet}
                    onRowSelect={toggleSelection}
                    rowCount={appearances.length}
                    rowWindow={rowViewport.windows.get(group.key)}
                    rowPosition={(node) => positions.get(group.key)?.get(node.id) ?? 1}
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
                    emptyMessage="No node matches this filter."
                    columns={LIST_COLUMNS}
                  />
                </div>
              </section>
            ))}
          </div>
          {rows.length === 0 ? (
            <EmptyState
              icon="search"
              title={
                query.trim() ? `Nothing matches “${query.trim()}”` : 'Nothing matches these filters'
              }
              description={`${all.length} planning artifacts searched. Clear the filters to see all available items.`}
              action={
                <span>
                  {hiddenDone ? (
                    <Button size="sm" onClick={() => updateFilters({ status: ['done'] })}>
                      Show {hiddenDone} done matches
                    </Button>
                  ) : null}
                </span>
              }
            />
          ) : null}
          {appearances.length > PAGE_SIZE ? (
            <nav className="pc-list__pagination" aria-label="Planning artifact pages">
              <span className="pc-list__page-status" aria-live="polite">
                Page {currentPage + 1} of {pageCount} · {pageStart + 1}–
                {Math.min(pageStart + PAGE_SIZE, appearances.length)} of {appearances.length}{' '}
                appearances
              </span>
              <div className="pc-list__page-actions">
                <Button
                  size="sm"
                  icon="chevron-left"
                  disabled={currentPage === 0}
                  onClick={() => setPage(Math.max(0, currentPage - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  iconAfter="chevron-right"
                  disabled={currentPage + 1 >= pageCount}
                  onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
                >
                  Next
                </Button>
              </div>
            </nav>
          ) : null}
        </section>
      )}
    </div>
  );
}
