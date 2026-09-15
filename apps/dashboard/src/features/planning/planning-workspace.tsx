import { StatePanel } from '../../design-system/components/index.js';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import { isValidatedDashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import {
  createDashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../lib/binding/query-identity.js';
import type { PlanningGraphEnvelope } from './planning-api.js';
import type { PlanningModelGraph, PlanningModelNode } from './planning-model.js';

export type PlanningPresentation =
  | 'ready'
  | 'read-only'
  | 'stale'
  | 'partial'
  | 'blocked'
  | 'offline';

export type PlanningWorkspaceModel = Readonly<{
  envelope: PlanningGraphEnvelope;
  graph: PlanningModelGraph;
  presentation: PlanningPresentation;
  binding: DashboardQueryIdentity;
  readOnly: true;
  mutationEnabled: false;
}>;

const PRESENTATION = Object.freeze({
  ready: 'ready',
  'read-only': 'read-only',
  stale: 'stale',
  partial: 'partial',
  blocked: 'blocked',
  offline: 'offline',
} satisfies Readonly<Record<PlanningPresentation, PlanningPresentation>>);

const PRESENTATION_NOTICE = Object.freeze({
  'read-only': 'This plan is available to review, but changes are not available here.',
  stale: 'This plan may be out of date.',
  partial: 'Some planning information is unavailable.',
  blocked: 'Planning information is temporarily unavailable.',
  offline:
    'You’re viewing the last available Planning information. Reconnect before checking again.',
} satisfies Readonly<Record<Exclude<PlanningPresentation, 'ready'>, string>>);

const PLANNING_ROUTES = Object.freeze([
  '#/overview',
  '#/graph',
  '#/board',
  '#/list',
  '#/sprints',
  '#/activity',
  '#/search',
]);

function exactPlanningBinding(value: DashboardQueryIdentity): DashboardQueryIdentity | null {
  try {
    const binding = createDashboardQueryIdentity(value);
    const collection = PLANNING_ROUTES.includes(binding.route);
    const detail =
      binding.subjectId !== null &&
      (binding.route === `#/detail/${encodeURIComponent(binding.subjectId)}` ||
        binding.route === `#/plan/specs/${encodeURIComponent(binding.subjectId)}`);
    return binding.productArea === 'planning' &&
      (collection || detail) &&
      binding.eventHead !== null &&
      binding.viewHash !== null
      ? binding
      : null;
  } catch {
    return null;
  }
}

function asPlanningEnvelope(value: unknown): PlanningGraphEnvelope | null {
  if (typeof value !== 'object' || value === null || !Object.isFrozen(value)) return null;
  const kind = Reflect.get(value, 'kind');
  const graph = Reflect.get(value, 'graph');
  if (kind !== 'planning-graph-snapshot' || typeof graph !== 'object' || graph === null) {
    return null;
  }
  const nodes = Reflect.get(graph, 'nodes');
  const edges = Reflect.get(graph, 'edges');
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return null;
  return value as PlanningGraphEnvelope;
}

export function planningNodesFromProductState(
  state: DashboardProductState<unknown>,
): readonly PlanningModelNode[] {
  if (!isValidatedDashboardProductState(state) || state.data === null) {
    return Object.freeze([]);
  }
  const envelope = asPlanningEnvelope(state.data);
  return envelope ? Object.freeze([...envelope.graph.nodes]) : Object.freeze([]);
}

export function resolvePlanningWorkspace(
  state: DashboardProductState<unknown>,
  current: DashboardQueryIdentity,
): PlanningWorkspaceModel | null {
  const binding = exactPlanningBinding(current);
  if (
    !binding ||
    !isValidatedDashboardProductState(state) ||
    state.binding === null ||
    state.data === null ||
    !isCurrentDashboardQuery(state.binding, binding)
  ) {
    return null;
  }
  const presentation = PRESENTATION[state.kind as PlanningPresentation];
  const envelope = asPlanningEnvelope(state.data);
  if (presentation === undefined || envelope === null) return null;
  return Object.freeze({
    envelope,
    graph: envelope.graph,
    presentation,
    binding: state.binding,
    readOnly: true,
    mutationEnabled: false,
  });
}

export function PlanningNotice({ presentation }: { presentation: PlanningPresentation }) {
  if (presentation === 'ready') return null;
  return (
    <p className="op-planning-notice" role="status">
      {PRESENTATION_NOTICE[presentation]}{' '}
      <a className="op-inline-action" href="#/overview">
        Open Planning overview
      </a>
    </p>
  );
}

export function PlanningRefusal({ routeKind, title }: { routeKind: string; title: string }) {
  return (
    <div className="op-workspace op-planning" data-route-kind={routeKind}>
      <StatePanel
        state="incompatible"
        eyebrow="Planning unavailable"
        title={title}
        description="We could not verify the Planning information for this view, so it is not shown."
        actions={
          <a className="op-inline-action" href="#/overview">
            Return to Planning overview
          </a>
        }
      />
    </div>
  );
}
