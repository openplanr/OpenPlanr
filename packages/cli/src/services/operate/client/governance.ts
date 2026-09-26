/** Explicit governed-action construction surface consumed by the public Operate client. */

export type {
  ContainedActionTargets,
  ExactRollbackApprovalTemplate,
  GovernedActionDependencies,
} from '../governed-action-service.js';
export {
  actionIdentity,
  approveOperateAction,
  artifactValue,
  configureContainedActionAuthority,
  containedActionAuthorityInput,
  deliveryActionAuthorityInput,
  exactAction,
  exactRollbackApprovalRecord,
  exactRollbackApprovalTemplate,
  exactRollbackPlanContext,
  executeOperateAction,
  GOVERNED_APPROVAL_TEMPLATE_ID,
  governedArtifactStore,
  governedDraft,
  later,
  mergeRecordsBy,
  rollbackOperateAction,
  sameActionIdentity,
  sameCanonicalValue,
  withVerificationArtifactReservations,
} from '../governed-action-service.js';
