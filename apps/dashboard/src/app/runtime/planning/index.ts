import {
  connectPlanningSse,
  createPlanningSseReconciler,
  encodePlanningCheckpoint,
  fetchPlanningGraph,
  parsePlanningGraphEnvelope,
} from '../../../features/planning/planning-api.js';
import {
  appendPlanningSessionPatch,
  EMPTY_SESSION_ACTIVITY,
  planningActivityScope,
} from '../../../features/planning/planning-session-activity.js';

export const planningRuntime = Object.freeze({
  appendSessionPatch: appendPlanningSessionPatch,
  emptySessionActivity: EMPTY_SESSION_ACTIVITY,
  activityScope: planningActivityScope,
  connectSse: connectPlanningSse,
  createSseReconciler: createPlanningSseReconciler,
  encodeCheckpoint: encodePlanningCheckpoint,
  fetchGraph: fetchPlanningGraph,
  parseGraphEnvelope: parsePlanningGraphEnvelope,
});

export type { PlanningGraphEnvelope } from '../../../features/planning/planning-api.js';

export type { PlanningSessionActivity } from '../../../features/planning/planning-session-activity.js';
