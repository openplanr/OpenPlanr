import type { ComponentType } from 'react';
import type { ParsedDashboardRoute } from '../../../../app/router.js';
import { ActivityPage } from '../../../planning/ActivityPage.js';
import { BoardPage } from '../../../planning/BoardPage.js';
import { ConsolePage } from '../../../planning/ConsolePage.js';
import { DetailPage } from '../../../planning/DetailPage.js';
import { GraphPage } from '../../../planning/GraphPage.js';
import { ListPage } from '../../../planning/ListPage.js';
import { OverviewPage } from '../../../planning/OverviewPage.js';
import { SprintsPage } from '../../../planning/SprintsPage.js';

export type PlanningRoutePageProps<TBinding, TProjection> = Readonly<{
  currentBinding: TBinding;
  current: TProjection;
}>;

export type PlanningRoutePage = ComponentType<PlanningRoutePageProps<never, never>>;

export const planningRoutePages: Readonly<
  Partial<Record<ParsedDashboardRoute['kind'], PlanningRoutePage>>
> = Object.freeze({
  'planning.overview': OverviewPage as PlanningRoutePage,
  'planning.graph': GraphPage as PlanningRoutePage,
  'planning.board': BoardPage as PlanningRoutePage,
  'planning.list': ListPage as PlanningRoutePage,
  'planning.sprints': SprintsPage as PlanningRoutePage,
  'planning.activity': ActivityPage as PlanningRoutePage,
  'planning.console': ConsolePage as PlanningRoutePage,
  'planning.detail': DetailPage as PlanningRoutePage,
  'planning.spec': DetailPage as PlanningRoutePage,
});
