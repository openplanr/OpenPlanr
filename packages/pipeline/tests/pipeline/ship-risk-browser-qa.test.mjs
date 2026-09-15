import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import * as publicPipeline from '../../lib/pipeline/index.mjs';
import {
  assertBrowserQaGateRecord,
  assertBrowserQaResult,
  assertBrowserQaSession,
  assertSpecialistReviewResult,
  classifyShipRisk,
  issueBrowserQaGateRecord,
  shipReviewSpecialistRegistry,
} from '../../lib/pipeline/index.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  attestBrowserQaEvidence,
  createTrustedBrowserQaRuntimeHost,
  establishBrowserQaRuntimeCapability,
} from '../../lib/pipeline/browser-qa-custody.mjs';
import {
  assertBrowserQaRecordedEventAuthority,
  issueBrowserQaRecordedEvent,
} from '../../lib/pipeline/browser-qa.mjs';

const digest = (value) => sha256Jcs(value);
const digestBytes = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const subjectDigest = `sha256:${'a'.repeat(64)}`;
const eventBytes = (events) => Buffer.from(JSON.stringify(events), 'utf8');

function artifacts() {
  return {
    accessibility: eventBytes([{ id: 'axe-main', status: 'passed' }]),
    console: eventBytes([]),
    network: eventBytes([{ id: 'review-get', status: 'passed' }]),
    screenshots: [{ id: 'review-mobile', bytes: Buffer.from('real screenshot bytes') }],
    traces: [{ id: 'review-trace', bytes: Buffer.from('real trace bytes') }],
  };
}

function claims(bundle) {
  return {
    accessibility: { failureCount: 0, evidenceDigest: digestBytes(bundle.accessibility) },
    console: { failureCount: 0, evidenceDigest: digestBytes(bundle.console) },
    network: { failureCount: 0, evidenceDigest: digestBytes(bundle.network) },
    screenshots: bundle.screenshots.map(({ id, bytes }) => ({ id, contentDigest: digestBytes(bytes) })),
    traces: bundle.traces.map(({ id, bytes }) => ({ id, contentDigest: digestBytes(bytes) })),
  };
}

function input(overrides = {}) {
  return {
    subjectDigest,
    changedPaths: [], browserSurfaces: [], contractChanges: false,
    migrationChanges: false, permissionEffects: false, dataWrites: false,
    performanceBudgets: false, explicitRisks: [], ...overrides,
  };
}

function result(classification, overrides = {}) {
  const evidence = claims(artifacts());
  return {
    kind: 'browser-qa-result', schemaVersion: '1.0.0',
    candidateDigest: subjectDigest,
    requirementDigest: classification.browserQa.requirementDigest,
    status: 'passed', signedIn: false, sessionId: null,
    origin: 'http://127.0.0.1:7473', routeIds: ['review'], formIds: ['decision'],
    viewports: [{ id: 'mobile', width: 320, height: 800, horizontalOverflow: false }],
    ...evidence, failures: [],
    ...overrides,
  };
}

function session({ signedIn = false } = {}) {
  return {
    kind: 'browser-qa-session', schemaVersion: '1.0.0',
    sessionId: `bqs_${'b'.repeat(32)}`, suppliedAt: '2026-08-24T10:00:00.000Z',
    expiresAt: '2026-08-24T10:30:00.000Z', signedIn,
    custody: 'external-ephemeral', persisted: false,
  };
}

function attestation(classification, browserResult, browserSession, evidence = artifacts(), overrides = {}) {
  const host = createTrustedBrowserQaRuntimeHost({ hostId: 'playwright-host', hostVersion: '1.0.0' });
  const capability = establishBrowserQaRuntimeCapability({
    host, candidateDigest: subjectDigest, requirementDigest: classification.browserQa.requirementDigest,
    sessionBindingDigest: digest(browserSession), sessionId: browserSession.sessionId,
    signedIn: browserSession.signedIn, issuedAt: '2026-08-24T10:05:00.000Z',
    expiresAt: browserSession.expiresAt, ...overrides,
  });
  return attestBrowserQaEvidence({ capability, result: browserResult, artifacts: evidence, now: '2026-08-24T10:06:00.000Z' });
}

