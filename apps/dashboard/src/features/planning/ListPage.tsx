import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ARTIFACT_STATUS_ORDER,
  artifactRowStyle,
  Button,
  Card,
  ChipToggle,
  CommandHint,
  DataTable,
  EmptyState,
  Input,
  SectionHeader,
  Select,
  Tabs,
  Toolbar,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import { LIST_COLUMNS, listCommandColumn } from './planning-columns.js';
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
  usePlanningShortcuts,
} from './planning-list-window.js';
import {
  type PlanningArtifactType,
  type PlanningModelNode,
  planningArtifactTypeLabel,
  planningDetailHref,
  planningDisplayId,
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
  ...TYPES.map((type) => ({ value: type, label: planningArtifactTypeLabel(type) })),
]);
const STATUS_OPTIONS = Object.freeze([
  { value: ALL, label: 'All statuses' },
  ...ARTIFACT_STATUS_ORDER.map((status) => ({
    value: status,
    label:
      status === 'in-progress' ? 'In progress' : status.charAt(0).toUpperCase() + status.slice(1),
  })),
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
    `${presentationKey}:${currentPage}:${collapsed}:${collapsedGroups.join()}`,
    graph,
  );
  const copy = usePlanningCopy();
  const shortcutsEnabled = usePlanningShortcuts();
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
  const activeFilterCount =
    effectiveView.filters.type.length +
    effectiveView.filters.status.length +
    effectiveView.filters.priority.length +
    effectiveView.filters.label.length +
    Number(Boolean(query.trim())) +
    Number(effectiveView.filters.createdWithinDays !== null) +
    Number(effectiveView.filters.updatedWithinDays !== null) +
    Number(Boolean(effectiveView.filters.attention));
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
      <div className="pc-visually-hidden">
        <SectionHeader
          inset
          headingLevel={1}
          eyebrow="planr-plan · list"
          title="List"
          count={`${rows.length} of ${all.length}`}
          description="Every node in the graph, filterable by text, type and status."
        />
      </div>
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
          <div className="pc-list__presets">
            <Tabs
              label="List presets"
              variant="pill"
              value={
                LIST_PRESETS.slice(0, 5).find(([key]) => {
                  const preset = listPreset(key);
                  return (
                    JSON.stringify(effectiveView.filters) === JSON.stringify(preset.filters) &&
                    effectiveView.groupBy === preset.groupBy
                  );
                })?.[0] ?? ''
              }
              tabs={LIST_PRESETS.slice(0, 5).map(([id, label]) => ({
                id,
                label,
                count: totals?.get(id),
              }))}
              onChange={(id) => {
                const preset = LIST_PRESETS.find(([key]) => key === id);
                if (preset)
                  setPresentation({ ...listPreset(preset[0]), density: effectiveView.density });
              }}
            />
          </div>
          <Toolbar
            right={
              <>
                <ChipToggle checked={compact} onChange={changeDensity}>
                  Compact
                </ChipToggle>
                <details
                  className="pc-list__options"
                  onKeyDown={(event) => {
                    if (
                      shortcutsEnabled &&
                      event.key.toLowerCase() === 'c' &&
                      !event.metaKey &&
                      !event.ctrlKey &&
                      !event.altKey &&
                      !event.nativeEvent.isComposing &&
                      event.target instanceof Element
                    ) {
                      const command = event.target.closest<HTMLButtonElement>(
                        'button[data-copy-command]',
                      );
                      if (command && !command.disabled) {
                        event.preventDefault();
                        command.click();
                      }
                    }
                    if (
                      event.key !== 'Escape' ||
                      !(event.target instanceof Element) ||
                      event.target.closest('details[open]') !== event.currentTarget
                    )
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector('summary')?.focus();
                  }}
                >
                  <summary>List options</summary>
                  <div className="pc-list__options-panel">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={sharePending}
                      onClick={() => {
                        void share({ ...effectiveView, focusId: selectedId ?? null });
                      }}
                    >
                      Copy filter link
                    </Button>
                    {view?.filters.attention ? (
                      <Button size="sm" variant="secondary" onClick={clearFilters}>
                        Clear attention filter: {view.filters.attention}
                      </Button>
                    ) : null}
                    <span className="pc-list__note">read-only view of .planr/</span>
                    <fieldset className="pc-list__dates" aria-label="Relative date filters">
                      <Select
                        ariaLabel="Date preset"
                        value={
                          effectiveView.filters.createdWithinDays === 1
                            ? 'today'
                            : effectiveView.filters.createdWithinDays === 2
                              ? 'yesterday'
                              : 'none'
                        }
                        options={[
                          { value: 'none', label: 'Any date' },
                          { value: 'today', label: 'Filed today' },
                          { value: 'yesterday', label: 'Filed since yesterday' },
                        ]}
                        onChange={(value) => {
                          if (value === 'today' || value === 'yesterday')
                            setPresentation({
                              ...listPreset(value),
                              density: effectiveView.density,
                            });
                          else updateFilters({ createdWithinDays: null });
                        }}
                        clearValue="none"
                      />
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
                              if (
                                days !== null &&
                                (!Number.isInteger(days) || days < 1 || days > 365)
                              ) {
                                setDateError(
                                  'Relative dates must be whole UTC days from 1 to 365.',
                                );
                                return;
                              }
                              setDateError('');
                              updateFilters({ [field]: days });
                            }}
                          />
                        </label>
                      ))}
                      <Button size="sm" variant="secondary" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    </fieldset>
                    <fieldset className="pc-list__selection" aria-label="Bulk command copy">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setSelected(rows.map((node) => node.id))}
                      >
                        Select all {rows.length} filtered
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setSelected([])}>
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
                        options={BACKLOG_STATUSES.map((value) => ({
                          value,
                          label:
                            value === 'in-progress'
                              ? 'In progress'
                              : value.charAt(0).toUpperCase() + value.slice(1),
                        }))}
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
                    <div className="pc-list__utilities">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-expanded={!collapsed}
                        onClick={() => setCollapsed((value) => !value)}
                      >
                        {collapsed ? 'Expand artifacts' : 'Collapse artifacts'}
                      </Button>
                    </div>
                  </div>
                </details>
              </>
            }
          >
            <Input
              icon="search"
              suffix="/"
              width={340}
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
              onChange={(value) => updateFilters({ type: value === ALL ? [] : [value] })}
              values={effectiveView.filters.type}
              onValuesChange={(values) => {
                updateFilters({ type: values as PlanningArtifactType[] });
                resetPage();
              }}
              clearValue={ALL}
              options={TYPE_OPTIONS}
            />
            <Select
              size="sm"
              width={138}
              ariaLabel="Filter by status"
              value={status}
              onChange={(value) => updateFilters({ status: value === ALL ? [] : [value] })}
              values={effectiveView.filters.status}
              onValuesChange={(values) => {
                updateFilters({ status: values });
                resetPage();
              }}
              clearValue={ALL}
              options={STATUS_OPTIONS}
            />
            <Select
              size="sm"
              ariaLabel="Filter by priority"
              value={ALL}
              onChange={(value) => updateFilters({ priority: value === ALL ? [] : [value] })}
              values={effectiveView.filters.priority}
              onValuesChange={(values) => {
                updateFilters({ priority: values });
                resetPage();
              }}
              clearValue={ALL}
              options={[
                { value: ALL, label: 'All priorities' },
                ...PRIORITIES.map((value) => ({
                  value,
                  label: value.charAt(0).toUpperCase() + value.slice(1),
                })),
              ]}
            />
            <Select
              size="sm"
              ariaLabel="Filter by label"
              value={ALL}
              onChange={(value) => updateFilters({ label: value === ALL ? [] : [value] })}
              values={effectiveView.filters.label}
              onValuesChange={(values) => {
                updateFilters({ label: values });
                resetPage();
              }}
              clearValue={ALL}
              options={[
                { value: ALL, label: 'All labels' },
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
                label: `Group: ${value.charAt(0).toUpperCase() + value.slice(1)}`,
              }))}
            />
          </Toolbar>
          <div
            className="pc-list__window"
            data-scroll-context="list-window"
            style={artifactRowStyle(visibleRows.map(({ node }) => planningDisplayId(node)))}
            data-empty={rows.length === 0 || undefined}
            hidden={collapsed}
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
                  return {
                    ...group,
                    rows: group.nodes,
                    collapsed: collapsedGroups.includes(group.key),
                    rowWindow: rowViewport.windows.get(group.key),
                    rowPosition: (node: PlanningModelNode) =>
                      (positions.get(group.key)?.get(node.id) ?? 1) + headerOffset,
                    headerRowPosition:
                      (positions.get(group.key)?.values().next().value ?? 1) + headerOffset,
                    header:
                      effectiveView.groupBy === 'none' ? undefined : (
                        <div className="pc-list__group-header">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={
                              collapsedGroups.includes(group.key) ? 'chevron-right' : 'chevron-down'
                            }
                            aria-expanded={!collapsedGroups.includes(group.key)}
                            onClick={() =>
                              setCollapsedGroups((groups) =>
                                groups.includes(group.key)
                                  ? groups.filter((key) => key !== group.key)
                                  : [...groups, group.key],
                              )
                            }
                          >
                            <span className="pc-list__group-title">{group.label}</span>
                          </Button>
                          <span className="pc-list__group-meta">
                            <span className="pc-list__group-item-count">
                              {grouped.find((entry) => entry.key === group.key)?.nodes.length} items
                            </span>
                            {effectiveView.groupBy === 'spec'
                              ? (() => {
                                  const value = progress?.get(group.key);
                                  return value ? (
                                    <>
                                      <progress
                                        max={value.total}
                                        value={value.done}
                                        aria-label={`${group.label} task progress`}
                                      />
                                      <span className="pc-list__group-progress-count">
                                        {value.done}/{value.total} tasks
                                      </span>
                                    </>
                                  ) : (
                                    ' · No tasks'
                                  );
                                })()
                              : ''}
                          </span>
                        </div>
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
                columns={[...LIST_COLUMNS, listCommandColumn(copy, shortcutsEnabled)]}
              />
            ) : null}
            {rows.length === 0 ? (
              <div className="pc-list__empty">
                <EmptyState
                  variant="tile"
                  icon="search"
                  title={
                    query.trim()
                      ? `Nothing matches “${query.trim()}”`
                      : 'Nothing matches these filters'
                  }
                  description={`${all.length} planning artifacts searched. Clear the filters to see all available items.`}
                  action={
                    <span className="pc-list__empty-actions">
                      <Button size="sm" onClick={clearFilters}>
                        Clear {activeFilterCount} {activeFilterCount === 1 ? 'filter' : 'filters'}
                      </Button>
                      {hiddenDone ? (
                        <Button size="sm" onClick={() => updateFilters({ status: ['done'] })}>
                          Show {hiddenDone} done matches
                        </Button>
                      ) : null}
                    </span>
                  }
                />
              </div>
            ) : null}
          </div>
          {all.length > PAGE_SIZE ? (
            <nav className="pc-list__pagination" aria-label="Planning artifact pages">
              <span className="pc-list__page-status" aria-live="polite">
                Page {currentPage + 1} of {pageCount} · {appearances.length ? pageStart + 1 : 0}–
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
      {all.length > 0 ? (
        <section className="pc-list__hints" aria-label="List keyboard shortcuts">
          <span>
            <kbd>J</kbd> <kbd>K</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> opens panel
          </span>
          <span>
            <kbd>Space</kbd> selects
          </span>
          <span>
            <kbd>Shift</kbd> + <kbd>↑</kbd> <kbd>↓</kbd> extends
          </span>
          <span>
            <kbd>/</kbd> filters
          </span>
          <span>
            <kbd>C</kbd> copies ID
          </span>
          <span>
            <kbd>[</kbd> <kbd>]</kbd> collapse / expand group
          </span>
          <span className="pc-list__hint-count">
            {rows.length} filtered items · {grouped.length}{' '}
            {grouped.length === 1 ? 'group' : 'groups'}
          </span>
          <p className="pc-list__feedback" role="status">
            {dateError ||
              storageNotice ||
              copyState ||
              copyMessage ||
              (dateExcluded
                ? `${dateExcluded} items excluded: unknown, invalid or future authored dates.`
                : '')}
          </p>
        </section>
      ) : null}
    </div>
  );
}
