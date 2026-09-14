import {
  OPERATE_ROLE_MANDATES_V2,
  OPERATE_EXTENSION_CONTRACT_KINDS_V2,
  OPERATE_EVIDENCE_CONTRACT_KINDS_V2,
  OPERATE_EVIDENCE_KINDS_V2,
  OPERATE_EVIDENCE_EDGE_RELATIONS_V2,
  OPERATE_EVIDENCE_RESOLVER_ERROR_CODES_V2,
  OPERATE_OPERATING_INTELLIGENCE_CONTRACT_KINDS_V2,
  OPERATE_OPERATING_PROJECTION_IDENTITIES_V2,
  OPERATE_OPERATING_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2,
  OPERATE_GOVERNED_EXECUTION_CONTRACT_KINDS_V2,
  OPERATE_GOVERNED_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2,
  OPERATE_GOVERNED_EFFECT_CLASSES_V2,
  OPERATE_GOVERNED_POLICY_OUTCOMES_V2,
  OPERATE_GOVERNED_POLICY_TIERS_V2,
  OPERATE_GOVERNED_CORE_PROHIBITIONS_V2,
  OPERATE_GOVERNED_RECOVERY_CLASSIFICATIONS_V2,
  OPERATE_EXPERIENCE_CONTRACT_KINDS_V2,
  OPERATING_DELIVERY_ROUTES_V1,
  findOperateCoreProhibitionV2,
  OPERATE_GOVERNED_OPERATION_STATES_V2,
  OPERATE_GOVERNED_OPERATION_TERMINAL_STATES_V2,
  OPERATE_EXECUTION_VERIFICATION_STATUSES_V2,
  OPERATE_HYPOTHESIS_VERIFICATION_STATUSES_V2,
  OPERATE_GOVERNED_TOOL_OPERATIONS_V2,
  OPERATE_AUTHORITY_GUARD_IDS_V2,
  OPERATE_PUBLIC_DOMAIN_CONTRACT_BINDINGS_V2,
  assertOperateIntelligencePlanContractV2,
  assertOperateGovernedExtensionRegistrationV2,
  assertOperateExperienceArtifactV2,
  assertOperateRoleOutputContractV2,
  PROTOCOL_SCHEMA_REGISTRY,
  assertDashboardBootstrapV1,
  assertProtocolArtifact,
  listProtocolSchemas,
  loadOperateRoleMandateV2,
  resolveProtocolSchema,
  resolveOperateExperienceSchemaV2,
  validateOperateExperienceArtifactV2,
  validateDashboardBootstrapV1,
  validateProtocolArtifact,
} from './contracts.mjs';
import { canonicalizeJson, sha256Jcs } from './jcs.mjs';
import { OPERATE_CONTRACT_CATALOG_V2 } from './generated/contract-catalog-v2.mjs';
import {
  assertOperatingDeliveryEvidenceV1,
  assertOperatingOriginV1,
  assertOperatingPlanningProposalV1,
} from './operating-planning-contracts.mjs';
import {
  normalizePlanningTask,
  validatePlanningAcceptanceCoverage,
} from './planning-contracts.mjs';
import { PipelineError } from './errors.mjs';

