import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';
import {
  assertOperatingEvidenceObservationV2,
  assertOperatingOutcomeEvaluationV2,
} from '../protocol/live-evidence-v2.mjs';
import { assertShipClosure } from './ship-closure.mjs';
import { verifyShipCompatibilityProjection } from './ship-closure-projections.mjs';

const HASH = /^sha256:[a-f0-9]{64}$/u;
const RECORD_IDENTITY = Object.freeze({
  'operate-executor-registration': (record) => record.executorId,
  'operating-governed-operation': (record) => record.operationId,
  'operating-action-verification-plan': (record) => record.verificationPlanId,
  'operating-checkpoint': (record) => record.runtimeStateHash,
  'operating-rollback-plan': (record) => record.rollbackPlanId,
  'operating-rollback-result': (record) => record.rollbackResultId,
});
const REQUIRED_BINDINGS = Object.freeze({
  commit: Object.freeze(['operating-governed-operation']),
  'pull-request': Object.freeze(['operating-governed-operation']),
  merge: Object.freeze(['operating-governed-operation']),
  package: Object.freeze(['operating-governed-operation']),
  publish: Object.freeze(['operating-governed-operation']),
  deploy: Object.freeze(['operating-governed-operation', 'operating-rollback-plan']),
  canary: Object.freeze(['operating-action-verification-plan', 'operating-checkpoint']),
  verify: Object.freeze(['operating-action-verification-plan', 'operating-checkpoint']),
  rollback: Object.freeze(['operating-rollback-plan', 'operating-rollback-result']),
  compensate: Object.freeze(['operating-rollback-plan', 'operating-rollback-result']),
});
const EFFECT_BY_OPERATION = Object.freeze({
  commit: 'commit',
  'pull-request': 'push-or-pr',
  merge: 'merge',
  package: 'commit',
  publish: 'publish',
  deploy: 'production-deploy',
  canary: 'staging-deploy',
  verify: 'staging-deploy',
  rollback: 'rollback-or-compensation',
  compensate: 'rollback-or-compensation',
});
const SENSITIVITY_BY_EFFECT = Object.freeze({
  'project-write': 'internal',
  'provider-call': 'confidential',
  'external-effect': 'confidential',
  destructive: 'restricted',
});
const LANDING_EVENT_RULES = Object.freeze({
  'plan.created': Object.freeze({
    from: ['planned'],
    to: 'awaiting-confirmation',
    actors: ['engine'],
    operation: false,
    confirmation: false,
  }),
  'phase.intent-recorded': Object.freeze({
    from: ['awaiting-confirmation'],
    to: 'intent-recorded',
    actors: ['engine'],
    operation: true,
    confirmation: true,
  }),
  'phase.dispatching': Object.freeze({
    from: ['intent-recorded'],
    to: 'dispatching',
    actors: ['runtime'],
    operation: true,
    confirmation: true,
  }),
  'phase.succeeded': Object.freeze({
    from: ['dispatching'],
    to: 'awaiting-confirmation',
    actors: ['runtime'],
    operation: true,
    confirmation: true,
  }),
  'phase.failed': Object.freeze({
    from: ['dispatching'],
    to: 'blocked',
    actors: ['runtime'],
    operation: true,
    confirmation: true,
  }),
  'phase.blocked': Object.freeze({
    from: ['intent-recorded', 'dispatching'],
    to: 'blocked',
    actors: ['engine', 'runtime'],
    operation: true,
    confirmation: true,
  }),
  'phase.uncertain': Object.freeze({
    from: ['dispatching'],
    to: 'uncertain',
    actors: ['runtime'],
    operation: true,
    confirmation: true,
  }),
  'containment.applied': Object.freeze({
    from: ['dispatching', 'uncertain'],
    to: 'recovery_required',
    actors: ['runtime'],
    operation: true,
    confirmation: true,
  }),
  'recovery.required': Object.freeze({
    from: ['recovery_required'],
    to: 'recovery_required',
    actors: ['engine', 'runtime'],
    operation: true,
    confirmation: false,
  }),
  'recovery.confirmed': Object.freeze({
    from: ['recovery_required'],
    to: 'intent-recorded',
    actors: ['human'],
    operation: true,
    confirmation: true,
  }),
  'recovery.succeeded': Object.freeze({
    from: ['dispatching'],
    to: 'awaiting-confirmation',
    actors: ['runtime'],
    operation: true,
    confirmation: true,
  }),
  'recovery.failed': Object.freeze({
    from: ['dispatching'],
    to: 'blocked',
    actors: ['runtime'],
    operation: true,
    confirmation: true,
  }),
  'landing.completed': Object.freeze({
    from: ['awaiting-confirmation'],
    to: 'completed',
    actors: ['engine'],
    operation: false,
    confirmation: false,
  }),
  'landing.blocked': Object.freeze({
    from: ['awaiting-confirmation'],
    to: 'blocked',
    actors: ['engine'],
    operation: false,
    confirmation: false,
  }),
});

export const LANDING_PROTOCOL_VERSION = '1.2.0';
export const LANDING_PORTABLE_AUTHORITY = 'none';
export const LANDING_SHIP_PROTOCOL_VERSION = '1.1.0';

export class LandingContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LandingContractError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new LandingContractError(code, message, details);
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

