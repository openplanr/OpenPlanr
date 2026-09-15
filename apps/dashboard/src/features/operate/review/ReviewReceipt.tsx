import type {
  OperateReviewDisplayWorkspaceV1,
  OperatingReviewReceiptV2,
} from '@openplanr/protocol/dashboard/operate-review-contract.mjs';

export function ReviewReceipt({
  workspace,
  receipt,
}: {
  workspace: OperateReviewDisplayWorkspaceV1;
  receipt?: OperatingReviewReceiptV2 | null;
}) {
  const terminal = workspace.payload.data.terminalDisposition;
  if (!terminal) return null;
  const exactBoundSubmission = receipt?.boundSubmission ?? null;
  return (
    <section
      className="op-review__section op-review__receipt"
      aria-labelledby="op-review-receipt-title"
    >
      <div className="op-review__section-heading">
        <p className="op-eyebrow">Immutable record</p>
        <h2 id="op-review-receipt-title" tabIndex={-1}>
          Review recorded
        </h2>
      </div>
      <p>
        The owner recorded <strong>{terminal.decision}</strong>. This receipt does not execute an
        Action or authorize an external effect.
      </p>
      <dl className="op-review__proof">
        <div>
          <dt>Applied choice</dt>
          <dd>
            <code>{terminal.appliedChoiceId}</code>
          </dd>
        </div>
        <div>
          <dt>Committed event</dt>
          <dd>{terminal.eventHead.sequence}</dd>
        </div>
        <div>
          <dt>Review read event</dt>
          <dd>{terminal.readEventHead.sequence}</dd>
        </div>
        <div>
          <dt>Committed</dt>
          <dd>
            <time dateTime={terminal.committedAt}>{terminal.committedAt}</time>
          </dd>
        </div>
      </dl>
      <details>
        <summary>Technical receipt proof</summary>
        <dl className="op-review__technical">
          <div>
            <dt>Receipt ID</dt>
            <dd>
              <code>{terminal.receiptId}</code>
            </dd>
          </div>
          <div>
            <dt>Source receipt hash</dt>
            <dd>
              <code>{workspace.payload.sourceArtifactHash}</code>
            </dd>
          </div>
          <div>
            <dt>Applied choice hash</dt>
            <dd>
              <code>{terminal.appliedChoiceHash}</code>
            </dd>
          </div>
          <div>
            <dt>Committed event hash</dt>
            <dd>
              <code>{terminal.eventHead.hash ?? 'genesis'}</code>
            </dd>
          </div>
          <div>
            <dt>Bound submission hash</dt>
            <dd>
              <code>
                {exactBoundSubmission?.boundSubmissionHash ?? 'Not included in this display'}
              </code>
            </dd>
          </div>
          <div>
            <dt>Owner note</dt>
            <dd>
              {exactBoundSubmission
                ? (exactBoundSubmission.note ?? 'No note recorded')
                : 'Not included in this display'}
            </dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
