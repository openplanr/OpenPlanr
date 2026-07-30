import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertProtocolArtifact,
  createOperatingCheckpoint,
  createOperatingEvent,
  listOperatingProviders,
  listOperatingRoles,
  listProtocolSchemas,
  validateProtocolArtifact,
} from '../../lib/pipeline/index.mjs';
import { buildOperatingFixture } from '../helpers/operatingFixture.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const digest = (character) => `sha256:${character.repeat(64)}`;
const at = '2026-07-28T09:00:00Z';

test('Protocol v1.2 schema catalog is complete, parseable, and version-addressable', () => {
  const files = readdirSync(join(root, 'schemas/v1.2.0'))
    .filter((file) => file.endsWith('.schema.json'))
    .sort();
  assert.equal(files.length, 36);
  for (const file of files) assert.doesNotThrow(() => readJson(`schemas/v1.2.0/${file}`));

  const registered = listProtocolSchemas()
    .filter((entry) => entry.protocolVersion === '1.2.0')
    .map((entry) => `${entry.kind}.schema.json`)
    .sort();
  assert.deepEqual(registered, files);
});

test('native advisor handoffs are structurally bounded protocol artifacts', () => {
  const handoff = {
    kind: 'operating-adapter-handoff',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    phase: 'advisors',
    state: 'record-required',
    binding: {
      cycleId: 'CYCLE-001',
      evidenceDigest: digest('e'),
      runtime: 'codex',
      lease: 'a'.repeat(43),
      idempotencyKey: 'native-CYCLE-001-advisors',
      expiresAt: at,
    },
    roles: [
      {
        roleId: 'strategy-finance',
        status: 'pending',
        inputDigest: digest('a'),
      },
    ],
    next: [],
    recovery: [],
  };
  assert.deepEqual(validateProtocolArtifact('operating-adapter-handoff', handoff), []);
  assert.ok(
    validateProtocolArtifact('operating-adapter-handoff', {
      ...handoff,
      next: [
        {
          id: 'adapter.record.strategy-finance',
          action: 'adapter.record',
          effect: 'machine-local-write',
          argv: ['planr', 'operate', 'adapter', 'record', '&&', 'curl'],
        },
      ],
    }).length,
  );
});

test('operating and adapter registries are schema-valid, unique, and read-only', () => {
  const adapters = readJson('registry/adapters.json');
  const roles = readJson('registry/operating-roles.json');
  const providers = readJson('registry/operating-providers.json');
  assert.doesNotThrow(() => assertProtocolArtifact('adapter-registry', adapters));
  assert.doesNotThrow(() => assertProtocolArtifact('operating-role-registry', roles));
  assert.doesNotThrow(() => assertProtocolArtifact('operating-provider-registry', providers));
  assert.equal(listOperatingRoles().length, 6);
  assert.equal(new Set(listOperatingRoles().map(({ id }) => id)).size, 6);
  assert.ok(
    listOperatingRoles().every(
      (role) =>
        role.outputSchema === 'operating-role-result@1.2.0' &&
        role.adapterResponseSchema === 'operating-advisor-response@1.2.0',
    ),
  );
  const legacyRoles = structuredClone(roles);
  for (const role of legacyRoles.roles) delete role.adapterResponseSchema;
  assert.doesNotThrow(
    () => assertProtocolArtifact('operating-role-registry', legacyRoles),
    'the additive adapter response declaration must not invalidate earlier v1.2 registries',
  );
  assert.equal(listOperatingProviders().length, 6);
  assert.equal(new Set(listOperatingProviders().map(({ id }) => id)).size, 6);
  assert.ok(listOperatingRoles().every((role) => role.readOnly && role.writeBoundary === 'none'));
  assert.ok(listOperatingProviders().every((provider) => provider.readOnly));
  assert.ok(adapters.adapters.every((adapter) => (
    adapter.capabilities.operatingBoard && adapter.entrypoints.operate
  )));
  assert.ok(adapters.adapters.every((adapter) => (
    typeof adapter.capabilities.parallelDispatch === 'boolean'
    && typeof adapter.capabilities.headlessBridge === 'boolean'
    && ['native', 'chat', 'terminal', 'none'].includes(
      adapter.capabilities.interactiveQuestions,
    )
  )));
});

