import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDigest } from './canonical.js';
import { operatingProjectKey, validateOperatingConfiguration } from './config.js';
import { OperatingEventStore } from './event-store.js';
import { withOperatingLock } from './lock-service.js';
import { persistOperatingProjections } from './projection-persistence.js';
import { assertOperatingArtifact } from './protocol.js';
import { reconcileOperatingShipObservations } from './shipment-observer.js';
import {
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingOutcome,
  type OperatingOutcomeObservation,
  type OperatingState,
} from './types.js';
import { assertOperatingProject, resolveOperatingPaths } from './workspace.js';

function compare(
  operator: OperatingOutcome['operator'],
  value: number,
  threshold: OperatingOutcome['threshold'],
): boolean {
  if (operator === 'gt') return value > threshold.value;
  if (operator === 'gte') return value >= threshold.value;
  if (operator === 'lt') return value < threshold.value;
  if (operator === 'lte') return value <= threshold.value;
  if (operator === 'eq') return value === threshold.value;
  return (
    threshold.upperValue !== undefined && value >= threshold.value && value <= threshold.upperValue
  );
}

function assertDirectionOperator(
  direction: OperatingOutcome['direction'],
  operator: OperatingOutcome['operator'],
): void {
  const allowed: Record<OperatingOutcome['direction'], OperatingOutcome['operator'][]> = {
    increase: ['gt', 'gte'],
    decrease: ['lt', 'lte'],
    maintain: ['eq'],
    range: ['between'],
  };
  if (!allowed[direction].includes(operator)) {
    throw new OperateError(
      'E_OPERATE_OUTCOME_NOT_READY',
      `Outcome direction ${direction} is incompatible with operator ${operator}.`,
    );
  }
}

