import { GovernedButton } from '../../../design-system/components/index.js';
import { uniqueOperateReviewNavigationForCycle } from '../review/review-navigation.js';
import type { OperateTodaySurfaceModel } from './today-model.js';

export type OperateTodayContinuation = OperateTodaySurfaceModel['allowedActions'][number];

export type DecisionFocusProps = Readonly<{
  model: OperateTodaySurfaceModel;
  onContinuation?: (continuation: OperateTodayContinuation) => void | Promise<void>;
}>;

function continuationReason(model: OperateTodaySurfaceModel, hasPresenter: boolean): string | null {
  if (!model.continuation) return 'No next step is available for this active work.';
  if (model.continuation.action.effect !== 'read-only' && !model.mutationEnabled) {
    return 'This view is read-only, so changes are unavailable.';
  }
  if (!hasPresenter) {
    return 'This next step is visible, but its command control is unavailable.';
  }
  return null;
}

export function DecisionFocus({ model, onContinuation }: DecisionFocusProps) {
  const attention = model.priorityAttention;
  const continuation = model.continuation;
  const reviewNavigation = uniqueOperateReviewNavigationForCycle(model, model.activeCycle.cycleId);
  const action = continuation
    ? (model.actions.find((entry) => entry.actionId === continuation.subjectId) ?? null)
    : null;
  const disabledReason = continuationReason(model, onContinuation !== undefined);
  const cycleHref = model.activeCycle.deepLink;

  return (
    <section className="op-today-focus" aria-labelledby="op-today-focus-title">
      <div className="op-today-focus__custody">
        <p className="op-eyebrow">{attention ? 'Priority focus' : 'Current work'}</p>
      </div>

      <div className="op-today-focus__question">
        <h2 id="op-today-focus-title">{attention?.title ?? 'Continue this work'}</h2>
        <p>
          {attention?.whyNow ??
            model.activeCycle.focus[0] ??
            'Review the active work before continuing.'}
        </p>
      </div>

      <dl className="op-today-focus__brief">
        <div>
          <dt>Expected result</dt>
          <dd>{action?.expectedResult ?? attention?.consequence ?? 'Not projected on Today.'}</dd>
        </div>
        <div>
          <dt>Consequence</dt>
          <dd>
            {attention?.consequence ?? 'No consequence was projected for this attention item.'}
          </dd>
        </div>
      </dl>

      {model.continuationRelationship?.kind === 'different-subject' ? (
        <div className="op-today-focus__relationship" role="note">
          <p>
            The available next step relates to this priority item
            {cycleHref ? (
              <>
                . Review the <a href={cycleHref}>active work</a> before continuing.
              </>
            ) : (
              '.'
            )}
          </p>
          <details className="op-binding-passport__details">
            <summary>Relationship details</summary>
            <dl className="op-today__status">
              <div>
                <dt>Focus item</dt>
                <dd>
                  <code>{model.continuationRelationship.attentionSubjectId}</code>
                </dd>
              </div>
              <div>
                <dt>Next-step item</dt>
                <dd>
                  <code>{model.continuationRelationship.continuationSubjectId}</code>
                </dd>
              </div>
            </dl>
          </details>
        </div>
      ) : null}

      <div className="op-today-focus__actions">
        {reviewNavigation ? (
          <a
            className="op-today-focus__evidence-link"
            data-review-navigation=""
            data-review-read-action-digest={reviewNavigation.readActionDigest}
            href={reviewNavigation.deepLink}
          >
            Open Review
          </a>
        ) : continuation && !disabledReason && onContinuation ? (
          <GovernedButton onInvoke={() => onContinuation(continuation)}>
            {continuation.action.label}
          </GovernedButton>
        ) : (
          <GovernedButton
            disabled
            disabledReason={disabledReason ?? 'The next step is unavailable.'}
          >
            {continuation?.action.label ?? 'No next step available'}
          </GovernedButton>
        )}
        <a className="op-today-focus__evidence-link" href="#/operate/evidence">
          View evidence
        </a>
        <small>Changes take effect only after confirmation and verification.</small>
      </div>
    </section>
  );
}
