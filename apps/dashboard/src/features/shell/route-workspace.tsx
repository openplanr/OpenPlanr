import type { useDashboard } from '../../app/providers.js';
import { dashboardRouteDefinition, type ParsedDashboardRoute } from '../../app/router.js';
import {
  SectionHeader,
  SkeletonCards,
  SkeletonTable,
  StatePanel,
} from '../../design-system/components/index.js';
import {
  type DashboardProductState,
  isValidatedDashboardProductState,
} from '../../lib/api/product-state.js';
import { isCurrentDashboardQuery } from '../../lib/binding/query-identity.js';
import type { DashboardSearchSources } from '../search/search-index.js';
import { ProjectionBoundary } from './ProjectionBoundary.js';
import { type OperateReviewNavigation, operateRouteRegistry } from './routes/operate/index.js';
import { PlanningSearchWorkspace, resolvePlanningRoutePage } from './routes/planning/index.js';

type DashboardContext = ReturnType<typeof useDashboard>;
type PlanningPageProps = Readonly<{
  currentBinding: NonNullable<DashboardContext['binding']>;
  current: NonNullable<DashboardContext['projection']>;
}>;

type RouteWorkspaceProps = Readonly<{
  route: ParsedDashboardRoute;
  projection: DashboardContext['projection'];
  binding: DashboardContext['binding'];
  connectionState: string;
  searchSources: DashboardSearchSources;
  operateSearchBindings: readonly NonNullable<DashboardContext['binding']>[];
  operateReviewNavigation: OperateReviewNavigation | null;
  refetchCurrent: () => Promise<DashboardProductState<unknown>>;
}>;

/** Route chrome may name a subject only after the current projection verifies its binding. */
export function hasCurrentRouteSubject({
  route,
  projection,
  binding,
}: Pick<RouteWorkspaceProps, 'route' | 'projection' | 'binding'>): boolean {
  return (
    isValidatedDashboardProductState(projection) &&
    projection.data !== null &&
    binding !== null &&
    projection.binding !== null &&
    isCurrentDashboardQuery(projection.binding, binding) &&
    route.subjectId === binding.subjectId
  );
}

function isPendingRouteProjection(
  projection: DashboardProductState<unknown>,
  binding: DashboardContext['binding'],
): boolean {
  if (
    !isValidatedDashboardProductState(projection) ||
    (projection.kind !== 'booting' &&
      projection.kind !== 'loading' &&
      projection.kind !== 'refreshing')
  ) {
    return false;
  }
  if (projection.binding === null) return projection.kind === 'booting' && binding === null;
  return binding !== null && isCurrentDashboardQuery(projection.binding, binding);
}

/**
 * Keep an ordinary route recognisable while its exact owner-issued projection is in flight:
 * the real header, a skeleton body in the shape the route will have. Booting, loading, and
 * refreshing are expected transit states, not a refused or unavailable product surface.
 */
function PendingRouteFrame({
  route,
  projection,
}: Pick<RouteWorkspaceProps, 'route' | 'projection'>) {
  const definition = dashboardRouteDefinition(route);
  const label = definition?.label ?? 'Workspace';
  const operate = route.product === 'operate';
  const note = projection.kind === 'refreshing' ? 'refreshing' : 'loading';

  return (
    <section
      className="op-workspace op-route-pending"
      data-route-kind={route.kind}
      data-route-pending={projection.kind}
      aria-busy="true"
    >
      <SectionHeader
        eyebrow={operate ? 'planr-operate' : 'planr-plan'}
        title={label}
        count={note}
        description={
          operate
            ? 'Reading the Operate projection. The route is already resolved.'
            : 'Reading the graph from .planr/. The route is already resolved.'
        }
      />
      {operate ? (
        <SkeletonCards count={4} label={`Loading ${label}`} />
      ) : (
        <SkeletonTable
          rows={8}
          label={`Loading ${label}`}
          columns={[
            { label: 'Item' },
            { label: 'Status', width: 132 },
            { label: 'Sprint', width: 88 },
            { label: 'Updated', width: 88 },
          ]}
        />
      )}
    </section>
  );
}

function RouteProjectionFallback({
  route,
  binding,
  projection,
  eyebrow,
  title,
  description,
}: Pick<RouteWorkspaceProps, 'route' | 'binding' | 'projection'> & {
  eyebrow: string;
  title: string;
  description: string;
}) {
  if (isPendingRouteProjection(projection, binding)) {
    return <PendingRouteFrame route={route} projection={projection} />;
  }
  if (isValidatedDashboardProductState(projection) && projection.data === null) {
    return (
      <div className="op-workspace" data-route-kind={route.kind}>
        <ProjectionBoundary currentBinding={binding} route={route} state={projection}>
          {() => null}
        </ProjectionBoundary>
      </div>
    );
  }
  return (
    <div className="op-workspace" data-route-kind={route.kind}>
      <StatePanel state="incompatible" eyebrow={eyebrow} title={title} description={description} />
    </div>
  );
}

