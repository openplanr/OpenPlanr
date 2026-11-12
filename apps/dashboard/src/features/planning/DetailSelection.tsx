import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { SelectionBar } from '../../design-system/components/index.js';
import { usePlanningCopy, usePlanningShortcuts } from '../../lib/routing/planning-presentation.js';
import { NextStepDocked, nextStep } from './DetailNextStep.js';
import { CopyDetailValue } from './PlanningDetailActions.js';
import { boardSelectionItems, useBoardPhoneWidth } from './planning-board-view.js';
import { useListLayout } from './planning-list-window.js';
import { type PlanningModelNode, planningDetailHref } from './planning-model.js';
import type { StructuralDetailModel } from './planning-structural-model.js';

type DetailSelection = Readonly<{
  selectedId: string | null;
  select: (node: PlanningModelNode) => void;
}>;

const SelectionContext = createContext<DetailSelection | null>(null);

function open(node: PlanningModelNode) {
  const href = planningDetailHref(node);
  if (href) window.location.hash = href;
}

/** True when Detail lays out as one narrow column: the Inspector panel, or a phone. */
export function useDetailCompact(panel: boolean): boolean {
  const phone = useListLayout() === 'phone';
  return panel || phone;
}

/** True below 600px, where the next step docks above the navigation. */
export function useDetailPhone(): boolean {
  return useListLayout() === 'phone';
}

/** True below 900px, where the top bar carries the back link, ID and Copy link. */
export const useDetailNarrow = useBoardPhoneWidth;

/** Click and Space select a linked item; Enter and double-click open it. Outside a scope links navigate. */
export function useDetailSelectable(node: PlanningModelNode) {
  const scope = useContext(SelectionContext);
  if (!scope) return {};
  return {
    'data-selected': scope.selectedId === node.id || undefined,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.detail === 0 || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      scope.select(node);
    },
    onDoubleClick: (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      open(node);
    },
    onKeyDown: (event: KeyboardEvent<HTMLAnchorElement>) => {
      if (event.key !== ' ') return;
      event.preventDefault();
      scope.select(node);
    },
  };
}

function NextStepBar({ command }: { command: string }) {
  return (
    <section className="pc-detail__next-bar" aria-label="Next step command">
      <code className="pc-detail__next-bar-command" title={command}>
        {command}
      </code>
      <CopyDetailValue value={command} label="Copy command" icon={null} />
    </section>
  );
}

/** Selection on the full page, with the selection bar or, on a phone, the docked next step. */
export function DetailSelectionScope({
  nodes,
  node,
  detail,
  panel,
  children,
}: {
  nodes: readonly PlanningModelNode[];
  node: PlanningModelNode;
  detail: StructuralDetailModel;
  panel: boolean;
  children: ReactNode;
}) {
  const copy = usePlanningCopy();
  const shortcutsEnabled = usePlanningShortcuts();
  const phone = useDetailPhone();
  const [selection, setSelection] = useState<{ owner: string; id: string } | null>(null);
  const selectedId = selection?.owner === node.id ? selection.id : null;
  const selected = selectedId ? (nodes.find((entry) => entry.id === selectedId) ?? null) : null;
  useEffect(() => {
    if (!selected) return;
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      setSelection(null);
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [selected]);
  if (panel) return children;
  const items = boardSelectionItems(selected ?? undefined);
  const command = phone && !items.length ? nextStep(node, detail.dependencies).command : null;
  return (
    <SelectionContext.Provider
      value={{
        selectedId,
        select: (target) => setSelection({ owner: node.id, id: target.id }),
      }}
    >
      <NextStepDocked.Provider value={Boolean(command)}>{children}</NextStepDocked.Provider>
      {items.length ? (
        <SelectionBar
          items={items}
          onCopy={copy}
          shortcutsEnabled={shortcutsEnabled}
          onClear={() => setSelection(null)}
          onOpen={() => {
            if (selected) open(selected);
          }}
        />
      ) : null}
      {command ? <NextStepBar command={command} /> : null}
    </SelectionContext.Provider>
  );
}
