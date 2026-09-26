import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPersistentWorkMaterializationPayloadV2 } from '../../lib/operate/persistent-work-v2.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

function work(seed) {
  const suffix = String(seed).padStart(8, '0');
  return {
    kind: 'operating-work-change-set',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    cycleId: 'cyc_00000001',
    scopeId: 'scope-acme',
    domainId: 'business',
    domainVersion: '1.0.0',
    findings: [
      {
        draftRef: `draft_find_${suffix}`,
        title: `Finding ${seed}`,
        statement: `Statement ${seed}.`,
        state: 'open',
        ownerActorId: 'owner-001',
        revisitAt: null,
      },
    ],
    decisions: [
      {
        draftRef: `draft_dec_${suffix}`,
        title: `Decision ${seed}`,
        question: `Question ${seed}?`,
        rationale: `Rationale ${seed}.`,
        evidenceRefIds: ['evr_00000001'],
        alternatives: ['Do nothing.'],
        confidence: 0.5,
        assumptionIds: [],
        expectedUpside: `Upside ${seed}.`,
        expectedDownside: `Downside ${seed}.`,
        dissent: [],
        reopenConditions: ['Evidence changes materially.'],
        revisitConditions: ['Metric changes.'],
        ownerActorId: 'owner-001',
        revisitAt: null,
      },
    ],
    actions: [
      {
        draftRef: `draft_act_${suffix}`,
        title: `Action ${seed}`,
        ownerActorId: null,
        accountabilityDisposition: 'blocked',
        sourceDecisionDraftRef: `draft_dec_${suffix}`,
        sourceFindingDraftRefs: [`draft_find_${suffix}`],
        dependsOnActionDraftRefs: [],
        objectiveId: 'obj_00000001',
        expectedResult: `Result ${seed}.`,
        metricId: 'met_00000001',
        baseline: 0,
        target: 1,
        verificationWindow: '30d',
        verificationPlanId: 'vfy_00000001',
      },
    ],
  };
}

test('256 seeded local draft sets derive deterministic, distinct runtime-issued IDs without model input', () => {
  const ids = new Set();
  for (let seed = 1; seed <= 256; seed += 1) {
    const changeSet = work(seed);
    const artifact = {
      kind: 'operating-artifact',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      artifactId: `art_work_${String(seed).padStart(8, '0')}`,
      artifactType: 'chair-result',
      assignmentId: 'asg_chair_0001',
      cycleId: 'cyc_00000001',
      scopeId: 'scope-acme',
      domainId: 'business',
      domainVersion: '1.0.0',
      schemaId: 'operating-work-change-set',
      artifactSchemaVersion: '2.0.0',
      mediaType: 'application/json',
      encoding: 'utf-8',
      rawHash: `sha256:${'a'.repeat(56)}${String(seed).padStart(8, '0')}`,
      canonicalHash: sha256Jcs(changeSet),
      sizeBytes: 1,
      storageClass: 'machine-local',
      sensitivity: 'internal',
      retentionClass: 'project',
      producer: { actorId: 'chair-001', roleId: 'chair', runtime: 'codex' },
      inputArtifactIds: [],
      createdAt: '2026-08-08T10:00:00.000Z',
    };
    const first = buildPersistentWorkMaterializationPayloadV2({
      artifact,
      changeSet,
      timestamp: '2026-08-08T10:01:00.000Z',
    });
    const second = buildPersistentWorkMaterializationPayloadV2({
      artifact,
      changeSet: structuredClone(changeSet),
      timestamp: '2026-08-08T10:01:00.000Z',
    });
    assert.equal(sha256Jcs(first), sha256Jcs(second), `seed ${seed}: deterministic`);
    for (const id of [
      first.findings[0].findingId,
      first.decisions[0].decisionId,
      first.actions[0].actionId,
    ]) {
      assert.equal(ids.has(id), false, `seed ${seed}: runtime identity collision`);
      ids.add(id);
    }
  }
});
