import {
  Card,
  CommandHint,
  EmptyState,
  InlineAlert,
  SectionHeader,
} from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { usePlanningView } from '../../lib/routing/planning-presentation.js';
import type { PlanningModelNode } from './planning-model.js';
import { PlanningNotice, PlanningRefusal, resolvePlanningWorkspace } from './planning-workspace.js';
import { applyPlanningView } from './presentation-view.js';
import './planning.css';
import './activity.css';

export type ActivityPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

function carriesUpdated(node: PlanningModelNode): boolean {
  const raw = node.frontmatter.updated;
  return raw != null && raw !== '';
}

export function ActivityPage({ currentBinding, current }: ActivityPageProps) {
  const token = usePlanningView();
  const presentation = token?.route === 'activity' ? token : null;
  const model = resolvePlanningWorkspace(current, currentBinding);
  if (!model) {
    return <PlanningRefusal routeKind="planning.activity" title="Planning cannot be trusted" />;
  }

  const items = applyPlanningView(model.graph.nodes, presentation);
  const total = items.length;
  const withUpdated = items.filter(carriesUpdated).length;

  return (
    <div
      className="op-workspace op-planning pc-pipeline pc-activity"
      data-route-kind="planning.activity"
      data-density={presentation?.density}
    >
      <PlanningNotice presentation={model.presentation} />
      <SectionHeader
        headingLevel={1}
        eyebrow="planr-status"
        title="Activity"
        count={presentation ? `${total} matching snapshot items` : undefined}
        description="Owner-issued watcher patches only. A graph snapshot is not a change log."
      />
      <Card padding={0}>
        <EmptyState
          icon="activity"
          title="No activity returned"
          description="Activity is a live patch feed, not a history. This route was given a graph snapshot, which carries no change log; empty is the normal state, not an error."
        />
        <div className="pc-activity__aid">
          <CommandHint
            command="/planr-status"
            label="inspect delivery status without changing state"
            size="sm"
          />
          <InlineAlert tone="info" title="Looking for what changed?">
            {withUpdated > 0 ? (
              <>
                A graph snapshot carries no history. The nearest signal is each item's{' '}
                <code className="pc-activity__code">updated</code> frontmatter: {withUpdated} of{' '}
                {total} matching items carry one, shown on List.
              </>
            ) : (
              <>
                A graph snapshot carries no history, and no item in this snapshot carries{' '}
                <code className="pc-activity__code">updated</code> frontmatter.
              </>
            )}
          </InlineAlert>
        </div>
      </Card>
    </div>
  );
}