function safePortable(value, path = '$') {
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint')
    fail('LANDING_NON_PORTABLE', 'Landing contracts must be JSON-only.', { path });
  if (Array.isArray(value))
    return void value.forEach((entry, index) => {
      safePortable(entry, `${path}[${index}]`);
    });
  if (value && typeof value === 'object')
    return void Object.entries(value).forEach(([key, entry]) => {
      safePortable(entry, `${path}.${key}`);
    });
  if (typeof value !== 'string') return;
  if (
    value.includes('\u0000') ||
    value.startsWith('/') ||
    value.startsWith('~') ||
    /(?:^|[\s"'`(])\/(?:Users|home|private|var|etc|tmp)\//u.test(value) ||
    /(?:^|[\s"'`(])[A-Za-z]:[\\/][^\s]+/u.test(value) ||
    value.split(/[\\/]/u).includes('..') ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value) ||
    /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/u.test(value) ||
    /\b(?:api[-_ ]?key|access[-_ ]?token|client[-_ ]?secret|password|passwd|secret|token)\s*[:=]\s*[^\s]+/iu.test(
      value,
    )
  ) {
    fail('LANDING_UNSAFE', 'Landing contract contains private path or credential material.', {
      path,
    });
  }
}

function protocol(kind, value, protocolVersion = LANDING_PROTOCOL_VERSION) {
  try {
    assertProtocolArtifact(kind, value, { protocolVersion });
  } catch (cause) {
    fail('LANDING_CONTRACT_INVALID', `Invalid ${kind} contract.`, {
      cause: cause.code ?? cause.message,
    });
  }
}

function selfHash(record, field) {
  const { [field]: claimed, ...body } = record;
  const expected = sha256Jcs(body);
  if (!HASH.test(claimed ?? '') || expected !== claimed)
    fail('LANDING_DIGEST_MISMATCH', `${field} does not bind the exact canonical record.`, {
      expected,
      actual: claimed ?? null,
    });
}

function equal(left, right, label) {
  if (sha256Jcs(left) !== sha256Jcs(right))
    fail('LANDING_BINDING_MISMATCH', `${label} changed.`, { left, right });
}

function equalValue(left, right) {
  return sha256Jcs(left) === sha256Jcs(right);
}

function assertRecordRef(ref, records, label) {
  const identity = RECORD_IDENTITY[ref.contractId];
  if (identity === undefined)
    fail('LANDING_BASE_RECORD_MISMATCH', `${label} uses an unsupported contract identity.`);
  const matches = (records ?? []).filter(
    (record) =>
      record?.kind === ref.contractId &&
      identity(record) === ref.recordId &&
      sha256Jcs(record) === ref.recordDigest,
  );
  if (matches.length !== 1)
    fail('LANDING_BASE_RECORD_MISMATCH', `${label} requires exactly one canonical base record.`, {
      recordId: ref.recordId,
      matches: matches.length,
    });
  const [match] = matches;
  protocol(ref.contractId, match, ref.protocolVersion);
  const digest = sha256Jcs(match);
  if (digest !== ref.recordDigest)
    fail('LANDING_BASE_RECORD_MISMATCH', `${label} bytes do not match the bound digest.`, {
      expected: ref.recordDigest,
      actual: digest,
    });
  return match;
}

function assertDag(operations) {
  const byId = new Map();
  for (const operation of operations) {
    if (byId.has(operation.operationId))
      fail('LANDING_DAG_INVALID', 'Landing operation identities must be unique.', {
        operationId: operation.operationId,
      });
    byId.set(operation.operationId, operation);
  }
  for (const operation of operations)
    for (const dependency of operation.dependsOn) {
      if (!byId.has(dependency) || dependency === operation.operationId)
        fail('LANDING_DAG_INVALID', 'Landing dependency is missing or self-referential.', {
          operationId: operation.operationId,
          dependency,
        });
    }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id))
      fail('LANDING_DAG_INVALID', 'Landing operation DAG contains a cycle.', { operationId: id });
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
  const completed = new Set();
  const canonical = [];
  while (canonical.length < operations.length) {
    const ready = operations
      .filter(
        ({ operationId, dependsOn }) =>
          !completed.has(operationId) && dependsOn.every((dependency) => completed.has(dependency)),
      )
      .map(({ operationId }) => operationId)
      .sort((left, right) => left.localeCompare(right));
    if (ready.length === 0)
      fail('LANDING_DAG_INVALID', 'Landing operation DAG has no deterministic next operation.');
    canonical.push(ready[0]);
    completed.add(ready[0]);
  }
  return canonical;
}

function operationPreconditions(plan, operation) {
  const byHash = new Map();
  for (const precondition of plan.preconditions) {
    if (byHash.has(precondition.proofHash))
      fail('LANDING_BINDING_MISMATCH', 'Landing precondition proof identities must be unique.', {
        proofHash: precondition.proofHash,
      });
    byHash.set(precondition.proofHash, precondition);
  }
  const selected = operation.preconditionHashes.map((proofHash) => {
    const precondition = byHash.get(proofHash);
    if (precondition === undefined)
      fail(
        'LANDING_BASE_RECORD_MISMATCH',
        'Operation precondition is not an exact mandatory plan proof.',
        { operationId: operation.operationId, proofHash },
      );
    return precondition;
  });
  return selected.sort((left, right) => left.proofHash.localeCompare(right.proofHash));
}

function expectedOperationInputDigest(operation, refsByKind, executor) {
  const governed = refsByKind.get('operating-governed-operation');
  if (governed !== undefined)
    return sha256Jcs({
      action: governed.action,
      target: governed.target,
      capability: governed.capability,
    });
  if (['canary', 'verify'].includes(operation.kind)) {
    return sha256Jcs({
      executor,
      verificationPlan: refsByKind.get('operating-action-verification-plan'),
      checkpoint: refsByKind.get('operating-checkpoint'),
    });
  }
  return sha256Jcs({
    executor,
    rollbackPlan: refsByKind.get('operating-rollback-plan'),
    rollbackResult: refsByKind.get('operating-rollback-result'),
  });
}

function expectedDocket(plan, operation, confirmation) {
  const preconditions = operationPreconditions(plan, operation);
  const providerHashes = preconditions
    .filter(({ kind }) => kind === 'provider-available')
    .map(({ proofHash }) => proofHash);
  const canaryHashes = preconditions
    .filter(({ kind }) => kind === 'canary-ready')
    .map(({ proofHash }) => proofHash);
  if (canaryHashes.length > 1)
    fail(
      'LANDING_BINDING_MISMATCH',
      'One operation cannot bind multiple competing canary policies.',
    );
  const effectSet = [EFFECT_BY_OPERATION[operation.kind]];
  return {
    sourceReceiptHash: plan.shipClosure.receiptHash,
    candidateDigest: plan.candidateDigest,
    targetHash: operation.targetBeforeHash,
    currentTargetHash: operation.targetBeforeHash,
    operationIds: [operation.operationId],
    effectSet,
    inputDigest: operation.inputDigest,
    providerPreconditionHashes: providerHashes,
    sensitivity: SENSITIVITY_BY_EFFECT[operation.effectClass],
    consequences: [
      `Execute ${operation.kind} with ${operation.effectClass} effects and ${operation.recoveryClass} recovery.`,
    ],
    recoveryClass: operation.recoveryClass,
    canaryPolicyHash: canaryHashes[0] ?? null,
    containmentPolicyHash: operation.containment?.policyHash ?? null,
    expiresAt: confirmation.expiresAt,
    changedStateDiffHash: sha256Jcs({
      targetBeforeHash: operation.targetBeforeHash,
      inputDigest: operation.inputDigest,
      preconditionHashes: [...operation.preconditionHashes].sort(),
    }),
    authorityBoundary: 'portable-confirmation-is-not-effect-authority',
    choices: ['confirm', 'cancel'],
    defaultChoice: null,
    cancelEffect: 'none',
  };
}

export function assertLandingOperationRegistry(registry) {
  protocol('landing-operation-registry', registry);
  safePortable(registry);
  selfHash(registry, 'registryHash');
  let previous = null;
  const identities = new Set();
  for (const operation of registry.operations) {
    const { registrationHash, ...body } = operation;
    if (sha256Jcs(body) !== registrationHash)
      fail('LANDING_DIGEST_MISMATCH', 'Landing operation registration changed.', {
        operationId: operation.operationId,
      });
    const identity = `${operation.operationId}@${operation.operationVersion}`;
    if (identities.has(identity) || (previous !== null && identity.localeCompare(previous) <= 0))
      fail(
        'LANDING_REGISTRY_INVALID',
        'Landing operation registry must be unique and canonically ordered.',
        { identity },
      );
    identities.add(identity);
    previous = identity;
    if (operation.portableAuthority !== 'none' || operation.runtimeAdapterRequired !== true)
      fail(
        'LANDING_AUTHORITY_INVALID',
        'Portable operation registration cannot grant an effect capability.',
      );
  }
  return freeze(clone(registry));
}

export function assertLandingPlan(
  plan,
  {
    shipReceipt,
    shipProjection,
    operationRegistry,
    baseRecords = [],
    activeSuccessor = false,
  } = {},
) {
  protocol('landing-plan', plan);
  safePortable(plan);
  selfHash(plan, 'planHash');
  if (plan.authority !== 'none')
    fail('LANDING_AUTHORITY_INVALID', 'A landing plan is never effect authority.');
  if (activeSuccessor)
    fail(
      'LANDING_SHIP_RECEIPT_SUPERSEDED',
      'A SHIP receipt with an active successor cannot enter landing.',
    );
  const canonicalOperationIds = assertDag(plan.operations);
  if (
    !equalValue(
      plan.operations.map(({ operationId }) => operationId),
      canonicalOperationIds,
    )
  ) {
    fail('LANDING_DAG_INVALID', 'Landing operations must use the canonical topological order.', {
      expected: canonicalOperationIds,
      actual: plan.operations.map(({ operationId }) => operationId),
    });
  }
  if (
    shipReceipt === undefined ||
    shipProjection === undefined ||
    operationRegistry === undefined ||
    baseRecords.length === 0
  ) {
    fail(
      'LANDING_BASE_RECORD_MISMATCH',
      'Landing plan validation requires exact SHIP projection, registry, and base-record custody.',
    );
  }
  {
    let normalizedReceipt;
    try {
      normalizedReceipt = assertShipClosure(shipReceipt);
    } catch (cause) {
      fail(
        'LANDING_SHIP_RECEIPT_INVALID',
        'Landing requires an authoritative terminal PASS SHIP receipt.',
        { cause: cause.code ?? cause.message },
      );
    }
    if (
      normalizedReceipt.recordType !== 'receipt' ||
      normalizedReceipt.state !== 'passed' ||
      normalizedReceipt.terminal?.status !== 'passed' ||
      normalizedReceipt.protocolVersion !== '1.1.0' ||
      !['1.0.0', '1.1.0', '1.2.0'].includes(normalizedReceipt.schemaVersion) ||
      normalizedReceipt.schemaVersion !== plan.shipClosure.schemaVersion ||
      normalizedReceipt.receiptHash !== plan.shipClosure.receiptHash ||
      sha256Jcs(normalizedReceipt) !== plan.shipClosure.recordDigest ||
      normalizedReceipt.runId !== plan.shipClosure.runId
    )
      fail(
        'LANDING_SHIP_RECEIPT_INVALID',
        'Landing requires the exact supported terminal PASS SHIP receipt.',
      );
    let projectionVerified = false;
    try {
      projectionVerified = verifyShipCompatibilityProjection(normalizedReceipt, shipProjection);
    } catch (cause) {
      fail(
        'LANDING_SHIP_RECEIPT_INVALID',
        'Landing could not verify the authoritative SHIP compatibility projection.',
        { cause: cause.code ?? cause.message },
      );
    }
    if (!projectionVerified)
      fail(
        'LANDING_SHIP_RECEIPT_INVALID',
        'Landing requires the current authoritative SHIP compatibility projection.',
      );
    const candidate = normalizedReceipt.candidateRevisions.at(-1);
    if (
      candidate?.digest !== plan.candidateDigest ||
      shipReceipt.terminal.candidateDigest !== plan.candidateDigest ||
      sha256Jcs(candidate.inventory) !== plan.candidateInventoryDigest
    )
      fail(
        'LANDING_CANDIDATE_MISMATCH',
        'Landing candidate inventory does not match the SHIP receipt.',
      );
    const projected = plan.repositories.map(
      ({ repositoryKey, head, baselineDigest, inventoryDigest }) => ({
        repositoryKey,
        head,
        baselineDigest,
        inventoryDigest,
      }),
    );
    equal(projected, candidate.repositories, 'Landing repository custody');
    for (const repository of plan.repositories) {
      const source = candidate.repositories.find(
        (entry) => entry.repositoryKey === repository.repositoryKey,
      );
      if (source === undefined)
        fail(
          'LANDING_CANDIDATE_MISMATCH',
          'Landing repository is absent from the authoritative SHIP projection.',
          { repositoryKey: repository.repositoryKey },
        );
      const projectionDigest = sha256Jcs({
        contractId: 'ship-compatibility-projection',
        schemaVersion: normalizedReceipt.schemaVersion,
        receiptHash: normalizedReceipt.receiptHash,
        recordDigest: sha256Jcs(normalizedReceipt),
        repository: source,
      });
      if (repository.projectionDigest !== projectionDigest) {
        fail('LANDING_CANDIDATE_MISMATCH', 'Landing repository projection digest changed.', {
          repositoryKey: repository.repositoryKey,
        });
      }
    }
    if (normalizedReceipt.feature !== plan.feature)
      fail('LANDING_CANDIDATE_MISMATCH', 'Landing feature does not match SHIP receipt.');
  }
  const registry = assertLandingOperationRegistry(operationRegistry);
  const repositoryKeys = new Set(plan.repositories.map((repository) => repository.repositoryKey));
  const operationCustody = new Map();
  operationPreconditions(plan, {
    operationId: 'plan',
    preconditionHashes: plan.preconditions.map(({ proofHash }) => proofHash),
  });
  for (const operation of plan.operations) {
    if (!repositoryKeys.has(operation.repositoryKey))
      fail('LANDING_CANDIDATE_MISMATCH', 'Landing operation references an undeclared repository.', {
        operationId: operation.operationId,
      });
    const registration = registry.operations.find(
      (entry) => entry.operationId === operation.registryOperationId,
    );
    if (
      registration === undefined ||
      registration.registrationHash !== operation.registrationHash ||
      registration.kind !== operation.kind ||
      registration.effectClass !== operation.effectClass ||
      registration.recoveryClass !== operation.recoveryClass
    )
      fail(
        'LANDING_REGISTRY_INVALID',
        'Landing operation does not match its frozen registration.',
        { operationId: operation.operationId },
      );
    const executor = assertRecordRef(
      operation.executorRegistration,
      baseRecords,
      'Executor registration',
    );
    const refsByKind = new Map();
    for (const ref of operation.operateBindings) {
      if (
        refsByKind.has(ref.contractId) ||
        !registration.compatibleOperateContracts.includes(ref.contractId)
      ) {
        fail(
          'LANDING_BINDING_MISMATCH',
          'Landing operation has duplicate or registry-incompatible Operate custody.',
          { operationId: operation.operationId, contractId: ref.contractId },
        );
      }
      refsByKind.set(ref.contractId, assertRecordRef(ref, baseRecords, ref.contractId));
    }
    for (const required of REQUIRED_BINDINGS[operation.kind] ?? []) {
      if (!refsByKind.has(required))
        fail('LANDING_BINDING_MISMATCH', `${operation.kind} requires exact ${required} custody.`);
    }
    operationPreconditions(plan, operation);
    const governed = refsByKind.get('operating-governed-operation');
    if (governed !== undefined) {
      if (
        governed.effectClass !== operation.effectClass ||
        governed.executor.executorId !== executor.executorId ||
        governed.executor.executorVersion !== executor.executorVersion ||
        !executor.capabilities.some((entry) => equalValue(entry, governed.capability)) ||
        !executor.supportedTargetKinds.includes(governed.target.kind)
      ) {
        fail(
          'LANDING_BINDING_MISMATCH',
          'Landing operation changed governed executor, action, target, capability, or effect custody.',
          { operationId: operation.operationId },
        );
      }
    }
    const rollback = refsByKind.get('operating-rollback-plan');
    if (
      rollback !== undefined &&
      governed !== undefined &&
      (rollback.operationId !== governed.operationId ||
        rollback.effectClass !== governed.effectClass ||
        !equalValue(rollback.executor, governed.executor) ||
        !equalValue(rollback.capability, governed.capability))
    ) {
      fail(
        'LANDING_BINDING_MISMATCH',
        'Landing rollback plan changed governed operation custody.',
        { operationId: operation.operationId },
      );
    }
    const verification = refsByKind.get('operating-action-verification-plan');
    if (
      verification !== undefined &&
      governed !== undefined &&
      verification.actionId !== governed.action.actionId
    ) {
      fail(
        'LANDING_BINDING_MISMATCH',
        'Landing verification plan changed governed Action custody.',
        { operationId: operation.operationId },
      );
    }
    const rollbackResult = refsByKind.get('operating-rollback-result');
    if (
      rollbackResult !== undefined &&
      (rollback === undefined ||
        rollbackResult.rollbackPlanId !== rollback.rollbackPlanId ||
        rollbackResult.originalOperationId !== rollback.operationId ||
        rollbackResult.effectClass !== rollback.effectClass ||
        !equalValue(rollbackResult.executor, rollback.executor) ||
        !equalValue(rollbackResult.capability, rollback.capability))
    ) {
      fail(
        'LANDING_BINDING_MISMATCH',
        'Landing recovery operation changed its exact rollback result or plan custody.',
        { operationId: operation.operationId },
      );
    }
    if (operation.inputDigest !== expectedOperationInputDigest(operation, refsByKind, executor)) {
      fail(
        'LANDING_BINDING_MISMATCH',
        'Landing operation inputDigest is not derived from its exact canonical execution custody.',
        { operationId: operation.operationId },
      );
    }
    if (
      operation.kind === 'deploy' &&
      (operation.containment === null ||
        operation.containment.state !== 'preconfirmed' ||
        operation.containment.authority !== 'containment-only')
    )
      fail(
        'LANDING_CONTAINMENT_REQUIRED',
        'Deploy cannot start without a preconfirmed immediate containment policy.',
      );
    operationCustody.set(operation.operationId, { governed, rollback });
  }
  for (const operation of plan.operations.filter(({ kind }) =>
    ['rollback', 'compensate'].includes(kind),
  )) {
    const rollback = operationCustody.get(operation.operationId)?.rollback;
    const sources = plan.operations.filter(
      (candidate) =>
        operation.dependsOn.includes(candidate.operationId) &&
        operationCustody.get(candidate.operationId)?.governed?.operationId ===
          rollback?.operationId,
    );
    if (
      rollback === undefined ||
      !['eligible', 'required'].includes(rollback.eligibility) ||
      sources.length !== 1 ||
      sources[0].recoveryClass === 'irreversible'
    ) {
      fail(
        'LANDING_RECOVERY_INVALID',
        'Landing recovery must bind exactly one non-irreversible dependency and its exact eligible rollback plan.',
        { operationId: operation.operationId },
      );
    }
  }
  return freeze(clone(plan));
}

export function assertLandingConfirmation(
  confirmation,
  {
    plan,
    shipReceipt,
    shipProjection,
    operationRegistry,
    baseRecords = [],
    activeSuccessor = false,
  } = {},
) {
  protocol('landing-confirmation', confirmation);
  safePortable(confirmation);
  selfHash(confirmation, 'confirmationHash');
  if (
    confirmation.authority !== 'none' ||
    confirmation.docket.defaultChoice !== null ||
    confirmation.docket.cancelEffect !== 'none'
  )
    fail(
      'LANDING_AUTHORITY_INVALID',
      'Portable confirmation and its neutral docket cannot grant effect authority or preselect a choice.',
    );
  if (sha256Jcs(confirmation.docket) !== confirmation.docketHash)
    fail('LANDING_DIGEST_MISMATCH', 'Landing confirmation docket bytes changed.');
  if (plan === undefined)
    fail(
      'LANDING_BASE_RECORD_MISMATCH',
      'Landing confirmation requires its exact plan and source custody.',
    );
  const normalized = assertLandingPlan(plan, {
    shipReceipt,
    shipProjection,
    operationRegistry,
    baseRecords,
    activeSuccessor,
  });
  if (
    normalized.planId !== confirmation.planId ||
    normalized.planHash !== confirmation.planHash ||
    normalized.shipClosure.receiptHash !== confirmation.shipReceiptHash
  )
    fail(
      'LANDING_BINDING_MISMATCH',
      'Landing confirmation does not bind the exact plan and SHIP receipt.',
    );
  if (confirmation.operationIds.length !== 1)
    fail('LANDING_BINDING_MISMATCH', 'One confirmation may authorize exactly one operation phase.');
  const operation = normalized.operations.find(
    (entry) => entry.operationId === confirmation.operationIds[0],
  );
  if (operation === undefined || operation.targetBeforeHash !== confirmation.currentTargetHash)
    fail('LANDING_TARGET_STALE', 'Landing confirmation target or operation changed.');
  const expectedEffectSet = [EFFECT_BY_OPERATION[operation.kind]];
  if (
    !equalValue(confirmation.operationIds, [operation.operationId]) ||
    !equalValue(confirmation.effectSet, expectedEffectSet) ||
    !equalValue(confirmation.docket.operationIds, [operation.operationId]) ||
    !equalValue(confirmation.docket.effectSet, expectedEffectSet) ||
    !equalValue(confirmation.docket, expectedDocket(normalized, operation, confirmation))
  ) {
    fail(
      'LANDING_BINDING_MISMATCH',
      'Landing confirmation docket changed operation, effect, target, input, precondition, or recovery custody.',
    );
  }
  if (!(Date.parse(confirmation.issuedAt) < Date.parse(confirmation.expiresAt)))
    fail('LANDING_CONFIRMATION_EXPIRED', 'Landing confirmation expiry is invalid.');
  return freeze(clone(confirmation));
}

export function assertLandingEvent(event) {
  protocol('landing-event', event);
  safePortable(event);
  selfHash(event, 'eventHash');
  const rule = LANDING_EVENT_RULES[event.type];
  if (
    rule === undefined ||
    !rule.from.includes(event.fromState) ||
    event.toState !== rule.to ||
    !rule.actors.includes(event.actor.kind) ||
    (rule.operation ? event.operationId === null : event.operationId !== null) ||
    (rule.confirmation ? event.confirmationHash === null : event.confirmationHash !== null)
  ) {
    fail(
      'LANDING_TRANSITION_INVALID',
      'Landing Event type, state, actor, operation, or confirmation is not legal.',
      { type: event.type },
    );
  }
  if (
    event.type === 'recovery.required' &&
    (event.toState !== 'recovery_required' ||
      event.trafficStateHash === null ||
      event.residualStateHash === null)
  )
    fail(
      'LANDING_RECOVERY_INVALID',
      'Recovery-required Event must retain traffic and residual state.',
    );
  if (
    [
      'containment.applied',
      'recovery.required',
      'recovery.confirmed',
      'recovery.succeeded',
      'recovery.failed',
    ].includes(event.type)
  ) {
    if (event.trafficStateHash === null || event.residualStateHash === null)
      fail(
        'LANDING_RECOVERY_INVALID',
        'Containment/recovery Event requires traffic and residual custody.',
      );
  } else if (event.trafficStateHash !== null || event.residualStateHash !== null) {
    fail('LANDING_RECOVERY_INVALID', 'Ordinary landing Event cannot claim recovery custody.');
  }
  return freeze(clone(event));
}

export function createLandingEventState() {
  return freeze({
    runId: null,
    state: 'planned',
    planHash: null,
    targetStateHash: null,
    currentOperationId: null,
    currentConfirmationHash: null,
    currentRequestHash: null,
    completedOperationIds: [],
    eventHead: { sequence: 0, hash: null },
    eventReplayIndex: [],
  });
}

export function reduceLandingEvents(events, { initialState = createLandingEventState() } = {}) {
  if (!Array.isArray(events))
    fail('LANDING_TRANSITION_INVALID', 'Landing reducer requires an ordered Event array.');
  const state = clone(initialState);
  const replay = new Map(state.eventReplayIndex.map((entry) => [entry.eventId, entry.eventHash]));
  for (const value of events) {
    const event = assertLandingEvent(value);
    const prior = replay.get(event.eventId);
    if (prior !== undefined) {
      if (prior !== event.eventHash)
        fail('LANDING_REPLAY_CONFLICT', 'Landing Event identity was reused with divergent bytes.', {
          eventId: event.eventId,
        });
      continue;
    }
    if (['completed', 'blocked'].includes(state.state))
      fail('LANDING_TRANSITION_INVALID', 'Terminal landing state is immutable.', {
        state: state.state,
      });
    if (
      event.sequence !== state.eventHead.sequence + 1 ||
      event.previousEventHash !== state.eventHead.hash ||
      event.fromState !== state.state
    )
      fail(
        'LANDING_CONCURRENT_MODIFICATION',
        'Landing Event sequence, predecessor, or state is stale.',
      );
    if (state.runId === null) {
      if (event.type !== 'plan.created')
        fail('LANDING_TRANSITION_INVALID', 'Landing journal must begin with plan.created.');
      state.runId = event.runId;
      state.planHash = event.planHash;
      state.targetStateHash = event.targetStateHash;
    } else if (event.runId !== state.runId || event.planHash !== state.planHash) {
      fail('LANDING_BINDING_MISMATCH', 'Landing Event changed run or plan custody.');
    }
    if (event.type === 'phase.intent-recorded') {
      if (event.targetStateHash !== state.targetStateHash)
        fail('LANDING_TARGET_STALE', 'Phase intent target is stale.');
      if (state.completedOperationIds.includes(event.operationId))
        fail(
          'LANDING_REPLAY_CONFLICT',
          'A completed landing operation cannot be dispatched again.',
          { operationId: event.operationId },
        );
      state.currentOperationId = event.operationId;
      state.currentConfirmationHash = event.confirmationHash;
      state.currentRequestHash = event.requestHash;
    } else if (event.type === 'recovery.confirmed') {
      if (
        event.operationId === state.currentOperationId ||
        event.requestHash === state.currentRequestHash ||
        event.confirmationHash === state.currentConfirmationHash ||
        event.targetStateHash !== state.targetStateHash
      ) {
        fail(
          'LANDING_BINDING_MISMATCH',
          'Recovery confirmation must select a separate recovery operation, request, and fresh confirmation.',
        );
      }
      state.currentOperationId = event.operationId;
      state.currentRequestHash = event.requestHash;
      state.currentConfirmationHash = event.confirmationHash;
    } else if (
      [
        'phase.dispatching',
        'phase.succeeded',
        'phase.failed',
        'phase.blocked',
        'phase.uncertain',
        'containment.applied',
        'recovery.succeeded',
        'recovery.failed',
      ].includes(event.type)
    ) {
      if (
        event.operationId !== state.currentOperationId ||
        event.requestHash !== state.currentRequestHash ||
        event.confirmationHash !== state.currentConfirmationHash ||
        (![
          'phase.succeeded',
          'phase.failed',
          'phase.uncertain',
          'containment.applied',
          'recovery.succeeded',
          'recovery.failed',
        ].includes(event.type) &&
          event.targetStateHash !== state.targetStateHash)
      ) {
        fail(
          'LANDING_BINDING_MISMATCH',
          'Landing phase Event changed operation, confirmation, request, or target custody.',
        );
      }
    } else if (event.type === 'recovery.required') {
      if (
        event.operationId !== state.currentOperationId ||
        event.requestHash !== state.currentRequestHash
      )
        fail('LANDING_BINDING_MISMATCH', 'Recovery Event changed phase custody.');
    } else if (
      ['landing.completed', 'landing.blocked'].includes(event.type) &&
      (state.currentOperationId !== null || event.targetStateHash !== state.targetStateHash)
    ) {
      fail(
        'LANDING_TRANSITION_INVALID',
        'Landing cannot terminalize with an active phase or changed target.',
      );
    }
    if (event.type === 'landing.completed' && state.completedOperationIds.length === 0) {
      fail(
        'LANDING_TRANSITION_INVALID',
        'Landing cannot complete before at least one exact phase outcome.',
      );
    }
    state.state = event.toState;
    state.targetStateHash = event.targetStateHash;
    if (
      [
        'phase.succeeded',
        'phase.failed',
        'phase.blocked',
        'recovery.succeeded',
        'recovery.failed',
      ].includes(event.type)
    ) {
      if (['phase.succeeded', 'recovery.succeeded'].includes(event.type))
        state.completedOperationIds.push(event.operationId);
      state.currentOperationId = null;
      state.currentConfirmationHash = null;
      state.currentRequestHash = null;
    }
    state.eventHead = { sequence: event.sequence, hash: event.eventHash };
    state.eventReplayIndex.push({ eventId: event.eventId, eventHash: event.eventHash });
    replay.set(event.eventId, event.eventHash);
  }
  return freeze(state);
}

function assertPhaseEventCustody(receipt, operation, confirmation, events) {
  if (!Array.isArray(events) || events.length === 0)
    fail('LANDING_BASE_RECORD_MISMATCH', 'Phase receipt requires its exact Landing Event journal.');
  const normalized = events.map(assertLandingEvent);
  const requestEvents = normalized.filter(
    (event) =>
      event.operationId === receipt.operationId && event.requestHash === receipt.requestHash,
  );
  const recoveryOperation = ['rollback', 'compensate'].includes(operation.kind);
  const intentType = recoveryOperation ? 'recovery.confirmed' : 'phase.intent-recorded';
  const outcomeType =
    receipt.status === 'succeeded'
      ? recoveryOperation
        ? 'recovery.succeeded'
        : 'phase.succeeded'
      : receipt.status === 'failed'
        ? recoveryOperation
          ? 'recovery.failed'
          : 'phase.failed'
        : receipt.status === 'blocked'
          ? 'phase.blocked'
          : receipt.status === 'uncertain'
            ? 'phase.uncertain'
            : 'recovery.required';
  const intents = requestEvents.filter(({ type }) => type === intentType);
  const dispatches = requestEvents.filter(({ type }) => type === 'phase.dispatching');
  const outcomes = requestEvents.filter(({ type }) => type === outcomeType);
  if (intents.length !== 1 || dispatches.length !== 1 || outcomes.length !== 1) {
    fail(
      'LANDING_BINDING_MISMATCH',
      'Phase receipt requires exactly one intent, dispatch, and matching outcome Event.',
      {
        operationId: receipt.operationId,
        intentType,
        outcomeType,
      },
    );
  }
  const [intent] = intents;
  const [dispatch] = dispatches;
  const [outcome] = outcomes;
  if (
    intent.confirmationHash !== confirmation.confirmationHash ||
    dispatch.confirmationHash !== confirmation.confirmationHash ||
    (outcome.type !== 'recovery.required' &&
      outcome.confirmationHash !== confirmation.confirmationHash) ||
    intent.targetStateHash !== receipt.targetBeforeHash ||
    dispatch.targetStateHash !== receipt.targetBeforeHash ||
    outcome.targetStateHash !== (receipt.targetAfterHash ?? receipt.targetBeforeHash) ||
    intent.timestamp !== receipt.startedAt ||
    dispatch.timestamp !== receipt.confirmation.consumedAt ||
    outcome.timestamp !== receipt.completedAt
  ) {
    fail(
      'LANDING_BINDING_MISMATCH',
      'Phase receipt changed Event confirmation, target, or time custody.',
      { operationId: receipt.operationId },
    );
  }
  if (receipt.status === 'recovery_required') {
    const containment = requestEvents.filter(({ type }) => type === 'containment.applied');
    if (
      containment.length !== 1 ||
      receipt.containment === null ||
      receipt.recovery === null ||
      containment[0].trafficStateHash !== receipt.containment.trafficStateHash ||
      containment[0].residualStateHash !== receipt.containment.residualStateHash ||
      outcome.trafficStateHash !== receipt.recovery.trafficStateHash ||
      outcome.residualStateHash !== receipt.recovery.residualStateHash
    ) {
      fail(
        'LANDING_RECOVERY_INVALID',
        'Recovery-required phase receipt changed containment or recovery Event custody.',
      );
    }
  }
  return { intent, dispatch, outcome };
}

function recoveryContainmentPolicy(plan, operation) {
  if (operation.kind === 'deploy') return operation.containment;
  if (operation.kind !== 'canary') {
    fail(
      'LANDING_RECOVERY_INVALID',
      'Only a deploy or its directly bound canary may enter recovery_required.',
    );
  }
  const dependencies = plan.operations.filter(({ operationId }) =>
    operation.dependsOn.includes(operationId),
  );
  if (
    operation.dependsOn.length !== 1 ||
    dependencies.length !== 1 ||
    dependencies[0].kind !== 'deploy' ||
    dependencies[0].containment === null
  ) {
    fail(
      'LANDING_CONTAINMENT_REQUIRED',
      'Recovery-required canary must depend on exactly one deploy with frozen containment.',
    );
  }
  return dependencies[0].containment;
}

function assertExactRecoveryPolicy(receipt, policy) {
  if (
    policy === null ||
    receipt.containment.policyHash !== policy.policyHash ||
    receipt.containment.stopPromotion !== policy.stopPromotion ||
    receipt.containment.stopNewTraffic !== policy.stopNewTraffic ||
    receipt.containment.failedTargetIsolated !== policy.isolateFailedTarget ||
    receipt.containment.lastKnownGoodRetained !== policy.retainLastKnownGood ||
    receipt.containment.trafficStateHash !== policy.trafficStateHash ||
    receipt.containment.residualStateHash !== policy.residualStateHash ||
    receipt.recovery.trafficStateHash !== policy.trafficStateHash ||
    receipt.recovery.residualStateHash !== policy.residualStateHash ||
    receipt.recovery.expiresAt !== policy.expiresAt ||
    !equalValue(receipt.recovery.consequences, policy.consequences) ||
    !equalValue(receipt.recovery.choices, policy.recoveryChoices)
  ) {
    fail(
      'LANDING_CONTAINMENT_REQUIRED',
      'Recovery changed its dependency deploy frozen containment policy.',
    );
  }
}

export function assertLandingPhaseReceipt(
  receipt,
  {
    confirmation,
    plan,
    shipReceipt,
    shipProjection,
    operationRegistry,
    baseRecords = [],
    evidenceRecords = [],
    evidenceContexts = {},
    events = [],
    activeSuccessor = false,
  } = {},
) {
  protocol('landing-phase-receipt', receipt);
  safePortable(receipt);
  selfHash(receipt, 'receiptHash');
  if (
    confirmation === undefined ||
    plan === undefined ||
    shipReceipt === undefined ||
    operationRegistry === undefined
  ) {
    fail(
      'LANDING_BASE_RECORD_MISMATCH',
      'Phase receipt requires exact confirmation, plan, SHIP, registry, and base custody.',
    );
  }
  const normalizedPlan = assertLandingPlan(plan, {
    shipReceipt,
    shipProjection,
    operationRegistry,
    baseRecords,
    activeSuccessor,
  });
  const operation = normalizedPlan.operations.find(
    (entry) => entry.operationId === receipt.operationId,
  );
  if (operation === undefined)
    fail('LANDING_BINDING_MISMATCH', 'Phase receipt operation is not in the landing plan.');
  const proof = assertLandingConfirmation(confirmation, {
    plan: normalizedPlan,
    shipReceipt,
    shipProjection,
    operationRegistry,
    baseRecords,
    activeSuccessor,
  });
  equal(
    [proof.confirmationId, proof.confirmationHash, proof.opaqueCapabilityHash],
    [
      receipt.confirmation.confirmationId,
      receipt.confirmation.confirmationHash,
      receipt.confirmation.opaqueCapabilityHash,
    ],
    'Consumed landing confirmation',
  );
  if (
    !proof.operationIds.includes(receipt.operationId) ||
    Date.parse(receipt.confirmation.consumedAt) > Date.parse(proof.expiresAt) ||
    receipt.planId !== normalizedPlan.planId ||
    receipt.planHash !== normalizedPlan.planHash ||
    receipt.operationRegistrationHash !== operation.registrationHash ||
    receipt.effectClass !== operation.effectClass ||
    receipt.targetBeforeHash !== operation.targetBeforeHash ||
    receipt.requestHash !==
      sha256Jcs({
        planHash: normalizedPlan.planHash,
        operation,
        confirmationHash: proof.confirmationHash,
      })
  ) {
    fail(
      'LANDING_BINDING_MISMATCH',
      'Phase receipt changed plan, operation, target, effect, request, or confirmation custody.',
    );
  }
  const primaryKind = ['canary', 'verify'].includes(operation.kind)
    ? 'operating-action-verification-plan'
    : ['rollback', 'compensate'].includes(operation.kind)
      ? 'operating-rollback-plan'
      : 'operating-governed-operation';
  const primaryRef = operation.operateBindings.find((entry) => entry.contractId === primaryKind);
  if (
    primaryRef === undefined ||
    receipt.operateBinding === null ||
    !equalValue(receipt.operateBinding, primaryRef)
  ) {
    fail(
      'LANDING_BINDING_MISMATCH',
      'Phase receipt omitted or changed its primary Operate custody.',
    );
  }
  assertRecordRef(receipt.operateBinding, baseRecords, 'Phase Operate binding');
  const exactEvidenceHashes = evidenceRecords
    .map((entry) => {
      protocol(entry.kind, entry, entry.protocolVersion);
      const digest = sha256Jcs(entry);
      const context = evidenceContexts[digest];
      if (entry.kind === 'operating-outcome-evaluation') {
        if (context === undefined)
          fail(
            'LANDING_BASE_RECORD_MISMATCH',
            'Canary evaluation requires exact semantic input custody.',
          );
        assertOperatingOutcomeEvaluationV2(entry, context);
      } else if (entry.kind === 'operating-evidence-observation') {
        if (context === undefined)
          fail(
            'LANDING_BASE_RECORD_MISMATCH',
            'Canary observation requires exact semantic input custody.',
          );
        assertOperatingEvidenceObservationV2(entry, context);
      }
      return digest;
    })
    .sort();
  if (!equalValue([...receipt.evidenceHashes].sort(), exactEvidenceHashes))
    fail('LANDING_BASE_RECORD_MISMATCH', 'Phase evidence membership or bytes changed.');
  if (
    ['canary', 'verify'].includes(operation.kind) &&
    receipt.canary === null &&
    !['blocked', 'uncertain'].includes(receipt.status)
  ) {
    fail('LANDING_FALSE_PASS', 'Canary/verify phase requires exact evaluation evidence.');
  }
  if (
    ['blocked', 'uncertain'].includes(receipt.status) &&
    (receipt.canary !== null ||
      receipt.containment !== null ||
      receipt.recovery !== null ||
      receipt.evidenceHashes.length !== 0)
  ) {
    fail(
      'LANDING_FALSE_PASS',
      'No-effect reconciliation must remain an empty, non-authoritative blocked or uncertain receipt.',
    );
  }
  if (receipt.canary !== null) {
    const verification = assertRecordRef(primaryRef, baseRecords, 'Canary verification plan');
    const artifactRecords = evidenceRecords.filter((entry) => entry.kind === 'operating-artifact');
    const artifacts = artifactRecords.map(sha256Jcs).sort();
    const evaluations = evidenceRecords.filter(
      (entry) => entry.kind === 'operating-outcome-evaluation',
    );
    const observations = evidenceRecords.filter(
      (entry) => entry.kind === 'operating-evidence-observation',
    );
    const linkedArtifactIds = new Set(observations.map((entry) => entry.artifact.artifactId));
    const artifactIds = artifactRecords.map((entry) => entry.artifactId);
    const observationDigests = observations.map(sha256Jcs).sort();
    if (
      new Set(artifactIds).size !== artifactIds.length ||
      artifactIds.some((artifactId) => !linkedArtifactIds.has(artifactId)) ||
      linkedArtifactIds.size !== artifactIds.length
    ) {
      fail(
        'LANDING_FALSE_PASS',
        'Canary Artifact membership must be exactly the immutable Artifact set referenced by its observations.',
      );
    }
    for (const observation of observations) {
      const context = evidenceContexts[sha256Jcs(observation)];
      const artifact = artifactRecords.find(
        (entry) => entry.artifactId === observation.artifact.artifactId,
      );
      if (
        context?.artifact === undefined ||
        artifact === undefined ||
        sha256Jcs(context.artifact) !== sha256Jcs(artifact) ||
        observation.artifact.recordDigest !== sha256Jcs(artifact)
      ) {
        fail(
          'LANDING_BASE_RECORD_MISMATCH',
          'Canary observation does not bind its exact accepted Artifact custody.',
        );
      }
    }
    if (evaluations.length > 1)
      fail('LANDING_FALSE_PASS', 'One canary phase may bind exactly one deterministic evaluation.');
    if (evaluations.length === 1) {
      const evaluation = evaluations[0];
      const context = evidenceContexts[sha256Jcs(evaluation)];
      const evaluatedObservationDigests = (context?.evidenceObservations ?? [])
        .map(sha256Jcs)
        .sort();
      if (
        !equalValue(evaluatedObservationDigests, observationDigests) ||
        !equalValue(
          evaluation.observations.map(({ observationHash }) => observationHash).sort(),
          observations.map(({ observationHash }) => observationHash).sort(),
        ) ||
        receipt.canary.minimumEvidence !== evaluation.minimumEvidence ||
        receipt.canary.status !== evaluation.result
      ) {
        fail(
          'LANDING_FALSE_PASS',
          'Canary status and minimum evidence must come from its exact evaluation and observation set.',
        );
      }
    }
    const absenceHashes = [
      ...new Set([
        ...evaluations.flatMap((entry) => entry.absences),
        ...observations.flatMap((entry) => entry.absences.map((absence) => absence.detailsHash)),
      ]),
    ].sort();
    if (
      !equalValue([...receipt.canary.artifactHashes].sort(), artifacts) ||
      !equalValue([...receipt.canary.absenceHashes].sort(), absenceHashes) ||
      receipt.canary.windowHash !== sha256Jcs(verification.window) ||
      receipt.canary.thresholdHash !==
        sha256Jcs({ target: verification.target, evaluationRules: verification.evaluationRules })
    ) {
      fail(
        'LANDING_BINDING_MISMATCH',
        'Canary evidence, window, threshold, or absence custody changed.',
      );
    }
    if (
      receipt.canary.status === 'passed' &&
      (receipt.status !== 'succeeded' ||
        artifacts.length < receipt.canary.minimumEvidence ||
        absenceHashes.length > 0 ||
        evaluations.length !== 1 ||
        observations.length < receipt.canary.minimumEvidence ||
        evaluations.some((entry) => entry.result !== 'passed') ||
        observations.some((entry) => entry.status !== 'observed'))
    ) {
      fail(
        'LANDING_FALSE_PASS',
        'Canary cannot pass without exact passing evaluation and minimum immutable Artifact evidence.',
      );
    }
    if (receipt.canary.status !== 'passed' && receipt.status === 'succeeded')
      fail('LANDING_FALSE_PASS', 'Phase cannot succeed over a failed or insufficient canary.');
  }
  if (receipt.status === 'succeeded' && receipt.targetAfterHash === null)
    fail('LANDING_FALSE_PASS', 'Succeeded phase requires exact resulting target custody.');
  if (operation.kind === 'deploy' && receipt.status === 'failed') {
    fail(
      'LANDING_CONTAINMENT_REQUIRED',
      'A non-passing deploy must apply its frozen containment and enter recovery_required.',
    );
  }
  if (receipt.status === 'recovery_required') {
    if (
      receipt.containment === null ||
      receipt.recovery === null ||
      receipt.recovery.authority !== 'none' ||
      receipt.recovery.defaultChoice !== null ||
      receipt.containment.trafficStateHash !== receipt.recovery.trafficStateHash ||
      receipt.containment.residualStateHash !== receipt.recovery.residualStateHash
    )
      fail(
        'LANDING_RECOVERY_INVALID',
        'Recovery-required receipt must preserve exact containment and neutral recovery custody.',
      );
    if (operation.recoveryClass === 'irreversible') {
      fail(
        'LANDING_RECOVERY_INVALID',
        'Irreversible landing operations are forward-fix-only and cannot enter rollback recovery.',
      );
    }
    assertExactRecoveryPolicy(receipt, recoveryContainmentPolicy(normalizedPlan, operation));
  }
  assertPhaseEventCustody(receipt, operation, proof, events);
  return freeze(clone(receipt));
}

export function assertLandingReceipt(
  receipt,
  {
    shipReceipt,
    shipProjection,
    plan,
    operationRegistry,
    baseRecords = [],
    phaseReceipts = [],
    confirmations = [],
    evidenceRecordsByOperation = {},
    evidenceContextsByOperation = {},
    events = [],
    activeSuccessor = false,
  } = {},
) {
  protocol('landing-receipt', receipt);
  safePortable(receipt);
  selfHash(receipt, 'receiptHash');
  if (receipt.authority !== 'none')
    fail('LANDING_AUTHORITY_INVALID', 'Landing receipt cannot grant future authority.');
  if (
    shipReceipt === undefined ||
    plan === undefined ||
    operationRegistry === undefined ||
    events.length === 0
  ) {
    fail(
      'LANDING_BASE_RECORD_MISMATCH',
      'Landing receipt requires exact SHIP, plan, registry, phase, confirmation, and Event custody.',
    );
  }
  const normalizedPlan = assertLandingPlan(plan, {
    shipReceipt,
    shipProjection,
    operationRegistry,
    baseRecords,
    activeSuccessor,
  });
  if (
    normalizedPlan.planId !== receipt.planId ||
    normalizedPlan.planHash !== receipt.planHash ||
    normalizedPlan.candidateDigest !== receipt.candidateDigest ||
    normalizedPlan.candidateInventoryDigest !== receipt.candidateInventoryDigest ||
    !equalValue(receipt.shipClosure, normalizedPlan.shipClosure)
  ) {
    fail(
      'LANDING_BINDING_MISMATCH',
      'Landing receipt changed its source plan, SHIP, or candidate.',
    );
  }
  const expectedPhaseCount = receipt.phaseReceipts.length;
  if (
    phaseReceipts.length !== expectedPhaseCount ||
    confirmations.length !== expectedPhaseCount ||
    expectedPhaseCount > normalizedPlan.operations.length
  ) {
    fail(
      'LANDING_BINDING_MISMATCH',
      'Landing receipt must contain one exact phase/confirmation per completed or attempted operation.',
    );
  }
  let previousReceiptHash = null;
  const completed = new Set();
  const terminalStatus = new Map();
  const attempted = new Set();
  for (let index = 0; index < expectedPhaseCount; index += 1) {
    const ref = receipt.phaseReceipts[index];
    const operation = normalizedPlan.operations.find(
      ({ operationId }) => operationId === ref.operationId,
    );
    if (operation === undefined || attempted.has(operation.operationId)) {
      fail(
        'LANDING_BINDING_MISMATCH',
        'Landing receipt operation order is missing, duplicated, or foreign.',
      );
    }
    if (
      operation.dependsOn.some(
        (dependency) =>
          !completed.has(dependency) &&
          !(
            ['rollback', 'compensate'].includes(operation.kind) &&
            terminalStatus.get(dependency) === 'recovery_required'
          ),
      )
    ) {
      fail('LANDING_DAG_INVALID', 'Landing receipt phase order violates the operation DAG.', {
        operationId: operation.operationId,
      });
    }
    const candidates = phaseReceipts.filter((entry) => entry.operationId === operation.operationId);
    const proofs = confirmations.filter((entry) =>
      entry.operationIds.includes(operation.operationId),
    );
    if (candidates.length !== 1 || proofs.length !== 1)
      fail(
        'LANDING_BINDING_MISMATCH',
        'Landing phase or confirmation identity is missing or duplicated.',
        { operationId: operation.operationId },
      );
    const phase = assertLandingPhaseReceipt(candidates[0], {
      confirmation: proofs[0],
      plan: normalizedPlan,
      shipReceipt,
      operationRegistry,
      baseRecords,
      evidenceRecords: evidenceRecordsByOperation[operation.operationId] ?? [],
      evidenceContexts: evidenceContextsByOperation[operation.operationId] ?? {},
      events,
      shipProjection,
      activeSuccessor,
    });
    if (phase.previousReceiptHash !== previousReceiptHash)
      fail('LANDING_BINDING_MISMATCH', 'Landing phase receipt chain is not contiguous.', {
        operationId: operation.operationId,
      });
    if (
      !equalValue(ref, {
        receiptId: phase.receiptId,
        receiptHash: phase.receiptHash,
        operationId: phase.operationId,
        status: phase.status,
      })
    ) {
      fail(
        'LANDING_BINDING_MISMATCH',
        'Landing receipt changed a phase receipt or its canonical order.',
      );
    }
    previousReceiptHash = phase.receiptHash;
    attempted.add(operation.operationId);
    terminalStatus.set(operation.operationId, phase.status);
    if (phase.status === 'succeeded') completed.add(operation.operationId);
  }
  const journal = reduceLandingEvents(events);
  if (
    journal.runId !== receipt.runId ||
    journal.planHash !== receipt.planHash ||
    journal.eventHead.hash !== receipt.journalHeadHash ||
    journal.targetStateHash !== receipt.targetHash
  ) {
    fail(
      'LANDING_BINDING_MISMATCH',
      'Landing receipt changed its immutable Event journal or target head.',
    );
  }
  const expectedJournalState =
    receipt.status === 'landed'
      ? 'completed'
      : receipt.status === 'blocked'
        ? 'blocked'
        : receipt.status === 'uncertain'
          ? 'uncertain'
          : 'recovery_required';
  if (journal.state !== expectedJournalState)
    fail('LANDING_BINDING_MISMATCH', 'Landing receipt status disagrees with its Event journal.');
  const phaseOutcomeTypes = new Set([
    'phase.succeeded',
    'phase.failed',
    'phase.blocked',
    'phase.uncertain',
    'recovery.required',
    'recovery.succeeded',
    'recovery.failed',
  ]);
  const journalOutcomes = events.filter(
    (event) =>
      phaseOutcomeTypes.has(event.type) &&
      !(
        event.type === 'phase.uncertain' &&
        events.some(
          (candidate) =>
            candidate.type === 'recovery.required' &&
            candidate.operationId === event.operationId &&
            candidate.requestHash === event.requestHash,
        )
      ),
  );
  if (
    journalOutcomes.length !== phaseReceipts.length ||
    journalOutcomes.some(
      (event) =>
        !phaseReceipts.some(
          (phase) =>
            phase.operationId === event.operationId && phase.requestHash === event.requestHash,
        ),
    )
  ) {
    fail(
      'LANDING_BINDING_MISMATCH',
      'Landing journal and phase receipts do not have reciprocal one-to-one outcome custody.',
    );
  }
  const lastPhase = phaseReceipts.at(-1) ?? null;
  if (
    lastPhase !== null &&
    receipt.targetHash !== (lastPhase.targetAfterHash ?? lastPhase.targetBeforeHash)
  ) {
    fail('LANDING_BINDING_MISMATCH', 'Landing target is not the exact last phase target.');
  }
  if (
    receipt.status === 'landed' &&
    (receipt.phaseReceipts.some((entry) => entry.status !== 'succeeded') ||
      phaseReceipts.some((entry) => entry.canary !== null && entry.canary.status !== 'passed') ||
      normalizedPlan.operations.some(
        (operation) =>
          !['rollback', 'compensate'].includes(operation.kind) &&
          !completed.has(operation.operationId),
      ) ||
      phaseReceipts.some((phase) =>
        ['rollback', 'compensate'].includes(
          normalizedPlan.operations.find(({ operationId }) => operationId === phase.operationId)
            ?.kind,
        ),
      ))
  ) {
    fail(
      'LANDING_FALSE_PASS',
      'Landing cannot be terminal-success with a non-success phase or canary.',
    );
  }
  if (
    receipt.status === 'recovery_required' &&
    (receipt.recovery.required !== true ||
      receipt.recovery.defaultChoice !== null ||
      receipt.trafficStateHash === null ||
      receipt.residualStateHash === null ||
      lastPhase?.status !== 'recovery_required' ||
      lastPhase.containment?.trafficStateHash !== receipt.trafficStateHash ||
      lastPhase.containment?.residualStateHash !== receipt.residualStateHash ||
      lastPhase.recovery?.trafficStateHash !== receipt.trafficStateHash ||
      lastPhase.recovery?.residualStateHash !== receipt.residualStateHash)
  )
    fail(
      'LANDING_RECOVERY_INVALID',
      'Recovery-required landing receipt must retain neutral recovery and exact phase traffic/residual state.',
    );
  if (receipt.status === 'recovery_required') {
    const failedOperation = normalizedPlan.operations.find(
      ({ operationId }) => operationId === lastPhase?.operationId,
    );
    if (failedOperation === undefined || failedOperation.recoveryClass === 'irreversible') {
      fail(
        'LANDING_RECOVERY_INVALID',
        'Recovery-required landing must identify one non-irreversible failed operation.',
      );
    }
    const governedOperationIds = new Set(
      [
        failedOperation,
        ...normalizedPlan.operations.filter(({ operationId }) =>
          failedOperation.dependsOn.includes(operationId),
        ),
      ].flatMap(({ operateBindings }) =>
        operateBindings
          .filter(({ contractId }) => contractId === 'operating-governed-operation')
          .map(({ recordId }) => recordId),
      ),
    );
    const rollbackPlans = baseRecords.filter(
      (entry) =>
        entry.kind === 'operating-rollback-plan' &&
        governedOperationIds.has(entry.operationId) &&
        ['eligible', 'required'].includes(entry.eligibility),
    );
    if (rollbackPlans.length !== 1 || receipt.recovery.planHash !== rollbackPlans[0].planHash) {
      fail(
        'LANDING_RECOVERY_INVALID',
        'Recovery-required receipt must bind the failed operation to one exact eligible rollback plan without authorizing it.',
      );
    }
  }
  const recoveryPhases = phaseReceipts.filter((phase) => {
    const operation = normalizedPlan.operations.find(
      (entry) => entry.operationId === phase.operationId,
    );
    return ['rollback', 'compensate'].includes(operation?.kind);
  });
  if (recoveryPhases.length > 0) {
    const recoveryOperation = normalizedPlan.operations.find(
      (entry) => entry.operationId === recoveryPhases.at(-1).operationId,
    );
    const rollbackPlanRef = recoveryOperation.operateBindings.find(
      ({ contractId }) => contractId === 'operating-rollback-plan',
    );
    const rollbackResultRef = recoveryOperation.operateBindings.find(
      ({ contractId }) => contractId === 'operating-rollback-result',
    );
    const rollbackPlan = assertRecordRef(rollbackPlanRef, baseRecords, 'Landing recovery plan');
    const rollbackResult = assertRecordRef(
      rollbackResultRef,
      baseRecords,
      'Landing recovery result',
    );
    if (
      receipt.recovery.planHash !== rollbackPlan.planHash ||
      receipt.recovery.resultHash !== rollbackResult.resultHash
    ) {
      fail(
        'LANDING_RECOVERY_INVALID',
        'Landing receipt changed the separately confirmed recovery plan or result.',
      );
    }
  } else if (
    receipt.status !== 'recovery_required' &&
    (receipt.recovery.planHash !== null || receipt.recovery.resultHash !== null)
  ) {
    fail(
      'LANDING_RECOVERY_INVALID',
      'Landing receipt cannot claim recovery custody without a recovery phase.',
    );
  }
  return freeze(clone(receipt));
}
