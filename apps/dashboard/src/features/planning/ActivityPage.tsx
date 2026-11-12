import { useId, useMemo, useState } from 'react';
import { Skeleton } from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { useInspectorStore } from '../shell/inspector-selection.js';
import { ActivityFilterRow } from './ActivityFilters.js';
import {
  ActivityChart,
  ActivityFeed,
  ActivityHeader,
  ActivitySelectionBar,
  ActivitySinceOpened,
  ActivityState,
  BusiestSpecs,
} from './ActivityParts.js';
import {
  activityEmptyState,
  activityModel,
  nextActivityRange,
  useActivityFilters,
} from './planning-activity-state.js';
import { useLiveListSelection } from './planning-inspector.js';
import {
  EMPTY_SESSION_ACTIVITY,
  type PlanningSessionActivity,
  planningActivityScope,
  usePlanningSessionActivity,
} from './planning-session-activity.js';
import {
  PlanningNotice,
  PlanningRefusal,
  type PlanningWorkspaceModel,
  resolvePlanningWorkspace,
} from './planning-workspace.js';
import './activity.css';

export type ActivityPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
  sessionActivity?: PlanningSessionActivity;
}>;

function ActivityContent({
  model,
  activity,
}: {
  model: PlanningWorkspaceModel;
  activity: PlanningSessionActivity;
}) {
  const feedId = useId();
  const { nodes } = model.graph;
  const [filters, setFilters] = useActivityFilters();
  const data = useMemo(
    () => activityModel(nodes, activity.entries, filters, Date.now()),
    [nodes, activity.entries, filters],
  );
  const rows = data.days.flatMap((day) => day.rows);
  const inspector = useInspectorStore();
  const selectedId = inspector.selection?.kind === 'node' ? inspector.selection.id : undefined;
  const visible = rows.flatMap((row) =>
    row.kind !== 'removed' && row.current ? [row.current] : [],
  );
  const { rootRef, removalNotice } = useLiveListSelection(nodes, visible, selectedId);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = rows.find(
    (row) => row.key === selectedKey && row.kind !== 'removed' && row.current?.id === selectedId,
  );
  const empty = activityEmptyState(data, filters);
  const earlier = data.earlier ? nextActivityRange(filters.days) : null;
  const specs =
    filters.spec && !data.specs.includes(filters.spec) ? [...data.specs, filters.spec] : data.specs;
  return (
    <div
      ref={rootRef}
      className="op-workspace op-planning pc-activity"
      data-route-kind="planning.activity"
    >
      <PlanningNotice presentation={model.presentation} />
      {removalNotice ? (
        <p className="pc-visually-hidden" role="status">
          {removalNotice}
        </p>
      ) : null}
      <ActivityHeader
        total={data.total}
        days={filters.days}
        chart={<ActivityChart bars={data.chart} />}
      />
      <ActivityFilterRow
        filters={filters}
        counts={data.counts}
        specs={specs}
        panelId={feedId}
        onChange={setFilters}
      />
      <div className="pc-activity__body">
        <div id={feedId} className="pc-activity__main">
          {empty ? (
            <ActivityState
              heading={empty.heading}
              line={empty.line}
              action={empty.action}
              onAction={() => setFilters(empty.next)}
            />
          ) : (
            <ActivityFeed
              days={data.days}
              selectedKey={selected ? selected.key : null}
              onSelect={setSelectedKey}
            />
          )}
          {earlier && !empty ? (
            <button
              type="button"
              className="pc-activity__button pc-activity__earlier"
              onClick={() => setFilters({ days: earlier })}
            >
              Show earlier days
            </button>
          ) : null}
        </div>
        <aside className="pc-activity__side" aria-label="Activity summary">
          <ActivitySinceOpened connection={activity.connection} rows={data.session} />
          {data.busiest.length ? (
            <BusiestSpecs specs={data.busiest} onSpec={(spec) => setFilters({ spec })} />
          ) : null}
        </aside>
      </div>
      <ActivitySelectionBar selected={selected?.current ?? undefined} />
    </div>
  );
}

function ActivityLoading() {
  return (
    <div
      className="op-workspace op-planning pc-activity"
      data-route-kind="planning.activity"
      aria-busy="true"
    >
      <header className="pc-activity__header">
        <h1>Activity</h1>
      </header>
      <span className="pc-visually-hidden" role="status">
        Loading Activity
      </span>
      <div className="pc-activity__body pc-activity__loading">
        <div className="pc-activity__main">
          <Skeleton h={41} />
          <Skeleton h={45} />
          <Skeleton h={45} />
          <Skeleton h={45} />
        </div>
        <div className="pc-activity__side">
          <Skeleton h={235} radius="12px" />
        </div>
      </div>
    </div>
  );
}

export function ActivityPage({ currentBinding, current, sessionActivity }: ActivityPageProps) {
  const contextual = usePlanningSessionActivity();
  if (current.kind === 'booting' || current.kind === 'loading') return <ActivityLoading />;
  const model = resolvePlanningWorkspace(current, currentBinding);
  if (!model) {
    return <PlanningRefusal routeKind="planning.activity" title="Planning cannot be trusted" />;
  }
  const supplied = sessionActivity ?? contextual;
  const activity =
    supplied.scope === planningActivityScope(currentBinding) ? supplied : EMPTY_SESSION_ACTIVITY;
  return (
    <ActivityContent model={model} activity={{ ...activity, connection: supplied.connection }} />
  );
}
