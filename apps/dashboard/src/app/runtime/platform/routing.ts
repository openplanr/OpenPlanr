import { parseDashboardRoute } from '../../router.js';

export const dashboardRouting = Object.freeze({
  parse: parseDashboardRoute,
});

export type { ParsedDashboardRoute } from '../../router.js';
