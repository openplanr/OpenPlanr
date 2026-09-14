import { selectOperateExperienceDisplaySurface } from 'planr-pipeline/dashboard/operate-experience-reader';
import { sha256Jcs } from 'planr-pipeline/protocol';
import type { OperateExperienceDisplaySurfaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createOperateTodayDisplayValidator,
  resolveOperateTodayModel,
} from '../../../../apps/dashboard/src/features/operate/today/today-model.js';
import {
  type DashboardProductState,
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
} from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { createOperateClient } from '../../src/services/operate/client.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

type Display = Readonly<OperateExperienceDisplaySurfaceV1>;
type Client = ReturnType<typeof createOperateClient>;
type Fixture = Readonly<{
  project: TestProject;
  actorId: string;
  cycleId: string;
  publicText: string;
  display: Display;
  binding: DashboardQueryIdentity;
}>;

const projects: TestProject[] = [];
const OTHER_HASH = `sha256:${'e'.repeat(64)}`;

afterEach(() => {
  for (const project of projects.splice(0)) project.cleanup();
});

async function startCycle(
  project: TestProject,
  domainId: 'business' | 'software',
  actorId: string,
  publicText: string,
): Promise<string> {
  const started = await createOperateClient(project.dir).dispatch({
    operation: 'operate.cycle.start',
    request: {
      scope: { scopeId: `scope-t037-today-${domainId}`, domainId, domainVersion: '1.0.0' },
      focus: [publicText],
      trigger: { kind: 'manual' },
      mode: 'standard',
      ownerActorId: actorId,
      deliveryRoute: 'observe-only',
    },
  });
  if (!started.ok) throw new Error(JSON.stringify(started));
  return String((started.data as { cycle: { cycleId: string } }).cycle.cycleId);
}

