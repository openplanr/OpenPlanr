import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Toast } from '../../design-system/components/index.js';
import {
  type DashboardProductState,
  isValidatedDashboardProductState,
} from '../../lib/api/product-state.js';
import {
  type PlanningView,
  serializePlanningViewHref,
} from '../../lib/routing/planning-view-codec.js';
import { planningNodesFromProductState } from '../planning/planning-workspace.js';

export const FILED_SINCE_YESTERDAY: PlanningView = Object.freeze<PlanningView>({
  schemaVersion: '1.0.0',
  route: 'list',
  filters: {
    type: ['backlog'],
    status: [],
    priority: [],
    label: [],
    query: '',
    createdWithinDays: 2,
    updatedWithinDays: null,
  },
  groupBy: 'label',
  sort: { field: 'id', direction: 'asc' },
  density: 'comfortable',
  focusId: null,
});

type Feedback = Readonly<{
  revision: number;
  ids: readonly string[];
  changedIds: readonly string[];
}>;

export function usePlanningLiveFeedback(projection: DashboardProductState<unknown>) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<number | null>(null);
  const previous = useRef<{ scope: string; cursor: string; nodes: Map<string, string> } | null>(
    null,
  );
  const revision = useRef(0);
  const binding = isValidatedDashboardProductState(projection) ? projection.binding : null;
  const scope = binding
    ? JSON.stringify([
        binding.actorId,
        binding.projectId,
        binding.scopeId,
        binding.domainId,
        binding.domainVersion,
        binding.generation,
      ])
    : null;
  useLayoutEffect(() => {
    if (previous.current && previous.current.scope !== scope) {
      previous.current = null;
      setFeedback(null);
      setLastSnapshotAt(null);
    }
    if (!binding || !scope || projection.kind !== 'ready' || !projection.data) return;
    const cursor = JSON.stringify([binding.eventHead, binding.viewHash]);
    const retained = previous.current;
    if (retained?.scope === scope && retained.cursor === cursor) return;
    const nodes = new Map(
      planningNodesFromProductState(projection).map((node) => [node.id, JSON.stringify(node)]),
    );
    previous.current = { scope, cursor, nodes };
    setLastSnapshotAt(Date.now());
    if (!retained || retained.scope !== scope) {
      setFeedback(null);
      return;
    }
    const ids = [...new Set([...nodes.keys(), ...retained.nodes.keys()])].filter(
      (id) => nodes.get(id) !== retained.nodes.get(id),
    );
    if (ids.length === 0) return;
    revision.current += 1;
    setFeedback((current) => ({
      revision: revision.current,
      changedIds: ids,
      ids: [...new Set([...(current?.ids ?? []), ...ids])],
    }));
  }, [binding, projection, scope]);
  const sameScope = previous.current?.scope === scope;
  return {
    feedback: sameScope ? feedback : null,
    lastSnapshotAt: sameScope ? lastSnapshotAt : null,
    dismiss: () => setFeedback(null),
  };
}

export function PlanningLiveFeedback({
  feedback,
  onDismiss,
  onShow,
}: {
  feedback: Feedback | null;
  onDismiss: () => void;
  onShow: (href: string) => void;
}) {
  const marked = useRef(new Map<HTMLElement, ReturnType<typeof setTimeout> | null>());
  useEffect(
    () => () => {
      for (const [element, timer] of marked.current) {
        if (timer) clearTimeout(timer);
        element.removeAttribute('data-live-changed');
        element.removeAttribute('aria-description');
      }
      marked.current.clear();
    },
    [],
  );
  useLayoutEffect(() => {
    if (!feedback) {
      for (const [element, timer] of marked.current) {
        if (timer) clearTimeout(timer);
        element.removeAttribute('data-live-changed');
        element.removeAttribute('aria-description');
      }
      marked.current.clear();
      return;
    }
    for (const [element, timer] of marked.current) {
      if (element.isConnected) continue;
      if (timer) clearTimeout(timer);
      marked.current.delete(element);
    }
    const changed = new Set(feedback.changedIds);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    for (const element of document.querySelectorAll<HTMLElement>(
      '.pc-shell [data-keyboard-item]',
    )) {
      if (!changed.has(element.dataset.keyboardItem ?? '')) continue;
      const timer = marked.current.get(element);
      if (timer) clearTimeout(timer);
      element.setAttribute(
        'data-live-changed',
        reduced ? 'dot' : element.dataset.liveChanged === 'wash-a' ? 'wash-b' : 'wash-a',
      );
      element.setAttribute('aria-description', 'Changed on disk');
      marked.current.set(
        element,
        reduced
          ? null
          : setTimeout(() => {
              element.removeAttribute('data-live-changed');
              element.removeAttribute('aria-description');
              marked.current.delete(element);
            }, 1600),
      );
    }
  }, [feedback]);
  useEffect(() => {
    const viewed = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      const element = event.target.closest<HTMLElement>('[data-live-changed="dot"]');
      if (!element) return;
      element.removeAttribute('data-live-changed');
      element.removeAttribute('aria-description');
      marked.current.delete(element);
    };
    document.addEventListener('focusin', viewed);
    return () => document.removeEventListener('focusin', viewed);
  }, []);
  if (!feedback) return null;
  const href = serializePlanningViewHref(FILED_SINCE_YESTERDAY);
  return (
    <div className="pc-live-feedback">
      <Toast
        kind="disk-change"
        title={`${feedback.ids.length} ${feedback.ids.length === 1 ? 'item' : 'items'} changed on disk`}
        onDismiss={() => {
          if (document.activeElement?.closest('.pc-live-feedback')) {
            const target =
              document.querySelector<HTMLElement>('.pc-shell [data-selected="true"]') ??
              document.querySelector<HTMLElement>('.pc-shell main h1');
            if (target) {
              if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
              target.focus({ preventScroll: true });
            }
          }
          onDismiss();
        }}
        action={
          <a
            href={href}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onShow(href);
            }}
          >
            Show Filed since yesterday
          </a>
        }
      >
        {feedback.ids.slice(0, 3).join(', ')}
        {feedback.ids.length > 3 ? ` and ${feedback.ids.length - 3} more` : ''}
      </Toast>
    </div>
  );
}
