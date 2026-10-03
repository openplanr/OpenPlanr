import { Dialog, DropdownMenu, Tooltip } from 'radix-ui';
import { type ComponentPropsWithoutRef, forwardRef, type ReactNode } from 'react';

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
  return (
    <Tag className={`planr-toolbar studio-toolbar ${className}`} data-studio-react-chrome="true">
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
      {viewPicker}
      <div className="studio-toolbar-trailing design-toolbar-trailing">
        {status}
        {actions}
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
}: {
  label: string;
  items: readonly StudioMenuItem[];
  className?: string;
  triggerAttributes?: Record<string, string>;
}) {
  return (
    <DropdownMenu.Root>
      <span className={`studio-menu ${className}`}>
        <DropdownMenu.Trigger asChild>
          <StudioButton aria-label={label} title={label} {...triggerAttributes}>
            {label}
            <span aria-hidden="true">⌄</span>
          </StudioButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          className="studio-menu-content"
          align="end"
          sideOffset={8}
          collisionPadding={8}
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
