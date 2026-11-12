// @vitest-environment jsdom

import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanningArtifactDetail } from '../../../../apps/dashboard/src/features/planning/DetailPage.js';
import { DetailProperties } from '../../../../apps/dashboard/src/features/planning/DetailProperties.js';
import { DetailTrace } from '../../../../apps/dashboard/src/features/planning/DetailTrace.js';
import {
  type PlanningGraph,
  type PlanningNode,
  parsePlanningGraphEnvelope,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import { boardSelectionItems } from '../../../../apps/dashboard/src/features/planning/planning-board-view.js';
import {
  planningContinuation,
  planningDetailHref,
  planningDisplayId,
} from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import { selectStructuralDetail } from '../../../../apps/dashboard/src/features/planning/planning-structural-model.js';
import type { PlanningWorkspaceModel } from '../../../../apps/dashboard/src/features/planning/planning-workspace.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { PlanningPresentationProvider } from '../../../../apps/dashboard/src/lib/routing/planning-presentation.js';
import { findDetailReady } from './detail-ready.js';

const origin = 'http://localhost:7473';
const nodeId = 'SPEC-026/T-121';
const file = 'src/detail #?.ts';
const sourcePath = '.planr/specs/SPEC-026-detail/tasks/T-121-detail.md';
const editorUrl = 'vscode://file/Users/example/project/src/detail%20%23%3F.ts';
const body = `## Acceptance Criteria
- The trace is navigable.
- Declared files can be opened safely.

## Files
- \`${file}\`

## Notes
Verified detail body.
<img src=x onerror="alert(1)">
<script>window.hostile=true</script>
[unsafe](javascript:alert)
[data](data:text/html,unsafe)
[reference](https://example.com/reference)
`;
let actorSequence = 0;

function fixture(acceptanceRefs?: readonly string[]) {
  actorSequence += 1;
  const graph: PlanningGraph = {
    nodes: [
      {
        id: 'BL-026',
        type: 'backlog',
        title: 'Source opportunity',
        status: 'outstanding',
        frontmatter: {},
      },
      {
        id: 'SPEC-026',
        type: 'spec',
        title: 'Detail specification',
        status: 'in-progress',
        frontmatter: { originId: 'BL-026' },
      },
      {
        id: 'SPEC-026/US-104',
        type: 'story',
        title: 'Review the artifact',
        status: 'in-progress',
        frontmatter: { specId: 'SPEC-026' },
      },
      {
        id: nodeId,
        type: 'task',
        title: 'Shared detail task',
        status: 'blocked',
        frontmatter: {
          id: 'T-121',
          status: 'pending',
          specId: 'SPEC-026',
          storyId: 'US-104',
          dependsOn: ['SPEC-026/T-120', 'SPEC-026/T-999'],
          sourcePath,
          created: '2026-09-02',
          updated: '2026-09-12',
          ...(acceptanceRefs ? { acceptanceRefs } : {}),
          shipRef: 'https://example.com/evidence',
        },
      },
      {
        id: 'SPEC-026/T-120',
        type: 'task',
        title: 'Resolved dependency',
        status: 'done',
        frontmatter: { id: 'T-120', specId: 'SPEC-026' },
      },
      {
        id: 'SPEC-026/T-122',
        type: 'task',
        title: 'Unblocked consumer',
        status: 'outstanding',
        frontmatter: { id: 'T-122', specId: 'SPEC-026', dependsOn: [nodeId] },
      },
    ],
    edges: [
      { from: 'SPEC-026', to: 'SPEC-026/US-104', kind: 'contains' },
      { from: 'SPEC-026/US-104', to: nodeId, kind: 'contains' },
      { from: nodeId, to: 'SPEC-026/T-120', kind: 'depends_on' },
      { from: 'SPEC-026/T-122', to: nodeId, kind: 'depends_on' },
    ],
  };
  const binding = createDashboardQueryIdentity({
    productArea: 'planning',
    route: '#/list',
    actorId: `detail-content-${actorSequence}`,
    projectId: `sha256:${'e'.repeat(64)}`,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    cycleId: null,
    subjectId: null,
    eventHead: { sequence: 0, hash: null },
    viewHash: sha256Jcs(graph as never),
    generation: 8,
  });
  const envelope = parsePlanningGraphEnvelope(
    {
      kind: 'planning-graph-snapshot',
      schemaVersion: '1.0.0',
      binding: {
        actorId: binding.actorId,
        projectId: binding.projectId,
        scopeId: 'planning',
        domainId: 'planning',
        domainVersion: '1.0.0',
        generation: 8,
      },
      cursor: { eventHead: binding.eventHead, viewHash: binding.viewHash },
      mode: 'spec',
      graph,
    },
    binding,
  );
  const model: PlanningWorkspaceModel = {
    envelope,
    graph: envelope.graph,
    binding,
    presentation: 'ready',
    readOnly: true,
    mutationEnabled: false,
  };
  return model;
}

function detailEnvelope(model: PlanningWorkspaceModel, text = body, subjectId = nodeId) {
  const summary = model.graph.nodes.find((entry) => entry.id === subjectId) as PlanningNode;
  const node = { ...summary, body: text };
  return {
    kind: 'planning-detail',
    schemaVersion: '1.0.0',
    binding: model.envelope.binding,
    cursor: model.envelope.cursor,
    subjectId,
    node,
    nodeHash: sha256Jcs(node as never),
  };
}

function fileEnvelope(model: PlanningWorkspaceModel, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'planning-file-link',
    schemaVersion: '1.0.0',
    binding: model.envelope.binding,
    cursor: model.envelope.cursor,
    sourceViewHash: model.envelope.cursor.viewHash,
    nodeId,
    path: file,
    state: 'available',
    editorUrl,
    reason: null,
    errorCode: null,
    ...overrides,
  };
}

