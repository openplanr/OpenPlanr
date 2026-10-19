// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanningOperatingOriginSection } from '../../../../apps/dashboard/src/features/planning/PlanningOperatingOriginSection.js';
import type { DashboardQueryRoot } from '../../../../apps/dashboard/src/lib/api/bootstrap.js';
import type { DashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

const mocks = vi.hoisted(() => ({ root: null as DashboardQueryRoot | null, fetch: vi.fn() }));
vi.mock('../../../../apps/dashboard/src/app/providers.js', () => ({
  useDashboard: () => ({ bootstrap: { queryRoots: { operate: mocks.root } } }),
}));
vi.mock('../../../../apps/dashboard/src/features/operate/planning/planning-actions.js', () => ({
  fetchPlanningOperatingTrace: mocks.fetch,
}));

const root: DashboardQueryRoot = {
  actorId: 'actor-origin',
  projectId: `sha256:${'a'.repeat(64)}`,
  scopeId: 'scope-origin',
  domainId: 'domain-origin',
  domainVersion: '1.0.0',
  generation: 1,
};
const binding = { projectId: root.projectId } as DashboardQueryIdentity;
const firstSpec = 'SPEC-001';
const secondSpec = 'SPEC-002';
const declaredNode = (specId: string) => ({
  id: specId,
  type: 'spec' as const,
  title: specId,
  status: 'outstanding' as const,
  frontmatter: {},
  body: '## Operating origin\n\nMachine authority remains in the adjacent `operating-origin.json` sidecar.\n\n[Open this Action in Planning](#/operate/actions/action-001/planning).',
});
const creation = (specId: string, source: DashboardQueryRoot = root) => ({
  origin: {
    spec: { specId },
    scopeId: source.scopeId,
    domainId: source.domainId,
    domainVersion: source.domainVersion,
    actor: { actorId: source.actorId },
  },
  progress: { nodes: [] },
});

beforeEach(() => {
  mocks.root = root;
  mocks.fetch.mockReset();
});
afterEach(cleanup);

describe('Planning operating origin read state', () => {
  it('shows an explicit unavailable state when Operate has no source root', () => {
    mocks.root = null;
    render(
      <PlanningOperatingOriginSection
        specId={firstSpec}
        binding={binding}
        node={declaredNode(firstSpec)}
      />,
    );
    expect(screen.getByText('Operating origin unavailable')).toBeTruthy();
    expect(screen.getByText(/No operating origin can be read/)).toBeTruthy();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('removes the previous origin while a new Spec loads and keeps failed reads unavailable', async () => {
    mocks.fetch.mockResolvedValueOnce(creation(firstSpec));
    let rejectNext: (reason: Error) => void = () => {};
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectNext = reject;
        }),
    );
    const rendered = render(
      <PlanningOperatingOriginSection
        specId={firstSpec}
        binding={binding}
        node={declaredNode(firstSpec)}
      />,
    );
    await screen.findByText(`Why ${firstSpec} exists`);
    rendered.rerender(
      <PlanningOperatingOriginSection
        specId={secondSpec}
        binding={binding}
        node={declaredNode(secondSpec)}
      />,
    );
    expect(screen.queryByText(`Why ${firstSpec} exists`)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading');
    await act(async () => rejectNext(new Error('Unavailable')));
    expect(screen.getByText('Operating origin unavailable')).toBeTruthy();
    expect(screen.queryByText(`Why ${firstSpec} exists`)).toBeNull();
    mocks.fetch.mockResolvedValueOnce(creation(secondSpec));
    fireEvent.click(screen.getByRole('button', { name: 'Retry operating origin' }));
    await screen.findByText(`Why ${secondSpec} exists`);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it('aborts obsolete requests and ignores late results across source-root generation changes', async () => {
    let resolveOld: (value: unknown) => void = () => {};
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const rendered = render(
      <PlanningOperatingOriginSection
        specId={firstSpec}
        binding={binding}
        node={declaredNode(firstSpec)}
      />,
    );
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const oldSignal = mocks.fetch.mock.calls[0][0].signal as AbortSignal;
    mocks.root = { ...root, generation: root.generation + 1, actorId: 'actor-new-origin' };
    mocks.fetch.mockResolvedValueOnce(creation(secondSpec, mocks.root));
    rendered.rerender(
      <PlanningOperatingOriginSection
        specId={secondSpec}
        binding={binding}
        node={declaredNode(secondSpec)}
      />,
    );
    await screen.findByText(`Why ${secondSpec} exists`);
    expect(oldSignal.aborted).toBe(true);
    await act(async () => resolveOld(creation(firstSpec)));
    expect(screen.queryByText(`Why ${firstSpec} exists`)).toBeNull();
    expect(screen.getByText(`Why ${secondSpec} exists`)).toBeTruthy();
    expect(mocks.fetch.mock.calls[1][0].identity).toMatchObject(mocks.root);
  });

  it('hides a ready origin when only its source generation changes', async () => {
    mocks.fetch.mockResolvedValueOnce(creation(firstSpec));
    const rendered = render(
      <PlanningOperatingOriginSection
        specId={firstSpec}
        binding={binding}
        node={declaredNode(firstSpec)}
      />,
    );
    await screen.findByText(`Why ${firstSpec} exists`);
    mocks.root = { ...root, generation: root.generation + 1 };
    mocks.fetch.mockImplementationOnce(() => new Promise(() => {}));
    rendered.rerender(
      <PlanningOperatingOriginSection
        specId={firstSpec}
        binding={binding}
        node={declaredNode(firstSpec)}
      />,
    );
    expect(screen.queryByText(`Why ${firstSpec} exists`)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading');
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(mocks.fetch.mock.calls[1][0].identity.generation).toBe(root.generation + 1);
  });

  it('refuses origin custody that belongs to another actor and permits a fresh retry', async () => {
    mocks.fetch.mockResolvedValueOnce(creation(firstSpec, { ...root, actorId: 'actor-other' }));
    render(
      <PlanningOperatingOriginSection
        specId={firstSpec}
        binding={binding}
        node={declaredNode(firstSpec)}
      />,
    );
    await screen.findByText('Operating origin unavailable');
    expect(screen.queryByText(`Why ${firstSpec} exists`)).toBeNull();
    expect(screen.getByText(/could not be verified for the current Spec/)).toBeTruthy();
    mocks.fetch.mockResolvedValueOnce(creation(firstSpec));
    fireEvent.click(screen.getByRole('button', { name: 'Retry operating origin' }));
    await screen.findByText(`Why ${firstSpec} exists`);
  });
});