export const OPERATE_RUNTIME_PROTOCOL_VERSION = '2.0.0';
export const OPERATE_LIVE_EVIDENCE_CONTRACT_KINDS_V2 = Object.freeze([
  'operate-live-evidence-provider-registration',
  'operate-live-evidence-provider-registry',
  'operating-live-evidence-consent-record',
  'operating-connector-checkpoint',
  'operating-live-evidence-ingestion',
  'operating-measurement-plan',
  'operating-measurement-schedule',
  'operating-measurement-schedule-receipt',
  'operating-evidence-observation',
  'operating-outcome-evaluation',
  'operating-learning-receipt',
]);
export const LANDING_CONTRACT_KINDS_V1 = Object.freeze([
  'landing-plan',
  'landing-confirmation',
  'landing-event',
  'landing-phase-receipt',
  'landing-receipt',
  'landing-operation-registry',
]);
export const RELEASE_LEDGER_CONTRACT_KINDS_V1 = Object.freeze([
  'release-ledger',
  'release-compatibility-claim',
  'release-ledger-receipt',
  'ecosystem-manifest',
]);
export const EVALUATION_CONTRACT_KINDS_V1 = Object.freeze([
  'evaluation-scenario',
  'evaluation-corpus',
  'evaluation-fixture',
  'evaluation-host-profile',
  'evaluation-host-profile-registry',
  'evaluation-grader-registration',
  'evaluation-grader-registry',
  'evaluation-budget',
  'evaluation-gate-policy',
  'evaluation-observation',
  'evaluation-run-result',
  'evaluation-aggregate-report',
  'evaluation-waiver',
  'skill-certification-receipt',
]);

const OPERATE_PUBLIC_PROJECTION_IDENTITIES = new Set([
  'business-operating-snapshot-projection@1.0.0',
  'software-operating-snapshot-projection@1.0.0',
]);

function compiledOperateRuntimeContractKinds() {
  const catalog = OPERATE_CONTRACT_CATALOG_V2;
  if (
    catalog?.kind !== 'operate-contract-catalog'
    || catalog.protocol?.id !== 'operate'
    || catalog.protocol?.version !== OPERATE_RUNTIME_PROTOCOL_VERSION
    || catalog.protocol?.versionPolicy !== 'exact'
    || !Array.isArray(catalog.runtimeContracts)
  ) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_UNSUPPORTED',
      'The packaged Operate runtime catalog does not describe explicit Protocol 2.0.0 contracts.',
    );
  }
  const kinds = catalog.runtimeContracts.map(({ id, version }) => {
    if (
      typeof id !== 'string'
      || (version !== OPERATE_RUNTIME_PROTOCOL_VERSION
        && !OPERATE_PUBLIC_PROJECTION_IDENTITIES.has(`${id}@${version}`))
    ) {
      throw new PipelineError(
        'E_SCHEMA_VERSION_UNSUPPORTED',
        'The packaged Operate runtime catalog contains a contract outside the explicit v2 or public projection identities.',
      );
    }
    return id;
  });
  if (kinds.length === 0 || new Set(kinds).size !== kinds.length) {
    throw new PipelineError('E_SCHEMA_UNKNOWN', 'The packaged Operate runtime catalog has an invalid contract set.');
  }
  return kinds;
}

export const OPERATE_RUNTIME_CONTRACT_KINDS = Object.freeze(compiledOperateRuntimeContractKinds());

function requireExplicitProtocolVersion(protocolVersion, supportedVersions, subject) {
  if (typeof protocolVersion !== 'string' || protocolVersion.length === 0) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_REQUIRED',
      `${subject} requires an explicit protocolVersion.`,
    );
  }
  if (!supportedVersions.includes(protocolVersion)) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_UNSUPPORTED',
      `${subject} does not support protocol version ${protocolVersion}.`,
      `Supported versions: ${supportedVersions.join(', ')}.`,
    );
  }
}

/**
 * Stable package loader for consumers that cannot or should not resolve
 * package-internal schema paths. The returned schema is a defensive clone.
 */
export function loadProtocolContract(kind, {
  protocolVersion,
} = {}) {
  if (typeof protocolVersion !== 'string' || protocolVersion.length === 0) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_REQUIRED',
      `Protocol contract "${kind}" requires an explicit protocolVersion.`,
    );
  }
  return resolveProtocolSchema(kind, { protocolVersion });
}

