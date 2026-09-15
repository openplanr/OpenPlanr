import { useEffect, useMemo, useState } from 'react';
import type { DashboardProductState } from '../../lib/api/product-state.js';
import { planningNodesFromProductState } from '../planning/planning-workspace.js';
import type { DashboardSearchSources } from './search-index.js';

function sourcesFromPlanningProjection(
  projection: DashboardProductState<unknown>,
): DashboardSearchSources {
  return Object.freeze({ planningNodes: planningNodesFromProductState(projection) });
}

/** Owns the transient command palette and the independently verified Planning source. */
export function useSearchCoordinator(planningProjection: DashboardProductState<unknown>) {
  const [open, setOpen] = useState(false);
  const sources = useMemo(
    () => sourcesFromPlanningProjection(planningProjection),
    [planningProjection],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return Object.freeze({
    open,
    sources,
    show: () => setOpen(true),
    close: () => setOpen(false),
  });
}
