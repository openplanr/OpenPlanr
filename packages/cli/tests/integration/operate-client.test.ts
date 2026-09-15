import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type OperatingAssignmentClaimV2, sha256Jcs } from 'planr-pipeline/protocol';
import { assertOperateExecutiveBoardDisplaySurfaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-executive-board-display-surface.mjs';
import {
  assertOperateExperienceAuditDisplaySurfaceV1,
  type OperateAuditDisplayBindingV1,
  type OperateExperienceAuditDisplaySurfaceV1,
} from 'planr-pipeline/schemas/v1.2.0/operate-experience-audit-display-surface.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createOperateClient,
  type OperateAllowedActionV2,
  type OperateAuditDisplayRequestV1,
  type OperateDispatchRequestV2,
} from '../../src/services/operate/client.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

const projects: TestProject[] = [];
afterEach(() => {
  for (const project of projects.splice(0)) project.cleanup();
});

async function dispatchAllowedAction(
  client: ReturnType<typeof createOperateClient>,
  action: OperateAllowedActionV2,
) {
  return await client.dispatch({
    operation: action.tool,
    request: action.arguments,
  } as OperateDispatchRequestV2);
}

type JsonRecord = Record<string, unknown>;
type AuditDisplay = Readonly<OperateExperienceAuditDisplaySurfaceV1>;

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;
const AUDIT_OUTCOME_ID = 'outcome-client-audit';
const AUDIT_ACTION_ID = 'act_client_audit_00000001';
const AUDIT_PLAN_ID = 'verify-client-audit';
const PRIVATE_EXPORT_ACTOR = 'private-export-actor-must-not-cross';

function record(value: unknown): JsonRecord {
  return (value ?? {}) as JsonRecord;
}

function executiveBoardBinding(view: JsonRecord, cycleId: string): JsonRecord {
  return Object.freeze({
    actorId: String(view.actorId),
    scopeId: String(view.scopeId),
    domainId: String(view.domainId),
    domainVersion: String(view.domainVersion),
    cycleId,
    subjectId: cycleId,
    generatedAt: String(view.generatedAt),
    eventHead: record(view.eventHead),
    viewHash: String(view.viewHash),
  });
}

function withExecutiveBoard(value: JsonRecord, cycleId: string): JsonRecord {
  const source = structuredClone(value);
  delete source.viewHash;
  const cycle = (source.cycles as JsonRecord[]).find((entry) => entry.cycleId === cycleId);
  if (!cycle) throw new Error('missing cycle');
  cycle.lensAbsences = [];
  cycle.executiveBoard = {
    cycleId,
    planId: 'ipl_client_board_0001',
    seats: [
      {
        roleId: 'strategy-finance',
        label: 'CEO',
        roleKind: 'advisor',
        roleVersion: '1.0.0',
        assignmentId: 'asg_client_board_0001',
        assignmentState: 'validated',
        artifact: {
          artifactId: 'art_client_board_0001',
          rawHash: HASH_A,
          canonicalHash: HASH_B,
        },
        absence: null,
      },
    ],
    challengerFindings: null,
    chairSynthesis: null,
  };
  return { ...source, viewHash: sha256Jcs(source) };
}

