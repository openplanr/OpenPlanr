import { StatePanel } from '../../../design-system/components/index.js';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import { useBoundProjection } from '../../../lib/query/use-bound-projection.js';
import type { OperateReviewNavigation } from '../review/review-navigation.js';
import { CycleDetailPage } from './CycleDetailPage.js';
import type { OperateCycleModelSources } from './cycle-model.js';
import { createOperateExecutiveBoardDisplayValidator } from './executive-board-model.js';
import { fetchOperateExecutiveBoardDisplay } from './operate-cycle-api.js';

export type CycleDetailRouteProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  workspace: DashboardProductState<unknown>;
  reviewNavigation?: OperateReviewNavigation | null;
}>;

function liveOrigin(): string {
  if (typeof window === 'undefined') return '';
  const { origin, protocol, hostname, pathname, search, hash } = window.location;
  if (protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(hostname)) return '';
  if (pathname !== '/' || search || hash) return '';
  return origin;
}

function executiveBoardProductState(
  binding: DashboardQueryIdentity,
  value: unknown,
): DashboardProductState<unknown> | null {
  const validate = createOperateExecutiveBoardDisplayValidator(binding);
  if (!validate(value)) return null;
  return parseDashboardProductState(
    {
      kind: 'ready',
      binding,
      data: value,
      reasonCodes: [],
      error: null,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy('ready'),
    },
    { currentBinding: binding, validateData: validate },
  );
}

function useExecutiveBoardSource(
  binding: DashboardQueryIdentity,
  enabled: boolean,
): DashboardProductState<unknown> | null | undefined {
  const origin = liveOrigin();
  const liveEnabled = enabled && origin.length > 0;
  const projection = useBoundProjection<DashboardProductState<unknown> | null>({
    identity: binding,
    sourceKey: liveEnabled ? 'executive-board' : 'executive-board-offline',
    read: async ({ identity, signal }) => {
      if (!liveEnabled || identity.cycleId === null) return null;
      return fetchOperateExecutiveBoardDisplay({
        origin,
        identity,
        signal,
      });
    },
    validate: (value) => {
      if (value === null) return null;
      const validated = executiveBoardProductState(binding, value);
      if (!validated) throw new Error('Executive board display did not verify.');
      return validated;
    },
  });
  if (!enabled) return undefined;
  if (!liveEnabled) return null;
  if (projection.phase === 'loading' || projection.phase === 'refreshing') return undefined;
  if (projection.phase !== 'ready') return null;
  return projection.data;
}

/** Live shell bootstrap for Cycle detail: pairs the bound workspace with an optional board read. */
export function CycleDetailRoute({
  currentBinding,
  workspace,
  reviewNavigation = null,
}: CycleDetailRouteProps) {
  const fetchBoard = currentBinding.domainId === 'business';
  const executiveBoard = useExecutiveBoardSource(currentBinding, fetchBoard);
  const sources: OperateCycleModelSources = Object.freeze({
    current: Object.freeze({
      workspace,
      ...(fetchBoard ? { executiveBoard: executiveBoard ?? null } : {}),
    }),
  });

  if (fetchBoard && executiveBoard === undefined) {
    return (
      <div className="op-workspace op-cycle-detail" data-route-kind="operate.cycle">
        <StatePanel
          state="booting"
          eyebrow="Executive board"
          title="Loading executive board"
          description="Waiting for the owner-issued executive board display for this business Cycle."
        />
      </div>
    );
  }

  return (
    <CycleDetailPage
      currentBinding={currentBinding}
      sources={sources}
      reviewNavigation={reviewNavigation}
    />
  );
}