/** Load a Phase 1 Operate 2.0 contract without any legacy-version fallback. */
export function loadOperateRuntimeContract(kind, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(
    protocolVersion,
    [OPERATE_RUNTIME_PROTOCOL_VERSION],
    `Operate runtime contract "${kind}"`,
  );
  if (!OPERATE_RUNTIME_CONTRACT_KINDS.includes(kind)) {
    throw new PipelineError(
      'E_SCHEMA_UNKNOWN',
      `Unknown Operate runtime contract kind: ${kind}`,
    );
  }
  return resolveProtocolSchema(kind, { protocolVersion });
}

/** Load one closed live-evidence companion contract without version fallback. */
export function loadOperateLiveEvidenceContract(kind, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(
    protocolVersion,
    [OPERATE_RUNTIME_PROTOCOL_VERSION],
    `Operate live-evidence contract "${kind}"`,
  );
  if (!OPERATE_LIVE_EVIDENCE_CONTRACT_KINDS_V2.includes(kind)) {
    throw new PipelineError('E_SCHEMA_UNKNOWN', `Unknown Operate live-evidence contract kind: ${kind}`);
  }
  return resolveProtocolSchema(kind, { protocolVersion });
}

/** Load one Protocol 1.2 landing custody contract without implicit compatibility. */
export function loadLandingContract(kind, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(protocolVersion, ['1.2.0'], `Landing contract "${kind}"`);
  if (!LANDING_CONTRACT_KINDS_V1.includes(kind)) {
    throw new PipelineError('E_SCHEMA_UNKNOWN', `Unknown landing contract kind: ${kind}`);
  }
  return resolveProtocolSchema(kind, { protocolVersion });
}

/**
 * Load one closed release-ledger contract at its explicit version.
 * `ecosystem-manifest` resolves here to the revision the marketplace generator
 * actually emits; the frozen v1.1.0 schema stays readable for its own consumers.
 */
export function loadReleaseLedgerContract(kind, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(protocolVersion, ['1.3.0'], `Release ledger contract "${kind}"`);
  if (!RELEASE_LEDGER_CONTRACT_KINDS_V1.includes(kind)) {
    throw new PipelineError('E_SCHEMA_UNKNOWN', `Unknown release ledger contract kind: ${kind}`);
  }
  return resolveProtocolSchema(kind, { protocolVersion });
}

/** Load one closed skill-evaluation contract without implicit compatibility. */
export function loadEvaluationContract(kind, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(protocolVersion, ['1.4.0'], `Evaluation contract "${kind}"`);
  if (!EVALUATION_CONTRACT_KINDS_V1.includes(kind)) {
    throw new PipelineError('E_SCHEMA_UNKNOWN', `Unknown evaluation contract kind: ${kind}`);
  }
  return resolveProtocolSchema(kind, { protocolVersion });
}

/** Load a compiler-owned public extension declaration without version fallback. */
export function loadOperateExtensionContract(kind, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(
    protocolVersion,
    [OPERATE_RUNTIME_PROTOCOL_VERSION],
    `Operate extension contract "${kind}"`,
  );
  if (!OPERATE_EXTENSION_CONTRACT_KINDS_V2.includes(kind)) {
    throw new PipelineError('E_SCHEMA_UNKNOWN', `Unknown Operate extension contract kind: ${kind}`);
  }
  return resolveProtocolSchema(kind, { protocolVersion });
}

/** Load a compiler-owned Phase 4 evidence contract without version fallback. */
export function loadOperateEvidenceContract(kind, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(
    protocolVersion,
    [OPERATE_RUNTIME_PROTOCOL_VERSION],
    `Operate evidence contract "${kind}"`,
  );
  if (!OPERATE_EVIDENCE_CONTRACT_KINDS_V2.includes(kind)) {
    throw new PipelineError('E_SCHEMA_UNKNOWN', `Unknown Operate evidence contract kind: ${kind}`);
  }
  return resolveProtocolSchema(kind, { protocolVersion });
}

