import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import {
  assertProtocolArtifact,
  findOperateCoreProhibitionV2,
} from '@openplanr/protocol/contracts';
import { PipelineError } from '@openplanr/protocol/errors';
import { assertOperateAuthorityV2 } from './authorization-v2.mjs';
import {
  assertContainedExecutorInputEnvelopeV2,
  assertTrustedExecutorBindingV2,
  OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
  selectOperateCapabilityProviderV2,
  selectOperatePolicyProviderV2,
} from './governed-extensions-v2.mjs';
import { evaluateOperatingActionPolicyV2 } from './policy-v2.mjs';

const PROTOCOL_VERSION = '2.0.0';
const PROJECT_TARGETS = new WeakSet();
const SYNTHETIC_TARGETS = new WeakSet();
const TARGET_METADATA = new WeakMap();
const REFERENCE_HOSTS = new WeakMap();
const REFERENCE_HOST_DECLARATIONS = Object.freeze([
  Object.freeze({
    executorId: 'open-reference-project-executor',
    executorVersion: '1.0.0',
    implementationId: 'open-reference-project-executor-v2',
    connector: Object.freeze({ id: 'disposable-local-project-connector', version: '1.0.0' }),
    synthetic: false,
  }),
  Object.freeze({
    executorId: 'open-reference-containment-executor',
    executorVersion: '1.0.0',
    implementationId: 'open-reference-containment-executor-v2',
    connector: Object.freeze({ id: 'synthetic-no-network-connector', version: '1.0.0' }),
    synthetic: true,
  }),
]);

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

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameIdentity(left, right) {
  return left?.id === right?.id && left?.version === right?.version;
}

function plainExactRecord(value, fields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  )
    return false;
  const keys = Object.getOwnPropertyNames(value).sort();
  const expected = [...fields].sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) =>
        Object.hasOwn(descriptor, 'value') &&
        descriptor.get === undefined &&
        descriptor.set === undefined,
    )
  );
}

function assertTime(value, field) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed))
    fail('OPERATING_PROVIDER_INPUT_INVALID', `${field} must be an explicit RFC 3339 timestamp.`, {
      field,
    });
  return parsed;
}

function assertReferenceData(value, path = '$', semanticPath = []) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    const prohibition = findOperateCoreProhibitionV2([
      ...semanticPath,
      ...(typeof value === 'string' ? [value] : []),
    ]);
    if (typeof value === 'number' && !Number.isFinite(value)) {
      fail('OPERATING_PROVIDER_INPUT_INVALID', `Reference input must be finite at ${path}.`, {
        path,
      });
    }
    if (
      (typeof value === 'string' &&
        (value.includes('\u0000') ||
          /^(?:file|https?|data|node):/iu.test(value) ||
          prohibition !== null)) ||
      (typeof value !== 'string' && prohibition !== null)
    ) {
      fail(
        'CAPABILITY_DENIED',
        `Reference input contains a prohibited or ambient declaration at ${path}.`,
        { path },
      );
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    fail(
      'OPERATING_PROVIDER_INPUT_INVALID',
      `Reference input must contain only closed data at ${path}.`,
      { path },
    );
  }
  const prototype = Object.getPrototypeOf(value);
  const expected = Array.isArray(value) ? Array.prototype : Object.prototype;
  if (prototype !== expected || Object.getOwnPropertySymbols(value).length > 0) {
    fail('OPERATING_PROVIDER_INPUT_INVALID', `Reference input must use plain data at ${path}.`, {
      path,
    });
  }
  const descriptors = Object.entries(Object.getOwnPropertyDescriptors(value));
  const objectSemanticPath = [
    ...semanticPath,
    ...descriptors.flatMap(([key, descriptor]) => [
      key,
      ...(typeof descriptor.value === 'string' ? [descriptor.value] : []),
    ]),
  ];
  const objectProhibition = findOperateCoreProhibitionV2(objectSemanticPath);
  if (objectProhibition !== null) {
    fail(
      'CAPABILITY_DENIED',
      `Reference input contains a core-prohibited composed object at ${path}.`,
      {
        path,
        prohibition: objectProhibition,
      },
    );
  }
  for (const [key, descriptor] of descriptors) {
    if (
      !Object.hasOwn(descriptor, 'value') ||
      descriptor.get ||
      descriptor.set ||
      typeof descriptor.value === 'function'
    ) {
      fail(
        'OPERATING_PROVIDER_INPUT_INVALID',
        `Reference input cannot contain executable fields at ${path}.${key}.`,
        { path: `${path}.${key}` },
      );
    }
    const nextSemanticPath = [...objectSemanticPath, key];
    const keyProhibition = findOperateCoreProhibitionV2(nextSemanticPath);
    if (keyProhibition !== null) {
      fail(
        'CAPABILITY_DENIED',
        `Reference input contains a core-prohibited semantic key at ${path}.${key}.`,
        {
          path: `${path}.${key}`,
          prohibition: keyProhibition,
        },
      );
    }
    assertReferenceData(descriptor.value, `${path}.${key}`, nextSemanticPath);
  }
}

