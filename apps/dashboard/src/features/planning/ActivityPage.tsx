import {
  Card,
  CommandHint,
  EmptyState,
  InlineAlert,
  SectionHeader,
  Skeleton,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { usePlanningView } from '../../lib/routing/planning-presentation.js';
import { ActivitySessionFeed } from './ActivitySessionFeed.js';
import {
  EMPTY_SESSION_ACTIVITY,
  type PlanningSessionActivity,
  planningActivityScope,
  usePlanningSessionActivity,
} from './planning-session-activity.js';
import { PlanningNotice, PlanningRefusal, resolvePlanningWorkspace } from './planning-workspace.js';
import { applyPlanningView } from './presentation-view.js';
import './planning.css';
import './activity.css';

export type ActivityPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
  sessionActivity?: PlanningSessionActivity;
}>;

export function ActivityPage({ currentBinding, current, sessionActivity }: ActivityPageProps) {
  const token = usePlanningView();
  const contextualActivity = usePlanningSessionActivity();
  const presentation = token?.route === 'activity' ? token : null;
  const model = resolvePlanningWorkspace(current, currentBinding);
  const supplied = sessionActivity ?? contextualActivity;
  const activity =
    supplied.scope === planningActivityScope(currentBinding) ? supplied : EMPTY_SESSION_ACTIVITY;
  if (current.kind === 'booting' || current.kind === 'loading') return <ActivityLoading />;
  if (!model) {
    return <PlanningRefusal routeKind="planning.activity" title="Planning cannot be trusted" />;
  }
  const entries = activity.entries.filter(
    (entry) =>
      !presentation ||
      (entry.node !== null && applyPlanningView([entry.node], presentation).length > 0),
  );
  const snapshotItems = applyPlanningView(model.graph.nodes, presentation);
  const withUpdated = snapshotItems.filter(
    (node) => node.frontmatter.updated != null && node.frontmatter.updated !== '',
  ).length;

  return (
    <div
      className="op-workspace op-planning pc-pipeline pc-activity"
      data-route-kind="planning.activity"
      data-density={presentation?.density}
    >
      <PlanningNotice presentation={model.presentation} />
      <SectionHeader
        headingLevel={1}
        eyebrow="What changed"
        title="Activity"
        count={presentation ? `${snapshotItems.length} matching snapshot items` : undefined}
        description="Durable history is unavailable. Live patches below belong to this browser session only."
      />
      <Card padding={0}>
        <div className="pc-activity__durable" data-activity-source="durable-unavailable">
          <EmptyState
            icon="activity"
            title="Durable activity history unavailable"
            description="There is no durable history in the current graph. A graph snapshot is not a change log. Authored-date history and day groups are unavailable in this phase."
          />
          <div className="pc-activity__aid">
            <CommandHint
              command="openplanr status --md"
              label="inspect delivery status without changing state"
              size="sm"
            />
            <InlineAlert tone="info" title="Current snapshot only">
              {withUpdated} of {snapshotItems.length} matching items carry one authored updated
              date, shown on List. A graph snapshot carries no history. These dates do not establish
              a status transition or a durable event.
            </InlineAlert>
          </div>
        </div>
      </Card>
      <ActivitySessionFeed
        activity={{ ...activity, connection: supplied.connection }}
        entries={entries}
        nodes={model.graph.nodes}
      />
    </div>
  );
}

function ActivityLoading() {
  return (
    <div
      className="op-workspace op-planning pc-pipeline pc-activity"
      data-route-kind="planning.activity"
      aria-busy="true"
    >
      <SectionHeader
        headingLevel={1}
        eyebrow="What changed"
        title="Activity"
        description="Durable history is unavailable. Live patches below belong to this browser session only."
      />
      <Card padding={0}>
        <div className="pc-activity__loading pc-activity__durable">
          <span className="pc-visually-hidden" role="status">
            Loading Activity
          </span>
          <Skeleton w="40%" h={24} />
          <Skeleton w="80%" h={16} />
          <Skeleton w="60%" h={16} />
        </div>
      </Card>
      <Card padding={0}>
        <div className="pc-activity__feed-head">
          <Skeleton w="30%" h={24} />
        </div>
        <p className="pc-activity__explanation">
          <Skeleton w="70%" h={16} />
        </p>
        <div className="pc-activity__feed pc-activity__loading">
          <Skeleton h={40} />
          <Skeleton h={40} />
          <Skeleton h={40} />
        </div>
        <p className="pc-activity__footnote">
          <Skeleton w="60%" h={16} />
        </p>
      </Card>
    </div>
  );
}
