import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canonicalizeJson,
  createOperatingCheckpoint,
  createOperatingCheckpointSigningPayload,
  createOperatingEvent,
  reduceOperatingEvents,
  resumeOperatingProjection,
  sha256Jcs,
  validateOperatingCheckpoint,
  verifyOperatingEventChain,
} from '../../lib/pipeline/index.mjs';
import { buildOperatingFixture } from '../helpers/operatingFixture.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const digest = (character) => `sha256:${character.repeat(64)}`;

test('operating reducer produces the checked-in read-only dashboard projection', () => {
  const { events, state } = buildOperatingFixture();
  const expected = readJson(
    'conformance/fixtures/operating-dashboard/.planr/operate/projections/state.json',
  );
  assert.deepEqual(reduceOperatingEvents(events), expected);
  assert.deepEqual(state, expected);
  assert.equal(state.cycles[0].state, 'reviewable');
  assert.equal(state.routes[0].state, 'prepared');
  assert.equal(state.routes[0].confirmationDigest, digest('4'));
  assert.equal(state.summary.currentConstraint, 'Protect payment webhook idempotency');
  assert.equal(state.findings[0].problem, 'The payment handler has no durable replay guard.');
  assert.equal(
    state.findings[0].proposal,
    'Create a reviewed idempotency-ledger specification.',
  );
  assert.deepEqual(state.outcomes[0], {
    id: 'OUT-001',
    specId: 'SPEC-003',
    status: 'positive',
    metric: 'payments.webhook_duplicate_effects',
    verifyAfter: '2026-08-15',
    lastObservationId: 'OBS-001',
    lastObservationEvaluation: 'positive',
    updatedAt: '2026-07-28T09:11:45Z',
  });
});

test('lifecycle audit fields survive reduction without weakening strict event payloads', () => {
  const { events } = buildOperatingFixture();
  const append = (type, entityId, payload) => {
    const previousEvent = events.at(-1);
    const event = createOperatingEvent({
      eventId: `evt-audit-${events.length + 1}`,
      timestamp: `2026-07-28T09:${String(events.length + 1).padStart(2, '0')}:00Z`,
      cycleId: 'CYCLE-001',
      type,
      entityId,
      actor: { kind: 'human', id: 'founder' },
      causationId: null,
      correlationId: 'audit-lifecycle',
      evidenceRefs: [],
      payload,
    }, { previousEvent });
    events.push(event);
    return event;
  };
  append('finding.rejected', 'FND-001', {
    patch: {},
    reason: 'The expected impact is not supported by current evidence.',
  });
  const answered = append('decision.answered', 'DEC-001', {
    patch: { selectedOption: 'B' },
    reason: 'Preserve runway until the reliability work is complete.',
  });
  append('decision.closed', 'DEC-001', {
    patch: { selectedOption: 'B' },
    answeredHead: { sequence: answered.sequence, hash: answered.eventHash },
  });
  append('gap.answered', 'GAP-001', {
    patch: { answer: 'The duplicate webhook rate is 0.4%.' },
  });
  append('cycle.closed', 'CYCLE-001', {
    patch: { completedAt: '2026-07-28T09:20:00Z' },
    warnings: ['One source remained stale at close.'],
  });

  const state = reduceOperatingEvents(events);
  assert.equal(
    state.findings[0].rejectionReason,
    'The expected impact is not supported by current evidence.',
  );
  assert.equal(
    state.decisions[0].note,
    'Preserve runway until the reliability work is complete.',
  );
  assert.equal(state.dataGaps[0].answer, 'The duplicate webhook rate is 0.4%.');
  assert.deepEqual(state.cycles[0].warnings, ['One source remained stale at close.']);
  assert.equal(state.cycles[0].completedAt, '2026-07-28T09:20:00Z');
});