export async function createOperatingOutcome(
  input: Omit<
    OperatingOutcome,
    'kind' | 'schemaVersion' | 'protocolVersion' | 'status' | 'createdAt' | 'updatedAt'
  > & { createdAt?: string },
): Promise<OperatingOutcome> {
  if (
    Date.parse(input.baselineWindow.from) >= Date.parse(input.baselineWindow.to) ||
    Date.parse(input.targetWindow.from) >= Date.parse(input.targetWindow.to)
  ) {
    throw new OperateError(
      'E_OPERATE_OUTCOME_NOT_READY',
      'Outcome windows must have ordered from/to timestamps.',
    );
  }
  if (Date.parse(input.baselineWindow.to) >= Date.parse(input.targetWindow.from)) {
    throw new OperateError(
      'E_OPERATE_OUTCOME_NOT_READY',
      'Outcome baseline and target windows must not overlap.',
    );
  }
  assertDirectionOperator(input.direction, input.operator);
  if (input.operator === 'between' && input.threshold.upperValue === undefined) {
    throw new OperateError(
      'E_OPERATE_OUTCOME_NOT_READY',
      'A between outcome requires threshold.upperValue.',
    );
  }
  if (Date.parse(input.verifyAfter) < Date.parse(input.targetWindow.to)) {
    throw new OperateError(
      'E_OPERATE_OUTCOME_NOT_READY',
      'Outcome verification cannot begin before the target window closes.',
    );
  }
  const now = input.createdAt ?? new Date().toISOString();
  const outcome: OperatingOutcome = {
    kind: 'operating-outcome',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    ...input,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  return assertOperatingArtifact('operating-outcome', outcome);
}

export async function evaluateOperatingOutcome(input: {
  outcome: OperatingOutcome;
  observationId: string;
  observedAt: string;
  window: { from: string; to: string };
  value: number | null;
  unit: string;
  queryIdentity: string;
  aggregation: OperatingOutcome['aggregation'];
  sampleSize: number;
  coverage: number;
  freshness: 'fresh' | 'stale' | 'unknown';
  guardrailValues: Record<string, number | null>;
  evidenceRefs: string[];
}): Promise<OperatingOutcomeObservation> {
  if (
    input.unit !== input.outcome.unit ||
    input.queryIdentity !== input.outcome.queryIdentity ||
    input.aggregation !== input.outcome.aggregation
  ) {
    throw new OperateError(
      'E_OPERATE_OUTCOME_NOT_READY',
      'Observation identity does not match the outcome contract.',
    );
  }
  if (
    input.window.from !== input.outcome.targetWindow.from ||
    input.window.to !== input.outcome.targetWindow.to ||
    Date.parse(input.observedAt) < Date.parse(input.outcome.verifyAfter)
  ) {
    throw new OperateError(
      'E_OPERATE_OUTCOME_NOT_READY',
      'Observation must cover the exact target window and occur at or after verifyAfter.',
    );
  }
  const guardrails = input.outcome.guardrails.map((guardrail) => {
    const observedValue = input.guardrailValues[guardrail.metric] ?? null;
    return {
      metric: guardrail.metric,
      breached:
        observedValue !== null &&
        compare(guardrail.operator, observedValue, {
          value: guardrail.threshold,
          ...(guardrail.upperThreshold === undefined
            ? {}
            : { upperValue: guardrail.upperThreshold }),
        }),
      observedValue,
    };
  });
  const insufficient =
    input.value === null ||
    input.sampleSize < input.outcome.minimumSample ||
    input.coverage < input.outcome.minimumCoverage ||
    input.freshness !== 'fresh';
  let evaluation: OperatingOutcomeObservation['evaluation'];
  if (insufficient) {
    evaluation = 'inconclusive';
  } else if (input.outcome.direction === 'maintain') {
    evaluation = (input.value as number) === input.outcome.threshold.value ? 'neutral' : 'negative';
  } else if (
    (input.outcome.operator === 'gt' || input.outcome.operator === 'lt') &&
    (input.value as number) === input.outcome.threshold.value
  ) {
    evaluation = 'neutral';
  } else {
    evaluation = compare(input.outcome.operator, input.value as number, input.outcome.threshold)
      ? 'positive'
      : 'negative';
  }
  if (
    input.outcome.guardrailPrecedence === 'block-on-breach' &&
    guardrails.some((guardrail) => guardrail.breached)
  ) {
    evaluation = 'negative';
  }
  const observation: OperatingOutcomeObservation = {
    kind: 'operating-outcome-observation',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    id: input.observationId,
    outcomeId: input.outcome.id,
    observedAt: input.observedAt,
    window: input.window,
    value: input.value,
    unit: input.unit,
    queryIdentity: input.queryIdentity,
    aggregation: input.aggregation,
    sampleSize: input.sampleSize,
    coverage: input.coverage,
    freshness: input.freshness,
    guardrails,
    evaluation,
    evidenceRefs: [...new Set(input.evidenceRefs)].sort(),
  };
  return assertOperatingArtifact('operating-outcome-observation', observation);
}

function nextGapId(state: OperatingState): string {
  const ordinal = state.dataGaps.reduce((maximum, gap) => {
    const match = gap.id.match(/^GAP-(\d+)$/);
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0);
  return `GAP-${String(ordinal + 1).padStart(3, '0')}`;
}

async function readOutcomeContract(
  projectRoot: string,
  outcomeId: string,
  localRoot?: string,
): Promise<OperatingOutcome> {
  const target = path.join(
    resolveOperatingPaths(projectRoot, { localRoot }).outcomes,
    `${outcomeId}.json`,
  );
  const raw = JSON.parse(await readFile(target, 'utf8')) as OperatingOutcome;
  return assertOperatingArtifact('operating-outcome', raw);
}

/**
 * Commits one immutable observation and derives its evaluation, learning, and
 * optional follow-up gap under the same event-head lease. Replays are
 * idempotent by observation ID.
 */
export async function recordOperatingOutcomeObservation(input: {
  projectRoot: string;
  observation: OperatingOutcomeObservation;
  localRoot?: string;
}): Promise<{ applied: boolean; state: OperatingState }> {
  const projectRoot = await assertOperatingProject(input.projectRoot);
  const observation = await assertOperatingArtifact<OperatingOutcomeObservation>(
    'operating-outcome-observation',
    input.observation,
  );
  const outcome = await readOutcomeContract(projectRoot, observation.outcomeId, input.localRoot);
  const verified = await evaluateOperatingOutcome({
    outcome,
    observationId: observation.id,
    observedAt: observation.observedAt,
    window: observation.window,
    value: observation.value,
    unit: observation.unit,
    queryIdentity: observation.queryIdentity,
    aggregation: observation.aggregation,
    sampleSize: observation.sampleSize,
    coverage: observation.coverage,
    freshness: observation.freshness,
    guardrailValues: Object.fromEntries(
      observation.guardrails.map((guardrail) => [
        guardrail.metric,
        guardrail.observedValue ?? null,
      ]),
    ),
    evidenceRefs: observation.evidenceRefs,
  });
  if (JSON.stringify(verified) !== JSON.stringify(observation)) {
    throw new OperateError(
      'E_OPERATE_OUTCOME_NOT_READY',
      `Observation ${observation.id} does not match the deterministic outcome evaluation.`,
    );
  }
  const store = new OperatingEventStore(projectRoot, { localRoot: input.localRoot });
  const initial = await store.replay();
  const registered = initial.events.find(
    (event) =>
      event.type === 'outcome.registered' && event.entityId === outcome.id && event.payload.record,
  );
  if (!registered || canonicalDigest(registered.payload.record) !== canonicalDigest(outcome)) {
    throw new OperateError(
      'E_OPERATE_OUTCOME_NOT_READY',
      `Outcome ${outcome.id} does not match its immutable registered contract.`,
    );
  }
  const config = await validateOperatingConfiguration(projectRoot);
  return withOperatingLock(
    projectRoot,
    {
      projectKey: operatingProjectKey(projectRoot),
      expectedEventHead: initial.eventHead,
      currentEventHead: initial.eventHead,
      localRoot: input.localRoot,
    },
    async (lock) => {
      const state = await store.state();
      if (!state.outcomes.some((candidate) => candidate.id === outcome.id)) {
        throw new OperateError(
          'E_OPERATE_OUTCOME_NOT_READY',
          `Outcome ${outcome.id} has not been registered by an applied route.`,
        );
      }
      let head = initial.eventHead;
      let applied = false;
      const existingObserved = initial.events.some(
        (event) =>
          event.type === 'outcome.observed' &&
          event.entityId === outcome.id &&
          event.payload.record &&
          (event.payload.record as { id?: string }).id === observation.id,
      );
      const existingEvaluated = initial.events.some(
        (event) =>
          event.type === 'outcome.evaluated' &&
          event.entityId === outcome.id &&
          event.correlationId === observation.id,
      );
      const existingLearning = initial.events.some(
        (event) => event.type === 'learning.recorded' && event.entityId === `LRN-${observation.id}`,
      );
      const existingGap = initial.events.some(
        (event) => event.type === 'gap.open' && event.correlationId === observation.id,
      );
      const append = async (
        type: 'outcome.observed' | 'outcome.evaluated' | 'learning.recorded' | 'gap.open',
        entityId: string,
        payload: Record<string, unknown>,
        evidenceRefs: string[] = [],
      ): Promise<void> => {
        const event = await store.append({
          type,
          cycleId: outcome.sourceCycle,
          entityId,
          payload,
          evidenceRefs,
          correlationId: observation.id,
          expectedHead: head.hash,
        });
        const next = { sequence: event.sequence, hash: event.eventHash };
        await lock.advanceEventHead(head, next);
        head = next;
        applied = true;
      };
      if (!existingObserved) {
        await append(
          'outcome.observed',
          outcome.id,
          { record: observation },
          observation.evidenceRefs,
        );
      }
      if (!existingEvaluated) {
        await append('outcome.evaluated', outcome.id, {
          evaluation: observation.evaluation,
        });
      }
      if (!existingLearning) {
        await append('learning.recorded', `LRN-${observation.id}`, {
          record: {
            id: `LRN-${observation.id}`,
            outcomeId: outcome.id,
            evaluation: observation.evaluation,
            summary: `${outcome.metric} evaluated as ${observation.evaluation}.`,
            createdAt: observation.observedAt,
          },
        });
      }
      const missing =
        observation.value === null ||
        observation.sampleSize < outcome.minimumSample ||
        observation.coverage < outcome.minimumCoverage;
      const needsGap =
        observation.evaluation === 'inconclusive' &&
        ((missing && outcome.missingPolicy === 'create-gap') ||
          (observation.freshness !== 'fresh' && outcome.stalePolicy === 'create-gap'));
      if (needsGap && !existingGap) {
        const gapId = nextGapId(state);
        await append(
          'gap.open',
          gapId,
          {
            record: {
              kind: 'operating-data-gap',
              schemaVersion: OPERATE_SCHEMA_VERSION,
              protocolVersion: OPERATE_PROTOCOL_VERSION,
              id: gapId,
              cycleId: outcome.sourceCycle,
              question: `What verified observation is required for ${outcome.metric}?`,
              reason: `Outcome ${outcome.id} was inconclusive because its observation was missing, stale, or below the minimum evidence threshold.`,
              unblocks: [outcome.specId],
              affectedRoles: [],
              status: 'open',
              owner: config.decisionOwner,
              evidenceRefs: observation.evidenceRefs,
              createdAt: observation.observedAt,
              updatedAt: observation.observedAt,
            },
          },
          observation.evidenceRefs,
        );
      }
      const nextState = await store.state();
      await store.writeCheckpoint(nextState);
      await persistOperatingProjections({
        projectRoot,
        localRoot: input.localRoot,
        state: nextState,
        revalidateEventHead: async () => (await store.replay()).eventHead,
      });
      return { applied, state: nextState };
    },
  );
}

/**
 * Imports validated observation envelopes dropped into the committed outcome
 * inbox. This is the zero-model reconciliation performed by review-only runs.
 */
export async function reconcileOperatingOutcomeFiles(input: {
  projectRoot: string;
  localRoot?: string;
}): Promise<{ reconciled: number; shipObserved: number; state: OperatingState }> {
  const projectRoot = await assertOperatingProject(input.projectRoot);
  const shipments = await reconcileOperatingShipObservations({
    projectRoot,
    localRoot: input.localRoot,
  });
  const store = new OperatingEventStore(projectRoot, { localRoot: input.localRoot });
  const inbox = path.join(
    resolveOperatingPaths(projectRoot, { localRoot: input.localRoot }).outcomes,
    'observations',
  );
  let reconciled = 0;
  let currentState = shipments.state;
  for (const name of (await readdir(inbox).catch(() => [])).sort()) {
    if (!name.endsWith('.json')) continue;
    const observation = JSON.parse(
      await readFile(path.join(inbox, name), 'utf8'),
    ) as OperatingOutcomeObservation;
    const outcome = currentState.outcomes.find(
      (candidate) => candidate.id === observation.outcomeId,
    );
    const linkedSpec = currentState.specLinks.find(
      (candidate) => candidate.specId === outcome?.specId,
    );
    if (outcome && linkedSpec?.state !== 'shipped') continue;
    const result = await recordOperatingOutcomeObservation({
      projectRoot,
      localRoot: input.localRoot,
      observation,
    });
    if (result.applied) reconciled += 1;
    currentState = result.state;
  }
  return {
    reconciled,
    shipObserved: shipments.observed,
    state: await store.state(),
  };
}
