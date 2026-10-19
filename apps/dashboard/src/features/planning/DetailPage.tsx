import { Button, EmptyState, PcIcon } from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { PlanningArtifactDetail } from './PlanningArtifactDetail.js';
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

function detailSourceHref(): string {
  if (typeof window === 'undefined') return '#/list';
  const state: unknown = window.history.state;
  return state &&
    typeof state === 'object' &&
    'planningDetailOrigin' in state &&
    typeof state.planningDetailOrigin === 'string' &&
    state.planningDetailOrigin.startsWith('#/')
    ? state.planningDetailOrigin
    : '#/list';
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
        <a className="pc-button" data-variant="ghost" data-size="sm" href={detailSourceHref()}>
          <PcIcon name="chevron-left" size={15} />
          List
        </a>
      </nav>
      <PlanningArtifactDetail
        model={model}
        nodeId={node.id}
        origin={typeof window === 'undefined' ? '' : window.location.origin}
      />
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
            if (href) {
              const sourceHref = window.location.hash;
              onPromote(href);
              const state: unknown = window.history.state;
              window.history.replaceState(
                {
                  ...(state && typeof state === 'object' ? state : {}),
                  planningDetailOrigin: sourceHref,
                },
                '',
              );
            }
          }}
        >
          Open full page
        </Button>
      ) : null}
      <PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} panel />
    </>
  );
}

import { useEffect } from 'react';