test('native operating advisors return compact bounded responses', () => {
  const response = {
    outcome: 'proposals',
    proposals: [{
      proposalKey: 'technology-risk.reduce-release-risk',
      type: 'finding',
      title: 'Reduce release risk',
      problem: 'The release path has no verified rollback rehearsal.',
      proposal: 'Add one deterministic rollback canary before the next release.',
      impact: 4,
      confidence: 4,
      ease: 3,
      severity: 'high',
      evidenceRefs: ['EVD-release-workflow'],
    }],
    gaps: [],
    conflicts: [],
  };
  assert.deepEqual(validateProtocolArtifact('operating-advisor-response', response), []);
  assert.ok(validateProtocolArtifact('operating-advisor-response', {
    ...response,
    cycleId: 'CYCLE-001',
  }).length, 'native runtimes cannot provide canonical engine metadata');
  assert.ok(validateProtocolArtifact('operating-advisor-response', {
    ...response,
    outcome: 'quiet',
  }).length, 'quiet responses cannot contain proposals');
  assert.ok(validateProtocolArtifact('operating-advisor-response', {
    ...response,
    outcome: 'proposals',
    proposals: [],
  }).length, 'proposal responses require at least one proposal');
});

test('hash-chained operating fixtures validate with strict top-level envelopes', () => {
  const { events, state } = buildOperatingFixture();
  for (const event of events) {
    assert.deepEqual(validateProtocolArtifact('operating-event', event), []);
  }
  assert.deepEqual(validateProtocolArtifact('operating-state', state), []);
  assert.ok(validateProtocolArtifact('operating-state', { ...state, surprise: true }).length);
  assert.ok(validateProtocolArtifact('operating-state', { ...state, kind: 'wrong-kind' }).length);
  const checkpoint = createOperatingCheckpoint(state);
  assert.deepEqual(validateProtocolArtifact('operating-checkpoint', checkpoint), []);
  assert.ok(validateProtocolArtifact('operating-checkpoint', {
    ...checkpoint,
    state: { ...checkpoint.state, surprise: true },
  }).length, 'checkpoint state must validate through the canonical operating-state reference');
});

test('route governance events require explicit digest-bound acceptance and preparation', () => {
  const { events } = buildOperatingFixture();
  const accepted = events.find((event) => event.type === 'route.accepted');
  const prepared = events.find((event) => event.type === 'route.prepared');
  assert.ok(accepted.payload.routeDigest);
  assert.ok(accepted.payload.confirmationDigest);
  assert.ok(prepared.payload.routeDigest);
  assert.ok(prepared.payload.previewDigest);
  assert.ok(validateProtocolArtifact('operating-event', {
    ...accepted,
    payload: {},
  }).length);
});

