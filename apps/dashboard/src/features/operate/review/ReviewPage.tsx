import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionStateBadge,
  GovernedButton,
  StatePanel,
} from '../../../design-system/components/index.js';
import {
  type DashboardProductState,
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../lib/api/product-state.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
} from '../../../lib/binding/query-identity.js';
import { ReviewChoiceConfirmation } from './ReviewChoiceConfirmation.js';
import { ReviewEvidenceTrace } from './ReviewEvidenceTrace.js';
import { ReviewReceipt } from './ReviewReceipt.js';
import {
  createReviewActions,
  type ReviewActions,
  type ReviewCommandPreview,
  type ReviewConfirmation,
} from './review-actions.js';
import {
  createOperateReviewDisplayValidator,
  type OperateReviewChoiceModel,
  type OperateReviewModel,
  resolveOperateReviewModel,
} from './review-model.js';
import '../operate.css';
import './review.css';

type Notice = Readonly<{ tone: 'verified' | 'attention' | 'refusal'; text: string }>;
type ActiveReviewPreview = Readonly<{
  bindingKey: string;
  epoch: number;
  choiceId: string;
  choiceHash: string;
  locator: NonNullable<OperateReviewChoiceModel['locator']>;
  choice: OperateReviewChoiceModel;
  custody: ReviewCommandPreview;
}>;

const DETERMINATE_REVIEW_REJECTIONS = new Set([
  'CAPABILITY_DENIED',
  'CONCURRENT_MODIFICATION',
  'OPERATE_ACTION_REFERENCE_STALE',
  'OPERATE_BINDING_MISMATCH',
  'OPERATE_PREVIEW_EXPIRED',
  'OPERATE_PREVIEW_STALE',
  'OPERATE_SESSION_EXPIRED',
  'OPERATE_SESSION_STALE',
]);

function rejectionCode(cause: unknown): string {
  if (!(cause instanceof Error)) return '';
  const code = (cause as Error & { code?: unknown }).code;
  return typeof code === 'string' ? code : cause.name;
}

