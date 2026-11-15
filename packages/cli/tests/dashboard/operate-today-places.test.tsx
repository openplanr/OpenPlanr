// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TodayPage } from '../../../../apps/dashboard/src/features/operate/today/TodayPage.js';
import { TOPBAR_ROUTE_TABS_ID } from '../../../../apps/dashboard/src/features/shell/shell-navigation.js';
import {
  type DashboardProductState,
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

const binding = createDashboardQueryIdentity({
  productArea: 'operate',
  route: '#/operate/today',
  actorId: 'places-reader',
  projectId: `sha256:${'a'.repeat(64)}`,
  scopeId: 'places',
  domainId: 'software',
  domainVersion: '1.0.0',
  cycleId: null,
  subjectId: null,
  eventHead: { sequence: 0, hash: null },
  viewHash: `sha256:${'b'.repeat(64)}`,
  generation: 1,
});

function contextState(kind: 'first-use' | 'empty'): DashboardProductState<unknown> {
  return parseDashboardProductState(
    {
      kind,
      binding,
      data: null,
      reasonCodes: [`DASHBOARD_${kind.toUpperCase().replace('-', '_')}`],
      error: null,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy(kind),
    },
    { currentBinding: binding },
  );
}

function renderToday(sources: Parameters<typeof TodayPage>[0]['sources']) {
  const slot = document.createElement('div');
  slot.id = TOPBAR_ROUTE_TABS_ID;
  document.body.append(slot);
  const view = render(<TodayPage currentBinding={binding} sources={sources} />);
  return { slot, view };
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe('Operate places on the Today states', () => {
  for (const [state, sources, text] of [
    ['setup', { current: contextState('first-use') }, 'Operate is not set up in this project'],
    ['nothing waiting', { current: contextState('empty') }, 'There is no active work'],
    ['could not read', {}, 'Today could not be read'],
  ] as const) {
    it(`keeps the place tabs and the phone Inbox link on ${state}, with no count`, () => {
      const { slot, view } = renderToday(sources);
      expect(view.container.textContent).toContain(text);
      const places = slot.querySelector('nav[aria-label="Operate places"]');
      expect(places, `${state} tabs`).not.toBeNull();
      expect(
        [...(places?.querySelectorAll('a') ?? [])].map((link) => [
          link.textContent,
          link.getAttribute('href'),
          link.getAttribute('aria-current'),
        ]),
      ).toEqual([
        ['Today', '#/operate/today', 'page'],
        ['Inbox', '#/operate/inbox', null],
        ['Cycles', '#/operate/cycles', null],
        ['History', '#/operate/history', null],
      ]);
      const phone = slot.querySelector('a.pc-operate-places__phone');
      expect(phone?.textContent, `${state} phone link`).toBe('Inbox');
      expect(phone?.getAttribute('href')).toBe('#/operate/inbox');
    });
  }
});
