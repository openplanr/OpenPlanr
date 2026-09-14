// @vitest-environment node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import { selectOperateExperienceDisplaySurface } from 'planr-pipeline/dashboard/operate-experience-reader';
import { sha256Jcs } from 'planr-pipeline/protocol';
import type { OperateCycleDisplayWorkspaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-cycle-display-workspace.mjs';
import type { OperateExperienceDisplaySurfaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import { parseDashboardRoute } from '../../../../apps/dashboard/src/app/router.js';
import { CycleDetailPage } from '../../../../apps/dashboard/src/features/operate/cycles/CycleDetailPage.js';
import {
  CyclesPage,
  createOperateCyclesDisplayValidator,
} from '../../../../apps/dashboard/src/features/operate/cycles/CyclesPage.js';
import {
  createOperateCycleDisplayWorkspaceValidator,
  resolveOperateCycleModel,
} from '../../../../apps/dashboard/src/features/operate/cycles/cycle-model.js';
import { OperatingSpine } from '../../../../apps/dashboard/src/features/operate/cycles/OperatingSpine.js';
import { InboxItemDetail } from '../../../../apps/dashboard/src/features/operate/inbox/InboxItemDetail.js';
import type { OperateInboxItem } from '../../../../apps/dashboard/src/features/operate/inbox/inbox-model.js';
import { DecisionFocus } from '../../../../apps/dashboard/src/features/operate/today/DecisionFocus.js';
import { TodayPage } from '../../../../apps/dashboard/src/features/operate/today/TodayPage.js';
import {
  createOperateTodayDisplayValidator,
  resolveOperateTodayModel,
} from '../../../../apps/dashboard/src/features/operate/today/today-model.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';
import {
  type DashboardProductState,
  type DashboardProductStateKind,
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
} from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { createOperateClient } from '../../src/services/operate/client.js';
import {
  createPendingReviewDisplay,
  type ReviewFixtureIdentity,
} from '../helpers/operate-review-dashboard-fixture.js';
import { createTestProject, type TestProject } from '../helpers/test-project.js';

type DisplaySurface = Readonly<OperateExperienceDisplaySurfaceV1>;
type CycleWorkspace = Readonly<OperateCycleDisplayWorkspaceV1>;

type CycleFixture = Readonly<{
  project: TestProject;
  cycleId: string;
  actorId: string;
  workspace: CycleWorkspace;
  cyclesDisplay: DisplaySurface;
  todayDisplay: DisplaySurface;
  detailBinding: DashboardQueryIdentity;
  collectionBinding: DashboardQueryIdentity;
  todayBinding: DashboardQueryIdentity;
  publicText: string;
}>;

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const PRODUCTION_SOURCE = [
  'cycles/OperatingSpine.tsx',
  'cycles/CyclesPage.tsx',
  'cycles/CycleDetailPage.tsx',
  'cycles/cycle-model.ts',
  'today/TodayPage.tsx',
  'today/today-model.ts',
]
  .map((file) =>
    readFileSync(
      resolve(TEST_ROOT, '../../../../apps/dashboard/src/features/operate', file),
      'utf8',
    ),
  )
  .join('\n');
const SPINE_SOURCE = readFileSync(
  resolve(TEST_ROOT, '../../../../apps/dashboard/src/features/operate/cycles/OperatingSpine.tsx'),
  'utf8',
);
const CYCLE_STYLES = readFileSync(
  resolve(TEST_ROOT, '../../../../apps/dashboard/src/features/shell/unified-shell.css'),
  'utf8',
);
const TAMPER_SENTINEL = 'UNVERIFIED_TAMPER_MUST_NOT_RENDER';
const OTHER_HASH = `sha256:${'f'.repeat(64)}`;

let software: CycleFixture;
let business: CycleFixture;

function productState<T>(
  kind: DashboardProductStateKind,
  binding: DashboardQueryIdentity,
  data: T,
  validateData: (value: unknown) => value is T,
  mutationEnabled = false,
): DashboardProductState<T> {
  return parseDashboardProductState<T>(
    {
      kind,
      binding,
      data: JSON.parse(JSON.stringify(data)),
      reasonCodes: kind === 'ready' ? [] : [`DASHBOARD_${kind.toUpperCase().replace('-', '_')}`],
      error: null,
      mutationEnabled,
      policy: dashboardProductStatePolicy(kind),
    },
    { currentBinding: binding, validateData },
  );
}

function bindingFor(
  fixture: Pick<CycleFixture, 'cycleId' | 'actorId' | 'workspace'>,
  route: '#/operate/today' | '#/operate/cycles' | `#/operate/cycles/${string}`,
  generation = 11,
): DashboardQueryIdentity {
  const detail = route.startsWith('#/operate/cycles/');
  const payload = fixture.workspace.payload;
  return createDashboardQueryIdentity({
    productArea: 'operate',
    route,
    actorId: fixture.actorId,
    projectId: sha256Jcs({ project: `t037-${fixture.cycleId}` } as never),
    scopeId: payload.scopeId,
    domainId: payload.domainId,
    domainVersion: payload.domainVersion,
    cycleId: fixture.cycleId,
    subjectId: detail ? fixture.cycleId : null,
    eventHead: payload.eventHead,
    viewHash: payload.viewHash,
    generation,
  });
}

function displayBinding(
  view: Record<string, unknown>,
  surface: 'today' | 'cycles',
  cycleId: string,
) {
  return {
    actorId: String(view.actorId),
    scopeId: String(view.scopeId),
    domainId: String(view.domainId),
    domainVersion: String(view.domainVersion),
    generatedAt: String(view.generatedAt),
    eventHead: view.eventHead,
    viewHash: String(view.viewHash),
    surface,
    subjectId: null,
    cycleId,
  } as const;
}

async function createFixture(domainId: 'business' | 'software'): Promise<CycleFixture> {
  const project = await createTestProject(`t037-cycle-ui-${domainId}`);
  const actorId = `owner-t037-${domainId}`;
  const publicText =
    domainId === 'software'
      ? 'C#/.NET API/CLI docs: https://[2001:db8::1]/guide?q=$HOME#$(pwd); run `echo ~/repo`.'
      : 'Business API/CLI at https://[2001:db8::2]/forecast?q=$PWD#~+/cash; keep C#/.NET notes.';
  const client = createOperateClient(project.dir);
  const started = await client.dispatch({
    operation: 'operate.cycle.start',
    request: {
      scope: { scopeId: `scope-t037-${domainId}`, domainId, domainVersion: '1.0.0' },
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
  const workspace = (await client.readCycleWorkspace(cycleId, actor)) as CycleWorkspace;
  const experience = await client.dispatch({
    operation: 'operate.experience.get',
    request: { cycleId, actor },
  });
  if (!experience.ok) throw new Error(JSON.stringify(experience));
  const view = experience.data as Record<string, unknown>;
  const cyclesDisplay = selectOperateExperienceDisplaySurface(view, {
    surface: 'cycles',
    binding: displayBinding(view, 'cycles', cycleId) as never,
    cycleId,
  }) as DisplaySurface;
  const todayDisplay = selectOperateExperienceDisplaySurface(view, {
    surface: 'today',
    binding: displayBinding(view, 'today', cycleId) as never,
    cycleId,
  }) as DisplaySurface;
  const partial = { project, cycleId, actorId, workspace, cyclesDisplay, todayDisplay, publicText };
  const fixture = {
    ...partial,
    detailBinding: bindingFor(partial, `#/operate/cycles/${encodeURIComponent(cycleId)}`),
    collectionBinding: bindingFor(partial, '#/operate/cycles'),
    todayBinding: bindingFor(partial, '#/operate/today'),
  };
  if (
    !createOperateCycleDisplayWorkspaceValidator(fixture.detailBinding)(workspace) ||
    !createOperateCyclesDisplayValidator(fixture.collectionBinding)(cyclesDisplay) ||
    !createOperateTodayDisplayValidator(fixture.todayBinding)(todayDisplay)
  ) {
    project.cleanup();
    throw new Error('The installed owner did not issue exact T-036 display contracts.');
  }
  return Object.freeze(fixture);
}

function detailState(
  fixture: CycleFixture,
  display: CycleWorkspace = fixture.workspace,
): DashboardProductState<CycleWorkspace> {
  return productState(
    'ready',
    fixture.detailBinding,
    display,
    createOperateCycleDisplayWorkspaceValidator(fixture.detailBinding),
  );
}

function collectionState(
  fixture: CycleFixture,
  display: DisplaySurface = fixture.cyclesDisplay,
): DashboardProductState<DisplaySurface> {
  return productState(
    'ready',
    fixture.collectionBinding,
    display,
    createOperateCyclesDisplayValidator(fixture.collectionBinding),
    display.payload.mutationEnabled,
  );
}

function todayState(
  fixture: CycleFixture,
  display: DisplaySurface = fixture.todayDisplay,
): DashboardProductState<DisplaySurface> {
  return productState(
    'ready',
    fixture.todayBinding,
    display,
    createOperateTodayDisplayValidator(fixture.todayBinding),
    display.payload.mutationEnabled,
  );
}

function mutation<T>(value: T, change: (draft: T) => void): T {
  const draft = structuredClone(value);
  change(draft);
  return draft;
}

beforeAll(async () => {
  [software, business] = await Promise.all([createFixture('software'), createFixture('business')]);
});

afterAll(() => {
  software?.project.cleanup();
  business?.project.cleanup();
});

describe('T-037 verified Cycle display consumption', () => {
  it('renders exact owner-certified arbitrary public text for both domains', () => {
    for (const fixture of [software, business]) {
      const collectionHtml = renderToStaticMarkup(
        <CyclesPage
          currentBinding={fixture.collectionBinding}
          current={collectionState(fixture)}
        />,
      );
      const todayHtml = renderToStaticMarkup(
        <TodayPage
          currentBinding={fixture.todayBinding}
          sources={{ current: todayState(fixture) }}
        />,
      );
      const detailHtml = renderToStaticMarkup(
        <CycleDetailPage
          currentBinding={fixture.detailBinding}
          sources={{ current: { workspace: detailState(fixture) } }}
        />,
      );
      for (const html of [collectionHtml, todayHtml, detailHtml]) {
        expect(html).toContain('C#/.NET');
        expect(html).toContain('API/CLI');
        expect(html).toContain('https://[2001:db8::');
        expect(html).not.toContain('cannot be trusted');
      }
      expect(collectionHtml).toContain(`href="#/operate/cycles/${fixture.cycleId}"`);
      expect(detailHtml).toContain('What is happening now');
      expect(todayHtml).toContain('Observe through Learn operating spine');
    }
  });

  it('renders only the exact public Inbox Review locator for the matching Cycle', () => {
    const locator = Object.freeze({
      kind: 'review' as const,
      cycleId: software.cycleId,
      reviewId: 'rev_cycle_navigation_12345678',
      deepLink: `#/operate/cycles/${encodeURIComponent(software.cycleId)}/reviews/rev_cycle_navigation_12345678`,
      readActionDigest: `sha256:${'a'.repeat(64)}`,
    });
    const html = renderToStaticMarkup(
      <CycleDetailPage
        currentBinding={software.detailBinding}
        sources={{ current: { workspace: detailState(software) } }}
        reviewNavigation={locator}
      />,
    );
    expect(html).toContain(`href="${locator.deepLink}"`);
    expect(html).toContain(`data-review-read-action-digest="${locator.readActionDigest}"`);
    expect(html).toContain('Open Review');

    const foreign = Object.freeze({
      ...locator,
      cycleId: 'cyc_foreign_navigation_1234',
      deepLink:
        '#/operate/cycles/cyc_foreign_navigation_1234/reviews/rev_cycle_navigation_12345678',
    });
    const refused = renderToStaticMarkup(
      <CycleDetailPage
        currentBinding={software.detailBinding}
        sources={{ current: { workspace: detailState(software) } }}
        reviewNavigation={foreign}
      />,
    );
    expect(refused).not.toContain('Open Review');
    expect(refused).not.toContain(foreign.deepLink);
  });

  it('preserves one canonical Review read and choice proof across Today, Cycle, and Inbox entry', () => {
    const reviewId = 'rev_cycle_parity_12345678';
    const readHead = software.workspace.payload.eventHead;
    if (readHead.hash === null) throw new TypeError('Expected a non-genesis Cycle read head.');
    const readAction = Object.freeze({
      tool: 'operate.review.get',
      arguments: Object.freeze({
        reviewId,
        cycleId: software.cycleId,
        actor: Object.freeze({
          actorId: software.actorId,
          kind: 'human' as const,
          runtime: 'openplanr',
        }),
        scope: Object.freeze({
          scopeId: software.workspace.payload.scopeId,
          domainId: software.workspace.payload.domainId,
          domainVersion: software.workspace.payload.domainVersion,
        }),
      }),
      label: 'Inspect review',
      effect: 'read-only' as const,
    });
    const locator = Object.freeze({
      kind: 'review' as const,
      cycleId: software.cycleId,
      reviewId,
      deepLink: `#/operate/cycles/${encodeURIComponent(software.cycleId)}/reviews/${encodeURIComponent(reviewId)}`,
      readActionDigest: sha256Jcs(readAction as never),
    });
    const item = Object.freeze({
      itemId: `approval:${reviewId}`,
      kind: 'approval' as const,
      subjectId: reviewId,
      ownerActorId: software.actorId,
      state: 'pending' as const,
      title: 'Choose the exact Review disposition',
      consequence: 'The Cycle remains pending until the owner decides.',
      expiresAt: null,
      blocking: true,
      evidence: Object.freeze([]),
      requiredParties: Object.freeze([]),
      redactions: Object.freeze([]),
      actionLocator: null,
      navigationLocator: locator,
      unavailableReason: null,
    }) as OperateInboxItem;
    const today = resolveOperateTodayModel(
      { current: todayState(software) },
      software.todayBinding,
    );
    if (today?.kind !== 'surface') throw new TypeError('Expected the current Today surface.');
    const todayWithReview = Object.freeze({ ...today, inbox: Object.freeze([item]) });
    const entries = [
      renderToStaticMarkup(
        <DecisionFocus model={todayWithReview} onContinuation={() => undefined} />,
      ),
      renderToStaticMarkup(
        <CycleDetailPage
          currentBinding={software.detailBinding}
          sources={{ current: { workspace: detailState(software) } }}
          reviewNavigation={locator}
        />,
      ),
      renderToStaticMarkup(
        <InboxItemDetail
          item={item}
          mutationEnabled
          pendingItemId={null}
          surfaceReasonCodes={[]}
          onPreview={() => undefined}
        />,
      ),
    ];
    for (const html of entries) {
      const document = new JSDOM(html).window.document;
      const link = document.querySelector<HTMLAnchorElement>('a[data-review-navigation]');
      expect(link?.textContent).toContain('Open Review');
      expect(link?.getAttribute('href')).toBe(locator.deepLink);
      expect(link?.dataset.reviewReadActionDigest).toBe(locator.readActionDigest);
      expect(parseDashboardRoute(link?.getAttribute('href') ?? '')).toEqual({
        kind: 'operate.review',
        product: 'operate',
        cycleId: software.cycleId,
        subjectId: reviewId,
      });
    }

    const fixture = Object.freeze({
      actorId: software.actorId,
      cycleId: software.cycleId,
      reviewId,
      scopeId: software.workspace.payload.scopeId,
      domainId: software.workspace.payload.domainId,
      domainVersion: software.workspace.payload.domainVersion,
      projectId: software.detailBinding.projectId,
      readHead: Object.freeze({ sequence: readHead.sequence, hash: readHead.hash }),
      terminalHead: Object.freeze({ sequence: readHead.sequence + 1, hash: OTHER_HASH }),
      readAt: '2026-08-23T12:00:00.000Z',
      committedAt: '2026-08-23T12:01:00.000Z',
    }) satisfies ReviewFixtureIdentity;
    const reviewWorkspace = createPendingReviewDisplay(3, fixture);
    expect(reviewWorkspace.payload.sourceEventHead).toEqual(readHead);
    expect(reviewWorkspace.payload.sourceReadEventHead).toEqual(readHead);
    const capability = reviewWorkspace.payload.data.capability;
    if (!capability.available) throw new TypeError('Expected available Review capability.');
    const choiceHashes = reviewWorkspace.payload.data.choices.map(({ choiceHash }) => choiceHash);
    expect(choiceHashes).toHaveLength(3);
    expect(new Set(choiceHashes).size).toBe(3);
    expect([...choiceHashes].sort()).toEqual(
      capability.actions.map(({ action }) => sha256Jcs(action.arguments as never)).sort(),
    );
    expect(locator.readActionDigest).toBe(sha256Jcs(readAction as never));
  });

  it('keeps the shared spine a pure owner-order presenter', () => {
    const cycle = software.workspace.payload.data.cycle;
    const html = renderToStaticMarkup(
      <OperatingSpine stages={cycle.stages} cycleId={cycle.cycleId} health={cycle.health} />,
    );
    expect(html.match(/data-projection-state=/gu)).toHaveLength(7);
    expect(
      [
        ...html.matchAll(/<strong>(Observe|Understand|Decide|Govern|Act|Verify|Learn)<\/strong>/gu),
      ].map((match) => match[1]),
    ).toEqual(['Observe', 'Understand', 'Decide', 'Govern', 'Act', 'Verify', 'Learn']);
    expect(SPINE_SOURCE).not.toMatch(/\.sort\s*\(|new Set\s*\(|\.reduce\s*\(/u);
  });

  it.each([
    [
      'content byte',
      (display: DisplaySurface) => {
        if (display.payload.surface !== 'cycles') throw new Error('Expected Cycles display.');
        Reflect.set(display.payload.data.cycles[0], 'focus', [TAMPER_SENTINEL]);
      },
    ],
    [
      'content digest',
      (display: DisplaySurface) => {
        Reflect.set(display.integrity, 'contentHash', OTHER_HASH);
      },
    ],
    [
      'actor binding',
      (display: DisplaySurface) => {
        Reflect.set(display.payload, 'actorId', 'foreign-owner');
      },
    ],
    [
      'stage order',
      (display: DisplaySurface) => {
        if (display.payload.surface !== 'cycles') throw new Error('Expected Cycles display.');
        const stages = display.payload.data.cycles[0].stages;
        [stages[0], stages[1]] = [stages[1], stages[0]];
      },
    ],
    [
      'lifecycle state',
      (display: DisplaySurface) => {
        if (display.payload.surface !== 'cycles') throw new Error('Expected Cycles display.');
        Reflect.set(display.payload.data.cycles[0].stages[0], 'state', 'current');
      },
    ],
    [
      'full-view anchor',
      (display: DisplaySurface) => {
        Reflect.set(display.integrity, 'sourceViewHash', OTHER_HASH);
      },
    ],
    [
      'Cycle link',
      (display: DisplaySurface) => {
        if (display.payload.surface !== 'cycles') throw new Error('Expected Cycles display.');
        Reflect.set(display.payload.data.cycles[0], 'deepLink', '#/operate/cycles/cyc_00000099');
      },
    ],
  ] as const)('rejects a schema-shaped %s mutation before product state', (_case, change) => {
    const tampered = mutation(software.cyclesDisplay, change);
    expect(() => collectionState(software, tampered)).toThrow(/owner-boundary contract/u);
  });

  it.each([
    [
      'content',
      (display: CycleWorkspace) => {
        Reflect.set(display.payload.data.cycle, 'focus', [TAMPER_SENTINEL]);
      },
    ],
    [
      'digest',
      (display: CycleWorkspace) => {
        Reflect.set(display.integrity, 'contentHash', OTHER_HASH);
      },
    ],
    [
      'binding',
      (display: CycleWorkspace) => {
        Reflect.set(display.payload, 'scopeId', 'foreign-scope');
      },
    ],
    [
      'order',
      (display: CycleWorkspace) => {
        const stages = display.payload.data.cycle.stages;
        [stages[0], stages[1]] = [stages[1], stages[0]];
      },
    ],
    [
      'lifecycle',
      (display: CycleWorkspace) => {
        Reflect.set(display.payload.data.cycle.stages[0], 'state', 'current');
      },
    ],
    [
      'anchor',
      (display: CycleWorkspace) => {
        Reflect.set(display.integrity, 'sourceViewHash', OTHER_HASH);
      },
    ],
    [
      'link',
      (display: CycleWorkspace) => {
        Reflect.set(display.payload.data.cycle, 'deepLink', '#/operate/cycles/cyc_00000099');
      },
    ],
  ] as const)('refuses the whole detail before any child for unverified %s', (_case, change) => {
    const trusted = detailState(software);
    const tampered = mutation(software.workspace, change);
    const unbranded = Object.freeze({ ...trusted, data: tampered });
    const html = renderToStaticMarkup(
      <CycleDetailPage
        currentBinding={software.detailBinding}
        sources={{ current: { workspace: unbranded } }}
      />,
    );
    expect(html).toContain('Cycle cannot be trusted');
    expect(html).not.toContain('<header');
    expect(html).not.toContain('What is happening now');
    expect(html).not.toContain('Operating spine');
    expect(html).not.toContain('Persistent work');
    expect(html).not.toContain('Checkpoint and replay');
    expect(html).not.toContain(TAMPER_SENTINEL);
  });

  it('requires parser branding, deep freeze, and exact current binding at model and DOM', () => {
    const state = detailState(software);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.data)).toBe(true);
    expect(Object.isFrozen(state.data?.payload.data.cycle.stages)).toBe(true);
    expect(resolveOperateCycleModel({ current: { workspace: state } }, software.detailBinding)).not
      .toBeNull;

    const foreign = createDashboardQueryIdentity({
      ...software.detailBinding,
      actorId: 'foreign-owner',
    });
    expect(resolveOperateCycleModel({ current: { workspace: state } }, foreign)).toBeNull();
    const html = renderToStaticMarkup(
      <CycleDetailPage currentBinding={foreign} sources={{ current: { workspace: state } }} />,
    );
    expect(html).toContain('Cycle cannot be trusted');
    expect(html).not.toContain(software.publicText);
  });

  it('does not retain any browser lexical privacy or lifecycle/graph authority', () => {
    expect(PRODUCTION_SOURCE).not.toMatch(
      /isAccessSafe|normalizeBrowser|containsPrivate|PRIVATE_BODY|SENSITIVE_RELATIVE|hasPathRoot|blankCertifiedHttps|HTML_ENTITY/u,
    );
    expect(PRODUCTION_SOURCE).not.toMatch(
      /ACTIVE_CYCLE_STAGE|validPersistentGraph|validOutcomeLearningGraph|hasExactAffirmativeGateCoverage|workspaceSurface/u,
    );
    expect(PRODUCTION_SOURCE).toContain('assertOperateExperienceDisplaySurfaceV1');
    expect(PRODUCTION_SOURCE).toContain('assertOperateCycleDisplayWorkspaceV1');
  });

  it('reaches collection, Today, and detail through the preserved UnifiedShell routes', () => {
    const cases = [
      {
        hash: '#/operate/cycles',
        binding: software.collectionBinding,
        projection: collectionState(software),
        expected: 'Repository Cycles',
      },
      {
        hash: '#/operate/today',
        binding: software.todayBinding,
        projection: todayState(software),
        expected: 'Today decision workspace',
      },
      {
        hash: `#/operate/cycles/${software.cycleId}`,
        binding: software.detailBinding,
        projection: detailState(software),
        expected: 'What is happening now',
      },
    ];
    for (const entry of cases) {
      const html = renderToStaticMarkup(
        <DashboardProviders
          connection={{
            state: 'connected',
            label: 'Connected',
            reason: 'Verified test connection.',
          }}
          buildId="t037-cycle-test"
          initialHash={entry.hash}
          binding={entry.binding}
          projection={entry.projection}
        >
          <UnifiedShell />
        </DashboardProviders>,
      );
      expect(html).toContain(entry.expected);
      expect(html).not.toContain('Unified boot and first use');
    }
  });

  it('keeps the verified detail keyboard-semantic and axe-clean', async () => {
    const html = renderToStaticMarkup(
      <CycleDetailPage
        currentBinding={software.detailBinding}
        sources={{ current: { workspace: detailState(software) } }}
      />,
    );
    const dom = new JSDOM(
      `<!doctype html><html lang="en"><head><title>Cycle detail</title></head><body><main>${html}</main></body></html>`,
    );
    expect(dom.window.document.querySelectorAll('details > summary').length).toBeGreaterThan(7);
    expect(dom.window.document.querySelectorAll('h1')).toHaveLength(1);
    expect(
      (
        await axe.run(dom.window.document.documentElement, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
    dom.window.close();
  });

  it('preserves responsive, touch, theme, and reduced-motion presentation rules', () => {
    expect(CYCLE_STYLES).toMatch(
      /\.op-cycle-stage > summary\s*\{[\s\S]*min-height: var\(--op-density-control\)/u,
    );
    expect(CYCLE_STYLES).toMatch(
      /@media \(max-width: 800px\)[\s\S]*\.op-cycle-spine ol\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/u,
    );
    expect(CYCLE_STYLES).toMatch(
      /@media \(max-width: 480px\)[\s\S]*\.op-cycle-list__rows \.op-cycle-link\s*\{[\s\S]*width: 100%/u,
    );
    expect(CYCLE_STYLES).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.op-cycle-link/u,
    );
    expect(CYCLE_STYLES).toMatch(/@media \(forced-colors: active\)[\s\S]*\.op-cycle-spine/u);
  });

  it('keeps committed priority and current-stage selection unchanged', () => {
    const today = resolveOperateTodayModel(
      { current: todayState(software) },
      software.todayBinding,
    );
    const cycle = resolveOperateCycleModel(
      { current: { workspace: detailState(software) } },
      software.detailBinding,
    );
    expect(today?.kind).toBe('surface');
    expect(cycle?.currentStage).toBe(cycle?.stages.find((stage) => stage.state === 'current'));
    if (today?.kind === 'surface') {
      expect(today.priorityAttention).toBe(today.attention[0] ?? null);
      expect(today.continuation).toBe(today.allowedActions[0] ?? null);
    }
  });
});
