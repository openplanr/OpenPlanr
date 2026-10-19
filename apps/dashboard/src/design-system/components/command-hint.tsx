import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PcIcon } from './console-icon.js';
import { Toast } from './toast.js';
import { Tooltip } from './tooltip.js';

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
  const [state, setState] = useState<'idle' | 'pending' | 'copied' | 'blocked'>('idle');
  const currentCommand = useRef(command);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const reasonId = useId();
  const unavailable = disabled || !command.trim() || state === 'pending';
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    currentCommand.current = command;
    // Keep the physical clipboard lock when selection changes during a write.
    setState(inFlight.current ? 'pending' : 'idle');
  }, [command]);
  const copy = async () => {
    if (unavailable || inFlight.current) return;
    inFlight.current = true;
    setState('pending');
    try {
      if (onCopy) await onCopy(command);
      else {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(command);
      }
      if (mounted.current) setState(currentCommand.current === command ? 'copied' : 'idle');
    } catch {
      if (mounted.current) setState(currentCommand.current === command ? 'blocked' : 'idle');
    } finally {
      inFlight.current = false;
    }
  };
  const reason = disabledReason ?? (!command.trim() ? 'No command available.' : undefined);
  return (
    <div className="pc-command-hint" data-size={size} data-state={state} data-variant={variant}>
      {label ? <span className="pc-command-hint__label">{label}</span> : null}
      <div className="pc-command-hint__row">
        <code className="pc-command-hint__command">{command}</code>
        <Tooltip content={reason ?? 'Copy command (C)'}>
          <button
            type="button"
            aria-label={variant === 'row' ? `Copy command for ${artifactId}` : undefined}
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
              <span aria-hidden="true">
                <kbd>C</kbd>
              </span>
            )}
            <span className="pc-visually-hidden">
              {state === 'pending' ? 'Copying' : state === 'copied' ? 'Copied' : 'Copy command'}
            </span>
          </button>
        </Tooltip>
      </div>
      {reason ? <p id={reasonId}>{reason}</p> : null}
      {state === 'copied' || state === 'blocked'
        ? createPortal(
            <div className="pc-command-hint__feedback">
              <Toast
                key={`${command}-${state}`}
                title={state === 'copied' ? 'Copied' : 'Copy was blocked'}
                kind={state === 'blocked' ? 'error' : 'info'}
                onDismiss={() => setState('idle')}
              >
                {state === 'blocked' ? <p>Select the command and copy it manually.</p> : null}
                <code>{command}</code>
              </Toast>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
