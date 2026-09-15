/* biome-ignore-all lint/suspicious/noArrayIndexKey: canonical arrays retain owner order and duplicate identities by contract. */
import { sha256Jcs } from '@openplanr/protocol/canonical-json';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActionStateBadge,
  AlertDialog,
  GovernedButton,
  StatePanel,
} from '../../../design-system/components/index.js';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import {
  type DashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../../lib/binding/query-identity.js';
import {
  type ActionActionLocator,
  type ActionActionPreview,
  type ActionActions,
  createActionActions,
} from './action-actions.js';
import { type OperateActionModel, resolveOperateActionModel } from './action-model.js';
import '../operate.css';

export type ActionDetailPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
  actions?: ActionActions;
  onRefetch?: () => Promise<DashboardProductState<unknown>>;
}>;

type AllowedEntry = OperateActionModel['allowedActions'][number];

type ActionNotice = Readonly<{
  contextKey: string;
  tone: 'verified' | 'attention' | 'refusal';
  text: string;
}>;

type ActivePreview = Readonly<{
  locator: ActionActionLocator;
  binding: DashboardQueryIdentity;
  contextKey: string;
  custody: ActionActionPreview;
}>;

const MAX_TIMER_DELAY_MS = 2_147_000_000;

function actionKind(entry: AllowedEntry | undefined): string {
  const tool = entry?.action?.tool ?? '';
  if (tool.endsWith('.approve')) return 'approval';
  if (tool.endsWith('.execute')) return 'execute';
  if (tool.endsWith('.rollback')) return 'rollback';
  if (tool.includes('recovery') || tool.includes('reconcile')) return 'reconcile';
  return entry?.action?.effect === 'read-only' ? 'inspect' : 'governed';
}

function actionContextKey(binding: DashboardQueryIdentity): string {
  return JSON.stringify([
    binding.route,
    binding.actorId,
    binding.projectId,
    binding.scopeId,
    binding.domainId,
    binding.domainVersion,
    binding.cycleId,
    binding.generation,
    binding.eventHead?.sequence ?? null,
    binding.eventHead?.hash ?? null,
    binding.viewHash,
    binding.subjectId,
  ]);
}

function globalReason(model: OperateActionModel): string | null {
  if (model.presentation === 'offline') {
    return 'Changes are unavailable offline. Reconnect and refresh before continuing.';
  }
  if (model.presentation === 'stale') {
    return 'This workspace is out of date. Refresh before reviewing a new action.';
  }
  if (model.workspace.reasonCodes.includes('OPERATE_EVENT_GAP')) {
    return 'This workspace is missing an update. Refresh before continuing.';
  }
  if (model.presentation === 'read-only' || !model.mutationEnabled) {
    return 'You do not currently have permission to make changes here.';
  }
  return null;
}

function isAbort(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError';
}

function isUncertain(value: unknown): boolean {
  return value instanceof Error && value.name === 'OPERATION_UNCERTAIN';
}

function browserRefetch(): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => window.location.reload(), 0);
}

function previewExpiryTime(active: ActivePreview): number {
  return Date.parse(active.custody.preview.expiresAt);
}

function previewHasExpired(active: ActivePreview, now = Date.now()): boolean {
  const expiresAt = previewExpiryTime(active);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

function activePreviewMatchesModel(
  active: ActivePreview,
  model: OperateActionModel | null,
): boolean {
  return (
    model !== null &&
    active.contextKey === actionContextKey(model.binding) &&
    isCurrentDashboardQuery(active.binding, model.binding) &&
    active.locator.subjectId === model.action.actionId
  );
}

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value === null || value === undefined || value === '' ? 'Not available' : value}</dd>
    </div>
  );
}

function TechnicalFact({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  const display = value === null || value === undefined || value === '' ? 'Not available' : value;
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <code>{display}</code>
      </dd>
    </div>
  );
}

