import { dashboardIdentity } from './identity.js';
import { projectionRuntime } from './projection.js';
import { dashboardRouting } from './routing.js';
import { dashboardTransport } from './transport.js';

/** Browser platform capabilities consumed by the dashboard composition root. */
export const dashboardRuntime = Object.freeze({
  identity: dashboardIdentity,
  projection: projectionRuntime,
  routing: dashboardRouting,
  transport: dashboardTransport,
});

export type { DashboardQueryIdentity } from './identity.js';
export type {
  DashboardProductState,
  DashboardProductStateKind,
  DashboardSafeError,
} from './projection.js';
export type { ParsedDashboardRoute } from './routing.js';
export type { DashboardBootstrap, DashboardQueryRoot } from './transport.js';
