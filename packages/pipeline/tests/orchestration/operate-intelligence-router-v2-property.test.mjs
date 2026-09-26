import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { planOperatingIntelligenceBoardV2 } from '../../lib/operate/intelligence-router-v2.mjs';
import { deriveOperatingRuntimeDeltaV2 } from '../../lib/operate/runtime-foundation.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { checkpoint } from './operate-operating-intelligence-state-v2.test-support.mjs';

const EXECUTIVE_ADVISOR_IDS = [
  'growth-market',
  'operations-customer',
  'product-activation',
  'strategy-finance',
  'technology-risk',
];
const BUSINESS_BOARD_ROLE_IDS = [...EXECUTIVE_ADVISOR_IDS, 'independent-challenge', 'chair'];
const clone = (value) => structuredClone(value);
const canonicalBoard = (board) => ({
  ...board,
  bundleCaptures: board.bundleCaptures.map(({ rawBytes, ...capture }) => ({
    ...capture,
    rawBytesBase64: Buffer.from(rawBytes).toString('base64'),
  })),
});
const domain = JSON.parse(
  readFileSync(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/business-domain-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

function inputs() {
  const seed = checkpoint();
  const delta = deriveOperatingRuntimeDeltaV2(
    {
      cycleId: seed.result.state.cycles[0].cycleId,
      snapshotId: seed.result.snapshot.snapshotId,
      stateId: seed.result.operatingState.stateId,
    },
    {
      deltaId: 'dlt_router_property_001',
      eventId: 'evt_router_delta_property_001',
      timestamp: '2026-08-09T12:01:00.000Z',
      correlationId: 'corr_router_delta_property_001',
    },
    { initialState: seed.result.state },
  ).delta;
  return { seed, delta };
}

test('routing is stable across canonical focus and descriptor order permutations', () => {
  const { seed, delta } = inputs();
  const baselineInput = {
    cycleId: seed.result.state.cycles[0].cycleId,
    delta,
    snapshot: seed.result.snapshot,
    operatingState: seed.result.operatingState,
    evidenceRefs: seed.result.state.evidenceRefs,
    evidenceArtifacts: seed.result.state.artifacts,
    focus: ['all', 'scenario'],
    domainDescriptor: domain,
    decisionOwnerActorId: 'owner-router-property-001',
    createdAt: '2026-08-09T12:02:00.000Z',
  };
  const baseline = planOperatingIntelligenceBoardV2(baselineInput);
  for (let index = 0; index < 64; index += 1) {
    const candidate = clone(baselineInput);
    if (index % 2 === 0) candidate.focus.reverse();
    if (index % 3 === 0) candidate.focus = [...new Set(candidate.focus)];
    assert.equal(
      sha256Jcs(canonicalBoard(planOperatingIntelligenceBoardV2(candidate))),
      sha256Jcs(canonicalBoard(baseline)),
      `permutation ${index}`,
    );
  }
});

test('every material Delta field independently selects challenge and only scenario-relevant fields request scenarios', () => {
  const { seed, delta } = inputs();
  const empty = {
    ...clone(delta),
    sourceRevisionChanges: [],
    metricChanges: [],
    staleEvidenceRefIds: [],
    conflictingEvidenceRefIds: [],
    invalidatedAssumptionIds: [],
    exposedRiskIds: [],
    decisionRevisitIds: [],
  };
  const cases = [
    ['sourceRevisionChanges', [{ subjectId: 'source-001', kind: 'changed' }], false],
    ['metricChanges', [{ subjectId: 'metric-001', kind: 'changed' }], false],
    ['staleEvidenceRefIds', ['evr_router_property_001'], false],
    ['conflictingEvidenceRefIds', ['evr_router_property_001'], true],
    ['invalidatedAssumptionIds', ['asm_router_property_001'], true],
    ['exposedRiskIds', ['rsk_router_property_001'], true],
    ['decisionRevisitIds', ['dec_router_property_001'], true],
  ];
  for (const [field, value, scenario] of cases) {
    const board = planOperatingIntelligenceBoardV2({
      cycleId: seed.result.state.cycles[0].cycleId,
      delta: { ...clone(empty), [field]: value },
      snapshot: seed.result.snapshot,
      operatingState: seed.result.operatingState,
      evidenceRefs: seed.result.state.evidenceRefs,
      evidenceArtifacts: seed.result.state.artifacts,
      focus: ['routine'],
      domainDescriptor: clone(domain),
      decisionOwnerActorId: 'owner-router-property-001',
      createdAt: '2026-08-09T12:02:00.000Z',
    });
    assert.equal(board.plan.challengerRequired, true, field);
    assert.equal(board.plan.scenarioRequest.requested, scenario, field);
    assert.deepEqual(
      board.plan.selectedRoles.map(({ roleId }) => roleId),
      BUSINESS_BOARD_ROLE_IDS,
      field,
    );
  }
});
