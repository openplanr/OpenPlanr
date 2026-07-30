import { PipelineError } from '../pipeline/errors.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { canonicalizeJson, sha256Jcs } from '../protocol/jcs.mjs';

const ZERO_TIME = '1970-01-01T00:00:00.000Z';

const transitions = {
  cycle: {
    preparing: ['collecting', 'blocked', 'failed', 'cancelled'],
    collecting: ['advising', 'blocked', 'failed', 'cancelled'],
    advising: ['consolidating', 'blocked', 'failed', 'cancelled'],
    consolidating: ['reviewable', 'blocked', 'failed', 'cancelled'],
    reviewable: ['closed', 'blocked', 'failed', 'cancelled'],
    blocked: ['collecting', 'advising', 'consolidating', 'reviewable', 'cancelled'],
    failed: ['preparing', 'collecting', 'cancelled'],
    closed: [],
    cancelled: [],
  },
  finding: {
    proposed: ['accepted', 'rejected', 'superseded'],
    accepted: ['queued', 'rejected', 'superseded'],
    queued: ['in-progress', 'rejected', 'superseded'],
    'in-progress': ['done', 'superseded'],
    done: [],
    rejected: [],
    superseded: [],
  },
  decision: {
    open: ['answered', 'default-due', 'superseded'],
    answered: ['closed', 'superseded'],
    'default-due': ['answered', 'superseded'],
    closed: [],
    superseded: [],
  },
  gap: {
    open: ['answered', 'superseded'],
    answered: ['verified', 'superseded'],
    verified: ['closed', 'superseded'],
    closed: [],
    superseded: [],
  },
  route: {
    proposed: ['accepted'],
    accepted: ['prepared'],
    prepared: ['applied', 'failed'],
    failed: ['rolled_back'],
    applied: ['rolled_back'],
    rolled_back: [],
  },
};

const entityCollections = {
  cycle: 'cycles',
  finding: 'findings',
  decision: 'decisions',
  gap: 'dataGaps',
  route: 'routes',
};
const entitySchemas = {
  cycle: 'operating-cycle-manifest',
  finding: 'operating-finding',
  decision: 'operating-decision',
  gap: 'operating-data-gap',
  route: 'operating-route-plan',
};

function stateError(
  message,
  recovery = 'Run `planr operate integrity status`, then inspect or recover the cycle with `planr operate cycles recover`.',
) {
  return new PipelineError('E_OPERATE_STATE_INVALID', message, recovery);
}

function withoutEventHash(event) {
  const copy = structuredClone(event);
  delete copy.eventHash;
  return copy;
}

export function computeOperatingEventHash(event) {
  return sha256Jcs(withoutEventHash(event));
}

export function createOperatingEvent({
  eventId,
  timestamp,
  cycleId,
  type,
  entityId,
  actor,
  causationId = null,
  correlationId,
  evidenceRefs = [],
  payload = {},
}, {
  previousEvent = null,
  sequence = previousEvent ? previousEvent.sequence + 1 : 1,
} = {}) {
  const event = {
    kind: 'operating-event',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    eventId,
    sequence,
    timestamp,
    cycleId,
    type,
    entityId,
    previousEventHash: previousEvent?.eventHash ?? null,
    actor,
    causationId,
    correlationId,
    evidenceRefs: [...evidenceRefs],
    payload: structuredClone(payload),
  };
  event.eventHash = computeOperatingEventHash(event);
  assertProtocolArtifact('operating-event', event);
  return event;
}