function withAuditOutcome(value: JsonRecord): JsonRecord {
  const source = structuredClone(value);
  delete source.viewHash;
  const generatedAt = String(source.generatedAt);
  const eventHead = structuredClone(record(source.eventHead));
  const action = {
    actionId: AUDIT_ACTION_ID,
    revision: 1,
    actionHash: HASH_A,
    title: 'Keep the client audit Outcome evidence-bound',
    state: 'completed',
    ownerActorId: PRIVATE_EXPORT_ACTOR,
    expectedResult: 'One exact insufficient-evidence Outcome remains visible.',
    verificationPlanId: AUDIT_PLAN_ID,
    deliveryRoute: {
      kind: 'operating-delivery-route',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      routeId: 'droute_client_audit_00000001',
      scopeId: source.scopeId,
      domainId: source.domainId,
      domainVersion: source.domainVersion,
      action: { actionId: AUDIT_ACTION_ID, revision: 1, actionHash: HASH_A },
      eventHead,
      route: 'observe-only',
      rationale: 'The client test never turns a display read into authority.',
      createdAt: generatedAt,
      routeHash: HASH_B,
    },
    dependencyActionIds: [],
    executions: [],
    rollbacks: [],
    deepLink: `#/operate/actions/${AUDIT_ACTION_ID}`,
  };
  const outcome = {
    outcomeId: AUDIT_OUTCOME_ID,
    actionId: AUDIT_ACTION_ID,
    verificationPlanId: AUDIT_PLAN_ID,
    status: 'insufficient-evidence',
    metric: {
      metricId: 'metric-client-audit',
      metricHash: HASH_B,
      baseline: 1,
      target: 2,
      observed: null,
      unit: 'count',
      window: 'next observation',
      dueAt: null,
      freshness: 'unknown',
      confidence: null,
    },
    observationIds: [],
    evidenceRefIds: [],
    observedAt: generatedAt,
    decision: null,
    execution: [],
    rollback: [],
    verification: {
      verificationPlanId: AUDIT_PLAN_ID,
      verificationPlanHash: HASH_C,
      metricId: 'metric-client-audit',
      metricHash: HASH_B,
      method: 'Wait for one accepted observation.',
      evaluationRules: ['Do not infer success without an accepted observation.'],
      observationRequest: {
        kind: 'future-observation',
        reason: 'The current durable state has no accepted observation.',
      },
      accessReason: null,
    },
    nextObservation: {
      kind: 'future-observation',
      reason: 'Capture one accepted observation.',
      dueAt: null,
    },
    revisit: null,
    snapshot: null,
    delta: null,
    accessReason: null,
    deepLink: `#/operate/outcomes/${AUDIT_OUTCOME_ID}`,
  };
  const base = {
    ...source,
    actions: [...(source.actions as JsonRecord[]), action],
    outcomes: [...(source.outcomes as JsonRecord[]), outcome],
    learnings: [
      ...(source.learnings as JsonRecord[]),
      {
        learningId: 'learning-client-audit',
        outcomeId: AUDIT_OUTCOME_ID,
        statement: 'Missing evidence remains a reason to revisit the Decision.',
        decisionIds: [],
        evidenceRefIds: [],
        createdAt: generatedAt,
      },
    ],
  };
  return { ...base, viewHash: sha256Jcs(base as never) };
}

function auditBinding(
  view: JsonRecord,
  request: OperateAuditDisplayRequestV1,
): OperateAuditDisplayBindingV1 {
  return {
    actorId: String(view.actorId),
    scopeId: String(view.scopeId),
    domainId: String(view.domainId),
    domainVersion: String(view.domainVersion),
    cycleId: request.cycleId,
    subjectId: request.subjectId ?? null,
    surface: request.surface,
    query: request.surface === 'search' ? (request.query ?? '') : null,
    format: request.surface === 'export' ? (request.format ?? 'json') : null,
    generatedAt: String(view.generatedAt),
    eventHead: record(view.eventHead) as OperateAuditDisplayBindingV1['eventHead'],
    viewHash: String(view.viewHash),
  };
}

function installExperienceOverride(
  client: ReturnType<typeof createOperateClient>,
  view: JsonRecord,
): void {
  Object.defineProperty(client, 'experience', {
    configurable: true,
    value: async () => ({
      ok: true,
      operation: 'operate.experience.get',
      data: structuredClone(view),
      allowedActions: [],
    }),
  });
}

