import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readStoredOperatingArtifactGeneration } from './artifact-route-generation.js';
import { canonicalDigest } from './canonical.js';
import { operatingProjectKey, validateOperatingConfiguration } from './config.js';
import { OperatingEventStore } from './event-store.js';
import { withOperatingLock } from './lock-service.js';
import { renderOperatingBrief, selectCycleState } from './projection.js';
import { persistOperatingProjections } from './projection-persistence.js';
import { sanitizeGeneratedPlainText } from './redaction.js';
import { applyOperatingRoute, readOperatingRoute, rollbackOperatingRoute } from './routes.js';
import { overdueOperatingDecisionIds } from './stalled-item-service.js';
import {
  OperateError,
  type OperatingEventHead,
  type OperatingFinding,
  type OperatingState,
} from './types.js';
import { resolveOperatingPaths } from './workspace.js';

type Collection =
  | 'cycles'
  | 'findings'
  | 'decisions'
  | 'gaps'
  | 'routes'
  | 'evidence'
  | 'migrations';

function stateCollection(
  state: OperatingState,
  collection: Collection,
): Array<Record<string, unknown>> {
  if (collection === 'cycles') return state.cycles;
  if (collection === 'findings') return state.findings;
  if (collection === 'decisions') return state.decisions;
  if (collection === 'gaps') return state.dataGaps;
  if (collection === 'routes') return state.routes;
  if (collection === 'evidence') return state.evidenceSources;
  return [];
}

export async function readOperatingCollection(input: {
  projectRoot: string;
  collection: Collection;
  id?: string;
  localRoot?: string;
}): Promise<unknown> {
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const state = await store.state();
  if (input.collection === 'migrations') {
    const directory = resolveOperatingPaths(input.projectRoot, {
      localRoot: input.localRoot,
    }).migrations;
    const { readdir } = await import('node:fs/promises');
    const records = await Promise.all(
      (await readdir(directory).catch(() => []))
        .filter((name) => name.endsWith('.json'))
        .sort()
        .map((name) =>
          readFile(path.join(directory, name), 'utf8')
            .then((raw) => JSON.parse(raw) as Record<string, unknown>)
            .catch(() => null),
        ),
    );
    const valid = records.filter((record): record is Record<string, unknown> => Boolean(record));
    return input.id ? (valid.find((record) => record.id === input.id) ?? null) : valid;
  }
  if (input.collection === 'routes' && input.id) {
    return readOperatingRoute(input.projectRoot, input.id).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
  }
  const records = stateCollection(state, input.collection);
  if (!input.id) return records;
  const idField = input.collection === 'evidence' ? 'id' : 'id';
  return records.find((record) => record[idField] === input.id) ?? null;
}

export async function readOperatingReview(input: {
  projectRoot: string;
  cycleId?: string;
  brief?: boolean;
  localRoot?: string;
}): Promise<unknown> {
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const state = selectCycleState(await store.state(), input.cycleId);
  if (input.cycleId && state.cycles.length === 0) {
    throw new OperateError('E_OPERATE_STATE_INVALID', `Unknown operating cycle ${input.cycleId}.`);
  }
  return input.brief ? renderOperatingBrief(state) : state;
}

async function mutateEvent(input: {
  projectRoot: string;
  localRoot?: string;
  cycleId: string;
  type: Parameters<OperatingEventStore['append']>[0]['type'];
  entityId: string;
  payload?: Record<string, unknown>;
  evidenceRefs?: string[];
  timestamp?: string;
  validateState?: (state: OperatingState) => void | Promise<void>;
}): Promise<{ eventHead: OperatingEventHead; state: OperatingState }> {
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const initial = await store.replay();
  return withOperatingLock(
    input.projectRoot,
    {
      projectKey: operatingProjectKey(input.projectRoot),
      expectedEventHead: initial.eventHead,
      currentEventHead: initial.eventHead,
      localRoot: input.localRoot,
    },
    async (lock) => {
      const lockedReplay = await store.replay();
      lock.assertEventHead(lockedReplay.eventHead);
      if (input.validateState) {
        await input.validateState(await store.state());
      }
      const event = await store.append({
        type: input.type,
        cycleId: input.cycleId,
        entityId: input.entityId,
        payload: input.payload,
        evidenceRefs: input.evidenceRefs,
        correlationId: randomUUID(),
        timestamp: input.timestamp,
        expectedHead: initial.eventHead.hash,
        actor: { kind: 'human', id: 'operate-cli' },
      });
      const eventHead = { sequence: event.sequence, hash: event.eventHash };
      await lock.advanceEventHead(initial.eventHead, eventHead);
      const state = await store.state();
      await store.writeCheckpoint(state);
      await persistOperatingProjections({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        state,
        revalidateEventHead: async () => (await store.replay()).eventHead,
      });
      return { eventHead, state };
    },
  );
}