function human(value: string): string {
  const words = value.replaceAll('-', ' ').replaceAll('_', ' ');
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

function confirmedReviewModel(
  confirmation: Extract<ReviewConfirmation, { ok: true }>,
  current: OperateReviewModel,
): OperateReviewModel | null {
  const workspace = confirmation.workspace;
  const binding = createDashboardQueryIdentity({
    ...current.binding,
    eventHead: workspace.payload.sourceEventHead,
    viewHash: workspace.payload.sourceViewHash,
  });
  const state = parseDashboardProductState(
    {
      kind: 'read-only',
      binding,
      data: workspace,
      reasonCodes: ['DASHBOARD_READ_ONLY'],
      error: null,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy('read-only'),
    },
    {
      currentBinding: binding,
      validateData: createOperateReviewDisplayValidator(binding),
    },
  );
  return resolveOperateReviewModel(state, binding);
}

export function ReviewPage({
  currentBinding,
  current,
  onRefetch,
  actions,
}: {
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
  onRefetch?: () => Promise<DashboardProductState<unknown>>;
  actions?: ReviewActions;
}) {
  const currentModel = useMemo(
    () => resolveOperateReviewModel(current, currentBinding),
    [current, currentBinding],
  );
  const actionsRef = useRef<ReviewActions | null>(actions ?? null);
  const epochRef = useRef(0);
  const interactionLockedRef = useRef(false);
  const [selection, setSelection] = useState<Readonly<{
    bindingKey: string;
    choiceId: string;
  }> | null>(null);
  const [activePreviewState, setActivePreviewState] = useState<ActiveReviewPreview | null>(null);
  const [previewPendingKey, setPreviewPendingKey] = useState<string | null>(null);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [uncertainScope, setUncertainScope] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmationState, setConfirmationState] = useState<Readonly<{
    scopeKey: string;
    result: Extract<ReviewConfirmation, { ok: true }>;
  }> | null>(null);
  const bindingKey = currentModel
    ? JSON.stringify([
        currentModel.binding.route,
        currentModel.binding.eventHead,
        currentModel.binding.viewHash,
      ])
    : 'invalid';
  const scopeKey = currentModel
    ? JSON.stringify([
        currentModel.binding.route,
        currentModel.binding.actorId,
        currentModel.binding.projectId,
        currentModel.binding.scopeId,
        currentModel.binding.domainId,
        currentModel.binding.domainVersion,
        currentModel.binding.cycleId,
        currentModel.binding.subjectId,
        currentModel.binding.generation,
      ])
    : 'invalid';
  const currentBindingKeyRef = useRef(bindingKey);
  const currentScopeKeyRef = useRef(scopeKey);
  currentBindingKeyRef.current = bindingKey;
  currentScopeKeyRef.current = scopeKey;

  useEffect(() => {
    if (!actionsRef.current && typeof window !== 'undefined') {
      actionsRef.current = createReviewActions({ origin: window.location.origin });
    }
    if (currentModel) actionsRef.current?.bind(currentModel.binding);
  }, [currentModel]);

  useEffect(() => {
    currentBindingKeyRef.current = bindingKey;
    epochRef.current += 1;
    interactionLockedRef.current = false;
    actionsRef.current?.cancel();
    setSelection(null);
    setActivePreviewState((preview) => {
      preview?.custody.cancel();
      return null;
    });
    setPreviewPendingKey(null);
    setConfirmingKey(null);
    setNotice(null);
  }, [bindingKey]);

  useEffect(() => {
    setConfirmationState((value) => (value?.scopeKey === scopeKey ? value : null));
    setUncertainScope((value) => (value === scopeKey ? value : null));
    const frame = requestAnimationFrame(() => {
      if (currentScopeKeyRef.current === scopeKey) {
        document.querySelector<HTMLElement>('[data-route-kind="operate.review"] h1')?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [scopeKey]);

  useEffect(
    () => () => {
      actionsRef.current?.dispose();
      actionsRef.current = null;
    },
    [],
  );

  const selectedChoice =
    selection?.bindingKey === bindingKey
      ? (currentModel?.choices.find(({ choice }) => choice.choiceId === selection.choiceId) ?? null)
      : null;
  const activePreview = activePreviewState?.bindingKey === bindingKey ? activePreviewState : null;
  const confirmation = confirmationState?.scopeKey === scopeKey ? confirmationState.result : null;
  const confirmationModel = useMemo(
    () => (confirmation && currentModel ? confirmedReviewModel(confirmation, currentModel) : null),
    [confirmation, currentModel],
  );
  const model = confirmation ? confirmationModel : currentModel;
  const uncertain = uncertainScope === scopeKey;
  const previewPending = previewPendingKey === bindingKey;
  const confirming = confirmingKey === bindingKey;
  const settledWorkspace = model?.terminal ? model.workspace : null;
  const mutationEnabled = Boolean(currentModel?.mutationEnabled && !uncertain && !confirmation);
  const interactionLocked = previewPending || activePreview !== null || confirming;

  const cancelPreview = useCallback(() => {
    epochRef.current += 1;
    activePreviewState?.custody.cancel();
    actionsRef.current?.cancel();
    interactionLockedRef.current = false;
    setActivePreviewState(null);
    setPreviewPendingKey(null);
    setConfirmingKey(null);
    requestAnimationFrame(() => {
      if (currentBindingKeyRef.current === bindingKey) {
        document.querySelector<HTMLElement>('#op-review-choice-preview-trigger')?.focus();
      }
    });
  }, [activePreviewState, bindingKey]);

  const openPreview = useCallback(async () => {
    if (
      !currentModel ||
      !selectedChoice?.locator ||
      !mutationEnabled ||
      previewPending ||
      interactionLockedRef.current
    ) {
      return;
    }
    const manager = actionsRef.current;
    if (!manager) return;
    const launchBindingKey = bindingKey;
    const launchEpoch = epochRef.current + 1;
    epochRef.current = launchEpoch;
    const capturedChoice = selectedChoice;
    const capturedLocator = Object.freeze({ ...selectedChoice.locator });
    interactionLockedRef.current = true;
    setPreviewPendingKey(launchBindingKey);
    setNotice(null);
    let accepted = false;
    let uncertaintyLocked = false;
    try {
      manager.bind(currentModel.binding);
      const custody = await manager.preview(capturedLocator);
      if (currentBindingKeyRef.current !== launchBindingKey || epochRef.current !== launchEpoch) {
        custody.cancel();
        return;
      }
      accepted = true;
      setActivePreviewState(
        Object.freeze({
          bindingKey: launchBindingKey,
          epoch: launchEpoch,
          choiceId: capturedChoice.choice.choiceId,
          choiceHash: capturedChoice.choice.choiceHash,
          locator: capturedLocator,
          choice: capturedChoice,
          custody,
        }),
      );
    } catch (cause) {
      if (currentBindingKeyRef.current !== launchBindingKey || epochRef.current !== launchEpoch) {
        return;
      }
      const code = rejectionCode(cause);
      if (code === 'AbortError') return;
      if (code === 'OPERATION_UNCERTAIN') {
        uncertaintyLocked = true;
        setUncertainScope(scopeKey);
      }
      setNotice({
        tone: code === 'OPERATION_UNCERTAIN' ? 'attention' : 'refusal',
        text:
          code === 'OPERATION_UNCERTAIN'
            ? 'The preview outcome is uncertain. This Review is locked against blind retry.'
            : 'The exact Review preview was refused. Refresh current Review truth before trying again.',
      });
    } finally {
      if (currentBindingKeyRef.current === launchBindingKey && epochRef.current === launchEpoch) {
        setPreviewPendingKey(null);
        if (!accepted && !uncertaintyLocked) interactionLockedRef.current = false;
      }
    }
  }, [bindingKey, currentModel, mutationEnabled, previewPending, scopeKey, selectedChoice]);

  const confirmChoice = useCallback(
    async (note: string | null) => {
      if (!activePreview || confirming) return;
      const captured = activePreview;
      const launchBindingKey = captured.bindingKey;
      const launchScopeKey = scopeKey;
      setConfirmingKey(launchBindingKey);
      try {
        const result = await captured.custody.confirm({ note });
        if (
          currentBindingKeyRef.current !== launchBindingKey ||
          currentScopeKeyRef.current !== launchScopeKey ||
          epochRef.current !== captured.epoch
        ) {
          return;
        }
        if (result.ok) {
          setConfirmationState(Object.freeze({ scopeKey: launchScopeKey, result }));
          setNotice({ tone: 'verified', text: 'The immutable Review receipt was recorded.' });
          setActivePreviewState(null);
          interactionLockedRef.current = false;
          await onRefetch?.().catch(() => undefined);
          requestAnimationFrame(() => {
            if (currentScopeKeyRef.current === launchScopeKey) {
              document.querySelector<HTMLElement>('#op-review-receipt-title')?.focus();
            }
          });
          return;
        }
        setActivePreviewState(null);
        actionsRef.current?.cancel();
        if (result.reasonCode === 'OPERATION_UNCERTAIN') {
          setUncertainScope(launchScopeKey);
          setNotice({
            tone: 'attention',
            text: 'The durable result is uncertain. Open Recovery; do not submit this choice again.',
          });
          return;
        }
        interactionLockedRef.current = false;
        setNotice({
          tone: result.reasonCode === 'CONCURRENT_MODIFICATION' ? 'attention' : 'refusal',
          text:
            result.reasonCode === 'CONCURRENT_MODIFICATION'
              ? `Review truth changed. ${result.allowedActionDigests.length} current legal choices are available after refresh.`
              : 'The owner capability no longer permits this Review choice.',
        });
        await onRefetch?.().catch(() => undefined);
      } catch (cause) {
        if (
          currentBindingKeyRef.current !== launchBindingKey ||
          currentScopeKeyRef.current !== launchScopeKey ||
          epochRef.current !== captured.epoch
        ) {
          return;
        }
        const code = rejectionCode(cause);
        if (code === 'AbortError') return;
        captured.custody.cancel();
        actionsRef.current?.cancel();
        setActivePreviewState(null);
        if (code === 'OPERATION_UNCERTAIN' || !DETERMINATE_REVIEW_REJECTIONS.has(code)) {
          setUncertainScope(launchScopeKey);
          setNotice({
            tone: 'attention',
            text: 'The durable result is uncertain. Open Recovery; do not submit this choice again.',
          });
          return;
        }
        interactionLockedRef.current = false;
        setNotice({
          tone: code === 'CAPABILITY_DENIED' ? 'refusal' : 'attention',
          text:
            code === 'CAPABILITY_DENIED'
              ? 'The owner capability no longer permits this Review choice.'
              : 'Review truth changed or the preview expired. Current legal choices are being refreshed.',
        });
        await onRefetch?.().catch(() => undefined);
      } finally {
        if (currentBindingKeyRef.current === launchBindingKey) setConfirmingKey(null);
      }
    },
    [activePreview, confirming, onRefetch, scopeKey],
  );

  if (!model) {
    return (
      <div className="op-workspace op-review pc-operate" data-route-kind="operate.review">
        <StatePanel
          state="incompatible"
          eyebrow="Review projection"
          title="Review cannot be trusted"
          description="The owner-issued Review workspace did not pass exact route, actor, event, and integrity validation."
        />
      </div>
    );
  }

  const { data } = model.payload;
  return (
    <article
      className="op-workspace op-review pc-operate"
      data-route-kind="operate.review"
      data-review-presentation={confirmation ? 'terminal' : model.presentation}
    >
      <nav aria-label="Review breadcrumb" className="op-review__breadcrumb">
        <a href={`#/operate/cycles/${encodeURIComponent(model.payload.cycleId)}`}>Cycle</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Review</span>
      </nav>
      <header className="op-review__hero" data-review-useful="">
        <div>
          <p className="op-eyebrow">planr-operate · executive decision docket</p>
          <h1 tabIndex={-1}>Owner Review</h1>
          <p className="op-review__lede">{data.executiveSummary.text}</p>
          <ActionStateBadge
            state={confirmation ? 'terminal' : model.presentation}
            label={human(confirmation ? 'terminal' : model.presentation)}
          />
        </div>
        <dl className="op-review__status">
          <div>
            <dt>Status</dt>
            <dd>{human(confirmation ? 'terminal' : model.presentation)}</dd>
          </div>
          <div>
            <dt>Choices</dt>
            <dd>{model.choices.length}</dd>
          </div>
          <div>
            <dt>Proof</dt>
            <dd>{human(data.truthSummary.proof.status)}</dd>
          </div>
        </dl>
      </header>

      {model.presentation !== 'ready' && !confirmation ? (
        <p className="pc-operate__notice" role="status">
          Verified Review content remains visible on this{' '}
          {human(model.presentation).toLocaleLowerCase('en-US')} workspace. Mutation is unavailable.
        </p>
      ) : null}
      {notice ? (
        <p className="pc-operate__notice" data-tone={notice.tone} role="status" aria-live="polite">
          {notice.text}
        </p>
      ) : null}
      {uncertain ? (
        <StatePanel
          state="incompatible"
          eyebrow="Uncertain Review submission"
          title="Blind retry is locked"
          description="A Review event may have committed. Inspect canonical recovery state before taking another action."
          actions={
            <a className="op-inline-action" href="#/operate/recovery">
              Open Recovery
            </a>
          }
        />
      ) : null}

      <section className="op-review__section" aria-labelledby="op-review-recommendation-title">
        <div className="op-review__section-heading">
          <p className="op-eyebrow">Recommendation</p>
          <h2 id="op-review-recommendation-title">What the board recommends</h2>
        </div>
        {data.recommendation.status === 'available' ? (
          <ol className="op-review__recommendations">
            {data.recommendation.items.map((item) => (
              <li key={item.decisionId}>
                <h3>{item.title}</h3>
                <p>{item.outcome ?? item.rationale}</p>
                <dl>
                  <div>
                    <dt>Upside</dt>
                    <dd>{item.expectedUpside}</dd>
                  </div>
                  <div>
                    <dt>Downside</dt>
                    <dd>{item.expectedDownside}</dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{Math.round(item.confidence * 100)}%</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        ) : (
          <p>{data.recommendation.absence.message}</p>
        )}
      </section>

      {!settledWorkspace ? (
        <section className="op-review__section" aria-labelledby="op-review-choices-title">
          <div className="op-review__section-heading">
            <p className="op-eyebrow">Owner choices</p>
            <h2 id="op-review-choices-title">Choose the record to make</h2>
          </div>
          {model.choices.length ? (
            <div className="op-review__choice-layout">
              <fieldset disabled={!mutationEnabled || interactionLocked}>
                <legend>Select one exact choice. Nothing changes until confirmation.</legend>
                {model.choices.map((entry) => (
                  <label key={entry.choice.choiceId} className="op-review__choice">
                    <input
                      type="radio"
                      name="review-choice"
                      value={entry.choice.choiceId}
                      checked={selectedChoice?.choice.choiceId === entry.choice.choiceId}
                      onChange={() => {
                        if (interactionLockedRef.current) return;
                        setSelection(
                          Object.freeze({ bindingKey, choiceId: entry.choice.choiceId }),
                        );
                      }}
                    />
                    <span>
                      <strong>{entry.choice.label}</strong>
                      <small>{entry.choice.consequence}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <aside className="op-review__choice-brief" aria-live="polite">
                {selectedChoice ? (
                  <>
                    <p className="op-eyebrow">Selected consequence</p>
                    <h3>{selectedChoice.choice.label}</h3>
                    <p>{selectedChoice.choice.consequence}</p>
                    <p>
                      <strong>Authority:</strong> Review only. External effects are not authorized.
                    </p>
                    <GovernedButton
                      id="op-review-choice-preview-trigger"
                      disabled={!mutationEnabled || !selectedChoice.locator || interactionLocked}
                      disabledReason={
                        data.capability.reason?.message ?? 'This exact choice is unavailable.'
                      }
                      pendingLabel="Verifying exact preview"
                      aria-haspopup="dialog"
                      onInvoke={openPreview}
                    >
                      Review exact choice
                    </GovernedButton>
                  </>
                ) : (
                  <p>Select a choice to compare its exact consequence and dispositions.</p>
                )}
              </aside>
            </div>
          ) : (
            <p>{data.capability.reason?.message ?? 'This Review has no choices to submit.'}</p>
          )}
        </section>
      ) : null}

      <ReviewEvidenceTrace model={model} />
      {settledWorkspace ? (
        <ReviewReceipt workspace={settledWorkspace} receipt={confirmation?.receipt} />
      ) : null}
      <details className="op-review__section">
        <summary>Workspace custody</summary>
        <dl className="op-review__technical">
          <div>
            <dt>Review ID</dt>
            <dd>
              <code>{model.payload.reviewId}</code>
            </dd>
          </div>
          <div>
            <dt>Cycle ID</dt>
            <dd>
              <code>{model.payload.cycleId}</code>
            </dd>
          </div>
          <div>
            <dt>Source event</dt>
            <dd>
              {model.payload.sourceEventHead.sequence} ·{' '}
              <code>{model.payload.sourceEventHead.hash ?? 'genesis'}</code>
            </dd>
          </div>
          <div>
            <dt>Source view</dt>
            <dd>
              <code>{model.payload.sourceViewHash}</code>
            </dd>
          </div>
        </dl>
      </details>
      <ReviewChoiceConfirmation
        key={activePreview?.custody.preview.previewId ?? 'closed'}
        choice={activePreview?.choice ?? null}
        custody={activePreview?.custody ?? null}
        confirming={confirming}
        onCancel={cancelPreview}
        onConfirm={confirmChoice}
      />
    </article>
  );
}
