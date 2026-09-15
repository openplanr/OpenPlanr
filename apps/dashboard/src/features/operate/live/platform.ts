import {
  dashboardProductStatePolicy,
  freezeDashboardWire,
  parseDashboardProductState,
} from '../../../lib/api/product-state.js';
import { useBoundProjection } from '../../../lib/query/use-bound-projection.js';
import { operateLiveOrigin, operateLiveReadsEnabled } from '../operate-live.js';

export const liveProjectionCapabilities = Object.freeze({
  freezeWire: freezeDashboardWire,
  origin: operateLiveOrigin,
  parseState: parseDashboardProductState,
  readsEnabled: operateLiveReadsEnabled,
  statePolicy: dashboardProductStatePolicy,
  useBoundProjection,
});

export type {
  DashboardProductState,
  DashboardProductStateKind,
} from '../../../lib/api/product-state.js';
export type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
