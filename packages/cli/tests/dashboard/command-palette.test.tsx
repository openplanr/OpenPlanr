// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DASHBOARD_COMMAND_PALETTE_SHORTCUT } from '../../../../apps/dashboard/src/app/router.js';
import type { PlanningModelNode } from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import {
  CommandPalette,
  SearchWorkspace,
} from '../../../../apps/dashboard/src/features/search/CommandPalette.js';
import { SearchResults } from '../../../../apps/dashboard/src/features/search/SearchResults.js';
import {
  buildDashboardSearchIndex,
  type DashboardSearchHit,
  queryDashboardSearchIndex,
  queryUnsupportedPlanningIdentities,
  searchHitDisplayId,
} from '../../../../apps/dashboard/src/features/search/search-index.js';
import { createSearchKeyNav } from '../../../../apps/dashboard/src/features/search/search-key-nav.js';
import { useInspectorStore } from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import { PlanningPresentationProvider } from '../../../../apps/dashboard/src/lib/routing/planning-presentation.js';
import { parsePlanningViewToken } from '../../../../apps/dashboard/src/lib/routing/planning-view-codec.js';
import { buildPremiumDashboardFixture } from './fixtures/premium-dashboard-fixtures.js';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const PRODUCTION_SOURCE = [
  'CommandPalette.tsx',
  'SearchResults.tsx',
  'search-index.ts',
  'search-key-nav.ts',
]
  .map((file) =>
    readFileSync(
      resolve(TEST_ROOT, '../../../../apps/dashboard/src/features/search', file),
      'utf8',
    ),
  )
  .join('\n');
const PALETTE_STYLES = readFileSync(
  resolve(TEST_ROOT, '../../../../apps/dashboard/src/features/search/command-palette.css'),
  'utf8',
);
const PRIVATE_MARKER = 'private-search-marker-must-not-index';

const planningNodes: readonly PlanningModelNode[] = Object.freeze([
  Object.freeze({
    id: 'SPEC-020',
    type: 'spec',
    title: 'Unified dashboard',
    status: 'in-progress',
    frontmatter: Object.freeze({ id: 'SPEC-020' }),
  }),
  Object.freeze({
    id: 'SPEC-020/US-013',
    type: 'story',
    title: 'Callable search',
    status: 'outstanding',
    frontmatter: Object.freeze({ id: 'US-013', specId: 'SPEC-020' }),
  }),
  Object.freeze({
    id: 'bad\ud800id',
    type: 'story',
    title: 'Unsupported route identity',
    status: 'outstanding',
    frontmatter: Object.freeze({ id: 'bad\ud800id' }),
  }),
]);

const sources = Object.freeze({
  planningNodes,
  operateResults: [
    {
      kind: 'evidence',
      subjectId: 'evidence-available',
      title: 'Evidence evidence-available',
      summary: 'operate-artifact · supported',
      state: 'current',
      deepLink: '#/operate/evidence/evidence-available',
    },
    {
      kind: 'evidence',
      subjectId: 'evidence-restricted',
      title: 'restricted body',
      summary: PRIVATE_MARKER,
      state: 'restricted',
      accessState: 'restricted',
      deepLink: '#/operate/evidence/evidence-restricted',
    },
  ],
});

function hitsFor(term: string): readonly DashboardSearchHit[] {
  return queryDashboardSearchIndex(buildDashboardSearchIndex(sources), term);
}

