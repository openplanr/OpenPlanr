import {
  Absent,
  Button,
  Card,
  CommandHint,
  DataTable,
  type DataTableColumn,
  EmptyState,
  InlineAlert,
  SectionHeader,
  Tally,
  WorkItemChip,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import {
  dependencyCountColumn,
  dependsOnOf,
  ITEM_COLUMN,
  SPRINT_COLUMN,
  STATUS_COLUMN,
  UPDATED_COLUMN,
} from './planning-columns.js';
import { inspectPlanningNode } from './planning-inspector.js';
import { requestListStatus } from './planning-list-filter.js';
import {
  type PlanningArtifactStatus,
  type PlanningModelNode,
  planningDisplayId,
} from './planning-model.js';
import { PlanningNotice, PlanningRefusal, resolvePlanningWorkspace } from './planning-workspace.js';
import './planning.css';
import './overview.css';

export type OverviewPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

const PREVIEW_LIMIT = 3;

const ARTIFACT_STATUSES: ReadonlySet<string> = new Set([
  'done',
  'in-progress',
  'blocked',
  'outstanding',
  'addressed',
]);

function isArtifactStatus(value: string): value is PlanningArtifactStatus {
  return ARTIFACT_STATUSES.has(value);
}

/** The first dependency as a chip when it is in the graph, plus how many more there are. */
function dependsOnColumn(
  byId: ReadonlyMap<string, PlanningModelNode>,
): DataTableColumn<PlanningModelNode> {
  return {
    key: 'dependsOn',
    label: 'Depends on',
    width: 220,
    render: (node) => {
      const deps = dependsOnOf(node);
      const first = deps[0];
      if (first === undefined) return <Absent>no depends_on</Absent>;
      const target = byId.get(first);
      return (
        <span className="pc-overview__deps" title={deps.join(', ')}>
          {target ? (
            <WorkItemChip type={target.type} id={planningDisplayId(target)} />
          ) : (
            <span className="pc-overview__mono">{first}</span>
          )}
          {deps.length > 1 ? <span className="pc-overview__mono">+{deps.length - 1}</span> : null}
        </span>
      );
    },
  };
}

function pickStatus(status: string): void {
  if (!isArtifactStatus(status)) return;
  requestListStatus(status);
  if (typeof window !== 'undefined') window.location.hash = '#/list';
}

export function OverviewPage({ currentBinding, current }: OverviewPageProps) {
  const model = resolvePlanningWorkspace(current, currentBinding);
  if (!model) {
    return <PlanningRefusal routeKind="planning.overview" title="Planning cannot be trusted" />;
  }

  const { graph, presentation } = model;
  const items = graph.nodes.filter((node) => node.type !== 'sprint');
  const counts: Record<string, number> = {};
  for (const node of items) counts[node.status] = (counts[node.status] ?? 0) + 1;
  const blocked = items.filter((node) => node.status === 'blocked');
  const active = items.filter((node) => node.status === 'in-progress');
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  return (
    <div
      className="op-workspace op-planning pc-pipeline pc-overview"
      data-route-kind="planning.overview"
    >
      <PlanningNotice presentation={presentation} />
      <SectionHeader
        headingLevel={1}
        eyebrow="planr-status · overview"
        title="Overview"
        count={`${items.length} ${items.length === 1 ? 'artifact' : 'artifacts'}`}
        description="Status counts come straight from the graph snapshot."
      />
      {items.length === 0 ? (
        <Card padding={0}>
          <EmptyState
            icon="gauge"
            title="No artifacts yet"
            description="The overview fills in as the graph gains epics, features, stories and tasks."
            action={<CommandHint command="/planr-plan" label="create the graph" size="sm" />}
          />
        </Card>
      ) : (
        <>
          <div className="pc-overview__tally">
            <Tally counts={counts} total={items.length} onPick={pickStatus} />
          </div>
          <div className="pc-overview__stack">
            <Card
              title="Blocked"
              meta={`${blocked.length} ${blocked.length === 1 ? 'item' : 'items'}`}
              padding={0}
              actions={
                blocked.length > PREVIEW_LIMIT ? (
                  <Button size="sm" variant="ghost" onClick={() => pickStatus('blocked')}>
                    View all blocked
                  </Button>
                ) : null
              }
            >
              {blocked.length > 0 ? (
                <>
                  <DataTable
                    compact
                    rows={blocked.slice(0, PREVIEW_LIMIT)}
                    onRowClick={inspectPlanningNode}
                    caption="Blocked artifacts"
                    columns={[ITEM_COLUMN, dependsOnColumn(byId), SPRINT_COLUMN, UPDATED_COLUMN]}
                  />
                  {blocked.length > PREVIEW_LIMIT ? (
                    <p className="pc-overview__note">
                      Showing {PREVIEW_LIMIT} of {blocked.length} blocked artifacts, in project
                      order.
                    </p>
                  ) : null}
                  <div className="pc-overview__note">
                    <InlineAlert tone="info" title="Depends-on is not the same as blocked-by">
                      The graph records <code>depends_on</code> edges and a <code>blocked</code>{' '}
                      status, but nothing that links them. These are every dependency, not the
                      blocking one.
                    </InlineAlert>
                  </div>
                </>
              ) : (
                <div className="pc-overview__empty">
                  <EmptyState
                    icon="check-check"
                    title="Nothing is blocked"
                    description="No artifact carries the blocked status."
                  />
                </div>
              )}
            </Card>
            <Card
              title="In progress"
              meta={`${active.length} ${active.length === 1 ? 'item' : 'items'}`}
              padding={0}
              actions={
                active.length > PREVIEW_LIMIT ? (
                  <Button size="sm" variant="ghost" onClick={() => pickStatus('in-progress')}>
                    View all in progress
                  </Button>
                ) : null
              }
            >
              <DataTable
                compact
                rows={active.slice(0, PREVIEW_LIMIT)}
                onRowClick={inspectPlanningNode}
                caption="Artifacts in progress"
                emptyMessage="No artifact carries the in-progress status."
                columns={[
                  ITEM_COLUMN,
                  STATUS_COLUMN,
                  dependencyCountColumn(graph.edges),
                  SPRINT_COLUMN,
                  UPDATED_COLUMN,
                ]}
              />
              {active.length > PREVIEW_LIMIT ? (
                <p className="pc-overview__note">
                  Showing {PREVIEW_LIMIT} of {active.length} in-progress artifacts, in project
                  order.
                </p>
              ) : null}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
