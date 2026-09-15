// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { selectOperateExperienceDisplaySurface } from 'planr-pipeline/dashboard/operate-experience-reader';
import { sha256Jcs } from 'planr-pipeline/protocol';
import {
  assertOperateExperienceDisplaySurfaceV1,
  assertOperateExperiencePreviewV1,
  type OperateExperienceDisplaySurfaceV1,
} from 'planr-pipeline/schemas/v1.2.0/operate-experience-display-surface.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DashboardProviders,
  type DashboardProvidersProps,
} from '../../../../apps/dashboard/src/app/providers.js';
import { InboxPage } from '../../../../apps/dashboard/src/features/operate/inbox/InboxPage.js';
import type {
  InboxActionConfirmation,
  InboxActionPreview,
  InboxActions,
} from '../../../../apps/dashboard/src/features/operate/inbox/inbox-actions.js';
import {
  createOperateInboxDisplayValidator,
  resolveOperateInboxModel,
} from '../../../../apps/dashboard/src/features/operate/inbox/inbox-model.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';
import {
  type DashboardProductState,
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
} from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

type RecordValue = Record<string, unknown>;
type Display = Readonly<OperateExperienceDisplaySurfaceV1>;

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;
const HASH_D = `sha256:${'d'.repeat(64)}`;
const HASH_E = `sha256:${'e'.repeat(64)}`;
const PROJECT_ID = `sha256:${'1'.repeat(64)}`;
const CYCLE_ID = 'cyc_t015_1234567890abcdef';
const REVIEW_ID = 'rev_t015_1234567890abcdef';
const DECISION_ID = 'dec_t015_1234567890abcdef';
const PRIVATE_ARGUMENT = 'workDispositions';
const PRIVATE_CAPABILITY = 'operate-review';
const PRIVATE_ISSUED_AT = '2026-08-16T08:00:00.000Z';
const HOSTILE_TITLE = '<img src=x onerror="owned"> C#/.NET API/CLI $(pwd) `echo ~/repo`';
const HOSTILE_HTML =
  '&lt;img src=x onerror=&quot;owned&quot;&gt; C#/.NET API/CLI $(pwd) `echo ~/repo`';

function reviewAction(actorId = 'owner-t015') {
  return {
    tool: 'operate.review.submit',
    arguments: {
      reviewId: REVIEW_ID,
      cycleId: CYCLE_ID,
      actor: { actorId, kind: 'human', runtime: 'openplanr' },
      scope: {
        scopeId: 'scope-t015',
        domainId: 'business',
        domainVersion: '1.0.0',
      },
      disposition: 'approved',
      workDispositions: [
        {
          entityType: 'operating-decision',
          entityId: DECISION_ID,
          disposition: 'approved',
        },
      ],
    },
    label: 'Review the exact Decision',
    effect: 'project-write',
  };
}

const ACTION_DIGEST = sha256Jcs(reviewAction() as never);

function actionLocator(actorId: string) {
  return Object.freeze({
    subjectId: REVIEW_ID,
    actionDigest: sha256Jcs(reviewAction(actorId) as never),
  });
}

function inboxItems(actorId: string, commandable = true, omitPrimary = false) {
  const items = [
    {
      itemId: 'approval:aprq_t015_12345678',
      kind: 'approval',
      subjectId: 'act_t015_1234567890abcdef',
      ownerActorId: actorId,
      state: 'waiting',
      title: 'Another named party must decide',
      consequence: 'The governed Action remains blocked.',
      expiresAt: '2099-08-12T08:00:00.000Z',
      blocking: true,
      evidence: [],
      requiredParties: [
        {
          partyId: 'party-redacted',
          actorKind: 'human',
          actorId: null,
          requiredCapability: { id: PRIVATE_CAPABILITY, version: '1.0.0' },
          state: 'redacted',
          redacted: true,
        },
      ],
      redactions: [{ classification: 'confidential', count: 1, reason: 'identity-redacted' }],
      actionLocator: null,
      navigationLocator: null,
      unavailableReason: {
        code: 'OPERATE_APPROVAL_PARTY_UNAVAILABLE',
        message: 'This actor is not an eligible remaining approval party.',
      },
    },
    {
      itemId: 'decision:dec_t015_12345678',
      kind: 'decision',
      subjectId: DECISION_ID,
      ownerActorId: actorId,
      state: 'proposed',
      title: HOSTILE_TITLE,
      consequence: 'The Cycle remains blocked until the exact review is resolved.',
      expiresAt: '2099-08-12T08:00:00.000Z',
      blocking: true,
      evidence: [
        {
          evidenceRefId: 'evref_t015_support_12345678',
          classification: 'internal',
          accessState: 'available',
          relation: 'support',
        },
        {
          evidenceRefId: 'evref_t015_restrict_123456',
          classification: 'confidential',
          accessState: 'restricted',
          relation: 'contradiction',
        },
      ],
      requiredParties: [
        {
          partyId: 'party-owner',
          actorKind: 'human',
          actorId,
          requiredCapability: { id: PRIVATE_CAPABILITY, version: '1.0.0' },
          state: 'required',
          redacted: false,
        },
      ],
      redactions: [],
      actionLocator: commandable ? { ...actionLocator(actorId) } : null,
      navigationLocator: null,
      unavailableReason: commandable
        ? null
        : {
            code: 'CAPABILITY_DENIED',
            message: 'The current actor may inspect but cannot mutate this item.',
          },
    },
    {
      itemId: 'decision:dec_t015_second_1234',
      kind: 'decision',
      subjectId: 'dec_t015_second_1234567890',
      ownerActorId: actorId,
      state: 'consumed',
      title: 'A consumed Decision stays visible',
      consequence: 'No duplicate effect is available.',
      expiresAt: null,
      blocking: true,
      evidence: [],
      requiredParties: [],
      redactions: [],
      actionLocator: null,
      navigationLocator: null,
      unavailableReason: {
        code: 'OPERATE_ACTION_ALREADY_CONSUMED',
        message: 'The exact owner action has already been consumed.',
      },
    },
    {
      itemId: 'verification:asg_t015_12345678',
      kind: 'verification',
      subjectId: 'asg_t015_1234567890abcdef',
      ownerActorId: actorId,
      state: 'available',
      title: 'Verification evidence is required',
      consequence: 'The expected outcome remains unverified.',
      expiresAt: null,
      blocking: false,
      evidence: [],
      requiredParties: [],
      redactions: [],
      actionLocator: null,
      navigationLocator: null,
      unavailableReason: {
        code: 'OPERATE_VERIFICATION_SUBMISSION_UNAVAILABLE',
        message: 'No exact owner-issued verification submission is available.',
      },
    },
  ];
  return omitPrimary ? items.filter((item) => item.itemId !== 'decision:dec_t015_12345678') : items;
}

