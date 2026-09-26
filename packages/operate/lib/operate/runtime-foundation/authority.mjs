/** Explicit authority and approval dependencies for the Operate runtime foundation. */

export {
  appendOperatingApprovalRecordV2,
  assertOperatingApprovalRecordV2,
  assertOperatingApprovalRequirementIntegrityV2,
  assertOperatingApprovalRequirementSetIntegrityV2,
  assertOperatingApprovalRequirementV2,
  consumeOperatingApprovalRecordsV2,
  createOperatingActionReviewV2,
  createOperatingApprovalRequirementV2,
  evaluateOperatingApprovalSetV2,
} from '../approvals-v2.mjs';
export {
  assertOperateAuthorityV2,
  assertOperatingActionAuthorityTupleV2,
  deriveOperateAuthorityAllowedActionsV2,
  evaluateOperateAuthorityV2,
  getOperateAuthorityArgumentCandidatesV2,
} from '../authorization-v2.mjs';
export {
  assertPersistentOperatingActionAuthorityV2,
  assertPersistentWorkMaterializationPayloadV2,
  buildPersistentWorkMaterializationPayloadV2,
  promotePersistentOperatingActionAuthorityV2,
} from '../persistent-work-v2.mjs';
export {
  assertOperatingActionPolicyV2,
  assertOperatingPolicyEvaluationV2,
  assertOperatingRollbackPolicyV2,
  deriveOperatingApprovalRequirementInstanceIdV2,
  isOperatingRollbackEligibilityV2,
} from '../policy-v2.mjs';