test('risk selection is permutation-stable and follows the fixed specialist registry order', () => {
  assert.equal(Object.hasOwn(publicPipeline, 'createTrustedBrowserQaRuntimeHost'), false);
  assert.equal(Object.hasOwn(publicPipeline, 'establishBrowserQaRuntimeCapability'), false);
  assert.equal(Object.hasOwn(publicPipeline, 'attestBrowserQaEvidence'), false);
  assert.equal(Object.hasOwn(publicPipeline, 'issueBrowserQaRecordedEvent'), false);
  assert.deepEqual(shipReviewSpecialistRegistry().specialists.map(({ id }) => id), [
    'security', 'performance', 'migration', 'api-contract', 'data-integrity',
  ]);
  const left = classifyShipRisk(input({
    changedPaths: [
      { repositoryKey: 'project', path: 'src/dashboard/App.tsx' },
      { repositoryKey: 'project', path: 'schemas/v1/api.schema.json' },
      { repositoryKey: 'project', path: 'migrations/001.sql' },
    ], permissionEffects: true, performanceBudgets: true,
  }));
  const right = classifyShipRisk(input({
    changedPaths: [
      { repositoryKey: 'project', path: 'migrations/001.sql' },
      { repositoryKey: 'project', path: 'src/dashboard/App.tsx' },
      { repositoryKey: 'project', path: 'schemas/v1/api.schema.json' },
    ], permissionEffects: true, performanceBudgets: true,
  }));
  assert.equal(left.classificationDigest, right.classificationDigest);
  assert.deepEqual(left.reviewerRoster, ['qa-agent', 'security', 'performance', 'migration', 'api-contract', 'data-integrity']);
  assert.equal(left.browserQa.required, true);
  assert.deepEqual(left.browserQa.triggers, ['ui']);
  assert.throws(() => classifyShipRisk(input({ changedPaths: [{ repositoryKey: 'project', path: '../secret' }] })), { code: 'E_SHIP_RISK_PATH_INVALID' });
  assert.throws(() => classifyShipRisk(input({ explicitRisks: ['security', 'security'] })), { code: 'E_SHIP_RISK_INPUT_INVALID' });
});

test('specialist results bind the selected candidate and grant contribution-only authority', () => {
  const classification = classifyShipRisk(input({ explicitRisks: ['security'] }));
  const value = {
    kind: 'specialist-review-result', schemaVersion: '1.0.0', protocolVersion: '1.1.0',
    specialistId: 'security', candidateDigest: subjectDigest,
    classificationDigest: classification.classificationDigest,
    summary: 'The bounded security review is complete.', findingIds: [],
    evidenceDigest: digest('security-evidence'), authority: 'contribution-only',
  };
  assert.equal(assertSpecialistReviewResult(value, { classification, candidateDigest: subjectDigest }), value);
  assert.throws(() => assertSpecialistReviewResult({ ...value, authority: 'correction' }, { classification, candidateDigest: subjectDigest }), { code: 'E_SHIP_SPECIALIST_RESULT_INVALID' });
});