/**
 * Marks elapsed decision deadlines as due for explicit owner review. This
 * transition deliberately carries no selected option and executes no default.
 */
export async function reconcileOperatingDecisionDeadlines(input: {
  projectRoot: string;
  now?: Date;
  localRoot?: string;
}): Promise<{ transitioned: number; state: OperatingState }> {
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const initial = await store.replay();
  const now = input.now ?? new Date();
  const due = overdueOperatingDecisionIds(await store.state(), now);
  if (due.length === 0) return { transitioned: 0, state: await store.state() };
  return withOperatingLock(
    input.projectRoot,
    {
      projectKey: operatingProjectKey(input.projectRoot),
      expectedEventHead: initial.eventHead,
      currentEventHead: initial.eventHead,
      localRoot: input.localRoot,
    },
    async (lock) => {
      const lockedReplay = await store.replay();
      lock.assertEventHead(lockedReplay.eventHead);
      const lockedState = await store.state();
      const lockedDue = overdueOperatingDecisionIds(lockedState, now);
      let head = lockedReplay.eventHead;
      for (const decisionId of lockedDue) {
        const decision = lockedState.decisions.find((record) => record.id === decisionId);
        const event = await store.append({
          type: 'decision.default-due',
          cycleId: String(decision?.cycleId),
          entityId: decisionId,
          payload: {},
          correlationId: `deadline-${decisionId}`,
          timestamp: now.toISOString(),
          expectedHead: head.hash,
          actor: { kind: 'engine', id: 'openplanr-deadline-reconciler' },
        });
        const next = { sequence: event.sequence, hash: event.eventHash };
        await lock.advanceEventHead(head, next);
        head = next;
      }
      const state = await store.state();
      await store.writeCheckpoint(state);
      await persistOperatingProjections({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        state,
        revalidateEventHead: async () => (await store.replay()).eventHead,
      });
      return { transitioned: lockedDue.length, state };
    },
  );
}

export async function transitionOperatingCycle(input: {
  projectRoot: string;
  cycleId: string;
  action: 'resume' | 'cancel' | 'recover' | 'close';
  confirmed: boolean;
  localRoot?: string;
}): Promise<unknown> {
  if (!input.confirmed) {
    throw new OperateError(
      'E_OPERATE_AUTHORITY_REQUIRED',
      `Cycle ${input.action} requires explicit confirmation.`,
    );
  }
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const state = await store.state();
  const cycle = state.cycles.find((record) => record.id === input.cycleId);
  if (!cycle) {
    throw new OperateError('E_OPERATE_STATE_INVALID', `Unknown cycle ${input.cycleId}.`);
  }
  if (input.action === 'cancel' && cycle.state === 'cancelled') {
    return {
      cycle,
      idempotent: true,
    };
  }
  if (input.action === 'recover') {
    const { recoverOperatingTransactions } = await import('./journal.js');
    const recovered = await recoverOperatingTransactions(input.projectRoot, {
      localRoot: input.localRoot,
    });
    if (cycle.state !== 'blocked' && cycle.state !== 'failed') {
      const currentState = await store.state();
      await persistOperatingProjections({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        state: currentState,
        revalidateEventHead: async () => (await store.replay()).eventHead,
      });
      return { cycle, recoveredTransactions: recovered };
    }
    const next = cycle.state === 'blocked' ? 'collecting' : 'preparing';
    const changed = await mutateEvent({
      projectRoot: input.projectRoot,
      localRoot: input.localRoot,
      cycleId: input.cycleId,
      type: `cycle.${next}`,
      entityId: input.cycleId,
      payload: { patch: { health: 'partial' }, recoveredTransactions: recovered },
    });
    return { ...changed, recoveredTransactions: recovered };
  }
  const type =
    input.action === 'resume'
      ? 'cycle.collecting'
      : input.action === 'cancel'
        ? 'cycle.cancelled'
        : 'cycle.closed';
  return mutateEvent({
    projectRoot: input.projectRoot,
    localRoot: input.localRoot,
    cycleId: input.cycleId,
    type,
    entityId: input.cycleId,
    payload: input.action === 'close' ? { patch: { completedAt: new Date().toISOString() } } : {},
    validateState:
      input.action === 'close'
        ? (lockedState) => {
            const lockedCycle = lockedState.cycles.find((record) => record.id === input.cycleId);
            if (lockedCycle?.state !== 'reviewable') {
              throw new OperateError(
                'E_OPERATE_STATE_INVALID',
                `Cycle ${input.cycleId} must be reviewable before it can close.`,
              );
            }
            assertOperatingCycleDisposable(lockedState, input.cycleId);
          }
        : undefined,
  });
}

