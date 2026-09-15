import { actionRoutes } from './actions.js';
import { auditRoutes } from './audit.js';
import { cycleRoutes } from './cycles.js';
import { inboxRecoveryRoutes } from './inbox-recovery.js';
import { reviewRoutes } from './review.js';
import { todayRoute } from './today.js';

/** Explicit route-composition surface; feature internals stay behind their owners. */
export const operateRouteRegistry = Object.freeze({
  actions: actionRoutes,
  audit: auditRoutes,
  cycles: cycleRoutes,
  inboxRecovery: inboxRecoveryRoutes,
  review: reviewRoutes,
  today: todayRoute,
});

export type { OperateReviewNavigation } from './review.js';