test('cycle close rejects surfaced findings and owner decisions that are not disposed', () => {
  const { events } = buildOperatingFixture();
  const close = createOperatingEvent({
    eventId: 'evt-close-undisposed-cycle',
    timestamp: '2026-07-28T09:20:00Z',
    cycleId: 'CYCLE-001',
    type: 'cycle.closed',
    entityId: 'CYCLE-001',
    actor: { kind: 'human', id: 'founder' },
    correlationId: 'close-undisposed-cycle',
    evidenceRefs: [],
    payload: { patch: { completedAt: '2026-07-28T09:20:00Z' } },
  }, { previousEvent: events.at(-1) });

  assert.throws(
    () => reduceOperatingEvents([...events, close]),
    (error) =>
      error.code === 'E_OPERATE_STATE_INVALID'
      && /blocking findings: FND-001/.test(error.message)
      && /blocking decisions: DEC-001/.test(error.message),
  );

  const spoofedCycle = createOperatingEvent({
    ...close,
    eventId: 'evt-close-spoofed-cycle',
    cycleId: 'CYCLE-999',
  }, { previousEvent: events.at(-1) });
  assert.throws(
    () => reduceOperatingEvents([...events, spoofedCycle]),
    /entityId must match its cycleId/,
  );
});

test('cycle close accepts an applied route and a closed owner decision', () => {
  const { events } = buildOperatingFixture();
  const append = (input) => {
    const event = createOperatingEvent(input, { previousEvent: events.at(-1) });
    events.push(event);
    return event;
  };
  append({
    eventId: 'evt-close-route-applied',
    timestamp: '2026-07-28T09:13:00Z',
    cycleId: 'CYCLE-001',
    type: 'route.applied',
    entityId: 'ACT-001',
    actor: { kind: 'engine', id: 'openplanr' },
    correlationId: 'close-disposed-cycle',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      routeDigest: digest('e'),
      confirmationDigest: digest('4'),
      transactionId: 'TXN-route-close',
    },
  });
  const answered = append({
    eventId: 'evt-close-decision-answered',
    timestamp: '2026-07-28T09:14:00Z',
    cycleId: 'CYCLE-001',
    type: 'decision.answered',
    entityId: 'DEC-001',
    actor: { kind: 'human', id: 'founder' },
    correlationId: 'close-disposed-cycle',
    evidenceRefs: [],
    payload: { patch: { selectedOption: 'A' }, reason: null },
  });
  append({
    eventId: 'evt-close-decision-closed',
    timestamp: '2026-07-28T09:15:00Z',
    cycleId: 'CYCLE-001',
    type: 'decision.closed',
    entityId: 'DEC-001',
    actor: { kind: 'human', id: 'founder' },
    correlationId: 'close-disposed-cycle',
    evidenceRefs: [],
    payload: {
      patch: { selectedOption: 'A' },
      answeredHead: { sequence: answered.sequence, hash: answered.eventHash },
    },
  });
  append({
    eventId: 'evt-close-disposed-cycle',
    timestamp: '2026-07-28T09:16:00Z',
    cycleId: 'CYCLE-001',
    type: 'cycle.closed',
    entityId: 'CYCLE-001',
    actor: { kind: 'human', id: 'founder' },
    correlationId: 'close-disposed-cycle',
    evidenceRefs: [],
    payload: { patch: { completedAt: '2026-07-28T09:16:00Z' } },
  });

  assert.equal(reduceOperatingEvents(events).cycles[0].state, 'closed');
});

test('cycle cancellation replay is idempotent for an equivalent empty retry', () => {
  const { events } = buildOperatingFixture();
  const first = createOperatingEvent({
    eventId: 'evt-cycle-cancelled',
    timestamp: '2026-07-28T09:20:00Z',
    cycleId: 'CYCLE-001',
    type: 'cycle.cancelled',
    entityId: 'CYCLE-001',
    actor: { kind: 'human', id: 'founder' },
    correlationId: 'cancel-cycle',
    evidenceRefs: [],
    payload: {},
  }, { previousEvent: events.at(-1) });
  const retry = createOperatingEvent({
    eventId: 'evt-cycle-cancelled-retry',
    timestamp: '2026-07-28T09:21:00Z',
    cycleId: 'CYCLE-001',
    type: 'cycle.cancelled',
    entityId: 'CYCLE-001',
    actor: { kind: 'human', id: 'founder' },
    correlationId: 'cancel-cycle-retry',
    evidenceRefs: [],
    payload: {},
  }, { previousEvent: first });

  const state = reduceOperatingEvents([...events, first, retry]);
  assert.equal(state.cycles[0].state, 'cancelled');
  assert.equal(state.cycles[0].updatedAt, first.timestamp);
});

