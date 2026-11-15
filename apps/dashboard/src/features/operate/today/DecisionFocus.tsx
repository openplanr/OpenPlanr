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

/** The gateway's next safe step: Open Review when one exists, otherwise the governed control. */
export function DecisionFocus({ model, onContinuation }: DecisionFocusProps) {
  const continuation = model.continuation;
  const reviewNavigation = uniqueOperateReviewNavigationForCycle(model, model.activeCycle.cycleId);
  const disabledReason = continuationReason(model, onContinuation !== undefined);
  const cycleHref = model.activeCycle.deepLink;

  return (
    <>
      <div className="pc-operate-today__next-control">
        {reviewNavigation ? (
          <a
            className="pc-operate-today__command"
            data-variant="primary"
            data-review-navigation=""
            data-review-read-action-digest={reviewNavigation.readActionDigest}
            href={reviewNavigation.deepLink}
          >
            Open Review
          </a>
        ) : continuation && !disabledReason && onContinuation ? (
          <GovernedButton variant="secondary" onInvoke={() => onContinuation(continuation)}>
            {continuation.action.label}
          </GovernedButton>
        ) : (
          <GovernedButton
            variant="secondary"
            disabled
            disabledReason={disabledReason ?? 'The next step is unavailable.'}
          >
            {continuation?.action.label ?? 'No next step available'}
          </GovernedButton>
        )}
      </div>

      {model.continuationRelationship?.kind === 'different-subject' ? (
        <div className="pc-operate-today__relationship" role="note">
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
    </>
  );
}
