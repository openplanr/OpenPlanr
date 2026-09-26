import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { assertProtocolArtifact } from '@openplanr/protocol/contracts';
import { PipelineError } from '@openplanr/protocol/errors';
import { deriveOperatingApprovalRequirementInstanceIdV2 } from './policy-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';

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

function actionIdentity(action) {
  return { actionId: action.actionId, revision: action.revision, actionHash: action.actionHash };
}

function policyRef(evaluation) {
  return clone(evaluation.policy);
}

function sameAction(left, right) {
  return (
    left?.actionId === right?.actionId &&
    left?.revision === right?.revision &&
    left?.actionHash === right?.actionHash
  );
}

function samePolicy(left, right) {
  return (
    left?.policyId === right?.policyId &&
    left?.policyVersion === right?.policyVersion &&
    left?.policyHash === right?.policyHash
  );
}

function sameIdentity(left, right) {
  return left?.id === right?.id && left?.version === right?.version;
}

function sameTarget(left, right) {
  return left?.kind === right?.kind && left?.id === right?.id && left?.revision === right?.revision;
}

function time(value, field) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed))
    fail('RESULT_CONTRACT_INVALID', `${field} must be an explicit timestamp.`, { field });
  return parsed;
}

function exactRequirementBinding(requirement, evaluation, action) {
  return (
    requirement.evaluationId === evaluation.evaluationId &&
    samePolicy(requirement.policy, evaluation.policy) &&
    sameAction(requirement.action, evaluation.action) &&
    sameAction(requirement.action, actionIdentity(action)) &&
    requirement.scopeId === action.scopeId &&
    requirement.domainId === action.domainId &&
    requirement.domainVersion === action.domainVersion &&
    sameIdentity(requirement.capability, action.requestedCapability) &&
    sameTarget(requirement.target, action.targetBinding) &&
    requirement.effectClass === action.effectClass &&
    requirement.mode === evaluation.outcome &&
    evaluation.approvalRequirementIds.includes(requirement.requirementId)
  );
}

function exactRecordBinding(record, requirement) {
  return (
    record.requirementId === requirement.requirementId &&
    record.evaluationId === requirement.evaluationId &&
    samePolicy(record.policy, requirement.policy) &&
    sameAction(record.action, requirement.action) &&
    record.scopeId === requirement.scopeId &&
    record.domainId === requirement.domainId &&
    record.domainVersion === requirement.domainVersion &&
    sameIdentity(record.capability, requirement.capability) &&
    sameTarget(record.target, requirement.target) &&
    record.effectClass === requirement.effectClass &&
    record.scopeHash === requirement.scopeHash
  );
}

function exactScalarArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function declaredParty(requirement, record) {
  const party = requirement.parties.find(({ partyId }) => partyId === record.partyId);
  return (
    party &&
    party.actorKind === record.actor.kind &&
    (party.actorId === null || party.actorId === record.actor.actorId) &&
    sameIdentity(party.requiredCapability, record.actor.capability)
  );
}

