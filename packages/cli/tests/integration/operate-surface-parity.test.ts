import { sha256Jcs } from 'planr-pipeline/protocol';
import {
  assertOperateExperienceAuditDisplaySurfaceV1,
  type OperateAuditDisplayBindingV1,
} from 'planr-pipeline/schemas/v1.2.0/operate-experience-audit-display-surface.mjs';
import type { OperateExperienceDisplaySurfaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createOperateTodayDisplayValidator,
  resolveOperateTodayModel,
} from '../../../../apps/dashboard/src/features/operate/today/today-model.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { renderOperateExperienceSurfaceHuman } from '../../src/cli/commands/operate.js';
import {
  createOperateClient,
  type OperateDispatchRequestV2,
} from '../../src/services/operate/client.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

const projects: TestProject[] = [];
const OPERATE_READER_MODULE = 'planr-pipeline/dashboard/operate-experience-reader';

async function ownerReader() {
  return (await import(OPERATE_READER_MODULE)) as {
    buildOperateExperienceTransportView(value: unknown): unknown;
    resolveOperateExperienceSearchDestination(
      view: unknown,
      value: unknown,
    ): { route: string; surface: string; subjectId: string | null } | null;
    selectOperateExperienceDisplaySurface(
      view: unknown,
      options: unknown,
    ): OperateExperienceDisplaySurfaceV1;
  };
}
afterEach(() => {
  for (const project of projects.splice(0)) project.cleanup();
});

type View = Record<string, unknown> & {
  eventHead: unknown;
  viewHash: string;
  attention: unknown[];
  domainMetrics: unknown[];
  cycles: unknown[];
  inbox: unknown[];
  actions: unknown[];
  outcomes: unknown[];
  evidence: unknown[];
  claims: unknown[];
  rationale: unknown[];
  history: unknown[];
  replay: Record<string, unknown>;
  allowedActions: unknown[];
};

type Surface = Record<string, unknown> & {
  kind: 'operate-experience-surface';
  surface: string;
  eventHead: unknown;
  viewHash: string;
  reasonCodes: string[];
  data: Record<string, unknown>;
};

type AuditSurface = 'evidence' | 'outcomes' | 'outcome' | 'history' | 'search' | 'export';

function auditBinding(
  view: View,
  cycleId: string,
  surface: AuditSurface,
  options: { subjectId?: string; query?: string; format?: 'json' | 'html' } = {},
): OperateAuditDisplayBindingV1 {
  return {
    actorId: String(view.actorId),
    scopeId: String(view.scopeId),
    domainId: String(view.domainId),
    domainVersion: String(view.domainVersion),
    cycleId,
    subjectId: options.subjectId ?? null,
    surface,
    query: surface === 'search' ? (options.query ?? '') : null,
    format: surface === 'export' ? (options.format ?? 'json') : null,
    generatedAt: String(view.generatedAt),
    eventHead: view.eventHead as OperateAuditDisplayBindingV1['eventHead'],
    viewHash: view.viewHash,
  };
}