function assertAction(action) {
  try {
    assertProtocolArtifact('operating-action', action, { protocolVersion: PROTOCOL_VERSION });
  } catch (cause) {
    fail(
      'OPERATING_PROVIDER_INPUT_INVALID',
      'Reference provider requires one contract-valid Action.',
      {
        cause: cause?.code ?? null,
      },
    );
  }
  const required = [
    'revision',
    'actionHash',
    'actionKind',
    'requestedCapability',
    'targetBinding',
    'effectClass',
    'executionBinding',
  ];
  if (required.some((field) => !Object.hasOwn(action, field))) {
    fail(
      'ACTION_REVISION_MISMATCH',
      'Reference provider requires the complete version-bound Action authority tuple.',
      {
        actionId: action?.actionId ?? null,
      },
    );
  }
  return action;
}

/**
 * The open capability reference reports deterministic availability only. It
 * never creates, renews, widens, or consumes a capability grant.
 */
export function createOpenReferenceCapabilityAvailabilityV2({
  action,
  providerId = 'open-reference-capability-provider',
  providerVersion = '1.0.0',
  runtimeVersion,
  checkedAt,
  expiresAt,
  registry = OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
} = {}) {
  assertAction(action);
  const checked = assertTime(checkedAt, 'checkedAt');
  const expires = assertTime(expiresAt, 'expiresAt');
  if (expires <= checked)
    fail(
      'OPERATING_PROVIDER_INPUT_INVALID',
      'Capability availability expiry must follow its check time.',
    );
  const selection = selectOperateCapabilityProviderV2(registry, {
    providerId,
    providerVersion,
    protocolVersion: PROTOCOL_VERSION,
    runtimeVersion,
    now: checkedAt,
    domainId: action.domainId,
    actionKind: action.actionKind,
    capability: action.requestedCapability,
    targetKind: action.targetBinding.kind,
    effectClass: action.effectClass,
  });
  if (
    selection.status === 'available' &&
    expires > assertTime(selection.registration.health.expiresAt, 'provider.health.expiresAt')
  ) {
    fail(
      'OPERATING_PROVIDER_INPUT_INVALID',
      'Capability availability cannot outlive the selected provider health window.',
      {
        providerId,
        providerVersion,
      },
    );
  }
  const status = selection.status === 'available' ? 'available' : 'unavailable';
  const availability = {
    kind: 'operating-capability-availability',
    schemaVersion: '1.0.0',
    protocolVersion: PROTOCOL_VERSION,
    availabilityId: 'cava_pending000',
    provider: { providerId, providerVersion },
    capability: clone(action.requestedCapability),
    target: clone(action.targetBinding),
    effectCeiling: selection.registration?.effectCeiling ?? action.effectClass,
    status,
    reasonCode: selection.reasonCode,
    checkedAt,
    expiresAt,
  };
  const identityHash = sha256Jcs(availability);
  availability.availabilityId = `cava_${identityHash.slice('sha256:'.length)}`;
  availability.availabilityHash = sha256Jcs(availability);
  try {
    assertProtocolArtifact('operating-capability-availability', availability, {
      protocolVersion: PROTOCOL_VERSION,
    });
  } catch (cause) {
    fail(
      'OPERATING_PROVIDER_INPUT_INVALID',
      'Reference capability availability is not contract-valid.',
      { cause: cause?.code ?? null },
    );
  }
  return freeze(availability);
}

