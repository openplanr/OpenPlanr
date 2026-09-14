import { useState } from 'react';
import {
  ARTIFACT_STATUS_ORDER,
  ArtifactStatus,
  Card,
  CommandHint,
  DataTable,
  EmptyState,
  SectionHeader,
  SprintProgress,
  WorkItemChip,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import {
  dependencyCountColumn,
  ITEM_COLUMN,
  STATUS_COLUMN,
  sprintOf,
  UPDATED_COLUMN,
} from './planning-columns.js';
import { inspectPlanningNode } from './planning-inspector.js';
import { type PlanningModelNode, planningDisplayId } from './planning-model.js';
import { PlanningNotice, PlanningRefusal, resolvePlanningWorkspace } from './planning-workspace.js';
import './planning.css';
import './sprints.css';

export type SprintsPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

/** Membership is the node's own sprintId/sprint frontmatter naming the sprint artifact. */
function membersOf(
  nodes: readonly PlanningModelNode[],
  sprint: PlanningModelNode,
): readonly PlanningModelNode[] {
  const display = planningDisplayId(sprint);
  return nodes.filter((node) => {
    if (node.type === 'sprint') return false;
    const ref = sprintOf(node);
    return ref === sprint.id || ref === display;
  });
}

export function SprintsPage({ currentBinding, current }: SprintsPageProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const model = resolvePlanningWorkspace(current, currentBinding);
  if (!model) {
    return <PlanningRefusal routeKind="planning.sprints" title="Planning cannot be trusted" />;
  }

  const { nodes, edges } = model.graph;
  const sprints = nodes
    .filter((node) => node.type === 'sprint')
    .sort((a, b) => b.id.localeCompare(a.id));
  const active =
    sprints.find((sprint) => sprint.id === picked) ??
    sprints.find((sprint) => sprint.status !== 'done') ??
    sprints[0] ??
    null;
  const members = active ? membersOf(nodes, active) : [];

  return (
    <div
      className="op-workspace op-planning pc-pipeline pc-sprints"
      data-route-kind="planning.sprints"
    >
      <PlanningNotice presentation={model.presentation} />
      <SectionHeader
        headingLevel={1}
        eyebrow="planr-status · sprints"
        title="Sprints"
        count={`${sprints.length} ${sprints.length === 1 ? 'artifact' : 'artifacts'}`}
        description="Membership comes from each node's sprintId frontmatter."
      />
      {sprints.length === 0 ? (
        <Card padding={0}>
          <EmptyState
            icon="calendar-range"
            title="No sprints yet"
            description="No artifact of type sprint is in the graph."
            action={<CommandHint command="/planr-plan" label="plan the next sprint" size="sm" />}
          />
        </Card>
      ) : (
        <>
          <div className="pc-sprints__grid">
            {sprints.map((sprint) => {
              const sprintMembers = membersOf(nodes, sprint);
              const segments = ARTIFACT_STATUS_ORDER.map((status) => ({
                state: status,
                count: sprintMembers.filter((node) => node.status === status).length,
              })).filter((segment) => segment.count > 0);
              const isActive = active?.id === sprint.id;
              return (
                <button
                  key={sprint.id}
                  type="button"
                  className="pc-sprints__card"
                  data-active={isActive || undefined}
                  aria-pressed={isActive}
                  onClick={() => setPicked(sprint.id)}
                >
                  <span className="pc-sprints__head">
                    <WorkItemChip type="sprint" id={planningDisplayId(sprint)} />
                    <ArtifactStatus status={sprint.status} size="sm" />
                  </span>
                  <SprintProgress name={sprint.title} segments={segments} />
                </button>
              );
            })}
          </div>
          {active ? (
            <div className="pc-sprints__members">
              <Card
                title={`${planningDisplayId(active)} membership`}
                meta={`${members.length} items`}
                padding={0}
              >
                {members.length > 0 ? (
                  <DataTable
                    compact
                    rows={members}
                    onRowClick={inspectPlanningNode}
                    caption={`Members of ${planningDisplayId(active)}`}
                    columns={[
                      ITEM_COLUMN,
                      STATUS_COLUMN,
                      dependencyCountColumn(edges),
                      UPDATED_COLUMN,
                    ]}
                  />
                ) : (
                  <div className="pc-sprints__empty">
                    <EmptyState
                      icon="calendar-range"
                      title="No members"
                      description="No node carries this sprintId."
                    />
                  </div>
                )}
              </Card>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