export function verifyOperatingEventChain(events, {
  startingSequence = 0,
  startingHash = null,
} = {}) {
  let expectedSequence = startingSequence + 1;
  let expectedPrevious = startingHash;
  const eventIds = new Set();
  for (const event of events) {
    try {
      assertProtocolArtifact('operating-event', event);
    } catch (error) {
      throw stateError(`Event at sequence ${event?.sequence ?? '?'} is invalid: ${error.message}`);
    }
    if (eventIds.has(event.eventId)) throw stateError(`Duplicate operating event ID ${event.eventId}.`);
    eventIds.add(event.eventId);
    if (event.sequence !== expectedSequence) {
      throw stateError(`Expected event sequence ${expectedSequence}, received ${event.sequence}.`);
    }
    if (event.previousEventHash !== expectedPrevious) {
      throw stateError(`Event ${event.eventId} does not reference the verified previous event hash.`);
    }
    const actual = computeOperatingEventHash(event);
    if (actual !== event.eventHash) throw stateError(`Event ${event.eventId} failed its JCS hash check.`);
    expectedSequence += 1;
    expectedPrevious = event.eventHash;
  }
  return { sequence: expectedSequence - 1, hash: expectedPrevious };
}

function emptyState(generatedAt = ZERO_TIME) {
  return {
    kind: 'operating-state',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    generatedAt,
    eventHead: { sequence: 0, hash: null },
    cycles: [],
    findings: [],
    decisions: [],
    dataGaps: [],
    routes: [],
    specLinks: [],
    outcomes: [],
    learnings: [],
    evidenceSources: [],
    summary: {
      currentCycleId: null,
      currentConstraint: null,
      quiet: true,
      evidenceFreshness: 'unknown',
      surfacedFindings: 0,
      parkedFindings: 0,
      openDecisions: 0,
      openGaps: 0,
      stalledItems: 0,
    },
  };
}

function indexState(state) {
  return {
    cycles: new Map(state.cycles.map((record) => [record.id, structuredClone(record)])),
    findings: new Map(state.findings.map((record) => [record.id, structuredClone(record)])),
    decisions: new Map(state.decisions.map((record) => [record.id, structuredClone(record)])),
    dataGaps: new Map(state.dataGaps.map((record) => [record.id, structuredClone(record)])),
    routes: new Map(state.routes.map((record) => [record.id, structuredClone(record)])),
    specLinks: new Map(state.specLinks.map((record) => [record.specId, structuredClone(record)])),
    outcomes: new Map(state.outcomes.map((record) => [record.id, structuredClone(record)])),
    learnings: new Map(state.learnings.map((record) => [record.id, structuredClone(record)])),
    evidenceSources: new Map(state.evidenceSources.map((record) => [record.id, structuredClone(record)])),
  };
}

function requireRecord(event) {
  const record = event.payload?.record;
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw stateError(`${event.type} requires payload.record.`);
  }
  return record;
}

const projectionFields = {
  cycle: [
    'kind',
    'schemaVersion',
    'protocolVersion',
    'id',
    'state',
    'health',
    'depth',
    'focus',
    'inputDigest',
    'enabledRoles',
    'enabledProviders',
    'createdAt',
    'updatedAt',
    'completedAt',
    'producer',
    'warnings',
  ],
  finding: [
    'id',
    'cycleId',
    'title',
    'fingerprint',
    'category',
    'problem',
    'cost',
    'proposal',
    'status',
    'lane',
    'owner',
    'impact',
    'confidence',
    'confidenceCeiling',
    'ease',
    'score',
    'scoreAmendment',
    'severity',
    'sensitivity',
    'criticalOverride',
    'evidenceRefs',
    'linkedSpec',
    'parked',
    'stalledCycles',
    'rejectionReason',
    'supersededBy',
    'createdAt',
    'updatedAt',
  ],
  decision: ['id', 'cycleId', 'question', 'status', 'owner', 'deadline', 'reversibility', 'recommendation', 'selectedOption', 'note', 'createdAt', 'updatedAt'],
  gap: [
    'id',
    'cycleId',
    'question',
    'reason',
    'status',
    'owner',
    'answer',
    'unblocks',
    'affectedRoles',
    'createdAt',
    'updatedAt',
  ],
  route: [
    'id',
    'cycleId',
    'state',
    'routeDigest',
    'previewDigest',
    'confirmationDigest',
    'transactionId',
    'findingIds',
    'actionCount',
    'createdAt',
    'updatedAt',
  ],
};

