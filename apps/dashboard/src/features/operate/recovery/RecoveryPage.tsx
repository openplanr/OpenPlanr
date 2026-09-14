import {
  ActionStateBadge,
  DataTable,
  type DataTableColumn,
  DefinitionGrid,
  GovernedButton,
  SectionHeader,
  StatePanel,
  type StatePanelState,
} from '../../../design-system/components/index.js';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import { type OperateRecoveryModel, resolveOperateRecoveryModel } from './recovery-model.js';
import '../operate.css';

export type RecoveryPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

const RECOVERY_COPY = Object.freeze({
  blocked: Object.freeze({
    title: 'Recovery is blocked',
    summary: 'A prerequisite needs attention before work can continue.',
    known: 'The blocking state and its history are still available.',
    unknown: 'The current view cannot safely say more about the target or effect.',
    forbidden: 'Do not bypass this block or try to recreate the missing approval.',
  }),
  uncertain: Object.freeze({
    title: 'Reconciliation is required',
    summary: 'An action may have happened. OpenPlanr will not run it again until it is reconciled.',
    known: 'The original intent and a single attempted dispatch are recorded.',
    unknown: 'There is not enough proof yet to say what happened.',
    forbidden: 'Do not retry or run a different version of the action.',
  }),
  custody: Object.freeze({
    title: 'Result custody needs restoration',
    summary: 'The result is recorded, but it cannot be read safely right now.',
    known: 'The original intent and history remain available.',
    unknown: 'The result details cannot be shown until access is restored.',
    forbidden: 'Do not copy private receipts or create a replacement result.',
  }),
  divergent: Object.freeze({
    title: 'Target state diverged',
    summary: 'The target changed after this work was reviewed.',
    known: 'OpenPlanr can see that the reviewed target and current target no longer match.',
    unknown: 'It cannot safely choose a replacement change.',
    forbidden: 'Do not confirm an expired review or silently update the target.',
  }),
  corrupt: Object.freeze({
    title: 'State integrity could not be established',
    summary: 'Keep the project isolated and inspect the Event tail or a known-good backup.',
    known: 'Integrity validation refused the current state before mutation.',
    unknown: 'No unvalidated record is presented as current truth.',
    forbidden: 'Do not edit checkpoints, Event history, or durable state by hand.',
  }),
  incompatible: Object.freeze({
    title: 'State version is incompatible',
    summary: 'Use a supported backup, upgrade, or refusal path without mutation.',
    known: 'The installed runtime refused an unsupported contract version.',
    unknown: 'No compatibility translation or mutation is attempted.',
    forbidden: 'Do not downgrade, rewrite, or guess a compatible contract.',
  }),
  restored: Object.freeze({
    title: 'Recovery is restored',
    summary: 'The recovered work is readable again. Review it before taking a new step.',
    known: 'Recovery history and the restored state remain visible.',
    unknown: 'Recovery alone does not prove the outcome or authorize another action.',
    forbidden: 'Do not reuse an old approval or review.',
  }),
} as const);

type RecoveryAllowedAction = OperateRecoveryModel['allowedActions'][number];

function safeRecoveryActions(
  actions: OperateRecoveryModel['allowedActions'],
): readonly RecoveryAllowedAction[] {
  return actions.filter((entry) => {
    const tool = entry.tool ?? '';
    const effect = entry.effect;
    return (
      effect === 'read-only' ||
      tool.includes('recovery') ||
      tool.includes('reconcile') ||
      tool.endsWith('.rollback')
    );
  });
}

function panelState(state: keyof typeof RECOVERY_COPY): StatePanelState {
  if (state === 'restored') return 'ready-to-resume';
  if (state === 'corrupt' || state === 'incompatible') return 'incompatible';
  return 'unavailable';
}

type RecoveryHistoryRow = OperateRecoveryModel['history'][number] & Readonly<{ id: string }>;

const HISTORY_COLUMNS: readonly DataTableColumn<RecoveryHistoryRow>[] = [
  { key: 'sequence', label: 'Seq', mono: true, render: (row) => row.sequence },
  { key: 'change', label: 'Change', render: (row) => row.change?.summary ?? row.type },
  {
    key: 'timestamp',
    label: 'When',
    mono: true,
    render: (row) => <time dateTime={row.timestamp}>{row.timestamp}</time>,
  },
  {
    key: 'result',
    label: 'Result',
    align: 'right',
    render: (row) => (row.result?.status ? <ActionStateBadge state={row.result.status} /> : '—'),
  },
];

