// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PlanningHandoffPage } from '../../../../apps/dashboard/src/features/operate/planning/PlanningHandoffPage.js';
import { DeliveryTrace } from '../../../../apps/dashboard/src/features/planning/DeliveryTrace.js';
import { OperatingOriginPanel } from '../../../../apps/dashboard/src/features/planning/OperatingOriginPanel.js';
import {
  callablePlanningTraceHref,
  normalizePlanningDeliveryTrace,
} from '../../../../apps/dashboard/src/features/planning/planning-trace-model.js';
import {
  createPlanningHandoffModelFixture,
  isExactPlanningSpecPreview,
  resolvePlanningHandoffModel,
} from './planning-handoff-fixture.js';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const PRODUCTION_SOURCE = [
  'planning/PlanningHandoffPage.tsx',
  'planning/planning-handoff-model.ts',
  '../planning/DeliveryTrace.tsx',
  '../planning/OperatingOriginPanel.tsx',
  '../planning/planning-trace-model.ts',
]
  .map((file) =>
    readFileSync(
      resolve(TEST_ROOT, '../../../../apps/dashboard/src/features/operate', file),
      'utf8',
    ),
  )
  .join('\n');
const PRIVATE_MARKER = 'opaque-planning-capability-never-visible';
const HASH_A = `sha256:${'a'.repeat(64)}`;
const _HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;

