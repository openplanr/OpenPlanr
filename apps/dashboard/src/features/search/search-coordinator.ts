import { useMemo, useState } from 'react';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import {
  planningNodesFromProductState,
  resolvePlanningWorkspace,
} from '../planning/planning-workspace.js';
import type { DashboardSearchSources } from './search-index.js';

function sourcesFromPlanningProjection(
  projection: DashboardProductState<unknown>,
): DashboardSearchSources {
  const model = projection.binding
    ? resolvePlanningWorkspace(projection, projection.binding)
    : null;
  return Object.freeze({
    planningNodes: planningNodesFromProductState(projection),
    planningGraph: model?.graph,
    planningPresentation: model?.presentation,
  });
}

/** Owns the transient command palette and the independently verified Planning source. */
export function useSearchCoordinator(planningProjection: DashboardProductState<unknown>) {
  const [open, setOpen] = useState(false);
  const sources = useMemo(
    () => sourcesFromPlanningProjection(planningProjection),
    [planningProjection],
  );

  return Object.freeze({
    open,
    sources,
    show: () => setOpen(true),
    toggle: () => setOpen((current) => !current),
    close: () => setOpen(false),
  });
}
