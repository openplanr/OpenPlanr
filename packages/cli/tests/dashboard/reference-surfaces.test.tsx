// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:7473"}

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsolePage } from '../../../../apps/dashboard/src/features/planning/ConsolePage.js';
import {
  CommandPalette,
  SearchWorkspace,
} from '../../../../apps/dashboard/src/features/search/CommandPalette.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { PlanningPresentationProvider } from '../../../../apps/dashboard/src/lib/routing/planning-presentation.js';
import { buildPremiumDashboardFixture } from './fixtures/premium-dashboard-fixtures.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const fixture = buildPremiumDashboardFixture('artboard');
const operateBinding = createDashboardQueryIdentity({
  productArea: 'operate',
  route: '#/operate/today',
  actorId: 'reference-reader',
  projectId: `sha256:${'a'.repeat(64)}`,
  scopeId: 'project',
  domainId: 'software-delivery',
  domainVersion: '2.0.0',
  cycleId: 'cycle-current',
  subjectId: null,
  eventHead: { sequence: 1, hash: `sha256:${'b'.repeat(64)}` },
  viewHash: `sha256:${'c'.repeat(64)}`,
  generation: 1,
});

describe('Console reference interactions', () => {
  it('filters invocations across catalogues while preserving group explanations and safe alternatives', async () => {
    const user = userEvent.setup();
    render(<ConsolePage />);
    expect(
      screen.getByText('Shape intent into work, review it, implement it, and land it.'),
    ).not.toBeNull();
    const filter = screen.getByRole('textbox', { name: 'Filter skills and commands' });
    await user.type(filter, '/planr:sprint');
    expect(screen.getByText('1 shown')).not.toBeNull();
    expect(screen.getByText('/planr:sprint')).not.toBeNull();
    expect(
      screen.getByText('Shape intent into work, review it, implement it, and land it.'),
    ).not.toBeNull();
    expect(screen.queryByText('/planr:ship')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'CLI commands' }));
    expect(screen.getByText('No catalogue entries match this filter')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect((filter as HTMLInputElement).value).toBe('');
    expect(
      screen.getByText(
        'Replace placeholders with exact artifact identities. Run commands from the project folder.',
      ),
    ).not.toBeNull();
    expect(
      screen.getByText(
        /Scoped task status writers are unavailable; read the parent specification instead/,
      ),
    ).not.toBeNull();
    expect(screen.getByText('openplanr status <spec-id> --md')).not.toBeNull();
    await user.type(filter, '--choice-hash');
    expect(screen.getByText('1 shown')).not.toBeNull();
    expect(screen.getByText('operate-decide')).not.toBeNull();
    expect(
      screen.getByText(
        'Supplemental CLI templates. Existing ownership, preview, confirmation, and receipt checks still apply.',
      ),
    ).not.toBeNull();
    expect(screen.getByRole('link', { name: '#/operate/cycles' }).getAttribute('href')).toBe(
      '#/operate/cycles',
    );
  });

  it('copies exact invocation bytes once while pending and reports completion', async () => {
    const user = userEvent.setup();
    let finish: (() => void) | undefined;
    const onCopy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <PlanningPresentationProvider scope="console-pending" view={null} onCopy={onCopy}>
        <ConsolePage />
      </PlanningPresentationProvider>,
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Filter skills and commands' }),
      '/planr:sprint',
    );
    await user.click(screen.getByRole('button', { name: 'Copy command' }));
    const pending = screen.getByRole('button', { name: 'Copying' }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect(pending.getAttribute('aria-busy')).toBe('true');
    await user.click(pending);
    expect(onCopy).toHaveBeenCalledExactlyOnceWith('/planr:sprint');
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
    await act(async () => {
      finish?.();
    });
    expect(screen.getByRole('button', { name: 'Copied' })).not.toBeNull();
    expect(screen.getByRole('status').textContent).toContain('/planr:sprint');
  });

  it('honors disabled single-letter shortcuts and preserves manual copy after denial', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn(async () => {
      throw new Error('clipboard unavailable');
    });
    render(
      <PlanningPresentationProvider
        scope="console-denial"
        view={null}
        onCopy={onCopy}
        singleLetters={false}
      >
        <ConsolePage />
      </PlanningPresentationProvider>,
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Filter skills and commands' }),
      '/planr:sprint',
    );
    const copy = screen.getByRole('button', { name: 'Copy command' });
    expect(copy.getAttribute('aria-keyshortcuts')).toBeNull();
    copy.focus();
    await user.keyboard('c');
    expect(onCopy).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onCopy).toHaveBeenCalledExactlyOnceWith('/planr:sprint');
    expect(screen.getByRole('alert').textContent).toContain('Copy was blocked');
    expect(screen.getByText('Select the command and copy it manually.')).not.toBeNull();
    expect(screen.getAllByText('/planr:sprint').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
  });
});

