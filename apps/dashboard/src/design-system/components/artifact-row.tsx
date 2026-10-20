import { Popover } from 'radix-ui';
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { CommandHint, type CommandHintProps } from './command-hint.js';
import { PcIcon, type PcIconName } from './console-icon.js';
import { Tooltip } from './tooltip.js';
import './artifact-row.css';

export function artifactRowStyle(ids: readonly string[]): CSSProperties {
  const length = Math.max(0, ...ids.map((id) => id.length));
  return {
    '--id-col': `max(9ch, calc(${length}ch + ${length * 0.03}em + 16px))`,
    '--action-col': '28px',
  } as CSSProperties;
}

export function ArtifactRowTitle({ children }: { children: string }) {
  return (
    <span className="pc-artifact-row__title" title={children}>
      {children}
    </span>
  );
}

export function ArtifactRowCopy({
  id,
  command,
  onCopy,
  shortcutsEnabled,
}: {
  id: string;
  command: string | null;
  onCopy?: CommandHintProps['onCopy'];
  shortcutsEnabled?: boolean;
}) {
  return (
    <CommandHint
      command={command ?? ''}
      variant="row"
      artifactId={id}
      onCopy={onCopy}
      shortcutsEnabled={shortcutsEnabled}
      disabled={!command}
      disabledReason={command ? undefined : 'No verified command is available for this identity.'}
    />
  );
}

export function ArtifactRowMeta({
  icon,
  label,
  children,
}: {
  icon?: PcIconName;
  label: string;
  children: ReactNode;
}) {
  const descriptionId = useId();
  return (
    <Tooltip content={label}>
      <button type="button" className="pc-artifact-row__meta" aria-describedby={descriptionId}>
        {icon ? <PcIcon name={icon} size={13} /> : null}
        <span className="pc-artifact-row__meta-value">{children}</span>
        <span id={descriptionId} className="pc-visually-hidden">
          {label}
        </span>
      </button>
    </Tooltip>
  );
}

function coarsePointer() {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

function subscribePointer(onChange: () => void) {
  const query = window.matchMedia?.('(pointer: coarse)');
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

export function ArtifactRowMetaGroup({
  id,
  items,
}: {
  id: string;
  items: readonly { key: string; label: string; control: ReactNode; content?: ReactNode }[];
}) {
  const coarse = useSyncExternalStore(subscribePointer, coarsePointer, () => false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const merged = coarse && items.length > 1;
  useEffect(() => {
    if (!merged) setOpen(false);
  }, [merged]);
  return (
    <span className="pc-artifact-row__meta-group" data-merged={merged || undefined}>
      {merged ? (
        <Popover.Root
          open={open}
          onOpenChange={(next) => {
            if (!next) trigger.current?.focus({ preventScroll: true });
            setOpen(next);
          }}
        >
          <Popover.Trigger
            ref={trigger}
            className="pc-artifact-row__details"
            aria-label={`Details for ${id}: ${items.map((item) => item.label).join(', ')}`}
          >
            <PcIcon name="info" size={16} />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="pc-tooltip pc-artifact-row__popover"
              aria-label={`Details for ${id}`}
              data-keyboard-layer="true"
              sideOffset={8}
              collisionPadding={12}
              onEscapeKeyDown={(event) => event.stopPropagation()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <ul>
                {items.map((item) => (
                  <li key={item.key}>{item.content ?? item.label}</li>
                ))}
              </ul>
              <Popover.Close
                className="pc-artifact-row__details"
                aria-label={`Close details for ${id}`}
              >
                <PcIcon name="x" size={16} />
              </Popover.Close>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : (
        items.map((item) => <Fragment key={item.key}>{item.control}</Fragment>)
      )}
    </span>
  );
}

export function ArtifactRowAction({
  id,
  onCopy,
  onFocus,
  shortcutsEnabled = true,
  disabled = false,
  disabledReason,
}: {
  id: string;
  onCopy: () => void;
  onFocus?: () => void;
  shortcutsEnabled?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const reasonId = useId();
  return (
    <Tooltip content={disabledReason ?? 'Copy command (C)'}>
      <button
        type="button"
        className="pc-artifact-row__action"
        aria-label={`Copy command for ${id}`}
        aria-disabled={disabled || undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        aria-keyshortcuts={shortcutsEnabled ? 'C' : undefined}
        data-copy-command="true"
        onFocus={onFocus}
        onKeyDown={(event) => {
          if (
            event.key.toLowerCase() !== 'c' ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.shiftKey ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (shortcutsEnabled && !disabled) onCopy();
        }}
        onClick={() => {
          if (!disabled) onCopy();
        }}
      >
        <PcIcon name="copy" size={14} />
        {disabledReason ? (
          <span id={reasonId} className="pc-visually-hidden">
            {disabledReason}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}
