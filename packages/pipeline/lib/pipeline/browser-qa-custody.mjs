import { createHash, randomUUID } from 'node:crypto';

import { sha256Jcs } from '../protocol/jcs.mjs';
import { PipelineError } from './errors.mjs';

const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const MAX_COUNT_EVENTS = 100_000;
const trustedHosts = new WeakSet();
const runtimeCapabilities = new WeakSet();
const issuedAttestations = new WeakSet();

function fail(code, message) { throw new PipelineError(code, message); }
function digestBytes(value) { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
function digest(value, label) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value ?? '')) fail('E_BROWSER_QA_ATTESTATION_INVALID', `${label} must be an exact SHA-256 digest.`);
}
function identifier(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) fail('E_BROWSER_QA_ATTESTATION_INVALID', `${label} must be a closed identifier.`);
}
function canonicalDate(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('E_BROWSER_QA_ATTESTATION_INVALID', `${label} must be a canonical timestamp.`);
}
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail('E_BROWSER_QA_EVIDENCE_INVALID', `${label} has missing or unknown fields.`);
  }
}
function bytes(value, label) {
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) fail('E_BROWSER_QA_EVIDENCE_INVALID', `${label} must be engine-owned bytes.`);
  const result = Buffer.from(value);
  if (result.length > MAX_ARTIFACT_BYTES) fail('E_BROWSER_QA_EVIDENCE_INVALID', `${label} exceeds the bounded artifact size.`);
  return result;
}

function countArtifact(value, label) {
  const raw = bytes(value, label);
  let events;
  try { events = JSON.parse(raw.toString('utf8')); } catch { fail('E_BROWSER_QA_EVIDENCE_INVALID', `${label} is not one JSON event array.`); }
  if (!Array.isArray(events) || events.length > MAX_COUNT_EVENTS) fail('E_BROWSER_QA_EVIDENCE_INVALID', `${label} is not a bounded event array.`);
  const ids = new Set();
  let failureCount = 0;
  for (const [index, event] of events.entries()) {
    exact(event, ['id', 'status'], `${label}[${index}]`);
    identifier(event.id, `${label}[${index}].id`);
    if (!['passed', 'failed'].includes(event.status) || ids.has(event.id)) fail('E_BROWSER_QA_EVIDENCE_INVALID', `${label} contains a duplicate or unsupported event.`);
    ids.add(event.id);
    if (event.status === 'failed') failureCount += 1;
  }
  return { failureCount, evidenceDigest: digestBytes(raw), byteLength: raw.length };
}

function binaryArtifacts(values, label) {
  if (!Array.isArray(values) || values.length > 256) fail('E_BROWSER_QA_EVIDENCE_INVALID', `${label} must be a bounded artifact array.`);
  const ids = new Set();
  let byteLength = 0;
  const claims = values.map((entry, index) => {
    exact(entry, ['bytes', 'id'], `${label}[${index}]`);
    identifier(entry.id, `${label}[${index}].id`);
    if (ids.has(entry.id)) fail('E_BROWSER_QA_EVIDENCE_INVALID', `${label} contains duplicate artifact IDs.`);
    ids.add(entry.id);
    const raw = bytes(entry.bytes, `${label}[${index}].bytes`);
    byteLength += raw.length;
    return { id: entry.id, contentDigest: digestBytes(raw) };
  });
  return { claims, byteLength };
}

function evidenceClaims(artifacts) {
  exact(artifacts, ['accessibility', 'console', 'network', 'screenshots', 'traces'], 'browser evidence bundle');
  const accessibility = countArtifact(artifacts.accessibility, 'accessibility evidence');
  const console = countArtifact(artifacts.console, 'console evidence');
  const network = countArtifact(artifacts.network, 'network evidence');
  const screenshots = binaryArtifacts(artifacts.screenshots, 'screenshot evidence');
  const traces = binaryArtifacts(artifacts.traces, 'trace evidence');
  const totalBytes = accessibility.byteLength + console.byteLength + network.byteLength + screenshots.byteLength + traces.byteLength;
  if (totalBytes > MAX_BUNDLE_BYTES) fail('E_BROWSER_QA_EVIDENCE_INVALID', 'Browser evidence bundle exceeds the bounded total size.');
  const claims = {
    accessibility: { failureCount: accessibility.failureCount, evidenceDigest: accessibility.evidenceDigest },
    console: { failureCount: console.failureCount, evidenceDigest: console.evidenceDigest },
    network: { failureCount: network.failureCount, evidenceDigest: network.evidenceDigest },
    screenshots: screenshots.claims,
    traces: traces.claims,
  };
  return { claims, evidenceBundleDigest: sha256Jcs(claims) };
}

function assertClaims(result, claims) {
  for (const key of ['accessibility', 'console', 'network', 'screenshots', 'traces']) {
    if (JSON.stringify(result?.[key]) !== JSON.stringify(claims[key])) {
      fail('E_BROWSER_QA_EVIDENCE_MISMATCH', `Browser result ${key} claims do not match engine-owned artifact bytes.`);
    }
  }
}