test('signed-in browser evidence consumes a fresh ephemeral session but persists only its digest', () => {
  const classification = classifyShipRisk(input({ browserSurfaces: ['authentication'] }));
  const browserSession = session({ signedIn: true });
  assert.equal(assertBrowserQaSession(browserSession, { now: '2026-08-24T10:05:00.000Z' }), browserSession);
  const signedIn = result(classification, { signedIn: true, sessionId: browserSession.sessionId });
  assertBrowserQaResult(signedIn, {
    candidateDigest: subjectDigest, requirementDigest: classification.browserQa.requirementDigest,
    required: true, session: browserSession, now: '2026-08-24T10:05:00.000Z',
  });
  const proof = attestation(classification, signedIn, browserSession);
  const record = issueBrowserQaGateRecord({
    result: signedIn, session: browserSession, attestation: proof, required: true, candidateRevision: 1,
    candidateDigest: subjectDigest, requirementDigest: classification.browserQa.requirementDigest,
    now: '2026-08-24T10:06:00.000Z',
  });
  assert.equal(record.status, 'passed');
  assert.equal(Object.hasOwn(record, 'sessionId'), false);
  assert.equal(record.sessionBindingDigest, digest(browserSession));
  assert.equal(record.attestationDigest, proof.attestationDigest);
  assert.equal(record.evidenceBundleDigest, proof.evidenceBundleDigest);
  assert.equal(assertBrowserQaGateRecord(record, { requireAttested: true }), record);

  const {
    custodyVersion: _custodyVersion,
    attestationHostId: _attestationHostId,
    attestationHostVersion: _attestationHostVersion,
    attestationDigest: _attestationDigest,
    evidenceBundleDigest: _evidenceBundleDigest,
    recordDigest: _recordDigest,
    ...legacyCore
  } = record;
  const legacy = { ...legacyCore, recordDigest: digest(legacyCore) };
  assert.equal(assertBrowserQaGateRecord(legacy), legacy, 'historical unattested records remain readable');
  assert.throws(
    () => assertBrowserQaGateRecord(legacy, { requireAttested: true }),
    { code: 'E_BROWSER_QA_ATTESTATION_REQUIRED' },
  );
  assert.throws(() => assertBrowserQaResult(signedIn, {
    candidateDigest: subjectDigest, requirementDigest: classification.browserQa.requirementDigest,
    required: true, session: null,
  }), { code: 'E_BROWSER_QA_SESSION_REQUIRED' });
});

