import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActionStateBadge,
  AlertDialog,
  GovernedButton,
  StatePanel,
} from '../../../design-system/components/index.js';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import {
  type DashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../../lib/binding/query-identity.js';
import { InboxItemDetail } from './InboxItemDetail.js';
import { InboxTabs } from './InboxTabs.js';
import { createInboxActions, type InboxActionPreview, type InboxActions } from './inbox-actions.js';
import type { InboxCategory, OperateInboxItem, OperateInboxModel } from './inbox-model.js';
import { resolveOperateInboxModel } from './inbox-model.js';
import '../operate.css';
import './inbox.css';

type InboxNotice = Readonly<{
  contextKey: string;
  tone: 'verified' | 'attention' | 'refusal';
  text: string;
}>;

type ActivePreview = Readonly<{
  itemId: string;
  locator: Readonly<{ subjectId: string; actionDigest: string }>;
  binding: DashboardQueryIdentity;
  contextKey: string;
  selectionScopeKey: string;
  custody: InboxActionPreview;
}>;

const MAX_TIMER_DELAY_MS = 2_147_000_000;

export type InboxPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
  actions?: InboxActions;
  onRefetch?: () => Promise<DashboardProductState<unknown>>;
}>;

function isAbort(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError';
}

function isUncertain(value: unknown): boolean {
  return value instanceof Error && value.name === 'OPERATION_UNCERTAIN';
}

function browserRefetch(): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => window.location.reload(), 0);
}

function exactLocatorMatches(
  item: OperateInboxItem,
  active: Pick<ActivePreview, 'itemId' | 'locator'>,
): boolean {
  return (
    item.itemId === active.itemId &&
    item.actionLocator?.subjectId === active.locator.subjectId &&
    item.actionLocator.actionDigest === active.locator.actionDigest
  );
}

function activePreviewMatchesModel(
  active: ActivePreview,
  model: OperateInboxModel | null,
): boolean {
  return (
    model !== null &&
    active.contextKey === model.actionContextKey &&
    isCurrentDashboardQuery(active.binding, model.binding) &&
    model.items.some((item) => exactLocatorMatches(item, active))
  );
}

function previewExpiryTime(active: ActivePreview): number {
  return Date.parse(active.custody.preview.expiresAt);
}