/** Evaluate through the canonical core -> project -> domain policy engine. */
export function evaluateOpenReferencePolicyProviderV2({
  action,
  configuredPolicies,
  evaluatedAt,
  evaluationId,
  providerId = 'open-reference-policy-provider',
  providerVersion = '1.0.0',
  runtimeVersion,
  registry = OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSIONS_V2,
} = {}) {
  assertAction(action);
  const selection = selectOperatePolicyProviderV2(registry, {
    providerId,
    providerVersion,
    protocolVersion: PROTOCOL_VERSION,
    runtimeVersion,
    now: evaluatedAt,
    domainId: action.domainId,
    actionKind: action.actionKind,
    policyRef: {
      id: action.executionBinding.policyId,
      version: action.executionBinding.policyVersion,
    },
    effectClass: action.effectClass,
  });
  if (selection.status !== 'available') {
    fail(
      'POLICY_PROVIDER_UNAVAILABLE',
      'The exact open reference policy provider is unavailable.',
      {
        reasonCode: selection.reasonCode,
      },
    );
  }
  return evaluateOperatingActionPolicyV2({
    action,
    configuredPolicies,
    evaluatedAt,
    evaluationId,
    evaluatedBy: { providerId, providerVersion },
  });
}

function assertTargetBinding(target) {
  if (
    !plainExactRecord(target, ['kind', 'id', 'revision']) ||
    typeof target.kind !== 'string' ||
    typeof target.id !== 'string' ||
    typeof target.revision !== 'string'
  ) {
    fail(
      'OPERATING_PROVIDER_INPUT_INVALID',
      'Contained target requires an exact kind, id, and revision.',
    );
  }
  assertReferenceData(target);
}

