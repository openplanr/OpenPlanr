import { type ReactNode, useEffect, useRef, useState } from 'react';

export type ToastKind = 'info' | 'error' | 'actionable' | 'disk-change' | 'operation-outcome';
export type ToastProps = Readonly<{
  title: string;
  children?: ReactNode;
  kind?: ToastKind;
  action?: ReactNode;
  onDismiss?: () => void;
}>;

export function Toast({ title, children, kind = 'info', action, onDismiss }: ToastProps) {
  const [dismissed, setDismissed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(6000);
  const persistent = kind !== 'info' || Boolean(action);
  const dismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    if (dismissed || persistent || hovered || focused) return;
    const started = Date.now();
    const timer = setTimeout(() => dismissRef.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [dismissed, persistent, hovered, focused]);

  if (dismissed) return null;
  return (
    <section
      className="pc-toast"
      aria-label="Notification"
      data-kind={kind}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.stopPropagation();
          dismiss();
        }
      }}
    >
      <span className="pc-toast__glyph" aria-hidden="true" />
      <div className="pc-toast__body">
        <div role={kind === 'error' ? 'alert' : 'status'} aria-atomic="true">
          <strong>{title}</strong>
          {children ? <div>{children}</div> : null}
        </div>
        {action}
      </div>
      <button
        type="button"
        className="pc-icon-button"
        aria-label="Dismiss notification"
        onClick={dismiss}
      >
        <span aria-hidden="true">×</span>
      </button>
    </section>
  );
}
