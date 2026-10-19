// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanningOperatingOriginSection } from '../../../../apps/dashboard/src/features/planning/PlanningOperatingOriginSection.js';
import type { PlanningModelNode } from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import type { DashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
const root = {
  actorId: 'origin-reader',
  projectId: `sha256:${'a'.repeat(64)}`,
  scopeId: 'planning',
  domainId: 'delivery',
  domainVersion: '1.0.0',
  generation: 1,
};
vi.mock('../../../../apps/dashboard/src/app/providers.js', () => ({
  useDashboard: () => ({ bootstrap: { queryRoots: { operate: root } } }),
}));
vi.mock('../../../../apps/dashboard/src/features/operate/planning/planning-actions.js', () => ({
  fetchPlanningOperatingTrace: mocks.fetch,
}));

const binding = { projectId: root.projectId } as DashboardQueryIdentity;
const spec: PlanningModelNode = {
  id: 'SPEC-004',
  type: 'spec',
  title: 'Ordinary spec',
  status: 'outstanding',
  frontmatter: {},
};
const operatingSpec: PlanningModelNode = {
  ...spec,
  body: [
    '## Operating origin',
    '',
    'Machine authority remains in the adjacent `operating-origin.json` sidecar.',
    '',
    '### Continue in Operate',
    '',
    '[Open this Action in Planning](#/operate/actions/action-004/planning).',
  ].join('\n'),
};

beforeEach(() => mocks.fetch.mockReset());
afterEach(cleanup);

describe('operating origin request evidence', () => {
  it.each([
    ['unverified detail', null],
    ['ordinary spec', spec],
    ['planning ancestry', { ...spec, frontmatter: { originId: 'BL-004' } }],
    ['sidecar mention alone', { ...spec, body: '## Operating origin\n`operating-origin.json`' }],
    [
      'unrelated section',
      {
        ...operatingSpec,
        body: operatingSpec.body?.replace('## Operating origin', '## References'),
      },
    ],
    ['another spec', { ...operatingSpec, id: 'SPEC-005' }],
  ] as const)('does not request a speculative trace for %s', (_label, node) => {
    render(<PlanningOperatingOriginSection specId={spec.id} binding={binding} node={node} />);
    expect(screen.getByText('Operating origin unavailable')).toBeTruthy();
    expect(screen.getByText(/No operating origin is declared in the verified Spec/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry operating origin' })).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('requests a declared operating origin with the verified source binding', async () => {
    mocks.fetch.mockResolvedValue({
      origin: {
        spec: { specId: spec.id },
        scopeId: root.scopeId,
        domainId: root.domainId,
        domainVersion: root.domainVersion,
        actor: { actorId: root.actorId },
      },
      progress: { nodes: [] },
    });
    const rendered = render(
      <PlanningOperatingOriginSection specId={spec.id} binding={binding} node={operatingSpec} />,
    );
    await screen.findByText(`Why ${spec.id} exists`);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toMatchObject({
      specId: spec.id,
      identity: { ...root, productArea: 'operate', route: '#/operate/today' },
    });
    rendered.rerender(
      <PlanningOperatingOriginSection specId={spec.id} binding={binding} node={spec} />,
    );
    expect(screen.queryByText(`Why ${spec.id} exists`)).toBeNull();
    expect(screen.getByText('Operating origin unavailable')).toBeTruthy();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    expect(mocks.fetch.mock.calls[0][0].signal.aborted).toBe(true);
  });
});