test('route proposals reject unknown and cross-cycle finding references', () => {
  const { events } = buildOperatingFixture();
  const prefix = events.slice(0, 9);
  const source = events.find((event) => event.type === 'route.proposed');
  const routeRecord = structuredClone(source.payload.record);
  routeRecord.id = 'ACT-002';
  routeRecord.actions[0].id = 'ACT-002';
  routeRecord.actions[0].findingId = 'FND-999';
  const unknown = createOperatingEvent({
    ...source,
    eventId: 'evt-route-unknown-finding',
    entityId: 'ACT-002',
    payload: { record: routeRecord },
  }, { previousEvent: prefix.at(-1) });
  assert.throws(
    () => reduceOperatingEvents([...prefix, unknown]),
    /references unknown finding FND-999/,
  );

  routeRecord.cycleId = 'CYCLE-002';
  routeRecord.actions[0].findingId = 'FND-001';
  const crossCycle = createOperatingEvent({
    ...source,
    eventId: 'evt-route-cross-cycle-finding',
    cycleId: 'CYCLE-002',
    entityId: 'ACT-002',
    payload: { record: routeRecord },
  }, { previousEvent: prefix.at(-1) });
  assert.throws(
    () => reduceOperatingEvents([...prefix, crossCycle]),
    /references finding FND-001 from cycle CYCLE-001; expected CYCLE-002/,
  );
});

test('finding lifecycle sensitivity is monotonic and evidence references are immutable', () => {
  const { events } = buildOperatingFixture();
  const transition = (eventId, patch) => createOperatingEvent({
    eventId,
    timestamp: '2026-07-28T09:12:00Z',
    cycleId: 'CYCLE-001',
    type: 'finding.rejected',
    entityId: 'FND-001',
    actor: { kind: 'human', id: 'founder' },
    causationId: null,
    correlationId: 'finding-sensitivity',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      patch,
      reason: 'The finding was reviewed against its immutable cited evidence.',
    },
  }, { previousEvent: events.at(-1) });

  const unchanged = reduceOperatingEvents([
    ...events,
    transition('evt-finding-sensitivity-unchanged', { sensitivity: 'internal' }),
  ]);
  assert.equal(unchanged.findings[0].sensitivity, 'internal');

  const raised = reduceOperatingEvents([
    ...events,
    transition('evt-finding-sensitivity-raised', { sensitivity: 'confidential' }),
  ]);
  assert.equal(raised.findings[0].sensitivity, 'confidential');

  assert.throws(
    () => reduceOperatingEvents([
      ...events,
      transition('evt-finding-sensitivity-lowered', { sensitivity: 'public' }),
    ]),
    /cannot lower finding sensitivity from internal to public/,
  );

  assert.throws(
    () => transition('evt-finding-evidence-replaced', {
      evidenceRefs: ['EVD-reclassified'],
    }),
    (error) => error.code === 'E_PROTOCOL_ARTIFACT_INVALID',
  );
});

test('event-chain verification rejects tampering, sequence gaps, and duplicate IDs', () => {
  const { events } = buildOperatingFixture();
  assert.deepEqual(verifyOperatingEventChain(events), events.at(-1) && {
    sequence: events.at(-1).sequence,
    hash: events.at(-1).eventHash,
  });

  const tampered = structuredClone(events);
  tampered[6].payload.record.title = 'Tampered after hashing';
  assert.throws(
    () => verifyOperatingEventChain(tampered),
    (error) => error.code === 'E_OPERATE_STATE_INVALID' && /hash check/.test(error.message),
  );

  const gap = structuredClone(events);
  gap[4].sequence += 1;
  assert.throws(() => verifyOperatingEventChain(gap), /Expected event sequence/);

  const duplicate = structuredClone(events);
  duplicate[1].eventId = duplicate[0].eventId;
  duplicate[1].eventHash = events[1].eventHash;
  assert.throws(() => verifyOperatingEventChain(duplicate), /Duplicate operating event ID/);
});

