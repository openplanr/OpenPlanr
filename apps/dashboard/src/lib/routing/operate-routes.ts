import {
  canonicalDashboardHref,
  DASHBOARD_ROUTE_DEFINITIONS,
  type DashboardRouteDefinition,
  type ParsedDashboardRoute,
  parseDashboardRoute,
  serializeDashboardRoute,
} from '../../app/router.js';

export type ClosedDashboardDestination = Readonly<{
  kind: DashboardRouteDefinition['kind'];
  product: DashboardRouteDefinition['product'];
  title: string;
  href: string;
}>;

/** Closed public grammar only. Unknown or encoded paths never coerce to a product home. */
export function parseClosedDashboardRoute(hash: string): ParsedDashboardRoute {
  return parseDashboardRoute(hash);
}

/** Returns the hash only when it already is the exact canonical serialization. */
export function canonicalClosedDashboardHref(value: string): string | null {
  return canonicalDashboardHref(value);
}

/** Primary and contextual destinations whose hrefs already parse and serialize exactly. */
export function closedDashboardDestinations(): readonly ClosedDashboardDestination[] {
  return Object.freeze(
    DASHBOARD_ROUTE_DEFINITIONS.filter((definition) => definition.navigation !== 'hidden')
      .map((definition) => {
        const href = canonicalDashboardHref(definition.href);
        if (href === null) return null;
        return Object.freeze({
          kind: definition.kind,
          product: definition.product,
          title: definition.label,
          href,
        });
      })
      .filter((entry): entry is ClosedDashboardDestination => entry !== null),
  );
}

export function serializeClosedDashboardRoute(
  route: Exclude<ParsedDashboardRoute, { kind: 'not-found' }>,
): string {
  return serializeDashboardRoute(route);
}
