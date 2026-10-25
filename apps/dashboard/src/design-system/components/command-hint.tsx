import { useId } from 'react';
import { createPortal } from 'react-dom';
import { PcIcon } from './console-icon.js';
import { Toast } from './toast.js';
import { Tooltip } from './tooltip.js';
import { useCopyFeedback } from './use-copy-feedback.js';

export function CopyLabels({ idle, current }: { idle: string; current: string }) {
  return (
    <span className="pc-copy-label">
      {[idle, 'Copying', 'Copied', 'Copy failed'].map((text) => (
        <span
          key={text}
          data-active={text === current}
          style={{ visibility: text === current ? 'visible' : 'hidden' }}
        >
          {text}
        </span>
      ))}
    </span>
  );
}

export type CommandHintProps = Readonly<{
  command: string;
  variant?: 'row';
  artifactId?: string;
  label?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  disabledReason?: string;
  shortcutsEnabled?: boolean;
  onCopy?: (text: string) => Promise<void>;
}>;

export function CommandHint({
  command,
  variant,
  artifactId,
  label,
  size = 'md',
  disabled = false,
  disabledReason,
  shortcutsEnabled = true,
  onCopy,
}: CommandHintProps) {
  const feedback = useCopyFeedback(command, disabled, onCopy);
  const { state, copy } = feedback;
  const currentLabel = feedback.message || (state === 'pending' ? 'Copying' : 'Copy command');
  const rowLabel = feedback.message || `Copy command for ${artifactId}`;
  const reasonId = useId();
  const unavailable = disabled || !command.trim() || state === 'pending';
  const reason = disabledReason ?? (!command.trim() ? 'No command available.' : undefined);
  return (
    <div className="pc-command-hint" data-size={size} data-state={state} data-variant={variant}>
      {label ? <span className="pc-command-hint__label">{label}</span> : null}
      <div className="pc-command-hint__row">
        <code className="pc-command-hint__command">{command}</code>
        <Tooltip content={reason ?? 'Copy command (C)'}>
          <button
            type="button"
            aria-label={variant === 'row' ? rowLabel : undefined}
            className="pc-command-hint__copy"
            data-state={state}
            disabled={unavailable}
            aria-disabled={unavailable || undefined}
            aria-busy={state === 'pending' || undefined}
            aria-describedby={reason ? reasonId : undefined}
            aria-keyshortcuts={shortcutsEnabled ? 'C' : undefined}
            onClick={copy}
            onKeyDown={(event) => {
              if (
                shortcutsEnabled &&
                event.key.toLowerCase() === 'c' &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.stopPropagation();
                void copy();
              }
            }}
          >
            {variant === 'row' ? (
              <PcIcon
                name={state === 'copied' ? 'check' : state === 'blocked' ? 'x' : 'copy'}
                size={14}
              />
            ) : (
              <>
                <span className="pc-command-hint__key" aria-hidden="true">
                  <kbd>C</kbd>
                </span>
                <span className="pc-command-hint__touch-icon" aria-hidden="true">
                  <PcIcon
                    name={state === 'copied' ? 'check' : state === 'blocked' ? 'x' : 'copy'}
                    size={14}
                  />
                </span>
              </>
            )}
            <CopyLabels idle="Copy command" current={currentLabel} />
          </button>
        </Tooltip>
      </div>
      <span className="pc-visually-hidden" aria-live="polite" aria-atomic="true">
        {feedback.message}
      </span>
      {reason ? <p id={reasonId}>{reason}</p> : null}
      {state === 'copied' || state === 'blocked'
        ? createPortal(
            <div className="pc-command-hint__feedback">
              <Toast
                key={`${command}-${state}`}
                title={state === 'copied' ? 'Copied' : 'Copy was blocked'}
                kind={state === 'blocked' ? 'error' : 'info'}
                onDismiss={feedback.reset}
              >
                {state === 'blocked' ? (
                  <>
                    <p>{feedback.error}</p>
                    <p>Select the command and copy it manually.</p>
                  </>
                ) : null}
                <code>{command}</code>
              </Toast>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