function projectEntity(family, record) {
  const normalized = family === 'route' && Array.isArray(record.actions)
    ? {
      ...record,
      findingIds: [...new Set(record.actions.map((action) => action.findingId))].sort(),
      actionCount: record.actions.length,
    }
    : record;
  return Object.fromEntries(
    projectionFields[family]
      .filter((field) => normalized[field] !== undefined)
      .map((field) => [field, structuredClone(normalized[field])]),
  );
}

function assertRouteFindingIds(index, findingIds, cycleId, label) {
  for (const findingId of findingIds) {
    const finding = index.findings.get(findingId);
    if (!finding) {
      throw stateError(`${label} references unknown finding ${findingId}.`);
    }
    if (finding.cycleId !== cycleId) {
      throw stateError(
        `${label} references finding ${findingId} from cycle ${finding.cycleId}; expected ${cycleId}.`,
      );
    }
  }
}

function assertRouteFindingReferences(index, route, event) {
  const findingIds = [...new Set(route.actions.map((action) => action.findingId))].sort();
  assertRouteFindingIds(index, findingIds, event.cycleId, event.type);
}

function assertProjectedRouteFindingReferences(index) {
  for (const route of index.routes.values()) {
    assertRouteFindingIds(
      index,
      [...new Set(route.findingIds ?? [])].sort(),
      route.cycleId,
      `Route ${route.id}`,
    );
  }
}

function assertCycleDisposable(index, event) {
  const terminalFindingStates = new Set(['done', 'rejected', 'superseded']);
  const appliedFindingIds = new Set(
    [...index.routes.values()]
      .filter((route) => route.cycleId === event.cycleId && route.state === 'applied')
      .flatMap((route) => route.findingIds ?? []),
  );
  const blockingFindings = [...index.findings.values()]
    .filter(
      (finding) =>
        finding.cycleId === event.cycleId
        && finding.parked !== true
        && !terminalFindingStates.has(finding.status)
        && !appliedFindingIds.has(finding.id),
    )
    .map((finding) => finding.id)
    .sort();
  const terminalDecisionStates = new Set(['closed', 'superseded']);
  const blockingDecisions = [...index.decisions.values()]
    .filter(
      (decision) =>
        decision.cycleId === event.cycleId
        && !terminalDecisionStates.has(decision.status),
    )
    .map((decision) => decision.id)
    .sort();
  if (blockingFindings.length === 0 && blockingDecisions.length === 0) return;
  throw stateError(
    `${event.type} requires all surfaced findings and owner decisions to be disposed; `
      + `blocking findings: ${blockingFindings.join(', ') || 'none'}; `
      + `blocking decisions: ${blockingDecisions.join(', ') || 'none'}.`,
  );
}

const SENSITIVITY_RANK = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

function assertFindingPatchSensitivity(current, patch, event) {
  if (Object.hasOwn(patch, 'evidenceRefs')) {
    const currentRefs = [...current.evidenceRefs].sort();
    const nextRefs = Array.isArray(patch.evidenceRefs) ? [...patch.evidenceRefs].sort() : [];
    if (
      currentRefs.length !== nextRefs.length
      || currentRefs.some((reference, index) => reference !== nextRefs[index])
    ) {
      throw stateError(`${event.type} cannot alter derived finding evidence references.`);
    }
  }
  if (
    typeof patch.sensitivity === 'string'
    && SENSITIVITY_RANK[patch.sensitivity] < SENSITIVITY_RANK[current.sensitivity]
  ) {
    throw stateError(
      `${event.type} cannot lower finding sensitivity from ${current.sensitivity} to ${patch.sensitivity}.`,
    );
  }
}

