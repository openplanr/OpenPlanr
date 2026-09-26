import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { planOperatingIntelligenceBoardV2 } from '../../lib/operate/intelligence-router-v2.mjs';
import { deriveOperatingRuntimeDeltaV2 } from '../../lib/operate/runtime-foundation.mjs';
import {
  deriveOperatingAssignmentReleaseIntentsV2,
  validateOperatingIntelligenceAssignmentGraphV2,
} from '../../lib/operate/scheduler-v2.mjs';
import { checkpoint } from './operate-operating-intelligence-state-v2.test-support.mjs';

const PLAN_TIME = '2026-08-09T12:02:00.000Z';
const EXECUTIVE_ADVISOR_IDS = [
  'growth-market',
  'operations-customer',
  'product-activation',
  'strategy-finance',
  'technology-risk',
];
const fixture = (name) => {
  const registration = JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
  registration.policyRequirements = [];
  return registration;
};

function boardInput(domainDescriptor) {
  const base = checkpoint();
  const derived = deriveOperatingRuntimeDeltaV2(
    {
      cycleId: base.result.state.cycles[0].cycleId,
      snapshotId: base.result.snapshot.snapshotId,
      stateId: base.result.operatingState.stateId,
    },
    {
      deltaId: 'dlt_parallel_advisors_001',
      eventId: 'evt_parallel_advisors_delta_001',
      timestamp: '2026-08-09T12:01:00.000Z',
      correlationId: 'corr_parallel_advisors_delta_001',
    },
    { initialState: base.result.state },
  );
  return {
    cycleId: base.result.state.cycles[0].cycleId,
    delta: derived.delta,
    snapshot: base.result.snapshot,
    operatingState: base.result.operatingState,
    evidenceRefs: base.result.state.evidenceRefs,
    evidenceArtifacts: base.result.state.artifacts,
    focus: ['all'],
    domainDescriptor,
    decisionOwnerActorId: 'owner-parallel-advisors-001',
    createdAt: PLAN_TIME,
  };
}

test('the router fans out every advisor seat in parallel while scheduling by kernel kind', () => {
  const board = planOperatingIntelligenceBoardV2(boardInput(fixture('business-domain-valid.json')));
  assert.deepEqual(
    board.plan.selectedRoles
      .filter(({ roleKind }) => roleKind === 'advisor')
      .map(({ roleId }) => roleId),
    [...EXECUTIVE_ADVISOR_IDS].sort((left, right) => left.localeCompare(right)),
  );
  assert.equal(
    [...board.plan.selectedRoles.find(({ roleKind }) => roleKind === 'challenger').dependsOnRoleIds]
      .sort()
      .join(','),
    [...EXECUTIVE_ADVISOR_IDS].sort().join(','),
  );
  assert.deepEqual(
    [
      ...board.plan.selectedRoles.find(({ roleKind }) => roleKind === 'chair').dependsOnRoleIds,
    ].sort(),
    [...EXECUTIVE_ADVISOR_IDS, 'independent-challenge'].sort(),
  );
  assert.equal(board.assignments.length, 7);
  assert.ok(
    board.assignments.every(
      ({ assignmentKind, roleId }) =>
        (assignmentKind === 'advisor' && EXECUTIVE_ADVISOR_IDS.includes(roleId)) ||
        (assignmentKind === 'challenger' && roleId === 'independent-challenge') ||
        (assignmentKind === 'chair' && roleId === 'chair'),
    ),
  );
  assert.ok(
    board.assignments
      .filter(({ assignmentKind }) => assignmentKind === 'advisor')
      .every(({ dependsOn }) => dependsOn.length === 0),
  );
});

test('advisor assignments release in parallel and challenger waits for every advisor proof', () => {
  const board = planOperatingIntelligenceBoardV2(boardInput(fixture('business-domain-valid.json')));
  validateOperatingIntelligenceAssignmentGraphV2(board.plan, board.assignments);

  const advisorAssignments = board.assignments.filter(
    ({ assignmentKind }) => assignmentKind === 'advisor',
  );
  const challenger = board.assignments.find(
    ({ assignmentKind }) => assignmentKind === 'challenger',
  );
  const intents = deriveOperatingAssignmentReleaseIntentsV2({ assignments: board.assignments });
  assert.deepEqual(
    intents.map(({ assignmentId }) => assignmentId).sort(),
    advisorAssignments.map(({ assignmentId }) => assignmentId).sort(),
  );
  assert.equal(
    intents.some(({ assignmentId }) => assignmentId === challenger.assignmentId),
    false,
  );
});
