/* biome-ignore-all lint/suspicious/noArrayIndexKey: owner arrays retain order and may contain repeated presentation values. */

import { serializeDashboardRoute } from '../../../app/router.js';
import { GovernedButton } from '../../../design-system/components/index.js';
import type { OperateInboxItem } from './inbox-model.js';

export type InboxItemDetailProps = Readonly<{
  item: OperateInboxItem;
  mutationEnabled: boolean;
  pendingItemId: string | null;
  surfaceReasonCodes: readonly string[];
  showDeepLink?: boolean;
  headingLevel?: 2 | 3;
  onPreview: (item: OperateInboxItem, triggerId: string) => void | Promise<void>;
}>;

function humanLabel(value: string): string {
  const words = value.replaceAll('-', ' ').replaceAll('_', ' ').trim();
  return words === '' ? value : `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

function disabledReason(
  item: OperateInboxItem,
  mutationEnabled: boolean,
  surfaceReasonCodes: readonly string[],
): string | null {
  if (item.unavailableReason) {
    return `${item.unavailableReason.code}: ${item.unavailableReason.message}`;
  }
  if (item.actionLocator === null) {
    return 'No owner-issued action locator is available for this item.';
  }
  if (!mutationEnabled) {
    return surfaceReasonCodes.length > 0
      ? surfaceReasonCodes.join(' · ')
      : 'Mutation is unavailable for this exact Inbox projection.';
  }
  return null;
}

function itemHref(itemId: string): string {
  return serializeDashboardRoute({
    kind: 'operate.inbox-item',
    product: 'operate',
    subjectId: itemId,
  });
}

export function InboxItemDetail({
  item,
  mutationEnabled,
  pendingItemId,
  surfaceReasonCodes,
  showDeepLink = true,
  headingLevel = 3,
  onPreview,
}: InboxItemDetailProps) {
  const triggerId = `op-inbox-action-${encodeURIComponent(item.itemId)}`;
  const reviewNavigation = item.navigationLocator ?? null;
  const reason = disabledReason(item, mutationEnabled, surfaceReasonCodes);
  const canPreview = reviewNavigation === null && reason === null;
  const ItemHeading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    <article
      className="op-inbox-item"
      data-inbox-kind={item.kind}
      data-inbox-state={item.state}
      data-inbox-blocking={item.blocking ? 'true' : 'false'}
      aria-labelledby={`${triggerId}-title`}
    >
      <header className="op-inbox-item__header">
        <div className="op-inbox-item__sequence" aria-hidden="true" />
        <div>
          <p className="op-eyebrow">{humanLabel(item.kind)}</p>
          <ItemHeading id={`${triggerId}-title`}>{item.title}</ItemHeading>
          <p className="op-inbox-item__consequence">{item.consequence}</p>
        </div>
        <span className="op-inbox-item__state">{humanLabel(item.state)}</span>
      </header>

      <dl className="op-inbox-item__facts">
        <div>
          <dt>Owner</dt>
          <dd>Assigned</dd>
        </div>
        <div>
          <dt>Blocking</dt>
          <dd>{item.blocking ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt>Expiry</dt>
          <dd>
            {item.expiresAt ? (
              <time dateTime={item.expiresAt}>{item.expiresAt}</time>
            ) : (
              'Not returned'
            )}
          </dd>
        </div>
      </dl>

      <details className="op-inbox-item__technical">
        <summary>Technical details</summary>
        <dl className="op-inbox-item__facts">
          <div>
            <dt>Owner ID</dt>
            <dd>
              <code>{item.ownerActorId}</code>
            </dd>
          </div>
        </dl>
      </details>

      <div className="op-inbox-item__disclosure">
        <details>
          <summary>Evidence ({item.evidence.length})</summary>
          {item.evidence.length > 0 ? (
            <ol>
              {item.evidence.map((evidence, index) => (
                <li key={`${evidence.evidenceRefId}:${index}`}>
                  <code>{evidence.evidenceRefId}</code>
                  <span>{evidence.relation}</span>
                  <span>
                    {evidence.classification} · {evidence.accessState}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p>No item-bound evidence was returned.</p>
          )}
        </details>

        <details>
          <summary>Required parties ({item.requiredParties.length})</summary>
          {item.requiredParties.length > 0 ? (
            <ol>
              {item.requiredParties.map((party, index) => (
                <li key={`${party.partyId}:${index}`}>
                  <code>{party.partyId}</code>
                  <span>{party.actorKind}</span>
                  <span>{party.state}</span>
                  <strong>
                    {party.redacted ? 'Identity redacted' : (party.actorId ?? 'Actor not returned')}
                  </strong>
                </li>
              ))}
            </ol>
          ) : (
            <p>No required party was returned.</p>
          )}
        </details>

        <details>
          <summary>Redactions ({item.redactions.length})</summary>
          {item.redactions.length > 0 ? (
            <ol>
              {item.redactions.map((redaction, index) => (
                <li key={`${redaction.classification}:${redaction.reason}:${index}`}>
                  <span>{redaction.classification}</span>
                  <strong>{redaction.count}</strong>
                  <code>{redaction.reason}</code>
                </li>
              ))}
            </ol>
          ) : (
            <p>No redaction was returned.</p>
          )}
        </details>
      </div>

      <footer className="op-inbox-item__actions">
        {showDeepLink ? (
          <a className="op-inbox-item__link" href={itemHref(item.itemId)}>
            View item
          </a>
        ) : (
          <a className="op-inbox-item__link" href="#/operate/inbox">
            Back to Inbox
          </a>
        )}
        {reviewNavigation ? (
          <a
            className="op-inbox-item__link"
            data-review-navigation=""
            data-review-read-action-digest={reviewNavigation.readActionDigest}
            href={reviewNavigation.deepLink}
          >
            Open Review
          </a>
        ) : (
          <fieldset
            className="op-inbox-item__trigger-anchor"
            data-inbox-item-trigger-anchor=""
            tabIndex={-1}
            aria-labelledby={`${triggerId}-title`}
          >
            {canPreview ? (
              <GovernedButton
                id={triggerId}
                disabled={false}
                pendingLabel="Verifying exact preview"
                aria-haspopup="dialog"
                onInvoke={() => onPreview(item, triggerId)}
              >
                Open verified preview
              </GovernedButton>
            ) : (
              <GovernedButton
                id={triggerId}
                disabled
                disabledReason={reason ?? 'No owner-issued action locator is available.'}
                aria-haspopup="dialog"
              >
                Open verified preview
              </GovernedButton>
            )}
          </fieldset>
        )}
        {reviewNavigation === null && pendingItemId === item.itemId ? (
          <span className="op-inbox-item__pending" role="status">
            Verifying the exact owner preview.
          </span>
        ) : null}
      </footer>
    </article>
  );
}