describe('planning handoff UI', () => {
  it('keeps preview exactness bound to actor, scope, Event head, and expiry', () => {
    const { proposal, specPreview, current } = createPlanningHandoffModelFixture();
    expect(isExactPlanningSpecPreview(proposal, specPreview, current)).toBe(true);
    expect(
      isExactPlanningSpecPreview(proposal, { ...specPreview, proposalHash: HASH_A }, current),
    ).toBe(false);
    expect(
      isExactPlanningSpecPreview(proposal, specPreview, { ...current, actorId: 'foreign' }),
    ).toBe(false);
    expect(
      isExactPlanningSpecPreview(
        { ...proposal, preview: { ...proposal.preview, expiresAt: '2000-01-01T00:00:00Z' } },
        specPreview,
        current,
      ),
    ).toBe(false);
  });

  it('filters hostile trace destinations to canonical dashboard hashes only', () => {
    expect(
      callablePlanningTraceHref({
        href: 'javascript:alert(1)',
        subjectId: 'SPEC-042',
      }),
    ).toBeNull();
    expect(
      callablePlanningTraceHref({
        href: '#/detail/SPEC-042',
        subjectId: 'SPEC-042',
      }),
    ).toBe('#/detail/SPEC-042');
    const nodes = normalizePlanningDeliveryTrace({
      nodes: [
        {
          kind: 'spec',
          label: 'SPEC-042 shaping',
          state: 'shaping',
          subjectId: 'SPEC-042',
          href: '#/detail/SPEC-042',
        },
        {
          kind: 'plan',
          label: 'PLAN',
          state: 'not-started',
          subjectId: 'foreign',
          href: 'javascript:alert(1)',
        },
      ],
    });
    expect(nodes.filter((node) => node.href !== null)).toHaveLength(1);
    expect(nodes[0]?.href).toBe('#/detail/SPEC-042');
  });

  it('renders operating origin and delivery trace without private transport fields', () => {
    const html = renderToStaticMarkup(
      <OperatingOriginPanel
        envelope={{
          origin: {
            spec: { specId: 'SPEC-042', status: 'shaping' },
            decision: { id: 'dec_release_0001' },
            action: { id: 'act_planning_release_0001' },
            correlationId: 'corr_planning_release_0001',
          },
          progress: {
            nodes: [{ kind: 'plan', label: 'PLAN', state: 'not-started', owner: 'Planning' }],
          },
        }}
      />,
    );
    expect(html).toContain('Why SPEC-042 exists');
    expect(html).toContain('Delivery and value trace');
    expect(html).not.toContain(PRIVATE_MARKER);
  });

  it('renders delivery trace nodes in service-owned order', () => {
    const html = renderToStaticMarkup(
      <DeliveryTrace
        progress={{
          nodes: [
            { kind: 'plan', label: 'PLAN', state: 'not-started', owner: 'Planning' },
            { kind: 'ship', label: 'SHIP', state: 'not-started', owner: 'Pipeline' },
          ],
        }}
      />,
    );
    expect(html).toContain('data-kind="plan"');
    expect(html).toContain('data-kind="ship"');
  });

  it('resolves the planning handoff route binding separately from action detail', () => {
    const { state, binding } = createPlanningHandoffModelFixture();
    expect(resolvePlanningHandoffModel(state, binding)).not.toBeNull();
    const wrongRoute = { ...binding, route: `#/operate/actions/${binding.subjectId}` };
    expect(resolvePlanningHandoffModel(state, wrongRoute)).toBeNull();
  });

  it('keeps the planning handoff workspace axe-clean with one heading and governed controls', async () => {
    const { state, binding, previewPayload } = createPlanningHandoffModelFixture();
    const { container, unmount } = render(
      <PlanningHandoffPage
        currentBinding={binding}
        current={state}
        actions={{
          bind: vi.fn(),
          preview: vi.fn(async () => previewPayload),
          createSpec: vi.fn(),
          trace: vi.fn(),
          reconcile: vi.fn(),
          cancel: vi.fn(),
          dispose: vi.fn(),
        }}
      />,
    );
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(
      (
        await axe.run(container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
    unmount();
  });

  it('requests preview, invalidates create on framing edits, and confirms creation', async () => {
    const { state, binding, previewPayload, creationPayload } = createPlanningHandoffModelFixture();
    const preview = vi.fn(async () => previewPayload);
    const createSpec = vi.fn(async () => creationPayload);
    render(
      <PlanningHandoffPage
        currentBinding={binding}
        current={state}
        actions={{
          bind: vi.fn(),
          preview,
          createSpec,
          trace: vi.fn(),
          reconcile: vi.fn(),
          cancel: vi.fn(),
          dispose: vi.fn(),
        }}
      />,
    );
    const previewButton = screen.getByRole('button', { name: 'Preview SPEC draft' });
    expect((previewButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(previewButton);
    expect(preview).toHaveBeenCalledTimes(1);
    await screen.findByText(
      'The canonical SPEC preview is current for these exact human-owned framing fields.',
    );
    const createButton = screen.getByRole('button', { name: 'Create SPEC draft' });
    expect((createButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Problem'), {
      target: { value: 'Revised problem statement' },
    });
    expect(
      (screen.getByRole('button', { name: 'Create SPEC draft' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh canonical SPEC preview' }));
    expect(preview).toHaveBeenCalledTimes(2);
    await screen.findByText(
      'The canonical SPEC preview is current for these exact human-owned framing fields.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create SPEC draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Create SPEC draft' }));
    expect(createSpec).toHaveBeenCalledWith('oprop_planning_release_0001', HASH_C);
    await screen.findByText(/SPEC-042 is durable with status shaping/u);
    expect(screen.getByRole('link', { name: 'Open in Planning' }).getAttribute('href')).toBe(
      '#/detail/SPEC-042',
    );
  });

  it('removes an old preview and blocks creation when refreshed preview proof is lost', async () => {
    const { state, binding, previewPayload } = createPlanningHandoffModelFixture();
    const uncertain = Object.assign(new Error('proof lost'), { name: 'OPERATION_UNCERTAIN' });
    const preview = vi.fn().mockResolvedValueOnce(previewPayload).mockRejectedValueOnce(uncertain);
    const createSpec = vi.fn();
    const reconcile = vi.fn();
    const onRefetch = vi.fn().mockRejectedValueOnce(new Error('verified refetch failed'));
    render(
      <PlanningHandoffPage
        currentBinding={binding}
        current={state}
        onRefetch={onRefetch}
        actions={{
          bind: vi.fn(),
          preview,
          createSpec,
          trace: vi.fn(),
          reconcile,
          cancel: vi.fn(),
          dispose: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview SPEC draft' }));
    await screen.findByText(
      'The canonical SPEC preview is current for these exact human-owned framing fields.',
    );
    expect(
      (screen.getByRole('button', { name: 'Create SPEC draft' }) as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh canonical SPEC preview' }));
    await screen.findByText(/Planning preview proof was lost after POST/u);
    expect(screen.queryByText(previewPayload.specPreview.content as string)).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Create SPEC draft' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Reconcile current state' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile current state' }));
    await screen.findByText(/Planning remains locked/u);
    expect(onRefetch).toHaveBeenCalledOnce();
    expect(reconcile).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: 'Create SPEC draft' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('stays projection-only in source', () => {
    expect(PRODUCTION_SOURCE).not.toContain(PRIVATE_MARKER);
    expect(PRODUCTION_SOURCE).not.toMatch(/localStorage|sessionStorage/u);
    expect(PRODUCTION_SOURCE).not.toMatch(/autoStartShip|auto.*PLAN.*SHIP/iu);
  });
});

describe('planning handoff fixture integrity', () => {
  it('builds a verifiable operate action display workspace', () => {
    const { workspace, view } = createPlanningHandoffModelFixture();
    expect(workspace.kind).toBe('operate-action-display-workspace');
    expect(view.actions[0]?.deliveryRoute.route).toBe('planning-work');
    expect(view.viewHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