function previewHasExpired(active: ActivePreview): boolean {
  const expiresAt = previewExpiryTime(active);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

function connectedFocusTarget(
  workspace: HTMLDivElement,
  preferredId: string | null,
): HTMLElement | null {
  const preferred = preferredId === null ? null : document.getElementById(preferredId);
  if (
    preferred instanceof HTMLButtonElement &&
    workspace.contains(preferred) &&
    preferred.isConnected &&
    !preferred.disabled
  ) {
    return preferred;
  }

  const itemWorkspace =
    workspace.querySelector<HTMLElement>('.op-inbox-tabs__panel[data-state="active"]') ??
    workspace.querySelector<HTMLElement>('.op-inbox__detail');
  const anchors = itemWorkspace
    ? [...itemWorkspace.querySelectorAll<HTMLElement>('[data-inbox-item-trigger-anchor]')]
    : [];
  for (const anchor of anchors) {
    const button = anchor.querySelector<HTMLButtonElement>('button.op-governed-button');
    if (button?.isConnected && !button.disabled) return button;
  }
  const disabledAnchor = anchors.find((anchor) => anchor.isConnected);
  if (disabledAnchor) return disabledAnchor;

  const selectedTab = workspace.querySelector<HTMLElement>(
    '.op-inbox-tabs__trigger[aria-selected="true"]',
  );
  if (selectedTab?.isConnected) return selectedTab;
  const heading = workspace.querySelector<HTMLElement>('[data-inbox-focus-heading]');
  if (heading?.isConnected) return heading;
  return workspace.isConnected ? workspace : null;
}

export function InboxPage({ currentBinding, current, actions, onRefetch }: InboxPageProps) {
  const model = useMemo(
    () => resolveOperateInboxModel(current, currentBinding),
    [current, currentBinding],
  );
  const selectionScope = model?.selectionScopeKey ?? null;
  const selectionDefault = model?.detailItem?.kind ?? 'decision';
  const [categorySelection, setCategorySelection] = useState<
    Readonly<{ scope: string | null; category: InboxCategory }>
  >(() => Object.freeze({ scope: selectionScope, category: selectionDefault }));
  const selected =
    categorySelection.scope === selectionScope ? categorySelection.category : selectionDefault;
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [activePreview, setActivePreview] = useState<ActivePreview | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<InboxNotice | null>(null);
  const [uncertainBinding, setUncertainBinding] = useState<DashboardQueryIdentity | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const actionsRef = useRef<InboxActions | null>(actions ?? null);
  const uncertainBindingRef = useRef<DashboardQueryIdentity | null>(null);
  const epochRef = useRef(0);
  const previewFlightRef = useRef(false);
  const confirmFlightRef = useRef(false);
  const triggerRef = useRef<string | null>(null);
  const activePreviewRef = useRef<ActivePreview | null>(null);
  const previewExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedModelRef = useRef<OperateInboxModel | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  const restoreFocus = useCallback((preferredId: string | null) => {
    const focusTrigger = (remaining: number) => {
      const workspace = workspaceRef.current;
      if (!mountedRef.current || !workspace?.isConnected || typeof document === 'undefined') return;
      const preferred = preferredId === null ? null : document.getElementById(preferredId);
      if (
        preferred instanceof HTMLButtonElement &&
        workspace.contains(preferred) &&
        preferred.isConnected &&
        preferred.disabled &&
        remaining > 0 &&
        typeof window !== 'undefined'
      ) {
        window.setTimeout(() => focusTrigger(remaining - 1), 16);
        return;
      }
      connectedFocusTarget(workspace, preferredId)?.focus({ preventScroll: true });
    };
    queueMicrotask(() => {
      if (typeof window === 'undefined') focusTrigger(4);
      else window.setTimeout(() => focusTrigger(4), 0);
    });
  }, []);

  const requestRefetch = useCallback(async (): Promise<DashboardProductState<unknown> | null> => {
    if (onRefetch) {
      const result = await onRefetch();
      return result && typeof result === 'object' ? result : null;
    }
    browserRefetch();
    return null;
  }, [onRefetch]);

  const reconcileUncertain = useCallback(
    async (launch = uncertainBindingRef.current): Promise<void> => {
      if (!launch || reconciling) return;
      setReconciling(true);
      try {
        const verified = await requestRefetch();
        const next = verified?.binding
          ? resolveOperateInboxModel(verified, verified.binding)
          : null;
        if (!next || !actionsRef.current) throw new Error('Exact reconciliation failed.');
        actionsRef.current.reconcile(next.binding);
        uncertainBindingRef.current = null;
        setUncertainBinding(null);
        setNotice({
          contextKey: next.actionContextKey,
          tone: 'verified',
          text: 'Exact current Inbox truth was reconciled. A new governed preview is required.',
        });
      } catch {
        setNotice({
          contextKey: model?.actionContextKey ?? '',
          tone: 'attention',
          text: 'OPERATION_UNCERTAIN · Exact current Inbox truth did not reconcile; do not retry.',
        });
      } finally {
        if (mountedRef.current) setReconciling(false);
      }
    },
    [model?.actionContextKey, reconciling, requestRefetch],
  );

  const clearPreviewExpiryTimer = useCallback(() => {
    const timer = previewExpiryTimerRef.current;
    if (timer === null) return;
    clearTimeout(timer);
    previewExpiryTimerRef.current = null;
  }, []);

  const clearPreview = useCallback(
    (restore: boolean) => {
      clearPreviewExpiryTimer();
      const triggerId = triggerRef.current;
      triggerRef.current = null;
      epochRef.current += 1;
      const active = activePreviewRef.current;
      const hadInteraction =
        active !== null || previewFlightRef.current || confirmFlightRef.current;
      active?.custody.cancel();
      if (hadInteraction) actionsRef.current?.cancel();
      activePreviewRef.current = null;
      previewFlightRef.current = false;
      confirmFlightRef.current = false;
      setPendingItemId(null);
      setActivePreview(null);
      setConfirming(false);
      setDialogOpen(false);
      if (restore) restoreFocus(triggerId);
      return triggerId;
    },
    [clearPreviewExpiryTimer, restoreFocus],
  );

  const expireActivePreview = useCallback(
    (active: ActivePreview) => {
      if (
        !mountedRef.current ||
        activePreviewRef.current !== active ||
        !activePreviewMatchesModel(active, committedModelRef.current)
      ) {
        return;
      }
      clearPreview(true);
      setNotice({
        contextKey: active.contextKey,
        tone: 'attention',
        text: 'The verified preview expired before confirmation. Current Inbox truth is being refreshed.',
      });
      void requestRefetch();
    },
    [clearPreview, requestRefetch],
  );

  const schedulePreviewExpiry = useCallback(
    (active: ActivePreview) => {
      clearPreviewExpiryTimer();
      const arm = () => {
        if (!mountedRef.current || activePreviewRef.current !== active) return;
        const remaining = previewExpiryTime(active) - Date.now();
        if (!Number.isFinite(remaining) || remaining <= 0) {
          previewExpiryTimerRef.current = null;
          expireActivePreview(active);
          return;
        }
        previewExpiryTimerRef.current = setTimeout(arm, Math.min(remaining, MAX_TIMER_DELAY_MS));
      };
      arm();
    },
    [clearPreviewExpiryTimer, expireActivePreview],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (actions) actionsRef.current = actions;
    if (!actionsRef.current && typeof window !== 'undefined') {
      actionsRef.current = createInboxActions({ origin: window.location.origin });
    }
    return () => {
      mountedRef.current = false;
      epochRef.current += 1;
      clearPreviewExpiryTimer();
      const manager = actionsRef.current;
      activePreviewRef.current?.custody.cancel();
      manager?.cancel();
      activePreviewRef.current = null;
      previewFlightRef.current = false;
      confirmFlightRef.current = false;
      queueMicrotask(() => {
        if (!mountedRef.current || actionsRef.current !== manager) manager?.dispose();
        if (!mountedRef.current && actionsRef.current === manager) {
          actionsRef.current = null;
        }
      });
    };
  }, [actions, clearPreviewExpiryTimer]);

  useLayoutEffect(() => {
    if (categorySelection.scope !== selectionScope) {
      setCategorySelection(Object.freeze({ scope: selectionScope, category: selectionDefault }));
    }
  }, [categorySelection.scope, selectionDefault, selectionScope]);

  useLayoutEffect(() => {
    const previousModel = committedModelRef.current;
    committedModelRef.current = model;
    const currentContext = model?.actionContextKey ?? null;
    setNotice((currentNotice) =>
      currentNotice !== null && currentNotice.contextKey !== currentContext ? null : currentNotice,
    );

    const active = activePreviewRef.current;
    const contextChanged = previousModel?.actionContextKey !== currentContext;
    const invalidActive = active !== null && !activePreviewMatchesModel(active, model);
    if (
      !invalidActive &&
      !(contextChanged && (previewFlightRef.current || confirmFlightRef.current))
    ) {
      return;
    }

    const itemRemoved =
      active !== null &&
      model !== null &&
      active.selectionScopeKey === model.selectionScopeKey &&
      !model.items.some((item) => exactLocatorMatches(item, active));
    const removalScope = active?.selectionScopeKey ?? null;
    const triggerId = clearPreview(false);
    restoreFocus(triggerId);
    if (itemRemoved) {
      if (committedModelRef.current?.selectionScopeKey === removalScope) void requestRefetch();
    }
  }, [clearPreview, model, requestRefetch, restoreFocus]);

  useEffect(() => {
    const manager = actions ?? actionsRef.current;
    if (!manager || !model) return;
    try {
      manager.bind(model.binding);
    } catch {
      setNotice({
        contextKey: model.actionContextKey,
        tone: 'refusal',
        text: 'The governed Inbox adapter refused this exact route binding.',
      });
    }
  }, [actions, model]);

  const selectCategory = useCallback(
    (category: InboxCategory) => {
      setCategorySelection(Object.freeze({ scope: selectionScope, category }));
    },
    [selectionScope],
  );

  const openPreview = useCallback(
    async (item: OperateInboxItem, triggerId: string) => {
      const locator = item.actionLocator;
      const manager = actionsRef.current;
      if (!model || !locator || !manager || previewFlightRef.current) return;
      const launchBinding = model.binding;
      const launchContext = model.actionContextKey;
      const launchSelectionScope = model.selectionScopeKey;
      previewFlightRef.current = true;
      const attempt = ++epochRef.current;
      triggerRef.current = triggerId;
      setPendingItemId(item.itemId);
      setNotice(null);
      try {
        manager.bind(launchBinding);
        const custody = await manager.preview({
          subjectId: locator.subjectId,
          actionDigest: locator.actionDigest,
        });
        const currentModel = committedModelRef.current;
        const stillCurrent =
          currentModel !== null &&
          currentModel.actionContextKey === launchContext &&
          isCurrentDashboardQuery(launchBinding, currentModel.binding) &&
          currentModel.items.some((candidate) =>
            exactLocatorMatches(candidate, {
              itemId: item.itemId,
              locator,
            }),
          );
        if (!mountedRef.current || attempt !== epochRef.current || !stillCurrent) {
          custody.cancel();
          return;
        }
        if (custody.preview.authority !== 'allowed') {
          custody.cancel();
          manager.cancel();
          setNotice({
            contextKey: launchContext,
            tone: 'refusal',
            text:
              custody.preview.reasonCodes.length > 0
                ? custody.preview.reasonCodes.join(' · ')
                : `Preview authority: ${custody.preview.authority}.`,
          });
          const focusId = triggerRef.current;
          triggerRef.current = null;
          restoreFocus(focusId);
          await requestRefetch();
          return;
        }
        const active = Object.freeze({
          itemId: item.itemId,
          locator: Object.freeze({
            subjectId: locator.subjectId,
            actionDigest: locator.actionDigest,
          }),
          binding: launchBinding,
          contextKey: launchContext,
          selectionScopeKey: launchSelectionScope,
          custody,
        });
        if (previewHasExpired(active)) {
          custody.cancel();
          clearPreview(true);
          setNotice({
            contextKey: launchContext,
            tone: 'attention',
            text: 'The verified preview expired before confirmation. Current Inbox truth is being refreshed.',
          });
          await requestRefetch();
          return;
        }
        activePreviewRef.current = active;
        setActivePreview(active);
        setDialogOpen(true);
        schedulePreviewExpiry(active);
      } catch (cause) {
        const currentModel = committedModelRef.current;
        if (
          !isAbort(cause) &&
          mountedRef.current &&
          attempt === epochRef.current &&
          currentModel?.actionContextKey === launchContext &&
          isCurrentDashboardQuery(launchBinding, currentModel.binding)
        ) {
          manager.cancel();
          if (isUncertain(cause)) {
            uncertainBindingRef.current = launchBinding;
            setUncertainBinding(launchBinding);
          }
          setNotice({
            contextKey: launchContext,
            tone: isUncertain(cause) ? 'attention' : 'refusal',
            text: isUncertain(cause)
              ? 'The governed preview outcome is uncertain. Exact current Inbox truth must reconcile before retry.'
              : 'The governed preview was refused. Current Inbox truth is being refreshed.',
          });
          const focusId = triggerRef.current;
          triggerRef.current = null;
          restoreFocus(focusId);
          if (isUncertain(cause)) await reconcileUncertain(launchBinding);
          else await requestRefetch();
        }
      } finally {
        if (attempt === epochRef.current) {
          previewFlightRef.current = false;
          if (mountedRef.current) setPendingItemId(null);
        }
      }
    },
    [clearPreview, model, reconcileUncertain, requestRefetch, restoreFocus, schedulePreviewExpiry],
  );

  const confirmPreview = useCallback(async () => {
    const active = activePreviewRef.current;
    if (!active || confirmFlightRef.current) return;
    if (!activePreviewMatchesModel(active, committedModelRef.current)) {
      clearPreview(true);
      return;
    }
    if (previewHasExpired(active)) {
      expireActivePreview(active);
      return;
    }
    confirmFlightRef.current = true;
    const attempt = epochRef.current;
    setConfirming(true);
    try {
      const result = await active.custody.confirm();
      if (
        !mountedRef.current ||
        attempt !== epochRef.current ||
        !activePreviewMatchesModel(active, committedModelRef.current)
      ) {
        return;
      }
      if (result.ok) {
        setNotice({
          contextKey: active.contextKey,
          tone: 'verified',
          text: 'The transition was accepted. The Inbox has been refreshed.',
        });
      } else {
        uncertainBindingRef.current = active.binding;
        setUncertainBinding(active.binding);
        setNotice({ contextKey: active.contextKey, tone: 'attention', text: result.reasonCode });
      }
      clearPreview(true);
      if (result.ok) await requestRefetch();
      else await reconcileUncertain(active.binding);
    } catch (cause) {
      if (
        !isAbort(cause) &&
        mountedRef.current &&
        attempt === epochRef.current &&
        activePreviewMatchesModel(active, committedModelRef.current)
      ) {
        setNotice({
          contextKey: active.contextKey,
          tone: 'refusal',
          text: 'The governed confirmation was refused. Current Inbox truth is being refreshed.',
        });
        clearPreview(true);
        await requestRefetch();
      }
    } finally {
      if (attempt === epochRef.current) {
        confirmFlightRef.current = false;
        if (mountedRef.current) setConfirming(false);
      }
    }
  }, [clearPreview, expireActivePreview, reconcileUncertain, requestRefetch]);

  if (!model) {
    return (
      <div
        ref={workspaceRef}
        className="op-workspace op-inbox pc-operate"
        data-inbox-focus-workspace=""
        data-route-kind="operate.inbox"
        tabIndex={-1}
      >
        <StatePanel
          state="incompatible"
          eyebrow="Inbox projection"
          title="Inbox cannot be trusted"
          description="The owner-issued Inbox did not pass exact binding and integrity verification."
        />
      </div>
    );
  }

  if (model.detailRequested && !model.detailItem) {
    return (
      <div
        ref={workspaceRef}
        className="op-workspace op-inbox pc-operate"
        data-inbox-focus-workspace=""
        data-route-kind="operate.inbox-item"
        tabIndex={-1}
      >
        <header className="op-inbox__header">
          <div>
            <p className="op-eyebrow">Operate · Inbox</p>
            <h1 data-inbox-focus-heading="" tabIndex={-1}>
              Inbox item not found
            </h1>
            <p>This item is not available in the current Inbox.</p>
          </div>
        </header>
        <StatePanel
          state="unavailable"
          eyebrow="Not found"
          title="No matching Inbox item"
          description="Return to the Inbox to review the work that is currently available."
          actions={
            <a className="op-inline-action" href="#/operate/inbox">
              Return to Inbox
            </a>
          }
        />
      </div>
    );
  }

  const currentNotice = notice?.contextKey === model.actionContextKey ? notice : null;
  const uncertain = uncertainBinding !== null;
  const currentActive =
    activePreview !== null && activePreviewMatchesModel(activePreview, model)
      ? activePreview
      : null;
  const preview = currentActive?.custody.preview ?? null;
  return (
    <div
      ref={workspaceRef}
      className="op-workspace op-inbox"
      data-inbox-focus-workspace=""
      data-route-kind={model.detailRequested ? 'operate.inbox-item' : 'operate.inbox'}
      data-inbox-presentation={model.presentation}
      tabIndex={-1}
    >
      <header className="op-inbox__header">
        <div>
          <p className="op-eyebrow">Operate · Inbox</p>
          <h1 data-inbox-focus-heading="" tabIndex={-1}>
            {model.detailItem?.title ?? 'Decision and approval Inbox'}
          </h1>
          <p>Review decisions, approvals, and verification work.</p>
          <ActionStateBadge state={model.presentation} />
        </div>
        <dl className="op-inbox__custody">
          <div>
            <dt>Items</dt>
            <dd>{model.items.length}</dd>
          </div>
        </dl>
      </header>

      <details className="op-inbox__technical">
        <summary>Technical details</summary>
        <dl className="op-inbox__custody">
          <div>
            <dt>View state</dt>
            <dd>{model.presentation}</dd>
          </div>
          <div>
            <dt>Event record</dt>
            <dd>
              <code>
                {model.surface.eventHead.sequence} · {model.surface.eventHead.hash ?? 'genesis'}
              </code>
            </dd>
          </div>
          <div>
            <dt>View key</dt>
            <dd>
              <code>{model.surface.viewHash}</code>
            </dd>
          </div>
        </dl>
      </details>

      {model.presentation !== 'ready' ? (
        <p className="pc-operate__notice" role="status">
          Current access-safe Inbox truth remains visible. Mutation is unavailable on this{' '}
          {model.presentation} projection.
        </p>
      ) : null}

      {currentNotice ? (
        <p
          className="pc-operate__notice"
          data-tone={currentNotice.tone}
          role="status"
          aria-live="polite"
        >
          {currentNotice.text}
        </p>
      ) : null}

      {uncertain ? (
        <StatePanel
          state="incompatible"
          eyebrow="Uncertain operation"
          title="Inbox stays locked until exact reconciliation"
          description="A governed POST may have taken effect. OpenPlanr will not offer a blind retry."
          actions={
            <GovernedButton
              disabled={!onRefetch || reconciling}
              disabledReason="A parser-verified current Inbox projection is required."
              onInvoke={() => void reconcileUncertain()}
            >
              {reconciling ? 'Reconciling current Inbox…' : 'Reconcile current Inbox'}
            </GovernedButton>
          }
        />
      ) : null}

      {model.detailItem ? (
        <section className="op-inbox__detail" aria-labelledby="op-inbox-detail-title">
          <div className="op-inbox__section-heading">
            <div>
              <p className="op-eyebrow">Selected item</p>
              <h2 id="op-inbox-detail-title">Review item</h2>
            </div>
            <p>This item is available in the current Inbox.</p>
          </div>
          <InboxItemDetail
            item={model.detailItem}
            mutationEnabled={model.mutationEnabled && !uncertain && !reconciling}
            pendingItemId={pendingItemId}
            surfaceReasonCodes={model.surface.reasonCodes}
            showDeepLink={false}
            onPreview={openPreview}
          />
        </section>
      ) : (
        <InboxTabs
          model={model}
          mutationEnabled={model.mutationEnabled && !uncertain && !reconciling}
          selected={selected}
          pendingItemId={pendingItemId}
          onSelectedChange={selectCategory}
          onPreview={openPreview}
        />
      )}

      <AlertDialog.Root
        open={dialogOpen && preview !== null}
        onOpenChange={(open) => {
          if (!open && !confirmFlightRef.current) clearPreview(true);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="op-inbox-dialog__overlay" />
          <AlertDialog.Content
            className="op-inbox-dialog__content"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
            }}
          >
            {preview ? (
              <>
                <p className="op-eyebrow">Verified governed preview</p>
                <AlertDialog.Title className="op-inbox-dialog__title">
                  Confirm the exact transition
                </AlertDialog.Title>
                <AlertDialog.Description className="op-inbox-dialog__description">
                  {preview.consequence}
                </AlertDialog.Description>

                <dl className="op-inbox-dialog__facts">
                  <div>
                    <dt>Subject kind and ID</dt>
                    <dd>
                      {preview.subject.kind} <code>{preview.subject.id}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Revision</dt>
                    <dd>{preview.subject.revision ?? 'Not returned'}</dd>
                  </div>
                  <div>
                    <dt>Subject hash</dt>
                    <dd>
                      <code>{preview.subject.hash ?? 'No subject hash returned'}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Event head sequence</dt>
                    <dd>
                      <code>{preview.eventHead.sequence}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Event head hash</dt>
                    <dd>
                      <code>{preview.eventHead.hash ?? 'No event hash returned'}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Expires</dt>
                    <dd>
                      <time dateTime={preview.expiresAt}>{preview.expiresAt}</time>
                    </dd>
                  </div>
                  <div>
                    <dt>Effect</dt>
                    <dd>{preview.allowedAction.effect}</dd>
                  </div>
                  <div>
                    <dt>Reversible</dt>
                    <dd>{preview.transition.reversible ? 'Yes' : 'No'}</dd>
                  </div>
                  <div>
                    <dt>Next state</dt>
                    <dd>{preview.transition.nextState}</dd>
                  </div>
                  <div>
                    <dt>Action digest</dt>
                    <dd>
                      <code>{preview.actionDigest}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Preview digest</dt>
                    <dd>
                      <code>{preview.previewHash}</code>
                    </dd>
                  </div>
                </dl>

                <section className="op-inbox-dialog__targets" aria-labelledby="op-preview-targets">
                  <h2 id="op-preview-targets">Exact targets and dispositions</h2>
                  <ol>
                    {preview.transition.targets.map((target) => (
                      <li key={`${target.kind}:${target.id}`}>
                        <strong>{target.kind}</strong>
                        <code>{target.id}</code>
                        <span>Revision {target.revision ?? 'not returned'}</span>
                        <code>{target.hash ?? 'No target hash returned'}</code>
                        <span>{target.disposition ?? 'No disposition returned'}</span>
                      </li>
                    ))}
                  </ol>
                </section>

                {preview.transition.threshold ? (
                  <section
                    className="op-inbox-dialog__threshold"
                    aria-labelledby="op-preview-threshold"
                  >
                    <h2 id="op-preview-threshold">Approval threshold</h2>
                    <p>
                      {preview.transition.threshold.recorded} recorded ·{' '}
                      {preview.transition.threshold.required} required ·{' '}
                      {preview.transition.threshold.remaining} remaining
                    </p>
                  </section>
                ) : null}

                <div className="op-inbox-dialog__actions">
                  <AlertDialog.Cancel asChild>
                    <button type="button" className="op-inbox-dialog__cancel" disabled={confirming}>
                      Cancel
                    </button>
                  </AlertDialog.Cancel>
                  <button
                    type="button"
                    className="op-governed-button op-inbox-dialog__confirm"
                    disabled={confirming}
                    aria-busy={confirming || undefined}
                    onClick={confirmPreview}
                  >
                    {confirming ? 'Waiting for durable acceptance' : 'Confirm exact transition'}
                  </button>
                </div>
              </>
            ) : null}
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
