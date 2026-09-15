import { type ReactNode, useEffect, useId, useRef } from 'react';
import { StatePanel, type StatePanelState } from '../../design-system/components/index.js';
import {
  type DashboardProductState,
  type DashboardProductStateKind,
  isValidatedDashboardProductState,
  productStateAllowsMutation,
} from '../../lib/api/product-state.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../lib/binding/query-identity.js';
import { RecoveryGuidance } from './RecoveryGuidance.js';

type StateCopy = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  proven: string;
  notProven: string;
}>;

const COPY: Readonly<Record<DashboardProductStateKind, StateCopy>> = Object.freeze({
  booting: copy(
    'Compatibility check',
    'Verifying this dashboard',
    'OpenPlanr has not yet published a complete compatible context.',
    'The requested dashboard route is mounted.',
    'Package compatibility, binding, and durable state are not yet proven.',
  ),
  loading: copy(
    'Bound read',
    'Loading the exact projection',
    'The current public binding is known while its projection is loading.',
    'The actor, project, scope, domain, subject, and generation are exact.',
    'No current projection data or mutation authority is proven yet.',
  ),
  'first-use': copy(
    'First durable context',
    'Choose the first durable context',
    'The server proved that this exact binding has no established operating state.',
    'This is a validated first-use state for the current binding.',
    'No Cycle, continuation, or browser-created start action is implied.',
  ),
  ready: copy(
    'Current projection',
    'Current state is ready',
    'The projection passed its owner-boundary contract for the exact current binding.',
    'The displayed data is current and validated for this binding.',
    'No authority exists beyond exact runtime-issued allowed actions.',
  ),
  empty: copy(
    'Exact empty result',
    'Nothing is present in this view',
    'The server returned an empty result for this exact binding.',
    'The empty result belongs to the current route and binding.',
    'No missing Cycle, hidden item, or first-use state is inferred.',
  ),
  'read-only': copy(
    'Observer projection',
    'Current state is read-only',
    'Access-safe current data is available without mutation authority.',
    'The displayed projection is validated for this exact binding.',
    'No approval, execution, recovery, or write authority is available here.',
  ),
  refreshing: copy(
    'Reconciliation',
    'Refreshing current state',
    'A new exact projection is required before controls can become available.',
    'The retained projection still belongs to the current binding.',
    'The latest Event head and mutation safety are not yet reconciled.',
  ),
  stale: copy(
    'Stale projection',
    'Current view is stale',
    'Validated retained data is visible, but it is not the proven current head.',
    'The retained data belongs to this exact binding.',
    'Current Event-head parity and mutation safety are not proven.',
  ),
  degraded: copy(
    'Degraded projection',
    'Some current data is unavailable',
    'Only the access-safe validated portion of this bound projection is shown.',
    'The displayed portion passed its exact presentation contract.',
    'Completeness and mutation safety are not proven.',
  ),
  blocked: copy(
    'Blocked work',
    'Current work is blocked',
    'The projection proves a blocker without inventing a way around it.',
    'The blocker and retained data belong to the exact current binding.',
    'No bypass, completion, or recovery authority is implied.',
  ),
  unavailable: copy(
    'Unavailable projection',
    'This view is unavailable',
    'OpenPlanr could not provide this exact view in the current context.',
    'The unavailable result belongs to the exact current binding.',
    'No empty result, private cause, or mutation authority is inferred.',
  ),
  unauthorized: copy(
    'Access boundary',
    'Access is not available',
    'The public capability boundary refused this view without disclosing bound data.',
    'The capability refusal is certified and access-safe.',
    'No subject identity, private reason, or authority is disclosed.',
  ),
  offline: copy(
    'Connection state',
    'OpenPlanr is offline',
    'Only a validated same-binding projection may remain visible while disconnected.',
    'Any displayed retained data belongs to the exact current binding.',
    'Freshness, server continuity, and mutation safety are not proven.',
  ),
  incompatible: copy(
    'Installation boundary',
    'Dashboard installation is incompatible',
    'The UI, server, or packaged assets do not satisfy one compatible build contract.',
    'The compatibility refusal is certified without presenting project data.',
    'This is not an empty project, offline state, or partial projection.',
  ),
  corrupt: copy(
    'Integrity boundary',
    'Projection cannot be trusted',
    'Contradictory or invalid public state was rejected before presentation.',
    'The integrity refusal is certified and contains no partial project truth.',
    'No retained data, lifecycle result, or mutation authority is trusted.',
  ),
  conflict: copy(
    'Current-state conflict',
    'Current state changed',
    'The prior instruction no longer matches the current durable state.',
    'A certified conflict was returned for this exact binding.',
    'No prior confirmation, result, or successor is assumed to remain current.',
  ),
  partial: copy(
    'Partial projection',
    'Only part of the state is proven',
    'The displayed portion is validated, but completeness is not established.',
    'The access-safe displayed portion belongs to the exact current binding.',
    'Completion, outcome, and mutation safety are not proven.',
  ),
  uncertain: copy(
    'Effect custody',
    'Effect state is uncertain',
    'OpenPlanr cannot prove whether the external effect occurred.',
    'The uncertainty is certified for the exact current binding.',
    'No effect outcome or repeated instruction is proven.',
  ),
  recovering: copy(
    'Recovery progress',
    'Recovery is in progress',
    'OpenPlanr is reconciling durable state through its canonical recovery path.',
    'The recovery projection belongs to the exact current binding.',
    'No terminal recovery result or new mutation authority is proven yet.',
  ),
});

