import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import {
  canonicalizeOperateExtensionRegistryV2,
  findOperateMetricProviderRegistrationV2,
  findOperateSnapshotProviderRegistrationV2,
  findOperateVerificationProviderRegistrationV2,
  OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
  PUBLIC_OPERATE_DOMAIN_BINDINGS_V2,
} from './extensions-v2.mjs';
import { assertOperatingSnapshotV2 } from './operating-snapshots-v2.mjs';
import { assertOperatingModelStateV2 } from './operating-state-v2.mjs';

const VERSION = '2.0.0';

export const OPEN_REFERENCE_OPERATING_SIGNAL_PROVIDER_IDENTITIES_V2 = Object.freeze({
  snapshot: Object.freeze({ providerId: 'open-reference-snapshot-provider', providerVersion: '1.0.0', implementationId: 'open-reference-snapshot-provider-v2' }),
  metric: Object.freeze({ providerId: 'open-reference-metric-provider', providerVersion: '1.0.0', implementationId: 'open-reference-metric-provider-v2' }),
  verification: Object.freeze({ providerId: 'open-reference-verification-provider', providerVersion: '1.0.0', implementationId: 'open-reference-verification-provider-v2' }),
});

export class OperatingSignalProviderErrorV2 extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OperatingSignalProviderErrorV2';
    this.code = code;
    this.details = Object.freeze(structuredClone(details));
  }
}

function fail(code, message, details) {
  throw new OperatingSignalProviderErrorV2(code, message, details);
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

function sameDomain(left, right) {
  return left.scopeId === right.scopeId
    && left.domainId === right.domainId
    && left.domainVersion === right.domainVersion;
}

function explicitDomainContract(domainContract) {
  if (!domainContract || typeof domainContract !== 'object'
    || ['apiDomainId', 'id', 'version'].some((key) => typeof domainContract[key] !== 'string')) {
    fail('OPERATING_PROVIDER_INPUT_INVALID', 'Provider selection requires one explicit API-domain contract binding.', {});
  }
  return domainContract;
}

function canonicalRegistry(registry) {
  try {
    return canonicalizeOperateExtensionRegistryV2(registry);
  } catch (cause) {
    fail('OPERATING_PROVIDER_INPUT_INVALID', 'Provider selection requires one complete validated Operate extension registry.', {
      cause: cause.code ?? null,
    });
  }
}

function supportsDomain(registration, domainContract) {
  return registration.supportedDomains.some((entry) => (
    entry.apiDomainId === domainContract.apiDomainId
    && entry.domainContractId === domainContract.id
    && entry.domainContractVersion === domainContract.version
  ));
}

function hasExactRegisteredDomain(registry, domainContract) {
  return registry.domains.some((registration) => (
    registration.domainId === domainContract.apiDomainId
    && registration.domainVersion === domainContract.version
    && registration.domainContract?.apiDomainId === domainContract.apiDomainId
    && registration.domainContract?.id === domainContract.id
    && registration.domainContract?.version === domainContract.version
  ));
}

function unavailable(kind, providerId, providerVersion, domainContract) {
  return freeze({
    status: 'unavailable',
    provider: null,
    error: {
      code: 'OPERATING_PROVIDER_UNAVAILABLE',
      retryable: false,
      context: {
        providerKind: kind,
        providerId: providerId ?? null,
        providerVersion: providerVersion ?? null,
        apiDomainId: domainContract?.apiDomainId ?? null,
      },
    },
  });
}

function select(registry, kind, providerId, { providerVersion, domainContract } = {}) {
  const expected = OPEN_REFERENCE_OPERATING_SIGNAL_PROVIDER_IDENTITIES_V2[kind];
  if (typeof providerVersion !== 'string' || providerVersion.length === 0) {
    fail('OPERATING_PROVIDER_VERSION_REQUIRED', 'Provider selection requires an explicit provider version.', {
      providerId,
    });
  }
  const canonical = canonicalRegistry(registry);
  const binding = explicitDomainContract(domainContract);
  if (!expected || providerId !== expected.providerId || providerVersion !== expected.providerVersion) {
    return unavailable(kind, providerId, providerVersion, binding);
  }
  const find = {
    snapshot: findOperateSnapshotProviderRegistrationV2,
    metric: findOperateMetricProviderRegistrationV2,
    verification: findOperateVerificationProviderRegistrationV2,
  }[kind];
  const provider = find(canonical, providerId, { providerVersion });
  if (provider === null || provider.implementation?.kind !== 'built-in'
    || provider.implementation.id !== expected.implementationId
    || !hasExactRegisteredDomain(canonical, binding)
    || !supportsDomain(provider, binding)) {
    return unavailable(kind, providerId, providerVersion, binding);
  }
  return freeze({ status: 'selected', provider: clone(provider), error: null });
}

export function selectOperatingSnapshotProviderV2(registry = OPEN_REFERENCE_OPERATE_EXTENSIONS_V2, request = {}) {
  return select(registry, 'snapshot', request.providerId, request);
}

export function selectOperatingMetricProviderV2(registry = OPEN_REFERENCE_OPERATE_EXTENSIONS_V2, request = {}) {
  return select(registry, 'metric', request.providerId, request);
}

export function selectOperatingVerificationProviderV2(registry = OPEN_REFERENCE_OPERATE_EXTENSIONS_V2, request = {}) {
  return select(registry, 'verification', request.providerId, request);
}

function exactAcceptedArtifacts(artifacts, scope, sourceArtifactIds) {
  if (!Array.isArray(artifacts)) {
    fail('OPERATING_PROVIDER_INPUT_INVALID', 'A provider accepts only declared accepted Artifact descriptors.', {});
  }
  const seen = new Set();
  const ids = [];
  for (const artifact of artifacts) {
    try {
      assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: VERSION });
    } catch (cause) {
      fail('OPERATING_PROVIDER_INPUT_INVALID', 'A provider input Artifact is invalid.', { cause: cause.code ?? null });
    }
    if (!sameDomain(artifact, scope) || seen.has(artifact.artifactId)) {
      fail('OPERATING_PROVIDER_INPUT_INVALID', 'Provider Artifacts must be unique and match the declared scope.', {
        artifactId: artifact?.artifactId ?? null,
      });
    }
    seen.add(artifact.artifactId);
    ids.push(artifact.artifactId);
  }
  const expected = [...sourceArtifactIds].sort();
  if (ids.sort().join('\u0000') !== expected.join('\u0000')) {
    fail('OPERATING_PROVIDER_INPUT_INVALID', 'Provider Artifacts must exactly match their declared accepted inputs.', {
      expectedSourceArtifactIds: expected,
    });
  }
  return new Set(ids);
}

