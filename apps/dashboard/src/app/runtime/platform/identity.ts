import { createDashboardQueryIdentity } from '../../../lib/binding/query-identity.js';

export const dashboardIdentity = Object.freeze({
  create: createDashboardQueryIdentity,
});

export type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
