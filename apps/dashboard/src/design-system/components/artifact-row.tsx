import { type CSSProperties, type ReactNode, useId } from 'react';
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
