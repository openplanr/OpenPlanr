/** Explicit governed-action construction surface consumed by the public Operate client. */

export type { ExactRollbackApprovalTemplate } from '../governed-action-service.js';
export {
  actionIdentity,
  artifactValue,
  configureContainedActionAuthority,
  containedActionAuthorityInput,
  deliveryActionAuthorityInput,
  exactAction,
  exactRollbackApprovalRecord,
  exactRollbackApprovalTemplate,
  exactRollbackPlanContext,
  GOVERNED_APPROVAL_TEMPLATE_ID,
  governedArtifactStore,
  governedDraft,
  later,
  mergeRecordsBy,
  sameActionIdentity,
  sameCanonicalValue,
  withVerificationArtifactReservations,
} from '../governed-action-service.js';