function copy(
  eyebrow: string,
  title: string,
  description: string,
  proven: string,
  notProven: string,
): StateCopy {
  return Object.freeze({ eyebrow, title, description, proven, notProven });
}

function panelState(kind: DashboardProductStateKind): StatePanelState {
  if (kind === 'booting' || kind === 'loading' || kind === 'refreshing') return 'booting';
  if (kind === 'first-use' || kind === 'empty') return 'first-use';
  if (kind === 'ready') return 'ready-to-resume';
  if (kind === 'offline') return 'offline';
  if (
    kind === 'incompatible' ||
    kind === 'corrupt' ||
    kind === 'conflict' ||
    kind === 'uncertain'
  ) {
    return 'incompatible';
  }
  return 'unavailable';
}

function closeUnsafeControls(root: HTMLElement): void {
  const boundary = root.closest<HTMLElement>('[data-live-state-boundary]') ?? root;
  boundary.dispatchEvent(new CustomEvent('openplanr-live-state-close', { bubbles: false }));
  for (const control of boundary.querySelectorAll<HTMLElement>('[data-live-unsafe-control]')) {
    if (control instanceof HTMLDetailsElement) control.open = false;
    if (
      typeof HTMLDialogElement !== 'undefined' &&
      control instanceof HTMLDialogElement &&
      control.open
    ) {
      control.close();
    }
  }
}

function focusTarget(
  root: HTMLElement,
  focus: 'route-heading' | 'state-heading' | 'recovery-heading',
): HTMLElement | null {
  if (focus === 'recovery-heading') {
    return root.querySelector<HTMLElement>('[data-product-state-recovery-heading]');
  }
  if (focus === 'state-heading') {
    return root.querySelector<HTMLElement>('.op-state-panel h2');
  }
  return root.closest('main')?.querySelector<HTMLElement>('h1') ?? root.closest('main');
}

function exactCurrentBinding(
  stateBinding: DashboardQueryIdentity | null,
  currentBinding: DashboardQueryIdentity | null,
): boolean {
  if (stateBinding === null) return true;
  if (currentBinding === null) return false;
  try {
    return isCurrentDashboardQuery(stateBinding, createDashboardQueryIdentity(currentBinding));
  } catch {
    return false;
  }
}

function matchesDurableCycleContext(state: DashboardProductState<unknown>): boolean {
  if (state.kind === 'first-use') return state.binding?.cycleId === null;
  if (
    state.kind === 'empty' &&
    state.binding?.route === '#/operate/today' &&
    state.binding.cycleId !== null
  ) {
    return false;
  }
  return true;
}

export type ProductStateViewProps<T> = Readonly<{
  state: DashboardProductState<T>;
  currentBinding: DashboardQueryIdentity | null;
  children?: (
    data: T,
    presentation: DashboardProductStateKind,
    mutationAllowed: boolean,
  ) => ReactNode;
}>;

