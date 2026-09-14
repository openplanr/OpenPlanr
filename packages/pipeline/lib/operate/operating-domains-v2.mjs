import { PipelineError } from '../protocol/errors.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/canonical-json.mjs';
import {
  OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
  canonicalizeOperateExtensionRegistryV2,
  findOperateDomainRegistrationV2,
} from './extensions-v2.mjs';
import { assertOperatingSnapshotV2 } from './operating-snapshots-v2.mjs';
import { assertOperatingModelStateV2 } from './operating-state-v2.mjs';

const VERSION = '2.0.0';

export const PUBLIC_OPERATING_DOMAIN_CONTRACTS_V2 = Object.freeze({
  business: Object.freeze({
    apiDomainId: 'business',
    id: 'business-domain',
    version: '1.0.0',
    projection: Object.freeze({
      schemaId: 'business-operating-snapshot-projection',
      schemaVersion: '1.0.0',
    }),
  }),
  software: Object.freeze({
    apiDomainId: 'software',
    id: 'software-domain',
    version: '1.0.0',
    projection: Object.freeze({
      schemaId: 'software-operating-snapshot-projection',
      schemaVersion: '1.0.0',
    }),
  }),
});

export class OperatingDomainProjectionErrorV2 extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OperatingDomainProjectionErrorV2';
    this.code = code;
    this.details = Object.freeze(structuredClone(details));
  }
}