test('operating event payload fixtures are type-discriminated and reject unknown keys', () => {
  const schema = readJson('schemas/v1.2.0/operating-event.schema.json');
  const declaredTypes = schema.properties.type.enum;
  const discriminatedTypes = schema.oneOf.flatMap((branch) => (
    branch.properties.type.enum ?? [branch.properties.type.const]
  ));
  assert.deepEqual(
    [...discriminatedTypes].sort(),
    [...declaredTypes].sort(),
    'every event type must have exactly one payload branch',
  );
  assert.ok(
    schema.oneOf.every((branch) => branch.properties.payload?.additionalProperties === false),
    'every event payload branch must reject undeclared fields',
  );

  const valid = readJson('conformance/fixtures/operating-board/event-valid.json');
  const invalid = readJson('conformance/fixtures/operating-board/event-invalid.json');
  assert.deepEqual(validateProtocolArtifact('operating-event', valid), []);
  assert.ok(
    validateProtocolArtifact('operating-event', invalid)
      .some(({ rule }) => rule === 'oneOf'),
    'a route event with an undeclared payload key must fail its discriminated branch',
  );

  const { events } = buildOperatingFixture();
  const collecting = events.find((event) => event.type === 'cycle.collecting');
  assert.ok(validateProtocolArtifact('operating-event', {
    ...collecting,
    payload: { patch: { unknownCycleField: true } },
  }).length);
  const finding = events.find((event) => event.type === 'finding.proposed');
  assert.ok(validateProtocolArtifact('operating-event', {
    ...finding,
    payload: { record: { ...finding.payload.record, unknownRecordField: true } },
  }).length);
  const { sensitivity: _sensitivity, ...findingWithoutSensitivity } = finding.payload.record;
  assert.ok(
    validateProtocolArtifact('operating-event', {
      ...finding,
      payload: { record: findingWithoutSensitivity },
    }).length,
    'a finding must inherit and persist the highest cited evidence sensitivity',
  );
  assert.ok(
    validateProtocolArtifact('operating-event', {
      ...finding,
      type: 'finding.rejected',
      payload: {
        patch: { evidenceRefs: ['EVD-reclassified'] },
        reason: 'Evidence references are immutable after consolidation.',
      },
    }).length,
    'a finding lifecycle patch cannot replace its derived evidence references',
  );
  assert.deepEqual(
    validateProtocolArtifact('operating-event', {
      ...finding,
      type: 'finding.rejected',
      payload: {
        patch: { sensitivity: 'confidential' },
        reason: 'The cited evidence was reclassified upward.',
      },
    }),
    [],
    'the reducer remains responsible for enforcing monotonic sensitivity',
  );
});

test('legacy board imports are strict audit-only migration events', () => {
  const event = createOperatingEvent({
    eventId: 'evt-migration-legacy-imported',
    timestamp: at,
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
  });
  assert.deepEqual(validateProtocolArtifact('operating-event', event), []);
  assert.ok(
    validateProtocolArtifact('operating-event', {
      ...event,
      payload: { ...event.payload, sourcePath: '/Users/example/private/board.json' },
    }).length,
  );
});

test('operating lifecycle audit payloads preserve strict warnings, reasons, and answers', () => {
  const event = (type, entityId, payload, actor = { kind: 'human', id: 'operate-cli' }) =>
    createOperatingEvent({
      eventId: `evt-${type}`,
      timestamp: at,
      cycleId: 'CYCLE-001',
      type,
      entityId,
      actor,
      causationId: null,
      correlationId: 'lifecycle-audit',
      evidenceRefs: [],
      payload,
    });

  assert.doesNotThrow(() => event(
    'cycle.blocked',
    'CYCLE-001',
    {
      patch: { health: 'blocked' },
      warnings: ['Required evidence is unavailable.'],
      errorCode: 'E_OPERATE_EVIDENCE_BLOCKED',
    },
    { kind: 'engine', id: 'openplanr' },
  ));
  assert.doesNotThrow(() => event(
    'cycle.preparing',
    'CYCLE-001',
    {
      patch: { health: 'partial' },
      recoveredTransactions: ['TXN-cycle-recovery'],
    },
  ));
  assert.doesNotThrow(() => event(
    'finding.rejected',
    'FND-001',
    {
      patch: { rejectionReason: 'Does not meet the evidence threshold.' },
      reason: 'Does not meet the evidence threshold.',
    },
  ));
  const answered = event(
    'decision.answered',
    'DEC-001',
    {
      patch: { selectedOption: 'defer' },
      reason: 'Preserve runway while evidence matures.',
    },
  );
  assert.doesNotThrow(() => event(
    'decision.closed',
    'DEC-001',
    {
      patch: { selectedOption: 'defer' },
      answeredHead: { sequence: answered.sequence, hash: answered.eventHash },
    },
  ));
  assert.doesNotThrow(() => event(
    'gap.answered',
    'GAP-001',
    { patch: { answer: 'The measured rate is 0.4%.' } },
  ));
  assert.throws(
    () => event('finding.rejected', 'FND-001', { patch: {} }),
    /matched 0\/\d+ branches/,
  );
});