/** Renders one already-parsed product state without deriving lifecycle truth or authority. */
export function ProductStateView<T>({ state, currentBinding, children }: ProductStateViewProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const generatedHeadingId = useId();
  const stateHeadingId = `dashboard-product-state-${generatedHeadingId}`;
  const recoveryHeadingId = `dashboard-product-recovery-${generatedHeadingId}`;
  const stateHasValidationBrand = isValidatedDashboardProductState<T>(state);
  const durableCycleIsConsistent = stateHasValidationBrand && matchesDurableCycleContext(state);
  const stateIsValidated = stateHasValidationBrand && durableCycleIsConsistent;
  const bindingIsCurrent = stateIsValidated && exactCurrentBinding(state.binding, currentBinding);
  const mutationAllowed =
    stateIsValidated && bindingIsCurrent && productStateAllowsMutation(state, currentBinding);
  const previousFocusKey = useRef<string | null>(null);
  const previousMutationAllowed = useRef<boolean | null>(null);
  const effectiveFocus =
    stateIsValidated && bindingIsCurrent ? state.policy.focus : 'state-heading';
  const focusKey = `${stateIsValidated && bindingIsCurrent ? state.kind : 'state-rejected'}:${effectiveFocus}:${mutationAllowed ? 'mutable' : 'safe'}`;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!mutationAllowed && previousMutationAllowed.current !== false) closeUnsafeControls(root);
    previousMutationAllowed.current = mutationAllowed;
    if (previousFocusKey.current === focusKey) return;
    const target = focusTarget(root, effectiveFocus);
    if (target) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
    previousFocusKey.current = focusKey;
  }, [effectiveFocus, focusKey, mutationAllowed]);

  if (!stateIsValidated || !bindingIsCurrent) {
    return (
      <div ref={rootRef} data-product-state="incompatible" data-product-state-custody="rejected">
        <StatePanel
          state="incompatible"
          eyebrow="Validation boundary"
          title={
            stateHasValidationBrand && !durableCycleIsConsistent
              ? 'Product state contradicts durable context'
              : stateIsValidated
                ? 'Projection does not match the current context'
                : 'Product state could not be validated'
          }
          description="OpenPlanr rejected untrusted or foreign data before it reached this route."
          detail="No foreign actor, project, scope, domain, Cycle, subject, head, view, or generation is displayed."
          headingId={stateHeadingId}
        />
      </div>
    );
  }

  if (state.kind === 'ready') {
    return (
      <div
        ref={rootRef}
        data-product-state="ready"
        data-product-state-mutation={mutationAllowed ? 'allowed' : 'disabled'}
      >
        {state.data !== null && children ? children(state.data, state.kind, mutationAllowed) : null}
        <p className="op-authority-note" data-product-state-authority>
          {mutationAllowed
            ? 'Mutation remains limited to exact runtime-issued allowed actions for this binding.'
            : 'Mutation controls remain disabled in this presentation state.'}
        </p>
      </div>
    );
  }

  const stateCopy = COPY[state.kind];
  return (
    <div
      ref={rootRef}
      data-product-state={state.kind}
      data-product-state-mutation={mutationAllowed ? 'allowed' : 'disabled'}
    >
      <StatePanel
        state={panelState(state.kind)}
        eyebrow={stateCopy.eyebrow}
        title={stateCopy.title}
        description={stateCopy.description}
        detail={state.reasonCodes.length > 0 ? state.reasonCodes.join(' · ') : undefined}
        headingId={stateHeadingId}
      />
      {state.data !== null && children ? children(state.data, state.kind, mutationAllowed) : null}

      <RecoveryGuidance
        state={state}
        proven={stateCopy.proven}
        notProven={stateCopy.notProven}
        headingId={recoveryHeadingId}
      />

      <p className="op-authority-note" data-product-state-authority>
        {mutationAllowed
          ? 'Mutation remains limited to exact runtime-issued allowed actions for this binding.'
          : 'Mutation controls remain disabled in this presentation state.'}
      </p>
    </div>
  );
}
