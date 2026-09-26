import { validateProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';
import { assertBrowserQaEvidenceAttestation } from './browser-qa-custody.mjs';
import { PipelineError } from './errors.mjs';

const ISSUED_COMPLETED_GATE_RECORDS = new WeakSet();
const RECORDED_EVENT_AUTHORITIES = new WeakMap();

function fail(code, message) {
  throw new PipelineError(code, message);
}
function schema(kind, value, code) {
  const errors = validateProtocolArtifact(kind, value, { protocolVersion: '1.1.0' });
  if (errors.length) fail(code, `${errors[0].path}: ${errors[0].detail}`);
}
function assertSafe(value, path = '$') {
  if (typeof value === 'string') {
    if (
      /(?:-----BEGIN .*PRIVATE KEY-----|\b(?:authorization|cookie|password|secret|token)\s*[:=]|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|\/(?:Users|home)\/|[A-Za-z]:\\)/iu.test(
        value,
      )
    ) {
      fail(
        'E_BROWSER_QA_PRIVATE_DATA',
        `${path} contains credential-like or machine-private text.`,
      );
    }
  } else if (Array.isArray(value))
    value.forEach((entry, index) => assertSafe(entry, `${path}[${index}]`));
  else if (value && typeof value === 'object')
    Object.entries(value).forEach(([key, entry]) => assertSafe(entry, `${path}.${key}`));
}
function assertOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    fail('E_BROWSER_QA_ORIGIN_UNSAFE', 'Browser QA origin is not a valid URL origin.');
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.origin !== origin
  ) {
    fail(
      'E_BROWSER_QA_ORIGIN_UNSAFE',
      'Browser QA origin must be an exact HTTPS origin or HTTP loopback origin with no credentials/query/fragment/path.',
    );
  }
}

export function assertBrowserQaSession(value, { now = new Date().toISOString() } = {}) {
  schema('browser-qa-session', value, 'E_BROWSER_QA_SESSION_INVALID');
  assertSafe(value);
  const supplied = Date.parse(value.suppliedAt);
  const expires = Date.parse(value.expiresAt);
  const current = Date.parse(now);
  if (
    ![supplied, expires, current].every(Number.isFinite) ||
    supplied > current ||
    expires <= current ||
    expires - supplied > 60 * 60 * 1000
  ) {
    fail(
      'E_BROWSER_QA_SESSION_STALE',
      'Ephemeral browser session must be current and expire within one hour of supply.',
    );
  }
  return value;
}

export function assertBrowserQaResult(
  value,
  { candidateDigest, requirementDigest, required, session = null, now } = {},
) {
  schema('browser-qa-result', value, 'E_BROWSER_QA_RESULT_INVALID');
  assertSafe(value);
  assertOrigin(value.origin);
  if (value.candidateDigest !== candidateDigest || value.requirementDigest !== requirementDigest) {
    fail(
      'E_BROWSER_QA_RESULT_FOREIGN',
      'Browser QA result does not bind the exact candidate and frozen requirement.',
    );
  }
  if (value.signedIn) {
    if (session === null)
      fail(
        'E_BROWSER_QA_SESSION_REQUIRED',
        'A signed-in browser journey requires an explicitly supplied ephemeral session.',
      );
    assertBrowserQaSession(session, { now });
    if (!session.signedIn || session.sessionId !== value.sessionId)
      fail(
        'E_BROWSER_QA_SESSION_FOREIGN',
        'Browser result does not bind the supplied signed-in session.',
      );
  } else if (value.sessionId !== null)
    fail(
      'E_BROWSER_QA_SESSION_INVALID',
      'Anonymous browser results cannot retain a session identity.',
    );
  if (required && value.status === 'skipped')
    fail('E_BROWSER_QA_REQUIRED', 'Mandatory browser QA cannot be skipped.');
  const hasFailures =
    value.failures.length > 0 ||
    value.accessibility.failureCount > 0 ||
    value.console.failureCount > 0 ||
    value.network.failureCount > 0 ||
    value.viewports.some(({ horizontalOverflow }) => horizontalOverflow);
  if (value.status === 'passed' && hasFailures)
    fail(
      'E_BROWSER_QA_RESULT_INVALID',
      'A passing browser result cannot contain failing evidence.',
    );
  return value;
}