function experienceView({
  actorId = 'owner-t015',
  head = Object.freeze({ sequence: 1, hash: HASH_A }),
  commandable = true,
  emptyInbox = false,
  omitPrimary = false,
}: {
  actorId?: string;
  head?: Readonly<{ sequence: number; hash: string }>;
  commandable?: boolean;
  emptyInbox?: boolean;
  omitPrimary?: boolean;
} = {}): RecordValue {
  const source: RecordValue = {
    kind: 'operate-experience-view',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    viewId: 'xview_t015_1234567890abcdef',
    scopeId: 'scope-t015',
    domainId: 'business',
    domainVersion: '1.0.0',
    actorId,
    accessLevel: 'internal',
    generatedAt: '2026-08-16T08:00:00.000Z',
    eventHead: structuredClone(head),
    sourceStateHash: HASH_C,
    status: 'ready',
    attention: [],
    domainMetrics: [],
    cycles: [
      {
        cycleId: CYCLE_ID,
        state: 'approved',
        health: 'normal',
        focus: ['Resolve exact Inbox work.'],
        createdAt: '2026-08-16T07:00:00.000Z',
        updatedAt: '2026-08-16T08:00:00.000Z',
        stages: ['observe', 'understand', 'decide', 'govern', 'act', 'verify', 'learn'].map(
          (id, index) => ({
            id,
            state: index < 4 ? 'complete' : index === 4 ? 'current' : 'waiting',
            reason: null,
            inputArtifactIds: [],
            outputArtifactIds: [],
            gates: [],
            evidenceGapIds: [],
            uncertaintyIds: [],
            persistentActionIds: [],
          }),
        ),
        assignments: [],
        lensAbsences: [],
        executiveBoard: null,
        dependencies: [],
        blockers: [],
        persistentActionIds: [],
        replayCheckpoint: null,
        deepLink: `#/operate/cycles/${CYCLE_ID}`,
      },
    ],
    inbox: emptyInbox ? [] : inboxItems(actorId, commandable, omitPrimary),
    actions: [],
    evidence: [
      {
        evidenceRefId: 'evref_t015_support_12345678',
        classification: 'internal',
        accessState: 'available',
        freshness: 'current',
        evidenceKind: null,
        resolvedAt: null,
        claimStatus: 'supported',
        supportClaimIds: [],
        contradictClaimIds: [],
        source: null,
        producer: null,
        observedAt: null,
        scope: { scopeId: 'scope-t015', domainId: 'business', domainVersion: '1.0.0' },
        sensitivity: 'internal',
        provenance: null,
        confidence: null,
        gaps: [],
        errors: [],
        accessReason: null,
        causalLinks: [],
        deepLink: '#/operate/evidence/evref_t015_support_12345678',
      },
      {
        evidenceRefId: 'evref_t015_restrict_123456',
        classification: 'confidential',
        accessState: 'restricted',
        freshness: 'current',
        evidenceKind: null,
        resolvedAt: null,
        claimStatus: 'contradicted',
        supportClaimIds: [],
        contradictClaimIds: [],
        source: null,
        producer: null,
        observedAt: null,
        scope: { scopeId: 'scope-t015', domainId: 'business', domainVersion: '1.0.0' },
        sensitivity: 'confidential',
        provenance: null,
        confidence: null,
        gaps: [],
        errors: [],
        accessReason: 'access-denied',
        causalLinks: [],
        deepLink: '#/operate/evidence/evref_t015_restrict_123456',
      },
    ],
    claims: [],
    rationale: [],
    outcomes: [],
    learnings: [],
    history: [],
    replay: {
      checkpoint: null,
      tail: {
        startSequence: 1,
        endSequence: head.sequence,
        eventCount: head.sequence,
        eventReplayIndexHash: head.hash,
      },
      finalHead: structuredClone(head),
      liveAccessUsed: false,
      parityProof: {
        sourceStateHash: HASH_C,
        eventReplayIndexHash: head.hash,
        checkpointVerified: false,
        finalEventHashMatches: true,
        stateParityVerified: false,
      },
      filterDimensions: [
        'cycle',
        'action',
        'decision',
        'actor',
        'operation',
        'result',
        'event-type',
        'date',
      ],
      redactions: [],
    },
    allowedActions:
      commandable && !emptyInbox && !omitPrimary
        ? [{ subjectId: REVIEW_ID, action: reviewAction(actorId) }]
        : [],
    omissions: [],
    export: { formats: ['json', 'html'], accessSafe: true, redactionCount: 0 },
  };
  return { ...source, viewHash: sha256Jcs(source as never) };
}

type InboxFixture = Readonly<{
  view: RecordValue;
  display: Display;
  binding: DashboardQueryIdentity;
  state: DashboardProductState<Display>;
}>;

function displayBinding(
  view: RecordValue,
  projectId: string,
  generation: number,
  subjectId: string | null,
) {
  return {
    actorId: String(view.actorId),
    scopeId: String(view.scopeId),
    domainId: String(view.domainId),
    domainVersion: String(view.domainVersion),
    generatedAt: String(view.generatedAt),
    eventHead: view.eventHead as never,
    viewHash: String(view.viewHash),
    projectId,
    generation,
    subjectId,
    surface: 'inbox' as const,
  };
}

