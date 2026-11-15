import { useState } from 'react';
import { AlertDialog } from '../../../design-system/components/index.js';
import type { ReviewCommandPreview } from './review-actions.js';
import type { OperateReviewChoiceModel } from './review-model.js';

function human(value: string): string {
  return value.replaceAll('-', ' ').replaceAll('_', ' ');
}

function validNote(value: string): boolean {
  return value.length === 0 || (value.length <= 2_048 && /^\S(?:[\s\S]*\S)?$/u.test(value));
}

export function ReviewChoiceConfirmation({
  choice,
  custody,
  confirming,
  onCancel,
  onConfirm,
}: {
  choice: OperateReviewChoiceModel | null;
  custody: ReviewCommandPreview | null;
  confirming: boolean;
  onCancel(): void;
  onConfirm(note: string | null): void | Promise<void>;
}) {
  const [note, setNote] = useState('');
  const noteIsValid = validNote(note);
  const preview = custody?.preview ?? null;
  return (
    <AlertDialog.Root
      open={preview !== null && choice !== null}
      onOpenChange={(open) => {
        if (!open && !confirming) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="op-inbox-dialog__overlay op-governed-overlay" />
        <AlertDialog.Content className="op-inbox-dialog__content op-review-dialog op-governed-dialog">
          {preview && choice ? (
            <>
              <p className="op-eyebrow">Exact owner choice</p>
              <AlertDialog.Title className="op-inbox-dialog__title">
                Record “{choice.choice.label}”?
              </AlertDialog.Title>
              <AlertDialog.Description className="op-inbox-dialog__description">
                {choice.choice.consequence}
              </AlertDialog.Description>
              <dl className="op-inbox-dialog__facts">
                <div>
                  <dt>Authority</dt>
                  <dd>Review only</dd>
                </div>
                <div>
                  <dt>External effects</dt>
                  <dd>Not authorized</dd>
                </div>
                <div>
                  <dt>Runtime effect</dt>
                  <dd>
                    <code>{choice.action?.action.effect ?? 'not-issued'}</code>
                  </dd>
                </div>
                <div>
                  <dt>Reversibility</dt>
                  <dd>{human(choice.choice.reversibility)}</dd>
                </div>
                <div>
                  <dt>Event head</dt>
                  <dd>{preview.eventHead.sequence}</dd>
                </div>
                <div>
                  <dt>Choice proof</dt>
                  <dd>
                    <code>{choice.choice.choiceHash}</code>
                  </dd>
                </div>
                <div>
                  <dt>Preview proof</dt>
                  <dd>
                    <code>{preview.previewHash}</code>
                  </dd>
                </div>
              </dl>
              <section
                className="op-inbox-dialog__targets"
                aria-labelledby="op-review-dispositions-title"
              >
                <h2 id="op-review-dispositions-title">Exact work dispositions</h2>
                {choice.choice.requiredDispositions.length ? (
                  <ol>
                    {choice.choice.requiredDispositions.map((entry) => (
                      <li key={`${entry.entityType}:${entry.entityId}`}>
                        <strong>{human(entry.entityType)}</strong>
                        <code>{entry.entityId}</code>
                        <span>{human(entry.disposition)}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>No persistent work disposition is attached to this choice.</p>
                )}
              </section>
              <label className="op-review-dialog__note">
                <span>
                  Owner note <small>(optional)</small>
                </span>
                <textarea
                  value={note}
                  maxLength={2_048}
                  rows={3}
                  disabled={confirming}
                  aria-disabled={confirming || undefined}
                  aria-invalid={!noteIsValid || undefined}
                  aria-describedby="op-review-note-help op-review-confirm-status"
                  onChange={(event) => setNote(event.currentTarget.value)}
                />
              </label>
              <p
                id="op-review-note-help"
                className="op-governed-dialog__reason"
                role={!noteIsValid ? 'alert' : undefined}
              >
                {noteIsValid
                  ? `${note.length} of 2,048 characters. The exact text is bound into the receipt.`
                  : 'Remove leading or trailing whitespace before confirming.'}
              </p>
              <p id="op-review-confirm-status" className="op-governed-dialog__reason" role="status">
                {confirming
                  ? 'Recording receipt. Confirmation is in progress.'
                  : 'Confirm once to record this exact choice.'}
              </p>
              <div className="op-inbox-dialog__actions">
                <AlertDialog.Cancel asChild>
                  <button
                    type="button"
                    className="pc-button op-inbox-dialog__cancel"
                    disabled={confirming}
                    aria-disabled={confirming || undefined}
                    aria-describedby={confirming ? 'op-review-confirm-status' : undefined}
                  >
                    Keep reviewing
                  </button>
                </AlertDialog.Cancel>
                <button
                  type="button"
                  className="op-governed-button op-inbox-dialog__confirm"
                  disabled={confirming || !noteIsValid}
                  aria-busy={confirming || undefined}
                  aria-disabled={confirming || !noteIsValid || undefined}
                  aria-describedby="op-review-note-help op-review-confirm-status"
                  onClick={() => void onConfirm(note === '' ? null : note)}
                >
                  <span className="op-governed-dialog__label">
                    <span aria-hidden={confirming || undefined}>Record {choice.choice.label}</span>
                    <span aria-hidden={!confirming || undefined}>Recording immutable receipt</span>
                  </span>
                </button>
              </div>
            </>
          ) : null}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