async function readTodayDisplay(
  client: Client,
  cycleId: string,
  actorId: string,
): Promise<Display> {
  const result = await client.dispatch({
    operation: 'operate.experience.get',
    request: { cycleId, actor: { actorId, kind: 'human', runtime: 'openplanr' } },
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  const view = result.data as Record<string, unknown>;
  return selectOperateExperienceDisplaySurface(view, {
    surface: 'today',
    binding: {
      actorId: String(view.actorId),
      scopeId: String(view.scopeId),
      domainId: String(view.domainId),
      domainVersion: String(view.domainVersion),
      generatedAt: String(view.generatedAt),
      eventHead: view.eventHead,
      viewHash: String(view.viewHash),
      surface: 'today',
      subjectId: null,
      cycleId,
    } as never,
    cycleId,
  }) as Display;
}

function identity(
  project: TestProject,
  actorId: string,
  cycleId: string,
  display: Display,
  generation = 1,
): DashboardQueryIdentity {
  const payload = display.payload;
  return createDashboardQueryIdentity({
    productArea: 'operate',
    route: '#/operate/today',
    actorId,
    projectId: sha256Jcs({ project: project.dir } as never),
    scopeId: payload.scopeId,
    domainId: payload.domainId,
    domainVersion: payload.domainVersion,
    cycleId,
    subjectId: null,
    eventHead: payload.eventHead,
    viewHash: payload.viewHash,
    generation,
  });
}

function state(binding: DashboardQueryIdentity, display: Display): DashboardProductState<Display> {
  return parseDashboardProductState<Display>(
    {
      kind: display.payload.status,
      binding,
      data: JSON.parse(JSON.stringify(display)),
      reasonCodes:
        display.payload.status === 'ready'
          ? []
          : [`DASHBOARD_${display.payload.status.toUpperCase().replace('-', '_')}`],
      error: null,
      mutationEnabled: display.payload.mutationEnabled,
      policy: dashboardProductStatePolicy(display.payload.status),
    },
    { currentBinding: binding, validateData: createOperateTodayDisplayValidator(binding) },
  );
}

async function fixture(domainId: 'business' | 'software'): Promise<Fixture> {
  const project = await createTestProject(`t037-today-integration-${domainId}`);
  projects.push(project);
  const actorId = `owner-t037-today-${domainId}`;
  const publicText =
    domainId === 'software'
      ? 'C#/.NET API/CLI https://[2001:db8::21]/today?q=$HOME#$(pwd); `echo ~/repo`.'
      : 'Business API/CLI https://[2001:db8::22]/forecast?q=$PWD#~+/cash; C#/.NET notes.';
  const cycleId = await startCycle(project, domainId, actorId, publicText);
  const display = await readTodayDisplay(createOperateClient(project.dir), cycleId, actorId);
  return Object.freeze({
    project,
    actorId,
    cycleId,
    publicText,
    display,
    binding: identity(project, actorId, cycleId, display),
  });
}

function tamper(display: Display, mutate: (draft: Display) => void): Display {
  const draft = structuredClone(display);
  mutate(draft);
  return draft;
}

describe('T-037 Today owner-display integration', () => {
  it.each([
    ['business', 'Business Today', 'Business signals'],
    ['software', 'Repository Today', 'Repository signals'],
  ] as const)(
    'consumes the %s owner display with exact order, arbitrary public text, and restart parity',
    async (domainId, title, signals) => {
      const current = await fixture(domainId);
      const parsed = state(current.binding, current.display);
      const model = resolveOperateTodayModel({ current: parsed }, current.binding);
      expect(model).toMatchObject({
        kind: 'surface',
        source: 'current',
        vocabulary: { title, signals },
        activeCycle: { cycleId: current.cycleId },
        binding: {
          actorId: current.actorId,
          eventHead: current.display.payload.eventHead,
          viewHash: current.display.payload.viewHash,
        },
      });
      if (model?.kind !== 'surface' || current.display.payload.surface !== 'today') {
        throw new Error('Expected a verified Today surface model.');
      }
      expect(model.attention).toEqual(current.display.payload.data.attention);
      expect(model.allowedActions).toEqual(current.display.payload.data.allowedActions);
      expect(model.priorityAttention).toBe(model.attention[0] ?? null);
      expect(model.continuation).toBe(model.allowedActions[0] ?? null);
      expect(model.activeCycle.focus).toContain(current.publicText);
      expect(JSON.stringify(model)).toContain('https://[2001:db8::');

      const restartedDisplay = await readTodayDisplay(
        createOperateClient(current.project.dir),
        current.cycleId,
        current.actorId,
      );
      expect(restartedDisplay).toEqual(current.display);
      const restartedBinding = identity(
        current.project,
        current.actorId,
        current.cycleId,
        restartedDisplay,
      );
      expect(
        resolveOperateTodayModel(
          { current: state(restartedBinding, restartedDisplay) },
          restartedBinding,
        ),
      ).toEqual(model);
    },
  );

  it.each([
    [
      'content',
      (display: Display) => {
        if (display.payload.surface !== 'today' || !display.payload.data.activeCycle) {
          throw new Error('Expected an active Today display.');
        }
        Reflect.set(display.payload.data.activeCycle, 'focus', ['UNCOMMITTED_TAMPER']);
      },
    ],
    ['digest', (display: Display) => Reflect.set(display.integrity, 'contentHash', OTHER_HASH)],
    ['binding', (display: Display) => Reflect.set(display.payload, 'actorId', 'foreign-owner')],
    [
      'order',
      (display: Display) => {
        if (display.payload.surface !== 'today' || !display.payload.data.activeCycle) {
          throw new Error('Expected an active Today display.');
        }
        const stages = display.payload.data.activeCycle.stages;
        [stages[0], stages[1]] = [stages[1], stages[0]];
      },
    ],
  ] as const)('refuses %s tampering before product state or model', async (_case, mutate) => {
    const current = await fixture('software');
    expect(() => state(current.binding, tamper(current.display, mutate))).toThrow(
      /owner-boundary contract/u,
    );
  });

  it('requires parser branding and exact current identity, including durable resume', async () => {
    const current = await fixture('software');
    const parsed = state(current.binding, current.display);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.data)).toBe(true);
    expect(Object.isFrozen(parsed.data?.payload)).toBe(true);
    expect(resolveOperateTodayModel({ current: { ...parsed } }, current.binding)).toBeNull();

    const foreign = createDashboardQueryIdentity({
      ...current.binding,
      generation: current.binding.generation + 1,
    });
    expect(resolveOperateTodayModel({ current: parsed }, foreign)).toBeNull();

    const firstUse = parseDashboardProductState(
      {
        kind: 'first-use',
        binding: current.binding,
        data: null,
        reasonCodes: ['DASHBOARD_FIRST_USE'],
        error: null,
        mutationEnabled: false,
        policy: dashboardProductStatePolicy('first-use'),
      },
      { currentBinding: current.binding },
    );
    expect(
      resolveOperateTodayModel({ current: firstUse, resumable: parsed }, current.binding),
    ).toMatchObject({ kind: 'surface', source: 'durable-resume' });
  });

  it('accepts a separately committed public display without inferring authority from access level', async () => {
    const owner = await fixture('business');
    const actorId = 'observer-t037-today';
    const display = await readTodayDisplay(
      createOperateClient(owner.project.dir),
      owner.cycleId,
      actorId,
    );
    const binding = identity(owner.project, actorId, owner.cycleId, display);
    const model = resolveOperateTodayModel({ current: state(binding, display) }, binding);
    expect(display.payload.accessLevel).toBe('public');
    expect(model).toMatchObject({
      kind: 'surface',
      mutationEnabled: display.payload.mutationEnabled,
    });
    expect(JSON.stringify(model)).not.toContain('contentBase64');
    expect(JSON.stringify(model)).not.toContain(owner.project.dir);
  });
});