function moveEntity(index, family, event, nextStatus) {
  const collection = entityCollections[family];
  const records = index[collection];
  let current = records.get(event.entityId);
  const initialStatus = Object.keys(transitions[family])[0];
  if (!current) {
    if (nextStatus !== initialStatus) {
      throw stateError(`${event.type} cannot create ${event.entityId} in ${nextStatus}; expected ${initialStatus}.`);
    }
    const record = requireRecord(event);
    assertProtocolArtifact(entitySchemas[family], record);
    if (family === 'route') assertRouteFindingReferences(index, record, event);
    current = projectEntity(family, record);
    if (current.id !== event.entityId) throw stateError(`${event.type} record ID does not match entityId.`);
    if (family !== 'cycle' && current.cycleId !== event.cycleId) {
      throw stateError(`${event.type} record cycleId does not match the event cycle.`);
    }
  } else {
    const stateKey = family === 'cycle' || family === 'route' ? 'state' : 'status';
    if (
      family === 'cycle'
      && current[stateKey] === 'cancelled'
      && nextStatus === 'cancelled'
      && Object.keys(event.payload ?? {}).length === 0
    ) {
      return;
    }
    const allowed = transitions[family][current[stateKey]] ?? [];
    if (!allowed.includes(nextStatus)) {
      throw stateError(`Invalid ${family} transition ${current.state ?? current.status} → ${nextStatus} for ${event.entityId}.`);
    }
    if (family === 'route') {
      if (event.payload?.routeDigest !== current.routeDigest) {
        throw stateError(`${event.type} does not match the proposed route digest.`);
      }
      if (event.type === 'route.prepared' && event.payload?.previewDigest !== current.previewDigest) {
        throw stateError('route.prepared does not match the proposed preview digest.');
      }
      if (
        event.type === 'route.applied'
        && event.payload?.confirmationDigest !== current.confirmationDigest
      ) {
        throw stateError('route.applied was not authorized by the accepted confirmation digest.');
      }
    }
    let patch = event.payload?.patch ?? {};
    if (family === 'finding') assertFindingPatchSensitivity(current, patch, event);
    if (family === 'cycle' && Array.isArray(event.payload?.warnings)) {
      patch = {
        ...patch,
        warnings: [...new Set([
          ...(Array.isArray(current.warnings) ? current.warnings : []),
          ...event.payload.warnings,
        ])],
      };
    }
    if (
      family === 'finding'
      && typeof event.payload?.reason === 'string'
      && event.payload.reason.length > 0
    ) {
      patch = event.type === 'finding.rejected'
        ? { ...patch, rejectionReason: event.payload.reason }
        : patch;
    }
    if (
      family === 'decision'
      && typeof event.payload?.reason === 'string'
      && event.payload.reason.length > 0
    ) {
      patch = { ...patch, note: event.payload.reason };
    }
    if (family === 'finding' && event.type === 'finding.accepted') {
      const amendment = event.payload?.scoreAmendment;
      if (!amendment || typeof amendment !== 'object' || Array.isArray(amendment)) {
        throw stateError('finding.accepted requires an auditable score amendment.');
      }
      if (
        event.actor.kind !== 'human'
        || amendment.actor?.kind !== 'human'
        || amendment.actor?.id !== event.actor.id
      ) {
        throw stateError('finding.accepted score amendment must identify the accepting human.');
      }
      if (amendment.timestamp !== event.timestamp) {
        throw stateError('finding.accepted score amendment timestamp must match the event.');
      }
      const prior = amendment.prior ?? {};
      if (
        prior.impact !== current.impact
        || prior.confidence !== current.confidence
        || prior.ease !== current.ease
      ) {
        throw stateError('finding.accepted score amendment does not match the prior score.');
      }
      const next = amendment.next ?? {};
      if (
        current.confidenceCeiling !== undefined
        && next.confidence > current.confidenceCeiling
      ) {
        throw stateError('finding.accepted confidence exceeds the evidence-derived ceiling.');
      }
      const score = next.impact * next.confidence * next.ease;
      if (patch.score !== undefined && patch.score !== score) {
        throw stateError('finding.accepted patch score does not match the amended score.');
      }
      patch = {
        ...patch,
        impact: next.impact,
        confidence: next.confidence,
        ease: next.ease,
        score,
        scoreAmendment: structuredClone(amendment),
      };
    }
    current = projectEntity(family, { ...current, ...patch });
    if (event.type === 'route.accepted') {
      current.confirmationDigest = event.payload.confirmationDigest;
    }
    if (event.type === 'route.applied') {
      current.transactionId = event.payload.transactionId;
    }
  }
  const statusKey = family === 'cycle' ? 'state' : family === 'route' ? 'state' : 'status';
  current[statusKey] = nextStatus;
  current.updatedAt = event.timestamp;
  if (!current.createdAt) current.createdAt = event.timestamp;
  records.set(event.entityId, current);
}

