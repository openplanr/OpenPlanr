import { useMemo, useState } from 'react';
import { Skeleton } from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { useInspectorStore } from '../shell/inspector-selection.js';
import { useLiveListSelection } from './planning-inspector.js';
import { sprintsPageModel } from './planning-sprints-view.js';
import {
  PlanningNotice,
  PlanningRefusal,
  type PlanningWorkspaceModel,
  resolvePlanningWorkspace,
} from './planning-workspace.js';
import { ActiveSprintCard } from './SprintsActive.js';
import {
  NoActiveSprint,
  PastSprintCard,
  SprintsHeader,
  SprintsSelectionBar,
  SprintTimeline,
} from './SprintsParts.js';
import './sprints.css';

export type SprintsPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

function SprintsContent({ model }: { model: PlanningWorkspaceModel }) {
  const [now] = useState(() => Date.now());
  const { graph } = model;
  const { records, active, timeline, past, none } = useMemo(
    () => sprintsPageModel(graph, now),
    [graph, now],
  );
  const inspector = useInspectorStore();
  const selectedId = inspector.selection?.kind === 'node' ? inspector.selection.id : undefined;
  const visible = active.flatMap((view) => view.items.map((item) => item.node));
  const { rootRef, removalNotice } = useLiveListSelection(graph.nodes, visible, selectedId);
  const selected = visible.find((node) => node.id === selectedId);
  return (
    <div
      ref={rootRef}
      className="op-workspace op-planning pc-sprints"
      data-route-kind="planning.sprints"
    >
      <PlanningNotice presentation={model.presentation} />
      <p className="pc-visually-hidden" role="status">
        {removalNotice}
      </p>
      <SprintsHeader count={records.length} action={active.length > 0} />
      {active.length ? (
        active.map((view) => (
          <ActiveSprintCard key={view.record.node.id} view={view} selectedId={selectedId} />
        ))
      ) : (
        <NoActiveSprint summary={none} />
      )}
      {records.length ? (
        <SprintTimeline
          timeline={timeline}
          activeIds={new Set(active.map((view) => view.record.node.id))}
        />
      ) : null}
      {past.map((record) => (
        <PastSprintCard key={record.node.id} record={record} />
      ))}
      <SprintsSelectionBar selected={selected} />
    </div>
  );
}

export function SprintsPage({ currentBinding, current }: SprintsPageProps) {
  const model = resolvePlanningWorkspace(current, currentBinding);
  if (model)
    return (
      <SprintsContent
        key={JSON.stringify([
          model.binding.actorId,
          model.binding.projectId,
          model.binding.generation,
        ])}
        model={model}
      />
    );
  if (current.kind === 'loading' || current.kind === 'booting')
    return (
      <div
        className="op-workspace op-planning pc-sprints"
        data-route-kind="planning.sprints"
        aria-busy="true"
      >
        <header className="pc-sprints__header">
          <h1>Sprints</h1>
        </header>
        <p className="pc-visually-hidden" role="status">
          Reading .planr/
        </p>
        <div className="pc-sprints__loading">
          <Skeleton h={586} radius="12px" />
        </div>
      </div>
    );
  return <PlanningRefusal routeKind="planning.sprints" title="Planning cannot be trusted" />;
}
