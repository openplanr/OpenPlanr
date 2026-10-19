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
import { useListPresentation } from '../../lib/routing/planning-presentation.js';
import { useInspectorStore } from '../shell/inspector-selection.js';
import {
  dependencyCountColumn,
  ITEM_COLUMN,
  outgoingDependencyCounts,
  REF_COLUMN,
  SPRINT_COLUMN,
  STATUS_COLUMN,
  UPDATED_COLUMN,
} from './planning-columns.js';
import {
  inspectPlanningNode,
  useLiveListOrder,
  useLiveListSelection,
  usePlanningViewFocus,
} from './planning-inspector.js';
import { takeListStatus } from './planning-list-filter.js';
import {
  filterPlanningNodes,
  type PlanningArtifactStatus,
  type PlanningArtifactType,
  sortPlanningNodes,
} from './planning-model.js';
import {
  PlanningNotice,
  PlanningRefusal,
  type PlanningWorkspaceModel,
  resolvePlanningWorkspace,
} from './planning-workspace.js';
import { applyPlanningView, groupPresentationNodes } from './presentation-view.js';
import './planning.css';
import './list.css';

export type ListPageProps = Readonly<{
  currentBinding: PlanningWorkspaceModel['binding'];
  current: DashboardProductState<unknown>;
}>;

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
const UPDATED_SORTABLE = Object.freeze({ ...UPDATED_COLUMN, sortable: true });

function isType(value: string): value is PlanningArtifactType {
  return (TYPES as readonly string[]).includes(value);
}

function isStatus(value: string): value is PlanningArtifactStatus {
  return (ARTIFACT_STATUS_ORDER as readonly string[]).includes(value);
}

export function ListPage({ currentBinding, current }: ListPageProps) {
  const {
    query,
    setQuery,
    type,
    setType,
    status,
    setStatus,
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
    share,
    clearFilters,
  } = useListPresentation(() => takeListStatus() ?? ALL);
  const inspector = useInspectorStore();

  const model = resolvePlanningWorkspace(current, currentBinding);
  const focusNotice = usePlanningViewFocus(view, model?.graph.nodes);
  const all = sortPlanningNodes(model?.graph.nodes ?? [], 'id');
  const filteredByText = filterPlanningNodes(all, {
    search: query.trim() || undefined,
    typeFilter: isType(type) ? [type] : undefined,
    statusFilter: isStatus(status) ? status : null,
  });
  const effectiveView = {
    schemaVersion: '1.0.0' as const,
    route: 'list' as const,
    filters: {
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
  const rows = useLiveListOrder(
    applyPlanningView(filteredByText, effectiveView),
    JSON.stringify({ ...effectiveView, focusId: null }),
  );
  const grouped = groupPresentationNodes(rows, effectiveView.groupBy);
  const appearances = grouped.flatMap((group) => group.nodes.map((node) => ({ group, node })));
  const pageCount = Math.max(1, Math.ceil(appearances.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const visibleRows = appearances.slice(pageStart, pageStart + PAGE_SIZE);
  const visibleGroups = grouped
    .map((group) => ({
      ...group,
      nodes: visibleRows.filter((entry) => entry.group === group).map((entry) => entry.node),
    }))
    .filter((group) => group.nodes.length > 0);
  if (visibleGroups.length === 0)
    visibleGroups.push({ key: 'all', label: 'All artifacts', nodes: [] });
  const dependencyCounts = outgoingDependencyCounts(model?.graph.edges ?? []);
  const resetPage = () => setPage(0);
  const selectedId = inspector.selection?.kind === 'node' ? inspector.selection.id : undefined;

  const { rootRef, removalNotice } = useLiveListSelection(
    all,
    visibleRows.map((entry) => entry.node),
    selectedId,
  );
  if (!model) {
    return <PlanningRefusal routeKind="planning.list" title="Planning cannot be trusted" />;
  }

  return (
    <div
      ref={rootRef}
      className="op-workspace op-planning pc-pipeline pc-list"
      data-route-kind="planning.list"
    >
      <PlanningNotice presentation={model.presentation} />
      {removalNotice ? (
        <p className="pc-visually-hidden" role="status">
          {removalNotice}
        </p>
      ) : null}
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
          <Toolbar
            right={<Switch size="sm" checked={compact} onChange={setCompact} label="Compact" />}
          >
            <Input
              size="sm"
              icon="search"
              width={220}
              placeholder="Filter by id or title"
              ariaLabel="Filter by id or title"
              value={query}
              onChange={(value) => {
                setQuery(value);
                resetPage();
              }}
            />
            <Select
              size="sm"
              width={128}
              ariaLabel="Filter by type"
              value={type}
              onChange={(value) => {
                setType(value);
                resetPage();
              }}
              options={TYPE_OPTIONS}
            />
            <Select
              size="sm"
              width={138}
              ariaLabel="Filter by status"
              value={status}
              onChange={(value) => {
                setStatus(value);
                resetPage();
              }}
              options={STATUS_OPTIONS}
            />
            <ToolbarDivider />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void share(effectiveView);
              }}
            >
              Copy filter link
            </Button>
            <span className="pc-list__note">read-only view of .planr/</span>
          </Toolbar>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? 'Expand artifacts' : 'Collapse artifacts'}
          </Button>
          {copyMessage ? <p role="status">{copyMessage}</p> : null}
          <div hidden={collapsed}>
            {visibleGroups.map((group) => (
              <section key={group.key} aria-label={group.label} data-keyboard-group={group.key}>
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
                <div hidden={collapsedGroups.includes(group.key)}>
                  <DataTable
                    rows={group.nodes}
                    compact={compact}
                    selectedId={selectedId}
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
                    columns={[
                      ITEM_COLUMN,
                      STATUS_COLUMN,
                      SPRINT_COLUMN,
                      dependencyCountColumn(dependencyCounts),
                      UPDATED_SORTABLE,
                      REF_COLUMN,
                    ]}
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
                <Button size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
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
