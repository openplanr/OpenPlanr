import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import {
  assertProtocolArtifact,
  OPERATE_GOVERNED_CORE_PROHIBITIONS_V2,
  OPERATE_GOVERNED_POLICY_TIERS_V2,
} from '@openplanr/protocol/contracts';
import { PipelineError } from '@openplanr/protocol/errors';

const PROTOCOL_VERSION = '2.0.0';

export const OPERATE_POLICY_TIER_PRECEDENCE_V2 = Object.freeze(
  Object.fromEntries(
    OPERATE_GOVERNED_POLICY_TIERS_V2.map(({ id, precedence }) => [id, precedence]),
  ),
);

export const OPERATE_POLICY_OUTCOME_STRENGTH_V2 = Object.freeze({
  automatic: 0,
  'named-single-party': 1,
  threshold: 2,
  'named-multi-party': 3,
  deferred: 4,
  rejected: 5,
  prohibited: 6,
});

export const OPERATE_CORE_PROHIBITION_IDENTIFIERS_V2 = OPERATE_GOVERNED_CORE_PROHIBITIONS_V2;

/** One fail-closed predicate owns every executable rollback-plan eligibility check. */
export function isOperatingRollbackEligibilityV2(value) {
  return value === 'eligible' || value === 'required';
}

function fail(code, message, context = {}) {
  throw new PipelineError(code, message, '', {
    retryable: false,
    context: structuredClone(context),
  });
}

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function without(record, ...fields) {
  const result = clone(record);
  for (const field of fields) delete result[field];
  return result;
}

function policyRef(policy) {
  return {
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    policyHash: policy.policyHash,
  };
}

function actionIdentity(action) {
  return {
    actionId: action.actionId,
    revision: action.revision,
    actionHash: action.actionHash,
  };
}

function sameIdentity(left, right) {
  return left?.id === right?.id && left?.version === right?.version;
}

function assertTimestamp(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    fail('RESULT_CONTRACT_INVALID', `${field} must be an explicit RFC 3339 timestamp.`, { field });
  }
}

function assertAction(action) {
  try {
    assertProtocolArtifact('operating-action', action, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Policy evaluation requires one contract-valid governed Action.',
      {
        cause: cause?.code ?? null,
      },
    );
  }
  const fields = [
    'revisionId',
    'revision',
    'predecessorRevisionId',
    'actionHash',
    'actionKind',
    'requestedCapability',
    'targetBinding',
    'effectClass',
    'preconditionArtifactIds',
    'executionBinding',
  ];
  if (fields.some((field) => !Object.hasOwn(action, field))) {
    fail(
      'ACTION_REVISION_MISMATCH',
      'Policy evaluation requires the complete Action authority tuple.',
      {
        actionId: action?.actionId ?? null,
      },
    );
  }
}

function policyMatchesAction(policy, action) {
  return (
    policy.domainId === action.domainId &&
    sameIdentity(policy.actionKind, action.actionKind) &&
    sameIdentity(policy.capability, action.requestedCapability) &&
    policy.effectClasses.includes(action.effectClass) &&
    policy.targetKinds.includes(action.targetBinding.kind)
  );
}

function policyFingerprint(policy) {
  return `${policy.policyId}@${policy.policyVersion}`;
}

/**
 * Approval identifiers declared by a policy are immutable requirement
 * templates. Durable requirement records use an evaluation-scoped identity so
 * a later evaluation can append fresh authority without overwriting history.
 */
export function deriveOperatingApprovalRequirementInstanceIdV2({
  policyRequirementId,
  evaluationId,
} = {}) {
  if (
    typeof policyRequirementId !== 'string' ||
    !/^aprq_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u.test(policyRequirementId) ||
    typeof evaluationId !== 'string' ||
    !/^pevl_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u.test(evaluationId)
  ) {
    fail(
      'POLICY_EVALUATION_REJECTED',
      'Approval requirement instance identity needs exact policy-template and evaluation identities.',
    );
  }
  return `aprq_${sha256Jcs({ policyRequirementId, evaluationId }).slice('sha256:'.length)}`;
}

/**
 * Derive applicability exclusively from the complete configured policy
 * registry. Callers cannot select, omit, or reorder the live authority set.
 */
