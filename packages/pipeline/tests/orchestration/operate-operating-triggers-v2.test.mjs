import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { validateProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { recordOperatingTriggerScenarioV2 } from '../../lib/operate/runtime-foundation.mjs';
import { checkpoint } from './operate-operating-intelligence-state-v2.test-support.mjs';

const TIME = '2026-08-09T12:02:00.000Z';
const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const clone = (value) => structuredClone(value);

function requestFor(seed) {
  const values = fixture('operating-trigger-scenario-valid.json');
  const common = {
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    snapshotId: seed.result.snapshot.snapshotId,
    sourceArtifactId: seed.sourceArtifactId,
    createdAt: TIME,
  };
  return {
    cycleId: seed.result.state.cycles[0].cycleId,
    snapshotId: seed.result.snapshot.snapshotId,
    stateId: seed.result.operatingState.stateId,
    scenarios: [
      {
        ...values.scenario,
        ...common,
        assumptionIds: [seed.assumption.assumptionId],
        evidenceRefIds: [seed.evidenceRef.evidenceRefId],
        base: {
          ...values.scenario.base,
          sourceArtifactId: seed.sourceArtifactId,
          assumptionIds: [seed.assumption.assumptionId],
          evidenceRefIds: [seed.evidenceRef.evidenceRefId],
        },
        upside: {
          ...values.scenario.upside,
          sourceArtifactId: seed.sourceArtifactId,
          assumptionIds: [seed.assumption.assumptionId],
          evidenceRefIds: [seed.evidenceRef.evidenceRefId],
        },
        downside: {
          ...values.scenario.downside,
          sourceArtifactId: seed.sourceArtifactId,
          assumptionIds: [seed.assumption.assumptionId],
          evidenceRefIds: [seed.evidenceRef.evidenceRefId],
        },
      },
    ],
    triggers: [{ ...values.trigger, ...common, evidenceRefIds: [seed.evidenceRef.evidenceRefId] }],
  };
}

function draft() {
  return {
    timestamp: TIME,
    correlationId: 'corr_trigger_scenario_001',
    eventIds: { scenarios: ['evt_scenario_001'], triggers: ['evt_trigger_001'] },
  };
}

test('scenario/trigger fixtures are contract-valid only for analytical inputs', () => {
  const values = fixture('operating-trigger-scenario-valid.json');
  assert.deepEqual(
    validateProtocolArtifact('operating-scenario', values.scenario, { protocolVersion: '2.0.0' }),
    [],
  );
  assert.deepEqual(
    validateProtocolArtifact('operating-event-trigger', values.trigger, {
      protocolVersion: '2.0.0',
    }),
    [],
  );
  assert.ok(
    validateProtocolArtifact(
      'operating-event-trigger',
      fixture('operating-trigger-scenario-invalid.json').trigger,
      {
        protocolVersion: '2.0.0',
      },
    ).length > 0,
  );
});

test('triggers and scenarios are immutable Event facts that do not create Assignments or effects', () => {
  const seed = checkpoint();
  const request = requestFor(seed);
  const first = recordOperatingTriggerScenarioV2(request, draft(), {
    initialState: seed.result.state,
  });
  assert.deepEqual(
    first.events.map(({ type }) => type),
    ['scenario.recorded', 'trigger.recorded'],
  );
  assert.equal(first.state.scenarios.length, 1);
  assert.equal(first.state.eventTriggers.length, 1);
  assert.equal(
    first.state.assignments.length,
    seed.result.state.assignments.length,
    'a trigger requests normal work but does not start it',
  );
  assert.equal(
    first.state.actions.length,
    seed.result.state.actions.length,
    'scenario analysis does not create an Action',
  );
  const replay = recordOperatingTriggerScenarioV2(clone(request), clone(draft()), {
    initialState: first.state,
  });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.events, []);
  assert.throws(
    () =>
      recordOperatingTriggerScenarioV2(
        request,
        {
          ...draft(),
          correlationId: 'corr_trigger_scenario_divergent_001',
        },
        { initialState: first.state },
      ),
    { code: 'STATE_TRANSITION_INVALID' },
  );
  const prohibited = requestFor(seed);
  prohibited.triggers[0].condition = 'Approve execution when the metric crosses threshold.';
  assert.throws(
    () =>
      recordOperatingTriggerScenarioV2(prohibited, draft(), { initialState: seed.result.state }),
    {
      code: 'RESULT_CONTRACT_INVALID',
    },
  );
});

test('scenario and trigger evidence must be declared by the bound snapshot and match its Evidence Artifact before mutation', () => {
  const seed = checkpoint();
  const request = requestFor(seed);
  const before = sha256Jcs(seed.result.state);

  const ambientState = clone(seed.result.state);
  ambientState.evidenceRefs.push({
    ...clone(seed.evidenceRef),
    evidenceRefId: 'evr_trigger_ambient_001',
    candidateId: 'evc_trigger_ambient_001',
  });
  const ambient = clone(request);
  ambient.triggers[0].evidenceRefIds = ['evr_trigger_ambient_001'];
  const ambientBefore = sha256Jcs(ambientState);
  assert.throws(
    () => recordOperatingTriggerScenarioV2(ambient, draft(), { initialState: ambientState }),
    {
      code: 'OPERATING_SCOPE_INVALID',
    },
  );
  assert.equal(sha256Jcs(ambientState), ambientBefore);

  const crossSource = clone(request);
  crossSource.scenarios[0].base.sourceArtifactId = 'art_trigger_cross_source_001';
  assert.throws(
    () =>
      recordOperatingTriggerScenarioV2(crossSource, draft(), { initialState: seed.result.state }),
    {
      code: 'STATE_TRANSITION_INVALID',
    },
    'scenario-case EvidenceRefs cannot be borrowed from another source Artifact',
  );

  const mismatchedHashState = clone(seed.result.state);
  mismatchedHashState.evidenceRefs[0].evidenceArtifactRawHash = `sha256:${'f'.repeat(64)}`;
  const hashBefore = sha256Jcs(mismatchedHashState);
  assert.throws(
    () => recordOperatingTriggerScenarioV2(request, draft(), { initialState: mismatchedHashState }),
    {
      code: 'STATE_TRANSITION_INVALID',
    },
  );
  assert.equal(sha256Jcs(mismatchedHashState), hashBefore);

  assert.throws(
    () =>
      recordOperatingTriggerScenarioV2(
        {
          ...request,
          stateId: 'oms_trigger_wrong_001',
        },
        draft(),
        { initialState: seed.result.state },
      ),
    { code: 'OPERATING_SCOPE_INVALID' },
  );
  assert.equal(sha256Jcs(seed.result.state), before);
});
