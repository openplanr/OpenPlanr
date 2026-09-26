import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateOperatingApprovalSetV2 } from '../../lib/operate/approvals-v2.mjs';
import { assertProtocolArtifact } from '../../lib/protocol/contracts.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import { authority, record } from './operate-approvals-v2.test.mjs';

test('approval quorum property: 384 record order/replay vectors authorize only exact distinct complete parties', () => {
  const state = authority('threshold');
  const approvals = [record(state, 0), record(state, 1), record(state, 2)];
  for (let seed = 0; seed < 384; seed += 1) {
    const count = seed % 4;
    const selected = approvals.slice(0, Math.min(count, 3));
    if (seed % 2 === 1) selected.reverse();
    const before = sha256Jcs({ state, selected });
    const result = evaluateOperatingApprovalSetV2({
      evaluation: state.evaluation,
      action: state.action,
      requirements: [state.requirement],
      approvals: selected,
      now: '2026-08-10T08:02:00Z',
    });
    assert.equal(result.complete, selected.length >= 2, `seed ${seed}`);
    assert.equal(sha256Jcs({ state, selected }), before, `seed ${seed}: pure`);
  }
});

test('exact scope property: copied Action, target, policy, evaluation, and party approval never authorizes', () => {
  const mutations = [
    (recordValue) => {
      recordValue.action.revision += 1;
    },
    (recordValue) => {
      recordValue.action.actionHash = `sha256:${'f'.repeat(64)}`;
    },
    (recordValue) => {
      recordValue.target.revision = 'another-revision';
    },
    (recordValue) => {
      recordValue.capability.id = 'broader-write';
    },
    (recordValue) => {
      recordValue.policy.policyVersion = '2.0.0';
    },
    (recordValue) => {
      recordValue.evaluationId = 'pevl_other001';
    },
    (recordValue) => {
      recordValue.partyId = 'another-party';
    },
    (recordValue) => {
      recordValue.scopeId = 'another-scope';
    },
  ];
  for (let seed = 0; seed < 256; seed += 1) {
    const state = authority();
    const approval = structuredClone(record(state));
    mutations[seed % mutations.length](approval);
    assert.throws(
      () =>
        evaluateOperatingApprovalSetV2({
          evaluation: state.evaluation,
          action: state.action,
          requirements: [state.requirement],
          approvals: [approval],
          now: '2026-08-10T08:02:00Z',
        }),
      ({ code }) => code === 'APPROVAL_INVALID',
      `seed ${seed}`,
    );
  }
});

test('requirement integrity property: schema-valid party/cardinality forgeries always fail closed', () => {
  for (let seed = 0; seed < 256; seed += 1) {
    const state = authority(
      seed % 6 === 5 ? 'named-multi-party' : seed % 6 === 0 ? 'named-single-party' : 'threshold',
    );
    const requirement = structuredClone(state.requirement);
    switch (seed % 6) {
      case 0:
        requirement.parties.push({
          ...structuredClone(requirement.parties[0]),
          partyId: 'outsider-party',
          actorId: null,
        });
        break;
      case 1:
        requirement.parties[2].actorId = null;
        requirement.namedActorIds = requirement.namedActorIds.slice(0, 2);
        break;
      case 2:
        requirement.namedActorIds[2] = 'outsider-0001';
        break;
      case 3:
        requirement.requiredActorKinds = ['engine'];
        break;
      case 4:
        requirement.parties[1].partyId = requirement.parties[0].partyId;
        break;
      default:
        requirement.threshold = 2;
        break;
    }
    delete requirement.scopeHash;
    requirement.scopeHash = sha256Jcs(requirement);
    assert.doesNotThrow(
      () =>
        assertProtocolArtifact('operating-approval-requirement', requirement, {
          protocolVersion: '2.0.0',
        }),
      `seed ${seed}: forged requirement remains schema-valid`,
    );
    assert.throws(
      () =>
        evaluateOperatingApprovalSetV2({
          evaluation: state.evaluation,
          action: state.action,
          requirements: [requirement],
          approvals: [],
          now: '2026-08-10T08:02:00Z',
        }),
      ({ code }) => code === 'APPROVAL_INVALID',
      `seed ${seed}`,
    );
  }
});