function PlanningProjectionFallback({
  route,
  binding,
  projection,
}: Pick<RouteWorkspaceProps, 'route' | 'binding' | 'projection'>) {
  if (isPendingRouteProjection(projection, binding)) {
    return <PendingRouteFrame route={route} projection={projection} />;
  }
  if (isValidatedDashboardProductState(projection) && projection.data === null) {
    return (
      <RouteProjectionFallback
        route={route}
        binding={binding}
        projection={projection}
        eyebrow="Planning projection"
        title="Planning cannot be trusted"
        description="The current state is not a parser-verified owner-issued Planning graph."
      />
    );
  }
  return (
    <div className="op-workspace op-planning" data-route-kind={route.kind}>
      <StatePanel
        state="incompatible"
        eyebrow="Planning projection"
        title="Planning cannot be trusted"
        description="The current state is not a parser-verified owner-issued Planning graph."
      />
    </div>
  );
}

function PlanningRouteWorkspace({
  route,
  projection,
  binding,
  connectionState,
  searchSources,
  operateSearchBindings,
}: RouteWorkspaceProps) {
  if (route.kind === 'planning.search') {
    return (
      <PlanningSearchWorkspace
        sources={searchSources}
        operateBindings={operateSearchBindings}
        connectionState={connectionState}
      />
    );
  }

  const Page = resolvePlanningRoutePage<PlanningPageProps>(route);
  if (isPendingRouteProjection(projection, binding)) {
    return <PendingRouteFrame route={route} projection={projection} />;
  }
  if (Page && binding && isValidatedDashboardProductState<Record<string, unknown>>(projection)) {
    return <Page currentBinding={binding} current={projection} />;
  }
  return <PlanningProjectionFallback route={route} binding={binding} projection={projection} />;
}

function AuditRouteWorkspace({
  route,
  projection,
  binding,
}: Pick<RouteWorkspaceProps, 'route' | 'projection' | 'binding'>) {
  if (binding && isValidatedDashboardProductState<Record<string, unknown>>(projection)) {
    if (route.kind === 'operate.evidence' || route.kind === 'operate.evidence-item') {
      return (
        <operateRouteRegistry.audit.EvidencePage currentBinding={binding} current={projection} />
      );
    }
    if (route.kind === 'operate.outcomes' || route.kind === 'operate.outcome') {
      return (
        <operateRouteRegistry.audit.OutcomesPage currentBinding={binding} current={projection} />
      );
    }
    if (route.kind === 'operate.history') {
      return (
        <operateRouteRegistry.audit.HistoryPage currentBinding={binding} current={projection} />
      );
    }
  }
  const subject =
    route.kind === 'operate.history'
      ? 'History'
      : route.kind === 'operate.outcomes' || route.kind === 'operate.outcome'
        ? 'Outcomes'
        : 'Evidence';
  return (
    <div className="op-workspace op-audit" data-route-kind={route.kind}>
      <StatePanel
        state="incompatible"
        eyebrow={`${subject} projection`}
        title={`${subject} cannot be trusted`}
        description="The current state is not a parser-verified owner-issued audit projection."
      />
    </div>
  );
}