describe('Full Search reference interactions', () => {
  it('copies the selected command from the query with ArrowDown and Enter', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn(async () => undefined);
    render(<SearchWorkspace initialQuery="@command dashboard" onCopy={onCopy} />);
    const query = screen.getByRole('textbox', { name: 'Search query' });
    query.focus();
    await user.keyboard('{ArrowDown}');
    expect(
      screen.getByRole('button', { name: /Open the local dashboard/ }).getAttribute('aria-current'),
    ).toBe('true');
    expect(
      screen
        .getByRole('button', { name: /Open the local dashboard/ })
        .getAttribute('data-copy-command'),
    ).toBe('true');
    await user.keyboard('{Enter}');
    expect(onCopy).toHaveBeenCalledExactlyOnceWith('openplanr dashboard');
    expect(screen.getByRole('status').textContent).toContain('Command copied.');
    expect(
      (screen.getByRole('textbox', { name: 'Command to copy manually' }) as HTMLInputElement).value,
    ).toBe('openplanr dashboard');
  });

  it('retains the focused canonical result and scroll when an immutable snapshot inserts another match', async () => {
    const user = userEvent.setup();
    const selectedId = 'SPEC-026/T-112';
    const oldNodes = fixture.graph.nodes.filter((node) =>
      ['SPEC-026/T-109', selectedId, 'SPEC-026/T-113'].includes(node.id),
    );
    const view = render(
      <SearchWorkspace initialQuery="@task" sources={{ planningNodes: oldNodes }} />,
    );
    const results = screen.getByRole('list', { name: 'Planning work' });
    const selected = within(results).getByRole('button', {
      name: /Findings contract, consent and filing guidance/,
    });
    await act(async () => {
      selected.focus();
    });
    expect(selected.getAttribute('aria-current')).toBe('true');
    const scroller = view.container.querySelector('.pc-palette__results');
    if (!scroller) throw new Error('Search results scroller missing');
    scroller.scrollTop = 120;
    const inserted = fixture.graph.nodes.find((node) => node.id === 'SPEC-026/T-110');
    if (!inserted) throw new Error('Artboard task missing');
    const refreshed = Object.freeze([
      inserted,
      ...oldNodes.map((node) =>
        Object.freeze({
          ...node,
          frontmatter: Object.freeze({ ...node.frontmatter, updated: '2026-10-19' }),
        }),
      ),
    ]);
    view.rerender(<SearchWorkspace initialQuery="@task" sources={{ planningNodes: refreshed }} />);

    await waitFor(() => expect(document.activeElement).toBe(selected));
    expect(selected.getAttribute('aria-current')).toBe('true');
    expect(selected.getAttribute('data-canonical-id')).toBe(selectedId);
    expect(selected.getAttribute('data-search-result')).toBe(`planning:${selectedId}`);
    expect(scroller.scrollTop).toBe(120);
    expect(
      screen
        .getByRole('list', { name: 'Planning work' })
        .querySelectorAll('button[data-search-result]'),
    ).toHaveLength(4);
    expect(
      within(screen.getByRole('list', { name: 'Planning work' })).getAllByRole('button', {
        name: /^Copy command for /u,
      }),
    ).toHaveLength(4);
    const query = screen.getByRole('textbox', { name: 'Search query' });
    expect((query as HTMLInputElement).value).toBe('@task');
    await user.click(query);
    await user.keyboard('{Enter}');
    expect(window.location.hash).toBe('#/detail/SPEC-026%2FT-112');
  });

  it('explains no matches and offline scope while keeping the validated Planning snapshot searchable', async () => {
    const user = userEvent.setup();
    render(
      <SearchWorkspace
        sources={{ planningNodes: fixture.graph.nodes }}
        initialQuery="zzzzzzzzzzzzzzzzzzzzzzzz"
        connectionState="offline"
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('No matches.');
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('last validated Planning snapshot');
    expect(within(note).getByText('openplanr dashboard')).not.toBeNull();
    const query = screen.getByRole('textbox', { name: 'Search query' });
    await user.clear(query);
    await user.type(query, 'SPEC-014');
    expect(
      screen.getByRole('button', { name: /Design-to-Delivery Handoff Center/ }),
    ).not.toBeNull();
  });
});

describe.each(['workspace', 'palette'] as const)('Operate search failure in %s', (surface) => {
  it.each(['network rejection', 'HTTP 500', 'invalid owner envelope'] as const)(
    'surfaces %s safely and retains local matches without exposing server details',
    async (failure) => {
      const privateDetail = '/Users/owner/private/search-token';
      const fetcher = vi.fn<typeof fetch>(async () => {
        if (failure === 'network rejection') throw new Error(privateDetail);
        return new Response(JSON.stringify({ error: privateDetail }), {
          status: failure === 'HTTP 500' ? 500 : 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetcher);
      const props = {
        initialQuery: 'handoff',
        sources: { planningNodes: fixture.graph.nodes },
        connectionState: 'connected',
        operateBindings: [operateBinding],
        preferredOperateCycleId: operateBinding.cycleId,
      };
      const view = render(
        surface === 'workspace' ? (
          <SearchWorkspace {...props} />
        ) : (
          <CommandPalette open onClose={() => undefined} {...props} />
        ),
      );
      await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      const status = await screen.findByRole('status', { name: 'Operate search status' });
      expect(status.textContent).toContain('Operate search could not be read.');
      expect(status.textContent).toContain(
        'Local destinations and Planning results remain available.',
      );
      expect(
        screen.getByRole('button', { name: /Design-to-Delivery Handoff Center/ }),
      ).not.toBeNull();
      expect(view.container.innerHTML).not.toContain(privateDetail);
      expect(fetcher.mock.calls[0]?.[0]).toBeInstanceOf(URL);
    },
  );
});
