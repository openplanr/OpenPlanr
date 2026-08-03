import { PipelineError } from '../pipeline/errors.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';

/**
 * Extract the consented, credential-free provider policy. Consent event
 * timestamps are deliberately excluded: renewal acknowledges the same policy
 * unless one of these policy fields changes and therefore changes this digest.
 */
export function operatingProviderPolicyPayload(manifest) {
  return {
    providerId: manifest.providerId,
    providerVersion: manifest.providerVersion,
    mode: manifest.mode,
    readOnly: manifest.readOnly,
    endpoint: structuredClone(manifest.endpoint),
    permittedDataClasses: [...manifest.permittedDataClasses].sort(),
    retention: structuredClone(manifest.retention),
    capabilities: structuredClone(manifest.capabilities),
    limits: structuredClone(manifest.limits),
    consentPolicy: {
      policyVersion: manifest.consent.policyVersion,
      renewalTriggers: [...manifest.consent.renewalTriggers].sort(),
    },
  };
}

export function computeOperatingProviderPolicyDigest(manifest) {
  assertProtocolArtifact('operating-provider-manifest', manifest);
  return sha256Jcs(operatingProviderPolicyPayload(manifest));
}

export function validateOperatingProviderPolicyDigest(manifest) {
  const actual = computeOperatingProviderPolicyDigest(manifest);
  if (actual !== manifest.policyDigest) {
    throw new PipelineError(
      'E_OPERATE_PROVIDER_POLICY_INVALID',
      `Provider ${manifest.providerId} policy digest does not match its consented policy.`,
    );
  }
  return manifest;
}