function fail(code, message, details) {
  throw new OperatingDomainProjectionErrorV2(code, message, details);
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

function sameValue(left, right) {
  return sha256Jcs(left) === sha256Jcs(right);
}

function assertExactBinding(actual, expected, subject) {
  if (!actual || !sameValue(actual, {
    apiDomainId: expected.apiDomainId,
    id: expected.id,
    version: expected.version,
  })) {
    fail('OPERATING_DOMAIN_BINDING_INVALID', `${subject} must use one explicit public API-domain contract binding.`, {
      apiDomainId: actual?.apiDomainId ?? null,
    });
  }
}

function assertSnapshotStateBinding(snapshot, state) {
  const verifiedState = assertOperatingModelStateV2(state);
  const verifiedSnapshot = assertOperatingSnapshotV2(snapshot, { state: verifiedState });
  if (verifiedState.domainId !== verifiedSnapshot.domainId
    || verifiedState.domainVersion !== verifiedSnapshot.domainVersion
    || verifiedState.scopeId !== verifiedSnapshot.scopeId) {
    fail('OPERATING_DOMAIN_INPUT_INVALID', 'Projection state and snapshot must have one matching scope and domain.', {
      snapshotId: verifiedSnapshot.snapshotId,
    });
  }
  return { snapshot: verifiedSnapshot, state: verifiedState };
}

function exactSourceArtifacts(snapshot, referencedArtifacts) {
  if (!Array.isArray(referencedArtifacts)) {
    fail('OPERATING_DOMAIN_INPUT_INVALID', 'A projection requires the exact referenced Artifact descriptors.', {});
  }
  const indexed = new Map();
  for (const artifact of referencedArtifacts) {
    try {
      assertProtocolArtifact('operating-artifact', artifact, { protocolVersion: VERSION });
    } catch (cause) {
      fail('OPERATING_DOMAIN_INPUT_INVALID', 'A projection may use only valid accepted Artifact descriptors.', {
        cause: cause.code ?? null,
      });
    }
    if (artifact.scopeId !== snapshot.scopeId
      || artifact.domainId !== snapshot.domainId
      || artifact.domainVersion !== snapshot.domainVersion
      || indexed.has(artifact.artifactId)) {
      fail('OPERATING_DOMAIN_INPUT_INVALID', 'Referenced Artifacts must be unique and match the snapshot scope.', {
        artifactId: artifact?.artifactId ?? null,
      });
    }
    indexed.set(artifact.artifactId, artifact);
  }
  const ids = [...indexed.keys()].sort();
  const expected = [...snapshot.sourceArtifactIds].sort();
  if (!sameValue(ids, expected)) {
    fail('OPERATING_DOMAIN_INPUT_INVALID', 'Referenced Artifacts must exactly match the immutable snapshot sources.', {
      expectedSourceArtifactIds: expected,
      suppliedSourceArtifactIds: ids,
    });
  }
  return ids;
}

function canonicalRegistry(registry) {
  try {
    return canonicalizeOperateExtensionRegistryV2(registry);
  } catch (cause) {
    fail('OPERATING_DOMAIN_INPUT_INVALID', 'Public domain resolution requires one complete validated Operate extension registry.', {
      cause: cause.code ?? null,
    });
  }
}

function resolveCanonicalPublicOperatingDomain(registry, domainId, domainVersion) {
  const expected = PUBLIC_OPERATING_DOMAIN_CONTRACTS_V2[domainId];
  if (!expected || domainVersion !== expected.version) {
    return null;
  }
  const registration = findOperateDomainRegistrationV2(registry, domainId, { domainVersion });
  if (registration === null) return null;
  assertExactBinding(registration.domainContract, expected, 'Registered domain');
  if (!Array.isArray(registration.projectionContracts)
    || registration.projectionContracts.length !== 1
    || !sameValue(registration.projectionContracts[0], expected.projection)) {
    fail('OPERATING_DOMAIN_REGISTRATION_INVALID', 'A public domain registration must declare its exact public projection contract.', {
      domainId,
    });
  }
  const byKind = { advisor: [], challenger: [], chair: [] };
  for (const role of registration.roles) {
    if (!Object.hasOwn(byKind, role.roleKind)) {
      fail('OPERATING_DOMAIN_REGISTRATION_INVALID', 'A public operating domain role must declare one kernel scheduling kind.', {
        domainId, roleId: role.roleId, roleKind: role.roleKind,
      });
    }
    byKind[role.roleKind].push(role);
  }
  if (new Set(registration.roles.map((role) => role.roleId)).size !== registration.roles.length
    || byKind.advisor.length < 1
    || byKind.challenger.length !== 1
    || byKind.chair.length !== 1
    || byKind.advisor.some((role) => role.dependencyPolicy.id !== 'none')
    || byKind.challenger[0].dependencyPolicy.id === 'none'
    || byKind.chair[0].dependencyPolicy.id === 'none') {
    fail('OPERATING_DOMAIN_REGISTRATION_INVALID', 'A public operating domain must declare the complete dependency-aware intelligence role choreography.', {
      domainId,
    });
  }
  return freeze(clone(registration));
}

/** Resolve one public domain only through an explicit API ID and version. */
export function resolvePublicOperatingDomainV2(registry, domainId, { domainVersion } = {}) {
  if (typeof domainVersion !== 'string' || domainVersion.length === 0) {
    fail('OPERATING_DOMAIN_VERSION_REQUIRED', 'A public operating domain requires an explicit domain version.', { domainId });
  }
  return resolveCanonicalPublicOperatingDomain(canonicalRegistry(registry), domainId, domainVersion);
}

/**
 * List the exact public domain identities an API client may pass to
 * `operate start`. The extension registry owns availability and ordering; a
 * downstream CLI or skill must not guess a domain version or maintain a
 * duplicate catalog.
 */
export function listPublicOperatingDomainsV2(registry = OPEN_REFERENCE_OPERATE_EXTENSIONS_V2) {
  const canonical = canonicalRegistry(registry);
  const domains = canonical.domains
    .filter(({ domainId }) => Object.hasOwn(PUBLIC_OPERATING_DOMAIN_CONTRACTS_V2, domainId))
    .map(({ domainId, domainVersion }) => {
      const registration = resolveCanonicalPublicOperatingDomain(canonical, domainId, domainVersion);
      if (registration === null) {
        fail('OPERATING_DOMAIN_REGISTRATION_INVALID', 'A registered public domain must use its exact public identity.', {
          domainId,
          domainVersion,
        });
      }
      return {
        domainId: registration.domainId,
        domainVersion: registration.domainVersion,
        domainContract: clone(registration.domainContract),
        roles: registration.roles.map(({ roleId, roleKind, roleVersion, label }) => ({
          roleId,
          roleKind,
          roleVersion,
          label,
        })),
      };
    });
  return freeze(domains);
}

function deriveProjectionId({ snapshot, projection }) {
  const digest = sha256Jcs({
    domainContract: snapshot.domainContract,
    domainId: snapshot.domainId,
    domainVersion: snapshot.domainVersion,
    projection,
    snapshotId: snapshot.snapshotId,
    sourceArtifactIds: snapshot.sourceArtifactIds,
    stateId: snapshot.stateId,
  });
  return `prj_${digest.slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

/**
 * Rebuild a public domain projection from immutable core state, its explicit
 * public registration, and exactly the Artifacts already named by the
 * snapshot. This is deliberately a pure facade: it has no store, dispatch,
 * capability, policy, or mutation input.
 */
export function projectPublicOperatingDomainV2({
  registry = OPEN_REFERENCE_OPERATE_EXTENSIONS_V2,
  state,
  snapshot,
  referencedArtifacts,
} = {}) {
  const canonical = canonicalRegistry(registry);
  const verified = assertSnapshotStateBinding(snapshot, state);
  const expected = PUBLIC_OPERATING_DOMAIN_CONTRACTS_V2[verified.snapshot.domainId];
  if (!expected || verified.snapshot.domainVersion !== expected.version) {
    fail('OPERATING_DOMAIN_UNAVAILABLE', 'No public projection is registered for this API domain and version.', {
      domainId: verified.snapshot.domainId,
      domainVersion: verified.snapshot.domainVersion,
    });
  }
  assertExactBinding(verified.snapshot.domainContract, expected, 'Operating snapshot');
  const registration = resolveCanonicalPublicOperatingDomain(canonical, verified.snapshot.domainId, verified.snapshot.domainVersion);
  if (registration === null) {
    fail('OPERATING_DOMAIN_UNAVAILABLE', 'The requested public domain is not registered.', {
      domainId: verified.snapshot.domainId,
      domainVersion: verified.snapshot.domainVersion,
    });
  }
  const sourceArtifactIds = exactSourceArtifacts(verified.snapshot, referencedArtifacts);
  const projection = {
    kind: expected.projection.schemaId,
    schemaVersion: expected.projection.schemaVersion,
    protocolVersion: VERSION,
    projectionId: deriveProjectionId({ snapshot: verified.snapshot, projection: expected.projection }),
    scopeId: verified.snapshot.scopeId,
    domainId: verified.snapshot.domainId,
    domainVersion: verified.snapshot.domainVersion,
    domainContract: {
      apiDomainId: expected.apiDomainId,
      id: expected.id,
      version: expected.version,
    },
    snapshotId: verified.snapshot.snapshotId,
    stateId: verified.state.stateId,
    sourceArtifactIds,
    derivedAt: verified.snapshot.createdAt,
  };
  try {
    assertProtocolArtifact(projection.kind, projection, { protocolVersion: VERSION });
  } catch (cause) {
    throw new PipelineError('RESULT_CONTRACT_INVALID', 'The public operating projection did not satisfy its declared contract.', '', {
      retryable: false,
      context: { cause: cause.code ?? null, domainId: projection.domainId },
    });
  }
  return freeze(projection);
}
