import { sha256Jcs } from '../protocol/jcs.mjs';

/**
 * Canonical recommendation identity deliberately excludes runtime provenance.
 * Runtime, adapter, and dispatch mode describe how a result was produced; they
 * do not change the validated recommendation body.
 */
export function operatingRoleResultIdentityPayload(result) {
  return {
    kind: result.kind,
    schemaVersion: result.schemaVersion,
    protocolVersion: result.protocolVersion,
    cycleId: result.cycleId,
    roleId: result.roleId,
    inputDigest: result.inputDigest,
    outcome: result.outcome,
    proposals: result.proposals,
    gaps: result.gaps,
    conflicts: result.conflicts,
  };
}

export function computeOperatingRoleResultDigest(result) {
  return sha256Jcs(operatingRoleResultIdentityPayload(result));
}

export function validateOperatingRoleResultDigest(result) {
  const expected = computeOperatingRoleResultDigest(result);
  if (result.resultDigest !== expected) {
    throw new Error('Operating role result digest does not match its runtime-neutral body.');
  }
  return result;
}