function makeTarget({ target, initialValue, synthetic }) {
  assertTargetBinding(target);
  assertReferenceData(initialValue);
  let current = clone(initialValue);
  let revision = target.revision;
  let effectCount = 0;
  let restoreCallCount = 0;
  const receipts = new Map();
  const metadata = {
    target: clone(target),
    currentRevision: target.revision,
    stateHash: sha256Jcs(current),
    synthetic,
    receipts,
  };
  const adapter = Object.freeze({
    describe() {
      return freeze({
        target: { ...clone(target), revision },
        stateHash: sha256Jcs(current),
        effectCount,
        restoreCallCount,
      });
    },
    read() {
      return freeze({ value: clone(current), revision, stateHash: sha256Jcs(current) });
    },
    apply({ operationId, requestFingerprint, expectedRevision, nextValue }) {
      assertReferenceData(nextValue);
      const fingerprint = sha256Jcs({ requestFingerprint, expectedRevision, nextValue });
      const prior = receipts.get(operationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          fail(
            'OPERATION_CONFLICT',
            'Contained operation identity was reused with different input.',
            { operationId },
          );
        return freeze(clone(prior.receipt));
      }
      if (expectedRevision !== revision)
        fail('OPERATION_CONFLICT', 'Contained target revision is stale.', {
          operationId,
          expectedRevision,
          actualRevision: revision,
        });
      const before = { value: clone(current), revision, stateHash: sha256Jcs(current) };
      current = clone(nextValue);
      revision = `rev-${sha256Jcs({ operationId, requestFingerprint, current }).slice('sha256:'.length, 22)}`;
      metadata.currentRevision = revision;
      metadata.stateHash = sha256Jcs(current);
      effectCount += 1;
      const receipt = {
        operationId,
        requestFingerprint,
        target: { kind: target.kind, id: target.id },
        before,
        after: { value: clone(current), revision, stateHash: sha256Jcs(current) },
        changed: before.stateHash !== sha256Jcs(current),
        synthetic,
        effectCount: 1,
      };
      receipts.set(operationId, { fingerprint, receipt: clone(receipt) });
      return freeze(receipt);
    },
    restore({
      operationId,
      originalOperationId,
      originalRequestFingerprint,
      requestFingerprint,
      governedRevision,
      baseline,
    }) {
      restoreCallCount += 1;
      assertReferenceData(baseline);
      const original = receipts.get(originalOperationId);
      if (
        !original ||
        original.receipt.operationId !== originalOperationId ||
        original.receipt.requestFingerprint !== originalRequestFingerprint ||
        original.receipt.before.revision !== governedRevision ||
        original.receipt.after.revision !== revision ||
        original.receipt.before.stateHash !== sha256Jcs(baseline.value)
      ) {
        fail(
          'OPERATION_CONFLICT',
          'Contained rollback target does not equal the exact original governed receipt and baseline.',
          {
            operationId,
            originalOperationId,
          },
        );
      }
      return this.apply({
        operationId,
        requestFingerprint,
        expectedRevision: revision,
        nextValue: baseline.value,
      });
    },
    reconcile(input) {
      if (!plainExactRecord(input, ['operationId', 'requestFingerprint'])) {
        fail(
          'OPERATION_CONFLICT',
          'Contained reconciliation accepts only the exact operation identity and request fingerprint.',
        );
      }
      const { operationId, requestFingerprint } = input;
      const prior = receipts.get(operationId);
      if (!prior) return freeze({ status: 'not-found', receipt: null });
      if (
        prior.receipt.operationId !== operationId ||
        prior.receipt.requestFingerprint !== requestFingerprint
      ) {
        fail(
          'OPERATION_CONFLICT',
          'Contained reconciliation requires the exact stored operation receipt fingerprint.',
          {
            operationId,
          },
        );
      }
      return freeze({ status: 'succeeded', receipt: clone(prior.receipt) });
    },
  });
  (synthetic ? SYNTHETIC_TARGETS : PROJECT_TARGETS).add(adapter);
  TARGET_METADATA.set(adapter, metadata);
  return adapter;
}

/** Explicit in-memory disposable target. It has no filesystem or network reach. */
export function createDisposableLocalProjectTargetV2({ target, initialValue = {} } = {}) {
  if (target?.kind !== 'project-record')
    fail('CAPABILITY_DENIED', 'Disposable project target requires kind project-record.');
  return makeTarget({ target, initialValue, synthetic: false });
}

/** Synthetic in-memory target used to prove connector containment. */
export function createSyntheticNoNetworkTargetV2({ target, initialValue = {} } = {}) {
  if (target?.kind !== 'synthetic-target')
    fail('CAPABILITY_DENIED', 'Synthetic containment target requires kind synthetic-target.');
  return makeTarget({ target, initialValue, synthetic: true });
}

function assertContainedTarget(
  targetAdapter,
  operationTarget,
  synthetic,
  { phase, operationId, requireRevision = true },
) {
  const metadata = TARGET_METADATA.get(targetAdapter);
  const expectedSet = synthetic ? SYNTHETIC_TARGETS : PROJECT_TARGETS;
  const prior = operationId === undefined ? null : (metadata?.receipts.get(operationId) ?? null);
  const expectedRevision = prior?.receipt.before.revision ?? metadata?.currentRevision;
  if (
    !metadata ||
    !expectedSet.has(targetAdapter) ||
    !plainExactRecord(operationTarget, ['kind', 'id', 'revision']) ||
    metadata.synthetic !== synthetic ||
    metadata.target.kind !== operationTarget.kind ||
    metadata.target.id !== operationTarget.id ||
    (requireRevision && expectedRevision !== operationTarget.revision)
  ) {
    fail(
      'OPERATION_CONFLICT',
      'Contained target adapter must equal the governed target kind, id, and current revision.',
      {
        target: operationTarget ?? null,
      },
    );
  }
  return metadata;
}

