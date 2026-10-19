import { Button, EmptyState } from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { PlanningArtifactDetail } from './PlanningArtifactDetail.js';
import { PlanningOperatingOriginSection } from './PlanningOperatingOriginSection.js';
import { inspectPlanningNode } from './planning-inspector.js';
import {
  type PlanningModelNode,
  planningDetailHref,
  planningNodeIdFromRouteSubject,
} from './planning-model.js';
import {
  PlanningNotice,
  PlanningRefusal,
  type PlanningWorkspaceModel,
  resolvePlanningWorkspace,
} from './planning-workspace.js';

export { PlanningArtifactDetail };

export type DetailPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

function DetailSelection({ node }: { node: PlanningModelNode }) {
  useEffect(() => inspectPlanningNode(node, false), [node]);
  return null;
}

export function DetailPage({ currentBinding, current }: DetailPageProps) {
  const specRoute = currentBinding.route.startsWith('#/plan/specs/');
  const routeKind = specRoute ? 'planning.spec' : 'planning.detail';
  const model = resolvePlanningWorkspace(current, currentBinding);
  if (!model) return <PlanningRefusal routeKind={routeKind} title="Planning cannot be trusted" />;
  const nodeId =
    currentBinding.subjectId === null
      ? null
      : planningNodeIdFromRouteSubject(currentBinding.subjectId);
  const node = model.graph.nodes.find((entry) => entry.id === nodeId);
  if (!node)
    return (
      <div className="op-workspace op-planning pc-detail" data-route-kind={routeKind}>
        <EmptyState
          icon="circle-alert"
          title={`No artifact ${currentBinding.subjectId ?? ''}`.trim()}
          description="This id is not in the current graph snapshot."
          action={
            <a className="op-inline-action" href="#/list">
              Back to List
            </a>
          }
        />
      </div>
    );
  return (
    <div className="op-workspace op-planning pc-pipeline pc-detail" data-route-kind={routeKind}>
      <DetailSelection node={node} />
      <PlanningNotice presentation={model.presentation} />
      <nav className="pc-detail__navigation" aria-label="Detail navigation">
        <a className="op-inline-action" href="#/list">
          List
        </a>
        <Button variant="ghost" size="sm" onClick={() => window.history.back()}>
          Back
        </Button>
      </nav>
      <PlanningArtifactDetail
        model={model}
        nodeId={node.id}
        origin={typeof window === 'undefined' ? '' : window.location.origin}
      />
      {node.type === 'spec' ? (
        <PlanningOperatingOriginSection specId={node.id} binding={currentBinding} />
      ) : null}
    </div>
  );
}

export function PlanningDetailInspector({
  model,
  nodeId,
  origin,
  onPromote,
}: {
  model: PlanningWorkspaceModel;
  nodeId: string;
  origin: string;
  onPromote: (href: string) => void;
}) {
  const node = model.graph.nodes.find((entry) => entry.id === nodeId);
  const href = node ? planningDetailHref(node) : null;
  return (
    <>
      {node ? (
        <Button
          size="sm"
          iconAfter="arrow-right"
          disabled={!href}
          disabledReason={
            !href ? 'A full-page route is unavailable for this artifact identity.' : undefined
          }
          onClick={() => {
            inspectPlanningNode(node, false);
            if (href) onPromote(href);
          }}
        >
          Open full page
        </Button>
      ) : null}
      <PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} panel />
      {node?.type === 'spec' ? (
        <PlanningOperatingOriginSection specId={node.id} binding={model.binding} />
      ) : null}
    </>
  );
}

import { useEffect } from 'react';
