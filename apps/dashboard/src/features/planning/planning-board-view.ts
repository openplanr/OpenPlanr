import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { artifactTagType } from '../../design-system/components/artifact-recipes.js';
import type { SelectionBarItem } from '../../design-system/components/selection-bar.js';
import {
  browserListPreferences,
  usePlanningPresentation,
} from '../../lib/routing/planning-presentation.js';
import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import { bulkListCommands } from './planning-list-filter.js';
import {
  type PlanningModelNode,
  planningContinuation,
  planningDisplayId,
} from './planning-model.js';

const VIEW_KEY = 'op-board-view:v1';
const PHONE_QUERY = '(max-width: 899px)';

function phoneWidth() {
  return window.matchMedia?.(PHONE_QUERY).matches ?? false;
}

function subscribePhoneWidth(onChange: () => void) {
  const query = window.matchMedia?.(PHONE_QUERY);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

/** True below the width where the Board shows one status column at a time. */
export function useBoardPhoneWidth() {
  return useSyncExternalStore(subscribePhoneWidth, phoneWidth, () => false);
}

function storedLanes(): { lanes: boolean; failed: boolean } {
  try {
    return { lanes: browserListPreferences.load(VIEW_KEY) === 'lanes', failed: false };
  } catch {
    return { lanes: false, failed: true };
  }
}

/** Columns or Lanes, remembered per browser; a URL view's grouping takes precedence. */
export function useBoardView(presentation: PlanningView | null, setPage: (page: number) => void) {
  const storage = useRef<{ lanes: boolean; failed: boolean } | null>(null);
  const [swimlanes, setSwimlanes] = usePlanningPresentation('board:swimlanes', () => {
    if (presentation) return presentation.groupBy === 'spec';
    storage.current = storedLanes();
    return storage.current.lanes;
  });
  const [storageNotice, setStorageNotice] = useState('');
  useEffect(() => {
    if (storage.current?.failed)
      setStorageNotice('Browser storage is unavailable, so the Board view resets on reload.');
  }, []);
  useEffect(() => {
    if (!presentation) return;
    setSwimlanes(presentation.groupBy === 'spec');
    if (!presentation.focusId) setPage(0);
  }, [presentation, setPage, setSwimlanes]);
  const changeView = (value: string) => {
    setSwimlanes(value === 'lanes');
    setPage(0);
    try {
      browserListPreferences.save(VIEW_KEY, value);
      setStorageNotice('');
    } catch {
      setStorageNotice('View changed for this session. Browser storage is unavailable.');
    }
  };
  return { swimlanes, changeView, storageNotice };
}

/** Selection bar entry: the verified status command, else the item's continuation command. */
export function boardSelectionItems(node: PlanningModelNode | undefined): SelectionBarItem[] {
  if (!node) return [];
  const command = bulkListCommands([node], node.status).commands[0] ?? planningContinuation(node);
  if (!command) return [];
  const type = artifactTagType(node.type) ?? 't';
  return [{ id: planningDisplayId(node), title: node.title, type, command }];
}
