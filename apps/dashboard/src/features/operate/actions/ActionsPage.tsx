import {
  GovernedActionCard,
  MetricStat,
  SectionHeader,
  StatePanel,
} from '../../../design-system/components/index.js';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  type OperateActionsListModel,
  resolveOperateActionsListModel,
} from './actions-list-model.js';
import '../operate.css';

export type ActionsPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

type ActionRow = OperateActionsListModel['actions'][number] & Readonly<{ id: string }>;

const ATTENTION_STATES = new Set(['blocked', 'failed', 'rejected']);

function humanLabel(value: string): string {
  const words = value.replaceAll('-', ' ').replaceAll('_', ' ').trim();
  return words === '' ? value : `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

export function ActionsPage({ currentBinding, current }: ActionsPageProps) {
  const model = resolveOperateActionsListModel(current, currentBinding);
  if (!model) {
    return (
      <div className="op-workspace op-action-list pc-operate" data-route-kind="operate.actions">
        <StatePanel
          state="incompatible"
          eyebrow="Action projection"
          title="Actions cannot be trusted"
          description="The owner-issued experience surface did not pass exact binding and integrity verification."
        />
      </div>
    );
  }

  const { presentation } = model;
  const rows: readonly ActionRow[] = model.actions.map((action, index) => ({
    ...action,
    id: `${action.actionId}:${index}`,
  }));
  const stateOrder: string[] = [];
  const tally = new Map<string, number>();
  for (const action of model.actions) {
    if (!tally.has(action.state)) stateOrder.push(action.state);
    tally.set(action.state, (tally.get(action.state) ?? 0) + 1);
  }

  return (
    <div
      className="op-workspace op-action-list pc-operate"
      data-route-kind="operate.actions"
      data-action-presentation={presentation}
    >
      {presentation !== 'ready' ? (
        <p className="pc-operate__notice" role="status">
          This is a {presentation} projection. Durable Action identity remains visible; no command
          is inferred.
        </p>
      ) : null}
      {stateOrder.length > 0 ? (
        <ul className="pc-metrics" aria-label="Action states">
          {stateOrder.map((state) => (
            <MetricStat
              key={state}
              label={humanLabel(state)}
              value={tally.get(state) ?? 0}
              tone={ATTENTION_STATES.has(state) ? 'attention' : 'default'}
            />
          ))}
        </ul>
      ) : null}
      <SectionHeader
        headingLevel={1}
        eyebrow="planr-operate · actions"
        title="Actions"
        count={`${model.actions.length} ${model.actions.length === 1 ? 'action' : 'actions'}`}
        description="Review approved work, its outcome, and the next safe step."
      />
      {model.actions.length === 0 ? (
        <StatePanel
          state="unavailable"
          eyebrow="Actions"
          title="No actions yet"
          description="There are no saved actions in this workspace."
        />
      ) : (
        <div className="pc-action-queue">
          {rows.map((row) => {
            const latest = row.executions.at(-1);
            return (
              <GovernedActionCard
                key={row.id}
                actionId={row.actionId}
                state={row.state}
                title={row.title}
                headingLevel={2}
                revision={row.revision}
                route={row.deliveryRoute?.route}
                execution={latest?.status}
                deepLink={row.deepLink}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
