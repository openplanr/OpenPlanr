// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BrandFixtureGallery,
  type GalleryState,
} from '../../../../apps/dashboard/src/design-system/components/brand-fixture-gallery.js';
import {
  ARTBOARD_FIXTURE_CLOCK,
  ARTBOARD_SOURCES,
  buildArtboardGraph,
} from './fixtures/premium-artboard-fixture.js';

afterEach(cleanup);

const graph = buildArtboardGraph('brand-gallery');
const props = { graph, clock: ARTBOARD_FIXTURE_CLOCK, sources: ARTBOARD_SOURCES };

describe('fixture-only brand gallery', () => {
  it.each<GalleryState>([
    'normal',
    'hover',
    'focus-visible',
    'active',
    'disabled',
    'loading',
    'empty',
    'error',
    'reduced-motion',
  ])('renders artboard records and contrast pairings in %s', (state) => {
    const { container } = render(<BrandFixtureGallery {...props} state={state} />);
    expect(
      [...container.querySelectorAll('[data-gallery-artboard]')].map((element) =>
        element.getAttribute('data-gallery-artboard'),
      ),
    ).toEqual(['Tokens', 'Components', 'States']);
    expect(container.querySelectorAll('[data-gallery-contrast]')).toHaveLength(56);
    expect(container.querySelectorAll('[data-gallery-text-style]')).toHaveLength(9);
    expect(container.querySelectorAll('[data-gallery-recipe^="state-"]')).toHaveLength(6);
    expect(container.querySelector('[data-brand-gallery]')?.getAttribute('data-clock')).toBe(
      ARTBOARD_FIXTURE_CLOCK,
    );
    expect(screen.getByText('The file watcher disconnected')).toBeTruthy();
    for (const command of ['openplanr init', 'openplanr dashboard', '/planr:sync'])
      expect(screen.getByText(command)).toBeTruthy();
    if (state === 'disabled') {
      for (const control of container.querySelectorAll('button, input'))
        expect(control.matches(':disabled')).toBe(true);
    }
  });

  it('retains the selected row and focus when a graph patch changes its title', () => {
    const view = render(<BrandFixtureGallery {...props} state="normal" />);
    const rows = view.container.querySelectorAll<HTMLElement>('[data-keyboard-item]');
    const row = rows[1];
    fireEvent.focus(row);
    const id = row.getAttribute('data-canonical-id');
    fireEvent.keyDown(row, { key: 'j' });
    expect(document.activeElement).toBe(rows[2]);
    const selected = rows[2].getAttribute('data-canonical-id');
    view.rerender(
      <BrandFixtureGallery
        {...props}
        state="normal"
        graph={{
          ...graph,
          nodes: graph.nodes.map((node) =>
            node.id === selected ? { ...node, title: 'Updated artboard title' } : node,
          ),
        }}
      />,
    );
    expect(
      view.container
        .querySelector('[data-selected="true"] [data-canonical-id]')
        ?.getAttribute('data-canonical-id'),
    ).toBe(selected);
    expect(document.activeElement).toBe(rows[2]);
    expect(id).not.toBe(selected);
  });

  it('surfaces incomplete source data', () => {
    expect(() =>
      render(<BrandFixtureGallery {...props} graph={{ nodes: [], edges: [] }} state="normal" />),
    ).toThrow('Gallery requires four artboard rows; received 0.');
  });

  it('opens the tooltip from its native keyboard trigger', () => {
    render(<BrandFixtureGallery {...props} state="normal" />);
    act(() => screen.getByRole('button', { name: 'Command help' }).focus());
    expect(screen.getByRole('tooltip').textContent).toBe('Copy a verified command');
  });
});
