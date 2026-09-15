// @vitest-environment node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import { selectOperateExperienceDisplaySurface } from 'planr-pipeline/dashboard/operate-experience-reader';
import { sha256Jcs } from 'planr-pipeline/protocol';
import type { OperateExperienceDisplaySurfaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import { DecisionFocus } from '../../../../apps/dashboard/src/features/operate/today/DecisionFocus.js';
import { TodayPage } from '../../../../apps/dashboard/src/features/operate/today/TodayPage.js';
import {
  createOperateTodayDisplayValidator,
  resolveOperateTodayModel,
} from '../../../../apps/dashboard/src/features/operate/today/today-model.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';
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

type TodayDisplay = Readonly<OperateExperienceDisplaySurfaceV1>;

type TodayFixture = Readonly<{
  project: TestProject;
  actorId: string;
  cycleId: string;
  display: TodayDisplay;
  binding: DashboardQueryIdentity;
  publicText: string;
}>;

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const TODAY_SOURCE = [
  '../../../../apps/dashboard/src/features/operate/today/TodayPage.tsx',
  '../../../../apps/dashboard/src/features/operate/today/today-model.ts',
]
  .map((file) => readFileSync(resolve(TEST_ROOT, file), 'utf8'))
  .join('\n');
const TAMPER = 'UNVERIFIED_TODAY_TAMPER_MUST_NOT_RENDER';
const OTHER_HASH = `sha256:${'e'.repeat(64)}`;

let fixture: TodayFixture;

function productState(
  binding: DashboardQueryIdentity,
  display: TodayDisplay,
): DashboardProductState<TodayDisplay> {
  return parseDashboardProductState<TodayDisplay>(
    {
      kind: 'ready',
      binding,
      data: JSON.parse(JSON.stringify(display)),
      reasonCodes: [],
      error: null,
      mutationEnabled: display.payload.mutationEnabled,
      policy: dashboardProductStatePolicy('ready'),
    },
    {
      currentBinding: binding,
      validateData: createOperateTodayDisplayValidator(binding),
    },
  );
}

function contextState(
  kind: 'first-use' | 'empty',
  binding: DashboardQueryIdentity,
): DashboardProductState<unknown> {
  return parseDashboardProductState(
    {
      kind,
      binding,
      data: null,
      reasonCodes: [`DASHBOARD_${kind.toUpperCase().replace('-', '_')}`],
      error: null,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy(kind),
    },
    { currentBinding: binding },
  );
}

async function createFixture(): Promise<TodayFixture> {
  const project = await createTestProject('t037-today-ui');
  const actorId = 'owner-t037-today';
  const publicText =
    'C#/.NET API/CLI at https://[2001:db8::7]/today?q=$HOME#$(pwd); document `echo ~/repo`.';
  const client = createOperateClient(project.dir);
  const started = await client.dispatch({
    operation: 'operate.cycle.start',
    request: {
      scope: { scopeId: 'scope-t037-today', domainId: 'software', domainVersion: '1.0.0' },
      focus: [publicText],
      trigger: { kind: 'manual' },
      mode: 'standard',
      ownerActorId: actorId,
      deliveryRoute: 'observe-only',
    },
  });
  if (!started.ok) throw new Error(JSON.stringify(started));
  const cycleId = String((started.data as { cycle: { cycleId: string } }).cycle.cycleId);
  const actor = { actorId, kind: 'human' as const, runtime: 'openplanr' };
  const experience = await client.dispatch({
    operation: 'operate.experience.get',
    request: { cycleId, actor },
  });
  if (!experience.ok) throw new Error(JSON.stringify(experience));
  const view = experience.data as Record<string, unknown>;
  const display = selectOperateExperienceDisplaySurface(view, {
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
  }) as TodayDisplay;
  const payload = display.payload;
  const binding = createDashboardQueryIdentity({
    productArea: 'operate',
    route: '#/operate/today',
    actorId,
    projectId: sha256Jcs({ project: 't037-today-ui' } as never),
    scopeId: payload.scopeId,
    domainId: payload.domainId,
    domainVersion: payload.domainVersion,
    cycleId,
    subjectId: null,
    eventHead: payload.eventHead,
    viewHash: payload.viewHash,
    generation: 17,
  });
  if (!createOperateTodayDisplayValidator(binding)(display)) {
    project.cleanup();
    throw new Error('The installed owner did not issue a valid Today display contract.');
  }
  return Object.freeze({ project, actorId, cycleId, display, binding, publicText });
}

function mutated(change: (display: TodayDisplay) => void): TodayDisplay {
  const display = structuredClone(fixture.display);
  change(display);
  return display;
}

beforeAll(async () => {
  fixture = await createFixture();
});

afterAll(() => fixture?.project.cleanup());

describe('T-037 verified Today display consumption', () => {
  it('renders exact owner priority, continuation, stage, and arbitrary public text', () => {
    const state = productState(fixture.binding, fixture.display);
    const model = resolveOperateTodayModel({ current: state }, fixture.binding);
    expect(model?.kind).toBe('surface');
    if (model?.kind !== 'surface') throw new Error('Expected verified Today model.');
    expect(model.priorityAttention).toBe(model.attention[0] ?? null);
    expect(model.continuation).toBe(model.allowedActions[0] ?? null);
    expect(model.currentStage).toBe(
      model.activeCycle.stages.find((stage) => stage.state === 'current') ?? null,
    );

    const onContinuation = vi.fn();
    const html = renderToStaticMarkup(
      <TodayPage
        currentBinding={fixture.binding}
        sources={{ current: state }}
        onContinuation={onContinuation}
      />,
    );
    expect(html).toContain(fixture.publicText);
    expect(html).toContain('C#/.NET');
    expect(html).toContain('API/CLI');
    expect(html).toContain('https://[2001:db8::7]');
    const linkedHtml = renderToStaticMarkup(
      <DecisionFocus
        model={{
          ...model,
          continuationRelationship: {
            kind: 'different-subject',
            attentionSubjectId: 'decision_committed-link',
            continuationSubjectId: 'action_committed-link',
          },
        }}
      />,
    );
    expect(linkedHtml).toContain(`href="${model.activeCycle.deepLink}"`);
    expect(html).toContain('Today decision workspace');
    expect(html).not.toContain('Today cannot be trusted');
  });

  it.each([
    [
      'content byte',
      (display: TodayDisplay) => {
        if (display.payload.surface !== 'today' || !display.payload.data.activeCycle) {
          throw new Error('Expected active Today display.');
        }
        Reflect.set(display.payload.data.activeCycle, 'focus', [TAMPER]);
      },
    ],
    [
      'digest',
      (display: TodayDisplay) => Reflect.set(display.integrity, 'contentHash', OTHER_HASH),
    ],
    [
      'binding',
      (display: TodayDisplay) => Reflect.set(display.payload, 'actorId', 'foreign-owner'),
    ],
    [
      'stage order',
      (display: TodayDisplay) => {
        if (display.payload.surface !== 'today' || !display.payload.data.activeCycle) {
          throw new Error('Expected active Today display.');
        }
        const stages = display.payload.data.activeCycle.stages;
        [stages[0], stages[1]] = [stages[1], stages[0]];
      },
    ],
    [
      'lifecycle',
      (display: TodayDisplay) => {
        if (display.payload.surface !== 'today' || !display.payload.data.activeCycle) {
          throw new Error('Expected active Today display.');
        }
        Reflect.set(display.payload.data.activeCycle.stages[0], 'state', 'current');
      },
    ],
    [
      'full-view anchor',
      (display: TodayDisplay) => Reflect.set(display.integrity, 'sourceViewHash', OTHER_HASH),
    ],
    [
      'Cycle link',
      (display: TodayDisplay) => {
        if (display.payload.surface !== 'today' || !display.payload.data.activeCycle) {
          throw new Error('Expected active Today display.');
        }
        Reflect.set(display.payload.data.activeCycle, 'deepLink', '#/operate/cycles/cyc_00000099');
      },
    ],
  ] as const)('rejects a schema-shaped %s mutation before product state', (_case, change) => {
    expect(() => productState(fixture.binding, mutated(change))).toThrow(
      /owner-boundary contract/u,
    );
  });

  it('refuses an unbranded or post-parse-substituted display before Today DOM truth', () => {
    const trusted = productState(fixture.binding, fixture.display);
    const tampered = mutated((display) => {
      if (display.payload.surface !== 'today' || !display.payload.data.activeCycle) {
        throw new Error('Expected active Today display.');
      }
      Reflect.set(display.payload.data.activeCycle, 'focus', [TAMPER]);
    });
    const unbranded = Object.freeze({ ...trusted, data: tampered });
    const html = renderToStaticMarkup(
      <TodayPage currentBinding={fixture.binding} sources={{ current: unbranded }} />,
    );
    expect(html).toContain('Today cannot be trusted');
    expect(html).not.toContain('<header');
    expect(html).not.toContain('Today decision workspace');
    expect(html).not.toContain('Operating spine');
    expect(html).not.toContain(TAMPER);
  });

  it('prefers a verified durable resume over first-use and empty presentations', () => {
    const resumable = productState(fixture.binding, fixture.display);
    for (const kind of ['first-use', 'empty'] as const) {
      const current = contextState(kind, fixture.binding);
      const model = resolveOperateTodayModel({ current, resumable }, fixture.binding);
      expect(model).toMatchObject({ kind: 'surface', source: 'durable-resume' });
      const html = renderToStaticMarkup(
        <TodayPage currentBinding={fixture.binding} sources={{ current, resumable }} />,
      );
      expect(html).toContain('Your active work has been restored.');
      expect(html).not.toContain('No operating cycle yet');
      expect(html).not.toContain('No active work yet');
    }
  });

  it('renders honest first-use only for a no-Cycle exact binding and invents no continuation', () => {
    const noCycle = createDashboardQueryIdentity({
      ...fixture.binding,
      cycleId: null,
    });
    const current = contextState('first-use', noCycle);
    const html = renderToStaticMarkup(<TodayPage currentBinding={noCycle} sources={{ current }} />);
    expect(html).toContain('No active work yet');
    expect(html).toContain('No next step is available until work is returned');
    expect(html).not.toContain(fixture.cycleId);
  });

  it('rejects foreign actor, generation, head, and view binding before model/DOM', () => {
    const state = productState(fixture.binding, fixture.display);
    const foreignBindings = [
      createDashboardQueryIdentity({ ...fixture.binding, actorId: 'foreign-owner' }),
      createDashboardQueryIdentity({
        ...fixture.binding,
        generation: fixture.binding.generation + 1,
      }),
      createDashboardQueryIdentity({ ...fixture.binding, eventHead: { sequence: 0, hash: null } }),
      createDashboardQueryIdentity({ ...fixture.binding, viewHash: OTHER_HASH }),
    ];
    for (const binding of foreignBindings) {
      expect(resolveOperateTodayModel({ current: state }, binding)).toBeNull();
      const html = renderToStaticMarkup(
        <TodayPage currentBinding={binding} sources={{ current: state }} />,
      );
      expect(html).toContain('Today cannot be trusted');
      expect(html).not.toContain(fixture.publicText);
    }
  });

  it('contains no browser lexical privacy or local lifecycle authority', () => {
    expect(TODAY_SOURCE).not.toMatch(
      /isAccessSafe|normalizeBrowser|containsPrivate|file:|SENSITIVE_RELATIVE|ACTIVE_CYCLE_STAGE|validCycleLifecycle/u,
    );
    expect(TODAY_SOURCE).not.toContain('assertOperateExperienceSurfaceV1');
    expect(TODAY_SOURCE).toContain('assertOperateExperienceDisplaySurfaceV1');
  });

  it('reaches the verified TodayPage through the preserved UnifiedShell branch', () => {
    const state = productState(fixture.binding, fixture.display);
    const html = renderToStaticMarkup(
      <DashboardProviders
        connection={{ state: 'connected', label: 'Connected', reason: 'Verified test connection.' }}
        buildId="t037-today-test"
        initialHash="#/operate/today"
        binding={fixture.binding}
        projection={state}
      >
        <UnifiedShell />
      </DashboardProviders>,
    );
    expect(html).toContain('Today decision workspace');
    expect(html).toContain(fixture.publicText);
    expect(html).not.toContain('Unified boot and first use');
  });

  it('is semantic and axe-clean after verified display acceptance', async () => {
    const html = renderToStaticMarkup(
      <TodayPage
        currentBinding={fixture.binding}
        sources={{ current: productState(fixture.binding, fixture.display) }}
      />,
    );
    const dom = new JSDOM(
      `<!doctype html><html lang="en"><head><title>Today</title></head><body>${html}</body></html>`,
    );
    expect(dom.window.document.querySelectorAll('h1')).toHaveLength(1);
    expect(dom.window.document.querySelector('main')).toBeNull();
    const main = dom.window.document.createElement('main');
    main.append(...dom.window.document.body.childNodes);
    dom.window.document.body.append(main);
    expect(
      (
        await axe.run(dom.window.document.documentElement, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
    dom.window.close();
  });
});