function updateSpecLink(index, event) {
  const record = requireRecord(event);
  assertProtocolArtifact('operating-spec-link', record);
  const specId = record.specId;
  const cycleId = record.sourceCycle;
  const findingId = record.sourceFinding;
  if (specId !== event.entityId) throw stateError('spec.linked record specId does not match entityId.');
  if (cycleId !== event.cycleId) throw stateError('spec.linked record cycleId does not match event cycleId.');
  index.specLinks.set(specId, {
    specId,
    cycleId,
    findingId,
    planningEngine: record.planningEngine,
    state: record.state ?? 'planned',
    ...(record.path ? { path: record.path } : {}),
    updatedAt: event.timestamp,
  });
  const finding = index.findings.get(findingId);
  if (finding) index.findings.set(finding.id, { ...finding, linkedSpec: specId, updatedAt: event.timestamp });
}

function updateOutcome(index, event) {
  const record = event.payload?.record;
  if (event.type === 'outcome.registered') {
    if (!record) throw stateError('outcome.registered requires payload.record.');
    assertProtocolArtifact('operating-outcome', record);
    if (record.id !== event.entityId) throw stateError(`${event.type} outcome ID does not match entityId.`);
    index.outcomes.set(record.id, {
      id: record.id,
      specId: record.specId,
      status: record.status,
      ...(record.metric ? { metric: record.metric } : {}),
      verifyAfter: record.verifyAfter,
      updatedAt: event.timestamp,
    });
    return;
  }
  if (event.type === 'outcome.observed') {
    if (!record) throw stateError('outcome.observed requires payload.record.');
    assertProtocolArtifact('operating-outcome-observation', record);
    if (record.outcomeId !== event.entityId) {
      throw stateError('outcome.observed outcomeId does not match entityId.');
    }
    const current = index.outcomes.get(event.entityId);
    if (!current) throw stateError(`outcome.observed references unknown outcome ${event.entityId}.`);
    index.outcomes.set(event.entityId, {
      ...current,
      status: 'observing',
      lastObservationId: record.id,
      lastObservationEvaluation: record.evaluation,
      updatedAt: event.timestamp,
    });
    return;
  }
  const current = index.outcomes.get(event.entityId);
  if (!current) throw stateError(`${event.type} references unknown outcome ${event.entityId}.`);
  index.outcomes.set(event.entityId, {
    ...current,
    ...(event.payload?.patch ?? {}),
    status: event.type === 'outcome.evaluated' ? event.payload?.evaluation ?? current.status : current.status,
    updatedAt: event.timestamp,
  });
}