export function deriveApplicableOperatingActionPoliciesV2({ action, configuredPolicies } = {}) {
  assertAction(action);
  if (!Array.isArray(configuredPolicies) || configuredPolicies.length === 0) {
    fail(
      'POLICY_EVALUATION_REJECTED',
      'Policy evaluation requires the configured versioned policy registry.',
      {
        state: 'actionPolicies',
      },
    );
  }
  const configured = configuredPolicies.map(assertOperatingActionPolicyV2);
  const configuredIdentities = configured.map(policyFingerprint);
  if (new Set(configuredIdentities).size !== configured.length) {
    fail('POLICY_EVALUATION_REJECTED', 'Configured policy identities must be unique.', {
      state: 'actionPolicies',
    });
  }
  const applicable = configured.filter((policy) => policyMatchesAction(policy, action));
  const byTier = new Map();
  for (const policy of applicable) {
    if (byTier.has(policy.tier)) {
      fail(
        'POLICY_EVALUATION_REJECTED',
        'Configured applicability is ambiguous: at most one policy may match each precedence tier.',
        {
          tier: policy.tier,
        },
      );
    }
    byTier.set(policy.tier, policy);
  }
  if (!byTier.has('core')) {
    fail(
      'POLICY_EVALUATION_REJECTED',
      'Every governed Action requires one applicable configured core policy.',
      {
        actionId: action.actionId,
        state: 'core-policy-missing',
      },
    );
  }
  return freeze(
    ['core', 'project', 'domain'].flatMap((tier) =>
      byTier.has(tier) ? [clone(byTier.get(tier))] : [],
    ),
  );
}

function prohibitedIdentifier(action) {
  if (action.effectClass === 'destructive') return 'destructive';
  const values = [action.actionKind.id, action.requestedCapability.id, action.targetBinding.kind];
  return (
    OPERATE_CORE_PROHIBITION_IDENTIFIERS_V2.find((identifier) =>
      values.some(
        (value) =>
          value === identifier ||
          value.startsWith(`${identifier}-`) ||
          value.endsWith(`-${identifier}`) ||
          value.includes(`-${identifier}-`),
      ),
    ) ?? null
  );
}

/** Construct one immutable policy record and bind its hash to all policy bytes. */
export function createOperatingActionPolicyV2(input) {
  const policy = {
    kind: 'operating-action-policy',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    domainId: input.domainId,
    actionKind: clone(input.actionKind),
    capability: clone(input.capability),
    effectClasses: [...new Set(input.effectClasses ?? [])].sort(),
    targetKinds: [...new Set(input.targetKinds ?? [])].sort(),
    decisionMode: input.decisionMode,
    approvalRequirementIds: [...new Set(input.approvalRequirementIds ?? [])].sort(),
    rollbackRequired: input.rollbackRequired,
    verificationRequired: input.verificationRequired,
    tier: input.tier,
    precedence: OPERATE_POLICY_TIER_PRECEDENCE_V2[input.tier],
    narrowingOnly: input.tier !== 'core',
    provenance: clone(input.provenance),
  };
  policy.policyHash = sha256Jcs(policy);
  return assertOperatingActionPolicyV2(policy);
}

