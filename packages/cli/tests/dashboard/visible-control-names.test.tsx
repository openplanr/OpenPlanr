// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { computeAccessibleName } from 'dom-accessibility-api';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import {
  ArtifactStatus,
  ArtifactTag,
  Button,
  CommandHint,
  EmptyState,
  GovernedButton,
  IconButton,
  Input,
  Inspector,
  PriorityChip,
  Select,
  Switch,
  Tabs,
  Toast,
  Tooltip,
  WorkItemChip,
} from '../../../../apps/dashboard/src/design-system/components/index.js';
import { ActivityPage } from '../../../../apps/dashboard/src/features/planning/ActivityPage.js';
import { BoardPage } from '../../../../apps/dashboard/src/features/planning/BoardPage.js';
import { DetailPage } from '../../../../apps/dashboard/src/features/planning/DetailPage.js';
import { GraphPage } from '../../../../apps/dashboard/src/features/planning/GraphPage.js';
import { ListPage } from '../../../../apps/dashboard/src/features/planning/ListPage.js';
import { OverviewPage } from '../../../../apps/dashboard/src/features/planning/OverviewPage.js';
import {
  type PlanningGraphEnvelope,
  parsePlanningGraphEnvelope,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import {
  appendPlanningSessionPatch,
  EMPTY_SESSION_ACTIVITY,
  planningActivityScope,
} from '../../../../apps/dashboard/src/features/planning/planning-session-activity.js';
import { SprintsPage } from '../../../../apps/dashboard/src/features/planning/SprintsPage.js';
import { clearInspector } from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { DASHBOARD_ROUTE_FIXTURES } from '../e2e/fixtures/dashboard-route-catalog.js';
import {
  buildPremiumDashboardFixture,
  type FixtureDataset,
  fixtureHash,
  fixturePatch,
  fixtureSnapshot,
} from './fixtures/premium-dashboard-fixtures.js';
import { operatePresentationFixture } from './operate-presentation-fixture.js';

const normalise = (text: string) => text.replace(/\s+/gu, ' ').trim().toLowerCase();

function visibleText(element: Element): string {
  if (element.matches('svg') || element.closest('[aria-hidden="true"], [hidden]')) return '';
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return '';
  if (element.tagName === 'BR') return ' ';
  return Array.from(element.childNodes)
    .map((child) => (child instanceof Element ? visibleText(child) : (child.textContent ?? '')))
    .join('');
}

async function nameFailures(root: HTMLElement): Promise<string[]> {
  const result = await axe.run(root, {
    runOnly: { type: 'rule', values: ['label-content-name-mismatch'] },
    elementRef: true,
  });
  const failures = result.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) => `${node.target.join(', ')}: ${node.html}\n${node.failureSummary}`,
    ),
  );
  // jsdom cannot measure icon fonts without native canvas. Check undecidable text
  // controls directly so an axe incomplete result cannot silently pass this gate.
  for (const incomplete of result.incomplete) {
    for (const node of incomplete.nodes) {
      const element = node.element;
      if (!element) throw new Error(`Missing element for ${node.target.join(', ')}: ${node.html}`);
      const text = normalise(visibleText(element));
      if (!/[\p{L}\p{N}]/u.test(text)) continue;
      const name = normalise(computeAccessibleName(element));
      if (!name.includes(text))
        failures.push(
          `${node.target.join(', ')}: ${node.html}\nVisible text ${JSON.stringify(text)} is missing from name ${JSON.stringify(name)}.`,
        );
    }
  }
  return failures;
}

