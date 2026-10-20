import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { PcIcon } from './console-icon.js';
import './chip-menu.css';

export type SelectOption = Readonly<{ value: string; label: string }>;
export type SelectProps = Readonly<{
  value: string;
  onChange: (value: string) => void;
  options: readonly (SelectOption | string)[];
  ariaLabel: string;
  size?: 'sm' | 'md' | 'lg';
  width?: number;
  disabled?: boolean;
  disabledReason?: string;
  error?: string;
  values?: readonly string[];
  onValuesChange?: (values: string[]) => void;
  clearValue?: string;
  trigger?: ReactNode;
  triggerLabel?: string;
  active?: boolean;
}>;

/** Overlay listbox opened by a filter chip. */
export function Select({
  value,
  onChange,
  options,
  ariaLabel,
  size = 'md',
  width,
  disabled = false,
  disabledReason,
  error,
  values,
  onValuesChange,
  clearValue,
  trigger,
  triggerLabel,
  active,
}: SelectProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 220, maxHeight: 360 });
  const anchor = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: '', time: 0 });
  const scrollSelection = useRef(false);
  const items = options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  );
  const multiple = values !== undefined;
  const chosen = multiple ? values : [value];
  const selected = items.filter((item) => chosen.includes(item.value));
  const label =
    triggerLabel ??
    (selected.length
      ? selected.map((item) => item.label).join(', ')
      : (items.find((item) => item.value === clearValue)?.label ?? ariaLabel));
  const reason = error ?? disabledReason;
  const close = (restore = false) => {
    setOpen(false);
    if (restore) anchor.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = Math.min(Math.max(rect.width, 220), window.innerWidth - 16);
      const menuHeight = Math.min(popup.current?.scrollHeight ?? 360, 360);
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const opensAbove = below < menuHeight && above > below;
      const maxHeight = Math.max(0, Math.min(360, opensAbove ? above : below));
      setPosition({
        top: opensAbove
          ? Math.max(8, rect.top - 6 - Math.min(menuHeight, maxHeight))
          : rect.bottom + 6,
        maxHeight,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
        width: menuWidth,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !anchor.current?.contains(event.target) &&
        !popup.current?.contains(event.target)
      )
        setOpen(false);
    };
    const focusOutside = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !anchor.current?.contains(event.target) &&
        !popup.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', focusOutside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', focusOutside);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (open && scrollSelection.current)
      document.getElementById(`${id}-${cursor}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [cursor, id, open]);
  const choose = (next: string) => {
    if (disabled) return;
    if (multiple && onValuesChange) {
      onValuesChange(
        next === clearValue
          ? []
          : chosen.includes(next)
            ? chosen.filter((item) => item !== next)
            : [...chosen, next],
      );
      anchor.current?.focus({ preventScroll: true });
    } else {
      onChange(next);
      close(true);
    }
  };
  const show = (last = false) => {
    scrollSelection.current = true;
    const selectedIndex = items.findIndex((item) => chosen.includes(item.value));
    setCursor(last ? Math.max(0, items.length - 1) : Math.max(0, selectedIndex));
    setOpen(true);
  };
  const search = (event: KeyboardEvent<HTMLButtonElement | HTMLDivElement>) => {
    if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const now = Date.now();
    const text =
      now - typeahead.current.time < 700
        ? typeahead.current.text + event.key.toLowerCase()
        : event.key.toLowerCase();
    typeahead.current = { text, time: now };
    const next = items.findIndex((item) => item.label.toLowerCase().startsWith(text));
    if (next >= 0) {
      scrollSelection.current = true;
      setCursor(next);
      setOpen(true);
    }
  };
  const move = (key: string) => {
    scrollSelection.current = true;
    if (!open) {
      show(key === 'End' || key === 'ArrowUp');
      return;
    }
    setCursor((index) => {
      if (key === 'Home') return 0;
      if (key === 'End') return items.length - 1;
      return (index + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    });
  };
  const keys = (event: KeyboardEvent<HTMLButtonElement | HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
        return;
      case 'Tab':
        if (open && !event.shiftKey && clearValue !== undefined) {
          event.preventDefault();
          popup.current?.querySelector<HTMLButtonElement>('button')?.focus();
        } else close();
        return;
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
        if (!items.length) return;
        event.preventDefault();
        move(event.key);
        return;
      case 'Enter':
      case ' ':
        if (!items.length) return;
        event.preventDefault();
        if (open && items[cursor]) choose(items[cursor].value);
        else show();
        return;
      default:
        search(event);
    }
  };

  return (
    <span className="pc-field-control pc-chip-menu" style={{ width }}>
      <button
        ref={anchor}
        type="button"
        role="combobox"
        className="pc-chip"
        data-size={size}
        data-active={
          active ??
          (multiple ? values.length > 0 : clearValue !== undefined && value !== clearValue)
        }
        data-rich={Boolean(trigger) || undefined}
        data-invalid={Boolean(error) || undefined}
        aria-label={label.startsWith(`${ariaLabel}:`) ? label : `${ariaLabel}: ${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && items.length ? `${id}-${cursor}` : undefined}
        aria-describedby={reason ? `${id}-reason` : undefined}
        aria-invalid={Boolean(error) || undefined}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={keys}
      >
        <span className="pc-chip__label">{trigger ?? label}</span>
        <PcIcon name="chevron-down" size={13} />
      </button>
      {reason ? (
        <span id={`${id}-reason`} className="pc-control-reason" role={error ? 'alert' : undefined}>
          {reason}
        </span>
      ) : null}
      {open
        ? createPortal(
            <div ref={popup} className="pc-chip-menu__popup" style={position}>
              <div
                id={`${id}-list`}
                role="listbox"
                className="pc-chip-menu__list"
                aria-label={ariaLabel}
                aria-multiselectable={multiple || undefined}
              >
                {items.map((item, index) => (
                  <div
                    key={item.value}
                    id={`${id}-${index}`}
                    role="option"
                    aria-label={item.label}
                    tabIndex={-1}
                    onKeyDown={keys}
                    aria-selected={
                      multiple && item.value === clearValue
                        ? values.length === 0
                        : chosen.includes(item.value)
                    }
                    className="pc-chip-menu__option"
                    data-focused={cursor === index || undefined}
                    onPointerMove={() => {
                      scrollSelection.current = false;
                      setCursor(index);
                    }}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => choose(item.value)}
                  >
                    <span>{item.label}</span>
                    <PcIcon name="check" size={15} />
                  </div>
                ))}
              </div>
              {clearValue !== undefined ? (
                <button
                  className="pc-chip-menu__clear"
                  type="button"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      close(true);
                    } else if (event.key === 'Tab') {
                      if (event.shiftKey) {
                        event.preventDefault();
                        anchor.current?.focus();
                      } else close(true);
                    }
                  }}
                  onClick={() => {
                    if (multiple && onValuesChange) onValuesChange([]);
                    else onChange(clearValue);
                    close(true);
                  }}
                >
                  Clear {ariaLabel}
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

export type ChipToggleProps = Readonly<{
  children: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
}>;

/** A chip that toggles one view setting. */
export function ChipToggle({ children, checked, onChange, ariaLabel }: ChipToggleProps) {
  return (
    <button
      type="button"
      className="pc-chip"
      data-active={checked}
      aria-label={ariaLabel}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
    >
      {children}
    </button>
  );
}