test('caller-authored, rehashed, substituted, stale, foreign, and mismatched browser evidence cannot certify PASS', () => {
  const classification = classifyShipRisk(input({ browserSurfaces: ['ui'] }));
  const browserSession = session();
  const browserResult = result(classification);
  assert.throws(() => establishBrowserQaRuntimeCapability({
    host: { kind: 'browser-qa-runtime-host', hostId: 'caller-host', hostVersion: '1.0.0' },
    candidateDigest: subjectDigest, requirementDigest: classification.browserQa.requirementDigest,
    sessionBindingDigest: digest(browserSession), sessionId: browserSession.sessionId, signedIn: false,
    issuedAt: '2026-08-24T10:05:00.000Z', expiresAt: browserSession.expiresAt,
  }), { code: 'E_BROWSER_QA_HOST_UNTRUSTED' });
  assert.throws(() => issueBrowserQaGateRecord({
    result: browserResult, session: browserSession, required: true, candidateRevision: 1,
    candidateDigest: subjectDigest, requirementDigest: classification.browserQa.requirementDigest,
    now: '2026-08-24T10:06:00.000Z',
  }), { code: 'E_BROWSER_QA_ATTESTATION_REQUIRED' });

  const proof = attestation(classification, browserResult, browserSession);
  const issuedRecord = issueBrowserQaGateRecord({
    result: browserResult, session: browserSession, attestation: proof, required: true, candidateRevision: 1,
    candidateDigest: subjectDigest, requirementDigest: classification.browserQa.requirementDigest,
    now: '2026-08-24T10:06:00.000Z',
  });
  const forgedRecord = structuredClone(issuedRecord);
  assert.equal(assertBrowserQaGateRecord(forgedRecord, { requireAttested: true }), forgedRecord);
  assert.throws(
    () => issueBrowserQaRecordedEvent({ expectedGeneration: 4, record: forgedRecord }),
    { code: 'E_BROWSER_QA_EVENT_AUTHORITY_REQUIRED' },
  );
  const issuedEvent = issueBrowserQaRecordedEvent({ expectedGeneration: 4, record: issuedRecord });
  assert.equal(assertBrowserQaRecordedEventAuthority(issuedEvent.authority, issuedEvent.event), issuedEvent.authority);
  assert.throws(
    () => assertBrowserQaRecordedEventAuthority({ ...issuedEvent.authority }, issuedEvent.event),
    { code: 'E_BROWSER_QA_EVENT_AUTHORITY_REQUIRED' },
  );
  assert.throws(
    () => assertBrowserQaRecordedEventAuthority(issuedEvent.authority, { ...issuedEvent.event, expectedGeneration: 5 }),
    { code: 'E_BROWSER_QA_EVENT_AUTHORITY_REQUIRED' },
  );
  const rehashed = structuredClone(proof);
  const { attestationDigest: _priorDigest, ...rehashedCore } = rehashed;
  rehashed.attestationDigest = digest(rehashedCore);
  assert.throws(() => issueBrowserQaGateRecord({
    result: browserResult, session: browserSession, attestation: rehashed, required: true, candidateRevision: 1,
    candidateDigest: subjectDigest, requirementDigest: classification.browserQa.requirementDigest,
    now: '2026-08-24T10:06:00.000Z',
  }), { code: 'E_BROWSER_QA_ATTESTATION_REQUIRED' });

  const substituted = { ...browserResult, routeIds: ['foreign-route'] };
  assert.throws(() => issueBrowserQaGateRecord({
    result: substituted, session: browserSession, attestation: proof, required: true, candidateRevision: 1,
    candidateDigest: subjectDigest, requirementDigest: classification.browserQa.requirementDigest,
    now: '2026-08-24T10:06:00.000Z',
  }), { code: 'E_BROWSER_QA_ATTESTATION_FOREIGN' });

  const mismatched = artifacts();
  mismatched.screenshots[0].bytes = Buffer.from('substituted screenshot bytes');
  assert.throws(() => attestation(classification, browserResult, browserSession, mismatched), { code: 'E_BROWSER_QA_EVIDENCE_MISMATCH' });
  assert.throws(() => attestation(classification, browserResult, browserSession, artifacts(), {
    candidateDigest: `sha256:${'c'.repeat(64)}`,
  }), { code: 'E_BROWSER_QA_ATTESTATION_FOREIGN' });

  const host = createTrustedBrowserQaRuntimeHost({ hostId: 'stale-host', hostVersion: '1.0.0' });
  const staleCapability = establishBrowserQaRuntimeCapability({
    host, candidateDigest: subjectDigest, requirementDigest: classification.browserQa.requirementDigest,
    sessionBindingDigest: digest(browserSession), sessionId: browserSession.sessionId, signedIn: false,
    issuedAt: '2026-08-24T10:00:00.000Z', expiresAt: '2026-08-24T10:05:00.000Z',
  });
  assert.throws(() => attestBrowserQaEvidence({
    capability: staleCapability, result: browserResult, artifacts: artifacts(), now: '2026-08-24T10:06:00.000Z',
  }), { code: 'E_BROWSER_QA_ATTESTATION_STALE' });
});

test('mandatory unavailability blocks and unsafe/private browser evidence fails closed', () => {
  const classification = classifyShipRisk(input({ browserSurfaces: ['network'] }));
  const unavailable = result(classification, { status: 'unavailable', routeIds: [], formIds: [], viewports: [], screenshots: [], traces: [] });
  const record = issueBrowserQaGateRecord({
    result: unavailable, required: true, candidateRevision: 1,
    candidateDigest: subjectDigest, requirementDigest: classification.browserQa.requirementDigest,
  });
  assert.equal(record.status, 'blocked');
  assert.equal(assertBrowserQaGateRecord(record, { requireAttested: true }), record, 'unavailable mandatory evidence may block without fabricated custody');
  assert.throws(() => issueBrowserQaGateRecord({
    result: { ...unavailable, status: 'skipped' }, required: true, candidateRevision: 1,
    candidateDigest: subjectDigest, requirementDigest: classification.browserQa.requirementDigest,
  }), { code: 'E_BROWSER_QA_REQUIRED' });
  assert.throws(() => assertBrowserQaResult({ ...unavailable, origin: 'https://user:secret@example.com' }, {
    candidateDigest: subjectDigest, requirementDigest: classification.browserQa.requirementDigest, required: true,
  }), { code: 'E_BROWSER_QA_ORIGIN_UNSAFE' });
});
