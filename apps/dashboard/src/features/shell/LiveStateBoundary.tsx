import {
  createContext,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  canonicalDashboardHref,
  dashboardRouteDefinition,
  dashboardRouteScopeKey,
  type ParsedDashboardRoute,
  parseDashboardRoute,
} from '../../app/router.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';

export type LiveSubjectTransition = Readonly<{
  kind: 'current' | 'deleted' | 'superseded';
  subjectId: string | null;
  successorHref?: string;
}>;

type LiveStateContextValue = Readonly<{
  routeScopeKey: string;
  pointerActive: boolean;
  mutationSafe: boolean;
  transition: LiveSubjectTransition;
}>;

const CURRENT_TRANSITION: LiveSubjectTransition = Object.freeze({
  kind: 'current',
  subjectId: null,
});

const LiveStateContext = createContext<LiveStateContextValue | null>(null);

function bindingScopeKey(binding: DashboardQueryIdentity | null): string {
  if (!binding) return 'unbound';
  return [
    binding.productArea,
    binding.route,
    binding.actorId,
    binding.projectId,
    binding.scopeId,
    binding.domainId,
    binding.domainVersion,
    binding.cycleId ?? 'no-cycle',
    binding.subjectId ?? 'collection',
    String(binding.generation),
  ].join('\u001f');
}

function closeUnsafeControls(root: HTMLElement): void {
  root.dispatchEvent(new CustomEvent('openplanr-live-state-close', { bubbles: false }));
  for (const control of root.querySelectorAll<HTMLElement>('[data-live-unsafe-control]')) {
    if (control instanceof HTMLDetailsElement) control.open = false;
    if (control instanceof HTMLDialogElement && control.open) control.close();
  }
}

function deterministicFocusTarget(root: HTMLElement): HTMLElement {
  return (
    root.querySelector<HTMLElement>('[data-live-successor]') ??
    root.querySelector<HTMLElement>('[data-live-focus-return]') ??
    root
  );
}

export type LiveStateBoundaryProps = Readonly<{
  children: ReactNode;
  route: ParsedDashboardRoute;
  binding: DashboardQueryIdentity | null;
  transition?: LiveSubjectTransition;
  trackedSubjectId?: string | null;
}>;

/**
 * Keeps the route work region mounted for cursor-only progress. A real route/binding generation
 * change closes unsafe overlays; subject removal also restores focus and explains the safe state.
 */
export function LiveStateBoundary({
  children,
  route,
  binding,
  transition = CURRENT_TRANSITION,
  trackedSubjectId = null,
}: LiveStateBoundaryProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pointerActive, setPointerActive] = useState(false);
  const scopeKey = `${dashboardRouteScopeKey(route)}\u001e${bindingScopeKey(binding)}`;
  const previousScopeRef = useRef(scopeKey);
  const exactSubjectId = binding?.subjectId ?? route.subjectId ?? trackedSubjectId;
  const exactTransition =
    transition.kind === 'current' ||
    (transition.subjectId !== null && transition.subjectId === exactSubjectId)
      ? transition
      : CURRENT_TRANSITION;
  const transitionKey = `${exactTransition.kind}:${exactTransition.subjectId ?? ''}:${exactTransition.successorHref ?? ''}`;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || previousScopeRef.current === scopeKey) return;
    closeUnsafeControls(root);
    setPointerActive(false);
    deterministicFocusTarget(root).focus({ preventScroll: true });
    previousScopeRef.current = scopeKey;
  }, [scopeKey]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || transitionKey.startsWith('current:')) return;
    closeUnsafeControls(root);
    setPointerActive(false);
    deterministicFocusTarget(root).focus({ preventScroll: true });
  }, [transitionKey]);

  useEffect(() => {
    if (!pointerActive || typeof window === 'undefined') return;
    const finish = () => setPointerActive(false);
    window.addEventListener('pointerup', finish, { capture: true, once: true });
    window.addEventListener('pointercancel', finish, { capture: true, once: true });
    return () => {
      window.removeEventListener('pointerup', finish, { capture: true });
      window.removeEventListener('pointercancel', finish, { capture: true });
    };
  }, [pointerActive]);

  const successorHref = exactTransition.successorHref
    ? canonicalDashboardHref(exactTransition.successorHref)
    : null;
  const successorDefinition = successorHref
    ? dashboardRouteDefinition(parseDashboardRoute(successorHref))
    : null;
  const value = useMemo<LiveStateContextValue>(
    () =>
      Object.freeze({
        routeScopeKey: scopeKey,
        pointerActive,
        mutationSafe: exactTransition.kind === 'current',
        transition: exactTransition,
      }),
    [exactTransition, pointerActive, scopeKey],
  );
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.isPrimary) setPointerActive(true);
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.isPrimary) setPointerActive(false);
  };

  return (
    <LiveStateContext.Provider value={value}>
      <div
        ref={rootRef}
        tabIndex={-1}
        data-live-state-boundary={exactTransition.kind}
        data-live-route-scope={scopeKey}
        onPointerDownCapture={onPointerDown}
        onPointerUpCapture={onPointerEnd}
        onPointerCancelCapture={onPointerEnd}
      >
        {exactTransition.kind !== 'current' ? (
          <div className="op-projection-boundary__notice" role="status" aria-live="polite">
            <strong>
              {exactTransition.kind === 'deleted'
                ? 'This item is no longer available'
                : 'This item has a newer successor'}
            </strong>
            <span>
              {exactTransition.kind === 'deleted'
                ? 'The current public projection no longer includes this item. Unsafe controls were closed.'
                : 'A newer public subject is available. Unsafe controls were closed before continuing.'}
            </span>
            {successorHref && successorDefinition ? (
              <a className="op-inline-action" data-live-successor href={successorHref}>
                Open {successorDefinition.label}
              </a>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
    </LiveStateContext.Provider>
  );
}

export function useLiveStateBoundary(): LiveStateContextValue {
  const context = useContext(LiveStateContext);
  if (!context) throw new Error('useLiveStateBoundary must be used inside LiveStateBoundary.');
  return context;
}

/** Retains existing item order during an active pointer gesture and appends newly arrived items. */
export function useStableLiveOrder<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): readonly T[] {
  const { pointerActive } = useLiveStateBoundary();
  const orderRef = useRef<readonly string[]>([]);
  const itemByKey = new Map(items.map((item) => [keyOf(item), item]));
  if (!pointerActive) {
    orderRef.current = items.map(keyOf);
    return items;
  }
  const existing = orderRef.current.filter((key) => itemByKey.has(key));
  const known = new Set(existing);
  const appended = items.map(keyOf).filter((key) => !known.has(key));
  orderRef.current = [...existing, ...appended];
  return orderRef.current.flatMap((key) => {
    const item = itemByKey.get(key);
    return item === undefined ? [] : [item];
  });
}
