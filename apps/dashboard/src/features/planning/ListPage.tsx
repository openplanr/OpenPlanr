import { useState } from 'react';
import {
  ARTIFACT_STATUS_ORDER,
  Button,
  Card,
  CommandHint,
  DataTable,
  type DataTableSort,
  EmptyState,
  Input,
  SectionHeader,
  Select,
  Switch,
  Toolbar,
  ToolbarDivider,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { useInspectorStore } from '../shell/inspector-selection.js';
import {
  dependencyCountColumn,
  frontmatterString,
  ITEM_COLUMN,
  outgoingDependencyCounts,
  REF_COLUMN,
  SPRINT_COLUMN,
  STATUS_COLUMN,
  UPDATED_COLUMN,
} from './planning-columns.js';
import { inspectPlanningNode } from './planning-inspector.js';
import { takeListStatus } from './planning-list-filter.js';
import {
  filterPlanningNodes,
  type PlanningArtifactStatus,
  type PlanningArtifactType,
  type PlanningModelNode,
  sortPlanningNodes,
} from './planning-model.js';
import { PlanningNotice, PlanningRefusal, resolvePlanningWorkspace } from './planning-workspace.js';
import './planning.css';
import './list.css';

export type ListPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
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

/** Sort by the `updated` frontmatter (ISO dates order lexically); items without one go last. */
function sortByUpdated(
  nodes: readonly PlanningModelNode[],
  dir: DataTableSort['dir'],
): readonly PlanningModelNode[] {
  return [...nodes].sort((a, b) => {
    const x = frontmatterString(a, 'updated');
    const y = frontmatterString(b, 'updated');
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return dir === 'asc' ? x.localeCompare(y) : y.localeCompare(x);
  });
}

export function ListPage({ currentBinding, current }: ListPageProps) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(() => takeListStatus() ?? ALL);
  const [compact, setCompact] = useState(false);
  const [sort, setSort] = useState<DataTableSort>({ key: 'updated', dir: 'desc' });
  const [page, setPage] = useState(0);
  const inspector = useInspectorStore();

  const model = resolvePlanningWorkspace(current, currentBinding);
  if (!model) {
    return <PlanningRefusal routeKind="planning.list" title="Planning cannot be trusted" />;
  }

  const all = sortPlanningNodes(model.graph.nodes, 'id');
  const filtered = filterPlanningNodes(all, {
    search: query.trim() || undefined,
    typeFilter: isType(type) ? [type] : undefined,
    statusFilter: isStatus(status) ? status : null,
  });
  const rows = sort.key === 'updated' ? sortByUpdated(filtered, sort.dir) : filtered;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const visibleRows = rows.slice(pageStart, pageStart + PAGE_SIZE);
  const dependencyCounts = outgoingDependencyCounts(model.graph.edges);
  const resetPage = () => setPage(0);
  const selectedId = inspector.selection?.kind === 'node' ? inspector.selection.id : undefined;

  return (
    <div className="op-workspace op-planning pc-pipeline pc-list" data-route-kind="planning.list">
      <PlanningNotice presentation={model.presentation} />
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
            title="No artifacts yet"
            description="The list fills in as the graph gains epics, features, stories and tasks."
            action={<CommandHint command="/planr-plan" label="create the graph" size="sm" />}
          />
        </Card>
      ) : (
        <>
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
            <span className="pc-list__note">read-only view of .planr/</span>
          </Toolbar>
          <DataTable
            rows={visibleRows}
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
          {rows.length > PAGE_SIZE ? (
            <nav className="pc-list__pagination" aria-label="Planning artifact pages">
              <span className="pc-list__page-status" aria-live="polite">
                Page {currentPage + 1} of {pageCount} · {pageStart + 1}–
                {Math.min(pageStart + PAGE_SIZE, rows.length)} of {rows.length}
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
        </>
      )}
    </div>
  );
}
