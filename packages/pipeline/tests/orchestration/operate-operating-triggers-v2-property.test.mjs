import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { buildOperatingTriggerScenarioTransitionV2 } from '../../lib/operate/operating-triggers-v2.mjs';
import { checkpoint } from './operate-operating-intelligence-state-v2.test-support.mjs';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../conformance/fixtures/operating-runtime-v2/${name}`, import.meta.url),
      'utf8',
    ),
  );
const clone = (value) => structuredClone(value);

test('trigger/scenario construction rejects duplicate identities before any runtime transaction', () => {
  const seed = checkpoint();
  const value = fixture('operating-trigger-scenario-valid.json').scenario;
  const common = {
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    snapshotId: seed.result.snapshot.snapshotId,
    sourceArtifactId: seed.sourceArtifactId,
    assumptionIds: [seed.assumption.assumptionId],
    evidenceRefIds: [seed.evidenceRef.evidenceRefId],
  };
  const scenario = {
    ...value,
    ...common,
    base: {
      ...value.base,
      assumptionIds: common.assumptionIds,
      evidenceRefIds: common.evidenceRefIds,
    },
    upside: {
      ...value.upside,
      assumptionIds: common.assumptionIds,
      evidenceRefIds: common.evidenceRefIds,
    },
    downside: {
      ...value.downside,
      assumptionIds: common.assumptionIds,
      evidenceRefIds: common.evidenceRefIds,
    },
  };
  assert.throws(
    () =>
      buildOperatingTriggerScenarioTransitionV2({
        snapshot: seed.result.snapshot,
        operatingState: seed.result.operatingState,
        evidenceRefs: seed.result.state.evidenceRefs,
        evidenceArtifacts: seed.result.state.artifacts,
        scenarios: [scenario, clone(scenario)],
      }),
    {
      code: 'STATE_TRANSITION_INVALID',
    },
  );
});