test('security discontinuities are metadata-only genesis events', () => {
  assert.deepEqual(
    validateProtocolArtifact(
      'operating-event',
      readJson('conformance/fixtures/operating-board/security-discontinuity-valid.json'),
    ),
    [],
  );
  assert.ok(
    validateProtocolArtifact(
      'operating-event',
      readJson('conformance/fixtures/operating-board/security-discontinuity-invalid.json'),
    ).length,
  );
  const event = createOperatingEvent({
    eventId: 'evt-security-discontinuity',
    timestamp: at,
    cycleId: 'CYCLE-000',
    type: 'security.discontinuity',
    entityId: 'RCV-sensitive-state-001',
    actor: { kind: 'human', id: 'founder' },
    causationId: null,
    correlationId: 'security-repair-001',
    evidenceRefs: [],
    payload: {
      oldHead: { sequence: 42, hash: digest('a') },
      oldCheckpoint: {
        stateHash: digest('b'),
        integrityStatus: 'signed',
        keyId: 'local/checkpoint/1',
      },
      authority: {
        kind: 'human',
        id: 'founder',
        confirmedAt: at,
      },
      remediation: {
        reasonDigest: digest('c'),
        guidanceDigest: digest('d'),
        affectedPathsDigest: digest('e'),
        quarantineManifestDigest: digest('f'),
      },
      recoveryRecordDigest: digest('1'),
      requiresSignedCheckpoint: true,
    },
  });
  assert.deepEqual(validateProtocolArtifact('operating-event', event), []);
  assert.ok(validateProtocolArtifact('operating-event', {
    ...event,
    payload: { ...event.payload, purgedContent: 'must-never-be-recorded' },
  }).length);
  assert.throws(
    () => createOperatingEvent({
      ...event,
      eventId: 'evt-not-genesis',
      eventHash: undefined,
    }, { sequence: 2 }),
    /matched 0\/\d+ branches/,
  );
});

test('finding acceptance carries a strict auditable score amendment', () => {
  assert.deepEqual(
    validateProtocolArtifact(
      'operating-event',
      readJson('conformance/fixtures/operating-board/finding-score-amendment-valid.json'),
    ),
    [],
  );
  assert.ok(
    validateProtocolArtifact(
      'operating-event',
      readJson('conformance/fixtures/operating-board/finding-score-amendment-invalid.json'),
    ).length,
  );
  const { events } = buildOperatingFixture();
  const proposed = events.find((event) => event.type === 'finding.proposed');
  const accepted = createOperatingEvent({
    eventId: 'evt-finding-accepted',
    timestamp: '2026-07-28T09:06:30Z',
    cycleId: 'CYCLE-001',
    type: 'finding.accepted',
    entityId: 'FND-001',
    actor: { kind: 'human', id: 'founder' },
    causationId: null,
    correlationId: 'accept-finding-001',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      patch: { owner: 'founder' },
      scoreAmendment: {
        prior: { impact: 5, confidence: 5, ease: 3 },
        next: { impact: 4, confidence: 4, ease: 4 },
        reason: 'Reduce confidence while preserving urgency.',
        actor: { kind: 'human', id: 'founder' },
        timestamp: '2026-07-28T09:06:30Z',
      },
    },
  }, { previousEvent: proposed });
  assert.deepEqual(validateProtocolArtifact('operating-event', accepted), []);
  assert.ok(validateProtocolArtifact('operating-event', {
    ...accepted,
    payload: { ...accepted.payload, unreviewedScore: 64 },
  }).length);
});

