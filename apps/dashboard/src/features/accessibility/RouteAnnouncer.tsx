import { useMemo } from 'react';
import { useDashboard } from '../../app/providers.js';
import { dashboardRouteDefinition } from '../../app/router.js';

function routeAnnouncementKey(route: ReturnType<typeof useDashboard>['route']): string {
  if (route.kind === 'not-found') return 'not-found';
  if (route.kind === 'operate.review') {
    return `${route.kind}:${route.cycleId}:${route.subjectId}`;
  }
  const subjectId = route.subjectId;
  return `${route.kind}:${subjectId ?? ''}`;
}

/** Announces canonical route changes without remounting the shell or stealing focus. */
export function RouteAnnouncer() {
  const { route } = useDashboard();
  const announcement = useMemo(() => {
    if (route.kind === 'not-found') return '';
    const definition = dashboardRouteDefinition(route);
    if (!definition) return '';
    const subject =
      route.kind === 'operate.review'
        ? ` · ${route.cycleId} · ${route.subjectId}`
        : route.subjectId
          ? ` · ${route.subjectId}`
          : '';
    return `${definition.label}${subject}. ${definition.description}`;
  }, [route]);
  if (!announcement) return null;
  return (
    <div
      key={routeAnnouncementKey(route)}
      className="op-route-announcer"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {announcement}
    </div>
  );
}
