import type { ComponentType } from 'react';
import type { ParsedDashboardRoute } from '../../../../app/router.js';
import { SearchWorkspace } from '../../../search/CommandPalette.js';
import { planningRoutePages } from './pages.js';

export type { PlanningRoutePageProps } from './pages.js';

export function resolvePlanningRoutePage<TProps>(
  route: ParsedDashboardRoute,
): ComponentType<TProps> | null {
  return (planningRoutePages[route.kind] as ComponentType<TProps> | undefined) ?? null;
}

export const PlanningSearchWorkspace = SearchWorkspace;
