import type { Direction } from './types.mjs';

export type KeyAction =
  | { type: 'navigate' | 'pan'; direction: Direction }
  | { type: 'zoom'; factor: number }
  | { type: 'reset' | 'fit-all' | 'fit-selection' | 'select' | 'escape' | 'first' | 'last' };

export function keyAction(
  event: KeyboardEvent,
  arrows: 'navigate' | 'none',
  shortcuts: () => boolean,
): KeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key;
  if (key.startsWith('Arrow')) {
    if (arrows === 'none') return null;
    const direction = (
      { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const
    )[key as 'ArrowUp'];
    return direction ? { type: event.shiftKey ? 'pan' : 'navigate', direction } : null;
  }
  if (key === 'Enter' || key === ' ') return { type: 'select' };
  if (key === 'Escape') return { type: 'escape' };
  if (key === 'Home') return { type: 'first' };
  if (key === 'End') return { type: 'last' };
  if (!shortcuts()) return null;
  if (key === '+' || key === '=') return { type: 'zoom', factor: 1.25 };
  if (key === '-') return { type: 'zoom', factor: 1 / 1.25 };
  if (key === '0' && !event.shiftKey) return { type: 'reset' };
  if (event.shiftKey && (key === '1' || key === '!' || event.code === 'Digit1'))
    return { type: 'fit-all' };
  if (event.shiftKey && (key === '2' || key === '@' || event.code === 'Digit2'))
    return { type: 'fit-selection' };
  return null;
}