/** Validate schema, tier invariants, and the exact immutable policy hash. */
export function assertOperatingActionPolicyV2(policy) {
  try {
    assertProtocolArtifact('operating-action-policy', policy, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch (cause) {
    fail('POLICY_EVALUATION_REJECTED', 'Action policy is not contract-valid.', {
      policyId: policy?.policyId ?? null,
      cause: cause?.code ?? null,
    });
  }
  if (
    policy.precedence !== OPERATE_POLICY_TIER_PRECEDENCE_V2[policy.tier] ||
    policy.narrowingOnly !== (policy.tier !== 'core') ||
    policy.policyHash !== sha256Jcs(without(policy, 'policyHash'))
  ) {
    fail(
      'POLICY_EVALUATION_REJECTED',
      'Action policy tier, precedence, narrowing rule, or hash is invalid.',
      {
        policyId: policy.policyId,
      },
    );
  }
  const requiresApproval = ['named-single-party', 'named-multi-party', 'threshold'].includes(
    policy.decisionMode,
  );
  if (requiresApproval !== policy.approvalRequirementIds.length > 0) {
    fail(
      'POLICY_EVALUATION_REJECTED',
      'Only approval-bearing policy outcomes may name approval requirements.',
      {
        policyId: policy.policyId,
      },
    );
  }
  return freeze(clone(policy));
}

/**
 * Evaluate immutable policy data in the only legal order: core, project, then
 * domain/registered. Every lower tier must be equal or more restrictive in
 * outcome, target/effect ceiling, rollback, and verification.
 */
export function evaluateOperatingActionPolicyV2({
  action,
  configuredPolicies,
  evaluatedAt,
  evaluationId,
  evaluatedBy,
} = {}) {
  assertAction(action);
  assertTimestamp(evaluatedAt, 'evaluatedAt');
  const checked = deriveApplicableOperatingActionPoliciesV2({ action, configuredPolicies });
  const byTier = new Map();
  for (const policy of checked) {
    byTier.set(policy.tier, policy);
  }
  const ordered = checked;

  let prior = null;
  for (const policy of ordered) {
    if (prior !== null) {
      const widenedOutcome =
        OPERATE_POLICY_OUTCOME_STRENGTH_V2[policy.decisionMode] <
        OPERATE_POLICY_OUTCOME_STRENGTH_V2[prior.decisionMode];
      const widenedEffects = policy.effectClasses.some(
        (effect) => !prior.effectClasses.includes(effect),
      );
      const widenedTargets = policy.targetKinds.some(
        (target) => !prior.targetKinds.includes(target),
      );
      const weakenedRollback = prior.rollbackRequired && !policy.rollbackRequired;
      const weakenedVerification = prior.verificationRequired && !policy.verificationRequired;
      if (
        widenedOutcome ||
        widenedEffects ||
        widenedTargets ||
        weakenedRollback ||
        weakenedVerification
      ) {
        fail(
          'POLICY_EVALUATION_REJECTED',
          'A lower-precedence policy attempted to widen or relabel higher policy authority.',
          {
            policyId: policy.policyId,
            higherPolicyId: prior.policyId,
          },
        );
      }
    }
    prior = policy;
  }

  const prohibited = prohibitedIdentifier(action);
  if (
    prohibited !== null &&
    (!byTier.has('core') || byTier.get('core').decisionMode !== 'prohibited')
  ) {
    fail(
      'POLICY_PROHIBITED',
      'A reference hard-prohibition requires an explicit non-overridable core prohibition.',
      {
        actionId: action.actionId,
        state: prohibited,
      },
    );
  }
  if (prohibited !== null && ordered.some(({ decisionMode }) => decisionMode !== 'prohibited')) {
    fail(
      'POLICY_EVALUATION_REJECTED',
      'No lower policy may weaken or relabel a core prohibition.',
      {
        actionId: action.actionId,
      },
    );
  }

  const effective = ordered.at(-1);
  if (
    effective.policyId !== action.executionBinding.policyId ||
    effective.policyVersion !== action.executionBinding.policyVersion ||
    effective.rollbackRequired !== action.executionBinding.rollbackRequired ||
    effective.verificationRequired !== action.executionBinding.verificationRequired
  ) {
    fail(
      'POLICY_EVALUATION_REJECTED',
      'The effective policy must equal the Action execution binding exactly.',
      {
        actionId: action.actionId,
        policyId: effective.policyId,
      },
    );
  }
  const provider = evaluatedBy ?? {
    providerId: effective.provenance.providerId,
    providerVersion: effective.provenance.providerVersion,
  };
  if (
    provider.providerId !== effective.provenance.providerId ||
    provider.providerVersion !== effective.provenance.providerVersion
  ) {
    fail(
      'POLICY_EVALUATION_REJECTED',
      'The evaluator identity must equal effective policy provenance.',
      {
        policyId: effective.policyId,
      },
    );
  }
  const refs = ordered.map(policyRef);
  const input = {
    action: actionIdentity(action),
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    capability: clone(action.requestedCapability),
    target: clone(action.targetBinding),
    effectClass: action.effectClass,
    appliedPolicyRefs: refs,
  };
  const inputHash = sha256Jcs(input);
  const id =
    evaluationId ?? `pevl_${sha256Jcs({ inputHash, evaluatedAt }).slice('sha256:'.length)}`;
  const approvalRequirementIds = effective.approvalRequirementIds
    .map((policyRequirementId) =>
      deriveOperatingApprovalRequirementInstanceIdV2({ policyRequirementId, evaluationId: id }),
    )
    .sort();
  const evaluation = {
    kind: 'operating-policy-evaluation',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    evaluationId: id,
    policy: policyRef(effective),
    policyTier: effective.tier,
    precedence: effective.precedence,
    appliedPolicyRefs: refs,
    action: actionIdentity(action),
    capability: clone(action.requestedCapability),
    target: clone(action.targetBinding),
    effectClass: action.effectClass,
    outcome: effective.decisionMode,
    approvalRequirementIds,
    reasonCodes: [
      ...new Set([
        prohibited === null ? `policy-${effective.decisionMode}` : `core-prohibition-${prohibited}`,
        ...ordered.map(({ tier }) => `${tier}-policy-applied`),
      ]),
    ].sort(),
    evaluatedBy: clone(provider),
    evaluatedAt,
    inputHash,
  };
  evaluation.evaluationHash = sha256Jcs(evaluation);
  try {
    assertProtocolArtifact('operating-policy-evaluation', evaluation, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch (cause) {
    fail('POLICY_EVALUATION_REJECTED', 'Deterministic policy evaluation is not contract-valid.', {
      cause: cause?.code ?? null,
    });
  }
  return freeze(evaluation);
}

/** Recompute and verify an evaluation without invoking a provider or a clock. */
export function assertOperatingPolicyEvaluationV2(evaluation, options) {
  const expected = evaluateOperatingActionPolicyV2({
    ...options,
    evaluatedAt: evaluation?.evaluatedAt,
    evaluationId: evaluation?.evaluationId,
    evaluatedBy: evaluation?.evaluatedBy,
  });
  if (sha256Jcs(evaluation) !== sha256Jcs(expected)) {
    fail(
      'POLICY_EVALUATION_REJECTED',
      'Policy evaluation does not equal deterministic precedence output.',
      {
        evaluationId: evaluation?.evaluationId ?? null,
      },
    );
  }
  return expected;
}

/** Fail closed unless current policy explicitly permits exact reversible compensation. */
export function assertOperatingRollbackPolicyV2({ action, evaluation, rollbackPlan, at } = {}) {
  assertTimestamp(at, 'at');
  try {
    assertProtocolArtifact('operating-policy-evaluation', evaluation, {
      protocolVersion: PROTOCOL_VERSION,
    });
    assertProtocolArtifact('operating-rollback-plan', rollbackPlan, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch (error) {
    fail(
      error.code ?? 'ROLLBACK_NOT_ELIGIBLE',
      'Rollback policy requires valid exact policy and plan contracts.',
    );
  }
  if (
    !action?.executionBinding?.rollbackRequired ||
    !['automatic', 'named-single-party', 'named-multi-party', 'threshold'].includes(
      evaluation.outcome,
    ) ||
    sha256Jcs(evaluation.action) !== sha256Jcs(actionIdentity(action)) ||
    sha256Jcs(rollbackPlan.action) !== sha256Jcs(actionIdentity(action)) ||
    !isOperatingRollbackEligibilityV2(rollbackPlan.eligibility) ||
    Date.parse(rollbackPlan.expiresAt) <= Date.parse(at) ||
    rollbackPlan.verificationPlanId !== action.verificationPlanId ||
    rollbackPlan.baselineArtifactId === action.sourceArtifactId ||
    !action.preconditionArtifactIds.includes(rollbackPlan.baselineArtifactId)
  ) {
    fail(
      'ROLLBACK_NOT_ELIGIBLE',
      'Current policy does not authorize this exact unexpired reversible rollback plan.',
      {
        actionId: action?.actionId ?? null,
        rollbackPlanId: rollbackPlan?.rollbackPlanId ?? null,
      },
    );
  }
  return freeze({
    action: actionIdentity(action),
    evaluationId: evaluation.evaluationId,
    rollbackPlanId: rollbackPlan.rollbackPlanId,
  });
}