function response(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}

function nextRevision(
  model: PlanningWorkspaceModel,
  selectedTitle?: string,
): PlanningWorkspaceModel {
  const graph = {
    ...model.graph,
    nodes: model.graph.nodes.map((node) =>
      node.id === nodeId && selectedTitle
        ? { ...node, title: selectedTitle }
        : node.id === 'SPEC-026/T-122'
          ? { ...node, title: 'Changed consumer' }
          : node,
    ),
  };
  const cursor = {
    eventHead: { sequence: 1, hash: `sha256:${'a'.repeat(64)}` },
    viewHash: sha256Jcs(graph as never),
  };
  const binding = createDashboardQueryIdentity({
    ...model.binding,
    eventHead: cursor.eventHead,
    viewHash: cursor.viewHash,
  });
  const envelope = parsePlanningGraphEnvelope({ ...model.envelope, graph, cursor }, binding);
  return { ...model, graph: envelope.graph, envelope, binding };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('shared Planning artifact detail', () => {
  it('keeps every parent, child and dependency reachable and prints no placeholder text', async () => {
    const model = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const subject = decodeURIComponent(
          String(url).split('/api/planning/detail/')[1].split('?')[0],
        );
        return response(detailEnvelope(model, body, subject));
      }),
    );
    for (const node of model.graph.nodes) {
      const detail = selectStructuralDetail(model.graph, node);
      const parts = render(
        <>
          <DetailTrace model={detail} />
          <DetailProperties
            node={node}
            detail={detail}
            sourceNode={null}
            model={model}
            origin={origin}
          />
        </>,
      );
      const hrefs = new Set(
        [...parts.container.querySelectorAll<HTMLAnchorElement>('a[href]')].map((link) =>
          link.getAttribute('href'),
        ),
      );
      for (const ref of [
        ...detail.parents,
        ...detail.children,
        ...detail.dependencies,
        ...detail.dependents,
      ]) {
        if (ref.node)
          expect(hrefs, `${node.id} -> ${ref.node.id}`).toContain(planningDetailHref(ref.node));
        else
          expect(parts.container.textContent, `${node.id} -> ${ref.reference}`).toContain(
            `${ref.reference} not found`,
          );
      }
      parts.unmount();
      if (node.type === 'spec') continue;
      const view = render(
        <PlanningArtifactDetail model={model} nodeId={node.id} origin={origin} />,
      );
      await findDetailReady(view.container);
      const text = view.container.textContent ?? '';
      for (const banned of ['Unknown', 'Not recorded', 'None declared', 'Phase 2', 'Source:'])
        expect(text, `${planningDisplayId(node)} ${banned}`).not.toContain(banned);
      expect(text, `${planningDisplayId(node)} none`).not.toMatch(/\bnone\b/u);
      view.unmount();
    }
  });

  it('waits for referenced criteria before the first verified column presentation', async () => {
    const model = fixture(['AC-reference']);
    let complete: ((value: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1) ?? '') === 'SPEC-026'
          ? pending
          : response(detailEnvelope(model)),
      ),
    );
    const view = render(
      <PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} panel />,
    );
    await screen.findByText('Loading referenced criteria…');
    expect(view.container.querySelector('.pc-detail__columns')).toBeNull();
    await act(async () => {
      if (!complete) throw new Error('The referenced detail resolver was not initialized.');
      complete(
        response(
          detailEnvelope(
            model,
            '## Acceptance Criteria\n- AC-reference: Preserve the authored parent criterion.',
            'SPEC-026',
          ),
        ),
      );
      await pending;
    });
    const criteria = await screen.findByRole('region', { name: 'Acceptance criteria' });
    expect(within(criteria).getByText('Preserve the authored parent criterion.')).toBeTruthy();
    expect(
      screen.queryByText('Referenced criterion is unavailable in the current detail.'),
    ).toBeNull();
  });

  it('retains focused verified columns and their file binding while the selected summary changes', async () => {
    const model = fixture();
    const revised = nextRevision(model, 'Changed selected artifact');
    let complete: ((value: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    let detailReads = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/file-link/')) return response(fileEnvelope(model));
      detailReads += 1;
      return detailReads === 1 ? response(detailEnvelope(model)) : pending;
    });
    vi.stubGlobal('fetch', fetcher);
    const view = render(
      <PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} panel />,
    );
    await findDetailReady(document.body);
    const columns = view.container.querySelector('.pc-detail__columns');
    const files = screen.getByRole('region', { name: 'Declared files' });
    const evidence = screen.getByRole('region', { name: 'Artifact evidence' });
    const copy = within(files).getByRole('button', { name: 'Copy path' });
    act(() => copy.focus());
    evidence.scrollTop = 86;
    view.rerender(<PlanningArtifactDetail model={revised} nodeId={nodeId} origin={origin} panel />);
    await screen.findByText('Updating verified detail…');
    expect(view.container.querySelector('.pc-detail__columns')).toBe(columns);
    expect(copy.isConnected).toBe(true);
    expect(document.activeElement).toBe(copy);
    expect(screen.getByRole('region', { name: 'Declared files' })).toBe(files);
    expect(evidence.scrollTop).toBe(86);
    fireEvent.click(within(files).getByRole('button', { name: 'Open in editor' }));
    await within(files).findByRole('link', { name: 'Launch editor' });
    const call = fetcher.mock.calls.find(([input]) => String(input).includes('/file-link/'));
    expect(new URL(String(call?.[0])).searchParams.get('sourceViewHash')).toBe(
      model.envelope.cursor.viewHash,
    );
    await act(async () => {
      if (!complete) throw new Error('The updated detail resolver was not initialized.');
      complete(response(detailEnvelope(revised)));
      await pending;
    });
    await findDetailReady(document.body);
    expect(view.container.querySelector('.pc-detail__columns')).toBe(columns);
    expect(document.activeElement).toBe(copy);
    expect(screen.getByRole('region', { name: 'Declared files' })).toBe(files);
    expect(evidence.scrollTop).toBe(86);
    expect(within(files).queryByRole('link', { name: 'Launch editor' })).toBeNull();
  });

  it('does not retain another binding’s verified columns while its detail is loading', async () => {
    const model = fixture();
    const foreign = fixture();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response(detailEnvelope(model)))
        .mockReturnValueOnce(new Promise<Response>(() => {})),
    );
    const view = render(
      <PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} panel />,
    );
    await findDetailReady(document.body);
    expect(view.container.querySelector('.pc-detail__columns')).toBeTruthy();
    view.rerender(<PlanningArtifactDetail model={foreign} nodeId={nodeId} origin={origin} panel />);
    expect(screen.getByText('Loading verified detail…')).toBeTruthy();
    expect(view.container.querySelector('.pc-detail__columns')).toBeNull();
    expect(screen.queryByText('The trace is navigable.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy path' })).toBeNull();
  });

  it.each([false, true])(
    'mounts verified criteria and file rows without waiting for visibility with panel=%s',
    async (panel) => {
      const model = fixture();
      let complete: ((value: Response) => void) | undefined;
      const pending = new Promise<Response>((resolve) => {
        complete = resolve;
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(() => pending),
      );
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          observe = vi.fn();
          unobserve = vi.fn();
          disconnect = vi.fn();
        },
      );
      const view = render(
        <PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} panel={panel} />,
      );
      expect(screen.getByText('Loading verified detail…')).toBeTruthy();
      expect(view.container.querySelector('.pc-detail__columns')).toBeNull();
      expect(view.container.querySelector('.pc-detail__files-card')).toBeNull();
      await act(async () => {
        if (!complete) throw new Error('The delayed detail resolver was not initialized.');
        complete(response(detailEnvelope(model)));
        await pending;
      });
      await findDetailReady(document.body);
      const criteria = screen.getByRole('region', { name: 'Acceptance criteria' });
      expect(within(criteria).getByText('The trace is navigable.')).toBeTruthy();
      expect(view.container.querySelector('.pc-detail__files-card')).toBeTruthy();
      const files = screen.getByRole('region', { name: 'Declared files' });
      expect(files.querySelectorAll('.pc-detail__file')).toHaveLength(1);
      expect(within(files).getByText(file)).toBeTruthy();
      expect(within(files).getByRole('button', { name: 'Copy path' })).toBeTruthy();
      expect(files.hasAttribute('tabindex')).toBe(false);
      expect(criteria.hasAttribute('data-scroll-context')).toBe(false);
      expect(screen.queryByText('Reading acceptance criteria…')).toBeNull();
    },
  );

  it('renders descriptive file declarations without Markdown delimiters', async () => {
    const model = fixture();
    const text = `${body}\n## Files\n- \`.changeset/\`: Add a release note for the change.\n`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(detailEnvelope(model, text))),
    );
    render(<PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} />);
    await findDetailReady(document.body);
    const files = screen.getByRole('region', { name: 'Declared files' });
    expect(files.textContent).not.toContain('`');
    const description = within(files).getByText('.changeset/: Add a release note for the change.');
    expect(description).toBeTruthy();
    expect(description.closest('.pc-detail__file')?.querySelector('button')).toBeNull();
  });

  it('keeps long criteria in page flow and compact file actions keyboard-operable', async () => {
    const model = fixture();
    const criteria = Array.from({ length: 12 }, (_, index) => `- Verify requirement ${index + 1}.`);
    const text = ['## Acceptance Criteria', ...criteria, '## Files', `- \`${file}\``].join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(detailEnvelope(model, text))),
    );
    const copy = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <PlanningPresentationProvider scope="compact-files" view={null} onCopy={copy}>
        <PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} />
      </PlanningPresentationProvider>,
    );
    await findDetailReady(document.body);
    const region = screen.getByRole('region', { name: 'Acceptance criteria' });
    expect(within(region).getAllByRole('listitem')).toHaveLength(12);
    expect(within(region).getByText('Verify requirement 12.')).toBeTruthy();
    expect(region.hasAttribute('data-scroll-context')).toBe(false);
    expect(region.hasAttribute('tabindex')).toBe(false);
    const files = screen.getByRole('region', { name: 'Declared files' });
    expect(files.querySelector('.pc-detail__file-hint')).toBeNull();
    const copyPath = within(files).getByRole('button', { name: 'Copy path' });
    expect(copyPath.textContent).toBe('');
    expect(within(files).getByRole('button', { name: 'Open in editor' }).textContent).toBe('');
    act(() => copyPath.focus());
    await user.keyboard('{Enter}');
    await screen.findByText('Copied', { selector: '[role="status"] > strong' });
    expect(copy).toHaveBeenCalledExactlyOnceWith(file);
  });

  it.each([false, true])(
    'renders verified trace, criteria, files and the derived status with panel=%s',
    async (panel) => {
      const model = fixture();
      const fetcher = vi.fn(async () => response(detailEnvelope(model)));
      vi.stubGlobal('fetch', fetcher);
      const view = render(
        <PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} panel={panel} />,
      );
      await findDetailReady(document.body);
      expect(view.container.textContent).toContain('Declared files can be opened safely.');
      expect(view.container.textContent?.toLowerCase()).toContain('blocked');
      expect(view.container.querySelector('header')?.textContent).not.toContain('Source:');
      expect(view.container.querySelector('header [data-status="blocked"]')).toBeTruthy();
      expect(view.container.textContent).toContain('T-999');
      expect(view.container.textContent).toMatch(/unresolved|not in|missing/iu);
      expect(view.container.textContent).toContain(file);
      const properties = view.container.querySelector('.pc-detail__properties');
      expect(properties).toBeTruthy();
      const property = (label: string) =>
        [...(properties?.querySelectorAll('dt') ?? [])].find((term) => term.textContent === label)
          ?.nextElementSibling;
      expect(property('Status')).toBeUndefined();
      expect(property('Depends on')?.textContent).toContain('T-120');
      expect(property('Depends on')?.textContent).toContain('T-999');
      expect(property('Unblocks')?.textContent).toContain('T-122');
      expect(property('Story')?.textContent).toContain('US-104');
      expect(property('Spec')?.textContent).toContain('SPEC-026');
      expect(property('Created')?.textContent).toBe('2 Sept 2026');
      expect(property('Updated')).toBeUndefined();
      expect(view.container.querySelector('.pc-detail__updated')?.textContent).toBe(
        'Updated 12 Sept',
      );
      expect(property('File')?.textContent).toBe(sourcePath);
      expect(screen.queryByRole('heading', { name: 'History', exact: true })).toBeNull();
      const hrefs = [...view.container.querySelectorAll<HTMLAnchorElement>('a[href]')].map((link) =>
        link.getAttribute('href'),
      );
      expect(hrefs).toContain('#/detail/SPEC-026%2FUS-104');
      expect(hrefs).toContain('#/detail/BL-026');
      expect(hrefs).toContain('#/detail/SPEC-026');
      expect(hrefs).toContain('#/detail/SPEC-026%2FT-122');
      expect(hrefs).toContain('#/detail/SPEC-026%2FT-120');
      expect(
        screen.getByRole('link', { name: 'https://example.com/evidence' }).getAttribute('href'),
      ).toBe('https://example.com/evidence');
      expect(screen.getByRole('button', { name: /copy link/iu })).toBeTruthy();
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it('renders the hostile Markdown description as text while preserving safe links', async () => {
    const model = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(detailEnvelope(model))),
    );
    const view = render(<PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} />);
    await findDetailReady(document.body);
    expect(screen.queryByText('Verified detail body.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    await screen.findByText('Verified detail body.');
    expect(view.container.querySelector('script, img, iframe')).toBeNull();
    expect(view.container.querySelector('a[href^="javascript:"], a[href^="data:"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'reference' }).getAttribute('href')).toBe(
      'https://example.com/reference',
    );
    expect(view.container.textContent).toContain('<script>window.hostile=true</script>');
  });

  it('hides an unverified body, surfaces the failure and retries the read', async () => {
    const model = fixture();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          ...detailEnvelope(model, 'UNTRUSTED_BODY'),
          nodeHash: `sha256:${'0'.repeat(64)}`,
        }),
      )
      .mockResolvedValueOnce(response(detailEnvelope(model)));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} />);
    await screen.findByText(/detail could not be verified/iu);
    expect(view.container.textContent).not.toContain('UNTRUSTED_BODY');
    fireEvent.click(screen.getByRole('button', { name: /try again/iu }));
    await findDetailReady(document.body);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('surfaces blocked copy with the exact path and a manual fallback', async () => {
    const model = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(detailEnvelope(model))),
    );
    const copy = vi.fn(async () => {
      throw new Error('Clipboard denied');
    });
    render(
      <PlanningPresentationProvider scope="copy-denied" view={null} onCopy={copy}>
        <PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} />
      </PlanningPresentationProvider>,
    );
    await findDetailReady(document.body);
    fireEvent.click(
      within(screen.getByLabelText('Declared files')).getByRole('button', { name: 'Copy path' }),
    );
    await screen.findByText('Copy was blocked');
    expect(copy).toHaveBeenCalledWith(file);
    expect(screen.getByText('Select this text and copy it manually.')).toBeTruthy();
  });

  it('copies a canonical full item link without opening a new destination', async () => {
    const model = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(detailEnvelope(model))),
    );
    const copy = vi.fn(async () => {});
    render(
      <PlanningPresentationProvider scope="copy-link" view={null} onCopy={copy}>
        <PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} />
      </PlanningPresentationProvider>,
    );
    await findDetailReady(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await screen.findByText('Copied', { selector: '[role="status"] > strong' });
    expect(copy).toHaveBeenCalledWith(
      `${window.location.href.split('#')[0]}#/detail/SPEC-026%2FT-121`,
    );
  });

  it('selects trace steps and reference chips, copies the selection command and opens on Enter or double-click', async () => {
    const model = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(detailEnvelope(model))),
    );
    const copy = vi.fn(async () => {});
    const start = window.location.hash;
    const view = render(
      <PlanningPresentationProvider scope="detail-select" view={null} onCopy={copy}>
        <PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} />
      </PlanningPresentationProvider>,
    );
    await findDetailReady(view.container);
    const consumer = model.graph.nodes.find((node) => node.id === 'SPEC-026/T-122');
    const story = model.graph.nodes.find((node) => node.id === 'SPEC-026/US-104');
    if (!consumer || !story) throw new Error('Missing selection fixture');
    const trace = screen.getByRole('list', { name: 'Artifact lineage' });
    const step = within(trace).getByRole('link', { name: /T-122/u });
    expect(screen.queryByRole('region', { name: 'Selected items' })).toBeNull();
    fireEvent.click(step, { detail: 1 });
    expect(step.dataset.selected).toBe('true');
    expect(window.location.hash).toBe(start);
    const bar = screen.getByRole('region', { name: 'Selected items' });
    expect(within(bar).getByText(boardSelectionItems(consumer)[0].command)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'c' });
    await waitFor(() =>
      expect(copy).toHaveBeenCalledExactlyOnceWith(boardSelectionItems(consumer)[0].command),
    );
    const chip = within(screen.getByRole('region', { name: 'Story' })).getByRole('link');
    fireEvent.keyDown(chip, { key: ' ' });
    expect(chip.dataset.selected).toBe('true');
    expect(step.dataset.selected).toBeUndefined();
    expect(
      within(screen.getByRole('region', { name: 'Selected items' })).getByText(
        boardSelectionItems(story)[0].command,
      ),
    ).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Selected items' })).toBeNull();
    fireEvent.doubleClick(step);
    expect(window.location.hash).toBe(planningDetailHref(consumer));
    window.location.hash = start;
    fireEvent.click(step, { detail: 0 });
    await waitFor(() => expect(window.location.hash).toBe(planningDetailHref(consumer)));
    window.location.hash = start;
    view.unmount();
    const panel = render(
      <PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} panel />,
    );
    await findDetailReady(panel.container);
    const panelStep = within(
      within(panel.container).getByRole('list', { name: 'Artifact lineage' }),
    ).getByRole('link', { name: /T-122/u });
    panelStep.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(panelStep, { detail: 1 });
    expect(panelStep.dataset.selected).toBeUndefined();
    expect(screen.queryByRole('region', { name: 'Selected items' })).toBeNull();
  });

  it('docks the next step above the phone navigation until an item is selected', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: /max-width: (599|899|1199)px/u.test(query),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const model = fixture();
    const consumerId = 'SPEC-026/T-122';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(detailEnvelope(model, body, consumerId))),
    );
    const view = render(
      <PlanningPresentationProvider scope="detail-dock" view={null}>
        <PlanningArtifactDetail model={model} nodeId={consumerId} origin={origin} />
      </PlanningPresentationProvider>,
    );
    await findDetailReady(view.container);
    const article = view.container.querySelector<HTMLElement>('.pc-detail__artifact');
    expect(article?.dataset.compact).toBe('true');
    const dock = screen.getByRole('region', { name: 'Next step command' });
    const blocker = model.graph.nodes.find((node) => node.id === nodeId);
    if (!blocker) throw new Error('Missing blocker fixture');
    expect(within(dock).getByText(planningContinuation(blocker) ?? '')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Copy command' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
    fireEvent.click(
      within(screen.getByRole('list', { name: 'Artifact lineage' })).getByRole('link', {
        name: /SPEC-026 /u,
      }),
      { detail: 1 },
    );
    expect(screen.queryByRole('region', { name: 'Next step command' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Selected items' })).toBeTruthy();
  });

  it('resolves a declared file through the bound GET before exposing its trusted editor URI', async () => {
    const model = fixture();
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      response(String(input).includes('/file-link/') ? fileEnvelope(model) : detailEnvelope(model)),
    );
    vi.stubGlobal('fetch', fetcher);
    render(<PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} />);
    await findDetailReady(document.body);
    expect(screen.queryByRole('link', { name: 'Launch editor' })).toBeNull();
    fireEvent.click(
      within(screen.getByLabelText('Declared files')).getByRole('button', {
        name: 'Open in editor',
      }),
    );
    const launch = await screen.findByRole('link', { name: 'Launch editor' });
    expect(launch.getAttribute('href')).toBe(editorUrl);
    const call = fetcher.mock.calls.find(([input]) => String(input).includes('/file-link/'));
    expect(call).toBeTruthy();
    const url = new URL(String(call?.[0]));
    expect(url.pathname).toBe('/api/planning/file-link/SPEC-026%2FT-121');
    expect(url.searchParams.get('file')).toBe(file);
    expect(url.searchParams.get('sourceViewHash')).toBe(model.envelope.cursor.viewHash);
  });

  it('refuses a hostile editor URI and leaves a copy fallback visible', async () => {
    const model = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        response(
          String(input).includes('/file-link/')
            ? fileEnvelope(model, { editorUrl: 'javascript:alert(1)' })
            : detailEnvelope(model),
        ),
      ),
    );
    const view = render(<PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} />);
    await findDetailReady(document.body);
    fireEvent.click(
      within(screen.getByLabelText('Declared files')).getByRole('button', {
        name: 'Open in editor',
      }),
    );
    await screen.findByText(/editor link could not be verified/iu);
    expect(screen.queryByRole('link', { name: 'Launch editor' })).toBeNull();
    expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Copy path' }).length).toBeGreaterThan(0);
  });

  it.each([
    {
      state: 'unavailable',
      reason: 'The selected artifact does not declare this file.',
      errorCode: null,
      path: null,
    },
    {
      state: 'error',
      reason: 'The target could not be inspected.',
      errorCode: 'EACCES',
      path: file,
    },
  ])('surfaces a safe $state file result without exposing a launch link', async (outcome) => {
    const model = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        response(
          String(input).includes('/file-link/')
            ? fileEnvelope(model, { ...outcome, editorUrl: null })
            : detailEnvelope(model),
        ),
      ),
    );
    render(<PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} />);
    await findDetailReady(document.body);
    const files = within(screen.getByLabelText('Declared files'));
    fireEvent.click(files.getByRole('button', { name: 'Open in editor' }));
    await files.findByText(outcome.reason);
    expect(files.queryByRole('link', { name: 'Launch editor' })).toBeNull();
    expect(files.getByRole('button', { name: 'Copy path' })).toBeTruthy();
  });

  it('ignores a file-link response issued before a graph revision change', async () => {
    const model = fixture();
    const revised = nextRevision(model);
    let resolveFile!: (value: Response) => void;
    const pendingFile = new Promise<Response>((resolve) => {
      resolveFile = resolve;
    });
    let detailReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/file-link/')) return pendingFile;
        detailReads += 1;
        return response(detailEnvelope(detailReads === 1 ? model : revised));
      }),
    );
    const view = render(<PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} />);
    await findDetailReady(document.body);
    fireEvent.click(
      within(screen.getByLabelText('Declared files')).getByRole('button', {
        name: 'Open in editor',
      }),
    );
    view.rerender(<PlanningArtifactDetail model={revised} nodeId={nodeId} origin={origin} />);
    await waitFor(() => expect(detailReads).toBe(2));
    await act(async () => {
      resolveFile(response(fileEnvelope(model)));
      await pendingFile;
    });
    expect(screen.queryByRole('link', { name: 'Launch editor' })).toBeNull();
    expect(view.container.textContent).toContain('Changed consumer');
  });

  it('ignores an older detail read that finishes after the current revision', async () => {
    const model = fixture();
    const revised = nextRevision(model);
    let resolveOld!: (value: Response) => void;
    const olderRead = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(olderRead)
      .mockResolvedValueOnce(response(detailEnvelope(revised)));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    view.rerender(<PlanningArtifactDetail model={revised} nodeId={nodeId} origin={origin} />);
    await findDetailReady(document.body);
    await act(async () => {
      resolveOld(response(detailEnvelope(model, 'OLDER_BODY_MUST_NOT_REPLACE_CURRENT')));
      await olderRead;
    });
    expect(view.container.textContent).toContain('The trace is navigable.');
    expect(view.container.textContent).not.toContain('OLDER_BODY_MUST_NOT_REPLACE_CURRENT');
  });
});