function applyEvent(index, event) {
  if (event.type === 'security.discontinuity') {
    if (
      event.payload.authority.id !== event.actor.id
      || event.payload.authority.confirmedAt !== event.timestamp
    ) {
      throw stateError('security.discontinuity authority must match the confirmed human event.');
    }
    if (
      (event.payload.oldHead.sequence === 0) !== (event.payload.oldHead.hash === null)
    ) {
      throw stateError('security.discontinuity oldHead sequence and hash are inconsistent.');
    }
    return;
  }
  const [family, action] = event.type.split('.');
  if (transitions[family]) {
    if (family === 'cycle' && event.entityId !== event.cycleId) {
      throw stateError(`${event.type} entityId must match its cycleId.`);
    }
    if (event.type === 'cycle.closed') assertCycleDisposable(index, event);
    moveEntity(index, family, event, action);
    return;
  }
  if (event.type === 'evidence.collected') {
    for (const source of event.payload?.sources ?? []) {
      index.evidenceSources.set(source.id, {
        id: source.id,
        freshness: source.freshness,
        status: source.status,
        itemCount: source.itemCount,
        collectedAt: event.timestamp,
      });
    }
    return;
  }
  if (event.type === 'spec.linked') {
    updateSpecLink(index, event);
    return;
  }
  if (event.type === 'ship.observed') {
    const specId = event.payload?.specId;
    const current = index.specLinks.get(specId);
    if (!current) throw stateError(`ship.observed references unknown spec ${specId}.`);
    index.specLinks.set(specId, { ...current, state: 'shipped', updatedAt: event.timestamp });
    return;
  }
  if (
    event.type === 'outcome.registered' ||
    event.type === 'outcome.observed' ||
    event.type === 'outcome.evaluated'
  ) {
    updateOutcome(index, event);
    return;
  }
  if (event.type === 'learning.recorded') {
    const record = requireRecord(event);
    if (record.id !== event.entityId) throw stateError('learning.recorded record ID does not match entityId.');
    index.learnings.set(record.id, {
      id: record.id,
      outcomeId: record.outcomeId,
      evaluation: record.evaluation,
      summary: record.summary,
      createdAt: record.createdAt ?? event.timestamp,
    });
    return;
  }
  if (event.type === 'migration.legacy-imported') {
    // Legacy imports are audit-only. Their content-addressed records and
    // migration manifest are queried separately and never mutate projections.
    return;
  }
}

function sortRecords(map, key = 'id') {
  return [...map.values()].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}

function deriveSummary(state) {
  const activeCycles = state.cycles.filter((cycle) => !['closed', 'cancelled'].includes(cycle.state));
  const currentCycle = [...(activeCycles.length ? activeCycles : state.cycles)]
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
    .at(-1) ?? null;
  const activeFindings = state.findings.filter((finding) => ['proposed', 'accepted', 'queued', 'in-progress'].includes(finding.status));
  const critical = activeFindings
    .filter((finding) => finding.criticalOverride || finding.severity === 'critical')
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0];
  const blocked = currentCycle?.state === 'blocked';
  const freshness = new Set(state.evidenceSources.map((source) => source.freshness));
  const evidenceFreshness = freshness.size === 0
    ? 'unknown'
    : freshness.size === 1
      ? [...freshness][0]
      : 'mixed';
  return {
    currentCycleId: currentCycle?.id ?? null,
    currentConstraint: critical?.title ?? (blocked ? `Operating cycle ${currentCycle.id} is blocked` : null),
    quiet: Boolean(currentCycle?.health === 'quiet' || activeFindings.length === 0),
    evidenceFreshness,
    surfacedFindings: state.findings.filter((finding) => !finding.parked).length,
    parkedFindings: state.findings.filter((finding) => finding.parked).length,
    openDecisions: state.decisions.filter((decision) => ['open', 'default-due'].includes(decision.status)).length,
    openGaps: state.dataGaps.filter((gap) => ['open', 'answered', 'verified'].includes(gap.status)).length,
    stalledItems: state.findings.filter((finding) => (finding.stalledCycles ?? 0) >= 2).length,
  };
}

function materialize(index, generatedAt, eventHead) {
  const state = {
    ...emptyState(generatedAt),
    generatedAt,
    eventHead,
    cycles: sortRecords(index.cycles),
    findings: sortRecords(index.findings),
    decisions: sortRecords(index.decisions),
    dataGaps: sortRecords(index.dataGaps),
    routes: sortRecords(index.routes),
    specLinks: sortRecords(index.specLinks, 'specId'),
    outcomes: sortRecords(index.outcomes),
    learnings: sortRecords(index.learnings),
    evidenceSources: sortRecords(index.evidenceSources),
  };
  state.summary = deriveSummary(state);
  assertProtocolArtifact('operating-state', state);
  return state;
}