export function RecoveryPage({ currentBinding, current }: RecoveryPageProps) {
  const model = resolveOperateRecoveryModel(current, currentBinding);
  if (!model) {
    return (
      <div className="op-workspace op-recovery pc-operate" data-route-kind="operate.recovery">
        <StatePanel
          state="incompatible"
          eyebrow="Recovery projection"
          title="Recovery cannot be trusted"
          description="The owner-issued recovery display did not pass exact binding and integrity verification."
        />
      </div>
    );
  }

  const copy = RECOVERY_COPY[model.recoveryState];
  const actions = safeRecoveryActions(model.allowedActions);
  const state = panelState(model.recoveryState);
  const head = `${model.payload.eventHead.sequence} · ${model.payload.eventHead.hash ?? 'genesis'}`;
  const historyRows: readonly RecoveryHistoryRow[] = model.history
    .slice(-6)
    .map((entry, index) => ({ ...entry, id: `${entry.eventId}:${index}` }));

  return (
    <section
      className="op-workspace op-recovery pc-operate"
      data-route-kind="operate.recovery"
      data-recovery-state={model.recoveryState}
      data-recovery-presentation={model.presentation}
      aria-label="Operate recovery"
    >
      <SectionHeader
        headingLevel={1}
        eyebrow="planr-operate · recovery"
        title="Recovery"
        description="Understand what is known, what is not, and the safe next step."
        actions={<ActionStateBadge state={model.recoveryState} />}
      />
      <DefinitionGrid
        items={[
          { term: 'Recovery state', description: model.recoveryState, mono: true },
          { term: 'Event record', description: head, mono: true },
          { term: 'View key', description: model.payload.viewHash, mono: true },
        ]}
      />

      <StatePanel state={state} eyebrow="Recovery" title={copy.title} description={copy.summary} />

      <div className="pc-operate__split">
        <section className="pc-operate__panel" aria-labelledby="op-recovery-proven-title">
          <h2 id="op-recovery-proven-title">What is proven</h2>
          <p>{copy.known}</p>
        </section>
        <section className="pc-operate__panel" aria-labelledby="op-recovery-unknown-title">
          <h2 id="op-recovery-unknown-title">What remains unknown</h2>
          <p>{copy.unknown}</p>
        </section>
      </div>

      <section className="pc-operate__section" aria-label="Available recovery steps">
        <SectionHeader
          headingLevel={2}
          title="Available recovery steps"
          description="OpenPlanr shows only steps that are safe for the current state."
        />
        <div className="pc-operate__controls">
          {actions.length > 0 ? (
            actions.map((entry) => (
              <GovernedButton
                key={entry.tool}
                variant={entry.tool.endsWith('.rollback') ? 'danger' : 'secondary'}
                disabled
                disabledReason="The dashboard has not bound a live recovery command gateway for this actor."
              >
                {entry.label}
              </GovernedButton>
            ))
          ) : (
            <GovernedButton
              disabled
              disabledReason="OpenPlanr returned no legal recovery action for this actor and current state."
            >
              No legal recovery action
            </GovernedButton>
          )}
        </div>
      </section>

      <StatePanel
        state="incompatible"
        eyebrow="Prohibited action"
        title="Prohibited action"
        description={copy.forbidden}
      />

      <section className="pc-operate__section" aria-label="Recovery history">
        <SectionHeader
          headingLevel={2}
          title="Recovery history"
          count={model.history.length}
          description="Original intent and every recovery result remain immutable."
        />
        {historyRows.length === 0 ? (
          <p className="pc-operate__notice">No access-safe recovery history is projected.</p>
        ) : (
          <DataTable
            columns={HISTORY_COLUMNS}
            rows={historyRows}
            caption="Immutable recovery history"
          />
        )}
      </section>

      <section className="pc-operate__section" aria-label="What support can collect">
        <SectionHeader
          headingLevel={2}
          title="What support can collect"
          description="Support information is prepared safely and never uploaded automatically."
        />
        <DefinitionGrid
          items={[
            {
              term: 'May include',
              description: 'Versions, safe reason codes, hashes, Event range, and recovery steps',
            },
            {
              term: 'Always redacted',
              description:
                'Evidence bodies, private identities, credentials, receipts, and machine paths',
            },
            {
              term: 'Upload behavior',
              description: 'Project state is never uploaded automatically',
            },
          ]}
        />
      </section>
    </section>
  );
}