let sequence = 0;
function fixture(dataset: FixtureDataset, route: string) {
  const source = buildPremiumDashboardFixture(dataset);
  const selected = source.graph.nodes.find((node) => node.type === 'spec');
  if (!selected) throw new Error('The naming fixture needs a specification.');
  const subjectId = route === 'detail' ? selected.id : null;
  const href = subjectId ? `#/detail/${encodeURIComponent(subjectId)}` : `#/${route}`;
  const snapshot = fixtureSnapshot(source.graph, {
    actorId: `control-names-${++sequence}`,
    projectId: `sha256:${'d'.repeat(64)}`,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation: 1,
  });
  const binding = createDashboardQueryIdentity({
    ...snapshot.binding,
    productArea: 'planning',
    route: href,
    subjectId,
    cycleId: null,
    eventHead: snapshot.cursor.eventHead,
    viewHash: snapshot.cursor.viewHash,
  });
  const envelope = parsePlanningGraphEnvelope(snapshot, binding);
  const current = parseDashboardProductState<PlanningGraphEnvelope>(
    {
      kind: 'ready',
      binding,
      data: envelope,
      reasonCodes: [],
      error: null,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy('ready'),
    },
    {
      currentBinding: binding,
      validateData: (value): value is PlanningGraphEnvelope => {
        parsePlanningGraphEnvelope(value, binding);
        return true;
      },
    },
  );
  const wrap = (children: ReactNode) => (
    <DashboardProviders
      buildId="control-names"
      initialHash={href}
      binding={binding}
      projection={current}
      planningProjection={current}
      bootPhase="compatible"
    >
      <main>{children}</main>
    </DashboardProviders>
  );
  return { ...source, binding, current, envelope, selected, wrap };
}

