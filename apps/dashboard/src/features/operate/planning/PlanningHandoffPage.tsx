/* biome-ignore-all lint/suspicious/noArrayIndexKey: canonical proposal arrays retain owner order by contract. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { serializeDashboardRoute } from '../../../app/router.js';
import {
  AlertDialog,
  GovernedButton,
  StatePanel,
} from '../../../design-system/components/index.js';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import { DeliveryTrace } from '../../planning/DeliveryTrace.js';
import {
  createPlanningActions,
  type PlanningActions,
  type PlanningFraming,
  type PlanningHandoffCreation,
  type PlanningHandoffPreview,
} from './planning-actions.js';
import {
  clonePlanningFraming,
  framingMatchesCanonical,
  isExactPlanningCreation,
  isExactPlanningSpecPreview,
  PLANNING_FRAMING_FIELDS,
  resolvePlanningHandoffModel,
} from './planning-handoff-model.js';
import '../operate.css';
import './planning-handoff.css';

type JsonRecord = Record<string, unknown>;

type PlanningNotice = Readonly<{
  tone: 'verified' | 'attention' | 'refusal';
  text: string;
}>;

export type PlanningHandoffPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
  actions?: PlanningActions;
  onRefetch?: () => Promise<DashboardProductState<unknown>>;
}>;

function exactCustodyKey(
  model: NonNullable<ReturnType<typeof resolvePlanningHandoffModel>>,
): string {
  return JSON.stringify({
    actorId: model.binding.actorId,
    projectId: model.binding.projectId,
    scopeId: model.binding.scopeId,
    domainId: model.binding.domainId,
    domainVersion: model.binding.domainVersion,
    generation: model.binding.generation,
    route: model.binding.route,
    cycleId: model.binding.cycleId,
    subjectId: model.binding.subjectId,
    eventHead: model.binding.eventHead,
    viewHash: model.binding.viewHash,
    action: {
      actionId: model.action.actionId,
      actionHash: model.action.actionHash,
      revision: model.action.revision,
    },
  });
}

function reconciliationScopeKey(
  model: NonNullable<ReturnType<typeof resolvePlanningHandoffModel>>,
): string {
  return JSON.stringify({
    actorId: model.binding.actorId,
    projectId: model.binding.projectId,
    scopeId: model.binding.scopeId,
    domainId: model.binding.domainId,
    domainVersion: model.binding.domainVersion,
    generation: model.binding.generation,
    route: model.binding.route,
    cycleId: model.binding.cycleId,
    subjectId: model.binding.subjectId,
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function record(value: unknown): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value === null || value === undefined || value === '' ? 'Not available' : value}</dd>
    </div>
  );
}

function globalReason(presentation: string, reasonCodes: readonly string[]): string | null {
  if (presentation === 'offline') {
    return 'Live authority is unavailable offline. Reconnect and refresh before any command.';
  }
  if (presentation === 'stale') {
    return 'The displayed Event head is stale. Refresh before requesting a new preview.';
  }
  if (reasonCodes.includes('OPERATE_EVENT_GAP')) {
    return 'An ordered Event gap was detected. Refresh the validated snapshot before any command.';
  }
  if (presentation === 'read-only') {
    return 'No command gateway or current mutation authority is available.';
  }
  return null;
}

function planningDetailHref(specId: string): string {
  return serializeDashboardRoute({
    kind: 'planning.detail',
    product: 'planning',
    subjectId: specId,
  });
}

function actionHref(actionId: string): string {
  return serializeDashboardRoute({
    kind: 'operate.action',
    product: 'operate',
    subjectId: actionId,
  });
}

function CreatedView({
  creation,
  actionId,
  actionTitle,
}: {
  creation: PlanningHandoffCreation;
  actionId: string;
  actionTitle: string;
}) {
  const receipt = record(creation.receipt);
  const specId = stringValue(receipt.specId);
  const planningHref = specId ? planningDetailHref(specId) : null;
  return (
    <section
      className="op-planning-handoff__created"
      aria-label="Created SPEC draft and delivery trace"
    >
      <header className="op-planning-handoff__header">
        <div>
          <p className="op-eyebrow">Planning handoff · SPEC created</p>
          <h1>
            {specId || 'SPEC'} ·{' '}
            {stringValue(receipt.title) ||
              stringValue(receipt.slug) ||
              actionTitle ||
              'Created draft'}
          </h1>
          <p>
            {specId
              ? `${specId} is durable with status shaping.`
              : 'The shaping draft and origin receipt are durable.'}{' '}
            No story, task, PLAN, SHIP, commit, or target effect was started.
          </p>
        </div>
        <div className="op-planning-handoff__actions">
          <a className="op-cycle-link" href={actionHref(actionId)}>
            Return to source Action
          </a>
          {planningHref ? (
            <a className="op-cycle-link op-cycle-link--primary" href={planningHref}>
              Open in Planning
            </a>
          ) : null}
        </div>
      </header>
      <DeliveryTrace progress={creation.progress} />
      <div className="op-planning-handoff__grid">
        <section className="op-planning-handoff__card" aria-label="Draft details">
          <p className="op-eyebrow">Draft details</p>
          <h2>{specId || 'Created SPEC'}</h2>
          <p>Status shaping</p>
          <details>
            <summary>Technical details</summary>
            <dl className="op-cycle-custody">
              <Fact label="Content digest" value={stringValue(receipt.contentHash)} />
              <Fact label="Origin digest" value={stringValue(receipt.originHash)} />
              <Fact label="Receipt digest" value={stringValue(receipt.receiptHash)} />
              <Fact label="Proposal" value={stringValue(receipt.proposalId)} />
              <Fact label="Correlation" value={stringValue(receipt.correlationId)} />
              <Fact label="Planning provenance" value={stringValue(receipt.provenanceEventId)} />
            </dl>
          </details>
        </section>
        <section className="op-planning-handoff__card" aria-label="Next human gates">
          <p className="op-eyebrow">Next human gates</p>
          <h2>Planning owns the next commands</h2>
          <p>
            These commands are returned by OpenPlanr; this screen does not construct or run them.
          </p>
          {creation.nextCommands.length > 0 ? (
            <pre className="op-planning-handoff__commands">
              <code>{creation.nextCommands.join('\n')}</code>
            </pre>
          ) : (
            <StatePanel
              state="unavailable"
              eyebrow="Next commands"
              title="Next commands unavailable"
              description="No planning command is inferred from the SPEC ID."
            />
          )}
        </section>
      </div>
    </section>
  );
}

export function PlanningHandoffPage({
  currentBinding,
  current,
  actions,
  onRefetch,
}: PlanningHandoffPageProps) {
  const model = useMemo(
    () => resolvePlanningHandoffModel(current, currentBinding),
    [current, currentBinding],
  );
  const [previewState, setPreviewState] = useState<PlanningHandoffPreview | null>(null);
  const [creation, setCreation] = useState<PlanningHandoffCreation | null>(null);
  const [draft, setDraft] = useState<PlanningFraming | null>(null);
  const [notice, setNotice] = useState<PlanningNotice | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uncertainCustody, setUncertainCustody] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const actionsRef = useRef<PlanningActions | null>(null);
  const transportCustodyRef = useRef<string | null>(null);
  const launchCustodyRef = useRef('');
  const renderedCustodyRef = useRef('');
  const custodyKey = model ? exactCustodyKey(model) : '';
  const reconciliationScope = model ? reconciliationScopeKey(model) : '';

  const proposal = previewState ? record(previewState.proposal) : null;
  const specPreview = previewState ? record(previewState.specPreview) : null;
  const canonicalFraming = proposal ? clonePlanningFraming(proposal.framing) : null;
  const activeDraft = draft ?? canonicalFraming;
  const previewCurrent =
    proposal &&
    specPreview &&
    model?.binding.eventHead &&
    activeDraft &&
    canonicalFraming &&
    framingMatchesCanonical(activeDraft, canonicalFraming) &&
    isExactPlanningSpecPreview(proposal, specPreview, {
      actorId: model.binding.actorId,
      scopeId: model.binding.scopeId,
      domainId: model.binding.domainId,
      domainVersion: model.binding.domainVersion,
      action: {
        actionId: model.action.actionId,
        revision: model.action.revision,
        actionHash: model.action.actionHash,
      },
      eventHead: model.binding.eventHead,
    });

  const transport = useCallback((): PlanningActions | null => {
    if (actions) return actions;
    if (!model || typeof window === 'undefined') return null;
    if (
      model.binding.cycleId === null ||
      model.binding.eventHead === null ||
      model.binding.viewHash === null
    ) {
      return null;
    }
    if (actionsRef.current && transportCustodyRef.current === custodyKey) {
      return actionsRef.current;
    }
    actionsRef.current?.cancel();
    actionsRef.current?.dispose();
    actionsRef.current = null;
    transportCustodyRef.current = null;
    const built = createPlanningActions({ origin: window.location.origin });
    built.bind(model.binding, {
      subjectId: model.action.actionId,
      actionDigest: model.action.actionHash,
      revision: model.action.revision,
    });
    actionsRef.current = built;
    transportCustodyRef.current = custodyKey;
    return built;
  }, [actions, custodyKey, model]);

  const unavailableReason = model ? globalReason(model.presentation, model.reasonCodes) : null;
  const exactCreation =
    creation &&
    isExactPlanningCreation(
      record(creation.receipt),
      record(creation.origin),
      record(creation.progress),
    );

  const runPreview = useCallback(
    async (framing?: PlanningFraming) => {
      if (!model) return;
      const launchCustody = custodyKey;
      setNotice(null);
      setPreviewState(null);
      setDialogOpen(false);
      const client = transport();
      if (!client) return;
      try {
        const next = await client.preview(model.action.actionId, framing);
        if (launchCustodyRef.current !== launchCustody) return;
        setPreviewState(next);
        setDraft(clonePlanningFraming(record(next.proposal).framing));
      } catch (error) {
        if (isAbortError(error) || launchCustodyRef.current !== launchCustody) return;
        const code =
          error && typeof error === 'object' && 'name' in error
            ? String((error as { name: string }).name)
            : 'OPERATE_COMMAND_REFUSED';
        if (code === 'OPERATION_UNCERTAIN') setUncertainCustody(reconciliationScope);
        setNotice({
          tone: code === 'OPERATION_UNCERTAIN' ? 'attention' : 'refusal',
          text:
            code === 'E_OPERATE_PLANNING_EXPIRED'
              ? 'Planning preview expired. Refresh the canonical preview before confirming creation.'
              : code === 'OPERATION_UNCERTAIN'
                ? 'Planning preview proof was lost after POST. Reconcile exact current state; do not reuse the prior preview.'
                : 'The governed Planning preview was refused without effect.',
        });
      }
    },
    [custodyKey, model, reconciliationScope, transport],
  );

  const runCreate = useCallback(async () => {
    if (!proposal || !model?.binding.eventHead) return;
    const launchCustody = custodyKey;
    const previewDigest = stringValue(record(proposal.preview).digest);
    const proposalId = stringValue(proposal.proposalId);
    if (!previewDigest || !proposalId) return;
    const client = transport();
    if (!client) return;
    try {
      const next = await client.createSpec(proposalId, previewDigest);
      if (launchCustodyRef.current !== launchCustody) return;
      setCreation(next);
      setDialogOpen(false);
      setNotice({
        tone: 'verified',
        text: `${stringValue(record(next.receipt).specId) || 'SPEC'} is durable with status shaping.`,
      });
    } catch (error) {
      if (isAbortError(error) || launchCustodyRef.current !== launchCustody) return;
      const code =
        error && typeof error === 'object' && 'name' in error
          ? String((error as { name: string }).name)
          : 'OPERATE_COMMAND_REFUSED';
      setDialogOpen(false);
      if (code === 'OPERATION_UNCERTAIN') setUncertainCustody(reconciliationScope);
      setNotice({
        tone: code === 'OPERATION_UNCERTAIN' ? 'attention' : 'refusal',
        text:
          code === 'E_OPERATE_PLANNING_EXPIRED'
            ? 'Planning preview expired. Refresh the canonical preview before confirming creation.'
            : code === 'OPERATION_UNCERTAIN'
              ? 'The command outcome is uncertain. Reconcile exact current state; do not retry.'
              : 'The governed Planning creation was refused without effect.',
      });
    }
  }, [custodyKey, model, proposal, reconciliationScope, transport]);

  useEffect(() => {
    return () => {
      actionsRef.current?.cancel();
      actionsRef.current?.dispose();
      actionsRef.current = null;
      transportCustodyRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    launchCustodyRef.current = custodyKey;
    if (renderedCustodyRef.current === custodyKey) return;
    renderedCustodyRef.current = custodyKey;
    if (uncertainCustody !== reconciliationScope) {
      actionsRef.current?.cancel();
      actionsRef.current?.dispose();
      actionsRef.current = null;
      transportCustodyRef.current = null;
    }
    setPreviewState(null);
    setCreation(null);
    setDraft(null);
    setDialogOpen(false);
    setNotice(null);
    setReconciling(false);
  }, [custodyKey, reconciliationScope, uncertainCustody]);

  useLayoutEffect(() => {
    if (!actions) return;
    actionsRef.current?.cancel();
    actionsRef.current?.dispose();
    actionsRef.current = null;
    transportCustodyRef.current = null;
  }, [actions]);

  const requestReconciliation = useCallback(async () => {
    if (!onRefetch || uncertainCustody !== reconciliationScope) return;
    setReconciling(true);
    try {
      const verified = await onRefetch();
      const next = verified.binding
        ? resolvePlanningHandoffModel(verified, verified.binding)
        : null;
      const client = actions ?? actionsRef.current;
      if (!next || !client) throw new Error('Exact reconciliation failed.');
      client.reconcile(next.binding);
      setUncertainCustody(null);
      setPreviewState(null);
      setDraft(null);
      setDialogOpen(false);
      setNotice({
        tone: 'verified',
        text: 'Exact current state was reconciled. Request a new canonical preview before any creation.',
      });
    } catch {
      setNotice({
        tone: 'attention',
        text: 'Planning remains locked: exact current state did not reconcile. Do not retry creation.',
      });
    } finally {
      setReconciling(false);
    }
  }, [actions, onRefetch, reconciliationScope, uncertainCustody]);

  if (!model) {
    return (
      <div
        className="op-workspace op-planning-handoff pc-operate"
        data-route-kind="operate.action-planning"
      >
        <StatePanel
          state="incompatible"
          eyebrow="Planning handoff"
          title="Planning handoff cannot be trusted"
          description="The owner-issued Action workspace did not pass exact binding and integrity verification."
        />
      </div>
    );
  }

  if (model.action.deliveryRoute?.route !== 'planning-work') {
    return (
      <section
        className="op-workspace op-planning-handoff pc-operate"
        data-route-kind="operate.action-planning"
        aria-label="Planning handoff unavailable"
      >
        <StatePanel
          state="unavailable"
          eyebrow="Delivery route"
          title="This Action does not enter Planning"
          description="Only the canonical planning-work route can request a proposal. The browser does not infer or change delivery routes."
        />
      </section>
    );
  }

  if (exactCreation && creation) {
    return (
      <section
        className="op-workspace op-planning-handoff pc-operate"
        data-route-kind="operate.action-planning"
        data-planning-state="created"
        aria-label="Created Planning handoff"
      >
        <CreatedView
          creation={creation}
          actionId={model.action.actionId}
          actionTitle={model.action.title}
        />
      </section>
    );
  }

  const hasCanonicalFraming = Boolean(proposal?.proposalId);
  const uncertain = uncertainCustody === reconciliationScope;
  const framingEditable =
    model.mutationEnabled &&
    !unavailableReason &&
    !uncertain &&
    !reconciling &&
    hasCanonicalFraming &&
    !exactCreation;
  const previewEnabled =
    model.mutationEnabled &&
    !unavailableReason &&
    !uncertain &&
    !reconciling &&
    Boolean(model.action);
  const createEnabled =
    previewEnabled &&
    previewCurrent &&
    stringValue(proposal?.state) === 'review-required' &&
    hasCanonicalFraming;

  return (
    <section
      className="op-workspace op-planning-handoff pc-operate"
      data-route-kind="operate.action-planning"
      data-planning-preview={previewCurrent ? 'current' : 'stale'}
      aria-labelledby="operate-planning-handoff-title"
    >
      <header className="op-planning-handoff__header">
        <div>
          <p className="op-eyebrow">Planning handoff</p>
          <h1 id="operate-planning-handoff-title">{model.action.title}</h1>
          <p>
            Review the context, shape the draft, and confirm it before creating a Planning SPEC.
          </p>
        </div>
        <a className="op-cycle-link" href={actionHref(model.action.actionId)}>
          Return to source Action
        </a>
      </header>

      {unavailableReason ? (
        <StatePanel
          state={model.presentation === 'offline' ? 'offline' : 'unavailable'}
          eyebrow="Governed controls"
          title="Planning creation is unavailable"
          description={unavailableReason}
        />
      ) : null}

      {notice ? (
        <p className="pc-operate__notice" role="status" data-tone={notice.tone}>
          {notice.text}
        </p>
      ) : null}

      {uncertain ? (
        <StatePanel
          state="incompatible"
          eyebrow="Uncertain operation"
          title="Creation stays disabled until exact reconciliation"
          description="A Planning POST may have taken effect. OpenPlanr will not offer a blind retry."
          actions={
            <GovernedButton
              disabled={!onRefetch || reconciling}
              disabledReason="An exact adapter-owned refetch is required before another preview."
              onInvoke={requestReconciliation}
            >
              {reconciling ? 'Reconciling current state…' : 'Reconcile current state'}
            </GovernedButton>
          }
        />
      ) : null}

      <div className="op-planning-handoff__layout">
        <div className="op-planning-handoff__stack">
          <section className="op-planning-handoff__card" aria-label="Why this draft">
            <p className="op-eyebrow">Why this draft</p>
            <h2>{stringValue(record(proposal?.decision).title) || model.action.title}</h2>
            <p>
              {stringValue(record(proposal?.decision).rationale) ||
                'OpenPlanr has not returned a canonical Planning proposal for this Action.'}
            </p>
            <details>
              <summary>Technical details</summary>
              <dl className="op-cycle-custody">
                <Fact label="Decision" value={stringValue(record(proposal?.decision).decisionId)} />
                <Fact
                  label="Action"
                  value={stringValue(record(proposal?.action).actionId) || model.action.actionId}
                />
                <Fact label="Delivery route" value={model.action.deliveryRoute?.route} />
                <Fact label="Cycle" value={stringValue(proposal?.cycleId)} />
              </dl>
            </details>
          </section>

          <section className="op-planning-handoff__card" aria-label="Team perspectives">
            <p className="op-eyebrow">Team perspectives</p>
            <h2>What informed this draft</h2>
            <p>Review the perspectives and any disagreement before shaping the draft.</p>
            {array(proposal?.acceptedPerspectiveSummaries).length > 0 ? (
              <ul className="op-planning-handoff__perspectives">
                {array(proposal?.acceptedPerspectiveSummaries).map((entry, index) => {
                  const perspective = record(entry);
                  return (
                    <li key={`${stringValue(perspective.roleId)}:${index}`}>
                      <strong>{stringValue(perspective.summary, 'Summary unavailable')}</strong>
                      <span>
                        {stringValue(perspective.roleKind, 'role')} ·{' '}
                        {stringValue(perspective.stance, 'unknown')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <StatePanel
                state="unavailable"
                eyebrow="Perspectives"
                title="No canonical proposal yet"
                description="Request a preview to load accepted advisor, Challenger, and Chair summaries."
              />
            )}
          </section>

          <section className="op-planning-handoff__card" aria-label="Supporting evidence">
            <p className="op-eyebrow">Supporting evidence</p>
            <h2>What the draft is based on</h2>
            {array(proposal?.evidence).length > 0 ? (
              <ul className="op-planning-handoff__evidence">
                {array(proposal?.evidence).map((entry, index) => {
                  const evidence = record(entry);
                  return (
                    <li key={`${stringValue(evidence.evidenceRefId)}:${index}`}>
                      <strong>
                        {stringValue(evidence.summary, 'Evidence body omitted by access policy')}
                      </strong>
                      <span>
                        {stringValue(evidence.relation, 'relation unavailable')} ·{' '}
                        {stringValue(evidence.accessState, 'access unavailable')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>No supporting evidence is available yet.</p>
            )}
          </section>
        </div>

        <div className="op-planning-handoff__stack">
          <section className="op-planning-handoff__card" aria-label="Shape the draft">
            <p className="op-eyebrow">Shape the draft</p>
            <h2>Shape the draft before confirmation</h2>
            <p>
              Editing refreshes the preview. You can create the draft only after reviewing the
              updated version.
            </p>
            <form className="op-planning-handoff__form" aria-label="Draft framing">
              {PLANNING_FRAMING_FIELDS.map(([field, label, kind]) => {
                const id = `op-planning-framing-${field}`;
                const value =
                  activeDraft && kind === 'list'
                    ? activeDraft[field].join('\n')
                    : activeDraft
                      ? activeDraft[field]
                      : '';
                return (
                  <label key={field} className="op-planning-handoff__field" htmlFor={id}>
                    <span>{label}</span>
                    {kind === 'textarea' || kind === 'list' ? (
                      <textarea
                        id={id}
                        name={field}
                        rows={kind === 'list' ? 4 : 5}
                        disabled={!framingEditable}
                        value={value}
                        onChange={(event) => {
                          if (!activeDraft) return;
                          const next =
                            kind === 'list'
                              ? event.target.value
                                  .split(/\r?\n/u)
                                  .map((line) => line.trim())
                                  .filter(Boolean)
                              : event.target.value;
                          setDraft(
                            Object.freeze({
                              ...activeDraft,
                              [field]: next,
                            }),
                          );
                        }}
                      />
                    ) : (
                      <input
                        id={id}
                        name={field}
                        type="text"
                        disabled={!framingEditable}
                        value={value}
                        onChange={(event) => {
                          if (!activeDraft) return;
                          setDraft(
                            Object.freeze({
                              ...activeDraft,
                              [field]: event.target.value,
                            }),
                          );
                        }}
                      />
                    )}
                  </label>
                );
              })}
            </form>
            <div className="op-planning-handoff__actions">
              <GovernedButton
                disabled={!previewEnabled}
                disabledReason={
                  unavailableReason ??
                  (!hasCanonicalFraming
                    ? 'Request the initial canonical proposal before editing human-owned framing.'
                    : 'Human framing is editable only from a current, online, actor-bound Planning handoff.')
                }
                onInvoke={() =>
                  runPreview(
                    hasCanonicalFraming && activeDraft
                      ? clonePlanningFraming(activeDraft)
                      : undefined,
                  )
                }
              >
                {hasCanonicalFraming ? 'Refresh canonical SPEC preview' : 'Preview SPEC draft'}
              </GovernedButton>
            </div>
          </section>

          <section className="op-planning-handoff__card" aria-label="Draft preview">
            <p className="op-eyebrow">Draft preview</p>
            <h2>
              {stringValue(specPreview?.title) ||
                stringValue(record(proposal?.framing).title) ||
                'No canonical SPEC preview yet'}
            </h2>
            <p>
              {previewCurrent
                ? 'The canonical SPEC preview is current for these exact human-owned framing fields.'
                : 'Request a canonical preview before creating the draft.'}
            </p>
            {typeof specPreview?.content === 'string' ? (
              <pre className="op-planning-handoff__spec-preview operate-planning-spec-preview">
                <code>{specPreview.content}</code>
              </pre>
            ) : (
              <StatePanel
                state="unavailable"
                eyebrow="Preview"
                title="Preview not issued"
                description="No local renderer is used. OpenPlanr must return the same validated SPEC bytes it will later publish."
              />
            )}
            <dl className="op-cycle-custody">
              <Fact label="Proposal" value={stringValue(proposal?.proposalId)} />
              <Fact label="Preview digest" value={stringValue(record(proposal?.preview).digest)} />
              <Fact
                label="Preview expiry"
                value={stringValue(record(proposal?.preview).expiresAt)}
              />
              <Fact label="SPEC content digest" value={stringValue(specPreview?.contentHash)} />
            </dl>
            <StatePanel
              state="incompatible"
              eyebrow="What happens next"
              title="This creates a draft only"
              description="It does not start work, create a commit, publish, or deploy."
            />
            <div className="op-planning-handoff__actions">
              <GovernedButton
                disabled={!createEnabled}
                disabledReason={
                  previewCurrent
                    ? 'Only a current review-required proposal can be confirmed once.'
                    : 'Refresh the exact canonical preview after every framing change.'
                }
                onInvoke={() => setDialogOpen(true)}
              >
                Create SPEC draft
              </GovernedButton>
            </div>
          </section>
        </div>
      </div>

      <AlertDialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="op-planning-handoff__overlay" />
          <AlertDialog.Content
            className="op-planning-handoff__dialog"
            role="dialog"
            aria-modal="true"
          >
            <AlertDialog.Title>Create one shaping SPEC draft?</AlertDialog.Title>
            <AlertDialog.Description>
              This confirms the exact proposal, Event head, human framing, preview digest, and
              expiry shown in this workspace.
            </AlertDialog.Description>
            <StatePanel
              state="incompatible"
              eyebrow="What happens next"
              title="More decisions are still required"
              description="Creating this draft does not start PLAN, SHIP, an Action, a commit, publication, or deployment."
            />
            <dl className="op-cycle-custody">
              <Fact label="Proposal" value={stringValue(proposal?.proposalId)} />
              <Fact label="Digest" value={stringValue(record(proposal?.preview).digest)} />
              <Fact label="Expires" value={stringValue(record(proposal?.preview).expiresAt)} />
            </dl>
            <div className="op-planning-handoff__dialog-actions">
              <AlertDialog.Cancel className="op-governed-button" type="button">
                Cancel
              </AlertDialog.Cancel>
              <GovernedButton onInvoke={runCreate}>Confirm Create SPEC draft</GovernedButton>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