/**
 * A non-quiet operating cycle may close only after every surfaced finding has
 * either reached a terminal governance state or had its accepted route
 * applied, and every owner decision has reached a terminal state.
 */
export function assertOperatingCycleDisposable(state: OperatingState, cycleId: string): void {
  const findings = state.findings.filter(
    (finding) => finding.cycleId === cycleId && finding.parked !== true,
  );
  const decisions = state.decisions.filter((decision) => decision.cycleId === cycleId);
  if (findings.length === 0 && decisions.length === 0) return;

  const appliedFindingIds = new Set(
    state.routes
      .filter((route) => route.cycleId === cycleId && route.state === 'applied')
      .flatMap((route) =>
        Array.isArray(route.findingIds)
          ? route.findingIds.filter((id): id is string => typeof id === 'string')
          : [],
      ),
  );
  const terminalFindingStates = new Set(['done', 'rejected', 'superseded']);
  const blockingFindings = findings
    .filter(
      (finding) =>
        !terminalFindingStates.has(String(finding.status)) && !appliedFindingIds.has(finding.id),
    )
    .map((finding) => ({ id: finding.id, status: finding.status }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const terminalDecisionStates = new Set(['closed', 'superseded']);
  const blockingDecisions = decisions
    .filter((decision) => !terminalDecisionStates.has(String(decision.status)))
    .map((decision) => ({ id: decision.id, status: decision.status }))
    .sort((left, right) => left.id.localeCompare(right.id));

  if (blockingFindings.length === 0 && blockingDecisions.length === 0) return;
  throw new OperateError(
    'E_OPERATE_CYCLE_NOT_DISPOSED',
    `Cycle ${cycleId} still has governed work that must be disposed before it can close.`,
    {
      blockingFindings,
      blockingDecisions,
      recoveryCommands: [
        ...blockingFindings.map(
          ({ id }) =>
            `planr operate findings accept ${id} --yes && planr operate routes apply <route-id> --yes`,
        ),
        ...blockingFindings.map(
          ({ id }) => `planr operate findings reject ${id} --reason <reason> --yes`,
        ),
        ...blockingDecisions.map(
          ({ id }) => `planr operate decisions decide ${id} --option <option> --yes`,
        ),
      ],
    },
  );
}

function scoreAmendment(
  finding: Record<string, unknown>,
  values: {
    impact?: unknown;
    confidence?: unknown;
    ease?: unknown;
    reason?: string;
  },
  timestamp: string,
): {
  patch: { score: number };
  scoreAmendment: NonNullable<OperatingFinding['scoreAmendment']>;
} {
  const prior = {
    impact: Number(finding.impact),
    confidence: Number(finding.confidence),
    ease: Number(finding.ease),
  };
  const next = { ...prior };
  for (const key of ['impact', 'confidence', 'ease'] as const) {
    if (values[key] === undefined) continue;
    const score = Number(values[key]);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        `${key} amendment must be an integer from 1 to 5.`,
      );
    }
    next[key] = score;
  }
  const ceiling = Number(finding.confidenceCeiling ?? finding.confidence);
  if (next.confidence > ceiling) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      `Confidence amendment ${next.confidence} exceeds the evidence ceiling ${ceiling}.`,
    );
  }
  const reason = sanitizeGeneratedPlainText(
    values.reason?.trim() || 'Accepted without changing the evidence-bounded score.',
  ).slice(0, 2_048);
  return {
    patch: { score: next.impact * next.confidence * next.ease },
    scoreAmendment: {
      prior,
      next,
      reason,
      actor: { kind: 'human', id: 'operate-cli' },
      timestamp,
    },
  };
}