function readableLabel(value: string): string {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function readableTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return value;
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZone: 'UTC',
    timeZoneName: 'short',
    year: 'numeric',
  }).format(date);
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function outcomeTitle(status: string): string {
  if (status === 'insufficient-evidence') return 'More evidence is needed';
  if (status === 'verified') return 'Outcome confirmed';
  if (status === 'not-required') return 'No further verification is needed';
  return readableLabel(status);
}

function ResultCard({
  kind,
  result,
}: {
  kind: 'Execution' | 'Rollback';
  result: NonNullable<OperateActionModel['action']['executions'][number]>;
}) {
  const unchanged = result.targetBeforeHash === result.targetAfterHash;
  return (
    <section
      className="op-action-result"
      aria-labelledby={`op-action-${kind.toLowerCase()}-title`}
      data-result-kind={kind.toLowerCase()}
    >
      <div className="op-cycle-section-heading">
        <div>
          <p className="op-eyebrow">{kind} result</p>
          <h2 id={`op-action-${kind.toLowerCase()}-title`}>
            {result.effectSummary?.summary ?? `${kind} result is access-restricted`}
          </h2>
        </div>
        <p>A recorded change still needs evidence before its result can be confirmed.</p>
      </div>
      <dl className="op-cycle-custody">
        <Fact label="Status" value={readableLabel(result.status)} />
        <Fact label="Completed" value={readableTimestamp(result.completedAt)} />
        <Fact label="Change" value={unchanged ? 'No change recorded' : 'Change recorded'} />
        <Fact
          label="Access"
          value={result.accessReason ?? 'Current actor may inspect the projected summary'}
        />
      </dl>
      <details className="op-action-detail__technical-details">
        <summary>Technical details</summary>
        <dl className="op-cycle-custody">
          <TechnicalFact label="Target before digest" value={result.targetBeforeHash} />
          <TechnicalFact label="Target after digest" value={result.targetAfterHash} />
        </dl>
      </details>
    </section>
  );
}

function OutcomeCard({ outcome }: { outcome: NonNullable<OperateActionModel['outcome']> }) {
  return (
    <section
      className="op-action-outcome"
      aria-labelledby="op-action-outcome-title"
      data-result-kind="outcome"
    >
      <div className="op-cycle-section-heading">
        <div>
          <p className="op-eyebrow">Outcome</p>
          <h2 id="op-action-outcome-title">{outcomeTitle(outcome.status)}</h2>
        </div>
        <p>This is where the expected result is checked against real evidence.</p>
      </div>
      <dl className="op-cycle-custody">
        <Fact label="Status" value={outcomeTitle(outcome.status)} />
        <Fact label="Last checked" value={readableTimestamp(outcome.observedAt)} />
        <Fact
          label="Observations"
          value={countLabel(outcome.observationIds.length, 'observation')}
        />
        <Fact label="Evidence" value={countLabel(outcome.evidenceRefIds.length, 'reference')} />
      </dl>
      <details className="op-action-detail__technical-details">
        <summary>Technical details</summary>
        <dl className="op-cycle-custody">
          <TechnicalFact label="Outcome ID" value={outcome.outcomeId} />
          <TechnicalFact label="Verification plan" value={outcome.verificationPlanId} />
        </dl>
      </details>
    </section>
  );
}

function LearningCard({ learning }: { learning: OperateActionModel['learnings'][number] }) {
  return (
    <section
      className="op-action-learning"
      aria-labelledby={`op-learning-${learning.learningId}`}
      data-result-kind="learning"
    >
      <div className="op-cycle-section-heading">
        <div>
          <p className="op-eyebrow">What we learned</p>
          <h2 id={`op-learning-${learning.learningId}`}>{learning.statement}</h2>
        </div>
        <p>This insight is based on the work and its evidence.</p>
      </div>
      <dl className="op-cycle-custody">
        <Fact label="Recorded" value={readableTimestamp(learning.createdAt)} />
        <Fact
          label="Related decisions"
          value={countLabel(learning.decisionIds.length, 'decision')}
        />
        <Fact label="Evidence" value={countLabel(learning.evidenceRefIds.length, 'reference')} />
      </dl>
      <details className="op-action-detail__technical-details">
        <summary>Technical details</summary>
        <dl className="op-cycle-custody">
          <TechnicalFact label="Learning ID" value={learning.learningId} />
          <TechnicalFact label="Outcome ID" value={learning.outcomeId} />
        </dl>
      </details>
    </section>
  );
}