test('supporting operating contracts validate canonical examples', () => {
  const common = { schemaVersion: '1.0.0', protocolVersion: '1.2.0' };
  const findingRecord = buildOperatingFixture().events
    .find((event) => event.type === 'finding.proposed')
    .payload.record;
  const samples = {
    'operating-config': {
      kind: 'operating-config',
      ...common,
      profile: 'saas',
      decisionOwner: 'founder',
      cadence: 'weekly',
      planningEngine: 'openplanr',
      enabledRoles: ['strategy-finance', 'chair'],
      enabledProviders: ['repository', 'planr'],
      caps: { surfacedFindings: 5, newSpecs: 2, openDecisions: 5, agentArtifacts: 2 },
      budgets: { maxFiles: 1000, maxItems: 1000, maxBytes: 10485760, maxDurationMs: 30000 },
    },
    'operating-evidence': {
      kind: 'operating-evidence',
      ...common,
      cycleId: 'CYCLE-001',
      fingerprint: digest('a'),
      collectedAt: at,
      truncated: false,
      items: [{
        id: 'EVD-repo',
        source: 'repository',
        location: 'src/payments.mjs',
        digest: digest('b'),
        collectedAt: at,
        observedFrom: null,
        observedTo: null,
        freshness: 'fresh',
        sensitivity: 'internal',
        claimTypes: ['code'],
        repository: {
          componentId: 'planr-pipeline',
          canonicalRemote: 'https://github.com/openplanr/planr-pipeline.git',
          revision: '1234567890abcdef1234567890abcdef12345678',
          configuredBranch: 'main',
          dirtyFingerprint: null,
        },
      }],
      sources: [{
        id: 'repository',
        fingerprint: digest('c'),
        status: 'collected',
        itemCount: 1,
        byteCount: 512,
      }],
      warnings: [],
    },
    'operating-role-result': {
      kind: 'operating-role-result',
      ...common,
      cycleId: 'CYCLE-001',
      roleId: 'technology-risk',
      inputDigest: digest('d'),
      resultDigest: digest('e'),
      outcome: 'quiet',
      proposals: [],
      gaps: [],
      conflicts: [],
      producer: {
        product: 'openplanr',
        version: '1.14.0',
        runtime: 'codex',
        capability: 'analysis-high',
      },
    },
    'operating-workspace-manifest': {
      kind: 'operating-workspace-manifest',
      ...common,
      capturedAt: at,
      workspaceDigest: digest('f'),
      controlRepository: {
        componentId: 'openplanr',
        canonicalRemote: 'openplanr/OpenPlanr',
        configuredBranch: 'main',
        pinnedRevision: 'abcdef1',
        dirtyFingerprint: null,
        readOnly: false,
      },
      components: [{
        componentId: 'pipeline',
        canonicalRemote: 'openplanr/planr-pipeline',
        configuredBranch: 'main',
        pinnedRevision: 'abcdef2',
        dirtyFingerprint: null,
        readOnly: true,
      }],
    },
    'operating-record': {
      kind: 'operating-record',
      ...common,
      digest: digest('1'),
      recordType: 'finding',
      createdAt: at,
      correlationId: 'operate-1',
      contentDigest: digest('2'),
      content: structuredClone(findingRecord),
    },
    'operating-transaction-journal': {
      kind: 'operating-transaction-journal',
      ...common,
      transactionId: 'TXN-route-1',
      state: 'prepared',
      eventHead: { sequence: 1, hash: digest('3') },
      previewDigest: digest('4'),
      createdAt: at,
      updatedAt: at,
      writes: [{
        path: '.planr/specs/SPEC-003/SPEC-003.md',
        operation: 'create',
        beforeDigest: null,
        afterDigest: digest('5'),
        mode: '0644',
      }],
    },
    'operating-artifact-session': {
      kind: 'operating-artifact-session',
      ...common,
      id: 'ART-001',
      cycleId: 'CYCLE-001',
      state: 'prepared',
      artifactType: 'html',
      inputDigest: digest('6'),
      destination: '.planr/operate/cycles/CYCLE-001/artifacts/brief.html',
      evidenceRefs: ['EVD-repo'],
      producer: {
        product: 'openplanr',
        version: '1.14.0',
        runtime: 'codex',
        capability: 'analysis-high',
      },
      createdAt: at,
      updatedAt: at,
    },
    'operating-provider-manifest': {
      kind: 'operating-provider-manifest',
      ...common,
      id: 'PRV-repository',
      providerId: 'repository',
      providerVersion: '1.0.0',
      mode: 'structured',
      readOnly: true,
      endpoint: {
        kind: 'local',
        display: 'workspace://repository',
        authentication: 'none',
        redacted: true,
      },
      permittedDataClasses: ['source-code', 'project-metadata'],
      retention: {
        providerStoresRequestContent: false,
        maxProviderRetentionDays: 0,
        localEvidenceRetention: 'cycle',
      },
      capabilities: { incremental: true, deep: true, toolIsolation: 'not-applicable' },
      limits: {
        maxItems: 1000,
        maxBytes: 10485760,
        maxDurationMs: 30000,
        maxRequests: null,
        maxTokens: null,
        maxCostUsd: null,
      },
      consent: {
        policyVersion: '1.0.0',
        status: 'first-use',
        acceptedAt: at,
        renewedAt: null,
        nextReviewAt: null,
        renewalTriggers: ['policy-change', 'scope-expansion'],
      },
      policyDigest: digest('9'),
      configurationDigest: digest('7'),
      capturedAt: at,
    },
    'operating-evidence-readiness': {
      kind: 'operating-evidence-readiness',
      ...common,
      cycleId: 'CYCLE-001',
      inputDigest: digest('8'),
      evaluatedAt: at,
      roles: [{
        roleId: 'technology-risk',
        readiness: 'ready',
        requirements: [{
          source: 'repository',
          claimTypes: ['code', 'architecture'],
          minimumItems: 1,
          observedItems: 1,
          maxAgeHours: 168,
          oldestAgeHours: 1,
          observationWindow: 'current-state',
          sensitivityCeiling: 'restricted',
          satisfied: true,
        }],
        missingEvidence: [],
        evidenceRefs: ['EVD-repo'],
        modelCallAllowed: true,
        gapId: null,
      }],
    },
    'operating-outcome-observation': {
      kind: 'operating-outcome-observation',
      ...common,
      id: 'OBS-001',
      outcomeId: 'OUT-001',
      observedAt: at,
      window: { from: '2026-07-01T00:00:00Z', to: at },
      value: 0,
      unit: 'effects',
      queryIdentity: 'payments.duplicate-effects',
      aggregation: 'count',
      sampleSize: 100,
      coverage: 1,
      freshness: 'fresh',
      guardrails: [{ metric: 'duplicate-effects', breached: false, observedValue: 0 }],
      evaluation: 'positive',
      evidenceRefs: ['EVD-repo'],
    },
    'operating-migration-record': {
      kind: 'operating-migration-record',
      ...common,
      id: 'MIG-001',
      sourceKind: 'protocol-upgrade',
      sourceDigest: digest('9'),
      state: 'previewed',
      previewDigest: digest('a'),
      backupManifestDigest: digest('b'),
      mappings: [],
      conflicts: [],
      createdAt: at,
      updatedAt: at,
    },
    'operating-recovery-record': {
      kind: 'operating-recovery-record',
      ...common,
      id: 'RCV-001',
      transactionId: 'TXN-route-1',
      action: 'recover-journal',
      reason: 'Interrupted promotion.',
      previewDigest: digest('c'),
      fromHead: { sequence: 1, hash: digest('d') },
      toHead: { sequence: 2, hash: digest('e') },
      outcome: 'recovered',
      confirmedBy: 'founder',
      createdAt: at,
    },
  };

  for (const [kind, sample] of Object.entries(samples)) {
    assert.deepEqual(validateProtocolArtifact(kind, sample), [], kind);
  }

  const provider = samples['operating-provider-manifest'];
  const record = samples['operating-record'];
  assert.ok(validateProtocolArtifact('operating-record', {
    ...record,
    recordType: 'decision',
  }).length, 'record content must match recordType');
  assert.ok(validateProtocolArtifact('operating-record', {
    ...record,
    content: { ...record.content, unknownRecordField: true },
  }).length, 'record content retains the referenced schema strictness');
  assert.ok(validateProtocolArtifact('operating-provider-manifest', {
    ...provider,
    endpoint: {
      ...provider.endpoint,
      display: 'https://token@example.com?secret=value',
    },
  }).length, 'credential-like or query-bearing endpoint displays are rejected');
  assert.ok(validateProtocolArtifact('operating-provider-manifest', {
    ...provider,
    consent: {
      ...provider.consent,
      status: 'renewed',
    },
  }).length, 'renewal status requires a renewal timestamp');
});
