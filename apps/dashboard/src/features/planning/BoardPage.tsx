import { useEffect, useState } from 'react';
import {
  Absent,
  ARTIFACT_STATUS_ORDER,
  ArtifactStatus,
  CommandHint,
  EmptyState,
  SectionHeader,
  Select,
  Toolbar,
  WorkItemChip,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { usePlanningView } from '../../lib/routing/planning-presentation.js';
import { inspectPlanningNode } from './planning-inspector.js';
import {
  groupPlanningNodes,
  type PlanningGroup,
  type PlanningModelNode,
  planningDisplayId,
  planningGroupingDimensions,
} from './planning-model.js';
import { PlanningNotice, PlanningRefusal, resolvePlanningWorkspace } from './planning-workspace.js';
import { applyPlanningView, groupPresentationNodes } from './presentation-view.js';
import './planning.css';
import './board.css';

export type BoardPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

function frontmatterString(node: PlanningModelNode, key: string): string | null {
  const value = node.frontmatter[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function sprintOf(node: PlanningModelNode): string | null {
  return frontmatterString(node, 'sprintId') ?? frontmatterString(node, 'sprint');
}

/** Status columns follow the artifact vocabulary; every status gets a column, empty or not. */
function statusColumns(items: readonly PlanningModelNode[]): readonly PlanningGroup[] {
  return ARTIFACT_STATUS_ORDER.map((status) => ({
    key: status,
    label: status,
    nodes: items.filter((node) => node.status === status),
  }));
}

function artifactCount(total: number): string {
  return `${total} ${total === 1 ? 'artifact' : 'artifacts'}`;
}

function BoardCard({ node }: { node: PlanningModelNode }) {
  const sprint = sprintOf(node);
  const updated = frontmatterString(node, 'updated');
  return (
    <button
      type="button"
      className="pc-status-board__card"
      data-keyboard-item={node.id}
      onClick={(event) => {
        event.currentTarget.focus({ preventScroll: true });
        inspectPlanningNode(node);
      }}
      onFocus={() => inspectPlanningNode(node, false)}
    >
      <WorkItemChip type={node.type} id={planningDisplayId(node)} />
      <span className="pc-status-board__title">{node.title}</span>
      <span className="pc-status-board__foot">
        {sprint ? <span className="pc-status-board__sprint">{sprint}</span> : null}
        <span className="pc-status-board__updated">{updated ?? <Absent />}</span>
      </span>
    </button>
  );
}

function BoardColumn({ group, byStatus }: { group: PlanningGroup; byStatus: boolean }) {
  return (
    <section
      data-keyboard-column={group.key}
      className="pc-status-board__column"
      aria-label={group.label}
    >
      <header className="pc-status-board__head">
        {byStatus ? (
          <ArtifactStatus status={group.key} size="sm" />
        ) : (
          <span className="pc-status-board__label">{group.label}</span>
        )}
        <span className="pc-status-board__count">{group.nodes.length}</span>
      </header>
      <div className="pc-status-board__cards">
        {group.nodes.map((node) => (
          <BoardCard key={node.id} node={node} />
        ))}
        {group.nodes.length === 0 ? (
          <button
            type="button"
            className="pc-status-board__empty"
            data-keyboard-item={`empty:${group.key}`}
            aria-label={`${group.label}: no cards`}
          >
            No cards
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function BoardPage({ currentBinding, current }: BoardPageProps) {
  const token = usePlanningView();
  const presentation = token?.route === 'board' ? token : null;
  const [dimension, setDimension] = useState<string>(presentation?.groupBy ?? 'status');
  useEffect(() => {
    if (presentation) setDimension(presentation.groupBy);
  }, [presentation]);
  const model = resolvePlanningWorkspace(current, currentBinding);
  if (!model) {
    return <PlanningRefusal routeKind="planning.board" title="Planning cannot be trusted" />;
  }

  const items = applyPlanningView(
    model.graph.nodes.filter((node) => node.type !== 'sprint'),
    presentation,
  );
  const availableDimensions = planningGroupingDimensions(items);
  const dimensions = [
    { key: 'none', label: 'None' },
    ...availableDimensions,
    ...(!availableDimensions.some((entry) => entry.key === 'spec')
      ? [{ key: 'spec', label: 'Spec' }]
      : []),
    { key: 'label', label: 'Label' },
  ];
  const active = dimensions.find((entry) => entry.key === dimension);
  const activeKey = active?.key ?? 'status';
  const byStatus = activeKey === 'status';
  const columns = byStatus
    ? statusColumns(items)
    : activeKey === 'none' || activeKey === 'label'
      ? groupPresentationNodes(items, activeKey)
      : groupPlanningNodes(items, activeKey);
  const groupedBy = active?.label.toLowerCase() ?? 'status';

  return (
    <div
      className="op-workspace op-planning op-planning--board pc-pipeline"
      data-route-kind="planning.board"
      data-density={presentation?.density}
    >
      <PlanningNotice presentation={model.presentation} />
      <SectionHeader
        headingLevel={1}
        eyebrow="planr-status · board"
        title="Board"
        count={artifactCount(items.length)}
        description={`Grouped by ${groupedBy}. Read-only; status changes come from the CLI lifecycle.`}
      />
      {items.length === 0 ? (
        <EmptyState
          icon="columns-3"
          title="No artifacts yet"
          description="The board fills in as the graph gains epics, features, stories and tasks."
          action={<CommandHint command="/planr-plan" label="create the graph" size="sm" />}
        />
      ) : (
        <>
          {dimensions.length > 1 ? (
            <Toolbar>
              <span className="pc-status-board__group">group by</span>
              <Select
                value={activeKey}
                onChange={setDimension}
                options={dimensions.map((entry) => ({ value: entry.key, label: entry.label }))}
                ariaLabel="Group by"
                size="sm"
              />
            </Toolbar>
          ) : null}
          <div data-scroll-context="board" className="pc-status-board">
            {columns.map((group) => (
              <BoardColumn key={group.key || 'none'} group={group} byStatus={byStatus} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
