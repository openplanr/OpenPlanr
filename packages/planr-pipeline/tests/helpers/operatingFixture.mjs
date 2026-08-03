import {
  createOperatingEvent,
  reduceOperatingEvents,
} from '../../lib/pipeline/index.mjs';

const digest = (character) => `sha256:${character.repeat(64)}`;
const actor = { kind: 'engine', id: 'openplanr' };
const base = {
  causationId: null,
  correlationId: 'run-operating-fixture',
  evidenceRefs: [],
  actor,
};

export function buildOperatingFixture() {
  const events = [];
  const add = (input) => {
    const event = createOperatingEvent(
      { ...base, ...input, eventId: `evt-${String(events.length + 1).padStart(3, '0')}` },
      { previousEvent: events.at(-1) ?? null },
    );
    events.push(event);
    return event;
  };

  add({
    timestamp: '2026-07-28T09:00:00Z',
    cycleId: 'CYCLE-001',
    type: 'cycle.preparing',
    entityId: 'CYCLE-001',
    payload: {
      record: {
        kind: 'operating-cycle-manifest',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        id: 'CYCLE-001',
        state: 'preparing',
        health: 'normal',
        depth: 'standard',
        focus: ['all'],
        inputDigest: digest('a'),
        enabledRoles: ['strategy-finance', 'technology-risk', 'product-activation', 'growth-market', 'operations-customer', 'chair'],
        enabledProviders: ['repository', 'planr', 'git'],
        createdAt: '2026-07-28T09:00:00Z',
        updatedAt: '2026-07-28T09:00:00Z',
        producer: { product: 'openplanr', version: '1.14.0', runtime: 'codex' },
      },
    },
  });
  add({
    timestamp: '2026-07-28T09:01:00Z',
    cycleId: 'CYCLE-001',
    type: 'cycle.collecting',
    entityId: 'CYCLE-001',
    payload: { patch: { health: 'normal' } },
  });
  add({
    timestamp: '2026-07-28T09:02:00Z',
    cycleId: 'CYCLE-001',
    type: 'evidence.collected',
    entityId: 'CYCLE-001',
    payload: {
      recordDigest: digest('b'),
      sources: [
        { id: 'repository', freshness: 'fresh', status: 'collected', itemCount: 42 },
        { id: 'planr', freshness: 'fresh', status: 'collected', itemCount: 18 },
        { id: 'git', freshness: 'stale', status: 'partial', itemCount: 7 },
      ],
    },
  });
  add({
    timestamp: '2026-07-28T09:03:00Z',
    cycleId: 'CYCLE-001',
    type: 'cycle.advising',
    entityId: 'CYCLE-001',
    payload: {},
  });
  add({
    timestamp: '2026-07-28T09:04:00Z',
    cycleId: 'CYCLE-001',
    type: 'advisory.recorded',
    entityId: 'CYCLE-001',
    payload: { recordDigest: digest('c') },
  });
  add({
    timestamp: '2026-07-28T09:05:00Z',
    cycleId: 'CYCLE-001',
    type: 'cycle.consolidating',
    entityId: 'CYCLE-001',
    payload: {},
  });
  add({
    timestamp: '2026-07-28T09:06:00Z',
    cycleId: 'CYCLE-001',
    type: 'finding.proposed',
    entityId: 'FND-001',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      record: {
        kind: 'operating-finding',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        id: 'FND-001',
        cycleId: 'CYCLE-001',
        title: 'Protect payment webhook idempotency',
        category: 'payment-integrity',
        problem: 'The payment handler has no durable replay guard.',
        cost: 'Duplicate delivery can create duplicate ledger effects.',
        proposal: 'Create a reviewed idempotency-ledger specification.',
        impact: 5,
        confidence: 5,
        ease: 3,
        score: 75,
        severity: 'critical',
        sensitivity: 'internal',
        criticalOverride: true,
        lane: 'DEV',
        owner: 'planning-engine',
        evidenceRefs: ['EVD-repo-payment'],
        status: 'proposed',
        dependsOn: [],
        stalledCycles: 2,
        createdAt: '2026-07-28T09:06:00Z',
        updatedAt: '2026-07-28T09:06:00Z'
      }
    }
  });
  add({
    timestamp: '2026-07-28T09:07:00Z',
    cycleId: 'CYCLE-001',
    type: 'decision.open',
    entityId: 'DEC-001',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      record: {
        kind: 'operating-decision',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        id: 'DEC-001',
        cycleId: 'CYCLE-001',
        question: 'Should payment hardening displace the current growth experiment?',
        options: [{ id: 'A', label: 'Sequence payment safety first' }, { id: 'B', label: 'Keep the current sequence' }],
        recommendation: 'Choose A.',
        consequences: 'The growth experiment moves to the next cycle.',
        reversibility: 'reversible',
        deadline: '2026-07-30T12:00:00Z',
        proposedDefault: null,
        unblocks: ['FND-001'],
        status: 'open',
        owner: 'decision-owner',
        evidenceRefs: ['EVD-repo-payment'],
        createdAt: '2026-07-28T09:07:00Z',
        updatedAt: '2026-07-28T09:07:00Z'
      }
    }
  });
  add({
    timestamp: '2026-07-28T09:08:00Z',
    cycleId: 'CYCLE-001',
    type: 'gap.open',
    entityId: 'GAP-001',
    payload: {
      record: {
        kind: 'operating-data-gap',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        id: 'GAP-001',
        cycleId: 'CYCLE-001',
        question: 'What is the duplicate webhook rate over the last 30 days?',
        reason: 'The outcome baseline is not yet instrumented.',
        unblocks: ['FND-001'],
        status: 'open',
        owner: 'decision-owner',
        evidenceRefs: [],
        createdAt: '2026-07-28T09:08:00Z',
        updatedAt: '2026-07-28T09:08:00Z'
      }
    }
  });
  add({
    timestamp: '2026-07-28T09:09:00Z',
    cycleId: 'CYCLE-001',
    type: 'route.proposed',
    entityId: 'ACT-001',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      record: {
        kind: 'operating-route-plan',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        id: 'ACT-001',
        cycleId: 'CYCLE-001',
        inputDigest: digest('d'),
        routeDigest: digest('e'),
        previewDigest: digest('f'),
        workspaceDigest: digest('0'),
        evidenceDigest: digest('1'),
        providerDigest: digest('2'),
        destinationDigest: digest('3'),
        eventHead: { sequence: 9, hash: events.at(-1).eventHash },
        state: 'proposed',
        actions: [{
          id: 'ACT-001',
          findingId: 'FND-001',
          lane: 'DEV',
          owner: 'planning-engine',
          kind: 'create-spec',
          dependsOn: [],
          evidenceRefs: ['EVD-repo-payment'],
          reversible: true,
          requiresConfirmation: true,
          targetPath: '.planr/specs/'
        }],
        createdAt: '2026-07-28T09:09:00Z'
      }
    }
  });
  add({
    timestamp: '2026-07-28T09:09:20Z',
    cycleId: 'CYCLE-001',
    type: 'route.accepted',
    entityId: 'ACT-001',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      routeDigest: digest('e'),
      confirmationDigest: digest('4')
    }
  });
  add({
    timestamp: '2026-07-28T09:09:40Z',
    cycleId: 'CYCLE-001',
    type: 'route.prepared',
    entityId: 'ACT-001',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      routeDigest: digest('e'),
      previewDigest: digest('f')
    }
  });
  add({
    timestamp: '2026-07-28T09:10:00Z',
    cycleId: 'CYCLE-001',
    type: 'spec.linked',
    entityId: 'SPEC-003',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      record: {
        kind: 'operating-spec-link',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        specId: 'SPEC-003',
        sourceCycle: 'CYCLE-001',
        sourceFinding: 'FND-001',
        planningEngine: 'openplanr',
        evidenceRefs: ['EVD-repo-payment'],
        outcome: {
          kind: 'guardrail',
          metric: 'payments.webhook_duplicate_effects',
          unit: 'effects',
          queryIdentity: 'integration-test-and-production-monitor',
          direction: 'decrease',
          operator: 'eq',
          aggregation: 'count',
          baselineWindow: { from: '2026-06-28T00:00:00Z', to: '2026-07-27T23:59:59Z' },
          targetWindow: { from: '2026-08-01T00:00:00Z', to: '2026-08-14T23:59:59Z' },
          threshold: { value: 0 },
          minimumCoverage: 0.95,
          minimumSample: 100,
          stalePolicy: 'inconclusive',
          missingPolicy: 'create-gap',
          guardrailPrecedence: 'block-on-breach',
          source: 'integration-test-and-production-monitor',
          observationWindow: '14d',
          verifyAfter: '2026-08-15'
        },
        guardrails: ['No duplicate ledger mutation'],
        rollout: 'Ship behind the existing payment safety gate.',
        rollback: 'Disable the handler and retain the ledger for audit.'
      }
    }
  });
  add({
    timestamp: '2026-07-28T09:11:00Z',
    cycleId: 'CYCLE-001',
    type: 'outcome.registered',
    entityId: 'OUT-001',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      record: {
        kind: 'operating-outcome',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        id: 'OUT-001',
        sourceCycle: 'CYCLE-001',
        sourceFinding: 'FND-001',
        specId: 'SPEC-003',
        outcomeKind: 'guardrail',
        metric: 'payments.webhook_duplicate_effects',
        unit: 'effects',
        queryIdentity: 'integration-test-and-production-monitor',
        direction: 'decrease',
        operator: 'eq',
        aggregation: 'count',
        baselineWindow: { from: '2026-06-28T00:00:00Z', to: '2026-07-27T23:59:59Z' },
        targetWindow: { from: '2026-08-01T00:00:00Z', to: '2026-08-14T23:59:59Z' },
        threshold: { value: 0 },
        minimumCoverage: 0.95,
        minimumSample: 100,
        stalePolicy: 'inconclusive',
        missingPolicy: 'create-gap',
        guardrailPrecedence: 'block-on-breach',
        guardrails: [],
        source: 'integration-test-and-production-monitor',
        observationWindow: '14d',
        verifyAfter: '2026-08-15',
        rollout: 'Ship behind the existing payment safety gate.',
        rollback: 'Disable the handler and retain the ledger for audit.',
        status: 'observing',
        evidenceRefs: ['EVD-repo-payment'],
        createdAt: '2026-07-28T09:11:00Z',
        updatedAt: '2026-07-28T09:11:00Z'
      }
    }
  });
  add({
    timestamp: '2026-07-28T09:11:30Z',
    cycleId: 'CYCLE-001',
    type: 'outcome.observed',
    entityId: 'OUT-001',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      record: {
        kind: 'operating-outcome-observation',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        id: 'OBS-001',
        outcomeId: 'OUT-001',
        observedAt: '2026-08-15T09:11:30Z',
        window: {
          from: '2026-08-01T00:00:00Z',
          to: '2026-08-14T23:59:59Z'
        },
        value: 0,
        unit: 'effects',
        queryIdentity: 'integration-test-and-production-monitor',
        aggregation: 'count',
        sampleSize: 100,
        coverage: 1,
        freshness: 'fresh',
        guardrails: [],
        evaluation: 'positive',
        evidenceRefs: ['EVD-repo-payment']
      }
    }
  });
  add({
    timestamp: '2026-07-28T09:11:45Z',
    cycleId: 'CYCLE-001',
    type: 'outcome.evaluated',
    entityId: 'OUT-001',
    evidenceRefs: ['EVD-repo-payment'],
    payload: {
      evaluation: 'positive'
    }
  });
  add({
    timestamp: '2026-07-28T09:12:00Z',
    cycleId: 'CYCLE-001',
    type: 'cycle.reviewable',
    entityId: 'CYCLE-001',
    payload: { patch: { health: 'partial' } },
  });

  return { events, state: reduceOperatingEvents(events) };
}