function assertEvaluationActionBinding(evaluation, action, nowMs) {
  try {
    assertProtocolArtifact('operating-policy-evaluation', evaluation, {
      protocolVersion: PROTOCOL_VERSION,
    });
    assertProtocolArtifact('operating-action', action, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail(
      'APPROVAL_INVALID',
      'Approval evaluation requires contract-valid Action and policy-evaluation records.',
      {
        cause: cause?.code ?? null,
      },
    );
  }
  if (
    !sameAction(evaluation.action, actionIdentity(action)) ||
    !sameIdentity(evaluation.capability, action.requestedCapability) ||
    !sameTarget(evaluation.target, action.targetBinding) ||
    evaluation.effectClass !== action.effectClass ||
    time(evaluation.evaluatedAt, 'evaluatedAt') > nowMs
  ) {
    fail(
      'APPROVAL_INVALID',
      'Policy evaluation does not bind the exact current Action authority tuple and decision time.',
      {
        evaluationId: evaluation.evaluationId,
      },
    );
  }
}

function assertApprovalRequirementIntegrity(requirement) {
  try {
    assertProtocolArtifact('operating-approval-requirement', requirement, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch (cause) {
    fail('APPROVAL_INVALID', 'Approval requirement is not contract-valid.', {
      requirementId: requirement?.requirementId ?? null,
      cause: cause?.code ?? null,
    });
  }
  if (requirement.scopeHash !== sha256Jcs(without(requirement, 'scopeHash'))) {
    fail(
      'APPROVAL_INVALID',
      'Approval requirement hash does not bind its exact scope and consumption rule.',
      {
        requirementId: requirement.requirementId,
      },
    );
  }
  const parties = requirement.parties;
  const partyIds = parties.map(({ partyId }) => partyId);
  const namedActorKeys = parties
    .filter(({ actorId }) => actorId !== null)
    .map(({ actorKind, actorId }) => `${actorKind}:${actorId}`);
  const namedActorIds = parties
    .map(({ actorId }) => actorId)
    .filter((actorId) => actorId !== null)
    .sort();
  const requiredActorKinds = [...new Set(parties.map(({ actorKind }) => actorKind))].sort();
  const allPartiesNamed = parties.every(
    ({ actorId }) => typeof actorId === 'string' && actorId.length > 0,
  );
  const partiesAreUnique =
    new Set(partyIds).size === partyIds.length &&
    new Set(namedActorKeys).size === namedActorKeys.length;
  const derivedSetsAreExact =
    exactScalarArray(requirement.namedActorIds, namedActorIds) &&
    exactScalarArray(requirement.requiredActorKinds, requiredActorKinds);
  const cardinalityIsExact =
    (requirement.mode === 'named-single-party' &&
      parties.length === 1 &&
      allPartiesNamed &&
      requirement.threshold === 1) ||
    (requirement.mode === 'named-multi-party' &&
      parties.length >= 2 &&
      allPartiesNamed &&
      requirement.threshold === parties.length) ||
    (requirement.mode === 'threshold' &&
      parties.length >= 2 &&
      allPartiesNamed &&
      requirement.threshold >= 2 &&
      requirement.threshold <= parties.length);
  if (!partiesAreUnique || !derivedSetsAreExact || !cardinalityIsExact) {
    fail(
      'APPROVAL_INVALID',
      'Approval requirement party identities, named actors, actor kinds, mode, and threshold must be exact.',
      {
        requirementId: requirement.requirementId,
        mode: requirement.mode,
      },
    );
  }
  return requirement;
}

function assertApprovalRequirementSetIntegrity(requirements, { evaluationId = null } = {}) {
  if (!Array.isArray(requirements)) {
    fail('APPROVAL_INVALID', 'Approval requirements must be one exact array.');
  }
  const checked = requirements.map(assertApprovalRequirementIntegrity);
  const requirementIds = checked.map(({ requirementId }) => requirementId);
  if (new Set(requirementIds).size !== requirementIds.length) {
    fail('APPROVAL_INVALID', 'Approval requirement identities must be unique.');
  }
  const namedActorPartiesByEvaluation = new Map();
  for (const requirement of checked) {
    if (evaluationId !== null && requirement.evaluationId !== evaluationId) {
      fail('APPROVAL_INVALID', 'Approval requirement set crosses evaluation authority.', {
        evaluationId,
        requirementId: requirement.requirementId,
      });
    }
    let namedActorParties = namedActorPartiesByEvaluation.get(requirement.evaluationId);
    if (!namedActorParties) {
      namedActorParties = new Map();
      namedActorPartiesByEvaluation.set(requirement.evaluationId, namedActorParties);
    }
    for (const party of requirement.parties) {
      const actorKey = `${party.actorKind}:${party.actorId}`;
      const partyKey = `${requirement.requirementId}:${party.partyId}`;
      if (namedActorParties.has(actorKey) && namedActorParties.get(actorKey) !== partyKey) {
        fail(
          'APPROVAL_INVALID',
          'One named actor cannot be declared for two parties in the same evaluation.',
          {
            evaluationId: requirement.evaluationId,
          },
        );
      }
      namedActorParties.set(actorKey, partyKey);
    }
  }
  return checked;
}

/** Validate the immutable requirement itself without requiring its Action projection. */
export function assertOperatingApprovalRequirementIntegrityV2(requirement) {
  return freeze(clone(assertApprovalRequirementIntegrity(requirement)));
}

/** Validate one complete requirement collection, including global actor-to-party uniqueness. */
export function assertOperatingApprovalRequirementSetIntegrityV2({
  requirements,
  evaluationId = null,
} = {}) {
  return freeze(assertApprovalRequirementSetIntegrity(requirements, { evaluationId }).map(clone));
}

/** Build the exact party/quorum record for one policy evaluation. */
export function createOperatingApprovalRequirementV2({
  policyRequirementId,
  evaluation,
  action,
  parties,
  threshold,
  expiresAt = null,
  consumable = true,
} = {}) {
  if (!['named-single-party', 'named-multi-party', 'threshold'].includes(evaluation?.outcome)) {
    fail(
      'APPROVAL_INVALID',
      'Only an approval-bearing policy evaluation may create an approval requirement.',
      {
        evaluationId: evaluation?.evaluationId ?? null,
      },
    );
  }
  const requirementId = deriveOperatingApprovalRequirementInstanceIdV2({
    policyRequirementId,
    evaluationId: evaluation.evaluationId,
  });
  if (!evaluation.approvalRequirementIds.includes(requirementId)) {
    fail(
      'APPROVAL_INVALID',
      'Requirement instance identity must be declared by the exact policy evaluation.',
      {
        policyRequirementId,
        requirementId,
      },
    );
  }
  const normalizedParties = [...(parties ?? [])]
    .map(clone)
    .sort((left, right) => left.partyId.localeCompare(right.partyId));
  const namedActorIds = normalizedParties
    .map(({ actorId }) => actorId)
    .filter((actorId) => actorId !== null)
    .sort();
  const requiredActorKinds = [
    ...new Set(normalizedParties.map(({ actorKind }) => actorKind)),
  ].sort();
  const requiredThreshold =
    threshold ?? (evaluation.outcome === 'named-single-party' ? 1 : normalizedParties.length);
  if (expiresAt !== null) time(expiresAt, 'expiresAt');
  const record = {
    kind: 'operating-approval-requirement',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    requirementId,
    evaluationId: evaluation.evaluationId,
    policy: policyRef(evaluation),
    action: actionIdentity(action),
    scopeId: action.scopeId,
    domainId: action.domainId,
    domainVersion: action.domainVersion,
    capability: clone(action.requestedCapability),
    target: clone(action.targetBinding),
    effectClass: action.effectClass,
    parties: normalizedParties,
    mode: evaluation.outcome,
    namedActorIds,
    requiredActorKinds,
    threshold: requiredThreshold,
    expiresAt,
    consumable,
  };
  record.scopeHash = sha256Jcs(record);
  return assertOperatingApprovalRequirementV2(record, { evaluation, action });
}

export function assertOperatingApprovalRequirementV2(requirement, { evaluation, action }) {
  assertApprovalRequirementIntegrity(requirement);
  if (!exactRequirementBinding(requirement, evaluation, action)) {
    fail(
      'APPROVAL_INVALID',
      'Approval requirement does not bind the exact Action, evaluation, scope, party, and use rule.',
      {
        requirementId: requirement.requirementId,
      },
    );
  }
  return freeze(clone(requirement));
}

/** Create one immutable approval/rejection/defer record for a declared party. */
export function createOperatingApprovalRecordV2({
  approvalId,
  requirement,
  evaluation,
  action,
  partyId,
  actor,
  decision,
  issuedAt,
  expiresAt,
} = {}) {
  const checkedRequirement = assertOperatingApprovalRequirementV2(requirement, {
    evaluation,
    action,
  });
  const issued = time(issuedAt, 'issuedAt');
  const evaluated = time(evaluation.evaluatedAt, 'evaluatedAt');
  const requirementExpiry =
    checkedRequirement.expiresAt === null
      ? null
      : time(checkedRequirement.expiresAt, 'requirement.expiresAt');
  const recordExpiry = expiresAt === undefined ? checkedRequirement.expiresAt : expiresAt;
  const expiry = recordExpiry === null ? null : time(recordExpiry, 'expiresAt');
  if (
    issued < evaluated ||
    (requirementExpiry !== null && issued >= requirementExpiry) ||
    (expiry !== null &&
      (expiry <= issued || (requirementExpiry !== null && expiry > requirementExpiry)))
  ) {
    fail(
      'APPROVAL_EXPIRED',
      'Approval issuance and expiry must be causal and no broader than its requirement.',
      {
        requirementId: checkedRequirement.requirementId,
      },
    );
  }
  const record = {
    kind: 'operating-approval-record',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    approvalId,
    requirementId: checkedRequirement.requirementId,
    evaluationId: checkedRequirement.evaluationId,
    policy: clone(checkedRequirement.policy),
    action: clone(checkedRequirement.action),
    scopeId: checkedRequirement.scopeId,
    domainId: checkedRequirement.domainId,
    domainVersion: checkedRequirement.domainVersion,
    capability: clone(checkedRequirement.capability),
    target: clone(checkedRequirement.target),
    effectClass: checkedRequirement.effectClass,
    partyId,
    actor: clone(actor),
    decision,
    scopeHash: checkedRequirement.scopeHash,
    issuedAt,
    expiresAt: recordExpiry,
    consumedByOperationId: null,
  };
  record.recordHash = sha256Jcs(record);
  return assertOperatingApprovalRecordV2(record, { requirement: checkedRequirement });
}

export function assertOperatingApprovalRecordV2(record, { requirement }) {
  assertApprovalRequirementIntegrity(requirement);
  try {
    assertProtocolArtifact('operating-approval-record', record, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch (cause) {
    fail('APPROVAL_INVALID', 'Approval record is not contract-valid.', {
      approvalId: record?.approvalId ?? null,
      cause: cause?.code ?? null,
    });
  }
  if (
    !exactRecordBinding(record, requirement) ||
    !declaredParty(requirement, record) ||
    record.recordHash !== sha256Jcs(without(record, 'recordHash'))
  ) {
    fail(
      'APPROVAL_INVALID',
      'Approval record does not bind the exact requirement, party, actor capability, or hash.',
      {
        approvalId: record.approvalId,
      },
    );
  }
  return freeze(clone(record));
}

/** Append with runtime replay semantics: same ID+bytes is harmless, divergence is terminal. */
export function appendOperatingApprovalRecordV2({
  records = [],
  record,
  requirement,
  requirements = [requirement],
}) {
  const checked = assertOperatingApprovalRecordV2(record, { requirement });
  const checkedRequirements = assertApprovalRequirementSetIntegrity(requirements, {
    evaluationId: checked.evaluationId,
  });
  const namedActorParties = new Map();
  for (const candidateRequirement of checkedRequirements) {
    for (const party of candidateRequirement.parties) {
      if (party.actorId === null) continue;
      const actorKey = `${party.actorKind}:${party.actorId}`;
      const partyKey = `${candidateRequirement.requirementId}:${party.partyId}`;
      if (namedActorParties.has(actorKey) && namedActorParties.get(actorKey) !== partyKey) {
        fail(
          'APPROVAL_INVALID',
          'One named actor cannot be declared for two parties in the same evaluation.',
          {
            evaluationId: checked.evaluationId,
          },
        );
      }
      namedActorParties.set(actorKey, partyKey);
    }
  }
  const checkedActorKey = `${checked.actor.kind}:${checked.actor.actorId}`;
  const checkedPartyKey = `${checked.requirementId}:${checked.partyId}`;
  if (
    namedActorParties.has(checkedActorKey) &&
    namedActorParties.get(checkedActorKey) !== checkedPartyKey
  ) {
    fail(
      'APPROVAL_INVALID',
      'A named actor cannot record authority for a different party in the same evaluation.',
      {
        evaluationId: checked.evaluationId,
      },
    );
  }
  const existing = records.find(({ approvalId }) => approvalId === checked.approvalId);
  if (existing) {
    if (sha256Jcs(existing) !== sha256Jcs(checked)) {
      fail('APPROVAL_INVALID', 'Approval identity was reused with divergent bytes.', {
        approvalId: checked.approvalId,
      });
    }
    return freeze({ records: [...records].map(clone), record: clone(existing), replayed: true });
  }
  const partyReuse = records.find(
    (candidate) =>
      candidate.evaluationId === checked.evaluationId &&
      ((candidate.requirementId === checked.requirementId &&
        candidate.partyId === checked.partyId) ||
        `${candidate.actor.kind}:${candidate.actor.actorId}` ===
          `${checked.actor.kind}:${checked.actor.actorId}`),
  );
  if (partyReuse) {
    fail(
      'APPROVAL_INVALID',
      'One actor may satisfy only one party across the complete current evaluation.',
      {
        requirementId: checked.requirementId,
        partyId: checked.partyId,
      },
    );
  }
  const next = [...records.map(clone), clone(checked)].sort((left, right) =>
    left.approvalId.localeCompare(right.approvalId),
  );
  return freeze({ records: next, record: clone(checked), replayed: false });
}

/** Determine the exact durable disposition without treating partial quorum as authority. */
export function evaluateOperatingApprovalSetV2({
  evaluation,
  action,
  requirements = [],
  approvals = [],
  now,
} = {}) {
  const nowMs = time(now, 'now');
  assertEvaluationActionBinding(evaluation, action, nowMs);
  if (evaluation.outcome === 'automatic') {
    if (
      evaluation.approvalRequirementIds.length !== 0 ||
      requirements.length !== 0 ||
      approvals.length !== 0
    ) {
      fail(
        'APPROVAL_INVALID',
        'Automatic policy authority has an exact empty requirement and approval set.',
      );
    }
    return freeze({
      complete: true,
      disposition: 'approved',
      approvalIds: [],
      requirementIds: [],
      reasonCode: 'automatic',
    });
  }
  if (['deferred', 'rejected', 'prohibited'].includes(evaluation.outcome)) {
    if (
      evaluation.approvalRequirementIds.length !== 0 ||
      requirements.length !== 0 ||
      approvals.length !== 0
    ) {
      fail(
        'APPROVAL_INVALID',
        'Non-approval policy dispositions cannot borrow approval authority.',
      );
    }
    return freeze({
      complete: true,
      disposition: evaluation.outcome === 'prohibited' ? 'rejected' : evaluation.outcome,
      approvalIds: [],
      requirementIds: [],
      reasonCode: `policy-${evaluation.outcome}`,
    });
  }
  const requirementIds = requirements.map(({ requirementId }) => requirementId);
  if (
    new Set(requirementIds).size !== requirementIds.length ||
    sha256Jcs([...requirementIds].sort()) !==
      sha256Jcs([...evaluation.approvalRequirementIds].sort())
  ) {
    fail(
      'APPROVAL_REQUIRED',
      'Approval requirements must equal the current evaluation requirement set exactly.',
    );
  }
  const approvalIds = approvals.map(({ approvalId }) => approvalId);
  if (new Set(approvalIds).size !== approvalIds.length) {
    fail('APPROVAL_INVALID', 'Approval identities must be unique.');
  }
  if (approvals.some(({ requirementId }) => !requirementIds.includes(requirementId))) {
    fail('APPROVAL_INVALID', 'Approval set contains authority for another requirement.');
  }
  const checkedRequirements = assertApprovalRequirementSetIntegrity(requirements, {
    evaluationId: evaluation.evaluationId,
  })
    .sort((left, right) => left.requirementId.localeCompare(right.requirementId))
    .map((requirement) =>
      assertOperatingApprovalRequirementV2(requirement, { evaluation, action }),
    );
  const declaredActors = new Map(
    checkedRequirements.flatMap((requirement) =>
      requirement.parties.map((party) => [
        `${party.actorKind}:${party.actorId}`,
        `${requirement.requirementId}:${party.partyId}`,
      ]),
    ),
  );
  const checkedRecordsByRequirement = new Map();
  const recordedActors = new Map();
  for (const requirement of checkedRequirements) {
    const records = approvals
      .filter(({ requirementId }) => requirementId === requirement.requirementId)
      .map((record) => assertOperatingApprovalRecordV2(record, { requirement }));
    const parties = new Set();
    for (const record of records) {
      const actorKey = `${record.actor.kind}:${record.actor.actorId}`;
      const partyKey = `${requirement.requirementId}:${record.partyId}`;
      if (declaredActors.has(actorKey) && declaredActors.get(actorKey) !== partyKey) {
        fail(
          'APPROVAL_INVALID',
          'A named actor cannot satisfy a different party in the same evaluation.',
          {
            evaluationId: evaluation.evaluationId,
          },
        );
      }
      if (recordedActors.has(actorKey) && recordedActors.get(actorKey) !== partyKey) {
        fail(
          'APPROVAL_INVALID',
          'One actor cannot satisfy two parties across the current evaluation.',
          {
            evaluationId: evaluation.evaluationId,
          },
        );
      }
      if (parties.has(record.partyId)) {
        fail('APPROVAL_INVALID', 'One approval party cannot be counted twice.', {
          requirementId: requirement.requirementId,
        });
      }
      recordedActors.set(actorKey, partyKey);
      parties.add(record.partyId);
    }
    checkedRecordsByRequirement.set(requirement.requirementId, records);
  }
  let disposition = 'approved';
  let incompleteReason = null;
  const approvedIds = [];
  for (const checkedRequirement of checkedRequirements) {
    if (
      checkedRequirement.expiresAt !== null &&
      time(checkedRequirement.expiresAt, 'requirement.expiresAt') <= nowMs
    ) {
      fail('APPROVAL_EXPIRED', 'Approval requirement has expired.', {
        requirementId: checkedRequirement.requirementId,
      });
    }
    const records = checkedRecordsByRequirement.get(checkedRequirement.requirementId);
    for (const record of records) {
      const issued = time(record.issuedAt, 'approval.issuedAt');
      const expiry =
        record.expiresAt === null ? null : time(record.expiresAt, 'approval.expiresAt');
      if (
        issued < time(evaluation.evaluatedAt, 'evaluatedAt') ||
        issued > nowMs ||
        (expiry !== null && expiry <= nowMs) ||
        record.consumedByOperationId !== null
      ) {
        fail(
          record.consumedByOperationId === null ? 'APPROVAL_EXPIRED' : 'APPROVAL_INVALID',
          'Stale, future, expired, or consumed approval cannot authorize execution.',
          {
            approvalId: record.approvalId,
          },
        );
      }
    }
    if (records.some(({ decision }) => decision === 'rejected')) disposition = 'rejected';
    else if (records.some(({ decision }) => decision === 'deferred') && disposition !== 'rejected')
      disposition = 'deferred';
    if (disposition !== 'approved') continue;
    const approved = records.filter(({ decision }) => decision === 'approved');
    approvedIds.push(...approved.map(({ approvalId }) => approvalId));
    if (approved.length < checkedRequirement.threshold) {
      incompleteReason ??= 'approval-quorum-incomplete';
    }
    if (
      checkedRequirement.mode === 'named-multi-party' &&
      approved.length !== checkedRequirement.parties.length
    ) {
      incompleteReason ??= 'named-party-set-incomplete';
    }
  }
  if (disposition === 'approved' && incompleteReason !== null) {
    return freeze({
      complete: false,
      disposition: null,
      approvalIds: approvedIds.sort(),
      requirementIds: [...requirementIds].sort(),
      reasonCode: incompleteReason,
    });
  }
  return freeze({
    complete: true,
    disposition,
    approvalIds: [...approvalIds].sort(),
    requirementIds: [...requirementIds].sort(),
    reasonCode: disposition === 'approved' ? 'approval-quorum-complete' : `approval-${disposition}`,
  });
}

/** Rollback never borrows a consumed execution approval; it needs a fresh exact set. */
export function evaluateOperatingRollbackApprovalSetV2(input = {}) {
  const result = evaluateOperatingApprovalSetV2(input);
  if (result.disposition !== 'approved' || result.complete !== true) {
    fail(
      'APPROVAL_REQUIRED',
      'Rollback requires one complete independently valid approval disposition.',
      {
        reasonCode: result.reasonCode,
      },
    );
  }
  return result;
}

/** Replace only the current projection while retaining the immutable pre-consumption records as history. */
export function consumeOperatingApprovalRecordsV2({
  approvals,
  requirements,
  approvalIds,
  operationId,
}) {
  const selected = new Set(approvalIds);
  if (
    selected.size !== approvalIds.length ||
    selected.size === 0 ||
    typeof operationId !== 'string' ||
    !/^op_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u.test(operationId)
  ) {
    fail(
      'APPROVAL_INVALID',
      'Approval consumption requires one nonempty unique exact approval set.',
    );
  }
  const consumed = [];
  const history = [];
  const checkedRequirements = assertApprovalRequirementSetIntegrity(requirements ?? []);
  const requirementById = new Map(
    checkedRequirements.map((requirement) => [requirement.requirementId, requirement]),
  );
  if (requirementById.size !== checkedRequirements.length) {
    fail('APPROVAL_INVALID', 'Approval consumption requires unique bound requirement identities.');
  }
  const records = approvals.map((record) => {
    if (!selected.has(record.approvalId)) return clone(record);
    const requirement = requirementById.get(record.requirementId);
    if (!requirement || !requirement.consumable) {
      fail('APPROVAL_INVALID', 'The bound approval requirement does not permit consumption.', {
        approvalId: record.approvalId,
      });
    }
    assertOperatingApprovalRecordV2(record, { requirement });
    if (record.decision !== 'approved' || record.consumedByOperationId !== null) {
      fail('APPROVAL_INVALID', 'Only an unconsumed approved record may be consumed.', {
        approvalId: record.approvalId,
      });
    }
    history.push(clone(record));
    const next = { ...clone(record), consumedByOperationId: operationId };
    next.recordHash = sha256Jcs(without(next, 'recordHash'));
    consumed.push(next.approvalId);
    return next;
  });
  if (consumed.length !== selected.size) {
    fail(
      'APPROVAL_INVALID',
      'Every consumed approval identity must exist in the current exact set.',
    );
  }
  return freeze({ records, consumedApprovalIds: consumed.sort(), history });
}

/** Keep append-only history while making only the new evaluation's authority current. */
export function partitionSupersededOperatingAuthorityV2({
  evaluation,
  requirements = [],
  approvals = [],
  currentEvaluationId,
}) {
  const active = evaluation.evaluationId === currentEvaluationId;
  return freeze({
    activeEvaluation: active ? clone(evaluation) : null,
    activeRequirements: active ? requirements.map(clone) : [],
    activeApprovals: active ? approvals.map(clone) : [],
    supersededEvaluations: active ? [] : [clone(evaluation)],
    supersededRequirements: active ? [] : requirements.map(clone),
    supersededApprovals: active ? [] : approvals.map(clone),
  });
}

/**
 * Create an Action-scoped Review without occupying Cycle.activeReviewId. When
 * it is the sole human gate for an awaiting source Cycle, an exact approval
 * releases that Cycle for separate policy evaluation; it never approves the
 * Action itself.
 */
export function createOperatingActionReviewV2({ reviewId, action, ownerActorId, timestamp }) {
  time(timestamp, 'timestamp');
  try {
    assertProtocolArtifact('operating-action', action, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail(
      'RESULT_CONTRACT_INVALID',
      'Action-scoped Review requires one contract-valid governed Action.',
      {
        cause: cause?.code ?? null,
      },
    );
  }
  if (['actionId', 'revision', 'actionHash'].some((field) => !Object.hasOwn(action, field))) {
    fail(
      'ACTION_REVISION_MISMATCH',
      'Action-scoped Review requires one complete Action authority identity.',
    );
  }
  const review = {
    kind: 'operating-review',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    reviewId,
    cycleId: action.sourceCycleId,
    subject: { type: 'action', ...actionIdentity(action) },
    ownerActorId,
    state: 'pending',
    disposition: null,
    workDispositions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  try {
    assertProtocolArtifact('operating-review', review, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail('RESULT_CONTRACT_INVALID', 'Action-scoped Review is not contract-valid.', {
      cause: cause?.code ?? null,
    });
  }
  return freeze(review);
}
