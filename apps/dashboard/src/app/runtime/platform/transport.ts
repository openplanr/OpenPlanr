import { connectDashboardSse, createDashboardSseReconciler } from '../../../lib/api/sse.js';

export const dashboardTransport = Object.freeze({
  connectSse: connectDashboardSse,
  createSseReconciler: createDashboardSseReconciler,
});

export type { DashboardBootstrap, DashboardQueryRoot } from '../../../lib/api/bootstrap.js';
