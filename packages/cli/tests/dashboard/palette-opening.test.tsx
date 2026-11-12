// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:7473"}

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseRecentItems,
  rememberRecentItem,
} from '../../../../apps/dashboard/src/app/browser-preferences.js';
import type { PlanningModelNode } from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import { CommandPalette } from '../../../../apps/dashboard/src/features/search/CommandPalette.js';
import { shownScope } from '../../../../apps/dashboard/src/features/search/PaletteParts.js';
import { SearchResults } from '../../../../apps/dashboard/src/features/search/SearchResults.js';
import type { DashboardSearchHit } from '../../../../apps/dashboard/src/features/search/search-index.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const planningNodes: readonly PlanningModelNode[] = Object.freeze([
  {
    id: 'SPEC-020',
    type: 'spec',
    title: 'Unified dashboard',
    status: 'in-progress',
    frontmatter: { id: 'SPEC-020' },
  },
  {
    id: 'SPEC-020/US-013',
    type: 'story',
    title: 'Callable search',
    status: 'outstanding',
    frontmatter: { id: 'US-013', specId: 'SPEC-020' },
  },
]);
const sources = Object.freeze({ planningNodes });

function store(ids: readonly string[]) {
  return {
    load: vi.fn((_projectId: string) => ids),
    save: vi.fn((_projectId: string, _ids: readonly string[]) => undefined),
  };
}