function SharedRecipes({ source }: { source: ReturnType<typeof fixture> }) {
  const node = source.selected;
  return (
    <>
      <ArtifactTag type="spec">{node.id}</ArtifactTag>
      <WorkItemChip type={node.type} id={node.id} title={node.title} onClick={() => undefined} />
      {['outstanding', 'in-progress', 'blocked', 'addressed', 'done'].map((status) => (
        <ArtifactStatus key={status} status={status} />
      ))}
      {['P0', 'P1', 'P2', 'P3', 'none'].map((priority) => (
        <PriorityChip key={priority} priority={priority} />
      ))}
      <Button>Open artifact</Button>
      <Button disabled disabledReason="The artifact is unavailable">
        Open unavailable artifact
      </Button>
      <Button loading>Reading artifact</Button>
      <IconButton icon="search" label="Search artifacts" />
      <GovernedButton onInvoke={() => undefined}>Run reviewed action</GovernedButton>
      <CommandHint command={`openplanr status ${node.id} --md`} />
      <Input ariaLabel="Filter artifacts" value="" onChange={() => undefined} />
      <Select
        ariaLabel="Artifact type"
        value="spec"
        options={[{ value: 'spec', label: 'Specification' }]}
        onChange={() => undefined}
      />
      <Switch label="Comfortable rows" checked onChange={() => undefined} />
      <Tabs
        label="Presentation"
        value="list"
        tabs={[
          { id: 'list', label: 'List' },
          { id: 'board', label: 'Board' },
        ]}
        onChange={() => undefined}
      />
      <Tooltip content={node.title}>
        <Button>Inspect artifact</Button>
      </Tooltip>
      <Toast title="Copied">{node.id}</Toast>
      <EmptyState
        icon="search"
        title="No matching artifacts"
        description="Change the current filter."
        action={<Button>Clear filters</Button>}
      />
      <Inspector
        open
        onOpenChange={() => undefined}
        title="Artifact inspector"
        description={node.title}
      >
        <WorkItemChip type={node.type} id={node.id} title={node.title} />
      </Inspector>
    </>
  );
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('pc-graph') ? 1000 : 0;
  });
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('pc-graph') ? 600 : 0;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  clearInspector();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('visible control names', () => {
  it('rejects the command hint regression without inventing whitespace between inline labels', async () => {
    const { container, getByRole } = render(
      <button
        id="command-hint-name-regression"
        type="button"
        className="pc-command-hint__copy"
        data-state="idle"
        aria-label="Copy command"
        aria-keyshortcuts="C"
      >
        <span>Copy</span>
        <kbd>C</kbd>
      </button>,
    );
    expect(visibleText(getByRole('button'))).toBe('CopyC');
    const failures = await nameFailures(container);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join('\n')).toContain('command-hint-name-regression');
  });

  it('excludes hidden shortcut badges from the accessible subtree', async () => {
    const { container, getByRole } = render(<CommandHint command="openplanr status --md" />);
    const button = getByRole('button', { name: 'Copy command' });
    expect(button.getAttribute('aria-label')).toBeNull();
    expect(button.querySelector('kbd')?.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(button.getAttribute('aria-keyshortcuts')).toBe('C');
    expect(visibleText(button)).toBe('Copy command');
    expect(await nameFailures(container)).toEqual([]);
  });
  it.each([
    ['board-name-regression', 'Expand 33 done cards', '33 done · Expand'],
    ['graph-name-regression', 'Inspect task', 'T-001 Verify the artifact'],
    ['palette-name-regression', 'Open search', 'Search artifacts'],
  ])('rejects and identifies the %s sentinel', async (id, name, text) => {
    const { container } = render(
      <button id={id} type="button" aria-label={name}>
        {text}
      </button>,
    );
    const failures = await nameFailures(container);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join('\n')).toContain(id);
  });

  it.each(DASHBOARD_ROUTE_FIXTURES.filter(({ kind }) => kind.startsWith('operate.')))(
    'keeps $kind names aligned with visible text',
    async ({ kind, hash, readyText }) => {
      const view = render(operatePresentationFixture(hash));
      const workspace = view.container.querySelector(`[data-route-kind="${kind}"]`);
      expect(workspace).toBeTruthy();
      expect(workspace?.classList.contains('pc-operate')).toBe(true);
      expect(workspace?.textContent).toContain(readyText);
      expect(view.container.textContent).not.toContain('cannot be trusted');
      expect(await nameFailures(view.container)).toEqual([]);
    },
  );

  for (const dataset of ['representative', 'artboard'] as const) {
    it(`keeps ${dataset} shared recipe names aligned with visible text`, async () => {
      const source = fixture(dataset, 'home');
      render(source.wrap(<SharedRecipes source={source} />));
      expect(await nameFailures(document.body)).toEqual([]);
    });
    it.each([
      ['home', OverviewPage],
      ['list', ListPage],
      ['graph', GraphPage],
      ['board', BoardPage],
      ['detail', DetailPage],
      ['sprints', SprintsPage],
      ['activity', ActivityPage],
    ] as const)(`keeps ${dataset} %s names aligned with visible text`, async (route, Page) => {
      const source = fixture(dataset, route);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const id = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1) ?? '');
          const summary = source.graph.nodes.find((node) => node.id === id);
          if (!summary) throw new Error(`Unexpected detail read for ${id}`);
          const node = { ...summary, body: '## Notes\nVerified fixture detail.' };
          return new Response(
            JSON.stringify({
              kind: 'planning-detail',
              schemaVersion: '1.0.0',
              binding: source.envelope.binding,
              cursor: source.envelope.cursor,
              subjectId: id,
              node,
              nodeHash: fixtureHash(node),
            }),
            { headers: { 'content-type': 'application/json' } },
          );
        }),
      );
      const view = render(
        source.wrap(
          route === 'activity' ? (
            <ActivityPage
              currentBinding={source.binding}
              current={source.current}
              sessionActivity={appendPlanningSessionPatch(
                EMPTY_SESSION_ACTIVITY,
                planningActivityScope(source.binding),
                source.envelope,
                fixturePatch(source.envelope, source.selected.id).event.payload,
              )}
            />
          ) : (
            <Page currentBinding={source.binding} current={source.current} />
          ),
        ),
      );
      if (route === 'detail')
        await waitFor(() =>
          expect(view.container.textContent).toContain(
            'Detail verified against the current planning snapshot.',
          ),
        );
      expect(view.container.querySelectorAll('button').length).toBeGreaterThan(0);
      if (route === 'sprints' || route === 'activity') {
        const copy = view.getByRole('button', { name: 'Copy command' });
        expect(copy.classList.contains('pc-command-hint__copy')).toBe(true);
        expect(visibleText(copy)).toBe('Copy command');
      }
      if (route === 'board') {
        const expansion = view.container.querySelector<HTMLButtonElement>(
          '[data-keyboard-column="done"] .pc-status-board__empty',
        );
        expect(expansion?.textContent).toContain('Expand');
        expect(expansion?.hasAttribute('aria-label')).toBe(false);
        if (!expansion) throw new Error('Missing collapsed Done control.');
        expect(normalise(computeAccessibleName(expansion))).toBe(normalise(visibleText(expansion)));
      }
      expect(await nameFailures(view.container)).toEqual([]);
      if (route === 'board') {
        fireEvent.change(view.getByRole('combobox', { name: 'Swimlanes' }), {
          target: { value: 'spec' },
        });
        expect(await nameFailures(view.container)).toEqual([]);
        fireEvent.click(view.getByRole('button', { name: /Expand Done/u }));
        expect(await nameFailures(view.container)).toEqual([]);
      }
    });
  }
});
