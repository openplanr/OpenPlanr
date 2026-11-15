import {
  type AriaAttributes,
  forwardRef,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Tooltip } from './tooltip.js';

type SharedProps = Readonly<{
  children: ReactNode;
  className?: string;
  id?: string;
  title?: string;
  tabIndex?: number;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  'aria-label'?: AriaAttributes['aria-label'];
  'aria-controls'?: AriaAttributes['aria-controls'];
  'aria-expanded'?: AriaAttributes['aria-expanded'];
  'aria-haspopup'?: AriaAttributes['aria-haspopup'];
}>;

type GovernedButtonProps = SharedProps &
  Readonly<{
    disabled?: boolean;
    disabledReason?: string;
    onInvoke?: () => void | Promise<void>;
  }>;

/**
 * Presentation-only action control. Its caller supplies the already-authorized invocation;
 * this component never creates arguments, authority, retries, or durable success.
 */
export const GovernedButton = forwardRef<HTMLButtonElement, GovernedButtonProps>(
  function GovernedButton(
    {
      children,
      className,
      disabled = false,
      disabledReason,
      id,
      onInvoke,
      pendingLabel = 'Waiting for durable acceptance',
      tabIndex,
      title,
      variant = 'primary',
      'aria-label': ariaLabel,
      'aria-controls': ariaControls,
      'aria-expanded': ariaExpanded,
      'aria-haspopup': ariaHasPopup,
    },
    forwardedRef,
  ) {
    const reasonId = useId();
    const inFlight = useRef(false);
    const mounted = useRef(true);
    const [pending, setPending] = useState(false);
    const [failure, setFailure] = useState<string>();

    useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    }, []);

    const visibleReason = pending ? pendingLabel : disabledReason;
    const unavailable = disabled || pending;
    const descriptionId = pending ? `${reasonId}-pending` : disabledReason ? reasonId : undefined;

    async function invoke() {
      if (unavailable || inFlight.current || !onInvoke) return;
      inFlight.current = true;
      setPending(true);
      setFailure(undefined);
      try {
        await onInvoke();
      } catch {
        if (mounted.current)
          setFailure('The action could not complete. Check its current state before continuing.');
      } finally {
        inFlight.current = false;
        if (mounted.current) setPending(false);
      }
    }

    const control = (
      <button
        ref={forwardedRef}
        type="button"
        id={id}
        className={`op-governed-button${className ? ` ${className}` : ''}`}
        data-variant={variant}
        title={title}
        tabIndex={tabIndex}
        disabled={unavailable}
        aria-disabled={unavailable || undefined}
        aria-label={pending ? pendingLabel : ariaLabel}
        aria-controls={ariaControls}
        aria-expanded={ariaExpanded}
        aria-haspopup={ariaHasPopup}
        aria-busy={pending || undefined}
        aria-describedby={descriptionId}
        onClick={invoke}
      >
        <span className="op-governed-button__spinner" data-pending={pending} aria-hidden="true" />
        <span>{children}</span>
      </button>
    );

    return (
      <div
        className="op-governed-action"
        data-governed-action-state={pending ? 'pending' : 'idle'}
        data-unavailable={unavailable || undefined}
      >
        <Tooltip content={visibleReason} disabled={!visibleReason}>
          <span
            className="op-governed-action__trigger"
            tabIndex={unavailable ? 0 : undefined}
            aria-describedby={unavailable ? descriptionId : undefined}
          >
            {control}
          </span>
        </Tooltip>
        {failure ? (
          <p className="op-governed-reason" role="alert">
            {failure}
          </p>
        ) : null}
        {disabledReason ? (
          <p className="op-governed-reason" id={reasonId}>
            {disabledReason}
          </p>
        ) : null}
        {pending ? (
          <p className="pc-visually-hidden" id={`${reasonId}-pending`} role="status">
            {pendingLabel}
          </p>
        ) : null}
      </div>
    );
  },
);