function assertAuthorityDecision({
  authorityDecision,
  operation,
  binding,
  executor,
  targetAdapter,
  synthetic,
}) {
  const checkedBinding = assertTrustedExecutorBindingV2(binding, { executor });
  if (
    !operation ||
    !authorityDecision ||
    authorityDecision.allowed !== true ||
    authorityDecision.replayed !== false ||
    authorityDecision.operationId !== operation.operationId ||
    authorityDecision.evaluationId !== operation.evaluationId ||
    authorityDecision.grantId !== operation.grantId ||
    authorityDecision.effectClass !== operation.effectClass ||
    authorityDecision.target?.kind !== operation.target.kind ||
    authorityDecision.target?.id !== operation.target.id ||
    authorityDecision.target?.revision !== operation.target.revision ||
    !authorityDecision.checks?.includes('executor-exact-healthy-contained-ceiling') ||
    !authorityDecision.checks?.includes('trusted-executor-connector-binding') ||
    !sameIdentity(operation.connector, checkedBinding.connector) ||
    operation.executor.executorId !== checkedBinding.executor.executorId ||
    operation.executor.executorVersion !== checkedBinding.executor.executorVersion
  ) {
    fail(
      'CAPABILITY_DENIED',
      'Contained executor requires the exact live canonical authority decision, trusted binding, and explicit target adapter.',
      {
        operationId: operation?.operationId ?? null,
      },
    );
  }
  return checkedBinding;
}

function executeContained({
  authorityContext,
  authorityDecision,
  executorInput,
  binding,
  executor,
  targetAdapter,
  synthetic,
}) {
  const operation = executorInput?.operation;
  const checkedInput = assertContainedExecutorInputEnvelopeV2(executorInput, {
    operation: authorityContext?.operation,
    rollbackPlan: authorityContext?.rollbackPlan ?? null,
  });
  assertReferenceData(checkedInput.payload.value, 'executorInput.payload.value');
  if (checkedInput.rollbackBaseline !== null) {
    assertReferenceData(
      checkedInput.rollbackBaseline.value,
      'executorInput.rollbackBaseline.value',
    );
  }
  const canonicalDecision = assertOperateAuthorityV2(
    operation.operationKind === 'rollback' ? 'operate.action.rollback' : 'operate.action.execute',
    authorityContext,
  );
  if (!sameJson(canonicalDecision, authorityDecision)) {
    fail(
      'CAPABILITY_DENIED',
      'Contained executor accepts only the unchanged canonical authorization decision.',
      {
        operationId: operation.operationId,
      },
    );
  }
  assertAuthorityDecision({
    authorityDecision,
    operation,
    binding,
    executor,
    targetAdapter,
    synthetic,
  });
  const metadata = assertContainedTarget(targetAdapter, operation.target, synthetic, {
    phase: 'execute',
    operationId: operation.operationId,
  });
  if (operation.operationKind !== 'execute') {
    fail('OPERATION_CONFLICT', 'Contained execute requires an execute operation.', {
      operationId: operation.operationId,
    });
  }
  if (
    !metadata.receipts.has(operation.operationId) &&
    checkedInput.rollbackBaseline !== null &&
    checkedInput.rollbackBaseline.contentHash !== metadata.stateHash
  ) {
    fail(
      'OPERATION_CONFLICT',
      'Contained target initial state differs from the fingerprint-bound rollback baseline.',
      {
        operationId: operation.operationId,
      },
    );
  }
  const current = targetAdapter.read();
  return targetAdapter.apply({
    operationId: operation.operationId,
    requestFingerprint: operation.requestFingerprint,
    expectedRevision: operation.target.revision,
    nextValue: checkedInput.payload.value,
    current,
  });
}

