#!/usr/bin/env node

import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { verifyOperateV2GovernedExecution } from './verify-operate-v2-governed-execution.mjs';
import { verifyOperatingIntelligenceV2 } from './verify-operate-v2-operating-intelligence.mjs';

const DOMAIN_IDS = Object.freeze(['business', 'software']);

function exactDomains(values, label) {
  assert.deepEqual(values, DOMAIN_IDS, `${label} must certify business and software in order`);
}

/**
 * Certify the public, contained Operate product journey without a source-repo,
 * network, credential, provider, or external target dependency.
 *
 * OpenPlanr owns the installed Planning/SPEC transaction. This package-owned
 * verifier certifies the portable intelligence, authority, execution, recovery,
 * verification, replay, and no-external-effect boundary consumed by that product.
 */
export async function verifyOperateV2ProductExperience() {
  const intelligence = verifyOperatingIntelligenceV2();
  const governed = await verifyOperateV2GovernedExecution();

  exactDomains(intelligence.domains, 'operating intelligence');
  exactDomains(governed.journeys.map(({ domainId }) => domainId), 'governed execution');
  assert.equal(intelligence.ok, true);
  assert.equal(governed.ok, true);
  assert.equal(governed.networkAttempts, 0);
  assert.equal(governed.credentialReads, 0);
  assert.equal(governed.externalEffects, 0);
  assert.equal(governed.realEffects, 0);

  const journeys = DOMAIN_IDS.map((domainId) => {
    const operating = intelligence.journeys.find((journey) => journey.domainId === domainId);
    const execution = governed.journeys.find((journey) => journey.domainId === domainId);
    assert.ok(operating && execution, `${domainId} must have both journey halves`);
    assert.equal(operating.modelDispatchCount, 0);
    assert.equal(execution.counts.modelDispatches, 0);
    assert.equal(execution.execution.acknowledgementLossRecovered, true);
    assert.equal(execution.execution.replayDispatchCount, 0);
    assert.equal(execution.execution.restartDispatchCount, 0);
    assert.equal(execution.execution.divergentRetry.effects, 0);
    assert.equal(execution.execution.divergentRetry.hostAccesses, 0);
    assert.equal(execution.execution.divergentRetry.targetAccesses, 0);
    assert.equal(execution.verification.revisit, true);
    if (domainId === 'business') assert.equal(execution.rollback?.status, 'succeeded');
    else assert.equal(execution.rollback, null);
    return Object.freeze({
      domainId,
      scopeId: execution.scopeId,
      cycleId: execution.cycleId,
      actionId: execution.actionId,
      intelligence: Object.freeze({
        finalEventSequence: operating.finalEventSequence,
        finalEventHash: operating.finalEventHash,
        modelDispatchCount: operating.modelDispatchCount,
        stageOrder: operating.stageOrder,
      }),
      execution: Object.freeze({
        operationId: execution.execution.operationId,
        resultId: execution.execution.resultId,
        dispatchCount: execution.execution.dispatchCount,
        acknowledgementLossRecovered: execution.execution.acknowledgementLossRecovered,
        recoveryClassification: execution.execution.recoveryClassification,
        divergentRetry: execution.execution.divergentRetry,
      }),
      rollback: execution.rollback,
      verification: execution.verification,
      counts: execution.counts,
    });
  });

  return Object.freeze({
    ok: true,
    kind: 'operate-v2-product-experience-conformance',
    schemaVersion: '1.0.0',
    protocolVersion: governed.protocolVersion,
    domains: DOMAIN_IDS,
    contracts: governed.contracts,
    checks: Object.freeze({ intelligence: intelligence.checks, governed: governed.checks }),
    safety: Object.freeze({
      networkAttempts: governed.networkAttempts,
      credentialReads: governed.credentialReads,
      externalEffects: governed.externalEffects,
      realEffects: governed.realEffects,
      containedEffects: journeys.reduce((total, journey) => total + journey.counts.effects, 0),
      modelDispatches: journeys.reduce(
        (total, journey) => total + journey.intelligence.modelDispatchCount + journey.counts.modelDispatches,
        0,
      ),
    }),
    journeys,
    stop: 'Local certification only: no release, publish, deploy, marketplace promotion, credential, network, production, customer, payment, merge, or destructive effect.',
  });
}

if (process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.stdout.write(`${JSON.stringify(await verifyOperateV2ProductExperience())}\n`);
}
