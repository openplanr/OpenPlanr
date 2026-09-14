import { Tooltip } from 'radix-ui';
import {
  type AriaAttributes,
  forwardRef,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

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

    useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    }, []);

    const visibleReason = pending ? pendingLabel : disabledReason;
    const unavailable = disabled || pending;

    async function invoke() {
      if (unavailable || inFlight.current || !onInvoke) return;
      inFlight.current = true;
      setPending(true);
      try {
        await onInvoke();
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
        aria-label={ariaLabel}
        aria-controls={ariaControls}
        aria-expanded={ariaExpanded}
        aria-haspopup={ariaHasPopup}
        aria-busy={pending || undefined}
        aria-describedby={visibleReason ? reasonId : undefined}
        onClick={invoke}
      >
        {pending ? <span className="op-governed-button__spinner" aria-hidden="true" /> : null}
        <span>{pending ? pendingLabel : children}</span>
      </button>
    );

    return (
      <div className="op-governed-action" data-governed-action-state={pending ? 'pending' : 'idle'}>
        {visibleReason ? (
          <Tooltip.Provider delayDuration={300}>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <span>{control}</span>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className="op-governed-tooltip" sideOffset={8}>
                  {visibleReason}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
        ) : (
          control
        )}
        {visibleReason ? (
          <p className="op-governed-reason" id={reasonId}>
            {visibleReason}
          </p>
        ) : null}
      </div>
    );
  },
);
