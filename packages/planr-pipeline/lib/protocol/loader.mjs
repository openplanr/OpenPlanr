import {
  PROTOCOL_SCHEMA_REGISTRY,
  assertProtocolArtifact,
  listOperatingProviders,
  listOperatingRoles,
  listProtocolSchemas,
  resolveProtocolSchema,
  validateProtocolArtifact,
} from './contracts.mjs';
import { canonicalizeJson, sha256Jcs } from './jcs.mjs';
import {
  computeOperatingEventHash,
  createOperatingCheckpoint,
  createOperatingCheckpointSigningPayload,
  createOperatingEvent,
  reduceOperatingEvents,
  resumeOperatingProjection,
  validateOperatingCheckpoint,
  verifyOperatingEventChain,
} from '../operate/reducer.mjs';
import {
  computeOperatingProviderPolicyDigest,
  operatingProviderPolicyPayload,
  validateOperatingProviderPolicyDigest,
} from '../operate/provider-policy.mjs';
import {
  computeOperatingRoleResultDigest,
  operatingRoleResultIdentityPayload,
  validateOperatingRoleResultDigest,
} from '../operate/role-result.mjs';
import {
  createOperatingAdvisorBrief,
  listOperatingAdvisorBriefs,
} from '../operate/advisor-brief.mjs';

export const OPERATING_PROTOCOL_VERSION = '1.2.0';

/**
 * Stable package loader for consumers that cannot or should not resolve
 * package-internal schema paths. The returned schema is a defensive clone.
 */
export function loadProtocolContract(kind, {
  protocolVersion = OPERATING_PROTOCOL_VERSION,
} = {}) {
  return resolveProtocolSchema(kind, { protocolVersion });
}

/**
 * Return the complete immutable Operating Board contract descriptor: versioned
 * schemas plus canonical role/provider definitions. No filesystem paths,
 * runtime credentials, or mutable singleton objects are exposed.
 */
export function loadOperatingContractBundle() {
  const schemas = Object.fromEntries(
    listProtocolSchemas()
      .filter(({ protocolVersion }) => protocolVersion === OPERATING_PROTOCOL_VERSION)
      .map(({ kind }) => [
        kind,
        loadProtocolContract(kind, { protocolVersion: OPERATING_PROTOCOL_VERSION }).schema,
      ]),
  );
  return {
    kind: 'operating-contract-bundle',
    protocolVersion: OPERATING_PROTOCOL_VERSION,
    schemas,
    roles: listOperatingRoles(),
    providers: listOperatingProviders(),
  };
}

export {
  PROTOCOL_SCHEMA_REGISTRY,
  assertProtocolArtifact,
  canonicalizeJson,
  computeOperatingProviderPolicyDigest,
  computeOperatingRoleResultDigest,
  createOperatingAdvisorBrief,
  computeOperatingEventHash,
  createOperatingCheckpoint,
  createOperatingCheckpointSigningPayload,
  createOperatingEvent,
  listOperatingProviders,
  listOperatingAdvisorBriefs,
  listOperatingRoles,
  listProtocolSchemas,
  operatingProviderPolicyPayload,
  operatingRoleResultIdentityPayload,
  reduceOperatingEvents,
  resolveProtocolSchema,
  resumeOperatingProjection,
  sha256Jcs,
  validateOperatingCheckpoint,
  validateOperatingProviderPolicyDigest,
  validateOperatingRoleResultDigest,
  validateProtocolArtifact,
  verifyOperatingEventChain,
};