function queryBinding(
  view: RecordValue,
  projectId: string,
  generation: number,
  route = '#/operate/inbox',
  subjectId: string | null = null,
): DashboardQueryIdentity {
  return createDashboardQueryIdentity({
    productArea: 'operate',
    route,
    actorId: view.actorId,
    projectId,
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
    cycleId: CYCLE_ID,
    subjectId,
    eventHead: view.eventHead,
    viewHash: view.viewHash,
    generation,
  });
}

function productState(
  display: Display,
  binding: DashboardQueryIdentity,
): DashboardProductState<Display> {
  return parseDashboardProductState<Display>(
    {
      kind: 'ready',
      binding,
      data: structuredClone(display),
      reasonCodes: [],
      error: null,
      mutationEnabled: display.payload.mutationEnabled,
      policy: dashboardProductStatePolicy('ready'),
    },
    { currentBinding: binding, validateData: createOperateInboxDisplayValidator(binding) },
  );
}

function fixture({
  actorId = 'owner-t015',
  projectId = PROJECT_ID,
  generation = 7,
  head = Object.freeze({ sequence: 1, hash: HASH_A }),
  commandable = true,
  emptyInbox = false,
  omitPrimary = false,
  route = '#/operate/inbox',
  subjectId = null,
}: {
  actorId?: string;
  projectId?: string;
  generation?: number;
  head?: Readonly<{ sequence: number; hash: string }>;
  commandable?: boolean;
  emptyInbox?: boolean;
  omitPrimary?: boolean;
  route?: string;
  subjectId?: string | null;
} = {}): InboxFixture {
  const view = experienceView({ actorId, head, commandable, emptyInbox, omitPrimary });
  const expected = displayBinding(view, projectId, generation, subjectId);
  const selected = selectOperateExperienceDisplaySurface(view, {
    surface: 'inbox',
    binding: expected,
    subjectId,
    cycleId: CYCLE_ID,
  });
  const display = assertOperateExperienceDisplaySurfaceV1(selected, expected);
  const binding = queryBinding(view, projectId, generation, route, subjectId);
  return Object.freeze({ view, display, binding, state: productState(display, binding) });
}

function previewFixture(
  authority: 'allowed' | 'refused' | 'read-only' = 'allowed',
  expiresAt = '2099-08-16T08:10:00.000Z',
) {
  const base = {
    kind: 'operate-experience-preview',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    previewId: 'xprv_t015_1234567890abcdef',
    scopeId: 'scope-t015',
    domainId: 'business',
    domainVersion: '1.0.0',
    actorId: 'owner-t015',
    subject: { kind: 'review', id: REVIEW_ID, revision: null, hash: HASH_D },
    eventHead: { sequence: 1, hash: HASH_A },
    sourceViewHash: String(experienceView().viewHash),
    actionDigest: ACTION_DIGEST,
    allowedAction: reviewAction('owner-t015'),
    authority,
    consequence: 'Approve the exact Decision without executing a governed Action.',
    reasonCodes: authority === 'allowed' ? [] : ['CAPABILITY_DENIED'],
    transition: {
      kind: 'review',
      targets: [
        {
          kind: 'operating-decision',
          id: DECISION_ID,
          revision: 1,
          hash: HASH_C,
          disposition: 'approved',
        },
      ],
      reversible: false,
      nextState: 'approved',
      threshold: null,
    },
    issuedAt: PRIVATE_ISSUED_AT,
    expiresAt,
  };
  const candidate = { ...base, previewHash: sha256Jcs(base as never) };
  return assertOperateExperiencePreviewV1(candidate, {
    actorId: 'owner-t015',
    scopeId: 'scope-t015',
    domainId: 'business',
    domainVersion: '1.0.0',
    eventHead: { sequence: 1, hash: HASH_A },
    sourceViewHash: String(base.sourceViewHash),
    subjectId: REVIEW_ID,
    actionDigest: ACTION_DIGEST,
  });
}

type ActionHarness = Readonly<{
  actions: InboxActions;
  preview: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
  previewCancel: ReturnType<typeof vi.fn>;
  reconcile: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}>;

function actionHarness({
  issuedPreview = previewFixture(),
  confirmResult = Promise.resolve<InboxActionConfirmation>({
    ok: true,
    eventHead: { sequence: 2, hash: HASH_B },
  }),
  confirmHandler,
  previewResult,
}: {
  issuedPreview?: ReturnType<typeof previewFixture>;
  confirmResult?: Promise<InboxActionConfirmation>;
  confirmHandler?: () => Promise<InboxActionConfirmation>;
  previewResult?: Promise<InboxActionPreview>;
} = {}): ActionHarness {
  const previewCancel = vi.fn();
  const confirm = vi.fn(() => (confirmHandler ? confirmHandler() : confirmResult));
  const custody = Object.freeze({ preview: issuedPreview, confirm, cancel: previewCancel });
  const preview = vi.fn(() => previewResult ?? Promise.resolve(custody));
  const reconcile = vi.fn();
  const cancel = vi.fn();
  const dispose = vi.fn();
  const actions = Object.freeze({
    bind: vi.fn(),
    preview,
    reconcile,
    cancel,
    dispose,
  }) satisfies InboxActions;
  return Object.freeze({ actions, preview, confirm, previewCancel, reconcile, cancel, dispose });
}

