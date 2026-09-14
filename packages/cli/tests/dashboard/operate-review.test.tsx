// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { sha256Jcs } from 'planr-pipeline/dashboard/verified-json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewPage } from '../../../../apps/dashboard/src/features/operate/review/ReviewPage.js';
import type {
  ReviewActions,
  ReviewCommandPreview,
  ReviewConfirmation,
} from '../../../../apps/dashboard/src/features/operate/review/review-actions.js';
import { fetchOperateReviewDisplay } from '../../../../apps/dashboard/src/features/operate/review/review-api.js';
import { createOperateReviewDisplayValidator } from '../../../../apps/dashboard/src/features/operate/review/review-model.js';
import {
  type DashboardProductStateKind,
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { parseDashboardSafeError } from '../../../../apps/dashboard/src/lib/api/safe-errors.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
} from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import {
  alternateReviewFixture,
  createPendingReviewDisplay,
  createTerminalReviewDisplay,
  REVIEW_FIXTURE,
  type ReviewFixtureIdentity,
} from '../helpers/operate-review-dashboard-fixture.js';

type Workspace = ReturnType<typeof createPendingReviewDisplay>;

function bindingFor(
  workspace: Workspace,
  fixture: ReviewFixtureIdentity = REVIEW_FIXTURE,
): DashboardQueryIdentity {
  return createDashboardQueryIdentity({
    productArea: 'operate',
    route: `#/operate/cycles/${encodeURIComponent(fixture.cycleId)}/reviews/${encodeURIComponent(fixture.reviewId)}`,
    actorId: fixture.actorId,
    projectId: fixture.projectId,
    scopeId: fixture.scopeId,
    domainId: fixture.domainId,
    domainVersion: fixture.domainVersion,
    cycleId: fixture.cycleId,
    subjectId: fixture.reviewId,
    eventHead: workspace.payload.sourceEventHead,
    viewHash: workspace.payload.sourceViewHash,
    generation: 3,
  });
}

function stateFor(workspace: Workspace, binding: DashboardQueryIdentity) {
  const kind = workspace.payload.status === 'terminal' ? 'read-only' : workspace.payload.status;
  return parseDashboardProductState(
    {
      kind,
      binding,
      data: workspace,
      reasonCodes: kind === 'ready' ? [] : [`DASHBOARD_${kind.toUpperCase().replaceAll('-', '_')}`],
      error: null,
      mutationEnabled: workspace.payload.mutationEnabled,
      policy: dashboardProductStatePolicy(kind),
    },
    { currentBinding: binding, validateData: createOperateReviewDisplayValidator(binding) },
  );
}