describe('command palette and callable search UI', () => {
  it('exports the documented keyboard shortcut contract', () => {
    expect(DASHBOARD_COMMAND_PALETTE_SHORTCUT).toBe('Meta+K Control+K');
  });

  it('groups access-safe hits and renders unsupported identities as non-clickable rows', () => {
    const index = buildDashboardSearchIndex(sources);
    const hits = queryDashboardSearchIndex(index, 'Callable');
    const unsupported = queryUnsupportedPlanningIdentities(index, 'Unsupported');
    const html = renderToStaticMarkup(
      <SearchResults
        hits={hits}
        unsupported={unsupported}
        activeHref={hits[0]?.href ?? null}
        listId="test-search"
        onSelect={() => undefined}
      />,
    );
    expect(html).toContain('Nodes');
    expect(html).toContain('Callable search');
    expect(html).toContain('Unavailable destinations');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain(PRIVATE_MARKER);
  });

  it('moves the keyboard cursor through results without wrapping past bounds', () => {
    const hits = hitsFor('Unified');
    const nav = createSearchKeyNav(hits).moveDown().moveDown().moveUp();
    expect(nav.getActive()?.title).toBe(hits[0]?.title);
    expect(createSearchKeyNav(hits).moveUp().activeIndex).toBe(-1);
  });

  it('opens, filters, and selects a destination from the command palette', () => {
    let closed = false;
    render(
      <CommandPalette
        open
        onClose={() => {
          closed = true;
        }}
        sources={sources}
      />,
    );
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'Callable' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(closed).toBe(true);
  });

  it('filters each supported artifact type and views through the query prefix', () => {
    const typedNodes: readonly PlanningModelNode[] = [
      'spec',
      'story',
      'task',
      'backlog',
      'adr',
      'sprint',
    ].map((type, index) => ({
      id: `fixture-${index}`,
      type: type as PlanningModelNode['type'],
      title: 'Shared matching title',
      status: 'outstanding',
      frontmatter: {},
    }));
    const index = buildDashboardSearchIndex({ planningNodes: typedNodes });
    for (const type of ['spec', 'story', 'task', 'backlog', 'adr', 'sprint']) {
      expect(queryDashboardSearchIndex(index, `@${type} Shared`).map((hit) => hit.kind)).toEqual([
        type,
      ]);
      expect(queryDashboardSearchIndex(index, `@${type}`).map((hit) => hit.kind)).toEqual([type]);
    }
    expect(queryDashboardSearchIndex(index, '@view').every((hit) => hit.source === 'route')).toBe(
      true,
    );
    expect(queryDashboardSearchIndex(index, '@view').length).toBeGreaterThan(0);
    expect(queryDashboardSearchIndex(index, '@command').map((hit) => hit.source)).toEqual([
      'command',
      'command',
      'command',
    ]);
    expect(
      queryUnsupportedPlanningIdentities(buildDashboardSearchIndex(sources), '@story Unsupported'),
    ).toHaveLength(1);
    expect(
      queryUnsupportedPlanningIdentities(buildDashboardSearchIndex(sources), '@task Unsupported'),
    ).toEqual([]);
  });

  it('switches type chips without losing the search term or opening the selected result', () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    const subject = render(
      <CommandPalette
        open
        onClose={onClose}
        onNavigate={onNavigate}
        initialQuery="Unified"
        sources={{
          planningNodes: [
            planningNodes[0],
            {
              ...planningNodes[0],
              id: 'BL-001',
              type: 'backlog',
              title: 'Unified backlog',
              frontmatter: { id: 'BL-001' },
            },
          ],
        }}
      />,
    );
    const filters = screen.getByRole('group', { name: 'Filter search results' });
    expect(filters.closest('.pc-palette__input-row')).toBeTruthy();
    const input = screen.getByRole<HTMLInputElement>('searchbox');
    expect(within(filters).getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(within(filters).getByRole('button', { name: 'BL' }));
    expect(input.value).toBe('@backlog Unified');
    expect(document.activeElement).toBe(input);
    expect(subject.container.querySelectorAll('[data-search-result]')).toHaveLength(1);
    expect(
      subject.container.querySelector('[data-search-result]')?.getAttribute('data-canonical-id'),
    ).toBe('BL-001');
    expect(within(filters).getByRole('button', { name: 'BL' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(within(filters).getByRole('button', { name: 'SPEC' }));
    expect(input.value).toBe('@spec Unified');
    expect(
      subject.container.querySelector('[data-search-result]')?.getAttribute('data-canonical-id'),
    ).toBe('SPEC-020');
    fireEvent.click(within(filters).getByRole('button', { name: 'All' }));
    expect(input.value).toBe('Unified');
    expect(subject.container.querySelectorAll('[data-canonical-id]')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Views' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Commands' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('retains filtered Views and verified Commands when matching Nodes fill the result limit', () => {
    const index = buildDashboardSearchIndex({
      planningNodes: Array.from({ length: 24 }, (_, index) => ({
        ...planningNodes[0],
        id: `SPEC-${String(index + 1).padStart(3, '0')}`,
        title: 'Findings contract',
        frontmatter: { id: `SPEC-${String(index + 1).padStart(3, '0')}` },
      })),
    });
    const hits = queryDashboardSearchIndex(index, 'findings');
    expect(hits).toHaveLength(20);
    expect(hits[0].id).toBe('planning:SPEC-001');
    const view = hits.find((hit) => hit.source === 'route');
    if (!view || view.href === null) throw new Error('Expected the filtered List destination');
    const token = new URLSearchParams(view.href.split('?')[1]).get('v');
    expect(parsePlanningViewToken(token ?? '')?.filters.query).toBe('findings');
    expect(hits.find((hit) => hit.source === 'command')).toMatchObject({
      command: 'openplanr status SPEC-001 --md',
      href: null,
    });
    expect(queryDashboardSearchIndex(index, '@command status')).toMatchObject([
      { source: 'command', command: 'openplanr status --md', href: null },
    ]);
  });

  it('sizes standalone result IDs from artifact identities when authored IDs contain slugs or titles', () => {
    const id =
      'BL-431-dashboard-needs-a-complete-artifact-title-without-using-the-file-slug-as-the-display-id';
    const title = 'A complete artifact title that must not determine the identity column width';
    for (const authored of [id, title]) {
      const scoped = {
        planningNodes: [
          {
            ...planningNodes[0],
            id,
            title,
            type: 'backlog' as const,
            frontmatter: { id: authored },
          },
        ],
      };
      const hits = queryDashboardSearchIndex(buildDashboardSearchIndex(scoped), 'complete');
      const hit = hits.find((entry) => entry.source === 'planning');
      if (!hit) throw new Error('Expected a Planning search result');
      expect(searchHitDisplayId(hit, scoped)).toBe('BL-431');
      const subject = render(
        <SearchResults
          hits={hits}
          activeHref={null}
          listId="actual-ids"
          onSelect={() => undefined}
        />,
      );
      const result = subject.container.querySelector('[data-canonical-id]');
      expect(result?.querySelector('.pc-artifact-tag')?.textContent).toBe('BL-431');
      expect(result?.closest('ol')?.style.getPropertyValue('--id-col')).toBe(
        'max(9ch, calc(6ch + 0.18em + 16px))',
      );
      expect(result?.getAttribute('data-active')).toBe('true');
      expect(result?.querySelector('[data-variant="glyph"]')?.getAttribute('data-status')).toBe(
        'in-progress',
      );
      subject.unmount();
    }
  });

  it('inspects the selected Planning item and promotes it through the navigation adapter', () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    function InspectorValue() {
      const { selection } = useInspectorStore();
      return (
        <output data-testid="palette-inspection">
          {selection?.kind === 'node' ? selection.id : ''}
        </output>
      );
    }
    render(
      <>
        <CommandPalette
          open
          onClose={onClose}
          onNavigate={onNavigate}
          sources={sources}
          initialQuery="Callable"
        />
        <InspectorValue />
      </>,
    );
    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('palette-inspection').textContent).toBe(planningNodes[1].id);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenLastCalledWith(hitsFor('Callable')[0].href);
  });

  it('keeps query navigation and close inactive during composition and legacy IME keys', () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    const subject = render(
      <CommandPalette open onClose={onClose} onNavigate={onNavigate} initialQuery="view" />,
    );
    const input = screen.getByRole('searchbox');
    const selected = subject.container.querySelector('[data-active="true"]');
    fireEvent.compositionStart(input);
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'])
      fireEvent.keyDown(input, { key });
    expect(onClose).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(subject.container.querySelector('[data-active="true"]')).toBe(selected);
    fireEvent.compositionEnd(input);
    for (const key of ['Enter', 'Escape']) {
      fireEvent.keyDown(input, { key, isComposing: true });
      fireEvent.keyDown(input, { key, keyCode: 229 });
    }
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves through palette results only with unmodified arrows', () => {
    const subject = render(<CommandPalette open onClose={() => undefined} initialQuery="@view" />);
    const input = screen.getByRole('searchbox');
    const rows = () => [...subject.container.querySelectorAll('[data-active]')];
    expect(rows()[0].getAttribute('data-active')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown', ctrlKey: true });
    expect(rows()[0].getAttribute('data-active')).toBe('true');
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(false);
    expect(rows()[0].getAttribute('data-active')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(rows()[1].getAttribute('data-active')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(rows()[0].getAttribute('data-active')).toBe('true');
  });

  it('does not intercept Tab, ordinary typing, or navigation outside the query field', () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} initialQuery="@view" />);
    const input = screen.getByRole('searchbox');
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
    for (const key of ['g', 'j', 'k', 'c', '/', '?'])
      expect(fireEvent.keyDown(input, { key })).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('moves focused results with J/K or arrows and opens the focused destination', () => {
    const onNavigate = vi.fn();
    render(
      <CommandPalette
        open
        onClose={() => undefined}
        onNavigate={onNavigate}
        initialQuery="@view"
      />,
    );
    const results = screen
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('data-search-result'));
    act(() => results[0].focus());
    expect(fireEvent.keyDown(results[0], { key: 'j' })).toBe(false);
    expect(document.activeElement).toBe(results[1]);
    expect(results[1].getAttribute('data-active')).toBe('true');
    fireEvent.keyDown(results[1], { key: 'k' });
    expect(document.activeElement).toBe(results[0]);
    fireEvent.keyDown(results[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(results[1]);
    fireEvent.keyDown(results[1], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(results[0]);
    expect(fireEvent.keyDown(results[0], { key: 'Tab', shiftKey: true })).toBe(true);
    fireEvent.keyDown(results[0], { key: 'Enter', ctrlKey: true });
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(hitsFor('@view')[0].href);
  });

  it('keeps result letters disabled by preference while arrows and query typing retain their scopes', () => {
    render(
      <CommandPalette open singleLetters={false} onClose={() => undefined} initialQuery="@view" />,
    );
    const results = screen
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('data-search-result'));
    act(() => results[0].focus());
    for (const key of ['j', 'k', 'Tab']) expect(fireEvent.keyDown(results[0], { key })).toBe(true);
    expect(document.activeElement).toBe(results[0]);
    fireEvent.keyDown(results[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(results[1]);
    const query = screen.getByRole('searchbox');
    for (const key of ['j', 'k']) expect(fireEvent.keyDown(query, { key })).toBe(true);
  });

  it('guards focused result keys during composition and newer modals and copies commands without navigation', async () => {
    const onCopy = vi.fn(async () => undefined);
    const onNavigate = vi.fn();
    render(
      <CommandPalette
        open
        onClose={() => undefined}
        onCopy={onCopy}
        onNavigate={onNavigate}
        initialQuery="@command"
      />,
    );
    const results = screen
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('data-search-result'));
    act(() => results[0].focus());
    fireEvent.compositionStart(screen.getByRole('searchbox'));
    for (const key of ['j', 'ArrowDown', 'Enter', 'c']) fireEvent.keyDown(results[0], { key });
    fireEvent.compositionEnd(screen.getByRole('searchbox'));
    fireEvent.keyDown(results[0], { key: 'Enter', isComposing: true });
    fireEvent.keyDown(results[0], { key: 'Enter', keyCode: 229 });
    expect(onCopy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(results[0]);
    const modal = document.createElement('dialog');
    modal.setAttribute('open', '');
    document.body.append(modal);
    fireEvent.keyDown(results[0], { key: 'Enter' });
    expect(onCopy).not.toHaveBeenCalled();
    modal.remove();
    for (const modifier of ['metaKey', 'ctrlKey'])
      fireEvent.keyDown(results[0], { key: 'Enter', [modifier]: true });
    expect(onCopy).not.toHaveBeenCalled();
    fireEvent.keyDown(results[0], { key: 'Enter' });
    await waitFor(() => expect(onCopy).toHaveBeenCalledExactlyOnceWith('openplanr dashboard'));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('copies a focused command with C while preserving the shortcut preference and query typing', async () => {
    const onCopy = vi.fn(async () => undefined);
    const subject = render(
      <CommandPalette
        open
        onClose={() => undefined}
        onCopy={onCopy}
        initialQuery="@command sprint"
      />,
    );
    const command = screen.getByRole('button', { name: /Plan a sprint/u });
    act(() => command.focus());
    expect(fireEvent.keyDown(command, { key: 'c' })).toBe(false);
    await waitFor(() => expect(onCopy).toHaveBeenCalledExactlyOnceWith('/planr:sprint'));
    subject.rerender(
      <CommandPalette
        open
        singleLetters={false}
        onClose={() => undefined}
        onCopy={onCopy}
        initialQuery="@command sprint"
      />,
    );
    expect(fireEvent.keyDown(command, { key: 'c' })).toBe(true);
    expect(fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'c' })).toBe(true);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('copies the canonical Planning ID from a focused result and truthfully labels copy feedback', async () => {
    const onCopy = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    const subject = render(
      <CommandPalette
        open
        sources={sources}
        onClose={onClose}
        onNavigate={onNavigate}
        onCopy={onCopy}
        initialQuery="Callable"
      />,
    );
    const result = screen.getByRole('button', { name: /Callable search/u });
    act(() => result.focus());
    fireEvent.keyDown(result, { key: 'c' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('ID copied.'));
    expect(onCopy).toHaveBeenCalledExactlyOnceWith(planningNodes[1].id);
    expect(screen.getByRole('status').textContent).not.toContain('Command copied.');
    expect(onClose).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    subject.rerender(
      <CommandPalette
        open
        sources={sources}
        onClose={onClose}
        onCopy={async () => {
          throw new Error('clipboard denied');
        }}
        initialQuery="Callable"
      />,
    );
    fireEvent.keyDown(result, { key: 'c' });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'Select the ID and copy it manually.',
      ),
    );
    expect(
      (screen.getByRole('textbox', { name: 'Canonical ID to copy manually' }) as HTMLInputElement)
        .value,
    ).toBe(planningNodes[1].id);
  });

  it('explains that a view result has no canonical artifact ID to copy', () => {
    const onCopy = vi.fn(async () => undefined);
    render(<CommandPalette open onClose={() => undefined} onCopy={onCopy} initialQuery="@view" />);
    const view = screen
      .getAllByRole('button')
      .find((button) => button.hasAttribute('data-search-result'));
    if (!view) throw new Error('Expected a view search result');
    act(() => view.focus());
    expect(fireEvent.keyDown(view, { key: 'c' })).toBe(false);
    expect(screen.getByRole('status').textContent).toContain('no canonical artifact ID to copy');
    expect(onCopy).not.toHaveBeenCalled();
  });

  it('leaves a newer modal in control and restores launcher focus on close', () => {
    const onClose = vi.fn();
    const subject = render(
      <>
        <button type="button">Launch search</button>
        <CommandPalette open={false} onClose={onClose} initialQuery="@view" />
      </>,
    );
    const launcher = screen.getByRole('button', { name: 'Launch search' });
    launcher.focus();
    subject.rerender(
      <>
        <button type="button">Launch search</button>
        <CommandPalette open onClose={onClose} initialQuery="@view" />
      </>,
    );
    const input = screen.getByRole('searchbox');
    expect(document.activeElement).toBe(input);
    const newer = document.createElement('dialog');
    newer.setAttribute('open', '');
    document.body.append(newer);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    newer.remove();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    subject.rerender(
      <>
        <button type="button">Launch search</button>
        <CommandPalette open={false} onClose={onClose} initialQuery="@view" />
      </>,
    );
    expect(document.activeElement).toBe(launcher);
  });

  it('indexes registered commands as copy actions without navigation destinations', () => {
    const hits = hitsFor('@command sprint');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ source: 'command', command: '/planr:sprint', href: null });
    const custom = buildDashboardSearchIndex({
      commands: [
        { id: 'check', title: 'Inspect local project', command: 'openplanr doctor' },
        { id: 'empty', title: 'Empty command', command: '' },
      ],
    });
    expect(queryDashboardSearchIndex(custom, '@command')).toHaveLength(1);
    expect(
      queryDashboardSearchIndex(custom, 'doctor').find((hit) => hit.source === 'command'),
    ).toMatchObject({
      command: 'openplanr doctor',
      href: null,
    });
    expect(
      queryDashboardSearchIndex(buildDashboardSearchIndex({ commands: [] }), '@command'),
    ).toEqual([]);
  });

  it('copies commands on Enter and keeps pending and success feedback in the palette', async () => {
    let finish: (() => void) | undefined;
    const onCopy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        onNavigate={onNavigate}
        onCopy={onCopy}
        initialQuery="@command sprint"
      />,
    );
    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCopy).toHaveBeenCalledExactlyOnceWith('/planr:sprint');
    expect(screen.getByRole('status').textContent).toContain('Copying command');
    expect(screen.getByRole('button', { name: /Plan a sprint/u }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCopy).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish?.();
    });
    expect(screen.getByRole('status').textContent).toContain('Command copied.');
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('explains why Cmd/Ctrl-Enter cannot open a command', () => {
    const onCopy = vi.fn(async () => undefined);
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        onNavigate={onNavigate}
        onCopy={onCopy}
        initialQuery="@command sprint"
      />,
    );
    const input = screen.getByRole('searchbox');
    expect(
      document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toContain('Commands cannot open a full page');
    for (const modifier of ['metaKey', 'ctrlKey']) {
      expect(fireEvent.keyDown(input, { key: 'Enter', [modifier]: true })).toBe(false);
    }
    expect(onCopy).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces copy denial with selectable manual command text', async () => {
    const onCopy = vi.fn(async () => {
      throw new Error('clipboard denied');
    });
    render(
      <CommandPalette
        open
        onClose={() => undefined}
        onCopy={onCopy}
        initialQuery="@command sprint"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Plan a sprint/u }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Copy blocked.'));
    const manual = screen.getByRole('textbox', {
      name: 'Command to copy manually',
    }) as HTMLInputElement;
    expect(manual.value).toBe('/planr:sprint');
    expect(manual.readOnly).toBe(true);
    fireEvent.focus(manual);
    expect(manual.selectionStart).toBe(0);
    expect(manual.selectionEnd).toBe(manual.value.length);
  });

  it('uses manual copy when no adapter is available and supports commands in full Search', async () => {
    render(<SearchWorkspace initialQuery="@command dashboard" />);
    fireEvent.click(screen.getByRole('button', { name: /Open the local dashboard/u }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Copy blocked.'));
    expect(
      (screen.getByRole('textbox', { name: 'Command to copy manually' }) as HTMLInputElement).value,
    ).toBe('openplanr dashboard');
  });

  it('renders the embedded search workspace for the dedicated route surface', () => {
    const html = renderToStaticMarkup(
      <SearchWorkspace sources={sources} initialQuery="Callable" />,
    );
    expect(html).toContain('Callable search');
    expect(html).toContain('data-route-kind="planning.search"');
  });

  it('keeps the verified palette axe-clean', async () => {
    const subject = render(<SearchWorkspace sources={sources} initialQuery="Unified" />);
    expect(subject.container.querySelectorAll('h1')).toHaveLength(1);
    expect(
      (
        await axe.run(subject.container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });

  it('ranks an exact scoped ID first across the complete fixture and previews without navigation or reads', () => {
    const fixture = buildPremiumDashboardFixture('artboard');
    const graph = fixture.graph;
    expect(graph.nodes).toHaveLength(708);
    const onNavigate = vi.fn();
    const originalHash = window.location.hash;
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        onNavigate={onNavigate}
        sources={{ planningNodes: graph.nodes, planningGraph: graph }}
        initialQuery="SPEC-014/T-046"
      />,
    );
    const preview = screen.getByRole('complementary', { name: 'Search result preview' });
    expect(preview.getAttribute('data-preview-id')).toBe('SPEC-014/T-046');
    expect(preview.textContent).toContain('/planr:ship SPEC-014/T-046');
    expect(within(preview).getByRole('region', { name: 'Structural trace' }).textContent).toContain(
      'SPEC-014',
    );
    expect(
      within(preview).getByRole('region', { name: 'Preview dependencies' }).textContent,
    ).toContain('T-045');
    const first = document.querySelector('[data-search-result]');
    expect(first?.getAttribute('data-search-result')).toBe('planning:SPEC-014/T-046');
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(originalHash);
  });

  it('keeps exact identity ahead of a longer title match and deterministic ties', () => {
    const index = buildDashboardSearchIndex({
      planningNodes: [
        { ...planningNodes[0], id: 'SPEC-001', title: 'SPEC-020 SPEC-020 SPEC-020' },
        { ...planningNodes[0], title: 'Actual identity' },
      ],
    });
    expect(queryDashboardSearchIndex(index, 'spec-020')[0].id).toBe('planning:SPEC-020');
  });

  it('changes the preview with arrows and trace links while retaining the route', () => {
    const onNavigate = vi.fn();
    render(
      <CommandPalette
        open
        onClose={() => undefined}
        onNavigate={onNavigate}
        sources={sources}
        initialQuery="@spec"
      />,
    );
    const preview = screen.getByRole('complementary', { name: 'Search result preview' });
    const query = screen.getByRole('searchbox');
    expect(preview.getAttribute('data-preview-id')).toBe('SPEC-020');
    fireEvent.click(within(preview).getByRole('link', { name: /US-013/u }));
    expect(preview.getAttribute('data-preview-id')).toBe('SPEC-020/US-013');
    expect((query as HTMLInputElement).value).toBe('SPEC-020/US-013');
    fireEvent.change(query, { target: { value: '@view' } });
    fireEvent.keyDown(query, { key: 'ArrowDown' });
    fireEvent.keyDown(query, { key: 'ArrowDown' });
    expect(preview.getAttribute('data-preview-id')).toBe(hitsFor('@view')[1].id);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('keeps selected identity, focus and both scroll positions through a live snapshot replacement', () => {
    const fixture = buildPremiumDashboardFixture('artboard');
    const graph = fixture.graph;
    const subject = render(
      <CommandPalette
        open
        onClose={() => undefined}
        sources={{ planningNodes: graph.nodes, planningGraph: graph }}
        initialQuery="handoff"
      />,
    );
    const result = screen.getByRole('button', { name: /Design-to-Delivery Handoff Center/u });
    act(() => result.focus());
    const preview = screen.getByRole('complementary', { name: 'Search result preview' });
    const list = subject.container.querySelector('.pc-palette__results') as HTMLElement;
    preview.scrollTop = 70;
    list.scrollTop = 42;
    const nodes = graph.nodes.map((node) =>
      node.id === 'SPEC-014' ? { ...node, status: 'done' as const } : node,
    );
    subject.rerender(
      <CommandPalette
        open
        onClose={() => undefined}
        sources={{ planningNodes: nodes, planningGraph: { ...graph, nodes } }}
        initialQuery="handoff"
      />,
    );
    expect(document.activeElement).toBe(result);
    expect(result.getAttribute('data-active')).toBe('true');
    expect(preview.getAttribute('data-preview-id')).toBe('SPEC-014');
    expect(preview.textContent).toContain('Done');
    expect(preview.scrollTop).toBe(70);
    expect(list.scrollTop).toBe(42);
  });

  it('traps Tab around results and preview controls without using it as a type filter', async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette open onClose={() => undefined} sources={sources} initialQuery="Callable" />,
    );
    const input = screen.getByRole('searchbox');
    const dialog = screen.getByRole('dialog');
    const controls = [
      ...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input'),
    ];
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(controls[controls.length - 1]);
    await user.tab();
    expect(document.activeElement).toBe(input);
    await user.tab();
    expect(document.activeElement).toBe(controls[1]);
    expect((input as HTMLInputElement).value).toBe('Callable');
  });

  it('prioritizes the preview command when C is focused there instead of copying the selected ID', async () => {
    const onCopy = vi.fn(async () => undefined);
    render(
      <CommandPalette
        open
        onClose={() => undefined}
        onCopy={onCopy}
        sources={sources}
        initialQuery="Callable"
      />,
    );
    const preview = screen.getByRole('complementary', { name: 'Search result preview' });
    const copy = within(preview).getByRole('button', { name: /Copy command/u });
    act(() => copy.focus());
    fireEvent.keyDown(copy, { key: 'c' });
    await waitFor(() =>
      expect(onCopy).toHaveBeenCalledExactlyOnceWith('openplanr status SPEC-020/US-013 --md'),
    );
  });

  it('copies the selected ID from trace focus while leaving editable fields alone', async () => {
    const onCopy = vi.fn(async () => undefined);
    render(
      <CommandPalette
        open
        onClose={() => undefined}
        onCopy={onCopy}
        sources={sources}
        initialQuery="Callable"
      />,
    );
    const preview = screen.getByRole('complementary', { name: 'Search result preview' });
    const traceLink = within(preview).getByRole('link', { name: /US-013/u });
    act(() => traceLink.focus());
    fireEvent.keyDown(traceLink, { key: 'c' });
    await waitFor(() => expect(onCopy).toHaveBeenCalledExactlyOnceWith('SPEC-020/US-013'));
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'c' });
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('guards preview command keys during composition and newer modals, and promotes with Cmd/Ctrl-Enter', () => {
    const onCopy = vi.fn(async () => undefined);
    const onNavigate = vi.fn();
    render(
      <CommandPalette
        open
        onClose={() => undefined}
        onCopy={onCopy}
        onNavigate={onNavigate}
        sources={sources}
        initialQuery="Callable"
      />,
    );
    const preview = screen.getByRole('complementary', { name: 'Search result preview' });
    const copy = within(preview).getByRole('button', { name: /Copy command/u });
    const query = screen.getByRole('searchbox');
    act(() => copy.focus());
    fireEvent.compositionStart(query);
    fireEvent.keyDown(copy, { key: 'c' });
    fireEvent.compositionEnd(query);
    for (const event of [
      { key: 'c', isComposing: true },
      { key: 'c', keyCode: 229 },
      { key: 'C', shiftKey: true },
    ])
      fireEvent.keyDown(copy, event);
    const modal = document.createElement('dialog');
    modal.setAttribute('open', '');
    document.body.append(modal);
    fireEvent.keyDown(copy, { key: 'c' });
    modal.remove();
    expect(onCopy).not.toHaveBeenCalled();
    fireEvent.keyDown(copy, { key: 'Enter', ctrlKey: true });
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(hitsFor('Callable')[0].href);
    expect(onCopy).not.toHaveBeenCalled();
  });

  it('discards clipboard feedback from a replaced source even when its write resolves late', async () => {
    let finish: (() => void) | undefined;
    const onCopy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const subject = render(
      <CommandPalette
        open
        onClose={() => undefined}
        onCopy={onCopy}
        sources={sources}
        initialQuery="Callable"
      />,
    );
    const result = screen.getByRole('button', { name: /Callable search/u });
    fireEvent.keyDown(result, { key: 'c' });
    expect(screen.getByRole('status').textContent).toContain('Copying ID');
    subject.rerender(
      <CommandPalette
        open
        onClose={() => undefined}
        onCopy={onCopy}
        sources={{ planningNodes: [] }}
        initialQuery="@view"
      />,
    );
    await act(async () => finish?.());
    expect(screen.queryByRole('textbox', { name: 'Canonical ID to copy manually' })).toBeNull();
    expect(subject.container.textContent).not.toContain('ID copied.');
    expect(subject.container.textContent).not.toContain('SPEC-020/US-013');
  });

  it('keeps unavailable, empty and offline previews truthful and exposes full Search', () => {
    const onNavigate = vi.fn();
    const subject = render(
      <CommandPalette
        open
        onClose={() => undefined}
        onNavigate={onNavigate}
        sources={{ ...sources, planningPresentation: 'offline' }}
        initialQuery="Callable"
      />,
    );
    const preview = screen.getByRole('complementary', { name: 'Search result preview' });
    expect(preview.textContent).toContain('Last validated planning snapshot');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzzzzzzz' } });
    expect(preview.getAttribute('data-preview-state')).toBe('unavailable');
    expect(preview.textContent).toContain('Preview unavailable');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Unsupported' } });
    expect(preview.textContent).not.toContain('/planr:ship');
    expect(subject.container.textContent).not.toContain(PRIVATE_MARKER);
    fireEvent.click(screen.getByRole('button', { name: 'Full Search' }));
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('#/search');
  });

  it('keeps the open preview dialog axe-clean', async () => {
    const subject = render(
      <CommandPalette open onClose={() => undefined} sources={sources} initialQuery="Callable" />,
    );
    expect(
      (await axe.run(subject.container, { rules: { 'color-contrast': { enabled: false } } }))
        .violations,
    ).toEqual([]);
  });

  it('does not retain browser lexical privacy helpers in production sources', () => {
    expect(PRODUCTION_SOURCE).not.toMatch(
      /isAccessSafe|normalizeBrowser|containsPrivate|PRIVATE_BODY|SENSITIVE_RELATIVE|hasPathRoot|blankCertifiedHttps|HTML_ENTITY/u,
    );
    expect(PRODUCTION_SOURCE).toContain('queryUnsupportedPlanningIdentities');
  });

  it('preserves responsive and reduced-motion presentation rules', () => {
    expect(PALETTE_STYLES).toMatch(/\.pc-palette__panel\s*\{[^}]*max-width: calc\(100% - 32px\)/u);
    expect(PALETTE_STYLES).toMatch(
      /\.pc-palette__results\s*\{[^}]*max-height: 320px;[^}]*overflow-y: auto/u,
    );
    expect(PALETTE_STYLES).not.toMatch(/animation:|transition:/u);
    expect(PALETTE_STYLES).toMatch(/\.pc-palette__input:focus-visible\s*\{[^}]*outline-width: 0;/u);
  });
});

it('copies the focused palette action once while pending and honors disabled single-letter shortcuts', async () => {
  let finish: (() => void) | undefined;
  const onCopy = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const subject = render(
    <CommandPalette open onClose={() => undefined} onCopy={onCopy} initialQuery="@command" />,
  );
  const actions = [
    ...subject.container.querySelectorAll<HTMLButtonElement>('.pc-artifact-row__action'),
  ];
  expect(actions.length).toBeGreaterThan(1);
  const last = screen.getByRole('button', { name: 'Copy command for command:sprint' });
  act(() => last.focus());
  fireEvent.keyDown(last, { key: 'c' });
  expect(onCopy).toHaveBeenCalledExactlyOnceWith('/planr:sprint');
  expect(last.getAttribute('aria-disabled')).toBe('true');
  fireEvent.keyDown(last, { key: 'c' });
  fireEvent.click(actions[0]);
  expect(onCopy).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish?.();
  });
  subject.rerender(
    <CommandPalette
      open
      singleLetters={false}
      onClose={() => undefined}
      onCopy={onCopy}
      initialQuery="@command"
    />,
  );
  expect(last.getAttribute('aria-keyshortcuts')).toBeNull();
  fireEvent.keyDown(last, { key: 'c' });
  expect(onCopy).toHaveBeenCalledTimes(1);
});

it('respects the planning shortcut preference for full-search copy actions', () => {
  const onCopy = vi.fn(async () => undefined);
  const subject = render(
    <PlanningPresentationProvider scope="search-copy-preference" view={null} singleLetters={false}>
      <SearchWorkspace onCopy={onCopy} initialQuery="@command" />
    </PlanningPresentationProvider>,
  );
  const action = subject.container.querySelector<HTMLButtonElement>('.pc-artifact-row__action');
  if (!action) throw new Error('Missing search command copy action');
  expect(action.getAttribute('aria-keyshortcuts')).toBeNull();
  fireEvent.keyDown(action, { key: 'c' });
  expect(onCopy).not.toHaveBeenCalled();
});

it.each(['palette', 'workspace'] as const)(
  'copies a verified Planning continuation through the %s copy lock',
  async (surface) => {
    let finish: (() => void) | undefined;
    const onCopy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const subject = render(
      surface === 'palette' ? (
        <CommandPalette
          open
          onClose={() => undefined}
          sources={sources}
          onCopy={onCopy}
          initialQuery="Callable"
        />
      ) : (
        <SearchWorkspace sources={sources} onCopy={onCopy} initialQuery="Callable" />
      ),
    );
    const action = screen.getByRole('button', { name: 'Copy command for SPEC-020/US-013' });
    act(() => action.focus());
    fireEvent.keyDown(action, { key: 'c' });
    expect(onCopy).toHaveBeenCalledExactlyOnceWith('openplanr status SPEC-020/US-013 --md');
    expect(action.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(action);
    fireEvent.keyDown(action, { key: 'c' });
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(subject.container.textContent).toContain('Copying command');
    await act(async () => {
      finish?.();
    });
    expect(subject.container.textContent).toContain('Command copied.');
  },
);

it('renders each Planning result with a leaf ID tag, readable title and separate type hint', () => {
  const hits = [...hitsFor('Unified'), ...hitsFor('Callable')];
  const subject = render(
    <SearchResults hits={hits} activeHref={null} listId="row-recipe" onSelect={() => undefined} />,
  );
  const rows = [...subject.container.querySelectorAll<HTMLElement>('.pc-palette__result')].filter(
    (row) => row.querySelector('[data-canonical-id]'),
  );
  expect(rows.length).toBeGreaterThan(1);
  for (const row of rows) {
    const button = row.querySelector<HTMLButtonElement>('[data-search-result]');
    const canonicalId = button?.dataset.canonicalId;
    const tag = button?.querySelector('.pc-artifact-tag');
    const title = button?.querySelector('.pc-artifact-row__title');
    expect(button?.querySelector('.pc-palette__identity [data-variant="glyph"]')).toBeTruthy();
    expect(tag?.textContent).toBe(canonicalId?.split('/').at(-1));
    expect(title?.textContent?.length).toBeGreaterThan(0);
    expect(title?.getAttribute('title')).toBe(title?.textContent);
    expect(button?.querySelector('.pc-palette__row-hint')).toBeNull();
    expect(
      row.querySelector(':scope > .pc-palette__row-hint')?.textContent?.length,
    ).toBeGreaterThan(0);
  }
});

it.each(['palette', 'workspace'] as const)(
  'uses the authored short ID for a slug-named %s hit without changing its canonical identity',
  (surface) => {
    const canonicalId =
      'BL-431-dashboard-needs-a-complete-artifact-title-without-using-the-file-slug-as-the-display-id';
    const title = 'A readable backlog title';
    const node: PlanningModelNode = {
      id: canonicalId,
      title,
      type: 'backlog',
      status: 'outstanding',
      frontmatter: { id: 'BL-431' },
    };
    const scopedSources = { planningNodes: [node] };
    const subject = render(
      surface === 'palette' ? (
        <CommandPalette
          open
          onClose={() => undefined}
          sources={scopedSources}
          initialQuery="BL-431"
        />
      ) : (
        <SearchWorkspace sources={scopedSources} initialQuery="BL-431" />
      ),
    );
    const result = subject.container.querySelector<HTMLButtonElement>('[data-search-result]');
    expect(result?.dataset.canonicalId).toBe(canonicalId);
    expect(result?.dataset.searchResult).toBe(`planning:${canonicalId}`);
    expect(result?.querySelector('.pc-artifact-tag')?.textContent).toBe('BL-431');
    expect(result?.querySelector('.pc-artifact-row__title')?.textContent).toBe(title);
    expect(result?.closest('ol')?.style.getPropertyValue('--id-col')).not.toContain(
      `${canonicalId.length}ch`,
    );
  },
);
