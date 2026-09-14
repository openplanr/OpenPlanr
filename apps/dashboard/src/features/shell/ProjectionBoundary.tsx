import type { ReactNode } from 'react';
import type { ParsedDashboardRoute } from '../../app/router.js';
import { serializeDashboardRoute } from '../../app/router.js';
import { StatePanel } from '../../design-system/components/index.js';
import {
  type DashboardProductState,
  isValidatedDashboardProductState,
} from '../../lib/api/product-state.js';
import {
  type DashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../lib/binding/query-identity.js';
import { ProductStateView } from '../diagnostics/ProductStateView.js';

export type ProjectionBoundaryProps<T> = Readonly<{
  currentBinding: DashboardQueryIdentity | null;
  route?: ParsedDashboardRoute;
  state: DashboardProductState<T>;
  requiredReadyFields?: readonly (keyof T & string)[];
  validateReadyData?: (data: T) => boolean;
  children: (
    data: T,
    presentation: DashboardProductState<T>['kind'],
    mutationAllowed: boolean,
  ) => ReactNode;
}>;

type BoundaryResolution<T> =
  | Readonly<{ presentation: DashboardProductState<T>['kind']; data: T }>
  | Readonly<{
      presentation: 'incompatible';
      reason: Readonly<{ title: string; detail: string }>;
    }>;

const INCOMPATIBLE = Object.freeze({
  presentation: 'incompatible' as const,
  reason: Object.freeze({
    title: 'Projection is incompatible',
    detail: 'The parser-branded state does not match the exact current route binding.',
  }),
});

/** Testable resolution helper for the single parser-branded product-state contract. */
export function resolveProjectionBoundary<T>(
  state: DashboardProductState<T>,
  currentBinding: DashboardQueryIdentity | null,
  requiredReadyFields: readonly (keyof T & string)[] = [],
  validateReadyData: (data: T) => boolean = () => true,
): BoundaryResolution<T> {
  if (!isValidatedDashboardProductState<T>(state)) return INCOMPATIBLE;
  if (state.binding !== null) {
    if (!currentBinding || !isCurrentDashboardQuery(state.binding, currentBinding)) {
      return INCOMPATIBLE;
    }
  }
  if (state.data === null) return INCOMPATIBLE;
  if (
    requiredReadyFields.some(
      (field) => state.data?.[field] === undefined || state.data?.[field] === null,
    ) ||
    !validateReadyData(state.data)
  ) {
    return INCOMPATIBLE;
  }
  return Object.freeze({ presentation: state.kind, data: state.data });
}

/** Render only states issued by the closed DashboardProductState parser. */
export function ProjectionBoundary<T>({
  currentBinding,
  route,
  state,
  children,
}: ProjectionBoundaryProps<T>) {
  const routeOwnsBinding =
    !route ||
    currentBinding === null ||
    (route.kind !== 'not-found' &&
      currentBinding.route === serializeDashboardRoute(route) &&
      currentBinding.productArea === route.product &&
      currentBinding.subjectId === route.subjectId);

  if (!isValidatedDashboardProductState<T>(state)) {
    return (
      <section
        className="op-projection-boundary"
        data-projection-boundary="incompatible"
        aria-label="Current product state"
      >
        <StatePanel
          state="incompatible"
          eyebrow="State boundary"
          title="Product state could not be validated"
          description="OpenPlanr rejected an unverified state before presenting any product data."
        />
      </section>
    );
  }

  return (
    <section
      className="op-projection-boundary"
      data-projection-boundary={state.kind}
      aria-label="Current product state"
    >
      <ProductStateView state={state} currentBinding={routeOwnsBinding ? currentBinding : null}>
        {children}
      </ProductStateView>
    </section>
  );
}
