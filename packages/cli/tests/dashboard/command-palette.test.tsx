// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
} from '../../../../apps/dashboard/src/features/search/search-index.js';
import { createSearchKeyNav } from '../../../../apps/dashboard/src/features/search/search-key-nav.js';
import { useInspectorStore } from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';

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
    expect(html).toContain('Planning work');
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
    ]);
    expect(
      queryUnsupportedPlanningIdentities(buildDashboardSearchIndex(sources), '@story Unsupported'),
    ).toHaveLength(1);
    expect(
      queryUnsupportedPlanningIdentities(buildDashboardSearchIndex(sources), '@task Unsupported'),
    ).toEqual([]);
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
    fireEvent.compositionStart(input);
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'])
      fireEvent.keyDown(input, { key });
    expect(onClose).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(subject.container.querySelector('[data-active="true"]')).toBeNull();
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
    expect(rows().some((row) => row.getAttribute('data-active') === 'true')).toBe(false);
    fireEvent.keyDown(input, { key: 'ArrowDown', ctrlKey: true });
    expect(rows().some((row) => row.getAttribute('data-active') === 'true')).toBe(false);
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
    const results = screen.getAllByRole('button');
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
    const results = screen.getAllByRole('button');
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
    const results = screen.getAllByRole('button');
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
    const view = screen.getAllByRole('button')[0];
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
    expect(queryDashboardSearchIndex(custom, 'doctor')[0]).toMatchObject({
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

  it('does not retain browser lexical privacy helpers in production sources', () => {
    expect(PRODUCTION_SOURCE).not.toMatch(
      /isAccessSafe|normalizeBrowser|containsPrivate|PRIVATE_BODY|SENSITIVE_RELATIVE|hasPathRoot|blankCertifiedHttps|HTML_ENTITY/u,
    );
    expect(PRODUCTION_SOURCE).toContain('queryUnsupportedPlanningIdentities');
  });

  it('preserves responsive and reduced-motion presentation rules', () => {
    expect(PALETTE_STYLES).toMatch(/\.pc-palette__panel\s*\{[^}]*max-width: 92%/u);
    expect(PALETTE_STYLES).toMatch(
      /\.pc-palette__results\s*\{[^}]*max-height: 320px;[^}]*overflow-y: auto/u,
    );
    expect(PALETTE_STYLES).not.toMatch(/animation:|transition:/u);
  });
});