function rollbackContained({
  authorityContext,
  authorityDecision,
  executorInput,
  binding,
  executor,
  targetAdapter,
  synthetic,
}) {
  const operation = executorInput?.operation;
  if (operation?.operationKind !== 'rollback')
    fail('ROLLBACK_NOT_ELIGIBLE', 'Contained rollback requires one rollback operation.');
  const checkedInput = assertContainedExecutorInputEnvelopeV2(executorInput, {
    operation: authorityContext?.operation,
    rollbackPlan: authorityContext?.rollbackPlan ?? null,
  });
  assertReferenceData(checkedInput.payload.value, 'executorInput.payload.value');
  assertReferenceData(checkedInput.rollbackBaseline.value, 'executorInput.rollbackBaseline.value');
  const canonicalDecision = assertOperateAuthorityV2('operate.action.rollback', authorityContext);
  if (!sameJson(canonicalDecision, authorityDecision))
    fail(
      'CAPABILITY_DENIED',
      'Contained rollback requires the unchanged canonical authority decision.',
    );
  assertAuthorityDecision({
    authorityDecision,
    operation,
    binding,
    executor,
    targetAdapter,
    synthetic,
  });
  const parentOperations = (authorityContext.operationHistory ?? []).filter(
    (entry) => entry.operationId === operation.parentOperationId,
  );
  const [parentOperation] = parentOperations;
  if (parentOperations.length !== 1 || typeof parentOperation?.requestFingerprint !== 'string') {
    fail(
      'OPERATION_CONFLICT',
      'Contained rollback requires the validated parent operation history identity and fingerprint.',
      {
        operationId: operation.operationId,
        parentOperationId: operation.parentOperationId,
      },
    );
  }
  assertContainedTarget(targetAdapter, operation.target, synthetic, {
    phase: 'rollback',
    operationId: operation.parentOperationId,
  });
  return targetAdapter.restore({
    operationId: operation.operationId,
    originalOperationId: operation.parentOperationId,
    originalRequestFingerprint: parentOperation.requestFingerprint,
    requestFingerprint: operation.requestFingerprint,
    governedRevision: operation.target.revision,
    baseline: { value: checkedInput.rollbackBaseline.value },
  });
}