/** Load one compiler-owned Phase 5 operating-intelligence contract with no version fallback. */
export function loadOperateOperatingIntelligenceContract(kind, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(
    protocolVersion,
    [OPERATE_RUNTIME_PROTOCOL_VERSION],
    `Operate operating-intelligence contract "${kind}"`,
  );
  if (!OPERATE_OPERATING_INTELLIGENCE_CONTRACT_KINDS_V2.includes(kind)) {
    throw new PipelineError('E_SCHEMA_UNKNOWN', `Unknown Operate operating-intelligence contract kind: ${kind}`);
  }
  return resolveProtocolSchema(kind, { protocolVersion });
}

/** Load one compiler-owned Phase 6 governed-execution contract without version fallback. */
export function loadOperateGovernedExecutionContract(kind, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(protocolVersion, [OPERATE_RUNTIME_PROTOCOL_VERSION], `Operate governed-execution contract "${kind}"`);
  if (!OPERATE_GOVERNED_EXECUTION_CONTRACT_KINDS_V2.includes(kind)) {
    throw new PipelineError('E_SCHEMA_UNKNOWN', `Unknown Operate governed-execution contract kind: ${kind}`);
  }
  return resolveProtocolSchema(kind, { protocolVersion });
}

/** Load exactly one Phase 6 capability/policy/executor registration contract. */
export function loadOperateGovernedExtensionContract(kind, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(protocolVersion, [OPERATE_RUNTIME_PROTOCOL_VERSION], `Operate governed extension contract "${kind}"`);
  if (!OPERATE_GOVERNED_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2.includes(kind)) {
    throw new PipelineError('E_SCHEMA_UNKNOWN', `Unknown Operate governed extension contract kind: ${kind}`);
  }
  return resolveProtocolSchema(kind, { protocolVersion });
}

/** Load one compiler-owned product-experience or Operate-to-Planning contract. */
export function loadOperateExperienceContract(kind, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(protocolVersion, [OPERATE_RUNTIME_PROTOCOL_VERSION], `Operate experience contract "${kind}"`);
  if (!OPERATE_EXPERIENCE_CONTRACT_KINDS_V2.includes(kind)) {
    throw new PipelineError('E_SCHEMA_UNKNOWN', `Unknown Operate experience contract kind: ${kind}`);
  }
  return resolveOperateExperienceSchemaV2(kind, { protocolVersion });
}

export function readOperateExperienceViewV1(value, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(protocolVersion, [OPERATE_RUNTIME_PROTOCOL_VERSION], 'Operate experience view reader');
  assertOperateExperienceArtifactV2('operate-experience-view', value);
  if (value.viewHash !== sha256Jcs(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'viewHash')))) {
    throw new PipelineError('E_OPERATE_BINDING_MISMATCH', 'Operate experience viewHash does not equal its canonical content.');
  }
  return value;
}

export function readOperatingPlanningProposalV1(value, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(protocolVersion, [OPERATE_RUNTIME_PROTOCOL_VERSION], 'Operating planning proposal reader');
  return assertOperatingPlanningProposalV1(value);
}

export function readOperatingOriginV1(value, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(protocolVersion, [OPERATE_RUNTIME_PROTOCOL_VERSION], 'Operating origin reader');
  return assertOperatingOriginV1(value);
}

export function readOperatingDeliveryEvidenceV1(value, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(protocolVersion, [OPERATE_RUNTIME_PROTOCOL_VERSION], 'Operating delivery evidence reader');
  return assertOperatingDeliveryEvidenceV1(value);
}

/** Resolve one compiler-owned role mandate without any version fallback. */
export function loadOperateRoleMandate(roleId, { roleVersion } = {}) {
  return loadOperateRoleMandateV2(roleId, { roleVersion });
}

/**
 * Validate a role's advertised Assignment output template before it reaches
 * the runtime's normal submit-time Assignment validation boundary.
 */
export function assertOperateRoleOutputContract(roleId, outputContract, { roleVersion } = {}) {
  return assertOperateRoleOutputContractV2(roleId, outputContract, { roleVersion });
}