function retainedStateFor(
  workspace: Workspace,
  binding: DashboardQueryIdentity,
  kind: Extract<
    DashboardProductStateKind,
    'refreshing' | 'stale' | 'partial' | 'blocked' | 'offline'
  >,
) {
  const error =
    kind === 'stale' || kind === 'offline'
      ? parseDashboardSafeError({
          code: 'DASHBOARD_READ_FAILED',
          retryable: false,
          context: { operation: 'dashboard.review.read' },
        })
      : null;
  return parseDashboardProductState(
    {
      kind,
      binding,
      data: workspace,
      reasonCodes: [`DASHBOARD_${kind.toUpperCase().replaceAll('-', '_')}`],
      error,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy(kind),
    },
    { currentBinding: binding, validateData: createOperateReviewDisplayValidator(binding) },
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function actionsHarness(
  workspace: Workspace,
  options: Readonly<{
    previewGate?: Promise<void>;
    confirm?: () => Promise<ReviewConfirmation>;
  }> = {},
) {
  const cancel = vi.fn();
  const dispose = vi.fn();
  const bind = vi.fn();
  const reconcile = vi.fn();
  const previewCustodyCancel = vi.fn();
  const preview = vi.fn(async (locator: { subjectId: string; actionDigest: string }) => {
    await options.previewGate;
    const capability = workspace.payload.data.capability;
    if (!capability.available) throw new Error('Fixture is not commandable.');
    const selected = capability.actions.find(
      ({ subjectId, action }) =>
        subjectId === locator.subjectId && sha256Jcs(action) === locator.actionDigest,
    );
    if (!selected) throw new Error('Unknown fixture locator.');
    const custody = {
      preview: {
        eventHead: workspace.payload.sourceEventHead,
        previewHash: `sha256:${'e'.repeat(64)}`,
        previewId: 'xprv_review_dashboard_0001',
        allowedAction: selected.action,
      },
      confirm:
        options.confirm ??
        (async () => {
          const error = new Error('Confirmation was not configured.');
          error.name = 'OPERATE_PREVIEW_EXPIRED';
          throw error;
        }),
      cancel: previewCustodyCancel,
    } as unknown as ReviewCommandPreview;
    return custody;
  });
  const actions: ReviewActions = Object.freeze({ bind, preview, reconcile, cancel, dispose });
  return { actions, bind, preview, cancel, dispose, reconcile, previewCustodyCancel };
}

async function selectAndPreview(label: RegExp) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('radio', { name: label }));
  await user.click(screen.getByRole('button', { name: 'Review exact choice' }));
  return user;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Operate executive Review workspace', () => {
  it('renders decision-first verified truth accessibly and never preselects an owner choice', async () => {
    const workspace = createPendingReviewDisplay();
    const binding = bindingFor(workspace);
    const harness = actionsHarness(workspace);
    const { container } = render(
      <ReviewPage
        currentBinding={binding}
        current={stateFor(workspace, binding)}
        actions={harness.actions}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Owner Review' })).toBeTruthy();
    expect(screen.getByText('What the board recommends')).toBeTruthy();
    expect(screen.getByText('Reciprocal decision trace')).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Review exact choice' })).toBeNull();
    expect(harness.preview).not.toHaveBeenCalled();
    expect(
      (
        await axe.run(container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });

  it.each([
    ['refreshing', 'Refreshing'],
    ['stale', 'Stale'],
    ['partial', 'Partial'],
    ['blocked', 'Blocked'],
    ['offline', 'Offline'],
  ] as const)(
    'retains verified decision truth while presenting the exact %s state with mutation disabled',
    (kind, label) => {
      const workspace = createPendingReviewDisplay();
      const binding = bindingFor(workspace);
      const { container } = render(
        <ReviewPage
          currentBinding={binding}
          current={retainedStateFor(workspace, binding, kind)}
          actions={actionsHarness(workspace).actions}
        />,
      );

      expect(screen.getByRole('heading', { level: 1, name: 'Owner Review' })).toBeTruthy();
      expect(container.querySelector('.op-review__status > div:first-child dd')?.textContent).toBe(
        label,
      );
      expect(container.querySelector('.pc-operate__notice')?.textContent).toContain(
        label.toLocaleLowerCase('en-US'),
      );
      expect(screen.getAllByRole('radio')).toHaveLength(2);
      expect(screen.getAllByRole('radio').every((radio) => radio.matches(':disabled'))).toBe(true);
      expect(screen.queryByRole('button', { name: 'Review exact choice' })).toBeNull();
    },
  );

  it('keeps immutable choice A custody while its preview is delayed and refuses an attempted B switch', async () => {
    const workspace = createPendingReviewDisplay();
    const binding = bindingFor(workspace);
    const gate = deferred<void>();
    const harness = actionsHarness(workspace, { previewGate: gate.promise });
    render(
      <ReviewPage
        currentBinding={binding}
        current={stateFor(workspace, binding)}
        actions={harness.actions}
      />,
    );

    const user = userEvent.setup();
    const approve = screen.getByRole('radio', { name: /Approve bounded recommendation/u });
    const reject = screen.getByRole('radio', { name: /Reject recommendation/u });
    await user.click(approve);
    void user.click(screen.getByRole('button', { name: 'Review exact choice' }));
    await waitFor(() => expect(reject.matches(':disabled')).toBe(true));
    fireEvent.click(reject);
    expect((approve as HTMLInputElement).checked).toBe(true);
    expect((reject as HTMLInputElement).checked).toBe(false);

    gate.resolve();
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Record “Approve bounded recommendation”/u)).toBeTruthy();
    expect(within(dialog).queryByText(/Record “Reject recommendation”/u)).toBeNull();
    expect(within(dialog).getByText('project-write')).toBeTruthy();
    expect(harness.preview).toHaveBeenCalledOnce();
  });

  it.each(['OPERATE_PREVIEW_EXPIRED', 'CONCURRENT_MODIFICATION'])(
    'closes a determinate %s rejection, refreshes exact truth, and leaves no unhandled error',
    async (code) => {
      const workspace = createPendingReviewDisplay();
      const binding = bindingFor(workspace);
      const onRefetch = vi.fn(async () => stateFor(workspace, binding));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const harness = actionsHarness(workspace, {
        confirm: async () => {
          const error = new Error('private server detail');
          error.name = code;
          throw error;
        },
      });
      render(
        <ReviewPage
          currentBinding={binding}
          current={stateFor(workspace, binding)}
          onRefetch={onRefetch}
          actions={harness.actions}
        />,
      );

      const user = await selectAndPreview(/Approve bounded recommendation/u);
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', {
          name: 'Record Approve bounded recommendation',
        }),
      );
      await waitFor(() => expect(onRefetch).toHaveBeenCalledOnce());
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(screen.getByText(/Current legal choices are being refreshed/u)).toBeTruthy();
      expect(document.body.textContent).not.toContain('private server detail');
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  it('locks an indeterminate confirmation against blind retry and directs the owner to Recovery', async () => {
    const workspace = createPendingReviewDisplay();
    const binding = bindingFor(workspace);
    const onRefetch = vi.fn(async () => stateFor(workspace, binding));
    const harness = actionsHarness(workspace, {
      confirm: async () => {
        throw new TypeError('socket closed after request bytes');
      },
    });
    render(
      <ReviewPage
        currentBinding={binding}
        current={stateFor(workspace, binding)}
        onRefetch={onRefetch}
        actions={harness.actions}
      />,
    );

    const user = await selectAndPreview(/Approve bounded recommendation/u);
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Record Approve bounded recommendation',
      }),
    );
    expect(await screen.findByText('Blind retry is locked')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Recovery' }).getAttribute('href')).toBe(
      '#/operate/recovery',
    );
    expect(onRefetch).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: 'Review exact choice' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('never carries an A receipt into a reused B route and restores B initial focus', async () => {
    const workspaceA = createPendingReviewDisplay();
    const bindingA = bindingFor(workspaceA);
    const terminalA = createTerminalReviewDisplay('Bounded approval');
    const success: Extract<ReviewConfirmation, { ok: true }> = Object.freeze({
      ok: true,
      receipt: terminalA.receipt,
      workspace: terminalA.workspace,
      eventHead: terminalA.receipt.eventHead,
    });
    const harness = actionsHarness(workspaceA, { confirm: async () => success });
    const failedRefetch = vi.fn(async () => {
      throw new Error('offline after durable commit');
    });
    const rendered = render(
      <ReviewPage
        currentBinding={bindingA}
        current={stateFor(workspaceA, bindingA)}
        onRefetch={failedRefetch}
        actions={harness.actions}
      />,
    );
    const user = await selectAndPreview(/Approve bounded recommendation/u);
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Record Approve bounded recommendation',
      }),
    );
    expect(await screen.findByText('Review recorded')).toBeTruthy();
    expect(failedRefetch).toHaveBeenCalledOnce();
    expect(screen.queryByText('Choose the record to make')).toBeNull();
    expect(document.querySelector('.op-review__status dd')?.textContent).toBe('Terminal');
    expect(screen.getByText(REVIEW_FIXTURE.terminalHead.sequence)).toBeTruthy();
    expect(document.body.textContent).not.toContain('offline after durable commit');
    expect(document.body.textContent).toContain(terminalA.receipt.receiptId);

    const fixtureB = alternateReviewFixture('0002');
    const workspaceB = createPendingReviewDisplay(2, fixtureB);
    const bindingB = bindingFor(workspaceB, fixtureB);
    rendered.rerender(
      <ReviewPage
        currentBinding={bindingB}
        current={stateFor(workspaceB, bindingB)}
        actions={harness.actions}
      />,
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1, name: 'Owner Review' }),
      ),
    );
    expect(screen.queryByText('Review recorded')).toBeNull();
    expect(document.body.textContent).not.toContain(terminalA.receipt.receiptId);
    expect(document.body.textContent).not.toContain(
      terminalA.receipt.boundSubmission.boundSubmissionHash,
    );
  });

  it('does not infer a missing owner note from a terminal display without its exact receipt', () => {
    const terminal = createTerminalReviewDisplay('A receipt-only note');
    const binding = bindingFor(terminal.workspace);
    render(
      <ReviewPage
        currentBinding={binding}
        current={stateFor(terminal.workspace, binding)}
        actions={actionsHarness(terminal.workspace).actions}
      />,
    );
    expect(screen.getAllByText('Not included in this display').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('No note recorded')).toBeNull();
    expect(document.body.textContent).not.toContain('A receipt-only note');
  });
});

