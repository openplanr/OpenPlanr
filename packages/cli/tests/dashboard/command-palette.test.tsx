// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