export async function governOperatingFinding(input: {
  projectRoot: string;
  findingId: string;
  action: 'accept' | 'reject' | 'supersede';
  confirmed: boolean;
  reason?: string;
  impact?: unknown;
  confidence?: unknown;
  ease?: unknown;
  localRoot?: string;
}): Promise<unknown> {
  if (!input.confirmed) {
    throw new OperateError(
      'E_OPERATE_AUTHORITY_REQUIRED',
      `Finding ${input.action} requires explicit confirmation.`,
    );
  }
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const state = await store.state();
  const finding = state.findings.find((record) => record.id === input.findingId);
  if (!finding) {
    throw new OperateError('E_OPERATE_STATE_INVALID', `Unknown finding ${input.findingId}.`);
  }
  if (input.action !== 'accept' && !input.reason?.trim()) {
    throw new OperateError(
      'E_OPERATE_AUTHORITY_REQUIRED',
      `${input.action} requires an audit reason.`,
    );
  }
  const timestamp = new Date().toISOString();
  const acceptedScore =
    input.action === 'accept' ? scoreAmendment(finding, input, timestamp) : null;
  const patch = acceptedScore?.patch ?? {};
  const findingResult = await mutateEvent({
    projectRoot: input.projectRoot,
    localRoot: input.localRoot,
    cycleId: String(finding.cycleId),
    type: `finding.${input.action === 'accept' ? 'accepted' : input.action === 'reject' ? 'rejected' : 'superseded'}`,
    entityId: input.findingId,
    payload:
      input.action === 'accept'
        ? {
            patch,
            scoreAmendment: acceptedScore?.scoreAmendment,
          }
        : {
            patch,
            reason: sanitizeGeneratedPlainText(input.reason?.trim() ?? '').slice(0, 2_048),
          },
    evidenceRefs: Array.isArray(finding.evidenceRefs) ? (finding.evidenceRefs as string[]) : [],
    timestamp,
  });
  if (input.action !== 'accept') return findingResult;
  let acceptedRoute: Awaited<ReturnType<typeof readOperatingRoute>> | null = null;
  for (const candidate of findingResult.state.routes) {
    const full = await readOperatingRoute(input.projectRoot, String(candidate.id)).catch(
      () => null,
    );
    if (!full?.actions.some((action) => action.findingId === input.findingId)) continue;
    acceptedRoute = full;
    if (candidate.state === 'proposed') {
      await mutateEvent({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        cycleId: full.cycleId,
        type: 'route.accepted',
        entityId: full.id,
        payload: {
          routeDigest: full.routeDigest,
          confirmationDigest: full.previewDigest,
        },
        evidenceRefs: full.actions.flatMap((action) => action.evidenceRefs),
      });
    }
  }
  return {
    finding: input.findingId,
    accepted: true,
    routeId: acceptedRoute?.id ?? null,
    routePreviewDigest: acceptedRoute?.previewDigest ?? null,
  };
}

