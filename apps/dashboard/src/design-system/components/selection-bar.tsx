import { useEffect, useRef } from 'react';
import { ArtifactTag, type ArtifactType } from './artifact-recipes.js';
import { CopyLabels } from './command-hint.js';
import { PcIcon } from './console-icon.js';
import { useCopyFeedback } from './use-copy-feedback.js';

export type SelectionBarItem = Readonly<{
  id: string;
  title: string;
  /** Planning items get the artifact ID tag; other items show the ID as plain text. */
  type?: ArtifactType;
  command: string;
}>;
export type SelectionBarProps = Readonly<{
  items: readonly SelectionBarItem[];
  onClear: () => void;
  /** Open renders only when given. */
  onOpen?: () => void;
  /** Names a copy that is not a command; the command preview is then left out. */
  copyLabel?: string;
  onCopy?: (text: string) => Promise<void>;
  disabled?: boolean;
  shortcutsEnabled?: boolean;
}>;

/** Floating command actions for the current selection. */
export function SelectionBar({
  items,
  onClear,
  onOpen,
  copyLabel,
  onCopy,
  disabled = false,
  shortcutsEnabled = true,
}: SelectionBarProps) {
  const root = useRef<HTMLElement>(null);
  const command = items.map((item) => item.command).join('\n');
  const feedback = useCopyFeedback(command, disabled, onCopy);
  const visible = items.length > 0;
  useEffect(() => {
    if (!visible || !shortcutsEnabled) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== 'c' ||
        target?.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]',
        ) ||
        document.querySelector('dialog[open], [aria-modal="true"]') ||
        root.current?.querySelector('button:disabled') ||
        disabled
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      void feedback.copy();
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [visible, disabled, shortcutsEnabled, feedback.copy]);
  const first = items[0];
  if (!first) return null;
  const label =
    copyLabel ?? (items.length === 1 ? 'Copy command' : `Copy ${items.length} commands`);
  const currentLabel = feedback.message || (feedback.state === 'pending' ? 'Copying' : label);
  return (
    <section
      ref={root}
      className="pc-selection-bar"
      aria-label="Selected items"
      data-selection-count={items.length}
    >
      {items.length === 1 ? (
        first.type ? (
          <ArtifactTag type={first.type} variant="id" surface="raised">
            {first.id}
          </ArtifactTag>
        ) : (
          <span className="pc-selection-bar__id">{first.id}</span>
        )
      ) : (
        <strong>{items.length} selected</strong>
      )}
      {items.length === 1 ? (
        <span className="pc-selection-bar__title" title={first.title}>
          {first.title}
        </span>
      ) : null}
      {copyLabel === undefined ? (
        <code className="pc-selection-bar__command" title={command}>
          {command}
        </code>
      ) : null}
      {onOpen ? (
        <button
          type="button"
          className="pc-selection-bar__open"
          onClick={onOpen}
          disabled={disabled}
        >
          Open
        </button>
      ) : null}
      <button
        type="button"
        className="pc-selection-bar__copy"
        data-state={feedback.state}
        onClick={feedback.copy}
        disabled={disabled || feedback.state === 'pending'}
        aria-keyshortcuts={shortcutsEnabled ? 'C' : undefined}
        aria-busy={feedback.state === 'pending' || undefined}
        title={feedback.error || undefined}
      >
        <CopyLabels idle={label} current={currentLabel} />
        {shortcutsEnabled ? (
          <span aria-hidden="true">
            <kbd>C</kbd>
          </span>
        ) : null}
      </button>
      <button
        type="button"
        className="pc-selection-bar__clear"
        onClick={onClear}
        disabled={disabled}
        aria-label="Clear selection"
      >
        <PcIcon name="x" size={16} />
      </button>
      <span className="pc-visually-hidden" aria-live="polite" aria-atomic="true">
        {feedback.message}
        {feedback.error ? `: ${feedback.error}` : ''}
      </span>
    </section>
  );
}