test('legacy import events advance the audit head without mutating operating projections', () => {
  const { events } = buildOperatingFixture();
  const before = reduceOperatingEvents(events);
  const imported = createOperatingEvent(
    {
      eventId: 'evt-migration-legacy-imported',
      timestamp: '2026-07-28T09:12:00Z',
      cycleId: 'CYCLE-000',
      type: 'migration.legacy-imported',
      entityId: 'MIG-board-001',
      actor: { kind: 'migration', id: 'openplanr-operate' },
      causationId: null,
      correlationId: 'MIG-board-001',
      evidenceRefs: [],
      payload: {
        migrationId: 'MIG-board-001',
        sourcePath: '.planr/board/findings.json',
        sourceDigest: digest('a'),
        recordDigest: digest('b'),
        backupManifestDigest: digest('c'),
        legacyKind: 'finding',
        legacyId: 'legacy-finding-1',
      },
    },
    { previousEvent: events.at(-1) },
  );
  const after = reduceOperatingEvents([...events, imported]);
  assert.deepEqual(
    {
      ...after,
      generatedAt: before.generatedAt,
      eventHead: before.eventHead,
    },
    before,
  );
  assert.deepEqual(after.eventHead, {
    sequence: imported.sequence,
    hash: imported.eventHash,
  });
});

test('route transitions are separate and bound to proposal and confirmation digests', () => {
  const { events } = buildOperatingFixture();
  const proposedEvents = events.slice(0, 10);
  const previousEvent = proposedEvents.at(-1);
  const mismatchedAcceptance = createOperatingEvent({
    eventId: 'evt-wrong-route',
    timestamp: '2026-07-28T09:09:20Z',
    cycleId: 'CYCLE-001',
    type: 'route.accepted',
    entityId: 'ACT-001',
    actor: { kind: 'human', id: 'founder' },
    causationId: null,
    correlationId: 'run-operating-fixture',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      routeDigest: digest('0'),
      confirmationDigest: digest('4'),
    },
  }, { previousEvent });
  assert.throws(
    () => reduceOperatingEvents([...proposedEvents, mismatchedAcceptance]),
    /does not match the proposed route digest/,
  );

  const accepted = events.slice(0, 11);
  const preparedWithoutAcceptance = [
    ...events.slice(0, 10),
    createOperatingEvent({
      eventId: 'evt-skip-accept',
      timestamp: '2026-07-28T09:09:40Z',
      cycleId: 'CYCLE-001',
      type: 'route.prepared',
      entityId: 'ACT-001',
      actor: { kind: 'engine', id: 'openplanr' },
      correlationId: 'run-operating-fixture',
      evidenceRefs: ['EVD-repo-payment'],
      payload: { routeDigest: digest('e'), previewDigest: digest('f') },
    }, { previousEvent }),
  ];
  assert.throws(() => reduceOperatingEvents(preparedWithoutAcceptance), /proposed → prepared/);
  assert.equal(reduceOperatingEvents(accepted).routes[0].state, 'accepted');
});

test('an applied reversible route can record a byte-exact rollback recovery', () => {
  const { events } = buildOperatingFixture();
  const prepared = events.slice(0, 12);
  const applied = createOperatingEvent({
    eventId: 'evt-route-applied',
    timestamp: '2026-07-28T09:09:50Z',
    cycleId: 'CYCLE-001',
    type: 'route.applied',
    entityId: 'ACT-001',
    actor: { kind: 'engine', id: 'openplanr' },
    correlationId: 'run-operating-fixture',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      routeDigest: digest('e'),
      confirmationDigest: digest('4'),
      transactionId: 'TXN-route-1',
    },
  }, { previousEvent: prepared.at(-1) });
  const rolledBack = createOperatingEvent({
    eventId: 'evt-route-rolled-back',
    timestamp: '2026-07-28T09:09:55Z',
    cycleId: 'CYCLE-001',
    type: 'route.rolled_back',
    entityId: 'ACT-001',
    actor: { kind: 'engine', id: 'openplanr' },
    correlationId: 'run-operating-fixture',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      routeDigest: digest('e'),
      recoveryId: 'RCV-route-1',
    },
  }, { previousEvent: applied });
  const state = reduceOperatingEvents([...prepared, applied, rolledBack]);
  assert.equal(state.routes[0].state, 'rolled_back');
  assert.equal(state.routes[0].transactionId, 'TXN-route-1');
});