function cycleBinding() {
  return createDashboardQueryIdentity({
    productArea: 'operate',
    route: '#/operate/today',
    actorId: 'palette-reader',
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
}

describe('recent palette items', () => {
  it('parses stored IDs, keeps five, and refuses anything else', () => {
    expect(parseRecentItems(null)).toEqual([]);
    expect(parseRecentItems(JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f']))).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
    expect(() => parseRecentItems('{"a":1}')).toThrow('Invalid recent palette items');
    expect(() => parseRecentItems('[1]')).toThrow('Invalid recent palette items');
    expect(() => parseRecentItems('not json')).toThrow();
  });

  it('puts the opened ID first without duplicates', () => {
    expect(rememberRecentItem(['a', 'b', 'c', 'd', 'e'], 'c')).toEqual(['c', 'a', 'b', 'd', 'e']);
    expect(rememberRecentItem(['a', 'b', 'c', 'd', 'e'], 'z')).toEqual(['z', 'a', 'b', 'c', 'd']);
  });
});

describe('palette opening state', () => {
  it('opens on Recent items still in the graph and the Plan views, never on an empty result', () => {
    const recent = store(['SPEC-020/US-013', 'SPEC-404']);
    render(
      <CommandPalette
        open
        onClose={() => undefined}
        sources={sources}
        recentItems={recent}
        projectId="project-a"
      />,
    );
    expect(recent.load).toHaveBeenCalledWith('project-a');
    const recentList = screen.getByRole('list', { name: 'Recent' });
    expect(
      within(recentList)
        .getAllByRole('button')
        .map((button) => button.getAttribute('data-canonical-id')),
    ).toEqual(['SPEC-020/US-013']);
    expect(
      within(screen.getByRole('list', { name: 'Go to' }))
        .getAllByRole('button')
        .map((button) => button.getAttribute('data-search-result')),
    ).toEqual([
      'route:planning.overview',
      'route:planning.list',
      'route:planning.graph',
      'route:planning.board',
      'route:planning.sprints',
      'route:planning.activity',
      'route:planning.search',
    ]);
    expect(document.body.textContent).not.toContain('Nothing matches');
    const preview = screen.getByRole('complementary', { name: 'Search result preview' });
    expect(preview.getAttribute('data-preview-state')).toBe('ready');
    expect(preview.getAttribute('data-preview-id')).toBe('SPEC-020/US-013');
    expect(preview.textContent).toContain('Callable search');
  });

  it('shows Go to only when stored recent items cannot be read', () => {
    render(
      <CommandPalette
        open
        onClose={() => undefined}
        sources={sources}
        recentItems={{
          load: () => {
            throw new Error('Invalid recent palette items: {}');
          },
          save: vi.fn(),
        }}
        projectId="project-a"
      />,
    );
    expect(screen.queryByRole('list', { name: 'Recent' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Go to' })).toBeTruthy();
  });

  it('records an item opened from the palette for this project', () => {
    const recent = store(['SPEC-020']);
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        sources={sources}
        recentItems={recent}
        projectId="project-a"
        initialQuery="Callable"
      />,
    );
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(recent.save).toHaveBeenCalledExactlyOnceWith('project-a', [
      'SPEC-020/US-013',
      'SPEC-020',
    ]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps opening items when the browser refuses to store recent items', () => {
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        sources={sources}
        recentItems={{
          load: () => [],
          save: () => {
            throw new Error('QuotaExceededError');
          },
        }}
        projectId="project-a"
        initialQuery="Callable"
      />,
    );
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('palette keyboard copy', () => {
  it('copies the active row command with Cmd/Ctrl+C only when no query text is selected', async () => {
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
    const input = screen.getByRole<HTMLInputElement>('searchbox');
    input.setSelectionRange(0, input.value.length);
    expect(fireEvent.keyDown(input, { key: 'c', metaKey: true })).toBe(true);
    expect(onCopy).not.toHaveBeenCalled();
    input.setSelectionRange(input.value.length, input.value.length);
    expect(fireEvent.keyDown(input, { key: 'c', ctrlKey: true })).toBe(false);
    await act(async () => undefined);
    expect(onCopy).toHaveBeenCalledExactlyOnceWith('openplanr status SPEC-020/US-013 --md');
    expect(screen.getByRole('status').textContent).toBe(
      '✓ Copiedopenplanr status SPEC-020/US-013 --md',
    );
  });
});

describe('palette keyboard copy with a selection elsewhere', () => {
  it('leaves Cmd/Ctrl+C to the browser when text outside the input is selected', async () => {
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
    const input = screen.getByRole<HTMLInputElement>('searchbox');
    const preview = screen.getByRole('complementary', { name: 'Search result preview' });
    const title = within(preview).getByRole('heading', { name: 'Callable search' });
    const selection = document.getSelection();
    if (!selection) throw new Error('jsdom returned no document selection');
    const range = document.createRange();
    range.selectNodeContents(title);
    selection.removeAllRanges();
    selection.addRange(range);
    input.setSelectionRange(input.value.length, input.value.length);
    expect(document.activeElement).toBe(input);
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }])
      expect(fireEvent.keyDown(input, { key: 'c', ...modifier })).toBe(true);
    await act(async () => undefined);
    expect(onCopy).not.toHaveBeenCalled();
    selection.removeAllRanges();
    expect(fireEvent.keyDown(input, { key: 'c', ctrlKey: true })).toBe(false);
    await act(async () => undefined);
    expect(onCopy).toHaveBeenCalledExactlyOnceWith('openplanr status SPEC-020/US-013 --md');
  });
});

describe('palette paths to full Search', () => {
  it('opens the Search page from the palette view with Enter and with Cmd/Ctrl+Enter', () => {
    for (const modifier of [{}, { ctrlKey: true }, { metaKey: true }]) {
      const onNavigate = vi.fn();
      const onClose = vi.fn();
      const view = render(
        <CommandPalette
          open
          onClose={onClose}
          onNavigate={onNavigate}
          sources={sources}
          initialQuery="@view search"
        />,
      );
      expect(
        view.container.querySelector('[data-search-result]')?.getAttribute('data-search-result'),
      ).toBe('route:planning.search');
      fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter', ...modifier });
      expect(onNavigate).toHaveBeenCalledExactlyOnceWith('#/search');
      expect(onClose).toHaveBeenCalledOnce();
      view.unmount();
    }
  });
});

describe('palette Operate loading', () => {
  it('shows a searching Operate group below Planning rows without moving them', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const binding = cycleBinding();
    const view = render(
      <CommandPalette
        open
        onClose={() => undefined}
        sources={sources}
        initialQuery="Callable"
        connectionState="connected"
        operateBindings={[binding]}
        preferredOperateCycleId="cycle-current"
      />,
    );
    const headings = [...view.container.querySelectorAll('.pc-palette__group-title')].map(
      (heading) => heading.textContent,
    );
    expect(headings[0]).toBe('Items');
    expect(headings).toContain('Operate searching…');
    expect(headings.indexOf('Operate searching…')).toBeGreaterThan(0);
    expect(screen.getByRole('group', { name: 'Result scope' }).textContent).toContain('Operate');
  });
});

describe('palette scopes', () => {
  const scopeButton = (name: string) =>
    within(screen.getByRole('group', { name: 'Result scope' })).getByRole<HTMLButtonElement>(
      'button',
      { name: new RegExp(`^${name} \\d+$`, 'u') },
    );

  it('returns to All when the selected scope empties under a new query', () => {
    const view = render(
      <CommandPalette open onClose={() => undefined} sources={sources} initialQuery="Callable" />,
    );
    fireEvent.click(scopeButton('Items'));
    expect(scopeButton('Items').getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Graph' } });
    expect(scopeButton('All').getAttribute('aria-pressed')).toBe('true');
    expect(view.container.querySelectorAll('[data-search-result]').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Callable' } });
    expect(scopeButton('All').getAttribute('aria-pressed')).toBe('true');
  });

  it('reopens on All so a scope from the last search never blanks the opening state', () => {
    const view = render(
      <CommandPalette open onClose={() => undefined} sources={sources} initialQuery="Callable" />,
    );
    fireEvent.click(scopeButton('Items'));
    view.rerender(
      <CommandPalette
        open={false}
        onClose={() => undefined}
        sources={sources}
        initialQuery="Callable"
      />,
    );
    view.rerender(<CommandPalette open onClose={() => undefined} sources={sources} />);
    expect(scopeButton('All').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('list', { name: 'Go to' })).toBeTruthy();
  });

  it('disables scopes with no rows but never All', () => {
    render(
      <CommandPalette open onClose={() => undefined} sources={sources} initialQuery="qzxqzx" />,
    );
    expect(scopeButton('All').disabled).toBe(false);
    for (const name of ['Items', 'Views', 'Commands'])
      expect(scopeButton(name).disabled).toBe(true);
  });

  it('keeps Operate selected while its read loads and draws the searching row', () => {
    const hits: readonly DashboardSearchHit[] = [];
    expect(shownScope('operate', hits, true)).toBe('operate');
    expect(shownScope('operate', hits, false)).toBe('all');
    expect(shownScope('command', hits, true)).toBe('all');
    const view = render(
      <SearchResults
        hits={hits}
        activeHref={null}
        listId="scoped"
        onSelect={() => undefined}
        variant="palette"
        operateLoading
      />,
    );
    expect(view.container.querySelector('.pc-palette__group[aria-busy="true"]')).not.toBeNull();
  });
});

describe('palette Operate scope', () => {
  it('shows the Operate scope only while a cycle is bound and returns to All when it goes', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    render(
      <CommandPalette
        open
        onClose={() => undefined}
        sources={sources}
        initialQuery="Callable"
        connectionState="connected"
        operateBindings={[cycleBinding()]}
      />,
    );
    const scopes = () => screen.getByRole('group', { name: 'Result scope' });
    const chooseCycle = (label: string) => {
      fireEvent.click(screen.getByRole('combobox', { name: /^Operate Cycle for search results/u }));
      fireEvent.click(
        within(screen.getByRole('listbox', { name: 'Operate Cycle for search results' })).getByRole(
          'option',
          { name: label },
        ),
      );
    };
    expect(within(scopes()).queryByRole('button', { name: /^Operate/u })).toBeNull();
    chooseCycle('Software delivery cycle');
    const operate = within(scopes()).getByRole('button', { name: /^Operate/u });
    fireEvent.click(operate);
    expect(operate.getAttribute('aria-pressed')).toBe('true');
    chooseCycle('Select a cycle');
    expect(within(scopes()).queryByRole('button', { name: /^Operate/u })).toBeNull();
    expect(
      within(scopes()).getByRole('button', { name: /^All/u }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