function AllowedControl({
  entry,
  model,
  variant,
  fallbackLabel,
  fallbackReason,
  pending,
  onInvoke,
}: {
  entry: AllowedEntry | undefined;
  model: OperateActionModel;
  variant?: 'primary' | 'secondary' | 'danger';
  fallbackLabel: string;
  fallbackReason: string;
  pending: boolean;
  onInvoke: (entry: AllowedEntry, triggerId: string) => void;
}) {
  const reason = globalReason(model);
  const triggerId = `op-action-control-${actionKind(entry)}`;
  if (entry && !reason && entry.action?.effect !== 'read-only') {
    return (
      <GovernedButton
        id={triggerId}
        variant={variant}
        {...(pending
          ? { disabled: true as const, disabledReason: 'A governed preview is already in flight.' }
          : { onInvoke: () => onInvoke(entry, triggerId) })}
      >
        {entry.action?.label ?? fallbackLabel}
      </GovernedButton>
    );
  }
  return (
    <GovernedButton id={triggerId} disabled disabledReason={reason ?? fallbackReason}>
      {entry?.action?.label ?? fallbackLabel}
    </GovernedButton>
  );
}

function ActionWorkspace({
  model,
  pending,
  onInvoke,
}: {
  model: OperateActionModel;
  pending: boolean;
  onInvoke: (entry: AllowedEntry, triggerId: string) => void;
}) {
  const { action, outcome, learnings, boundaries } = model;
  const entries = model.allowedActions.filter((entry) => entry.subjectId === action.actionId);
  const byKind = new Map(entries.map((entry) => [actionKind(entry), entry]));
  const latestExecution = action.executions.at(-1) ?? null;
  const latestRollback = action.rollbacks.at(-1) ?? null;
  const uncertain =
    latestExecution?.status === 'uncertain' ||
    latestRollback?.status === 'uncertain' ||
    action.state === 'uncertain';
  const terminalSucceeded = latestExecution?.status === 'succeeded';
  const verificationInsufficient = outcome?.status === 'insufficient-evidence';
  const planningHref =
    action.deliveryRoute?.route === 'planning-work'
      ? `#/operate/actions/${encodeURIComponent(action.actionId)}/planning`
      : null;
  const dependencySummary =
    action.dependencyActionIds.length === 0
      ? 'No dependencies'
      : countLabel(action.dependencyActionIds.length, 'dependency', 'dependencies');

  return (
    <article
      className="op-action-detail__workspace"
      data-action-state={action.state}
      aria-labelledby="op-action-title"
    >
      <header className="op-action-detail__header">
        <div>
          <p className="op-eyebrow">planr-operate · action</p>
          <h1 id="op-action-title">{action.title}</h1>
          <p>{action.expectedResult}</p>
          <ActionStateBadge state={action.state} />
        </div>
        <dl className="op-cycle-custody">
          <Fact label="Status" value={readableLabel(action.state)} />
          <Fact label="Related work" value={dependencySummary} />
        </dl>
      </header>

      <details className="op-action-detail__technical-details">
        <summary>Technical details</summary>
        <dl className="op-cycle-custody">
          <TechnicalFact label="Action ID" value={action.actionId} />
          <TechnicalFact label="Revision" value={action.revision} />
          <TechnicalFact label="Action digest" value={action.actionHash} />
          <TechnicalFact label="Verification plan" value={action.verificationPlanId} />
          <TechnicalFact label="Delivery route" value={action.deliveryRoute?.route} />
          <TechnicalFact
            label="Dependencies"
            value={
              action.dependencyActionIds.length > 0
                ? action.dependencyActionIds.join(' · ')
                : 'None'
            }
          />
        </dl>
      </details>

      <section className="op-action-boundaries" aria-labelledby="op-action-boundaries-title">
        <div className="op-cycle-section-heading">
          <div>
            <p className="op-eyebrow">Before you continue</p>
            <h2 id="op-action-boundaries-title">Review each step separately</h2>
          </div>
        </div>
        <StatePanel
          state="unavailable"
          eyebrow="Approval"
          title="Approval does not make a change"
          description={boundaries.approvalExecution}
        />
        {terminalSucceeded ? (
          <StatePanel
            state="incompatible"
            eyebrow="Recorded change"
            title="The change is complete; its result is still being checked"
            description={boundaries.verification}
          />
        ) : null}
        {verificationInsufficient ? (
          <StatePanel
            state="incompatible"
            eyebrow="Evidence"
            title="More evidence is needed"
            description="The change is recorded, but the expected result is not proven yet. Review the next observation or revisit the work."
          />
        ) : null}
        {uncertain ? (
          <StatePanel
            state="offline"
            eyebrow="Uncertainty"
            title="Do not retry this Action"
            description={boundaries.retry}
          />
        ) : null}
      </section>

      <section
        className="op-action-detail__controls"
        aria-label={`Available actions for ${action.title}`}
      >
        {planningHref ? (
          <a className="op-cycle-link" href={planningHref}>
            Review Planning handoff
          </a>
        ) : null}
        {byKind.has('approval') ? (
          <AllowedControl
            entry={byKind.get('approval')}
            model={model}
            pending={pending}
            onInvoke={onInvoke}
            fallbackLabel="Approve"
            fallbackReason="OpenPlanr returned no approval action for the current authority and state."
          />
        ) : null}
        {byKind.has('execute') ? (
          <AllowedControl
            entry={byKind.get('execute')}
            model={model}
            pending={pending}
            onInvoke={onInvoke}
            fallbackLabel="Execute"
            fallbackReason="OpenPlanr returned no execute action for the current authority and state."
          />
        ) : (
          <GovernedButton
            disabled
            disabledReason={
              terminalSucceeded
                ? 'This execution already has a durable terminal result. It cannot be dispatched again.'
                : uncertain
                  ? 'Uncertain effect state prohibits blind retry.'
                  : 'OpenPlanr returned no execute action for the current authority and state.'
            }
          >
            Execute unavailable
          </GovernedButton>
        )}
        {byKind.has('rollback') ? (
          <AllowedControl
            entry={byKind.get('rollback')}
            model={model}
            variant="danger"
            pending={pending}
            onInvoke={onInvoke}
            fallbackLabel="Rollback"
            fallbackReason="Rollback requires its own runtime-issued plan, current policy evaluation, named approval, and exact baseline."
          />
        ) : (
          <GovernedButton
            disabled
            disabledReason="Rollback requires its own runtime-issued plan, current policy evaluation, named approval, and exact baseline."
          >
            Rollback unavailable
          </GovernedButton>
        )}
        {byKind.has('reconcile') ? (
          <AllowedControl
            entry={byKind.get('reconcile')}
            model={model}
            pending={pending}
            onInvoke={onInvoke}
            fallbackLabel="Reconcile"
            fallbackReason="OpenPlanr returned no reconcile action for the current state."
          />
        ) : null}
      </section>

      {latestExecution ? (
        <ResultCard kind="Execution" result={latestExecution} />
      ) : (
        <StatePanel
          state="unavailable"
          eyebrow="Change"
          title="No change has been recorded"
          description="Approval alone does not make a change."
        />
      )}

      {latestRollback ? (
        <ResultCard kind="Rollback" result={latestRollback} />
      ) : (
        <StatePanel
          state="unavailable"
          eyebrow="Rollback"
          title="A rollback is a separate action"
          description="Restoring a prior setting creates a separate record and a new check."
        />
      )}

      {outcome ? (
        <OutcomeCard outcome={outcome} />
      ) : (
        <StatePanel
          state="unavailable"
          eyebrow="Outcome"
          title="No outcome has been confirmed yet"
          description="A recorded change still needs evidence of the expected result."
        />
      )}

      {learnings.length > 0 ? (
        learnings.map((entry) => <LearningCard key={entry.learningId} learning={entry} />)
      ) : (
        <StatePanel
          state="unavailable"
          eyebrow="What we learned"
          title="No shared insight has been recorded yet"
          description="Insights are added after the result has enough supporting evidence."
        />
      )}

      {uncertain ? (
        <StatePanel
          state="offline"
          eyebrow="Recovery"
          title="Reconciliation is required"
          description="Use Recovery inspection or an explicit runtime recovery route. Blind retry is prohibited."
        />
      ) : null}

      <p className="op-action-detail__history-link">
        <a className="op-cycle-link" href="#/operate/history">
          View activity and recovery details
        </a>
      </p>
    </article>
  );
}