export async function decideOperatingDecision(input: {
  projectRoot: string;
  decisionId: string;
  value: string;
  reason?: string;
  confirmed: boolean;
  localRoot?: string;
}): Promise<unknown> {
  if (!input.confirmed || !input.value.trim()) {
    throw new OperateError(
      'E_OPERATE_AUTHORITY_REQUIRED',
      'A decision requires --yes and a non-empty value.',
    );
  }
  const store = new OperatingEventStore(input.projectRoot, {
    localRoot: input.localRoot,
  });
  const state = await store.state();
  const decision = state.decisions.find((record) => record.id === input.decisionId);
  if (!decision) {
    throw new OperateError('E_OPERATE_STATE_INVALID', `Unknown decision ${input.decisionId}.`);
  }
  const selectedOption = sanitizeGeneratedPlainText(input.value.trim()).slice(0, 8_192);
  const reason = input.reason?.trim()
    ? sanitizeGeneratedPlainText(input.reason.trim()).slice(0, 2_048)
    : null;
  let answeredHead: OperatingEventHead;
  if (decision.status === 'answered') {
    if (decision.selectedOption !== selectedOption) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Decision ${input.decisionId} was already answered with a different option.`,
      );
    }
    const answeredEvent = [...(await store.replay()).events]
      .reverse()
      .find((event) => event.type === 'decision.answered' && event.entityId === input.decisionId);
    if (!answeredEvent) {
      throw new OperateError(
        'E_OPERATE_STATE_INVALID',
        `Decision ${input.decisionId} is answered but its answer event is missing.`,
      );
    }
    answeredHead = { sequence: answeredEvent.sequence, hash: answeredEvent.eventHash };
  } else {
    const answered = await mutateEvent({
      projectRoot: input.projectRoot,
      localRoot: input.localRoot,
      cycleId: String(decision.cycleId),
      type: 'decision.answered',
      entityId: input.decisionId,
      payload: {
        patch: { selectedOption },
        reason,
      },
      validateState: (lockedState) => {
        const lockedDecision = lockedState.decisions.find(
          (record) => record.id === input.decisionId,
        );
        if (!lockedDecision || !['open', 'default-due'].includes(String(lockedDecision.status))) {
          throw new OperateError(
            'E_OPERATE_STATE_INVALID',
            `Decision ${input.decisionId} is no longer available to answer.`,
          );
        }
      },
    });
    answeredHead = answered.eventHead;
  }
  return mutateEvent({
    projectRoot: input.projectRoot,
    localRoot: input.localRoot,
    cycleId: String(decision.cycleId),
    type: 'decision.closed',
    entityId: input.decisionId,
    payload: { patch: { selectedOption }, answeredHead },
    validateState: (lockedState) => {
      const lockedDecision = lockedState.decisions.find((record) => record.id === input.decisionId);
      if (
        lockedDecision?.status !== 'answered' ||
        lockedDecision.selectedOption !== selectedOption
      ) {
        throw new OperateError(
          'E_OPERATE_STATE_INVALID',
          `Decision ${input.decisionId} is not awaiting closure for the selected option.`,
        );
      }
    },
  });
}

export async function answerOperatingGap(input: {
  projectRoot: string;
  gapId: string;
  value: string;
  confirmed: boolean;
  localRoot?: string;
}): Promise<unknown> {
  if (!input.confirmed || !input.value.trim()) {
    throw new OperateError(
      'E_OPERATE_AUTHORITY_REQUIRED',
      'A gap answer requires --yes and a non-empty value.',
    );
  }
  const state = await new OperatingEventStore(input.projectRoot, {
    localRoot: input.localRoot,
  }).state();
  const gap = state.dataGaps.find((record) => record.id === input.gapId);
  if (!gap) throw new OperateError('E_OPERATE_STATE_INVALID', `Unknown gap ${input.gapId}.`);
  const answer = sanitizeGeneratedPlainText(input.value.trim()).slice(0, 8_192);
  return mutateEvent({
    projectRoot: input.projectRoot,
    localRoot: input.localRoot,
    cycleId: String(gap.cycleId),
    type: 'gap.answered',
    entityId: input.gapId,
    payload: { patch: { answer } },
  });
}

/**
 * A human answer is not evidence by itself. Verification requires explicit
 * evidence identifiers, then records verified and closed transitions before a
 * resumed cycle may rely on newly collected provider evidence.
 */
export async function verifyOperatingGap(input: {
  projectRoot: string;
  gapId: string;
  evidenceRefs: string[];
  confirmed: boolean;
  localRoot?: string;
}): Promise<unknown> {
  const evidenceRefs = [...new Set(input.evidenceRefs)].sort();
  if (!input.confirmed || evidenceRefs.length === 0) {
    throw new OperateError(
      'E_OPERATE_AUTHORITY_REQUIRED',
      'Gap verification requires --yes and at least one verified evidence reference.',
    );
  }
  const state = await new OperatingEventStore(input.projectRoot, {
    localRoot: input.localRoot,
  }).state();
  const gap = state.dataGaps.find((record) => record.id === input.gapId);
  if (!gap || gap.status !== 'answered') {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `Gap ${input.gapId} must be answered before it can be verified.`,
    );
  }
  const verified = await mutateEvent({
    projectRoot: input.projectRoot,
    localRoot: input.localRoot,
    cycleId: String(gap.cycleId),
    type: 'gap.verified',
    entityId: input.gapId,
    payload: {},
    evidenceRefs,
  });
  return mutateEvent({
    projectRoot: input.projectRoot,
    localRoot: input.localRoot,
    cycleId: String(gap.cycleId),
    type: 'gap.closed',
    entityId: input.gapId,
    payload: {},
    evidenceRefs,
  }).then((closed) => ({ verified, closed }));
}

export async function applyOrRollbackRoute(input: {
  projectRoot: string;
  routeId: string;
  action: 'apply' | 'rollback';
  previewDigest?: string;
  preview?: boolean;
  confirmed: boolean;
  localRoot?: string;
}): Promise<unknown> {
  const route = await readOperatingRoute(input.projectRoot, input.routeId);
  if (input.action === 'apply') {
    const projected = (
      await new OperatingEventStore(input.projectRoot, {
        localRoot: input.localRoot,
      }).state()
    ).routes.find((record) => record.id === input.routeId);
    const destination = await import('./routes.js').then(({ routeDestinationDigest }) =>
      routeDestinationDigest(input.projectRoot, route),
    );
    const isAgentArtifact = route.actions[0]?.kind === 'create-cycle-artifact';
    const generated = isAgentArtifact
      ? await readStoredOperatingArtifactGeneration({
          projectRoot: input.projectRoot,
          localRoot: input.localRoot,
          route,
        })
      : null;
    const awaitingPlan =
      projected?.state === 'prepared' &&
      ['create-spec', 'create-instrumentation-spec'].includes(String(route.actions[0]?.kind));
    const awaitingArtifactReview =
      projected?.state === 'prepared' && generated?.state === 'generated';
    const preview = {
      route,
      previewDigest:
        awaitingArtifactReview && generated.exactPreviewDigest
          ? generated.exactPreviewDigest
          : route.previewDigest,
      destinationDigest: destination,
      destinationMatches:
        awaitingPlan || (isAgentArtifact && projected?.state === 'prepared')
          ? null
          : destination === route.destinationDigest,
      phase: awaitingPlan
        ? 'complete-plan-handoff'
        : awaitingArtifactReview
          ? 'commit-generated-artifact'
          : isAgentArtifact
            ? 'generate-artifact'
            : 'prepare-route',
      writesCommitted: false,
      ...(awaitingArtifactReview
        ? {
            artifact: {
              destination: generated.session.destination,
              content: generated.content,
              outputDigest: generated.session.outputDigest,
              attempts: generated.attempts,
            },
          }
        : {}),
    };
    if (input.preview) return preview;
    if (!input.confirmed) {
      throw new OperateError(
        'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED',
        'Review the route preview, then confirm the exact preview digest.',
        preview,
      );
    }
    if (!input.previewDigest) {
      throw new OperateError(
        'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED',
        `Preview this route and provide --preview-digest ${preview.previewDigest}.`,
        { previewDigest: preview.previewDigest, route },
      );
    }
    if (!awaitingPlan && destination !== route.destinationDigest) {
      throw new OperateError('E_OPERATE_ROUTE_DRIFT', 'A route destination changed after preview.');
    }
    const config = await validateOperatingConfiguration(input.projectRoot);
    return applyOperatingRoute({
      projectRoot: input.projectRoot,
      route,
      config,
      confirmationDigest: input.previewDigest,
      localRoot: input.localRoot,
    });
  }
  if (!input.confirmed) {
    throw new OperateError(
      'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED',
      'Route rollback requires explicit confirmation.',
    );
  }
  const state = await new OperatingEventStore(input.projectRoot, {
    localRoot: input.localRoot,
  }).state();
  const projected = state.routes.find((record) => record.id === input.routeId);
  if (!projected?.transactionId) {
    throw new OperateError(
      'E_OPERATE_TRANSACTION_INVALID',
      `Route ${input.routeId} has no applied transaction to roll back.`,
    );
  }
  return rollbackOperatingRoute({
    projectRoot: input.projectRoot,
    route,
    transactionId: String(projected.transactionId),
    recoveryId: `RCV-${canonicalDigest({
      routeId: input.routeId,
      transactionId: projected.transactionId,
    }).slice(7, 31)}`,
    localRoot: input.localRoot,
  });
}