export function issueBrowserQaGateRecord({
  result,
  session = null,
  attestation = null,
  required,
  candidateRevision,
  candidateDigest,
  requirementDigest,
  now,
} = {}) {
  assertBrowserQaResult(result, { candidateDigest, requirementDigest, required, session, now });
  const sessionBindingDigest = session === null ? null : sha256Jcs(session);
  const requiresAttestation = ['passed', 'failed'].includes(result.status);
  if (requiresAttestation && attestation === null) {
    fail(
      'E_BROWSER_QA_ATTESTATION_REQUIRED',
      'Completed browser evidence requires one engine-owned runtime host attestation.',
    );
  }
  if (!requiresAttestation && attestation !== null) {
    fail(
      'E_BROWSER_QA_ATTESTATION_INVALID',
      'Unavailable or skipped browser results cannot carry a completed host attestation.',
    );
  }
  if (attestation !== null) {
    if (sessionBindingDigest === null)
      fail(
        'E_BROWSER_QA_SESSION_REQUIRED',
        'Attested browser evidence requires an explicitly supplied ephemeral session.',
      );
    assertBrowserQaEvidenceAttestation(attestation, {
      result,
      candidateDigest,
      requirementDigest,
      sessionBindingDigest,
      now,
    });
  }
  const status =
    result.status === 'passed'
      ? 'passed'
      : required && ['unavailable', 'skipped'].includes(result.status)
        ? 'blocked'
        : result.status;
  const record = {
    kind: 'browser-qa-gate',
    schemaVersion: '1.0.0',
    protocolVersion: '1.1.0',
    candidateRevision,
    candidateDigest,
    requirementDigest,
    required,
    status,
    sessionBindingDigest,
    resultDigest: sha256Jcs(result),
    ...(attestation === null
      ? {}
      : {
          custodyVersion: '1.0.0',
          attestationHostId: attestation.hostId,
          attestationHostVersion: attestation.hostVersion,
          attestationDigest: attestation.attestationDigest,
          evidenceBundleDigest: attestation.evidenceBundleDigest,
        }),
  };
  const issued = { ...record, recordDigest: sha256Jcs(record) };
  schema('browser-qa-gate', issued, 'E_BROWSER_QA_GATE_INVALID');
  const frozen = Object.freeze(issued);
  if (requiresAttestation) ISSUED_COMPLETED_GATE_RECORDS.add(frozen);
  return frozen;
}

/**
 * Issue the non-portable authority that permits one completed browser record to
 * cross the generic SHIP event boundary. The durable event stays replayable,
 * while the authority remains an in-memory capability that callers cannot
 * reproduce from record JSON or digests.
 */
export function issueBrowserQaRecordedEvent({ expectedGeneration, record } = {}) {
  if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) {
    fail(
      'E_BROWSER_QA_EVENT_AUTHORITY_INVALID',
      'Browser QA event authority requires one non-negative closure generation.',
    );
  }
  assertBrowserQaGateRecord(record, { requireAttested: true });
  if (['passed', 'failed'].includes(record.status) && !ISSUED_COMPLETED_GATE_RECORDS.has(record)) {
    fail(
      'E_BROWSER_QA_EVENT_AUTHORITY_REQUIRED',
      'Completed browser QA custody must originate from the trusted runtime attestation path.',
    );
  }
  const event = Object.freeze({ type: 'browser-qa.recorded', expectedGeneration, record });
  const authority = Object.freeze({ kind: 'browser-qa-recorded-event-authority' });
  RECORDED_EVENT_AUTHORITIES.set(authority, {
    expectedGeneration,
    recordDigest: record.recordDigest,
  });
  return Object.freeze({ event, authority });
}

export function assertBrowserQaRecordedEventAuthority(authority, event) {
  if (!['passed', 'failed'].includes(event?.record?.status)) return null;
  const binding =
    authority && typeof authority === 'object'
      ? RECORDED_EVENT_AUTHORITIES.get(authority)
      : undefined;
  if (
    !binding ||
    binding.expectedGeneration !== event.expectedGeneration ||
    binding.recordDigest !== event.record.recordDigest
  ) {
    fail(
      'E_BROWSER_QA_EVENT_AUTHORITY_REQUIRED',
      'Completed browser QA events require the exact runtime-issued persistence authority.',
    );
  }
  return authority;
}

export function assertBrowserQaGateRecord(value, { requireAttested = false } = {}) {
  schema('browser-qa-gate', value, 'E_BROWSER_QA_GATE_INVALID');
  const { recordDigest, ...record } = value;
  if (recordDigest !== sha256Jcs(record))
    fail('E_BROWSER_QA_GATE_INVALID', 'Browser QA gate record digest is invalid.');
  if (value.required && value.status === 'skipped')
    fail('E_BROWSER_QA_GATE_INVALID', 'Mandatory browser QA cannot be stored as skipped.');
  const custodyFields = [
    'custodyVersion',
    'attestationHostId',
    'attestationHostVersion',
    'attestationDigest',
    'evidenceBundleDigest',
  ];
  const present = custodyFields.filter((field) => Object.hasOwn(value, field));
  if (present.length !== 0 && present.length !== custodyFields.length)
    fail(
      'E_BROWSER_QA_GATE_INVALID',
      'Browser QA attestation custody must be complete or absent for legacy readability.',
    );
  if (
    present.length === custodyFields.length &&
    (value.custodyVersion !== '1.0.0' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value.attestationHostId) ||
      !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value.attestationHostVersion))
  ) {
    fail('E_BROWSER_QA_GATE_INVALID', 'Browser QA attestation custody identity is invalid.');
  }
  if (
    requireAttested &&
    ['passed', 'failed'].includes(value.status) &&
    present.length !== custodyFields.length
  ) {
    fail(
      'E_BROWSER_QA_ATTESTATION_REQUIRED',
      'New completed browser QA evidence must carry complete runtime host attestation custody.',
    );
  }
  return value;
}