describe('Review HTTP boundary', () => {
  it('deep-freezes validated wire data before model resolution and rejects post-fetch mutation', async () => {
    const workspace = createPendingReviewDisplay();
    const fetched = await fetchOperateReviewDisplay({
      origin: 'http://127.0.0.1:7473',
      root: {
        actorId: REVIEW_FIXTURE.actorId,
        projectId: REVIEW_FIXTURE.projectId,
        scopeId: REVIEW_FIXTURE.scopeId,
        domainId: REVIEW_FIXTURE.domainId,
        domainVersion: REVIEW_FIXTURE.domainVersion,
        generation: 3,
      },
      cycleId: REVIEW_FIXTURE.cycleId,
      reviewId: REVIEW_FIXTURE.reviewId,
      fetcher: vi.fn(
        async () =>
          new Response(JSON.stringify(workspace), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          }),
      ),
    });
    expect(Object.isFrozen(fetched)).toBe(true);
    expect(Object.isFrozen(fetched.payload.data.choices[0])).toBe(true);
    const original = fetched.payload.data.choices[0]?.label;
    expect(() => {
      (fetched.payload.data.choices[0] as { label: string }).label = 'Hostile rewrite';
    }).toThrow(TypeError);
    expect(fetched.payload.data.choices[0]?.label).toBe(original);
  });
});