/** Return a validated existing snapshot as a normal candidate; never materialize it. */
export function createOperatingSnapshotCandidateV2({
  registry = OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
  providerId,
  providerVersion,
  snapshot,
  state,
  acceptedArtifacts,
} = {}) {
  const verifiedState = assertOperatingModelStateV2(state);
  const verifiedSnapshot = assertOperatingSnapshotV2(snapshot, { state: verifiedState });
  const selection = selectOperatingSnapshotProviderV2(registry, {
    providerId,
    providerVersion,
    domainContract: verifiedSnapshot.domainContract,
  });
  if (selection.status !== 'selected') return selection;
  exactAcceptedArtifacts(acceptedArtifacts, verifiedSnapshot, verifiedSnapshot.sourceArtifactIds);
  return freeze({ status: 'candidate', provider: selection.provider, candidate: clone(verifiedSnapshot) });
}

/** Return a validated immutable metric observation candidate from accepted inputs only. */
export function createOperatingMetricObservationCandidateV2({
  registry = OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
  providerId,
  providerVersion,
  metric,
  observation,
  snapshot,
  acceptedArtifacts,
} = {}) {
  try {
    assertProtocolArtifact('operating-metric', metric, { protocolVersion: VERSION });
    assertProtocolArtifact('operating-metric-observation', observation, { protocolVersion: VERSION });
  } catch (cause) {
    fail('OPERATING_PROVIDER_INPUT_INVALID', 'A metric provider requires valid metric and observation contracts.', {
      cause: cause.code ?? null,
    });
  }
  const verifiedSnapshot = assertOperatingSnapshotV2(snapshot);
  const selection = selectOperatingMetricProviderV2(registry, {
    providerId,
    providerVersion,
    domainContract: verifiedSnapshot.domainContract,
  });
  if (selection.status !== 'selected') return selection;
  const accepted = exactAcceptedArtifacts(acceptedArtifacts, verifiedSnapshot, verifiedSnapshot.sourceArtifactIds);
  if (!sameDomain(metric, verifiedSnapshot) || !sameDomain(observation, verifiedSnapshot)
    || observation.metricId !== metric.metricId || observation.snapshotId !== verifiedSnapshot.snapshotId
    || !accepted.has(observation.sourceArtifactId)) {
    fail('OPERATING_PROVIDER_INPUT_INVALID', 'A metric observation must bind the selected metric, snapshot, and accepted source Artifact.', {
      metricId: observation?.metricId ?? null,
    });
  }
  return freeze({ status: 'candidate', provider: selection.provider, candidate: clone(observation) });
}

/** Return an Outcome candidate for a verification plan; it cannot execute an Action. */
export function createOperatingVerificationCandidateV2({
  registry = OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
  providerId,
  providerVersion,
  verificationPlan,
  outcome,
  acceptedArtifacts,
} = {}) {
  try {
    assertProtocolArtifact('operating-action-verification-plan', verificationPlan, { protocolVersion: VERSION });
    assertProtocolArtifact('operating-outcome', outcome, { protocolVersion: VERSION });
  } catch (cause) {
    fail('OPERATING_PROVIDER_INPUT_INVALID', 'A verification provider requires valid plan and Outcome contracts.', {
      cause: cause.code ?? null,
    });
  }
  const selection = selectOperatingVerificationProviderV2(registry, {
    providerId,
    providerVersion,
    domainContract: PUBLIC_OPERATE_DOMAIN_BINDINGS_V2[verificationPlan.domainId]
      && {
        apiDomainId: PUBLIC_OPERATE_DOMAIN_BINDINGS_V2[verificationPlan.domainId].apiDomainId,
        id: PUBLIC_OPERATE_DOMAIN_BINDINGS_V2[verificationPlan.domainId].id,
        version: verificationPlan.domainVersion,
      },
  });
  if (selection.status !== 'selected') return selection;
  // Verification remains an accepted-input/read-only candidate boundary. A
  // plan retains its Chair-ledger source while an Outcome retains the later
  // observation source; both exact accepted Artifacts must be declared.
  const accepted = exactAcceptedArtifacts(acceptedArtifacts, verificationPlan, [
    ...new Set([verificationPlan.sourceArtifactId, outcome.sourceArtifactId]),
  ]);
  if (!sameDomain(outcome, verificationPlan)
    || outcome.actionId !== verificationPlan.actionId
    || outcome.verificationPlanId !== verificationPlan.verificationPlanId
    || !accepted.has(outcome.sourceArtifactId)) {
    fail('OPERATING_PROVIDER_INPUT_INVALID', 'An Outcome must bind the selected verification plan and accepted source Artifact.', {
      outcomeId: outcome?.outcomeId ?? null,
    });
  }
  return freeze({ status: 'candidate', provider: selection.provider, candidate: clone(outcome) });
}
