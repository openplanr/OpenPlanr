import type { MouseEvent } from 'react';
import { useBoardPhoneWidth } from './planning-board-view.js';
import { inspectPlanningNode } from './planning-inspector.js';
import type { PlanningModelNode } from './planning-model.js';

export type TapSelectHandlers = Readonly<{
  onMouseDown: (event: MouseEvent<HTMLElement>) => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
}>;

function plainPointer(event: MouseEvent) {
  return !(event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

/**
 * Row handlers for below 900px: a pointer tap selects the node and the selection bar's Open opens
 * the Inspector. Keyboard activation, modified and non-primary clicks are left to the row.
 */
export function useTapSelect(): (node: PlanningModelNode) => TapSelectHandlers | undefined {
  return useTapSelectWith((node: PlanningModelNode) => inspectPlanningNode(node, false));
}

/** The same tap rule for rows that select through `onSelect` instead of the planning Inspector. */
export function useTapSelectWith<T>(
  onSelect: (item: T) => void,
): (item: T) => TapSelectHandlers | undefined {
  const narrow = useBoardPhoneWidth();
  return (item) =>
    narrow
      ? {
          // Focusing on mousedown would show the selection bar under the finger before the click lands.
          onMouseDown: (event) => {
            if (plainPointer(event)) event.preventDefault();
          },
          onClick: (event) => {
            if (event.detail === 0 || !plainPointer(event)) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            onSelect(item);
          },
        }
      : undefined;
}
