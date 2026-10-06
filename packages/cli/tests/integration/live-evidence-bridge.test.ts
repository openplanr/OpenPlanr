// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createOperateClient, type OperateActorV2 } from '../../src/services/operate/client.js';
import type { OperateStoredRuntime } from '../../src/services/operate/store.js';

const actor: OperateActorV2 = {
  actorId: 'connector.runtime',
  kind: 'agent',
  runtime: 'openplanr',
};

function runtime(outputSchemaId = 'operating-live-evidence-ingestion'): OperateStoredRuntime {
  const assignmentId = 'asg_liveevidence00000001';
  const submissionId = 'sub_liveevidence00000001';
  return {
    generation: 'gen_00000000000000000000000000000001',
    baseState: {},
    events: [],
    artifacts: new Map(),
    preferences: {
      selectedScopeId: null,
      selectedDomainId: null,
      selectedDomainVersion: null,
      lastCycleId: null,
      reviewOwners: {},
      cycleModes: {},
      cycleDeliveryRoutes: {},
      assignmentArtifactIds: {
        [assignmentId]: 'art_liveevidence00000001',
      },
      cycleRoleAssignments: {},
      cycleIntelligencePlanIds: {},
      actorMemberships: {},
    },
    state: {
      assignments: [
        {
          assignmentId,
          assignmentKind: 'verification',
          state: 'running',
          claim: {
            actorId: actor.actorId,
            actorKind: actor.kind,
            runtime: actor.runtime,
          },
          inputArtifactIds: [],
          outputContract: {
            schemaId: outputSchemaId,
            schemaVersion: '2.0.0',
            mediaType: 'application/json',
            encoding: 'utf-8',
            maxBytes: 65_536,
          },
        },
      ],
      submissions: [
        {
          assignmentId,
          submissionId,
          state: 'issued',
        },
      ],
    },
  };
}

function clientFor(source: OperateStoredRuntime) {
  const client = createOperateClient('/tmp/openplanr-live-evidence-no-store');
  Object.defineProperty(client, 'requiredRuntime', {
    configurable: true,
    value: async () => source,
  });
  return client;
}

describe('live-evidence Operate bridge', () => {
  it('prepares deterministic runtime identities without Store or provider effects', async () => {
    const client = clientFor(runtime());
    const input = {
      assignmentId: 'asg_liveevidence00000001',
      submissionId: 'sub_liveevidence00000001',
      actor,
    } as const;

    const first = await client.prepareLiveEvidenceSubmission(input);
    const second = await client.prepareLiveEvidenceSubmission(input);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      artifactId: 'art_liveevidence00000001',
      assignment: {
        assignmentKind: 'verification',
        outputContract: { schemaId: 'operating-live-evidence-ingestion' },
      },
    });
    expect(first.acceptanceEventIds.submitted).not.toBe(first.acceptanceEventIds.artifactCreated);
    expect(JSON.stringify(first)).not.toContain('/tmp/');
  });

  it('refuses the generic verification submit path before staging ingestion bytes', async () => {
    const client = clientFor(runtime());
    const response = await client.dispatch({
      operation: 'operate.assignment.submit',
      request: {
        assignmentId: 'asg_liveevidence00000001',
        submissionId: 'sub_liveevidence00000001',
        actor,
        mediaType: 'application/json',
        encoding: 'utf-8',
        contentBase64: Buffer.from('{}').toString('base64'),
      },
    });

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'CAPABILITY_DENIED', retryable: false },
    });
  });

  it('rejects foreign output contracts and claimant identities pre-effect', async () => {
    const foreignContract = clientFor(runtime('operating-outcome'));
    await expect(
      foreignContract.prepareLiveEvidenceSubmission({
        assignmentId: 'asg_liveevidence00000001',
        submissionId: 'sub_liveevidence00000001',
        actor,
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });

    const exact = clientFor(runtime());
    await expect(
      exact.prepareLiveEvidenceSubmission({
        assignmentId: 'asg_liveevidence00000001',
        submissionId: 'sub_liveevidence00000001',
        actor: { ...actor, actorId: 'foreign.agent' },
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });
});