export function ActionDetailPage({
  currentBinding,
  current,
  actions,
  onRefetch,
}: ActionDetailPageProps) {
  const model = useMemo(
    () => resolveOperateActionModel(current, currentBinding),
    [current, currentBinding],
  );
  const [pending, setPending] = useState(false);
  const [activePreview, setActivePreview] = useState<ActivePreview | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [uncertainBinding, setUncertainBinding] = useState<DashboardQueryIdentity | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const actionsRef = useRef<ActionActions | null>(actions ?? null);
  const uncertainBindingRef = useRef<DashboardQueryIdentity | null>(null);
  const epochRef = useRef(0);
  const previewFlightRef = useRef(false);
  const confirmFlightRef = useRef(false);
  const activePreviewRef = useRef<ActivePreview | null>(null);
  const dialogCancelRef = useRef<HTMLButtonElement>(null);
  const dialogTriggerRef = useRef<string | null>(null);
  const previewExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedModelRef = useRef<OperateActionModel | null>(null);
  const mountedRef = useRef(true);

  const restoreDialogTrigger = useCallback((triggerId: string | null) => {
    const focusTrigger = (remaining: number) => {
      if (!mountedRef.current || triggerId === null || typeof document === 'undefined') return;
      const trigger = document.getElementById(triggerId);
      if (!(trigger instanceof HTMLButtonElement) || !trigger.isConnected) {
        if (remaining > 0 && typeof window !== 'undefined') {
          window.setTimeout(() => focusTrigger(remaining - 1), 16);
        }
        return;
      }
      if (trigger.disabled) {
        if (remaining > 0 && typeof window !== 'undefined') {
          window.setTimeout(() => focusTrigger(remaining - 1), 16);
        }
        return;
      }
      trigger.focus({ preventScroll: true });
    };
    queueMicrotask(() => {
      if (typeof window === 'undefined') focusTrigger(4);
      else window.setTimeout(() => focusTrigger(4), 0);
    });
  }, []);

  const requestRefetch = useCallback(async (): Promise<DashboardProductState<unknown> | null> => {
    if (onRefetch) {
      const result = await onRefetch();
      return result && typeof result === 'object' ? result : null;
    }
    browserRefetch();
    return null;
  }, [onRefetch]);

  const reconcileUncertain = useCallback(
    async (launch = uncertainBindingRef.current): Promise<void> => {
      if (!launch || reconciling) return;
      setReconciling(true);
      try {
        const verified = await requestRefetch();
        const next = verified?.binding
          ? resolveOperateActionModel(verified, verified.binding)
          : null;
        if (!next || !actionsRef.current) throw new Error('Exact reconciliation failed.');
        actionsRef.current.reconcile(next.binding);
        uncertainBindingRef.current = null;
        setUncertainBinding(null);
        setNotice({
          contextKey: actionContextKey(next.binding),
          tone: 'verified',
          text: 'The current action status is confirmed. Review a new preview to continue.',
        });
      } catch {
        setNotice({
          contextKey: actionContextKey(launch),
          tone: 'attention',
          text: 'We could not confirm the current action status. Do not retry yet.',
        });
      } finally {
        if (mountedRef.current) setReconciling(false);
      }
    },
    [reconciling, requestRefetch],
  );

  const clearPreviewExpiryTimer = useCallback(() => {
    const timer = previewExpiryTimerRef.current;
    if (timer === null) return;
    clearTimeout(timer);
    previewExpiryTimerRef.current = null;
  }, []);

  const clearPreview = useCallback(() => {
    clearPreviewExpiryTimer();
    const trigger = dialogTriggerRef.current;
    dialogTriggerRef.current = null;
    epochRef.current += 1;
    const active = activePreviewRef.current;
    active?.custody.cancel();
    actionsRef.current?.cancel();
    activePreviewRef.current = null;
    previewFlightRef.current = false;
    confirmFlightRef.current = false;
    setPending(false);
    setActivePreview(null);
    setConfirming(false);
    setDialogOpen(false);
    restoreDialogTrigger(trigger);
  }, [clearPreviewExpiryTimer, restoreDialogTrigger]);

  const expireActivePreview = useCallback(
    (active: ActivePreview) => {
      if (!mountedRef.current || !activePreviewMatchesModel(active, committedModelRef.current)) {
        return;
      }
      clearPreview();
      setNotice({
        contextKey: active.contextKey,
        tone: 'attention',
        text: 'This review expired before confirmation. The action is refreshing.',
      });
      void requestRefetch();
    },
    [clearPreview, requestRefetch],
  );

  const schedulePreviewExpiry = useCallback(
    (active: ActivePreview) => {
      clearPreviewExpiryTimer();
      const arm = () => {
        if (!mountedRef.current || activePreviewRef.current !== active) return;
        const remaining = previewExpiryTime(active) - Date.now();
        if (!Number.isFinite(remaining) || remaining <= 0) {
          previewExpiryTimerRef.current = null;
          expireActivePreview(active);
          return;
        }
        previewExpiryTimerRef.current = setTimeout(arm, Math.min(remaining, MAX_TIMER_DELAY_MS));
      };
      arm();
    },
    [clearPreviewExpiryTimer, expireActivePreview],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (actions) actionsRef.current = actions;
    if (!actionsRef.current && typeof window !== 'undefined') {
      actionsRef.current = createActionActions({ origin: window.location.origin });
    }
    return () => {
      mountedRef.current = false;
      epochRef.current += 1;
      clearPreviewExpiryTimer();
      const manager = actionsRef.current;
      activePreviewRef.current?.custody.cancel();
      manager?.cancel();
      activePreviewRef.current = null;
      previewFlightRef.current = false;
      confirmFlightRef.current = false;
      queueMicrotask(() => {
        if (!mountedRef.current && actionsRef.current === manager) {
          manager?.dispose();
          actionsRef.current = null;
        }
      });
    };
  }, [actions, clearPreviewExpiryTimer]);

  useLayoutEffect(() => {
    const previousModel = committedModelRef.current;
    committedModelRef.current = model;
    const currentContext = model ? actionContextKey(model.binding) : null;
    setNotice((currentNotice) =>
      currentNotice !== null && currentNotice.contextKey !== currentContext ? null : currentNotice,
    );
    if (model && actionsRef.current) actionsRef.current.bind(model.binding);
    const active = activePreviewRef.current;
    const contextChanged =
      previousModel && model
        ? actionContextKey(previousModel.binding) !== actionContextKey(model.binding)
        : previousModel !== model;
    if (
      contextChanged ||
      (active !== null && !activePreviewMatchesModel(active, model)) ||
      (contextChanged && (previewFlightRef.current || confirmFlightRef.current))
    ) {
      clearPreview();
    }
  }, [model, clearPreview]);

  const openPreview = useCallback(
    async (entry: AllowedEntry, triggerId: string) => {
      if (!model || previewFlightRef.current || confirmFlightRef.current) return;
      dialogTriggerRef.current = triggerId;
      const manager = actionsRef.current;
      if (!manager) {
        dialogTriggerRef.current = null;
        return;
      }
      const locator = Object.freeze({
        subjectId: entry.subjectId,
        actionDigest: sha256Jcs(entry.action as never),
      });
      const launchBinding = model.binding;
      const launchContext = actionContextKey(launchBinding);
      previewFlightRef.current = true;
      setPending(true);
      const attempt = epochRef.current;
      try {
        manager.bind(launchBinding);
        const custody = await manager.preview(locator);
        const stillCurrent =
          mountedRef.current &&
          attempt === epochRef.current &&
          committedModelRef.current !== null &&
          actionContextKey(committedModelRef.current.binding) === launchContext &&
          isCurrentDashboardQuery(launchBinding, committedModelRef.current.binding);
        if (!stillCurrent) {
          custody.cancel();
          return;
        }
        if (custody.preview.authority !== 'allowed') {
          custody.cancel();
          manager.cancel();
          setNotice({
            contextKey: launchContext,
            tone: 'refusal',
            text:
              custody.preview.reasonCodes.length > 0
                ? custody.preview.reasonCodes.join(' · ')
                : `Preview authority: ${custody.preview.authority}.`,
          });
          await requestRefetch();
          return;
        }
        const active = Object.freeze({
          locator,
          binding: launchBinding,
          contextKey: launchContext,
          custody,
        });
        if (previewHasExpired(active)) {
          custody.cancel();
          clearPreview();
          setNotice({
            contextKey: launchContext,
            tone: 'attention',
            text: 'This review expired before confirmation. The action is refreshing.',
          });
          await requestRefetch();
          return;
        }
        activePreviewRef.current = active;
        setActivePreview(active);
        setDialogOpen(true);
        schedulePreviewExpiry(active);
      } catch (cause) {
        if (
          !isAbort(cause) &&
          mountedRef.current &&
          attempt === epochRef.current &&
          committedModelRef.current &&
          actionContextKey(committedModelRef.current.binding) === launchContext
        ) {
          manager.cancel();
          if (isUncertain(cause)) {
            uncertainBindingRef.current = launchBinding;
            setUncertainBinding(launchBinding);
          }
          setNotice({
            contextKey: launchContext,
            tone: isUncertain(cause) ? 'attention' : 'refusal',
            text: isUncertain(cause)
              ? 'We could not confirm whether this action ran. Check the current status before trying again.'
              : 'This action was not accepted. The workspace is refreshing.',
          });
          if (isUncertain(cause)) await reconcileUncertain(launchBinding);
          else await requestRefetch();
        }
      } finally {
        if (attempt === epochRef.current) {
          previewFlightRef.current = false;
          if (mountedRef.current) setPending(false);
        }
      }
    },
    [model, clearPreview, reconcileUncertain, requestRefetch, schedulePreviewExpiry],
  );

  const confirmPreview = useCallback(async () => {
    const active = activePreviewRef.current;
    if (!active || confirmFlightRef.current) return;
    if (!activePreviewMatchesModel(active, committedModelRef.current)) {
      clearPreview();
      return;
    }
    if (previewHasExpired(active)) {
      expireActivePreview(active);
      return;
    }
    confirmFlightRef.current = true;
    const attempt = epochRef.current;
    setConfirming(true);
    try {
      const result = await active.custody.confirm();
      if (
        !mountedRef.current ||
        attempt !== epochRef.current ||
        !activePreviewMatchesModel(active, committedModelRef.current)
      ) {
        return;
      }
      if (result.ok) {
        setNotice({
          contextKey: active.contextKey,
          tone: 'verified',
          text: 'Your action was accepted. The workspace is refreshing.',
        });
      } else {
        uncertainBindingRef.current = active.binding;
        setUncertainBinding(active.binding);
        setNotice({
          contextKey: active.contextKey,
          tone: 'attention',
          text: 'The command outcome is uncertain. Refresh before retrying.',
        });
      }
      clearPreview();
      if (result.ok) await requestRefetch();
      else await reconcileUncertain(active.binding);
    } catch (cause) {
      if (
        !isAbort(cause) &&
        mountedRef.current &&
        attempt === epochRef.current &&
        activePreviewMatchesModel(active, committedModelRef.current)
      ) {
        setNotice({
          contextKey: active.contextKey,
          tone: 'refusal',
          text: 'This action was not accepted. The workspace is refreshing.',
        });
        clearPreview();
        await requestRefetch();
      }
    } finally {
      if (attempt === epochRef.current) {
        confirmFlightRef.current = false;
        if (mountedRef.current) setConfirming(false);
      }
    }
  }, [clearPreview, expireActivePreview, reconcileUncertain, requestRefetch]);

  if (!model) {
    return (
      <div className="op-workspace op-action-detail pc-operate" data-route-kind="operate.action">
        <StatePanel
          state="incompatible"
          eyebrow="Action projection"
          title="Action cannot be trusted"
          description="The owner-issued display workspace did not pass exact binding and integrity verification."
        />
      </div>
    );
  }

  const reason = globalReason(model);
  const uncertain = uncertainBinding !== null;
  const currentNotice = notice?.contextKey === actionContextKey(model.binding) ? notice : null;
  const preview =
    activePreview !== null && activePreviewMatchesModel(activePreview, model)
      ? activePreview.custody.preview
      : null;

  return (
    <section
      className="op-workspace op-action-detail pc-operate"
      data-route-kind="operate.action"
      data-action-presentation={model.presentation}
      aria-label="Operate Action detail"
    >
      {reason ? (
        <StatePanel
          state={model.presentation === 'offline' ? 'offline' : 'unavailable'}
          eyebrow="Actions"
          title="Actions are unavailable"
          description={reason}
        />
      ) : null}
      {currentNotice ? (
        <p className="pc-operate__notice" data-tone={currentNotice.tone} role="status">
          {currentNotice.text}
        </p>
      ) : null}
      {uncertain ? (
        <StatePanel
          state="incompatible"
          eyebrow="Action status"
          title="This action is locked until its current status is confirmed"
          description="A request may have taken effect. You cannot retry until the current status is confirmed."
          actions={
            <GovernedButton
              disabled={!onRefetch || reconciling}
              disabledReason="A parser-verified current Action projection is required."
              onInvoke={() => void reconcileUncertain()}
            >
              {reconciling ? 'Reconciling current Action…' : 'Reconcile current Action'}
            </GovernedButton>
          }
        />
      ) : null}
      <ActionWorkspace
        model={model}
        pending={pending || uncertain || reconciling}
        onInvoke={openPreview}
      />

      {preview ? (
        <AlertDialog.Root
          open={dialogOpen}
          onOpenChange={(open) => {
            if (!open && !confirmFlightRef.current) clearPreview();
          }}
        >
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="op-inbox-dialog__overlay" />
            <AlertDialog.Content
              className="op-inbox-dialog__content"
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                dialogCancelRef.current?.focus({ preventScroll: true });
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
              }}
            >
              <AlertDialog.Title>Confirm {preview.allowedAction.label}</AlertDialog.Title>
              <AlertDialog.Description>
                {`You are about to ${preview.allowedAction.label}. ${
                  preview.consequence ?? 'Review the prepared change before confirming.'
                }`}
              </AlertDialog.Description>
              <details className="op-action-detail__technical-details op-action-detail__dialog-details">
                <summary>Technical details</summary>
                <dl className="op-cycle-custody">
                  <TechnicalFact label="Tool" value={preview.allowedAction.tool} />
                  <TechnicalFact label="Digest" value={preview.actionDigest} />
                </dl>
              </details>
              <div className="op-inbox-dialog__actions">
                <AlertDialog.Cancel asChild>
                  <GovernedButton
                    ref={dialogCancelRef}
                    variant="secondary"
                    {...(confirming
                      ? { disabled: true as const, disabledReason: 'Confirmation in progress.' }
                      : { onInvoke: () => clearPreview() })}
                  >
                    Cancel
                  </GovernedButton>
                </AlertDialog.Cancel>
                <GovernedButton disabled={confirming} onInvoke={() => void confirmPreview()}>
                  {confirming
                    ? `Confirming ${preview.allowedAction.label}…`
                    : `Confirm ${preview.allowedAction.label}`}
                </GovernedButton>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      ) : null}
    </section>
  );
}
