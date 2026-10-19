import { Dialog } from 'radix-ui';
import { type ReactElement, type ReactNode, useEffect, useRef } from 'react';
import { Skeleton } from './console-core.js';

export type InspectorProps = Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestoreFocus?: () => void;
  closeLabel?: string;
  title: string;
  description: string;
  children?: ReactNode;
  trigger?: ReactElement;
  modal?: boolean;
  state?: 'ready' | 'loading' | 'empty' | 'error';
  reason?: string;
}>;

export function Inspector({
  open,
  onOpenChange,
  onRestoreFocus,
  closeLabel = 'Close inspector',
  title,
  description,
  children,
  trigger,
  modal = false,
  state = 'ready',
  reason,
}: InspectorProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const pointerDismissal = useRef(false);
  useEffect(() => {
    if (!open || modal) return;
    const ownerDocument = document;
    const outside = (event: PointerEvent) => {
      if (ownerDocument.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (event.target instanceof Node && !sheet.current?.contains(event.target)) {
        pointerDismissal.current = true;
        const toggle =
          event.target instanceof Element
            ? event.target.closest('[data-inspector-toggle], [aria-controls]')
            : null;
        if (
          toggle?.hasAttribute('data-inspector-toggle') ||
          (toggle && toggle.getAttribute('aria-controls') === sheet.current?.id)
        )
          return;
        onOpenChange(false);
      }
    };
    ownerDocument.addEventListener('pointerdown', outside, true);
    return () => ownerDocument.removeEventListener('pointerdown', outside, true);
  }, [open, modal, onOpenChange]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        {modal ? <Dialog.Overlay className="pc-inspector-overlay" /> : null}
        <Dialog.Content
          ref={sheet}
          className="pc-inspector-sheet"
          aria-modal={modal || undefined}
          data-state={state}
          onFocusOutside={(event) => {
            // Row shortcuts move focus behind a nonmodal inspector without dismissing it.
            if (!modal) event.preventDefault();
          }}
          onPointerDownOutside={() => {
            pointerDismissal.current = !modal;
          }}
          onCloseAutoFocus={(event) => {
            const active = document.activeElement;
            const preserveOutsideFocus =
              pointerDismissal.current &&
              active?.isConnected &&
              active !== document.body &&
              !active.matches('main, [role="main"]');
            pointerDismissal.current = false;
            if (preserveOutsideFocus) {
              event.preventDefault();
            } else if (onRestoreFocus) {
              event.preventDefault();
              onRestoreFocus();
            }
          }}
          onOpenAutoFocus={(event) => {
            pointerDismissal.current = false;
            event.preventDefault();
            if (modal) heading.current?.focus();
          }}
        >
          <header className="pc-inspector__head">
            <Dialog.Title className="pc-inspector__title" ref={heading} tabIndex={-1}>
              {title}
            </Dialog.Title>
            <Dialog.Close className="pc-icon-button" aria-label={closeLabel}>
              ×
            </Dialog.Close>
          </header>
          <Dialog.Description>{description}</Dialog.Description>
          <div className="pc-inspector-sheet__body" aria-busy={state === 'loading' || undefined}>
            {state === 'loading' ? (
              <div role="status" aria-label="Loading inspector">
                <Skeleton h={20} />
                <Skeleton h={44} />
              </div>
            ) : state === 'ready' ? (
              children
            ) : (
              <p role={state === 'error' ? 'alert' : 'status'}>
                {reason ??
                  (state === 'empty' ? 'No item selected.' : 'This item could not be read.')}
              </p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
