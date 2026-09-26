import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { compileOperateContractRegistry } from '../../lib/operate/contracts/compiler.mjs';
import {
  BUSINESS_DOMAIN_ROLE_MANDATES_V2,
  DOMAIN_ROLE_MANDATES_V2,
  INTELLIGENCE_MANDATE_CEILING_V2,
} from '../../lib/operate/contracts/mandate-appendix-v2.mjs';
import { planOperatingIntelligenceBoardV2 } from '../../lib/operate/intelligence-router-v2.mjs';
import { deriveOperatingRuntimeDeltaV2 } from '../../lib/operate/runtime-foundation.mjs';
import { checkpoint } from '../orchestration/operate-operating-intelligence-state-v2.test-support.mjs';

const registry = JSON.parse(
  readFileSync(new URL('../../registry/operate-v2-contracts.json', import.meta.url), 'utf8'),
);
const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );

function pureBoard() {
  const base = checkpoint();
  const derived = deriveOperatingRuntimeDeltaV2(
    {
      cycleId: base.result.state.cycles[0].cycleId,
      snapshotId: base.result.snapshot.snapshotId,
      stateId: base.result.operatingState.stateId,
    },
    {
      deltaId: 'dlt_mandate_appendix_001',
      eventId: 'evt_mandate_appendix_001',
      timestamp: '2026-08-09T12:01:00.000Z',
      correlationId: 'corr_mandate_appendix_001',
    },
    { initialState: base.result.state },
  );
  return planOperatingIntelligenceBoardV2({
    cycleId: base.result.state.cycles[0].cycleId,
    delta: derived.delta,
    snapshot: base.result.snapshot,
    operatingState: base.result.operatingState,
    evidenceRefs: base.result.state.evidenceRefs,
    evidenceArtifacts: base.result.state.artifacts,
    focus: ['all'],
    domainDescriptor: fixture('business-domain-valid.json'),
    decisionOwnerActorId: 'owner-mandate-appendix-001',
    createdAt: '2026-08-09T12:02:00.000Z',
  });
}

test('compiled business roles carry the canonical mandate appendix', () => {
  const catalog = compileOperateContractRegistry(registry);
  const business = catalog.extensions.domains.find(({ domainId }) => domainId === 'business');
  assert.ok(business);
  for (const role of business.roles) {
    assert.deepEqual(role.mandate, BUSINESS_DOMAIN_ROLE_MANDATES_V2[role.roleId]);
    assert.deepEqual(role.mandate.allowedCapabilities, [
      ...INTELLIGENCE_MANDATE_CEILING_V2.allowedCapabilities,
    ]);
    assert.deepEqual(role.mandate.forbiddenEffects, [
      ...INTELLIGENCE_MANDATE_CEILING_V2.forbiddenEffects,
    ]);
  }
});

test('intelligence routing binds mandate onto every issued assignment', () => {
  const board = pureBoard();
  const business = DOMAIN_ROLE_MANDATES_V2.business;
  for (const assignment of board.assignments) {
    assert.deepEqual(assignment.mandate, business[assignment.roleId]);
  }
});