function referenceHost(declaration) {
  const host = Object.freeze({
    executorId: declaration.executorId,
    executorVersion: declaration.executorVersion,
    implementationId: declaration.implementationId,
    connector: declaration.connector,
    inspect(input) {
      const initialInspection = plainExactRecord(input, ['targetAdapter', 'target']);
      const recoveryInspection = plainExactRecord(input, [
        'targetAdapter',
        'target',
        'operationId',
        'expectedStateHash',
      ]);
      if (!initialInspection && !recoveryInspection) {
        fail(
          'OPERATION_CONFLICT',
          'Contained target inspection accepts one closed target binding only.',
        );
      }
      const { targetAdapter, target, operationId, expectedStateHash } = input;
      assertContainedTarget(targetAdapter, target, declaration.synthetic, {
        phase: recoveryInspection ? 'recovery-inspect' : 'inspect',
        operationId,
      });
      const snapshot = targetAdapter.read();
      if (
        (!recoveryInspection && snapshot.revision !== target.revision) ||
        snapshot.stateHash !== sha256Jcs(snapshot.value) ||
        (recoveryInspection && snapshot.stateHash !== expectedStateHash)
      ) {
        fail(
          'OPERATION_CONFLICT',
          'Contained target inspection must prove the exact current revision and state hash.',
          {
            target: target.id,
          },
        );
      }
      return freeze(clone(snapshot));
    },
    execute(input) {
      if (
        !plainExactRecord(input, [
          'authorityContext',
          'authorityDecision',
          'executorInput',
          'binding',
          'executor',
          'targetAdapter',
        ])
      ) {
        fail(
          'OPERATION_CONFLICT',
          'Contained execute accepts one closed executor invocation envelope only.',
        );
      }
      return executeContained({ ...input, synthetic: declaration.synthetic });
    },
    rollback(input) {
      if (
        !plainExactRecord(input, [
          'authorityContext',
          'authorityDecision',
          'executorInput',
          'binding',
          'executor',
          'targetAdapter',
        ])
      ) {
        fail(
          'OPERATION_CONFLICT',
          'Contained rollback accepts one closed executor invocation envelope only.',
        );
      }
      return rollbackContained({ ...input, synthetic: declaration.synthetic });
    },
    reconcile(input) {
      if (
        !plainExactRecord(input, [
          'targetAdapter',
          'executorInput',
          'binding',
          'executor',
          'rollbackPlan',
        ])
      ) {
        fail(
          'OPERATION_CONFLICT',
          'Contained reconciliation accepts one closed exact invocation only.',
        );
      }
      const { targetAdapter, executorInput, binding, executor, rollbackPlan } = input;
      const operation = executorInput?.operation;
      if ((operation?.operationKind === 'rollback') !== (rollbackPlan !== null)) {
        fail(
          'ROLLBACK_NOT_ELIGIBLE',
          'Contained reconciliation requires the exact rollback plan only for rollback operations.',
          {
            operationId: operation?.operationId ?? null,
          },
        );
      }
      if (rollbackPlan !== null) {
        assertProtocolArtifact('operating-rollback-plan', rollbackPlan, {
          protocolVersion: PROTOCOL_VERSION,
        });
        if (
          rollbackPlan.rollbackPlanId !== operation.rollbackPlanId ||
          rollbackPlan.operationId !== operation.parentOperationId
        ) {
          fail(
            'ROLLBACK_NOT_ELIGIBLE',
            'Contained reconciliation rollback plan must bind the exact durable rollback operation.',
            {
              operationId: operation.operationId,
              rollbackPlanId: rollbackPlan.rollbackPlanId,
            },
          );
        }
      }
      assertContainedExecutorInputEnvelopeV2(executorInput, { operation, rollbackPlan });
      const checkedBinding = assertTrustedExecutorBindingV2(binding, { executor });
      if (
        !sameIdentity(operation?.connector, checkedBinding.connector) ||
        operation?.executor?.executorId !== checkedBinding.executor.executorId ||
        operation?.executor?.executorVersion !== checkedBinding.executor.executorVersion
      ) {
        fail(
          'CAPABILITY_DENIED',
          'Reconciliation requires the exact host-owned connector binding.',
          {
            operationId: operation?.operationId ?? null,
          },
        );
      }
      assertContainedTarget(targetAdapter, operation.target, declaration.synthetic, {
        phase: 'reconcile',
        operationId: operation.operationId,
        requireRevision: rollbackPlan === null,
      });
      const response = targetAdapter.reconcile({
        operationId: operation.operationId,
        requestFingerprint: operation.requestFingerprint,
      });
      if (
        rollbackPlan !== null &&
        response.status === 'not-found' &&
        targetAdapter.read().stateHash !== rollbackPlan.steps[0].expectedTargetHash
      ) {
        return freeze({ status: 'unknown', receipt: null });
      }
      return response;
    },
  });
  REFERENCE_HOSTS.set(host, declaration);
  return host;
}

export function resolveOpenReferenceExecutorHostV2(host) {
  const declaration = REFERENCE_HOSTS.get(host);
  return declaration === undefined ? null : freeze(clone(declaration));
}

export function findOpenReferenceExecutorHostDeclarationV2({
  executorId,
  executorVersion,
  implementationId,
} = {}) {
  const declaration = REFERENCE_HOST_DECLARATIONS.find(
    (entry) =>
      entry.executorId === executorId &&
      entry.executorVersion === executorVersion &&
      entry.implementationId === implementationId,
  );
  return declaration === undefined ? null : freeze(clone(declaration));
}

export const OPEN_REFERENCE_PROJECT_EXECUTOR_HOST_V2 = referenceHost(
  REFERENCE_HOST_DECLARATIONS[0],
);

export const OPEN_REFERENCE_CONTAINMENT_EXECUTOR_HOST_V2 = referenceHost(
  REFERENCE_HOST_DECLARATIONS[1],
);