describe('durable OpenPlanr Operate consumer', () => {
  it('refuses Cycle start without an explicit human Decision owner before storage', async () => {
    const fixture = await createTestProject('operate-owner-required');
    projects.push(fixture);
    const refused = await createOperateClient(fixture.dir).dispatch({
      operation: 'operate.cycle.start',
      request: {
        scope: { scopeId: 'scope-owner-required', domainId: 'business', domainVersion: '1.0.0' },
        focus: ['owner custody'],
        trigger: { kind: 'manual' },
        mode: 'standard',
      },
    } as OperateDispatchRequestV2);
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'RESULT_CONTRACT_INVALID' },
    });
    await expect(
      readFile(resolve(fixture.dir, '.planr', 'operate', 'state', 'CURRENT')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses every non-canonical Cycle start field before storage', async () => {
    const fixture = await createTestProject('operate-start-contract');
    projects.push(fixture);
    const valid = {
      scope: { scopeId: 'scope-start-contract', domainId: 'business', domainVersion: '1.0.0' },
      focus: ['start contract'],
      trigger: { kind: 'manual' },
      mode: 'standard',
      ownerActorId: 'owner-start-contract',
      deliveryRoute: 'observe-only',
    };
    const hostile = [
      { ...valid, ownerActorId: '<required>' },
      { ...valid, trigger: { kind: 'automatic' } },
      { ...valid, mode: 'ship' },
      { ...valid, deliveryRoute: 'production-deploy' },
      { ...valid, privateField: 'must-not-enter-storage' },
    ];
    const client = createOperateClient(fixture.dir);
    for (const request of hostile) {
      expect(
        await client.dispatch({
          operation: 'operate.cycle.start',
          request,
        } as unknown as OperateDispatchRequestV2),
      ).toMatchObject({ ok: false, error: { code: 'RESULT_CONTRACT_INVALID' } });
    }
    await expect(
      readFile(resolve(fixture.dir, '.planr', 'operate', 'state', 'CURRENT')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects overlong Cycle and Action identities before any runtime read', async () => {
    const fixture = await createTestProject('operate-read-id-boundary');
    projects.push(fixture);
    const client = createOperateClient(fixture.dir);
    let reads = 0;
    Object.defineProperty(client, 'experience', {
      configurable: true,
      value: async () => {
        reads += 1;
        throw new Error('runtime-read-must-not-occur');
      },
    });
    const actor = {
      actorId: 'owner-read-id-boundary',
      kind: 'human' as const,
      runtime: 'openplanr',
    };
    for (const result of [
      await client.readCycleWorkspace('c'.repeat(129), actor),
      await client.readActionWorkspace('a'.repeat(129), 'cycle-read-boundary', actor),
      await client.readActionWorkspace('action-read-boundary', 'c'.repeat(129), actor),
    ]) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'RESULT_CONTRACT_INVALID' },
      });
    }
    expect(reads).toBe(0);
  });

  it('rejects malformed audit selections before durable runtime or owner access', async () => {
    const fixture = await createTestProject('operate-audit-invalid');
    projects.push(fixture);
    const client = createOperateClient(fixture.dir);
    let reads = 0;
    Object.defineProperty(client, 'experience', {
      configurable: true,
      value: async () => {
        reads += 1;
        throw new Error('private-runtime-read-must-not-occur');
      },
    });
    const valid = {
      cycleId: 'cycle-audit-invalid',
      actor: { actorId: 'owner-audit-invalid', kind: 'human' as const },
      surface: 'history' as const,
    };
    const hostile: unknown[] = [
      { ...valid, actor: { ...valid.actor, actorId: '' } },
      { ...valid, actor: { ...valid.actor, actorId: 'a'.repeat(129) } },
      { ...valid, actor: { ...valid.actor, kind: 'foreign' } },
      { ...valid, actor: { ...valid.actor, runtime: 7 } },
      { ...valid, cycleId: 'c'.repeat(129) },
      { ...valid, subjectId: 7 },
      { ...valid, surface: 'outcome', subjectId: 's'.repeat(129) },
      { ...valid, query: 'private-query-must-not-cross' },
      { ...valid, surface: 'search', query: 7 },
      { ...valid, surface: 'search', query: 'x'.repeat(513) },
      { ...valid, surface: 'export', format: 'yaml' },
      { ...valid, surface: 'outcome' },
      { ...valid, privateField: 'private-request-member-must-not-echo' },
    ];
    for (const request of hostile) {
      const result = await client.readAuditDisplay(request as OperateAuditDisplayRequestV1);
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'RESULT_CONTRACT_INVALID' },
      });
      expect(JSON.stringify(result)).not.toContain('private-');
      expect(reads).toBe(0);
    }
  });

  it('reads all six exact owner-signed audit displays with privacy and restart custody', async () => {
    const fixture = await createTestProject('operate-audit-client');
    projects.push(fixture);
    const actor = { actorId: 'owner-audit-client', kind: 'human' as const };
    const client = createOperateClient(fixture.dir);
    const started = await client.dispatch({
      operation: 'operate.cycle.start',
      request: {
        scope: {
          scopeId: 'scope-audit-client',
          domainId: 'business',
          domainVersion: '1.0.0',
        },
        focus: ['audit client'],
        trigger: { kind: 'manual' },
        mode: 'standard',
        ownerActorId: actor.actorId,
      },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const cycleId = String((started.data as { cycle: { cycleId: string } }).cycle.cycleId);
    const experience = await client.dispatch({
      operation: 'operate.experience.get',
      request: { cycleId, actor },
    });
    if (!experience.ok) throw new Error(JSON.stringify(experience));
    const durableView = experience.data as JsonRecord;

    const durableRequest = { cycleId, actor, surface: 'history' as const };
    const firstDurable = assertOperateExperienceAuditDisplaySurfaceV1(
      await client.readAuditDisplay(durableRequest),
      auditBinding(durableView, durableRequest),
    );
    const restarted = createOperateClient(fixture.dir);
    const restartedDurable = assertOperateExperienceAuditDisplaySurfaceV1(
      await restarted.readAuditDisplay(durableRequest),
      auditBinding(durableView, durableRequest),
    );
    expect(restartedDurable).toEqual(firstDurable);

    const view = withAuditOutcome(durableView);
    installExperienceOverride(client, view);
    const selections: readonly OperateAuditDisplayRequestV1[] = [
      { cycleId, actor, surface: 'evidence' },
      { cycleId, actor, surface: 'outcomes' },
      { cycleId, actor, surface: 'outcome', subjectId: AUDIT_OUTCOME_ID },
      { cycleId, actor, surface: 'history' },
      { cycleId, actor, surface: 'search', query: ' audit Ω ' },
      { cycleId, actor, surface: 'export', format: 'json' },
    ];
    const displays = new Map<OperateAuditDisplayRequestV1['surface'], AuditDisplay>();
    for (const request of selections) {
      const expected = auditBinding(view, request);
      const display = assertOperateExperienceAuditDisplaySurfaceV1(
        await client.readAuditDisplay(request),
        expected,
      );
      expect(display.requestBinding).toEqual(expected);
      expect(display.payload).toMatchObject({
        surface: request.surface,
        actorId: view.actorId,
        scopeId: view.scopeId,
        domainId: view.domainId,
        domainVersion: view.domainVersion,
        generatedAt: view.generatedAt,
        eventHead: view.eventHead,
        viewHash: view.viewHash,
        readOnly: true,
        mutationEnabled: false,
      });
      expect(display.integrity).toMatchObject({
        algorithm: 'sha-256-jcs',
        domain: 'openplanr:operate-experience-audit-display-surface:1.0.0',
        sourceViewHash: view.viewHash,
        contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      });
      expect(Object.isFrozen(display)).toBe(true);
      displays.set(request.surface, display);
    }

    const outcomeDisplay = displays.get('outcome');
    expect(outcomeDisplay?.payload).toMatchObject({
      surface: 'outcome',
      data: {
        outcome: {
          outcomeId: AUDIT_OUTCOME_ID,
          status: 'insufficient-evidence',
          metric: { observed: null },
        },
      },
    });
    const searchDisplay = displays.get('search');
    if (searchDisplay?.payload.surface !== 'search') throw new Error('missing Search display');
    expect(JSON.stringify(searchDisplay.payload.data)).not.toContain(PRIVATE_EXPORT_ACTOR);
    const exportDisplay = displays.get('export');
    if (exportDisplay?.payload.surface !== 'export') throw new Error('missing Export display');
    expect(exportDisplay.payload.data.mediaType).toBe('application/json');
    expect(exportDisplay.payload.data.content).not.toContain(PRIVATE_EXPORT_ACTOR);
    expect(exportDisplay.payload.data.content).not.toContain('#/operate/actions/');

    const privateSelection = 'private-query-must-not-echo';
    const refused = await client.readAuditDisplay({
      cycleId,
      actor,
      surface: 'history',
      query: privateSelection,
    });
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'RESULT_CONTRACT_INVALID' },
    });
    expect(JSON.stringify(refused)).not.toContain(privateSelection);
  });

  it('starts and resumes the canonical installed-package board with closed executable next actions', async () => {
    const fixture = await createTestProject('operate-client');
    projects.push(fixture);
    const client = createOperateClient(fixture.dir);
    const started = await client.dispatch({
      operation: 'operate.cycle.start',
      request: {
        scope: { scopeId: 'scope-test', domainId: 'software', domainVersion: '1.0.0' },
        focus: ['runtime'],
        trigger: { kind: 'manual' },
        mode: 'standard',
        ownerActorId: 'owner-test',
      },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const data = started.data as {
      cycle: { cycleId: string };
      availableAssignments: Array<{ roleId: string }>;
    };
    expect(data.availableAssignments.map(({ roleId }) => roleId)).toEqual(['advisor']);
    expect(JSON.stringify(started.allowedActions)).not.toContain('<required>');
    for (const action of started.allowedActions as OperateAllowedActionV2[]) {
      expect(await dispatchAllowedAction(client, action)).toMatchObject({
        ok: true,
        operation: action.tool,
      });
    }
    const experience = {
      cycleId: data.cycle.cycleId,
      actor: { actorId: 'owner-test', kind: 'human' as const, runtime: 'openplanr' },
      actionBinding: { cycleId: data.cycle.cycleId, actorId: 'owner-test' },
    };
    expect(
      await client.dispatch({ operation: 'operate.experience.get', request: experience }),
    ).toMatchObject({ ok: true, operation: 'operate.experience.get' });
    const privateActor = 'private-actor-must-not-leak';
    const substituted = structuredClone(experience);
    substituted.actor.actorId = privateActor;
    const rejectedSubstitution = await client.dispatch({
      operation: 'operate.experience.get',
      request: substituted,
    });
    expect(rejectedSubstitution).toMatchObject({
      ok: false,
      error: { code: 'CAPABILITY_DENIED' },
    });
    expect(JSON.stringify(rejectedSubstitution)).not.toContain(privateActor);
    expect(JSON.stringify(rejectedSubstitution)).not.toContain('owner-test');
    const fullySubstituted = structuredClone(experience);
    fullySubstituted.actor.actorId = privateActor;
    fullySubstituted.actionBinding.actorId = privateActor;
    const rejectedMembership = await client.dispatch({
      operation: 'operate.experience.get',
      request: fullySubstituted,
    });
    expect(rejectedMembership).toMatchObject({
      ok: false,
      error: { code: 'CAPABILITY_DENIED' },
    });
    expect(JSON.stringify(rejectedMembership)).not.toContain(privateActor);
    expect(JSON.stringify(rejectedMembership)).not.toContain('owner-test');

    const resumed = await createOperateClient(fixture.dir).dispatch({
      operation: 'operate.cycle.resume',
      request: { cycleId: data.cycle.cycleId },
    });
    expect(resumed).toMatchObject({
      ok: true,
      data: { cycle: { cycleId: data.cycle.cycleId } },
    });
    if (!resumed.ok) throw new Error(JSON.stringify(resumed));
    expect(resumed.allowedActions).toEqual([
      expect.objectContaining({
        tool: 'operate.cycle.get',
        arguments: { cycleId: data.cycle.cycleId },
      }),
    ]);
    for (const action of resumed.allowedActions as OperateAllowedActionV2[]) {
      expect(await dispatchAllowedAction(client, action)).toMatchObject({
        ok: true,
        operation: action.tool,
      });
    }
    expect(
      JSON.parse(
        await readFile(resolve(fixture.dir, '.planr', 'operate', 'state', 'CUSTODY.json'), 'utf8'),
      ),
    ).toMatchObject({ custodyVersion: 2, journalSequence: 1 });
  });

  it('binds Artifact reads to explicit owner membership or the exact issued Assignment claimant', async () => {
    const fixture = await createTestProject('operate-access');
    projects.push(fixture);
    const client = createOperateClient(fixture.dir);
    const started = await client.dispatch({
      operation: 'operate.cycle.start',
      request: {
        scope: { scopeId: 'scope-access', domainId: 'business', domainVersion: '1.0.0' },
        focus: ['access'],
        trigger: { kind: 'manual' },
        mode: 'standard',
        ownerActorId: 'owner-access',
      },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const data = started.data as {
      cycle: { cycleId: string; scopeId: string; domainId: string; domainVersion: string };
      acceptedArtifactIds: string[];
      availableAssignments: Array<{ assignmentId: string; inputArtifactIds: string[] }>;
    };
    const scope = {
      scopeId: data.cycle.scopeId,
      domainId: data.cycle.domainId,
      domainVersion: data.cycle.domainVersion,
    };
    let artifactId = '';
    for (const candidateId of data.acceptedArtifactIds) {
      const candidate = await client.dispatch({
        operation: 'operate.artifact.get',
        request: {
          artifactId: candidateId,
          representation: 'metadata',
          actor: { actorId: 'owner-access', kind: 'human', runtime: 'openplanr' },
          scope,
          assignmentId: null,
        },
      });
      if (
        candidate.ok &&
        (candidate.data as { metadata?: { mediaType?: string } }).metadata?.mediaType ===
          'application/json'
      ) {
        artifactId = candidateId;
        break;
      }
    }
    expect(artifactId).not.toBe('');
    const unknownMetadata = await client.dispatch({
      operation: 'operate.artifact.get',
      request: {
        artifactId,
        representation: 'metadata',
        actor: { actorId: 'unknown', kind: 'human', runtime: 'openplanr' },
        scope,
        assignmentId: null,
      },
    });
    expect(unknownMetadata).toMatchObject({ ok: false, error: { code: 'CAPABILITY_DENIED' } });
    expect(
      await client.dispatch({
        operation: 'operate.artifact.get',
        request: {
          artifactId,
          representation: 'metadata',
          actor: { actorId: 'owner-access', kind: 'human', runtime: 'openplanr' },
          scope,
          assignmentId: null,
        },
      }),
    ).toMatchObject({ ok: true, data: { representation: 'metadata' } });
    expect(
      await client.dispatch({
        operation: 'operate.artifact.get',
        request: {
          artifactId,
          representation: 'raw',
          actor: { actorId: 'owner-access', kind: 'human', runtime: 'openplanr' },
          scope,
          assignmentId: null,
        },
      }),
    ).toMatchObject({ ok: true, data: { representation: 'raw' } });
    expect(
      await client.dispatch({
        operation: 'operate.artifact.get',
        request: {
          artifactId,
          representation: 'canonical',
          actor: { actorId: 'owner-access', kind: 'human', runtime: 'openplanr' },
          scope,
          assignmentId: null,
        },
      }),
    ).toMatchObject({ ok: true, data: { representation: 'canonical' } });
    expect(
      await client.dispatch({
        operation: 'operate.artifact.get',
        request: {
          artifactId,
          representation: 'decoded-json',
          actor: { actorId: 'owner-access', kind: 'human', runtime: 'openplanr' },
          scope,
          assignmentId: null,
        },
      }),
    ).toMatchObject({ ok: true, data: { representation: 'decoded-json', contentJson: {} } });

    const assignment = data.availableAssignments[0];
    const actor = { actorId: 'agent-access', kind: 'agent' as const, runtime: 'codex' };
    const claimed = await client.dispatch({
      operation: 'operate.assignment.claim',
      request: { assignmentId: assignment.assignmentId, actor },
    });
    if (!claimed.ok) throw new Error(JSON.stringify(claimed));
    const exactClaim: OperatingAssignmentClaimV2 = claimed.data;
    expect(Object.keys(exactClaim).sort()).toEqual(['assignment', 'capabilities', 'submissionId']);
    const replayedClaim = await createOperateClient(fixture.dir).dispatch({
      operation: 'operate.assignment.claim',
      request: { assignmentId: assignment.assignmentId, actor },
    });
    expect(replayedClaim).toEqual(claimed);
    expect(
      await client.dispatch({
        operation: 'operate.assignment.claim',
        request: {
          assignmentId: assignment.assignmentId,
          actor: { actorId: 'foreign-agent', kind: 'agent', runtime: 'codex' },
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ASSIGNMENT_ALREADY_CLAIMED' },
    });
    const issuedArtifactId = exactClaim.assignment.inputArtifactIds[0];
    expect(
      await client.dispatch({
        operation: 'operate.artifact.get',
        request: {
          artifactId: issuedArtifactId,
          representation: 'raw',
          actor,
          scope,
          assignmentId: assignment.assignmentId,
        },
      }),
    ).toMatchObject({ ok: true, data: { representation: 'raw' } });
    expect(
      await client.dispatch({
        operation: 'operate.artifact.get',
        request: {
          artifactId: issuedArtifactId,
          representation: 'raw',
          actor: { actorId: 'foreign-agent', kind: 'agent', runtime: 'codex' },
          scope,
          assignmentId: assignment.assignmentId,
        },
      }),
    ).toMatchObject({ ok: false, error: { code: 'CAPABILITY_DENIED' } });
  });

  it('reads the owner-signed executive board display and refuses foreign binding custody', async () => {
    const fixture = await createTestProject('operate-executive-board-client');
    projects.push(fixture);
    const actor = { actorId: 'owner-board-client', kind: 'human' as const };
    const client = createOperateClient(fixture.dir);
    const started = await client.dispatch({
      operation: 'operate.cycle.start',
      request: {
        scope: {
          scopeId: 'scope-board-client',
          domainId: 'business',
          domainVersion: '1.0.0',
        },
        focus: ['board client'],
        trigger: { kind: 'manual' },
        mode: 'standard',
        ownerActorId: actor.actorId,
      },
    });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const cycleId = String((started.data as { cycle: { cycleId: string } }).cycle.cycleId);
    const experience = await client.dispatch({
      operation: 'operate.experience.get',
      request: { cycleId, actor },
    });
    if (!experience.ok) throw new Error(JSON.stringify(experience));
    const durableView = experience.data as JsonRecord;
    const view = withExecutiveBoard(durableView, cycleId);
    installExperienceOverride(client, view);
    const binding = executiveBoardBinding(view, cycleId);
    const display = assertOperateExecutiveBoardDisplaySurfaceV1(
      await client.readExecutiveBoardDisplay(cycleId, actor),
      binding,
    );
    expect(display.payload.data.executiveBoard.seats[0]).toMatchObject({
      roleId: 'strategy-finance',
      label: 'CEO',
    });
    const hostile = structuredClone(display);
    hostile.payload.data.executiveBoard.seats[0].label = 'strategy-finance';
    expect(() => assertOperateExecutiveBoardDisplaySurfaceV1(hostile, binding)).toThrow();
  });

  it('rejects invalid Cycle identifiers through the executive board composition boundary', async () => {
    const fixture = await createTestProject('operate-executive-board-invalid');
    projects.push(fixture);
    await expect(
      createOperateClient(fixture.dir).readExecutiveBoardDisplay('../foreign', {
        actorId: 'owner-board-invalid',
        kind: 'human',
        runtime: 'openplanr',
      }),
    ).resolves.toMatchObject({
      ok: false,
      operation: 'operate.cycle.get',
      error: { code: 'RESULT_CONTRACT_INVALID' },
    });
  });
});