/** Read only the explicit operating-runtime-state@2.0.0 identity. */
export function readOperatingRuntimeStateV2(value, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(
    protocolVersion,
    [OPERATE_RUNTIME_PROTOCOL_VERSION],
    'Operate runtime state reader',
  );
  return assertProtocolArtifact('operating-runtime-state', value, { protocolVersion });
}

/** Validate one durable operation journal record at the public package boundary. */
export function readOperatingGovernedOperationV2(value, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(protocolVersion, [OPERATE_RUNTIME_PROTOCOL_VERSION], 'Operate governed operation reader');
  return assertProtocolArtifact('operating-governed-operation', value, { protocolVersion });
}

/** Validate one exact accepted execution result at the public package boundary. */
export function readOperatingExecutionResultV2(value, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(protocolVersion, [OPERATE_RUNTIME_PROTOCOL_VERSION], 'Operate execution result reader');
  return assertProtocolArtifact('operating-execution-result', value, { protocolVersion });
}

/** Validate one immutable rollback plan at the public package boundary. */
export function readOperatingRollbackPlanV2(value, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(protocolVersion, [OPERATE_RUNTIME_PROTOCOL_VERSION], 'Operate rollback plan reader');
  return assertProtocolArtifact('operating-rollback-plan', value, { protocolVersion });
}

/** Validate one immutable rollback result at the public package boundary. */
export function readOperatingRollbackResultV2(value, { protocolVersion } = {}) {
  requireExplicitProtocolVersion(protocolVersion, [OPERATE_RUNTIME_PROTOCOL_VERSION], 'Operate rollback result reader');
  return assertProtocolArtifact('operating-rollback-result', value, { protocolVersion });
}

function assertOperateBindingField(field, expected, actual) {
  if (actual !== expected) {
    throw new PipelineError(
      'E_OPERATE_BINDING_MISMATCH',
      `Operate runtime binding mismatch at ${field}.`,
      '',
      { field, expected, actual },
    );
  }
}

/**
 * Compare the durable Phase 1 binding fields in one deterministic order.
 * Inputs are validated first; mismatch details contain only safe IDs,
 * versions, runtime names, and event-head metadata.
 */
export function assertOperateRuntimeBindingsV2({
  cycle,
  inputBinding,
  assignment,
  submission,
  runtimeBinding,
  runtimeState,
  checkpoint,
}) {
  assertProtocolArtifact('operating-cycle', cycle, { protocolVersion: OPERATE_RUNTIME_PROTOCOL_VERSION });
  assertProtocolArtifact('operating-cycle-input-binding', inputBinding, { protocolVersion: OPERATE_RUNTIME_PROTOCOL_VERSION });
  assertProtocolArtifact('operating-assignment', assignment, { protocolVersion: OPERATE_RUNTIME_PROTOCOL_VERSION });
  assertProtocolArtifact('operating-submission', submission, { protocolVersion: OPERATE_RUNTIME_PROTOCOL_VERSION });
  readOperatingRuntimeStateV2(runtimeState, { protocolVersion: OPERATE_RUNTIME_PROTOCOL_VERSION });
  assertProtocolArtifact('operating-checkpoint', checkpoint, { protocolVersion: OPERATE_RUNTIME_PROTOCOL_VERSION });

  assertOperateBindingField('cycle.inputBindingId', cycle.inputBindingId, inputBinding.inputBindingId);
  assertOperateBindingField('cycle.cycleId', cycle.cycleId, inputBinding.cycleId);
  assertOperateBindingField('cycle.scopeId', cycle.scopeId, inputBinding.scopeId);
  assertOperateBindingField('cycle.domainId', cycle.domainId, inputBinding.domainId);
  assertOperateBindingField('cycle.domainVersion', cycle.domainVersion, inputBinding.domainVersion);
  assertOperateBindingField('assignment.cycleId', cycle.cycleId, assignment.cycleId);
  assertOperateBindingField('submission.assignmentId', assignment.assignmentId, submission.assignmentId);
  assertOperateBindingField('submission.cycleId', cycle.cycleId, submission.cycleId);
  assertOperateBindingField('runtime.runtime', runtimeBinding.runtime, inputBinding.runtimeBinding.runtime);
  assertOperateBindingField(
    'runtime.adapterVersion',
    runtimeBinding.adapterVersion,
    inputBinding.runtimeBinding.adapterVersion,
  );
  assertOperateBindingField(
    `contractVersions.${assignment.outputContract.schemaId}`,
    assignment.outputContract.schemaVersion,
    cycle.contractVersions[assignment.outputContract.schemaId],
  );
  assertOperateBindingField('eventHead.sequence', checkpoint.eventHead.sequence, runtimeState.eventHead.sequence);
  assertOperateBindingField('eventHead.hash', checkpoint.eventHead.hash, runtimeState.eventHead.hash);
  assertOperateBindingField(
    'eventReplayIndexHash',
    sha256Jcs(runtimeState.eventReplayIndex),
    checkpoint.eventReplayIndexHash,
  );
  return {
    cycle,
    inputBinding,
    assignment,
    submission,
    runtimeBinding,
    runtimeState,
    checkpoint,
  };
}

