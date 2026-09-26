import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertOperateAuthorityV2,
  evaluateOperateAuthorityV2,
} from '../../lib/operate/authorization-v2.mjs';
import {
  deriveOperateAllowedActionsV2,
  evaluateOperateGuardV2,
} from '../../lib/operate/runtime-foundation.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';
import {
  approveContext,
  executeContext,
  rollbackContext,
} from './operate-authorization-v2.test.mjs';

function generator(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

test('INV012 property: every emitted governed action authorizes immediately against byte-identical state', () => {
  const random = generator(0xa1170);
  for (let seed = 0; seed < 512; seed += 1) {
    const context =
      random() < 0.34 ? approveContext() : random() < 0.67 ? executeContext() : rollbackContext();
    if (random() < 0.35) context.capabilities = [];
    if (random() < 0.25) context.target.revision = `revision-${seed}`;
    if (random() < 0.2 && context.policyEvaluation) context.policyEvaluation.action.revision += 1;
    if (random() < 0.2 && context.grant) context.grant.consumedAt = context.now;
    const before = sha256Jcs(context);
    for (const action of deriveOperateAllowedActionsV2(context).filter(
      ({ tool }) =>
        tool === 'operate.action.approve' ||
        tool === 'operate.action.execute' ||
        tool === 'operate.action.rollback',
    )) {
      const selected = { ...context, actionRequest: structuredClone(action.arguments) };
      const decision = assertOperateAuthorityV2(action.tool, selected);
      assert.equal(decision.allowed, true, `seed ${seed}: ${action.tool}`);
      assert.equal(
        evaluateOperateGuardV2(action.tool, selected).allowed,
        true,
        `seed ${seed}: runtime symmetry`,
      );
    }
    assert.equal(sha256Jcs(context), before, `seed ${seed}: derivation is pure`);
  }
});

test('fail-closed property: one independently widened authority dimension never becomes executable', () => {
  const mutations = [
    (context) => {
      context.capabilities = ['*'];
    },
    (context) => {
      context.actor.capabilities = ['bounded-project-write'];
    },
    (context) => {
      delete context.actionPolicies;
    },
    (context) => {
      context.actionPolicies = context.actionPolicies.filter(({ tier }) => tier !== 'core');
    },
    (context) => {
      context.actionPolicies[0].policyHash = `sha256:${'0'.repeat(64)}`;
    },
    (context) => {
      context.actionRequest.action.actionHash = `sha256:${'e'.repeat(64)}`;
    },
    (context) => {
      context.scope.domainVersion = '9.9.9';
    },
    (context) => {
      context.target.id = 'another-record';
    },
    (context) => {
      context.policyEvaluation.capability = { id: 'broader-write', version: '1.0.0' };
    },
    (context) => {
      context.policyEvaluation.outcome = 'automatic';
    },
    (context) => {
      context.policyEvaluation.appliedPolicyRefs[0].policyId = 'alien-policy';
    },
    (context) => {
      context.policyEvaluation.evaluatedAt = '2026-08-10T08:04:00Z';
    },
    (context) => {
      context.approvalRequirements.push(structuredClone(context.approvalRequirements[0]));
    },
    (context) => {
      context.approvals[0].partyId = 'another-party';
    },
    (context) => {
      context.approvals[0].issuedAt = '2026-08-10T08:04:00Z';
    },
    (context) => {
      context.grant.operationId = 'op_00000009';
    },
    (context) => {
      context.grant.issuer.id = 'another-runtime';
    },
    (context) => {
      context.grant.issuedAt = '2026-08-10T08:00:00Z';
    },
    (context) => {
      context.capabilityAvailability.checkedAt = '2026-08-10T08:04:00Z';
    },
    (context) => {
      context.currentPreconditionArtifactIds = [];
    },
    (context) => {
      context.executor.supportedDomains = ['business'];
    },
    (context) => {
      context.executor.health.checkedAt = '2026-08-10T08:04:00Z';
    },
    (context) => {
      context.operation.connector = { id: 'unknown-connector', version: '1.0.0' };
    },
    (context) => {
      context.operation.inputArtifactIds.push('art_00000009');
    },
    (context) => {
      context.operation.rollbackClass = 'not-applicable';
    },
    (context) => {
      context.operationHistory = [
        {
          operationId: context.operation.operationId,
          requestFingerprint: `sha256:${'f'.repeat(64)}`,
          actionId: context.action.actionId,
          actionRevision: context.action.revision,
          actionHash: context.action.actionHash,
          terminalResultId: 'xres_00000001',
        },
      ];
    },
  ];
  for (let seed = 1; seed <= 360; seed += 1) {
    const context = executeContext();
    mutations[(seed - 1) % mutations.length](context, seed);
    const before = sha256Jcs(context);
    let effectCalls = 0;
    context.providerDispatch = () => {
      effectCalls += 1;
    };
    context.modelDispatch = () => {
      effectCalls += 1;
    };
    context.connectorDispatch = () => {
      effectCalls += 1;
    };
    context.targetAccess = () => {
      effectCalls += 1;
    };
    context.effect = () => {
      effectCalls += 1;
    };
    const decision = evaluateOperateAuthorityV2('operate.action.execute', context);
    assert.equal(decision.allowed, false, `seed ${seed}`);
    assert.equal(
      deriveOperateAllowedActionsV2(context).some(({ tool }) => tool === 'operate.action.execute'),
      false,
      `seed ${seed}`,
    );
    assert.equal(effectCalls, 0, `seed ${seed}: denial invokes no effect seam`);
    delete context.providerDispatch;
    delete context.modelDispatch;
    delete context.connectorDispatch;
    delete context.targetAccess;
    delete context.effect;
    assert.equal(sha256Jcs(context), before, `seed ${seed}: rejected widening is immutable`);
  }
});
