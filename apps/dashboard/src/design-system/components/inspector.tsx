import { Dialog } from 'radix-ui';
import { type ReactElement, type ReactNode, useRef } from 'react';
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
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        {modal ? <Dialog.Overlay className="pc-inspector-overlay" /> : null}
        <Dialog.Content
          className="pc-inspector-sheet"
          aria-modal={modal || undefined}
          data-state={state}
          onCloseAutoFocus={
            onRestoreFocus
              ? (event) => {
                  event.preventDefault();
                  onRestoreFocus();
                }
              : undefined
          }
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            heading.current?.focus();
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
