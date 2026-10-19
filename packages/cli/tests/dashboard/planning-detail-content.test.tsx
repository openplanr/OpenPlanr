// @vitest-environment jsdom

import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanningArtifactDetail } from '../../../../apps/dashboard/src/features/planning/DetailPage.js';
import {
  type PlanningGraph,
  type PlanningNode,
  parsePlanningGraphEnvelope,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import type { PlanningWorkspaceModel } from '../../../../apps/dashboard/src/features/planning/planning-workspace.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { PlanningPresentationProvider } from '../../../../apps/dashboard/src/lib/routing/planning-presentation.js';

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

function fixture() {
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

function detailEnvelope(model: PlanningWorkspaceModel, text = body) {
  const summary = model.graph.nodes.find((entry) => entry.id === nodeId) as PlanningNode;
  const node = { ...summary, body: text };
  return {
    kind: 'planning-detail',
    schemaVersion: '1.0.0',
    binding: model.envelope.binding,
    cursor: model.envelope.cursor,
    subjectId: nodeId,
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

function nextRevision(model: PlanningWorkspaceModel): PlanningWorkspaceModel {
  const graph = {
    ...model.graph,
    nodes: model.graph.nodes.map((node) =>
      node.id === 'SPEC-026/T-122' ? { ...node, title: 'Changed consumer' } : node,
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
  it.each([false, true])(
    'renders verified trace, criteria, files and both statuses with panel=%s',
    async (panel) => {
      const model = fixture();
      const fetcher = vi.fn(async () => response(detailEnvelope(model)));
      vi.stubGlobal('fetch', fetcher);
      const view = render(
        <PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} panel={panel} />,
      );
      await screen.findByText('Detail verified against the current planning snapshot.');
      expect(view.container.textContent).toContain('Declared files can be opened safely.');
      expect(view.container.querySelector('[data-status="pending"]')?.textContent).toBe('Pending');
      expect(view.container.textContent?.toLowerCase()).toContain('blocked');
      expect(view.container.querySelector('header')?.textContent).toContain('Source: Pending');
      expect(view.container.querySelector('header [data-status="blocked"]')).toBeTruthy();
      expect(view.container.textContent).toContain('T-999');
      expect(view.container.textContent).toMatch(/unresolved|not in|missing/iu);
      expect(view.container.textContent).toContain(file);
      expect(view.container.textContent).toContain('History');
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

  it('renders hostile Markdown as text while preserving safe links and raw source', async () => {
    const model = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(detailEnvelope(model))),
    );
    const view = render(<PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} />);
    await screen.findByText('Detail verified against the current planning snapshot.');
    fireEvent.click(screen.getByText('Read Markdown source'));
    await screen.findByText('Verified detail body.');
    expect(view.container.querySelector('script, img, iframe')).toBeNull();
    expect(view.container.querySelector('a[href^="javascript:"], a[href^="data:"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'reference' }).getAttribute('href')).toBe(
      'https://example.com/reference',
    );
    expect(screen.getByText('Read Markdown source').closest('details')?.open).toBe(true);
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
    fireEvent.click(screen.getByRole('button', { name: /retry/iu }));
    await screen.findByText('Detail verified against the current planning snapshot.');
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
    await screen.findByText('Detail verified against the current planning snapshot.');
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
    await screen.findByText('Detail verified against the current planning snapshot.');
    fireEvent.click(screen.getByRole('button', { name: 'Copy link to item' }));
    await screen.findByText('Copied');
    expect(copy).toHaveBeenCalledWith(
      `${window.location.href.split('#')[0]}#/detail/SPEC-026%2FT-121`,
    );
  });

  it('resolves a declared file through the bound GET before exposing its trusted editor URI', async () => {
    const model = fixture();
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      response(String(input).includes('/file-link/') ? fileEnvelope(model) : detailEnvelope(model)),
    );
    vi.stubGlobal('fetch', fetcher);
    render(<PlanningArtifactDetail model={model} nodeId={nodeId} origin={origin} />);
    await screen.findByText('Detail verified against the current planning snapshot.');
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
    await screen.findByText('Detail verified against the current planning snapshot.');
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
    await screen.findByText('Detail verified against the current planning snapshot.');
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
    await screen.findByText('Detail verified against the current planning snapshot.');
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
    await screen.findByText('Detail verified against the current planning snapshot.');
    await act(async () => {
      resolveOld(response(detailEnvelope(model, 'OLDER_BODY_MUST_NOT_REPLACE_CURRENT')));
      await olderRead;
    });
    expect(view.container.textContent).toContain('The trace is navigable.');
    expect(view.container.textContent).not.toContain('OLDER_BODY_MUST_NOT_REPLACE_CURRENT');
  });
});
