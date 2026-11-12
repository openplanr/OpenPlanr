import { useEffect } from 'react';
import {
  usePlanningPresentation,
  usePlanningView,
} from '../../lib/routing/planning-presentation.js';
import {
  type ActivityFilters,
  type ActivityModel,
  activityShortDate,
} from './planning-activity-view.js';

export { activityModel, nextActivityRange } from './planning-activity-view.js';

const DEFAULT_DAYS = 14;

type ActivityState = ActivityFilters & Readonly<{ applied: string | null }>;

/** Route-local filters; Type and the range start from the URL view when one is open. */
export function useActivityFilters(): [ActivityFilters, (next: Partial<ActivityFilters>) => void] {
  const token = usePlanningView();
  const view = token?.route === 'activity' ? token : null;
  const [state, set] = usePlanningPresentation<ActivityState>('activity', () => ({
    kind: 'all',
    spec: null,
    types: view?.filters.type ?? [],
    days: view?.filters.updatedWithinDays ?? DEFAULT_DAYS,
    applied: view ? JSON.stringify(view) : null,
  }));
  useEffect(() => {
    if (!view) return;
    const applied = JSON.stringify(view);
    set((current) =>
      current.applied === applied
        ? current
        : {
            ...current,
            applied,
            types: view.filters.type,
            days: view.filters.updatedWithinDays ?? DEFAULT_DAYS,
          },
    );
  }, [view, set]);
  return [state, (next) => set((current) => ({ ...current, ...next }))];
}

const KIND_WORDS = {
  created: 'created items',
  status: 'status changes',
  edited: 'edited items',
  removed: 'removed items',
} as const;

export type ActivityEmpty = Readonly<{
  heading: string;
  line?: string;
  action: string;
  next: Partial<ActivityFilters>;
}>;

/** The quiet or no-match state, or null when the feed has rows. */
export function activityEmptyState(
  model: ActivityModel,
  filters: ActivityFilters,
): ActivityEmpty | null {
  if (model.days.length > 0) return null;
  const range = `in the last ${filters.days} days`;
  const filtered = filters.kind !== 'all' || filters.spec !== null || filters.types.length > 0;
  if (filtered)
    return {
      heading:
        filters.kind !== 'all' && filters.spec === null && filters.types.length === 0
          ? `No ${KIND_WORDS[filters.kind]} ${range}`
          : `No matching changes ${range}`,
      action: 'Show all changes',
      next: { kind: 'all', spec: null, types: [] },
    };
  return {
    heading: `Nothing changed ${range}`,
    line: model.last
      ? `The last change was ${model.last.id} on ${activityShortDate(model.last.day)}.`
      : undefined,
    action: 'Show the last 90 days',
    next: { days: 90 },
  };
}
