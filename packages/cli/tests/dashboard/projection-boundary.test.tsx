// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveOperateSharedTruthSummaryV1 } from 'planr-pipeline/operate/review-workspace-projection-v2';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { validateOperateExperienceSurfaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-experience-surface.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { parseDashboardRoute } from '../../../../apps/dashboard/src/app/router.js';
import {
  ProjectionBoundary,
  resolveProjectionBoundary,
} from '../../../../apps/dashboard/src/features/shell/ProjectionBoundary.js';
import { projectValidatedOperateTodaySurface } from '../../../../apps/dashboard/src/features/shell/today-surface.js';
import {
  type DashboardProductState,
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
} from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

const HASH = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const today = createDashboardQueryIdentity({
  productArea: 'operate',
  route: '#/operate/today',
  actorId: 'legacy-owner-must-not-render',
  projectId: HASH('a'),
  scopeId: 'scope-dashboard',
  domainId: 'software',
  domainVersion: '2.0.0',
  cycleId: null,
  subjectId: null,
  eventHead: { sequence: 46, hash: HASH('b') },
  viewHash: HASH('c'),
  generation: 7,
});
const cycles = createDashboardQueryIdentity({
  ...today,
  route: '#/operate/cycles',
});
const cycle = createDashboardQueryIdentity({
  ...today,
  route: '#/operate/cycles/cycle-46',
  cycleId: 'cycle-46',
  subjectId: 'cycle-46',
});
const planning = createDashboardQueryIdentity({
  ...today,
  productArea: 'planning',
  route: '#/overview',
  actorId: 'planning-owner',
  cycleId: null,
  subjectId: null,
});

const packageRoot = resolvePipelinePackageRoot();
const legacyTodayExperienceView = structuredClone(
  JSON.parse(
    readFileSync(
      join(packageRoot, 'conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json'),
      'utf8',
    ),
  )['operate-experience-view'],
);
legacyTodayExperienceView.eventHead = today.eventHead;
delete legacyTodayExperienceView.viewHash;
legacyTodayExperienceView.viewHash = sha256Jcs(legacyTodayExperienceView);
const legacyTodayTruthSummary = deriveOperateSharedTruthSummaryV1(legacyTodayExperienceView);

const legacyToday = {
  ok: true,
  kind: 'operate-experience-surface',
  schemaVersion: '1.0.0',
  protocolVersion: '2.0.0',
  surface: 'today',
  readOnly: true,
  mutationEnabled: true,
  scopeId: today.scopeId,
  domainId: today.domainId,
  domainVersion: today.domainVersion,
  actorId: today.actorId,
  accessLevel: 'internal',
  generatedAt: '2026-08-13T00:00:00.000Z',
  eventHead: today.eventHead,
  viewHash: legacyTodayExperienceView.viewHash,
  truthSummary: legacyTodayTruthSummary,
  status: 'ready',
  reasonCodes: [],
  data: {
    attention: [],
    domainMetrics: [],
    activeCycle: null,
    inbox: [],
    actions: [],
    outcomes: [],
    allowedActions: [],
  },
} as const;

function renderBoundary<T extends Record<string, unknown>>(
  identity: DashboardQueryIdentity,
  state: DashboardProductState<T>,
  child = vi.fn((data: T) => <h2>{String(data.title ?? 'verified child')}</h2>),
) {
  const html = renderToStaticMarkup(
    <ProjectionBoundary
      currentBinding={identity}
      route={parseDashboardRoute(identity.route)}
      state={state}
    >
      {child}
    </ProjectionBoundary>,
  );
  return { html, child };
}