function page(subject: InboxFixture, actions = actionHarness(), onRefetch = vi.fn()) {
  return {
    actions,
    onRefetch,
    view: (
      <main aria-label="Inbox test surface">
        <InboxPage
          currentBinding={subject.binding}
          current={subject.state}
          actions={actions.actions}
          onRefetch={onRefetch}
        />
      </main>
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('T-015 verified Inbox model and presentation', () => {
  it('accepts only the parser-branded frozen exact Inbox envelope and preserves owner order', () => {
    const subject = fixture();
    const model = resolveOperateInboxModel(subject.state, subject.binding);
    expect(model?.items.map((item) => item.itemId)).toEqual(
      subject.display.payload.surface === 'inbox'
        ? subject.display.payload.data.inbox.map((item) => item.itemId)
        : [],
    );
    expect(model?.categories.decision.map((item) => item.itemId)).toEqual([
      'decision:dec_t015_12345678',
      'decision:dec_t015_second_1234',
    ]);
    expect(
      resolveOperateInboxModel(Object.freeze({ ...subject.state }), subject.binding),
    ).toBeNull();

    const substitutions: readonly Partial<DashboardQueryIdentity>[] = [
      { actorId: 'foreign-owner' },
      { projectId: `sha256:${'2'.repeat(64)}` },
      { scopeId: 'foreign-scope' },
      { domainId: 'software' },
      { domainVersion: '2.0.0' },
      { generation: subject.binding.generation + 1 },
      { eventHead: { sequence: 2, hash: HASH_B } },
      { viewHash: HASH_E },
    ];
    for (const substitution of substitutions) {
      const foreign = createDashboardQueryIdentity({ ...subject.binding, ...substitution });
      expect(resolveOperateInboxModel(subject.state, foreign)).toBeNull();
    }

    const tampered = structuredClone(subject.display);
    if (tampered.payload.surface !== 'inbox') throw new Error('Expected Inbox display.');
    Reflect.set(tampered.payload.data.inbox[0], 'title', 'UNVERIFIED_TAMPER');
    expect(() => productState(tampered, subject.binding)).toThrow(/owner-boundary contract/u);
  });

  it('renders all categories, exact counts and fields, safe hostile text, and no capability', async () => {
    const subject = fixture();
    const rendered = render(page(subject).view);
    expect(screen.getByRole('tab', { name: 'Decision, 2 items' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Approval, 1 item' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Verification, 1 item' })).toBeTruthy();
    expect(screen.getByText(HOSTILE_TITLE)).toBeTruthy();
    expect(rendered.container.querySelector('img')).toBeNull();
    expect(
      screen.getByText('The Cycle remains blocked until the exact review is resolved.'),
    ).toBeTruthy();
    expect(screen.getAllByText('2099-08-12T08:00:00.000Z').length).toBeGreaterThan(0);
    expect(screen.getByText('evref_t015_support_12345678')).toBeTruthy();
    expect(document.body.textContent).not.toContain(PRIVATE_CAPABILITY);

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Approval, 1 item' }));
    const approvalPanel = screen.getByRole('tabpanel', { name: 'Approval, 1 item' });
    await user.click(within(approvalPanel).getByText('Required parties (1)'));
    expect(within(approvalPanel).getByText('Identity redacted')).toBeTruthy();
    expect(document.body.textContent).not.toContain(PRIVATE_CAPABILITY);
    await user.click(within(approvalPanel).getByText('Redactions (1)'));
    expect(within(approvalPanel).getByText('identity-redacted')).toBeTruthy();
    expect(
      within(approvalPanel).getByText(
        'OPERATE_APPROVAL_PARTY_UNAVAILABLE: This actor is not an eligible remaining approval party.',
      ),
    ).toBeTruthy();

    const results = await axe.run(rendered.container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it('keeps every category reachable when the owner returns an empty Inbox', async () => {
    const subject = fixture({ emptyInbox: true });
    render(page(subject).view);
    const user = userEvent.setup();
    expect(screen.getByRole('tab', { name: 'Decision, 0 items' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Approval, 0 items' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Verification, 0 items' })).toBeTruthy();
    expect(screen.getByText('No decision items')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Approval, 0 items' }));
    expect(screen.getByText('No approval items')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Verification, 0 items' }));
    expect(screen.getByText('No verification items')).toBeTruthy();
  });

  it('uses Radix roving keys and preserves category/focus only across the same selection scope', async () => {
    const first = fixture();
    const controls = actionHarness();
    const refetch = vi.fn();
    const rendered = render(page(first, controls, refetch).view);
    const user = userEvent.setup();
    const decision = screen.getByRole('tab', { name: 'Decision, 2 items' });
    await user.click(decision);
    await user.keyboard('{ArrowRight}');
    let approval = screen.getByRole('tab', { name: 'Approval, 1 item' });
    expect(approval.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(approval);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Verification, 1 item' }));
    await user.keyboard('{Home}{ArrowRight}');
    approval = screen.getByRole('tab', { name: 'Approval, 1 item' });
    expect(document.activeElement).toBe(approval);

    const refreshed = fixture({ head: { sequence: 2, hash: HASH_B } });
    rendered.rerender(page(refreshed, controls, refetch).view);
    approval = screen.getByRole('tab', { name: 'Approval, 1 item' });
    expect(approval.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(approval);

    const foreign = fixture({ actorId: 'other-owner' });
    rendered.rerender(page(foreign, controls, refetch).view);
    expect(
      screen.getByRole('tab', { name: 'Decision, 2 items' }).getAttribute('aria-selected'),
    ).toBe('true');

    rendered.rerender(page(first, controls, refetch).view);
    expect(
      screen.getByRole('tab', { name: 'Decision, 2 items' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('keeps 320px tabs horizontally truthful and reachable with Left and Right keys', async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    try {
      render(page(fixture()).view);
      const user = userEvent.setup();
      const tablist = screen.getByRole('tablist', { name: 'Inbox categories' });
      expect(tablist.getAttribute('aria-orientation')).toBe('horizontal');
      expect(tablist.getAttribute('data-orientation')).toBe('horizontal');

      const decision = screen.getByRole('tab', { name: 'Decision, 2 items' });
      await user.click(decision);
      await user.keyboard('{ArrowRight}');
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Approval, 1 item' }));
      await user.keyboard('{ArrowLeft}');
      expect(document.activeElement).toBe(decision);

      const root = dirname(fileURLToPath(import.meta.url));
      const styles = readFileSync(
        resolve(root, '../../../../apps/dashboard/src/features/operate/inbox/inbox.css'),
        'utf8',
      );
      const narrowStart = styles.indexOf('@media (max-width: 480px)');
      const narrowEnd = styles.indexOf('@media (prefers-reduced-motion: reduce)', narrowStart);
      const narrowStyles = styles.slice(narrowStart, narrowEnd);
      const tabListStart = narrowStyles.indexOf('.op-inbox-tabs__list');
      const tabListEnd = narrowStyles.indexOf('}', tabListStart);
      const tabListStyles = narrowStyles.slice(tabListStart, tabListEnd);
      expect(tabListStyles).toContain('overflow-x: auto');
      expect(tabListStyles).not.toContain('grid-template-columns');
      expect(narrowStyles).toContain('flex: 1 0 max-content');
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: previousWidth,
      });
    }
  });

  it('selects only an exact direct-route item and rejects a missing identity without echo', () => {
    const itemId = 'decision:dec_t015_12345678';
    const exact = fixture({
      route: `#/operate/inbox/${encodeURIComponent(itemId)}`,
      subjectId: itemId,
    });
    const exactHtml = renderToStaticMarkup(
      <InboxPage
        currentBinding={exact.binding}
        current={exact.state}
        actions={actionHarness().actions}
      />,
    );
    expect(exactHtml).toContain(HOSTILE_HTML);
    expect(exactHtml).not.toContain('Another named party must decide');
    expect(exactHtml).not.toContain('A consumed Decision stays visible');

    const missingId = 'private-missing-item-must-not-echo';
    const missingBinding = queryBinding(
      exact.view,
      exact.binding.projectId,
      exact.binding.generation,
      `#/operate/inbox/${missingId}`,
      missingId,
    );
    const missingState = parseDashboardProductState<Display>(
      {
        kind: 'unavailable',
        binding: missingBinding,
        data: null,
        reasonCodes: ['DASHBOARD_UNAVAILABLE'],
        error: null,
        mutationEnabled: false,
        policy: dashboardProductStatePolicy('unavailable'),
      },
      { currentBinding: missingBinding },
    );
    const missingHtml = renderToStaticMarkup(
      <DashboardProviders
        connection={{ state: 'connected', label: 'Connected', reason: 'Verified test connection.' }}
        buildId="t015-missing-item"
        initialHash={`#/operate/inbox/${missingId}`}
        binding={missingBinding}
        projection={missingState}
      >
        <UnifiedShell />
      </DashboardProviders>,
    );
    expect(missingHtml).toContain('This view is unavailable');
    const missingText = new DOMParser().parseFromString(missingHtml, 'text/html').body.textContent;
    expect(missingText).not.toContain(missingId);
    expect(missingHtml).not.toContain(HOSTILE_TITLE);
    expect(missingHtml).not.toContain('Another named party must decide');
  });

  it('keeps observer content readable and exposes the exact unavailable code and message', () => {
    const observer = fixture({ commandable: false });
    render(page(observer).view);
    expect(screen.getByText(HOSTILE_TITLE)).toBeTruthy();
    const button = screen.getAllByRole('button', { name: 'Open verified preview' })[0];
    expect((button as HTMLButtonElement).disabled).toBe(true);
    const descriptionId = button.getAttribute('aria-describedby');
    expect(descriptionId).not.toBeNull();
    const description = descriptionId ? document.getElementById(descriptionId) : null;
    expect(description?.textContent).toContain(
      'CAPABILITY_DENIED: The current actor may inspect but cannot mutate this item.',
    );
    expect(document.body.textContent).not.toContain(PRIVATE_CAPABILITY);
    expect(document.body.textContent).not.toContain(PRIVATE_ARGUMENT);
  });
});

describe('T-015 governed preview lifecycle', () => {
  it('refuses an already-expired preview once without opening confirmation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T08:10:00.000Z'));
    const controls = actionHarness({
      issuedPreview: previewFixture('allowed', '2026-08-16T08:09:59.000Z'),
    });
    const onRefetch = vi.fn();
    render(page(fixture(), controls, onRefetch).view);
    const trigger = screen
      .getAllByRole('button', { name: 'Open verified preview' })
      .find((button) => !button.hasAttribute('disabled'));
    if (!trigger) throw new Error('Expected enabled owner-issued action.');

    await act(async () => {
      fireEvent.click(trigger);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(controls.previewCancel).toHaveBeenCalledOnce();
    expect(controls.cancel).toHaveBeenCalledOnce();
    expect(onRefetch).toHaveBeenCalledOnce();
    expect(screen.getByText(/verified preview expired before confirmation/u)).toBeTruthy();

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(controls.previewCancel).toHaveBeenCalledOnce();
    expect(controls.cancel).toHaveBeenCalledOnce();
    expect(onRefetch).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(document.getElementById(trigger.id));
    expect(document.body.style.overflow).toBe('');
  });

  it('expires an open preview once and clears the timer when a preview closes early', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T08:00:00.000Z'));
    const controls = actionHarness({
      issuedPreview: previewFixture('allowed', '2026-08-16T08:00:05.000Z'),
    });
    const onRefetch = vi.fn();
    const rendered = render(page(fixture(), controls, onRefetch).view);
    const trigger = screen
      .getAllByRole('button', { name: 'Open verified preview' })
      .find((button) => !button.hasAttribute('disabled'));
    if (!trigger) throw new Error('Expected enabled owner-issued action.');
    await act(async () => {
      fireEvent.click(trigger);
      await Promise.resolve();
    });
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(controls.previewCancel).toHaveBeenCalledOnce();
    expect(controls.cancel).toHaveBeenCalledOnce();
    expect(onRefetch).toHaveBeenCalledOnce();
    expect(screen.getByText(/verified preview expired before confirmation/u)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(onRefetch).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(document.getElementById(trigger.id));
    expect(document.body.style.overflow).toBe('');

    rendered.unmount();
    const earlyControls = actionHarness({
      issuedPreview: previewFixture('allowed', '2026-08-16T08:02:00.000Z'),
    });
    const earlyRefetch = vi.fn();
    render(page(fixture(), earlyControls, earlyRefetch).view);
    const earlyTrigger = screen
      .getAllByRole('button', { name: 'Open verified preview' })
      .find((button) => !button.hasAttribute('disabled'));
    if (!earlyTrigger) throw new Error('Expected enabled owner-issued action.');
    await act(async () => {
      fireEvent.click(earlyTrigger);
      await Promise.resolve();
    });
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(earlyControls.previewCancel).toHaveBeenCalledOnce();
    expect(earlyControls.cancel).toHaveBeenCalledOnce();
    expect(earlyRefetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/verified preview expired before confirmation/u)).toBeNull();
  });

  it('passes only the exact locator, renders only verified preview fields, and confirms once', async () => {
    const deferred: { resolve?: (result: InboxActionConfirmation) => void } = {};
    const confirmResult = new Promise<InboxActionConfirmation>((resolveResult) => {
      deferred.resolve = resolveResult;
    });
    const issuedPreview = previewFixture();
    const controls = actionHarness({ confirmResult, issuedPreview });
    const onRefetch = vi.fn();
    const rendered = render(page(fixture(), controls, onRefetch).view);
    const user = userEvent.setup();
    const trigger = screen
      .getAllByRole('button', { name: 'Open verified preview' })
      .find((button) => !button.hasAttribute('disabled'));
    if (!trigger) throw new Error('Expected enabled owner-issued action.');
    await user.click(trigger);
    const dialog = await screen.findByRole('alertdialog');
    expect(controls.preview).toHaveBeenCalledOnce();
    expect(controls.preview).toHaveBeenCalledWith({
      subjectId: REVIEW_ID,
      actionDigest: ACTION_DIGEST,
    });
    expect(Object.keys(controls.preview.mock.calls[0][0])).toEqual(['subjectId', 'actionDigest']);
    expect(within(dialog).getByText(DECISION_ID)).toBeTruthy();
    expect(within(dialog).getAllByText('approved')).toHaveLength(2);
    expect(within(dialog).getByText(ACTION_DIGEST)).toBeTruthy();
    expect(within(dialog).getByText(HASH_D)).toBeTruthy();
    expect(within(dialog).getByText(HASH_A)).toBeTruthy();
    expect(within(dialog).getByText(HASH_C)).toBeTruthy();
    expect(within(dialog).getByText(issuedPreview.previewHash)).toBeTruthy();
    expect(within(dialog).getByText('project-write')).toBeTruthy();
    expect(within(dialog).getByText('No')).toBeTruthy();
    expect(dialog.textContent).not.toContain(PRIVATE_ARGUMENT);
    expect(dialog.textContent).not.toContain(PRIVATE_CAPABILITY);
    expect(dialog.textContent).not.toContain(PRIVATE_ISSUED_AT);
    expect(dialog.textContent).not.toContain(issuedPreview.sourceViewHash);
    expect(dialog.textContent).not.toContain('Authority:');
    expect(dialog.textContent).not.toContain('CAPABILITY_DENIED');
    expect(dialog.textContent).not.toContain('operate.review.submit');

    const confirm = within(dialog).getByRole('button', { name: 'Confirm exact transition' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(controls.confirm).toHaveBeenCalledOnce();
    deferred.resolve?.({ ok: true, eventHead: { sequence: 2, hash: HASH_B } });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onRefetch).toHaveBeenCalledOnce();
    expect(
      screen.getByText('The transition was accepted. The Inbox has been refreshed.'),
    ).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById(trigger.id)));
    expect(document.body.style.overflow).toBe('');

    const results = await axe.run(rendered.container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it('closes and refetches on uncertainty or refusal without retrying or echoing errors', async () => {
    for (const [label, options] of [
      [
        'uncertain',
        {
          confirmResult: Promise.resolve<InboxActionConfirmation>({
            ok: false,
            reasonCode: 'OPERATION_UNCERTAIN',
          }),
        },
      ],
      [
        'refused',
        {
          confirmHandler: async (): Promise<InboxActionConfirmation> => {
            throw new Error(`refused ${PRIVATE_ARGUMENT}`);
          },
        },
      ],
    ] as const) {
      const controls = actionHarness(options);
      const onRefetch =
        label === 'uncertain'
          ? vi.fn().mockRejectedValueOnce(new Error('verified refetch failed'))
          : vi.fn();
      const subject = fixture();
      const rendered = render(page(subject, controls, onRefetch).view);
      const user = userEvent.setup();
      const trigger = screen
        .getAllByRole('button', { name: 'Open verified preview' })
        .find((button) => !button.hasAttribute('disabled'));
      if (!trigger) throw new Error('Expected enabled action.');
      await user.click(trigger);
      await user.click(await screen.findByRole('button', { name: 'Confirm exact transition' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(controls.confirm, label).toHaveBeenCalledOnce();
      expect(onRefetch, label).toHaveBeenCalledOnce();
      expect(document.body.textContent, label).not.toContain(PRIVATE_ARGUMENT);
      if (label === 'uncertain') {
        expect(screen.getByText(/OPERATION_UNCERTAIN/u)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Reconcile current Inbox' })).toBeTruthy();
        expect(controls.reconcile).not.toHaveBeenCalled();
        onRefetch.mockResolvedValue(subject.state);
        await user.click(screen.getByRole('button', { name: 'Reconcile current Inbox' }));
        await screen.findByText(/Exact current Inbox truth was reconciled/u);
        expect(controls.reconcile).toHaveBeenCalledWith(subject.binding);
      } else expect(screen.getByText(/governed confirmation was refused/u)).toBeTruthy();
      rendered.unmount();
      cleanup();
    }
  });

  it('never opens confirmation for a refused verified preview', async () => {
    const controls = actionHarness({ issuedPreview: previewFixture('refused') });
    const onRefetch = vi.fn();
    const user = userEvent.setup();
    const rendered = render(page(fixture(), controls, onRefetch).view);
    const trigger = screen
      .getAllByRole('button', { name: 'Open verified preview' })
      .find((button) => !button.hasAttribute('disabled'));
    if (!trigger) throw new Error('Expected enabled action.');
    await user.click(trigger);
    await waitFor(() => expect(screen.getByText('CAPABILITY_DENIED')).toBeTruthy());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(controls.confirm).not.toHaveBeenCalled();
    expect(onRefetch).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById(trigger.id)));

    const foreign = fixture({
      actorId: 'foreign-notice-owner',
      projectId: `sha256:${'2'.repeat(64)}`,
      generation: 8,
      head: { sequence: 2, hash: HASH_B },
    });
    rendered.rerender(page(foreign, controls, onRefetch).view);
    expect(screen.queryByText('CAPABILITY_DENIED')).toBeNull();
  });

  it('removes an A preview synchronously across invalid state and a foreign B context', async () => {
    const first = fixture();
    const controls = actionHarness();
    const onRefetch = vi.fn();
    const rendered = render(page(first, controls, onRefetch).view);
    const user = userEvent.setup();
    const trigger = screen
      .getAllByRole('button', { name: 'Open verified preview' })
      .find((button) => !button.hasAttribute('disabled'));
    if (!trigger) throw new Error('Expected enabled action.');
    await user.click(trigger);
    const dialog = await screen.findByRole('alertdialog');
    const staleConfirm = within(dialog).getByRole('button', { name: 'Confirm exact transition' });

    const unbranded = Object.freeze({ ...first.state }) as DashboardProductState<unknown>;
    rendered.rerender(
      <main aria-label="Inbox test surface">
        <InboxPage
          currentBinding={first.binding}
          current={unbranded}
          actions={controls.actions}
          onRefetch={onRefetch}
        />
      </main>,
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(staleConfirm);
    expect(controls.confirm).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        rendered.container.querySelector('[data-inbox-focus-workspace]'),
      ),
    );

    const foreign = fixture({ actorId: 'foreign-preview-owner' });
    rendered.rerender(page(foreign, controls, onRefetch).view);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(controls.previewCancel).toHaveBeenCalledOnce();
    expect(controls.cancel).toHaveBeenCalledOnce();
    expect(onRefetch).not.toHaveBeenCalled();
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
  });

  it('restores the connected action trigger when an open preview loses its exact binding', async () => {
    const first = fixture();
    const controls = actionHarness();
    const onRefetch = vi.fn();
    const rendered = render(page(first, controls, onRefetch).view);
    const user = userEvent.setup();
    const trigger = screen
      .getAllByRole('button', { name: 'Open verified preview' })
      .find((button) => !button.hasAttribute('disabled'));
    if (!trigger) throw new Error('Expected enabled action.');
    await user.click(trigger);
    await screen.findByRole('alertdialog');

    const foreign = fixture({ actorId: 'foreign-focus-owner' });
    rendered.rerender(page(foreign, controls, onRefetch).view);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById(trigger.id)));
    expect(controls.previewCancel).toHaveBeenCalledOnce();
    expect(controls.cancel).toHaveBeenCalledOnce();
    expect(onRefetch).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe('');
  });

  it('drops a pending A confirmation on a direct head and view change without a B notice', async () => {
    const deferred: { resolve?: (result: InboxActionConfirmation) => void } = {};
    const controls = actionHarness({
      confirmResult: new Promise<InboxActionConfirmation>((resolveResult) => {
        deferred.resolve = resolveResult;
      }),
    });
    const onRefetch = vi.fn();
    const rendered = render(page(fixture(), controls, onRefetch).view);
    const user = userEvent.setup();
    const trigger = screen
      .getAllByRole('button', { name: 'Open verified preview' })
      .find((button) => !button.hasAttribute('disabled'));
    if (!trigger) throw new Error('Expected enabled action.');
    await user.click(trigger);
    await user.click(await screen.findByRole('button', { name: 'Confirm exact transition' }));
    expect(controls.confirm).toHaveBeenCalledOnce();

    const refreshed = fixture({ head: { sequence: 2, hash: HASH_B } });
    rendered.rerender(page(refreshed, controls, onRefetch).view);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById(trigger.id)));
    deferred.resolve?.({ ok: true, eventHead: { sequence: 2, hash: HASH_B } });
    await Promise.resolve();
    expect(
      screen.queryByText('The transition was accepted. The Inbox has been refreshed.'),
    ).toBeNull();
    expect(onRefetch).not.toHaveBeenCalled();
    expect(controls.previewCancel).toHaveBeenCalledOnce();
    expect(controls.cancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
  });

  it('cancels and refetches once when the active item is removed, then focuses a safe remainder', async () => {
    const controls = actionHarness();
    const deferredRefetch: { resolve?: () => void } = {};
    const onRefetch = vi.fn(
      () =>
        new Promise<void>((resolveRefetch) => {
          deferredRefetch.resolve = resolveRefetch;
        }),
    );
    const rendered = render(page(fixture(), controls, onRefetch).view);
    const user = userEvent.setup();
    const trigger = screen
      .getAllByRole('button', { name: 'Open verified preview' })
      .find((button) => !button.hasAttribute('disabled'));
    if (!trigger) throw new Error('Expected enabled action.');
    await user.click(trigger);
    await screen.findByRole('alertdialog');

    rendered.rerender(page(fixture({ omitPrimary: true }), controls, onRefetch).view);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.querySelector('.op-inbox-dialog__overlay')).toBeNull();
    expect(controls.previewCancel).toHaveBeenCalledOnce();
    expect(controls.cancel).toHaveBeenCalledOnce();
    expect(onRefetch).toHaveBeenCalledOnce();

    const remaining = screen.getByText('A consumed Decision stays visible').closest('article');
    const anchor = remaining?.querySelector<HTMLElement>('[data-inbox-item-trigger-anchor]');
    if (!anchor) throw new Error('Expected a safe remaining trigger anchor.');
    expect(anchor.isConnected).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(anchor));
    expect(deferredRefetch.resolve).toBeTypeOf('function');
    deferredRefetch.resolve?.();
    await act(async () => {
      await Promise.resolve();
    });
    expect(onRefetch).toHaveBeenCalledOnce();
    expect(controls.previewCancel).toHaveBeenCalledOnce();
    expect(controls.cancel).toHaveBeenCalledOnce();
    expect(document.body.style.overflow).toBe('');
  });

  it('cancels late preview, Escape, binding change, and unmount without late reopen', async () => {
    const deferredPreview: { resolve?: (preview: InboxActionPreview) => void } = {};
    const previewResult = new Promise<InboxActionPreview>((resolvePreview) => {
      deferredPreview.resolve = resolvePreview;
    });
    const controls = actionHarness({ previewResult });
    const onRefetch = vi.fn();
    const first = fixture();
    const rendered = render(page(first, controls, onRefetch).view);
    const user = userEvent.setup();
    const firstTrigger = screen
      .getAllByRole('button', { name: 'Open verified preview' })
      .find((button) => !button.hasAttribute('disabled'));
    if (!firstTrigger) throw new Error('Expected enabled action.');
    await user.click(firstTrigger);
    const refreshed = fixture({ head: { sequence: 2, hash: HASH_B } });
    rendered.rerender(page(refreshed, controls, onRefetch).view);
    const lateCustody = Object.freeze({
      preview: previewFixture(),
      confirm: vi.fn(async () => ({
        ok: true as const,
        eventHead: { sequence: 2, hash: HASH_B },
      })),
      cancel: vi.fn(),
    });
    deferredPreview.resolve?.(lateCustody);
    await waitFor(() => expect(lateCustody.cancel).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(controls.cancel).toHaveBeenCalled();

    const escapeControls = actionHarness();
    rendered.rerender(page(refreshed, escapeControls, onRefetch).view);
    const escapeTrigger = screen
      .getAllByRole('button', { name: 'Open verified preview' })
      .find((button) => !button.hasAttribute('disabled'));
    if (!escapeTrigger) throw new Error('Expected enabled action.');
    await user.click(escapeTrigger);
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(escapeControls.previewCancel).toHaveBeenCalled();
    await waitFor(() =>
      expect(document.activeElement).toBe(document.getElementById(escapeTrigger.id)),
    );

    rendered.unmount();
    await Promise.resolve();
    expect(escapeControls.cancel).toHaveBeenCalled();
    expect(escapeControls.dispose).toHaveBeenCalledOnce();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('T-015 shell, source, and responsive boundaries', () => {
  it('routes verified Inbox state and refuses unbranded projection without raw fallback echo', () => {
    const subject = fixture();
    const branded = renderToStaticMarkup(
      <DashboardProviders
        connection={{ state: 'connected', label: 'Connected', reason: 'Verified test connection.' }}
        buildId="t015-shell"
        initialHash="#/operate/inbox"
        binding={subject.binding}
        projection={subject.state}
      >
        <UnifiedShell />
      </DashboardProviders>,
    );
    expect(branded).toContain('Decision and approval Inbox');
    expect(branded).toContain(HOSTILE_HTML);
    expect(branded).not.toContain('Unified boot and first use');

    const raw = 'UNBRANDED_RAW_TITLE_MUST_NOT_ECHO';
    const unbrandedProjection: unknown = Object.freeze({
      kind: 'ready',
      binding: subject.binding,
      data: { title: raw, summary: raw },
    });
    const unbrandedProviderProps: DashboardProvidersProps = {
      connection: { state: 'connected', label: 'Connected', reason: 'Verified test connection.' },
      buildId: 't015-shell',
      initialHash: '#/operate/inbox',
      binding: subject.binding,
      // @ts-expect-error Intentionally bypass compile-time trust to prove the
      // runtime shell rejects an unparsed structural lookalike.
      projection: unbrandedProjection,
      children: <UnifiedShell />,
    };
    const unbranded = renderToStaticMarkup(<DashboardProviders {...unbrandedProviderProps} />);
    expect(unbranded).toContain('Inbox cannot be trusted');
    expect(unbranded).not.toContain(raw);
    expect(unbranded).not.toContain('Unified boot and first use');
  });

  it('contains no local authority/lifecycle/classifier logic and includes required adaptive modes', () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const featureRoot = resolve(root, '../../../../apps/dashboard/src/features/operate/inbox');
    const production = ['inbox-model.ts', 'InboxPage.tsx', 'InboxTabs.tsx', 'InboxItemDetail.tsx']
      .map((file) => readFileSync(resolve(featureRoot, file), 'utf8'))
      .join('\n');
    const styles = readFileSync(resolve(featureRoot, 'inbox.css'), 'utf8');
    expect(production).not.toMatch(
      /\.sort\s*\(|new Set\s*\(|ACTIVE_|lifecycle|localStorage|sessionStorage/u,
    );
    expect(production).not.toMatch(/actionReference|sessionCapability|authorization|privateValue/u);
    expect(production).not.toMatch(
      /preview\.issuedAt|preview\.sourceViewHash|preview\.transition\.threshold\.parties/u,
    );
    expect(production).not.toMatch(/console\.|dangerouslySetInnerHTML/u);
    expect(production).toContain('assertOperateExperienceDisplaySurfaceV1');
    expect(production).toContain('Object.isFrozen');
    expect(styles).toContain('min-height: var(--op-density-control)');
    expect(styles).toContain('@media (max-width: 480px)');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('@media (forced-colors: active)');
    expect(styles).toContain('overflow-wrap: anywhere');
  });
});
