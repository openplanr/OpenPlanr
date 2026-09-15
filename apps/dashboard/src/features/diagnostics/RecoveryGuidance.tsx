import { useId } from 'react';
import type {
  DashboardProductRecovery,
  DashboardProductState,
} from '../../lib/api/product-state.js';
import {
  DASHBOARD_SAFE_CONTEXT_FIELDS,
  dashboardErrorRecoveryPolicy,
} from '../../lib/api/safe-errors.js';

type RecoveryStep = Readonly<{
  instruction: string;
  href?: '#/diagnostics' | '#/operate/history' | '#/operate/recovery';
  linkLabel?: string;
}>;

const RECOVERY_STEPS: Readonly<Record<DashboardProductRecovery, RecoveryStep>> = Object.freeze({
  wait: Object.freeze({
    instruction: 'Wait for OpenPlanr to publish another validated state. No action is inferred.',
  }),
  none: Object.freeze({
    instruction: 'Continue only with exact allowed actions returned for the current binding.',
  }),
  'server-action-only': Object.freeze({
    instruction: 'Use only an exact action returned by OpenPlanr for this state.',
  }),
  inspect: Object.freeze({
    instruction: 'Inspect access-safe history. Inspection does not change durable state.',
    href: '#/operate/history',
    linkLabel: 'Inspect History',
  }),
  reconcile: Object.freeze({
    instruction: 'Reconcile against the current projection before considering another action.',
    href: '#/operate/recovery',
    linkLabel: 'Open Recovery',
  }),
  'request-access': Object.freeze({
    instruction: 'Request access through the project owner. This dashboard cannot grant authority.',
  }),
  'restore-connection': Object.freeze({
    instruction: 'Restore the loopback connection, then wait for exact current reconciliation.',
  }),
  reinstall: Object.freeze({
    instruction: 'Install matching OpenPlanr dashboard assets, then verify compatibility again.',
    href: '#/diagnostics',
    linkLabel: 'Open diagnostics',
  }),
  'canonical-recovery-only': Object.freeze({
    instruction: 'Use only the canonical reconciliation or recovery path returned by OpenPlanr.',
    href: '#/operate/recovery',
    linkLabel: 'Open Recovery',
  }),
});

function certifiedContextLabel(field: (typeof DASHBOARD_SAFE_CONTEXT_FIELDS)[number]): string {
  return {
    operation: 'Operation',
    cycleId: 'Cycle',
    assignmentId: 'Assignment',
    submissionId: 'Submission',
    submissionState: 'Submission state',
    reviewId: 'Review',
    state: 'State',
    maxBytes: 'Maximum bytes',
  }[field];
}

export type RecoveryGuidanceProps<T> = Readonly<{
  state: DashboardProductState<T>;
  proven: string;
  notProven: string;
  headingId?: string;
}>;

/** Presents only the recovery posture certified by the parsed product-state contract. */
export function RecoveryGuidance<T>({
  state,
  proven,
  notProven,
  headingId,
}: RecoveryGuidanceProps<T>) {
  const generatedId = useId();
  const resolvedHeadingId = headingId ?? `dashboard-recovery-${generatedId}`;
  const step = RECOVERY_STEPS[state.policy.recovery];
  const ownedHref =
    step.href === '#/diagnostics' || state.binding?.productArea === 'operate'
      ? step.href
      : undefined;
  const errorPolicy = state.error ? dashboardErrorRecoveryPolicy(state.error) : null;
  const contextRows = state.error
    ? DASHBOARD_SAFE_CONTEXT_FIELDS.flatMap((field) => {
        const value = state.error?.context[field];
        return value === undefined ? [] : [[field, value] as const];
      })
    : [];

  return (
    <section
      className="op-ready-truth"
      data-recovery-guidance={state.policy.recovery}
      aria-labelledby={resolvedHeadingId}
    >
      <div className="op-section-heading">
        <div>
          <p className="op-eyebrow">Recovery posture</p>
          <h2 id={resolvedHeadingId} tabIndex={-1} data-product-state-recovery-heading>
            Known, unknown, and next safe step
          </h2>
        </div>
        <p>{step.instruction}</p>
      </div>

      <dl aria-label="Recovery truth">
        <div>
          <dt>Proven</dt>
          <dd>{proven}</dd>
        </div>
        <div>
          <dt>Not proven</dt>
          <dd>{notProven}</dd>
        </div>
        <div>
          <dt>Next safe step</dt>
          <dd>{step.instruction}</dd>
        </div>
      </dl>

      {state.error ? (
        <section data-safe-error aria-labelledby={`${resolvedHeadingId}-diagnostic`}>
          <h3 id={`${resolvedHeadingId}-diagnostic`}>Certified diagnostic</h3>
          <dl aria-label="Certified diagnostic fields">
            <div>
              <dt>Code</dt>
              <dd>
                <code>{state.error.code}</code>
              </dd>
            </div>
            <div>
              <dt>Recovery classification</dt>
              <dd>
                {state.kind === 'uncertain'
                  ? 'Reconciliation is required before any further instruction.'
                  : errorPolicy?.retryableAfterReconciliation
                    ? 'Eligible for a new instruction only after current reconciliation.'
                    : 'No repeated instruction is certified by this diagnostic.'}
              </dd>
            </div>
            {contextRows.map(([field, value]) => (
              <div key={field}>
                <dt>{certifiedContextLabel(field)}</dt>
                <dd>
                  <code>{String(value)}</code>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {ownedHref && step.linkLabel ? (
        <a className="op-inline-action" href={ownedHref}>
          {step.linkLabel}
        </a>
      ) : null}

      <p className="op-authority-note">
        This view does not create arguments, authority, effects, repeated instructions, PLAN runs,
        or SHIP runs.
      </p>
    </section>
  );
}
