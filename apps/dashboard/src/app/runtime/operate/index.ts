import { operateActionRuntime } from './actions.js';
import { operateAuditRuntime } from './audit.js';
import { operateCycleRuntime } from './cycles.js';
import { operateReviewRuntime } from './review.js';
import { operateTodayRuntime } from './today.js';
import { operateTransport } from './transport.js';

/** Explicit Operate capability registry; feature leaves remain owner-private. */
export const operateRuntime = Object.freeze({
  actions: operateActionRuntime,
  audit: operateAuditRuntime,
  cycles: operateCycleRuntime,
  review: operateReviewRuntime,
  today: operateTodayRuntime,
  transport: operateTransport,
});

export type {
  OperateActionDisplayWorkspaceV1,
  OperateCycleDisplayWorkspaceV1,
  OperateExperienceAuditDisplaySurfaceV1,
  OperateExperienceDisplaySurfaceV1,
  OperateRecoveryDisplaySurfaceV1,
  OperateReviewDisplayWorkspaceV1,
} from './contracts.js';
export type { OperateReviewNavigation } from './review.js';