test('finding acceptance preserves the confidence ceiling and audited score amendment', () => {
  const { events } = buildOperatingFixture();
  const cycle = events[0];
  const sourceFinding = events.find((event) => event.type === 'finding.proposed');
  const proposed = createOperatingEvent({
    eventId: 'evt-finding-with-ceiling',
    timestamp: sourceFinding.timestamp,
    cycleId: sourceFinding.cycleId,
    type: sourceFinding.type,
    entityId: sourceFinding.entityId,
    actor: sourceFinding.actor,
    causationId: null,
    correlationId: 'finding-amendment-fixture',
    evidenceRefs: sourceFinding.evidenceRefs,
    payload: {
      record: {
        ...sourceFinding.payload.record,
        confidence: 3,
        confidenceCeiling: 3,
        score: 45,
      },
    },
  }, { previousEvent: cycle });
  const amendment = {
    prior: { impact: 5, confidence: 3, ease: 3 },
    next: { impact: 4, confidence: 2, ease: 4 },
    reason: 'Human review lowers confidence and changes the implementation ease.',
    actor: { kind: 'human', id: 'founder' },
    timestamp: '2026-07-28T09:06:30Z',
  };
  const accepted = createOperatingEvent({
    eventId: 'evt-finding-accepted',
    timestamp: amendment.timestamp,
    cycleId: 'CYCLE-001',
    type: 'finding.accepted',
    entityId: 'FND-001',
    actor: amendment.actor,
    causationId: null,
    correlationId: 'finding-amendment-fixture',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      patch: { owner: 'founder' },
      scoreAmendment: amendment,
    },
  }, { previousEvent: proposed });
  const state = reduceOperatingEvents([cycle, proposed, accepted]);
  assert.deepEqual(state.findings[0], {
    id: 'FND-001',
    cycleId: 'CYCLE-001',
    title: 'Protect payment webhook idempotency',
    category: 'payment-integrity',
    problem: 'The payment handler has no durable replay guard.',
    cost: 'Duplicate delivery can create duplicate ledger effects.',
    proposal: 'Create a reviewed idempotency-ledger specification.',
    status: 'accepted',
    lane: 'DEV',
    owner: 'founder',
    impact: 4,
    confidence: 2,
    confidenceCeiling: 3,
    ease: 4,
    score: 32,
    scoreAmendment: amendment,
    severity: 'critical',
    sensitivity: 'internal',
    criticalOverride: true,
    evidenceRefs: ['EVD-repo-payment'],
    stalledCycles: 2,
    createdAt: '2026-07-28T09:06:00Z',
    updatedAt: amendment.timestamp,
  });

  const aboveCeiling = createOperatingEvent({
    ...accepted,
    eventId: 'evt-finding-above-ceiling',
    payload: {
      patch: {},
      scoreAmendment: {
        ...amendment,
        next: { ...amendment.next, confidence: 4 },
      },
    },
  }, { previousEvent: proposed });
  assert.throws(
    () => reduceOperatingEvents([cycle, proposed, aboveCeiling]),
    /confidence exceeds the evidence-derived ceiling/,
  );
});

test('security discontinuity starts a clean stream and is anchored by a signed checkpoint', () => {
  const recoveryRecordDigest = digest('9');
  const event = createOperatingEvent({
    eventId: 'evt-security-discontinuity',
    timestamp: '2026-07-28T09:00:00Z',
    cycleId: 'CYCLE-000',
    type: 'security.discontinuity',
    entityId: 'RCV-sensitive-state-001',
    actor: { kind: 'human', id: 'founder' },
    causationId: null,
    correlationId: 'security-repair-001',
    evidenceRefs: [],
    payload: {
      oldHead: { sequence: 42, hash: digest('8') },
      oldCheckpoint: null,
      authority: {
        kind: 'human',
        id: 'founder',
        confirmedAt: '2026-07-28T09:00:00Z',
      },
      remediation: {
        reasonDigest: digest('1'),
        guidanceDigest: digest('2'),
        affectedPathsDigest: digest('3'),
        quarantineManifestDigest: digest('4'),
      },
      recoveryRecordDigest,
      requiresSignedCheckpoint: true,
    },
  });
  const state = reduceOperatingEvents([event]);
  assert.deepEqual(state.eventHead, { sequence: 1, hash: event.eventHash });
  assert.deepEqual(state.cycles, []);
  assert.equal(state.summary.quiet, true);

  const checkpoint = createOperatingCheckpoint(state, {
    recordDigests: [recoveryRecordDigest],
    signer: (payload) => ({
      algorithm: 'hmac-sha256',
      keyId: 'local/security-repair/1',
      value: createHmac('sha256', 'fixture-security-key').update(payload).digest('base64url'),
    }),
  });
  assert.equal(checkpoint.integrity.status, 'signed');
  assert.deepEqual(checkpoint.recordDigests, [recoveryRecordDigest]);
  assert.equal(validateOperatingCheckpoint(checkpoint), checkpoint);
});

