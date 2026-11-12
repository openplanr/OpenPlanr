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
    const binding = createDashboardQueryIdentity({
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