export function RouteWorkspace(props: RouteWorkspaceProps) {
  const { route, projection, binding, operateReviewNavigation, refetchCurrent } = props;
  const definition = dashboardRouteDefinition(route);
  if (!definition) {
    return (
      <div className="op-workspace op-workspace--unknown" data-route-kind="not-found">
        <p className="op-eyebrow">Closed route</p>
        <h1>Destination not available</h1>
        <p>This address is not part of the OpenPlanr dashboard route contract.</p>
        <a className="op-inline-action" href="#/overview">
          Return to Planning overview
        </a>
      </div>
    );
  }

  if (route.product === 'planning') return <PlanningRouteWorkspace {...props} />;

  if (route.kind === 'operate.today') {
    if (
      binding &&
      isValidatedDashboardProductState<Record<string, unknown>>(projection) &&
      (projection.kind === 'first-use' ||
        projection.kind === 'empty' ||
        (projection.data !== null &&
          operateRouteRegistry.today.createValidator(binding)(projection.data)))
    ) {
      return (
        <operateRouteRegistry.today.Page
          currentBinding={binding}
          sources={{ current: projection }}
        />
      );
    }
    return (
      <RouteProjectionFallback
        {...props}
        eyebrow="Today projection"
        title="Today cannot be trusted"
        description="The current state is not a parser-verified owner-issued Today projection."
      />
    );
  }

  if (route.kind === 'operate.cycles') {
    if (
      binding &&
      isValidatedDashboardProductState<Record<string, unknown>>(projection) &&
      projection.data !== null &&
      operateRouteRegistry.cycles.createListValidator(binding)(projection.data)
    ) {
      return <operateRouteRegistry.cycles.ListPage currentBinding={binding} current={projection} />;
    }
    return (
      <RouteProjectionFallback
        {...props}
        eyebrow="Cycle projection"
        title="Cycles cannot be trusted"
        description="The current state is not a parser-verified owner-issued Cycles projection."
      />
    );
  }

  if (route.kind === 'operate.cycle') {
    if (
      binding &&
      isValidatedDashboardProductState<Record<string, unknown>>(projection) &&
      projection.data !== null
    ) {
      return (
        <operateRouteRegistry.cycles.DetailRoute
          currentBinding={binding}
          workspace={projection}
          reviewNavigation={operateReviewNavigation}
        />
      );
    }
    return (
      <RouteProjectionFallback
        {...props}
        eyebrow="Cycle projection"
        title="Cycle cannot be trusted"
        description="The current state is not a parser-verified owner-issued Cycle projection."
      />
    );
  }

  if (route.kind === 'operate.review') {
    if (
      binding &&
      isValidatedDashboardProductState<Record<string, unknown>>(projection) &&
      projection.data !== null &&
      operateRouteRegistry.review.createValidator(binding)(projection.data)
    ) {
      return (
        <operateRouteRegistry.review.Page
          currentBinding={binding}
          current={projection}
          onRefetch={refetchCurrent}
        />
      );
    }
    return (
      <RouteProjectionFallback
        {...props}
        eyebrow="Review projection"
        title="Review cannot be trusted"
        description="The current state is not a parser-verified owner-issued Review workspace."
      />
    );
  }

  if (route.kind === 'operate.actions') {
    if (
      binding &&
      isValidatedDashboardProductState<Record<string, unknown>>(projection) &&
      operateRouteRegistry.actions.createListValidator(binding)(projection.data)
    ) {
      return (
        <operateRouteRegistry.actions.ListPage currentBinding={binding} current={projection} />
      );
    }
    return (
      <RouteProjectionFallback
        {...props}
        eyebrow="Action projection"
        title="Actions cannot be trusted"
        description="The current state is not a parser-verified owner-issued Actions projection."
      />
    );
  }

  if (route.kind === 'operate.action-planning') {
    if (
      binding &&
      isValidatedDashboardProductState<Record<string, unknown>>(projection) &&
      projection.data !== null
    ) {
      return (
        <operateRouteRegistry.actions.PlanningHandoffPage
          currentBinding={binding}
          current={projection}
          onRefetch={refetchCurrent}
        />
      );
    }
    return (
      <RouteProjectionFallback
        {...props}
        eyebrow="Action projection"
        title="Action cannot be trusted"
        description="The current state is not a parser-verified owner-issued Action workspace."
      />
    );
  }

  if (route.kind === 'operate.action') {
    if (
      binding &&
      isValidatedDashboardProductState<Record<string, unknown>>(projection) &&
      operateRouteRegistry.actions.createDetailValidator(binding)(projection.data)
    ) {
      return (
        <operateRouteRegistry.actions.DetailPage
          currentBinding={binding}
          current={projection}
          onRefetch={refetchCurrent}
        />
      );
    }
    return (
      <RouteProjectionFallback
        {...props}
        eyebrow="Action projection"
        title="Action cannot be trusted"
        description="The current state is not a parser-verified owner-issued Action workspace."
      />
    );
  }

  if (route.kind === 'operate.recovery') {
    if (
      binding &&
      isValidatedDashboardProductState<Record<string, unknown>>(projection) &&
      operateRouteRegistry.inboxRecovery.createRecoveryValidator(binding)(projection.data)
    ) {
      return (
        <operateRouteRegistry.inboxRecovery.RecoveryPage
          currentBinding={binding}
          current={projection}
        />
      );
    }
    return (
      <RouteProjectionFallback
        {...props}
        eyebrow="Recovery projection"
        title="Recovery cannot be trusted"
        description="The current state is not a parser-verified owner-issued recovery display."
      />
    );
  }

  if (route.kind === 'operate.inbox' || route.kind === 'operate.inbox-item') {
    if (
      binding &&
      isValidatedDashboardProductState<Record<string, unknown>>(projection) &&
      operateRouteRegistry.inboxRecovery.createInboxValidator(binding)(projection.data)
    ) {
      return (
        <operateRouteRegistry.inboxRecovery.InboxPage
          currentBinding={binding}
          current={projection}
          onRefetch={refetchCurrent}
        />
      );
    }
    return (
      <RouteProjectionFallback
        {...props}
        eyebrow="Inbox projection"
        title="Inbox cannot be trusted"
        description="The current state is not a parser-verified owner-issued Inbox projection."
      />
    );
  }

  if (
    route.kind === 'operate.evidence' ||
    route.kind === 'operate.evidence-item' ||
    route.kind === 'operate.outcomes' ||
    route.kind === 'operate.outcome' ||
    route.kind === 'operate.history'
  ) {
    return <AuditRouteWorkspace route={route} projection={projection} binding={binding} />;
  }

  return (
    <div className="op-workspace op-workspace--unknown" data-route-kind={route.kind}>
      <StatePanel
        state="incompatible"
        eyebrow="Route composition"
        title="Destination is not implemented"
        description="This parsed route has no dedicated verified workspace in the current dashboard build."
      />
    </div>
  );
}