export {
  OPERATE_EXTENSION_CONTRACT_KINDS_V2,
  OPERATE_EVIDENCE_CONTRACT_KINDS_V2,
  OPERATE_EVIDENCE_KINDS_V2,
  OPERATE_EVIDENCE_EDGE_RELATIONS_V2,
  OPERATE_EVIDENCE_RESOLVER_ERROR_CODES_V2,
  OPERATE_OPERATING_INTELLIGENCE_CONTRACT_KINDS_V2,
  OPERATE_OPERATING_PROJECTION_IDENTITIES_V2,
  OPERATE_OPERATING_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2,
  OPERATE_GOVERNED_EXECUTION_CONTRACT_KINDS_V2,
  OPERATE_GOVERNED_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2,
  OPERATE_GOVERNED_EFFECT_CLASSES_V2,
  OPERATE_GOVERNED_POLICY_OUTCOMES_V2,
  OPERATE_GOVERNED_POLICY_TIERS_V2,
  OPERATE_GOVERNED_CORE_PROHIBITIONS_V2,
  OPERATE_GOVERNED_RECOVERY_CLASSIFICATIONS_V2,
  OPERATE_EXPERIENCE_CONTRACT_KINDS_V2,
  OPERATING_DELIVERY_ROUTES_V1,
  findOperateCoreProhibitionV2,
  OPERATE_GOVERNED_OPERATION_STATES_V2,
  OPERATE_GOVERNED_OPERATION_TERMINAL_STATES_V2,
  OPERATE_EXECUTION_VERIFICATION_STATUSES_V2,
  OPERATE_HYPOTHESIS_VERIFICATION_STATUSES_V2,
  OPERATE_GOVERNED_TOOL_OPERATIONS_V2,
  OPERATE_AUTHORITY_GUARD_IDS_V2,
  OPERATE_PUBLIC_DOMAIN_CONTRACT_BINDINGS_V2,
  assertOperateIntelligencePlanContractV2,
  assertOperateGovernedExtensionRegistrationV2,
  OPERATE_ROLE_MANDATES_V2,
  PROTOCOL_SCHEMA_REGISTRY,
  assertOperateExperienceArtifactV2,
  assertDashboardBootstrapV1,
  resolveOperateExperienceSchemaV2,
  validateOperateExperienceArtifactV2,
  validateDashboardBootstrapV1,
  assertProtocolArtifact,
  canonicalizeJson,
  listProtocolSchemas,
  normalizePlanningTask,
  resolveProtocolSchema,
  sha256Jcs,
  validatePlanningAcceptanceCoverage,
  validateProtocolArtifact,
};