export function reduceOperatingEvents(events, {
  checkpoint = null,
  verifyCheckpointSignature = null,
} = {}) {
  let base = emptyState();
  let startingSequence = 0;
  let startingHash = null;
  if (checkpoint) {
    validateOperatingCheckpoint(checkpoint, {
      verifySignature: verifyCheckpointSignature,
    });
    base = structuredClone(checkpoint.state);
    startingSequence = checkpoint.eventHead.sequence;
    startingHash = checkpoint.eventHead.hash;
  }
  const eventHead = verifyOperatingEventChain(events, { startingSequence, startingHash });
  const index = indexState(base);
  assertProjectedRouteFindingReferences(index);
  for (const event of events) applyEvent(index, event);
  const generatedAt = events.at(-1)?.timestamp ?? base.generatedAt;
  return materialize(index, generatedAt, eventHead);
}

export function createOperatingCheckpoint(state, {
  createdAt = state.generatedAt,
  recordDigests = [],
  signer = null,
} = {}) {
  assertProtocolArtifact('operating-state', state);
  const checkpoint = {
    kind: 'operating-checkpoint',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    createdAt,
    eventHead: structuredClone(state.eventHead),
    recordDigests: [...recordDigests].sort(),
    stateHash: sha256Jcs(state),
    integrity: {
      status: signer ? 'signed' : 'hash',
    },
    state: structuredClone(state),
  };
  if (signer) {
    if (typeof signer !== 'function') {
      throw stateError('Operating checkpoint signer must be a function.');
    }
    const signature = signer(createOperatingCheckpointSigningPayload(checkpoint));
    if (!signature || typeof signature !== 'object') {
      throw stateError('Operating checkpoint signer did not return a signature.');
    }
    checkpoint.integrity.signature = structuredClone(signature);
  }
  assertProtocolArtifact('operating-checkpoint', checkpoint);
  return checkpoint;
}

/**
 * Return the exact JCS payload covered by a checkpoint signature. The signature
 * itself is excluded while the signed integrity status remains bound.
 */
export function createOperatingCheckpointSigningPayload(checkpoint) {
  const payload = structuredClone(checkpoint);
  if (payload?.integrity) delete payload.integrity.signature;
  return canonicalizeJson(payload);
}

export function validateOperatingCheckpoint(checkpoint, {
  verifySignature = null,
  requireSignatureVerification = false,
} = {}) {
  assertProtocolArtifact('operating-checkpoint', checkpoint);
  assertProtocolArtifact('operating-state', checkpoint.state);
  if (
    checkpoint.eventHead.sequence !== checkpoint.state.eventHead.sequence
    || checkpoint.eventHead.hash !== checkpoint.state.eventHead.hash
  ) {
    throw stateError('Operating checkpoint event head does not match its embedded state.');
  }
  if (sha256Jcs(checkpoint.state) !== checkpoint.stateHash) {
    throw stateError('Operating checkpoint state failed its JCS hash check.');
  }
  if (checkpoint.integrity.status === 'signed') {
    if (verifySignature !== null && typeof verifySignature !== 'function') {
      throw stateError('Operating checkpoint signature verifier must be a function.');
    }
    if (verifySignature) {
      const verified = verifySignature(
        createOperatingCheckpointSigningPayload(checkpoint),
        structuredClone(checkpoint.integrity.signature),
      );
      if (verified !== true) {
        throw stateError('Operating checkpoint external signature is invalid.');
      }
    } else if (requireSignatureVerification) {
      throw stateError('Operating checkpoint signature requires an external verifier.');
    }
  }
  return checkpoint;
}

export function resumeOperatingProjection(checkpoint, tailEvents, {
  verifyCheckpointSignature = null,
} = {}) {
  return reduceOperatingEvents(tailEvents, {
    checkpoint,
    verifyCheckpointSignature,
  });
}