describe('exact projection boundary', () => {
  it('rejects an exact-binding legacy v1 Today surface before children or DOM truth', () => {
    expect(validateOperateExperienceSurfaceV1(legacyToday)).toEqual([]);
    const { html, child } = renderBoundary(today, {
      kind: 'ready',
      binding: today,
      data: legacyToday,
    } as unknown as DashboardProductState<typeof legacyToday>);
    expect(html).toContain('data-projection-boundary="incompatible"');
    expect(html).toContain('Product state could not be validated');
    expect(html).not.toContain(today.actorId);
    expect(html).not.toContain('operate-experience-surface');
    expect(child).not.toHaveBeenCalled();
  });

  it.each([
    ['Cycles', cycles],
    ['Cycle detail', cycle],
  ] as const)(
    'rejects unbranded %s title and summary before children or DOM',
    (_name, identity) => {
      const data = {
        title: 'UNBRANDED_CYCLE_TITLE_MUST_NOT_RENDER',
        summary: 'UNBRANDED_CYCLE_SUMMARY_MUST_NOT_RENDER',
      };
      const { html, child } = renderBoundary(identity, {
        kind: 'ready',
        binding: identity,
        data,
      } as unknown as DashboardProductState<typeof data>);
      expect(html).toContain('Product state could not be validated');
      expect(html).not.toContain(data.title);
      expect(html).not.toContain(data.summary);
      expect(child).not.toHaveBeenCalled();
    },
  );

  it('preserves the parser-branded product-state branch for an exact Operate route', () => {
    const state = parseDashboardProductState(
      {
        kind: 'ready',
        binding: today,
        data: { title: 'PARSER_BRANDED_TRUTH' },
        reasonCodes: [],
        error: null,
        mutationEnabled: true,
        policy: dashboardProductStatePolicy('ready'),
      },
      {
        currentBinding: today,
        validateData: (value): value is { title: string } =>
          typeof value === 'object' &&
          value !== null &&
          Reflect.get(value, 'title') === 'PARSER_BRANDED_TRUTH',
      },
    );
    const child = vi.fn((data: { title: string }) => <h2>{data.title}</h2>);
    const html = renderToStaticMarkup(
      <ProjectionBoundary
        currentBinding={today}
        route={parseDashboardRoute(today.route)}
        state={state}
      >
        {child}
      </ProjectionBoundary>,
    );
    expect(html).toContain('data-projection-boundary="ready"');
    expect(html).toContain('PARSER_BRANDED_TRUTH');
    expect(html).not.toContain('Operate display could not be verified');
    expect(child).toHaveBeenCalledOnce();
  });

  it('rejects unbranded legacy projections for non-Operate routes too', () => {
    const { html, child } = renderBoundary(planning, {
      kind: 'ready',
      binding: planning,
      data: { title: 'Planning remains reachable' },
    } as unknown as DashboardProductState<{ title: string }>);
    expect(html).toContain('data-projection-boundary="incompatible"');
    expect(html).toContain('Product state could not be validated');
    expect(html).not.toContain('Planning remains reachable');
    expect(child).not.toHaveBeenCalled();
  });

  it('keeps the legacy Today helper as a fixed, non-reading fail-closed seam', () => {
    const read = vi.fn();
    const payload = Object.defineProperty({}, 'actorId', { enumerable: true, get: read });
    expect(projectValidatedOperateTodaySurface(payload, today, 'ready')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects product-state look-alikes that bypass the parser brand', () => {
    const title = 'LOOKALIKE_TRUTH_MUST_NOT_RENDER';
    const { html, child } = renderBoundary(planning, {
      kind: 'ready',
      binding: planning,
      data: { title },
      policy: dashboardProductStatePolicy('ready'),
    } as unknown as DashboardProductState<{ title: string }>);
    expect(html).toContain('Product state could not be validated');
    expect(html).not.toContain(title);
    expect(child).not.toHaveBeenCalled();
  });

  it('retains exact binding and required-shape refusal for parser-branded projections', () => {
    const data = { title: 'Planning truth', summary: 'Exact projection' };
    const foreign = { ...planning, generation: planning.generation + 1 };
    const foreignState = parseDashboardProductState(
      {
        kind: 'ready',
        binding: foreign,
        data,
        reasonCodes: [],
        error: null,
        mutationEnabled: true,
        policy: dashboardProductStatePolicy('ready'),
      },
      {
        currentBinding: foreign,
        validateData: (value): value is typeof data => typeof value === 'object' && value !== null,
      },
    );
    const wrongBinding = resolveProjectionBoundary(foreignState, planning, ['title', 'summary']);
    expect(wrongBinding).toMatchObject({ presentation: 'incompatible' });

    const incompleteState = parseDashboardProductState(
      {
        kind: 'ready',
        binding: planning,
        data: { ...data, summary: undefined },
        reasonCodes: [],
        error: null,
        mutationEnabled: true,
        policy: dashboardProductStatePolicy('ready'),
      },
      {
        currentBinding: planning,
        validateData: (value): value is typeof data & { summary: undefined } =>
          typeof value === 'object' && value !== null,
      },
    );
    const incomplete = resolveProjectionBoundary(incompleteState, planning, ['title', 'summary']);
    expect(incomplete).toMatchObject({ presentation: 'incompatible' });
  });

  it('retains parser-issued read-only presentation and rejects invented durable resume data', () => {
    const readOnly = parseDashboardProductState(
      {
        kind: 'read-only',
        binding: planning,
        data: { title: 'Observer truth' },
        reasonCodes: ['DASHBOARD_READ_ONLY'],
        error: null,
        mutationEnabled: false,
        policy: dashboardProductStatePolicy('read-only'),
      },
      {
        currentBinding: planning,
        validateData: (value): value is { title: string } =>
          typeof value === 'object' &&
          value !== null &&
          Reflect.get(value, 'title') === 'Observer truth',
      },
    );
    expect(resolveProjectionBoundary(readOnly, planning)).toMatchObject({
      presentation: 'read-only',
      data: { title: 'Observer truth' },
    });

    expect(
      resolveProjectionBoundary(
        {
          kind: 'empty',
          binding: planning,
          data: null,
          reasonCodes: ['DASHBOARD_EMPTY'],
          error: null,
          mutationEnabled: false,
          policy: dashboardProductStatePolicy('empty'),
          resumable: { binding: planning, data: { title: 'Durable truth' } },
        } as unknown as DashboardProductState<{ title: string }>,
        planning,
        ['title'],
      ),
    ).toMatchObject({ presentation: 'incompatible' });
  });
});
