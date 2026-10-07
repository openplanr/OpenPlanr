import { Dialog, DropdownMenu, Tooltip } from 'radix-ui';
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from 'react';

/** Trusted Studio chrome only. Authored frames and canvas controllers own their DOM separately. */
export type StudioKind = 'design' | 'diagram' | 'artifact';
export interface StudioToolbarProps {
  title: string;
  titleNode?: ReactNode;
  brand?: boolean;
  as?: 'header' | 'div';
  kind: StudioKind;
  hierarchy?: ReadonlyArray<{ label: string; href?: string }>;
  subtitle?: ReactNode;
  leading?: ReactNode;
  viewPicker?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
}
export const StudioButton = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<'button'> & { variant?: 'default' | 'primary' | 'ghost' }
>(function StudioButton({ variant = 'default', className = '', type = 'button', ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={`studio-button studio-button-${variant} ${className}`}
      {...props}
    />
  );
});
export function StudioBadge({ children }: { children: ReactNode }) {
  return <span className="studio-type-badge">{children}</span>;
}
export function StudioMark() {
  return (
    <span className="planr-mark" aria-hidden="true">
      <svg viewBox="0 0 160 160" focusable="false" aria-hidden="true">
        <g transform="rotate(-45 80 80)">
          <path
            d="M125 50A52 52 0 1 0 125 110"
            fill="none"
            stroke="currentColor"
            strokeWidth="12"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="127" y="71" width="18" height="18" rx="3" fill="currentColor" />
        </g>
      </svg>
    </span>
  );
}
export function StudioToolbar({
  title,
  titleNode,
  brand = true,
  as: Tag = 'header',
  kind,
  hierarchy = [],
  subtitle,
  leading,
  viewPicker,
  status,
  actions,
  className = '',
}: StudioToolbarProps) {
  const toolbar = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing the host tag replaces the observed DOM element.
  useLayoutEffect(() => {
    const element = toolbar.current;
    const window = element?.ownerDocument.defaultView;
    if (!element || !window) return;
    const center = element.querySelector<HTMLElement>('.studio-toolbar-center');
    const trailing = element.querySelector<HTMLElement>('.studio-toolbar-trailing');
    const leading = element.querySelector<HTMLElement>('.studio-toolbar-leading');
    if (!center || !trailing || !leading) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (!width) return;
      // Measure the actual host container, including portals inside a narrower application.
      // Density changes labels first; a second read then measures those real control widths.
      element.dataset.studioDensity = width <= 680 ? 'narrow' : 'regular';
      const style = window.getComputedStyle(element);
      const available = width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const gap = parseFloat(style.columnGap) || 0;
      element.dataset.studioCenter = 'true';
      const centerWidth = center.scrollWidth;
      element.dataset.studioCenter = String(centerWidth > 0);
      // Leave useful title space, while the right side owns its natural action widths.
      // Compact chrome can wrap; summing the visible controls retains its intrinsic floor
      // so resizing back to desktop does not oscillate between layouts.
      const controlSelector = 'button,a,summary,input,select,output,[role="status"]';
      const controls = [...trailing.querySelectorAll<HTMLElement>(controlSelector)].filter(
        (control) =>
          control.getClientRects().length &&
          !control.closest('[role="menu"],.studio-tooltip,[role="dialog"]') &&
          (!control.closest('details') || !!control.closest('summary')) &&
          !control.parentElement?.closest(controlSelector),
      );
      const actionWidth =
        controls.reduce((total, control) => total + control.getBoundingClientRect().width, 0) +
        Math.max(0, controls.length - 1) * (parseFloat(window.getComputedStyle(trailing).gap) || 8);
      const leadingControl = leading.firstElementChild;
      const branding = [
        ...leading.querySelectorAll<HTMLElement>('.planr-mark,.design-wordmark'),
      ].filter((node) => node.getClientRects().length);
      const brandingWidth = branding.reduce(
        (total, node) => total + node.getBoundingClientRect().width + 8,
        0,
      );
      const leadingFloor =
        128 +
        brandingWidth +
        (leadingControl instanceof window.HTMLElement &&
        !leadingControl.classList.contains('planr-brand')
          ? leadingControl.getBoundingClientRect().width + 8
          : 0);
      const outerWidth = Math.max(leadingFloor, actionWidth);
      element.dataset.studioLayout =
        centerWidth > 0
          ? width <= 680 || centerWidth + outerWidth * 2 + gap * 2 > available
            ? 'compact'
            : 'inline'
          : leadingFloor + actionWidth + gap > available
            ? 'compact'
            : 'inline';
    };
    measure();
    let frame = 0;
    const scheduleMeasure = () => {
      if (frame) return;
      // ResizeObserver delivery must remain read-only; write layout in the next frame.
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const resize =
      typeof window.ResizeObserver === 'function'
        ? new window.ResizeObserver(scheduleMeasure)
        : null;
    for (const node of [element, center, trailing]) resize?.observe(node);
    const mutations = new window.MutationObserver(scheduleMeasure);
    mutations.observe(element, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden'],
    });
    window.addEventListener('resize', scheduleMeasure);
    let active = true;
    void element.ownerDocument.fonts?.ready.then(() => {
      if (active) scheduleMeasure();
    });
    return () => {
      active = false;
      resize?.disconnect();
      mutations.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [Tag]);
  return (
    <Tag
      ref={(node) => {
        toolbar.current = node;
      }}
      className={`planr-toolbar studio-toolbar ${className}`}
      data-studio-react-chrome="true"
    >
      <div className="studio-toolbar-leading design-toolbar-leading">
        {leading}
        <div className="planr-brand">
          {brand && (
            <>
              <StudioMark />
              <span className="design-wordmark">
                Open<span>Planr</span>
              </span>
            </>
          )}
          <div className="studio-identity">
            {hierarchy.length > 0 && (
              <nav className="studio-hierarchy" aria-label="Project path">
                {hierarchy.map((item, index) => (
                  <span key={item.href ?? item.label}>
                    {index > 0 && <span aria-hidden="true"> / </span>}
                    {item.href ? <a href={item.href}>{item.label}</a> : item.label}
                  </span>
                ))}
              </nav>
            )}
            <span className="planr-title-block">
              <StudioBadge>
                {kind === 'artifact' ? 'Artifact' : kind === 'diagram' ? 'Diagram' : 'Design'}
              </StudioBadge>
              {titleNode ?? <strong title={title}>{title}</strong>}
            </span>
            {subtitle && <span className="studio-subtitle">{subtitle}</span>}
          </div>
        </div>
      </div>
      <div className="studio-toolbar-center">{viewPicker}</div>
      <div className="studio-toolbar-trailing design-toolbar-trailing">
        <div className="studio-toolbar-status">{status}</div>
        <div className="studio-toolbar-actions">{actions}</div>
      </div>
    </Tag>
  );
}
export interface StudioMenuItem {
  id: string;
  label: string;
  group?: string;
  disabled?: boolean;
  onSelect?: () => void;
  attributes?: Record<string, string>;
}
export function StudioMenu({
  label,
  items,
  className = '',
  triggerAttributes = {},
  open,
  onOpenChange,
}: {
  label: string;
  items: readonly StudioMenuItem[];
  className?: string;
  triggerAttributes?: Record<string, string>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <DropdownMenu.Root modal={false} open={open} onOpenChange={onOpenChange}>
      <span className={`studio-menu ${className}`}>
        <DropdownMenu.Trigger asChild>
          <StudioButton aria-label={label} title={label} {...triggerAttributes} ref={trigger}>
            {label}
            <span aria-hidden="true">⌄</span>
          </StudioButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          className="studio-menu-content"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            // Own the deferred return so preserving newer focus cannot leave Radix's
            // outside-interaction flag stale for the next close.
            event.preventDefault();
            const content = event.target as HTMLElement | null;
            const ownerDocument = content?.ownerDocument;
            const active = ownerDocument?.activeElement;
            if (
              active?.isConnected &&
              active !== ownerDocument?.body &&
              active !== ownerDocument?.documentElement &&
              !content?.contains(active)
            )
              return;
            if (trigger.current?.isConnected) trigger.current.focus();
          }}
        >
          {items.map((item, index) => (
            <DropdownMenu.Item
              asChild
              key={item.id}
              disabled={item.disabled}
              onSelect={item.onSelect}
            >
              <button
                type="button"
                className={`studio-menu-item${index > 0 && item.group !== items[index - 1].group ? ' studio-menu-group-start' : ''}`}
                disabled={item.disabled}
                {...item.attributes}
              >
                {item.label}
              </button>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </span>
    </DropdownMenu.Root>
  );
}
export function StudioTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={500}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Content className="studio-tooltip" sideOffset={6}>
          {label}
        </Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
export function StudioStatus({
  label,
  tone = 'quiet',
  onDismiss,
  attributes = {},
}: {
  label: string;
  tone?: 'quiet' | 'loading' | 'success' | 'error';
  onDismiss?: () => void;
  attributes?: Record<string, string>;
}) {
  return (
    <span className="studio-status" data-tone={tone}>
      <span role="status" aria-live="polite" {...attributes}>
        {label}
      </span>
      {onDismiss && (
        <StudioButton variant="ghost" aria-label="Dismiss status" onClick={onDismiss}>
          ×
        </StudioButton>
      )}
    </span>
  );
}
export function StudioPanelDialog({
  open,
  onOpenChange,
  title,
  description = 'Inspect this panel, then close it to return to the canvas.',
  side = 'right',
  children,
  container,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  side?: 'left' | 'right';
  children: ReactNode;
  container?: HTMLElement;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="studio-panel-overlay" />
        <Dialog.Content
          onCloseAutoFocus={onCloseAutoFocus}
          className={`studio-panel-dialog studio-panel-${side}`}
        >
          <Dialog.Title className="planr-visually-hidden">{title}</Dialog.Title>
          <Dialog.Description className="planr-visually-hidden">{description}</Dialog.Description>
          <Dialog.Close asChild>
            <StudioButton
              className="studio-panel-close"
              variant="ghost"
              aria-label={`Close ${title.toLowerCase()}`}
            >
              ×
            </StudioButton>
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Standard modal chrome; application callbacks and authored content remain host-owned. */
export function StudioDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  container,
  className = '',
  showCloseButton = true,
  onCloseAutoFocus,
  onOpenAutoFocus,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  container?: HTMLElement;
  className?: string;
  showCloseButton?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
  onOpenAutoFocus?: (event: Event) => void;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="studio-dialog-overlay" />
        <Dialog.Content
          className={`studio-dialog ${className}`}
          {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
          {...(describedBy ? { 'aria-describedby': describedBy } : {})}
          onCloseAutoFocus={(event) => {
            if (onCloseAutoFocus) return onCloseAutoFocus(event);
            const target = opener.current;
            if (
              target?.isConnected &&
              !target.matches(':disabled,[aria-disabled="true"]') &&
              !target.closest('[inert]') &&
              target !== target.ownerDocument.body &&
              target !== target.ownerDocument.documentElement
            ) {
              event.preventDefault();
              target.focus({ preventScroll: true });
            }
          }}
          onOpenAutoFocus={(event) => {
            const document = (event.target as HTMLElement)?.ownerDocument;
            const active = document?.activeElement;
            const Element = document?.defaultView?.HTMLElement;
            opener.current = Element && active instanceof Element ? active : null;
            onOpenAutoFocus?.(event);
          }}
        >
          {title && <Dialog.Title className="studio-dialog-title">{title}</Dialog.Title>}
          {/* Radix checks its generated structural IDs even when the accessible name
              belongs to existing host content. Keep those IDs distinct and silent. */}
          {!title && labelledBy && (
            <Dialog.Title className="planr-visually-hidden" aria-hidden="true" />
          )}
          {description && (
            <Dialog.Description className="studio-dialog-description">
              {description}
            </Dialog.Description>
          )}
          {!description && describedBy && (
            <Dialog.Description className="planr-visually-hidden" aria-hidden="true" />
          )}
          {showCloseButton && (
            <Dialog.Close asChild>
              <StudioButton
                className="studio-panel-close"
                variant="ghost"
                aria-label="Close dialog"
              >
                ×
              </StudioButton>
            </Dialog.Close>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