export function createTrustedBrowserQaRuntimeHost({ hostId, hostVersion } = {}) {
  identifier(hostId, 'hostId');
  if (typeof hostVersion !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(hostVersion)) fail('E_BROWSER_QA_HOST_UNTRUSTED', 'Browser runtime host version is invalid.');
  const host = Object.freeze({ kind: 'browser-qa-runtime-host', hostId, hostVersion });
  trustedHosts.add(host);
  return host;
}

export function establishBrowserQaRuntimeCapability({
  host, candidateDigest, requirementDigest, sessionBindingDigest, sessionId, signedIn,
  issuedAt, expiresAt,
} = {}) {
  if (!trustedHosts.has(host)) fail('E_BROWSER_QA_HOST_UNTRUSTED', 'Browser evidence requires an engine-owned runtime host configuration.');
  digest(candidateDigest, 'candidateDigest');
  digest(requirementDigest, 'requirementDigest');
  digest(sessionBindingDigest, 'sessionBindingDigest');
  identifier(sessionId, 'sessionId');
  if (typeof signedIn !== 'boolean') fail('E_BROWSER_QA_ATTESTATION_INVALID', 'Browser session signedIn binding is invalid.');
  canonicalDate(issuedAt, 'issuedAt');
  canonicalDate(expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(issuedAt) || Date.parse(expiresAt) - Date.parse(issuedAt) > 60 * 60 * 1000) {
    fail('E_BROWSER_QA_ATTESTATION_STALE', 'Browser runtime capability must expire within one hour.');
  }
  const capability = Object.freeze({
    kind: 'browser-qa-runtime-capability', capabilityId: `bqc_${randomUUID().replaceAll('-', '')}`,
    hostId: host.hostId, hostVersion: host.hostVersion, candidateDigest, requirementDigest,
    sessionBindingDigest, sessionId, signedIn, issuedAt, expiresAt,
  });
  runtimeCapabilities.add(capability);
  return capability;
}

export function attestBrowserQaEvidence({ capability, result, artifacts, now = new Date().toISOString() } = {}) {
  if (!runtimeCapabilities.has(capability)) fail('E_BROWSER_QA_ATTESTATION_REQUIRED', 'Browser evidence requires a runtime capability established before the result.');
  canonicalDate(now, 'now');
  if (Date.parse(now) < Date.parse(capability.issuedAt) || Date.parse(now) >= Date.parse(capability.expiresAt)) {
    fail('E_BROWSER_QA_ATTESTATION_STALE', 'Browser runtime capability is stale.');
  }
  if (result?.candidateDigest !== capability.candidateDigest || result?.requirementDigest !== capability.requirementDigest
    || result?.signedIn !== capability.signedIn || (result.signedIn && result.sessionId !== capability.sessionId)
    || (!result.signedIn && result.sessionId !== null)) {
    fail('E_BROWSER_QA_ATTESTATION_FOREIGN', 'Browser result is foreign to the established runtime capability.');
  }
  const custody = evidenceClaims(artifacts);
  assertClaims(result, custody.claims);
  const core = {
    kind: 'browser-qa-host-attestation', schemaVersion: '1.0.0',
    attestationId: `bqa_${randomUUID().replaceAll('-', '')}`,
    capabilityId: capability.capabilityId, hostId: capability.hostId, hostVersion: capability.hostVersion,
    candidateDigest: capability.candidateDigest, requirementDigest: capability.requirementDigest,
    sessionBindingDigest: capability.sessionBindingDigest, resultDigest: sha256Jcs(result),
    evidenceBundleDigest: custody.evidenceBundleDigest, issuedAt: now, expiresAt: capability.expiresAt,
  };
  const attestation = Object.freeze({ ...core, attestationDigest: sha256Jcs(core) });
  issuedAttestations.add(attestation);
  return attestation;
}

export function assertBrowserQaEvidenceAttestation(attestation, {
  result, candidateDigest, requirementDigest, sessionBindingDigest, now = new Date().toISOString(),
} = {}) {
  if (!issuedAttestations.has(attestation)) fail('E_BROWSER_QA_ATTESTATION_REQUIRED', 'Browser evidence requires the original runtime-issued host attestation.');
  canonicalDate(now, 'now');
  if (Date.parse(now) < Date.parse(attestation.issuedAt) || Date.parse(now) >= Date.parse(attestation.expiresAt)) fail('E_BROWSER_QA_ATTESTATION_STALE', 'Browser host attestation is stale.');
  if (attestation.candidateDigest !== candidateDigest || attestation.requirementDigest !== requirementDigest
    || attestation.sessionBindingDigest !== sessionBindingDigest || attestation.resultDigest !== sha256Jcs(result)) {
    fail('E_BROWSER_QA_ATTESTATION_FOREIGN', 'Browser host attestation does not bind the exact result, candidate, requirement, and ephemeral session.');
  }
  const { attestationDigest, ...core } = attestation;
  if (attestationDigest !== sha256Jcs(core)) fail('E_BROWSER_QA_ATTESTATION_INVALID', 'Browser host attestation digest is invalid.');
  return attestation;
}
