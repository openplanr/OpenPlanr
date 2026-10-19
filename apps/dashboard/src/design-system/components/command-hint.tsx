import { useEffect, useId, useRef, useState } from 'react';
import { PcIcon } from './console-icon.js';
import { Toast } from './toast.js';

export type CommandHintProps = Readonly<{
  command: string;
  label?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  disabledReason?: string;
  shortcutsEnabled?: boolean;
  onCopy?: (text: string) => Promise<void>;
}>;

export function CommandHint({
  command,
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
  const buttonLabel =
    state === 'copied'
      ? 'Command copied'
      : state === 'blocked'
        ? 'Copy was blocked'
        : 'Copy command';
  return (
    <div className="pc-command-hint" data-size={size} data-state={state}>
      {label ? <span className="pc-command-hint__label">{label}</span> : null}
      <div className="pc-command-hint__row">
        <code className="pc-command-hint__command">{command}</code>
        <button
          type="button"
          className="pc-command-hint__copy"
          data-state={state}
          disabled={unavailable}
          aria-disabled={unavailable || undefined}
          aria-busy={state === 'pending' || undefined}
          aria-label={buttonLabel}
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
          <PcIcon
            name={state === 'copied' ? 'check' : state === 'blocked' ? 'x' : 'copy'}
            size={12}
          />
          <span>{state === 'pending' ? 'Copying' : state === 'copied' ? 'Copied' : 'Copy'}</span>
          {shortcutsEnabled ? <kbd>C</kbd> : null}
        </button>
      </div>
      {reason ? <p id={reasonId}>{reason}</p> : null}
      {state === 'copied' || state === 'blocked' ? (
        <Toast
          key={`${command}-${state}`}
          title={state === 'copied' ? 'Copied' : 'Copy was blocked'}
          kind={state === 'blocked' ? 'error' : 'info'}
          onDismiss={() => setState('idle')}
        >
          {state === 'blocked' ? <p>Select the command and copy it manually.</p> : null}
          <code>{command}</code>
        </Toast>
      ) : null}
    </div>
  );
}