async function journey(domainId: 'business' | 'software') {
  const project = await createTestProject(`operate-surface-${domainId}`);
  projects.push(project);
  const client = createOperateClient(project.dir);
  const actorId = `owner-${domainId}`;
  const started = await client.dispatch({
    operation: 'operate.cycle.start',
    request: {
      scope: { scopeId: `scope-${domainId}`, domainId, domainVersion: '1.0.0' },
      focus: ['surface parity'],
      trigger: { kind: 'manual' },
      mode: 'standard',
      ownerActorId: actorId,
    },
  });
  if (!started.ok) throw new Error(JSON.stringify(started));
  const startData = started.data as {
    cycle: { cycleId: string };
    availableAssignments: Array<{ assignmentId: string }>;
  };
  const cycleId = String(startData.cycle.cycleId);
  const privateHistoryIdentity = 'private-approver-history-identity';
  const claimed = await client.dispatch({
    operation: 'operate.assignment.claim',
    request: {
      assignmentId: startData.availableAssignments[0].assignmentId,
      actor: { actorId: privateHistoryIdentity, kind: 'agent', runtime: 'codex' },
    },
  });
  if (!claimed.ok) throw new Error(JSON.stringify(claimed));
  const experience = async (
    surface?:
      | 'today'
      | 'cycles'
      | 'cycle'
      | 'evidence'
      | 'outcomes'
      | 'outcome'
      | 'history'
      | 'search'
      | 'export',
    extra: { query?: string; format?: 'json' | 'html'; subjectId?: string } = {},
    actor = actorId,
  ) => {
    const result = await client.dispatch({
      operation: 'operate.experience.get',
      request: { cycleId, actor: { actorId: actor, kind: 'human' }, surface, ...extra },
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result.data as View | Surface;
  };
  return { project, client, actorId, cycleId, privateHistoryIdentity, experience };
}

describe('Operate shared browser/CLI/machine/agent projection', () => {
  for (const domainId of ['business', 'software'] as const) {
    it(`keeps ${domainId} surface fields, ordering, reasons, and head identical`, async () => {
      const { project, cycleId, experience } = await journey(domainId);
      const view = (await experience()) as View;
      const today = (await experience('today')) as Surface;
      const cycles = (await experience('cycles')) as Surface;
      const evidence = (await experience('evidence')) as Surface;
      const outcomes = (await experience('outcomes')) as Surface;
      const history = (await experience('history')) as Surface;
      const cycle = (await experience('cycle', { subjectId: cycleId })) as Surface;
      const owner = await ownerReader();
      const todayDisplay = owner.selectOperateExperienceDisplaySurface(view, {
        surface: 'today',
        binding: {
          actorId: today.actorId,
          scopeId: today.scopeId,
          domainId: today.domainId,
          domainVersion: today.domainVersion,
          generatedAt: today.generatedAt,
          eventHead: today.eventHead,
          viewHash: today.viewHash,
          surface: 'today',
        },
      });
      expect(todayDisplay).toMatchObject({
        kind: 'operate-experience-display-surface',
        payload: today,
        integrity: {
          sourceViewHash: view.viewHash,
          contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        },
      });

      for (const surface of [today, cycles, cycle, evidence, outcomes, history]) {
        expect(surface.kind).toBe('operate-experience-surface');
        expect(surface.eventHead).toEqual(view.eventHead);
        expect(surface.viewHash).toBe(view.viewHash);
        expect(surface.reasonCodes).toEqual([]);
        expect(surface.readOnly).toBe(true);
        expect(surface.mutationEnabled).toBe(true);
      }
      expect(today.data).toEqual({
        attention: view.attention,
        domainMetrics: view.domainMetrics,
        activeCycle: view.cycles[0] ?? null,
        inbox: view.inbox,
        actions: view.actions,
        outcomes: view.outcomes,
        allowedActions: view.allowedActions,
      });
      const todayBinding = createDashboardQueryIdentity({
        productArea: 'operate',
        route: '#/operate/today',
        actorId: String(today.actorId),
        projectId: sha256Jcs({ project: project.dir } as never),
        scopeId: String(today.scopeId),
        domainId: String(today.domainId),
        domainVersion: String(today.domainVersion),
        cycleId,
        subjectId: null,
        eventHead: today.eventHead,
        viewHash: today.viewHash,
        generation: 1,
      });
      const todayState = parseDashboardProductState<OperateExperienceDisplaySurfaceV1>(
        {
          kind: todayDisplay.payload.status,
          binding: todayBinding,
          data: JSON.parse(JSON.stringify(todayDisplay)),
          reasonCodes: [],
          error: null,
          mutationEnabled: todayDisplay.payload.mutationEnabled,
          policy: dashboardProductStatePolicy(todayDisplay.payload.status),
        },
        {
          currentBinding: todayBinding,
          validateData: createOperateTodayDisplayValidator(todayBinding),
        },
      );
      const todayPresentation = resolveOperateTodayModel({ current: todayState }, todayBinding);
      expect(todayPresentation).toMatchObject({
        kind: 'surface',
        source: 'current',
        display: todayDisplay,
        surface: { eventHead: view.eventHead },
        activeCycle: { cycleId },
        mutationEnabled: true,
      });
      expect(cycles.data).toEqual({ cycles: view.cycles });
      expect(cycle).toMatchObject({
        surface: 'cycle',
        eventHead: view.eventHead,
        data: {
          cycle: expect.objectContaining({
            cycleId,
            assignments: expect.any(Array),
            dependencies: expect.any(Array),
            blockers: expect.any(Array),
            persistentActionIds: expect.any(Array),
            replayCheckpoint: null,
            deepLink: expect.stringContaining('#/operate/cycles/'),
            stages: expect.arrayContaining([
              expect.objectContaining({
                id: 'observe',
                inputArtifactIds: expect.any(Array),
                outputArtifactIds: expect.any(Array),
                gates: expect.any(Array),
                evidenceGapIds: expect.any(Array),
                uncertaintyIds: expect.any(Array),
                persistentActionIds: expect.any(Array),
              }),
            ]),
          }),
        },
      });
      expect(evidence.data).toEqual({
        evidence: view.evidence,
        claims: view.claims,
        rationale: view.rationale,
      });
      expect(outcomes.data).toEqual({
        domainMetrics: view.domainMetrics,
        outcomes: view.outcomes,
        learnings: view.learnings,
      });
      expect(history.data).toEqual({ history: view.history, replay: view.replay });
      expect(view.history.length).toBeGreaterThan(0);
      expect(view.replay).toMatchObject({
        liveAccessUsed: false,
        finalHead: view.eventHead,
        parityProof: expect.objectContaining({
          sourceStateHash: expect.stringMatching(/^sha256:/),
          eventReplayIndexHash: expect.stringMatching(/^sha256:/),
          checkpointVerified: false,
          finalEventHashMatches: true,
          stateParityVerified: false,
        }),
      });
      expect((view.replay.tail as { eventCount: number }).eventCount).toBeGreaterThanOrEqual(
        view.history.length,
      );
      expect((view.replay.tail as { endSequence: number }).endSequence).toBe(
        (view.eventHead as { sequence: number }).sequence,
      );
      const cycleHuman = renderOperateExperienceSurfaceHuman(
        cycle as Parameters<typeof renderOperateExperienceSurfaceHuman>[0],
      ).join('\n');
      const historyHuman = renderOperateExperienceSurfaceHuman(
        history as Parameters<typeof renderOperateExperienceSurfaceHuman>[0],
      ).join('\n');
      expect(cycleHuman).toContain('observe');
      expect(cycleHuman).toContain('role');
      expect(historyHuman).toContain('Replay proof · unverified');
      expect(cycleId).toBe(String((today.data.activeCycle as { cycleId: string }).cycleId));
    });
  }

  it('keeps private history identities redacted across no-surface agent and CLI projections', async () => {
    const { client, cycleId, privateHistoryIdentity } = await journey('business');
    const actor = { actorId: 'agent-experience-reader', kind: 'agent' as const, runtime: 'codex' };
    const agentResponse = await client.dispatch({
      operation: 'operate.experience.get',
      request: { cycleId, actor },
    });
    const cliResponse = await client.dispatch({
      operation: 'operate.experience.get',
      request: { cycleId, actor, surface: 'history' },
    });
    if (!agentResponse.ok || !cliResponse.ok) {
      throw new Error(JSON.stringify({ agentResponse, cliResponse }));
    }
    const view = agentResponse.data as View;
    const history = cliResponse.data as Surface;
    for (const entry of view.history as Array<{ actorKind: string; actorId: string }>) {
      if (!['engine', 'runtime'].includes(entry.actorKind)) {
        expect(['current-actor', 'restricted-actor']).toContain(entry.actorId);
      }
    }
    expect(history.eventHead).toEqual(view.eventHead);
    expect(history.viewHash).toBe(view.viewHash);
    expect(history.data).toEqual({ history: view.history, replay: view.replay });
    expect(JSON.stringify(view)).not.toContain(privateHistoryIdentity);
    expect(JSON.stringify(cliResponse)).not.toContain(privateHistoryIdentity);
    const { viewHash: _viewHash, ...source } = view;
    const adversarialBase = {
      ...source,
      history: [
        {
          ...(view.history[0] as Record<string, unknown>),
          actorKind: 'human',
          actorId: privateHistoryIdentity,
        },
        ...view.history.slice(1),
      ],
    };
    const owner = await ownerReader();
    const rebound = owner.buildOperateExperienceTransportView({
      ...adversarialBase,
      viewHash: sha256Jcs(adversarialBase as never),
    }) as View;
    expect((rebound.history[0] as { actorId: string }).actorId).toBe('restricted-actor');
    expect(JSON.stringify(rebound)).not.toContain(privateHistoryIdentity);
    const reboundHistory = {
      ...history,
      eventHead: rebound.eventHead,
      viewHash: rebound.viewHash,
      data: { history: rebound.history, replay: rebound.replay },
    };
    expect(JSON.stringify(reboundHistory)).not.toContain(privateHistoryIdentity);
    expect(
      renderOperateExperienceSurfaceHuman(
        reboundHistory as unknown as Parameters<typeof renderOperateExperienceSurfaceHuman>[0],
      ).join('\n'),
    ).not.toContain(privateHistoryIdentity);
  });

  it('keeps restart reads exact and search/export free of unprojected actor data', async () => {
    const { project, client, actorId, cycleId, experience } = await journey('business');
    const view = (await experience()) as View;
    const first = (await experience('today')) as Surface;
    const restarted = await createOperateClient(project.dir).dispatch({
      operation: 'operate.experience.get',
      request: { cycleId, actor: { actorId, kind: 'human' }, surface: 'today' },
    });
    expect(restarted).toMatchObject({ ok: true, data: first });

    const legacyAuditCases = [
      { surface: 'evidence' as const },
      { surface: 'outcomes' as const },
      { surface: 'history' as const },
      { surface: 'search' as const, query: 'surface parity' },
      { surface: 'export' as const, format: 'json' as const },
    ];
    for (const selection of legacyAuditCases) {
      const legacyBefore = (await experience(selection.surface, selection)) as Surface;
      const legacyHumanBefore = renderOperateExperienceSurfaceHuman(
        legacyBefore as Parameters<typeof renderOperateExperienceSurfaceHuman>[0],
      );
      const binding = auditBinding(view, cycleId, selection.surface, selection);
      const audit = assertOperateExperienceAuditDisplaySurfaceV1(
        await client.readAuditDisplay({
          cycleId,
          actor: { actorId, kind: 'human' },
          ...selection,
        }),
        binding,
      );
      expect(audit).toMatchObject({
        kind: 'operate-experience-audit-display-surface',
        requestBinding: binding,
        payload: {
          kind: 'operate-experience-surface',
          surface: selection.surface,
          mutationEnabled: false,
          eventHead: legacyBefore.eventHead,
          viewHash: legacyBefore.viewHash,
        },
      });
      const legacyAfter = (await experience(selection.surface, selection)) as Surface;
      expect(legacyAfter).toEqual(legacyBefore);
      expect(
        renderOperateExperienceSurfaceHuman(
          legacyAfter as Parameters<typeof renderOperateExperienceSurfaceHuman>[0],
        ),
      ).toEqual(legacyHumanBefore);
      expect(legacyAfter).toMatchObject({
        kind: 'operate-experience-surface',
        mutationEnabled: true,
      });
    }

    const durableAuditRequest = {
      cycleId,
      actor: { actorId, kind: 'human' as const },
      surface: 'history' as const,
    };
    const firstAudit = assertOperateExperienceAuditDisplaySurfaceV1(
      await client.readAuditDisplay(durableAuditRequest),
      auditBinding(view, cycleId, 'history'),
    );
    const restartedClient = createOperateClient(project.dir);
    const restartedAudit = assertOperateExperienceAuditDisplaySurfaceV1(
      await restartedClient.readAuditDisplay(durableAuditRequest),
      auditBinding(view, cycleId, 'history'),
    );
    expect(restartedAudit).toEqual(firstAudit);

    const search = (await experience('search', { query: 'surface parity' })) as Surface;
    expect((search.data.results as unknown[]).length).toBeGreaterThan(0);
    expect(JSON.stringify(search.data)).not.toContain('.planr/operate');
    const assignmentId = String(
      ((view.cycles[0] as Record<string, unknown>).assignments as Array<Record<string, unknown>>)[0]
        .assignmentId,
    );
    const assignmentSearch = (await experience('search', { query: assignmentId })) as Surface;
    expect(assignmentSearch.data.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'assignment',
          subjectId: assignmentId,
          deepLink: `#/operate/cycles/${encodeURIComponent(cycleId)}`,
        }),
      ]),
    );
    const historyEventId = String((view.history[0] as Record<string, unknown>).eventId);
    const emitted = (
      await Promise.all(
        ['surface parity', assignmentId, historyEventId].map(
          async (query) =>
            ((await experience('search', { query })) as Surface).data.results as Array<
              Record<string, unknown>
            >,
        ),
      )
    )
      .flat()
      .filter(
        (entry, index, all) =>
          all.findIndex(
            (candidate) => candidate.kind === entry.kind && candidate.subjectId === entry.subjectId,
          ) === index,
      );
    const owner = await ownerReader();
    for (const result of emitted) {
      if (!result.deepLink) {
        expect(['decision', 'metric', 'action', 'event']).toContain(result.kind);
        continue;
      }
      const destination = owner.resolveOperateExperienceSearchDestination(view, result.deepLink);
      expect(destination, String(result.deepLink)).not.toBeNull();
      const target = (await experience(
        destination?.surface as
          | 'today'
          | 'cycles'
          | 'cycle'
          | 'evidence'
          | 'outcomes'
          | 'outcome'
          | 'history',
        destination?.subjectId ? { subjectId: destination.subjectId } : {},
      )) as Surface;
      expect(target.kind).toBe('operate-experience-surface');
      expect(target.viewHash).toBe(view.viewHash);
    }
    for (const fabricated of [
      '#/operate/actions/action-1',
      '#/operate/outcomes/metric-1',
      `#/operate/cycles/${encodeURIComponent(assignmentId)}`,
      `#/operate/history/${encodeURIComponent(historyEventId)}`,
      '#/operate/evidence/private-unknown',
    ])
      expect(owner.resolveOperateExperienceSearchDestination(view, fabricated)).toBeNull();

    const exported = (await experience('export', { format: 'json' })) as Surface;
    const content = String(exported.data.content);
    const exportValue = JSON.parse(content) as Record<string, unknown>;
    expect(exported.data).toMatchObject({ format: 'json', mediaType: 'application/json' });
    expect(exportValue.domainMetrics).toEqual(view.domainMetrics);
    expect(exportValue.claims).toEqual(view.claims);
    expect(exportValue.replay).toEqual(view.replay);
    expect(content).not.toContain(actorId);
    expect(content).not.toContain(project.dir);
    expect(content).not.toContain('contentBase64');
  });

  it('derives public access for an unknown actor and rejects malformed selectors', async () => {
    const { client, cycleId, experience } = await journey('software');
    const publicToday = (await experience('today', {}, 'observer-unknown')) as Surface;
    expect(publicToday.accessLevel).toBe('public');
    expect(JSON.stringify(publicToday)).not.toContain('contentBase64');
    const malformed = await client.dispatch({
      operation: 'operate.experience.get',
      request: {
        cycleId,
        actor: { actorId: 'observer-unknown', kind: 'human' },
        surface: 'private-admin',
      },
    } as unknown as OperateDispatchRequestV2);
    expect(malformed).toMatchObject({
      ok: false,
      error: { code: 'RESULT_CONTRACT_INVALID' },
    });
    expect(
      await client.dispatch({
        operation: 'operate.experience.get',
        request: {
          cycleId,
          actor: { actorId: 'observer-unknown', kind: 'human' },
          surface: 'outcome',
          subjectId: 'outcome-foreign',
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'OPERATE_SUBJECT_NOT_FOUND' },
    });
  });
});
