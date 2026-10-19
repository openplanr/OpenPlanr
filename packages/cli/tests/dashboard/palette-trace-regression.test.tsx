// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { planningDisplayId } from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import { CommandPalette } from '../../../../apps/dashboard/src/features/search/CommandPalette.js';
import {
  buildDashboardSearchIndex,
  queryDashboardSearchIndex,
} from '../../../../apps/dashboard/src/features/search/search-index.js';
import { useInspectorStore } from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import { paletteTraceInputs, TRACE_PLAN } from './fixtures/dashboard-trace-model.js';
import { buildPremiumDashboardFixture } from './fixtures/premium-dashboard-fixtures.js';

describe('palette trace fixture queries', () => {
  it.each(['representative', 'scaling'] as const)(
    'renders the first result and preview for every %s trace query and ID form',
    (dataset) => {
      const { graph } = buildPremiumDashboardFixture(dataset);
      const samples = paletteTraceInputs(graph.nodes);
      expect(samples).toHaveLength(TRACE_PLAN.inputCount);
      const failingId =
        dataset === 'representative' ? 'specs/fixture-1/T-079' : 'specs/fixture-1/T-555';
      expect(samples.some(({ node }) => node.id === failingId)).toBe(true);
      const onNavigate = vi.fn();
      const onClose = vi.fn();
      const originalHash = window.location.hash;
      const subject = render(
        <CommandPalette
          open
          onClose={onClose}
          onNavigate={onNavigate}
          sources={{ planningNodes: graph.nodes, planningGraph: graph }}
        />,
      );
      const input = screen.getByRole('searchbox');
      const preview = screen.getByRole('complementary', { name: 'Search result preview' });
      for (const { node, query } of samples) {
        for (const value of new Set([query, node.id, planningDisplayId(node)])) {
          fireEvent.change(input, { target: { value } });
          const first = subject.container.querySelector('[data-search-result]');
          expect(first?.getAttribute('data-search-result'), value).toBe(`planning:${node.id}`);
          expect(first?.textContent, value).toContain(node.title);
          expect(preview.getAttribute('data-preview-id'), value).toBe(node.id);
          expect(preview.getAttribute('data-preview-state'), value).toBe('ready');
          expect(preview.textContent, value).toContain(node.title);
        }
      }
      expect(window.location.hash).toBe(originalHash);
      expect(onNavigate).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it('keeps separate graph identities selectable when they have no public detail route', () => {
    const { graph } = buildPremiumDashboardFixture('representative');
    const index = buildDashboardSearchIndex({ planningNodes: graph.nodes });
    const hits = queryDashboardSearchIndex(index, '@task');
    expect(hits).toHaveLength(20);
    expect(new Set(hits.map((hit) => hit.id)).size).toBe(20);
    expect(hits.every((hit) => hit.href === null)).toBe(true);
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    function InspectorValue() {
      const { selection } = useInspectorStore();
      return (
        <output data-testid="graph-inspection">
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
          sources={{ planningNodes: graph.nodes, planningGraph: graph }}
          initialQuery="specs/fixture-1/T-079"
        />
        <InspectorValue />
      </>,
    );
    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(within(screen.getByRole('dialog')).getByRole('status').textContent).toContain(
      'full-page destination is unavailable',
    );
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('graph-inspection').textContent).toBe('specs/fixture-1/T-079');
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ranks an exact canonical identity before matching display aliases with deterministic ties', () => {
    const { graph } = buildPremiumDashboardFixture('representative');
    const scoped = graph.nodes.find((node) => node.id === 'specs/fixture-1/T-079');
    if (!scoped) throw new Error('Missing scoped fixture task.');
    const index = buildDashboardSearchIndex({
      planningNodes: [{ ...scoped, id: 'specs/other/T-079' }, scoped, { ...scoped, id: 'T-079' }],
    });
    expect(queryDashboardSearchIndex(index, 'T-079').map((hit) => hit.id)).toEqual([
      'planning:T-079',
      'planning:specs/fixture-1/T-079',
      'planning:specs/other/T-079',
    ]);
  });
});