test('checkpoint validation and tail replay reproduce the full projection', () => {
  const { events, state } = buildOperatingFixture();
  const base = reduceOperatingEvents(events.slice(0, 10));
  const checkpoint = createOperatingCheckpoint(base, {
    recordDigests: [digest('b'), digest('a')],
  });
  assert.equal(validateOperatingCheckpoint(checkpoint), checkpoint);
  assert.equal(checkpoint.integrity.status, 'hash');
  assert.deepEqual(checkpoint.recordDigests, [digest('a'), digest('b')]);
  assert.deepEqual(resumeOperatingProjection(checkpoint, events.slice(10)), state);

  const corrupt = structuredClone(checkpoint);
  corrupt.state.summary.openGaps += 1;
  assert.throws(() => validateOperatingCheckpoint(corrupt), /JCS hash check/);

  const unknownRoute = structuredClone(base);
  unknownRoute.routes[0].findingIds = ['FND-999'];
  const unknownRouteCheckpoint = createOperatingCheckpoint(unknownRoute);
  assert.throws(
    () => resumeOperatingProjection(unknownRouteCheckpoint, []),
    /Route ACT-001 references unknown finding FND-999/,
  );
});

test('externally signed checkpoints bind the full checkpoint without persisting key material', () => {
  const { events, state } = buildOperatingFixture();
  const base = reduceOperatingEvents(events.slice(0, 10));
  const secret = Buffer.from('fixture-only-secret-kept-outside-the-checkpoint');
  const sign = (payload) => ({
    algorithm: 'hmac-sha256',
    keyId: 'fixture/checkpoint-key/1',
    value: createHmac('sha256', secret).update(payload).digest('base64url'),
  });
  const verify = (payload, signature) => {
    const expected = Buffer.from(sign(payload).value, 'base64url');
    const actual = Buffer.from(signature.value, 'base64url');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  };
  const checkpoint = createOperatingCheckpoint(base, {
    recordDigests: [digest('a')],
    signer: sign,
  });

  assert.equal(checkpoint.integrity.status, 'signed');
  assert.equal(checkpoint.integrity.signature.keyId, 'fixture/checkpoint-key/1');
  assert.equal(JSON.stringify(checkpoint).includes(secret.toString()), false);
  assert.equal(validateOperatingCheckpoint(checkpoint, { verifySignature: verify }), checkpoint);
  assert.deepEqual(
    resumeOperatingProjection(checkpoint, events.slice(10), {
      verifyCheckpointSignature: verify,
    }),
    state,
  );
  assert.equal(
    createOperatingCheckpointSigningPayload(checkpoint).includes('"signature"'),
    false,
  );

  const tampered = structuredClone(checkpoint);
  tampered.integrity.signature.value = `A${tampered.integrity.signature.value.slice(1)}`;
  assert.throws(
    () => validateOperatingCheckpoint(tampered, { verifySignature: verify }),
    /external signature is invalid/,
  );
  assert.throws(
    () => validateOperatingCheckpoint(checkpoint, { requireSignatureVerification: true }),
    /requires an external verifier/,
  );
});

test('JCS golden vectors and rejection rules are deterministic', () => {
  const golden = readJson('conformance/fixtures/operating-board/jcs-vectors.json');
  for (const vector of golden.vectors) {
    assert.equal(canonicalizeJson(vector.value), vector.canonical, vector.name);
    assert.equal(sha256Jcs(vector.value), vector.sha256, vector.name);
  }
  assert.throws(() => canonicalizeJson({ value: Number.NaN }), /finite number/);
  assert.throws(() => canonicalizeJson({ value: '\ud800' }), /lone high surrogate/);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => canonicalizeJson(cycle), /cycle/);
});
