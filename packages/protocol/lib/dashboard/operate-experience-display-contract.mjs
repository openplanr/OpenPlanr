import { validateJson } from '../../src/json-schema.mjs';
import {
  contentHash,
  deepFreeze,
  exactEventHead,
  exactJson,
  jcsHash,
  safeDataClone,
  withoutContentHash,
} from './closed-json-contract.mjs';
import {
  OPERATE_ACTION_DISPLAY_WORKSPACE_SCHEMA as actionDisplayWorkspaceSchema,
  OPERATE_ALLOWED_ACTION_SCHEMA as allowedActionSchema,
  OPERATE_API_ENVELOPE_SCHEMA as apiEnvelopeSchema,
  OPERATE_CYCLE_DISPLAY_WORKSPACE_SCHEMA as cycleDisplayWorkspaceSchema,
  OPERATE_EXECUTIVE_BOARD_DISPLAY_SURFACE_SCHEMA as executiveBoardDisplaySurfaceSchema,
  OPERATE_RECOVERY_DISPLAY_SURFACE_SCHEMA as recoveryDisplaySurfaceSchema,
  OPERATE_EXPERIENCE_DISPLAY_SURFACE_SCHEMA as displaySurfaceSchema,
  OPERATE_EXPERIENCE_PREVIEW_SCHEMA as experiencePreviewSchema,
  OPERATE_EXPERIENCE_SURFACE_SCHEMA as surfaceSchema,
  OPERATE_EXPERIENCE_VIEW_SCHEMA as experienceViewSchema,
  OPERATE_REVIEW_DISPLAY_WORKSPACE_SCHEMA as reviewWorkspaceSchema,
  OPERATING_FINDING_SCHEMA as findingSchema,
  OPERATING_DELIVERY_ROUTE_SCHEMA as deliveryRouteSchema,
  OPERATING_EVIDENCE_RESOLUTION_SCHEMA as evidenceResolutionSchema,
  OPERATING_EXECUTION_RESULT_SCHEMA as executionResultSchema,
  OPERATING_GOVERNED_OPERATION_SCHEMA as governedOperationSchema,
  OPERATING_REVIEW_SCHEMA as reviewSchema,
  OPERATING_TRACE_MATRIX_SCHEMA as traceMatrixSchema,
  OPERATING_WORK_LEDGER_SCHEMA as workLedgerSchema,
} from './generated/operate-experience-surface-schema-data.mjs';
import { assertOperateExperienceSurfaceV1 } from './operate-experience-surface-contract.mjs';

const DISPLAY_SURFACE_DOMAIN = 'openplanr:operate-experience-display-surface:1.0.0';
const CYCLE_WORKSPACE_DOMAIN = 'openplanr:operate-cycle-display-workspace:1.0.0';
const EXECUTIVE_BOARD_DISPLAY_DOMAIN = 'openplanr:operate-executive-board-display-surface:1.0.0';
export const ACTION_WORKSPACE_DOMAIN = 'openplanr:operate-action-display-workspace:1.0.0';
export const RECOVERY_DISPLAY_DOMAIN = 'openplanr:operate-recovery-display-surface:1.0.0';
const ACTION_WORKSPACE_BOUNDARIES = Object.freeze({
  approvalExecution:
    'Named approval satisfies only its exact version-bound requirement. Execution receives a fresh authority check.',
  verification:
    'Outcome verification remains separate. No success claim appears before accepted evidence.',
  retry:
    'An effect may have occurred. Only Inspect, Reconcile, custody restoration, or an explicit runtime recovery route is legal.',
});
const DISPLAY_SURFACES = new Set(['today', 'inbox', 'cycles', 'cycle', 'actions']);
const STAGE_ORDER = Object.freeze([
  'observe',
  'understand',
  'decide',
  'govern',
  'act',
  'verify',
  'learn',
]);
const ACTIVE_CYCLE_STAGE = Object.freeze({
  created: 0,
  observing: 0,
  advising: 1,
  challenging: 1,
  synthesizing: 1,
  awaiting_review: 2,
  approved: 3,
  executing: 4,
  verifying: 5,
  closed: 6,
  blocked: 0,
  failed: 0,
  cancelled: 0,
});
const CYCLE_STATES = new Set([
  ...Object.keys(ACTIVE_CYCLE_STAGE),
  'closed',
  'blocked',
  'failed',
  'cancelled',
]);
const CYCLE_HEALTH = new Set(['normal', 'quiet', 'partial', 'blocked']);
const PERSISTENT_RELATIONS = Object.freeze(['source', 'touched', 'carried-forward']);
const PERSISTENT_ID = Object.freeze({
  finding: /^fnd_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u,
  decision: /^dec_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u,
  action: /^act_[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u,
});
const PERSISTENT_STATE = Object.freeze({
  finding: new Set(['open', 'accepted', 'resolved', 'rejected', 'deferred', 'superseded']),
  decision: new Set(['proposed', 'approved', 'rejected', 'deferred', 'superseded']),
  action: new Set([
    'proposed',
    'approved',
    'queued',
    'in_progress',
    'completed',
    'blocked',
    'rejected',
    'deferred',
    'cancelled',
  ]),
});

const schemas = new Map([
  ['operate-experience-display-surface.schema.json', displaySurfaceSchema],
  ['operate-action-display-workspace.schema.json', actionDisplayWorkspaceSchema],
  ['operate-cycle-display-workspace.schema.json', cycleDisplayWorkspaceSchema],
  ['operate-executive-board-display-surface.schema.json', executiveBoardDisplaySurfaceSchema],
  ['operate-recovery-display-surface.schema.json', recoveryDisplaySurfaceSchema],
  ['operate-experience-surface.schema.json', surfaceSchema],
  ['operate-experience-view.schema.json', experienceViewSchema],
  ['operate-review-display-workspace.schema.json', reviewWorkspaceSchema],
  ['operating-finding.schema.json', findingSchema],
  ['operate-experience-preview.schema.json', experiencePreviewSchema],
  ['operate-api-envelope.schema.json', apiEnvelopeSchema],
  ['operate-allowed-action.schema.json', allowedActionSchema],
  ['operating-work-ledger.schema.json', workLedgerSchema],
  ['operating-delivery-route.schema.json', deliveryRouteSchema],
  ['operating-evidence-resolution.schema.json', evidenceResolutionSchema],
  ['operating-execution-result.schema.json', executionResultSchema],
  ['operating-governed-operation.schema.json', governedOperationSchema],
  ['operating-review.schema.json', reviewSchema],
  ['operating-trace-matrix.schema.json', traceMatrixSchema],
]);

function jsonPointer(root, fragment) {
  if (!fragment || fragment === '#') return root;
  if (!fragment.startsWith('#/')) return null;
  return fragment
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, part) => value?.[part], root);
}

function resolveSchemaRef(reference) {
  const [path, pointer = ''] = reference.split('#');
  const filename = path.split('/').at(-1);
  const rootSchema = schemas.get(filename);
  if (!rootSchema) return null;
  return {
    schema: jsonPointer(rootSchema, pointer ? `#${pointer}` : '#'),
    rootSchema,
    base: filename,
  };
}

function validationFailure() {
  return [
    {
      path: '$',
      rule: 'closedContract',
      detail: 'does not satisfy the closed display contract',
    },
  ];
}

function exactKeys(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function exactExpectedBinding(
  payload,
  expected,
  { workspace = false, executiveBoard = false, action = false, recovery = false } = {},
) {
  if (!expected) return true;
  if (
    payload.actorId !== expected.actorId ||
    payload.scopeId !== expected.scopeId ||
    payload.domainId !== expected.domainId ||
    payload.domainVersion !== expected.domainVersion ||
    payload.generatedAt !== expected.generatedAt ||
    payload.viewHash !== expected.viewHash ||
    !exactEventHead(payload.eventHead, expected.eventHead)
  )
    return false;
  if (!workspace) {
    if (expected.surface !== undefined && payload.surface !== expected.surface) return false;
    if (payload.surface === 'inbox' || payload.surface === 'actions') {
      return (
        expected.surface === payload.surface &&
        typeof expected.projectId === 'string' &&
        Number.isSafeInteger(expected.generation) &&
        payload.data.requestBinding.projectId === expected.projectId &&
        payload.data.requestBinding.generation === expected.generation &&
        (payload.surface !== 'inbox' ||
          payload.data.requestBinding.subjectId === expected.subjectId) &&
        (payload.surface !== 'actions' ||
          (expected.subjectId === null &&
            typeof expected.cycleId === 'string' &&
            expected.cycleId.length > 0))
      );
    }
    if (payload.surface === 'cycle') {
      const committedCycleId = payload.data.cycle.cycleId;
      if (
        typeof expected.subjectId !== 'string' ||
        typeof expected.cycleId !== 'string' ||
        expected.subjectId !== committedCycleId ||
        expected.cycleId !== committedCycleId
      )
        return false;
    }
    return true;
  }
  if (executiveBoard) {
    return expected.cycleId === payload.data.cycleId && expected.subjectId === payload.data.cycleId;
  }
  if (action) {
    return (
      expected.subjectId === payload.data.action.actionId &&
      expected.actionId === payload.data.action.actionId
    );
  }
  if (recovery) return true;
  return (
    expected.cycleId === payload.data.cycle.cycleId &&
    expected.subjectId === payload.data.cycle.cycleId
  );
}

function validCycleLifecycle(cycle) {
  if (
    !cycle ||
    typeof cycle !== 'object' ||
    !CYCLE_STATES.has(cycle.state) ||
    !CYCLE_HEALTH.has(cycle.health) ||
    !Array.isArray(cycle.stages) ||
    cycle.stages.length !== STAGE_ORDER.length ||
    !cycle.stages.every((stage, index) => stage.id === STAGE_ORDER[index])
  )
    return false;
  const current = ACTIVE_CYCLE_STAGE[cycle.state];
  return cycle.stages.every((stage, index) => {
    let expected = index < current ? 'complete' : index === current ? 'current' : 'waiting';
    if (cycle.state === 'closed') expected = 'complete';
    if (index === current && ['blocked', 'failed'].includes(cycle.state)) {
      expected = cycle.state;
    }
    if (index === current && cycle.state === 'cancelled') expected = 'skipped';
    const reason = ['blocked', 'failed', 'skipped'].includes(expected)
      ? `Cycle is ${cycle.state}.`
      : null;
    return stage.state === expected && stage.reason === reason;
  });
}

function validDisplaySurfaceSemantics(value, expected) {
  const payload = value.payload;
  if (
    !DISPLAY_SURFACES.has(payload.surface) ||
    value.integrity.sourceViewHash !== payload.viewHash ||
    payload.truthSummary.sourceViewHash !== payload.viewHash ||
    !exactEventHead(payload.truthSummary.sourceEventHead, payload.eventHead) ||
    !exactExpectedBinding(payload, expected)
  )
    return false;
  if (payload.surface === 'inbox') {
    const items = payload.data.inbox;
    const subjectId = payload.data.requestBinding.subjectId;
    return (
      Array.isArray(items) &&
      new Set(items.map((item) => item.itemId)).size === items.length &&
      (subjectId === null || (items.length === 1 && items[0].itemId === subjectId)) &&
      items.every(
        (item, index) =>
          index === 0 ||
          Number(items[index - 1].blocking) > Number(item.blocking) ||
          (Number(items[index - 1].blocking) === Number(item.blocking) &&
            items[index - 1].itemId.localeCompare(item.itemId) < 0),
      )
    );
  }
  if (payload.surface === 'actions') {
    const items = payload.data.actions;
    return (
      Array.isArray(items) && new Set(items.map((item) => item.actionId)).size === items.length
    );
  }
  const cycles =
    payload.surface === 'today'
      ? payload.data.activeCycle === null
        ? []
        : [payload.data.activeCycle]
      : payload.surface === 'cycles'
        ? payload.data.cycles
        : [payload.data.cycle];
  return (
    new Set(cycles.map((cycle) => cycle.cycleId)).size === cycles.length &&
    cycles.every(validCycleLifecycle)
  );
}

function validPersistentItem(value, kind) {
  return (
    exactKeys(value, ['kind', 'subjectId', 'state', 'relations']) &&
    value.kind === kind &&
    typeof value.subjectId === 'string' &&
    PERSISTENT_ID[kind].test(value.subjectId) &&
    typeof value.state === 'string' &&
    PERSISTENT_STATE[kind].has(value.state) &&
    Array.isArray(value.relations) &&
    value.relations.length >= 1 &&
    value.relations.length <= PERSISTENT_RELATIONS.length &&
    value.relations.every((relation) => PERSISTENT_RELATIONS.includes(relation)) &&
    new Set(value.relations).size === value.relations.length
  );
}

function validCycleLink(value) {
  return (
    exactKeys(value, ['entityKind', 'entityId', 'cycleId', 'relation']) &&
    PERSISTENT_ID[value.entityKind]?.test(value.entityId) === true &&
    typeof value.cycleId === 'string' &&
    PERSISTENT_RELATIONS.includes(value.relation)
  );
}

function validPersistentGraph(persistent, cycleId) {
  const items = [...persistent.findings, ...persistent.decisions, ...persistent.actions];
  const itemKeys = items.map((item) => `${item.kind}:${item.subjectId}`);
  const linkKeys = persistent.cycleLinks.map(
    (link) => `${link.entityKind}:${link.entityId}:${link.cycleId}:${link.relation}`,
  );
  if (
    new Set(itemKeys).size !== itemKeys.length ||
    new Set(linkKeys).size !== linkKeys.length ||
    persistent.cycleLinks.some(
      (link) =>
        link.cycleId !== cycleId ||
        !items.some((item) => item.kind === link.entityKind && item.subjectId === link.entityId),
    )
  )
    return false;
  return items.every((item) =>
    exactJson(
      item.relations,
      persistent.cycleLinks
        .filter((link) => link.entityKind === item.kind && link.entityId === item.subjectId)
        .map((link) => link.relation),
    ),
  );
}

function validAllowedAction(value, cycleId) {
  return (
    exactKeys(value, ['tool', 'arguments', 'label', 'effect']) &&
    value.tool === 'operate.cycle.get' &&
    exactKeys(value.arguments, ['cycleId']) &&
    value.arguments.cycleId === cycleId &&
    typeof value.label === 'string' &&
    value.label.length > 0 &&
    value.label.length <= 256 &&
    !/(?:<[^>]+>|\{\{[^}]+\}\})/u.test(value.label) &&
    value.effect === 'read-only'
  );
}

function outcomeCarriesAffirmativeProof(outcome) {
  const verification = outcome.verification;
  const metric = outcome.metric;
  return (
    ['succeeded', 'failed'].includes(outcome.status) &&
    outcome.accessReason === null &&
    outcome.observationIds.length > 0 &&
    outcome.evidenceRefIds.length > 0 &&
    metric !== null &&
    metric.observed !== null &&
    metric.freshness === 'current' &&
    verification !== null &&
    verification.accessReason === null &&
    outcome.verificationPlanId === verification.verificationPlanId &&
    metric.metricId === verification.metricId &&
    metric.metricHash === verification.metricHash
  );
}

function validOutcomeLearningGraph(persistent, cycle, verification, truthSummary) {
  const actionIds = persistent.actions.map((action) => action.subjectId);
  const outcomeIds = persistent.outcomes.map((outcome) => outcome.outcomeId);
  const learningIds = persistent.learnings.map((learning) => learning.learningId);
  if (
    new Set(outcomeIds).size !== outcomeIds.length ||
    new Set(learningIds).size !== learningIds.length ||
    persistent.outcomes.some((outcome) => !actionIds.includes(outcome.actionId)) ||
    persistent.learnings.some((learning) => !outcomeIds.includes(learning.outcomeId))
  )
    return false;
  const expected =
    truthSummary.proof.status === 'verified'
      ? 'verified'
      : truthSummary.proof.status === 'not-required'
        ? 'not-required'
        : 'unverified';
  const reasonCodes =
    expected === 'unverified'
      ? truthSummary.proof.reasonCodes.length > 0
        ? truthSummary.proof.reasonCodes
        : ['OPERATE_VERIFICATION_EVIDENCE_MISSING']
      : [];
  return verification.status === expected && exactJson(verification.reasonCodes, reasonCodes);
}

function workspaceSurface(payload, surface, data) {
  return {
    ok: true,
    kind: 'operate-experience-surface',
    schemaVersion: '1.0.0',
    protocolVersion: payload.protocolVersion,
    surface,
    readOnly: true,
    mutationEnabled: payload.status === 'ready',
    scopeId: payload.scopeId,
    domainId: payload.domainId,
    domainVersion: payload.domainVersion,
    actorId: payload.actorId,
    accessLevel: payload.accessLevel,
    generatedAt: payload.generatedAt,
    eventHead: payload.eventHead,
    viewHash: payload.viewHash,
    truthSummary: payload.truthSummary,
    status: payload.status,
    reasonCodes: payload.reasonCodes,
    data,
  };
}

function validWorkspacePayload(payload) {
  const data = payload.data;
  if (
    !exactKeys(data.ownerCycle, [
      'cycleId',
      'scopeId',
      'domainId',
      'domainVersion',
      'state',
      'health',
      'focus',
      'createdAt',
      'updatedAt',
    ]) ||
    !Array.isArray(data.persistentWork.findings) ||
    !data.persistentWork.findings.every((item) => validPersistentItem(item, 'finding')) ||
    !Array.isArray(data.persistentWork.decisions) ||
    !data.persistentWork.decisions.every((item) => validPersistentItem(item, 'decision')) ||
    !Array.isArray(data.persistentWork.actions) ||
    !data.persistentWork.actions.every((item) => validPersistentItem(item, 'action')) ||
    !Array.isArray(data.persistentWork.cycleLinks) ||
    !data.persistentWork.cycleLinks.every(validCycleLink) ||
    !Array.isArray(data.persistentWork.outcomes) ||
    !Array.isArray(data.persistentWork.learnings) ||
    data.allowedActions.length !== 1
  )
    return false;
  try {
    const cycle = data.cycle;
    const schemaCycle = {
      ...cycle,
      assignments: cycle.assignments.map((assignment) =>
        assignment.deepLink === null ? { ...assignment, deepLink: cycle.deepLink } : assignment,
      ),
    };
    const schemaOutcomes = data.persistentWork.outcomes.map((outcome) =>
      outcome.deepLink === null
        ? {
            ...outcome,
            deepLink: `#/operate/outcomes/${encodeURIComponent(outcome.outcomeId)}`,
          }
        : outcome,
    );
    assertOperateExperienceSurfaceV1(workspaceSurface(payload, 'cycle', { cycle: schemaCycle }));
    assertOperateExperienceSurfaceV1(
      workspaceSurface(payload, 'outcomes', {
        domainMetrics: [],
        outcomes: schemaOutcomes,
        learnings: data.persistentWork.learnings,
      }),
    );
    assertOperateExperienceSurfaceV1(
      workspaceSurface(payload, 'history', {
        history: [],
        replay: data.replay,
      }),
    );
    const sourceActionIds = data.persistentWork.actions
      .filter((action) => action.relations.includes('source'))
      .map((action) => action.subjectId);
    return (
      validCycleLifecycle(cycle) &&
      data.ownerCycle.cycleId === cycle.cycleId &&
      data.ownerCycle.scopeId === payload.scopeId &&
      data.ownerCycle.domainId === payload.domainId &&
      data.ownerCycle.domainVersion === payload.domainVersion &&
      data.ownerCycle.state === cycle.state &&
      data.ownerCycle.health === cycle.health &&
      exactJson(data.ownerCycle.focus, cycle.focus) &&
      data.ownerCycle.createdAt === cycle.createdAt &&
      data.ownerCycle.updatedAt === cycle.updatedAt &&
      cycle.deepLink === `#/operate/cycles/${encodeURIComponent(cycle.cycleId)}` &&
      exactEventHead(data.replay.finalHead, payload.eventHead) &&
      exactJson(cycle.replayCheckpoint, data.replay.checkpoint) &&
      exactJson(cycle.persistentActionIds, sourceActionIds) &&
      validPersistentGraph(data.persistentWork, cycle.cycleId) &&
      validOutcomeLearningGraph(
        data.persistentWork,
        cycle,
        data.verification,
        payload.truthSummary,
      ) &&
      validAllowedAction(data.allowedActions[0], cycle.cycleId)
    );
  } catch {
    return false;
  }
}

function validWorkspaceSemantics(value, expected) {
  return (
    value.integrity.sourceViewHash === value.payload.viewHash &&
    value.payload.truthSummary.sourceViewHash === value.payload.viewHash &&
    exactEventHead(value.payload.truthSummary.sourceEventHead, value.payload.eventHead) &&
    exactExpectedBinding(value.payload, expected, { workspace: true }) &&
    validWorkspacePayload(value.payload)
  );
}

function validateDisplay(value, schema, base, semantics, expected) {
  try {
    const clone = safeDataClone(value);
    const errors = validateJson(clone, schema, {
      base,
      resolveRef: resolveSchemaRef,
    });
    if (errors.length > 0 || !semantics(clone, expected)) return validationFailure();
    const expectedHash = contentHash(withoutContentHash(clone), clone.integrity.domain);
    return clone.integrity.contentHash === expectedHash ? [] : validationFailure();
  } catch {
    return validationFailure();
  }
}

export function validateOperateExperienceDisplaySurfaceV1(value, expected) {
  return validateDisplay(
    value,
    displaySurfaceSchema,
    'schemas/v1.2.0/operate-experience-display-surface.schema.json',
    validDisplaySurfaceSemantics,
    expected,
  );
}

export function assertOperateExperienceDisplaySurfaceV1(value, expected) {
  if (validateOperateExperienceDisplaySurfaceV1(value, expected).length > 0) {
    const error = new TypeError(
      'The Operate display surface does not satisfy its closed integrity contract.',
    );
    error.code = 'E_OPERATE_EXPERIENCE_DISPLAY_INVALID';
    throw error;
  }
  return value;
}

function exactExpectedPreview(value, expected) {
  if (!expected) return true;
  return (
    value.actorId === expected.actorId &&
    value.scopeId === expected.scopeId &&
    value.domainId === expected.domainId &&
    value.domainVersion === expected.domainVersion &&
    exactEventHead(value.eventHead, expected.eventHead) &&
    value.sourceViewHash === expected.sourceViewHash &&
    value.subject.id === expected.subjectId &&
    value.actionDigest === expected.actionDigest
  );
}

function validPreviewTransition(transition) {
  if (
    new Set(transition.targets.map((target) => `${target.kind}:${target.id}`)).size !==
    transition.targets.length
  )
    return false;
  if (transition.kind !== 'approval') return transition.threshold === null;
  const threshold = transition.threshold;
  if (
    threshold === null ||
    threshold.recorded > threshold.required ||
    threshold.remaining !== threshold.required - threshold.recorded
  )
    return false;
  return threshold.remaining === 0
    ? transition.nextState === 'threshold-satisfied'
    : transition.nextState === 'recorded-parties-remain';
}

export function validateOperateExperiencePreviewV1(value, expected) {
  try {
    const clone = safeDataClone(value);
    const errors = validateJson(clone, experiencePreviewSchema, {
      base: 'schemas/v2.0.0/operate-experience-preview.schema.json',
      resolveRef: resolveSchemaRef,
    });
    if (
      errors.length > 0 ||
      !exactExpectedPreview(clone, expected) ||
      !validPreviewTransition(clone.transition)
    )
      return errors.length > 0 ? errors : validationFailure();
    const base = safeDataClone(clone);
    delete base.previewHash;
    if (clone.actionDigest !== jcsHash(clone.allowedAction) || clone.previewHash !== jcsHash(base))
      return validationFailure();
    return [];
  } catch {
    return validationFailure();
  }
}

export function assertOperateExperiencePreviewV1(value, expected) {
  if (validateOperateExperiencePreviewV1(value, expected).length > 0) {
    const error = new TypeError(
      'The Operate preview does not satisfy its closed integrity contract.',
    );
    error.code = 'E_OPERATE_EXPERIENCE_PREVIEW_INVALID';
    throw error;
  }
  return deepFreeze(safeDataClone(value));
}

export function validateOperateCycleDisplayWorkspaceV1(value, expected) {
  return validateDisplay(
    value,
    cycleDisplayWorkspaceSchema,
    'schemas/v1.2.0/operate-cycle-display-workspace.schema.json',
    validWorkspaceSemantics,
    expected,
  );
}

export function assertOperateCycleDisplayWorkspaceV1(value, expected) {
  if (validateOperateCycleDisplayWorkspaceV1(value, expected).length > 0) {
    const error = new TypeError(
      'The Cycle display workspace does not satisfy its closed integrity contract.',
    );
    error.code = 'E_OPERATE_CYCLE_DISPLAY_INVALID';
    throw error;
  }
  return value;
}

function issueDisplay(kind, domain, payload, assertIssued) {
  const base = {
    kind,
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    payload: safeDataClone(payload),
    integrity: {
      algorithm: 'sha-256-jcs',
      domain,
      sourceViewHash: payload.viewHash,
    },
  };
  const issued = {
    ...base,
    integrity: {
      ...base.integrity,
      contentHash: contentHash(base, domain),
    },
  };
  assertIssued(issued);
  return deepFreeze(issued);
}

export function issueOperateExperienceDisplaySurfaceV1(payload) {
  return issueDisplay(
    'operate-experience-display-surface',
    DISPLAY_SURFACE_DOMAIN,
    payload,
    assertOperateExperienceDisplaySurfaceV1,
  );
}

export function issueOperateCycleDisplayWorkspaceV1(payload) {
  return issueDisplay(
    'operate-cycle-display-workspace',
    CYCLE_WORKSPACE_DOMAIN,
    payload,
    assertOperateCycleDisplayWorkspaceV1,
  );
}

function validExecutiveBoardSeatAbsence(absence) {
  if (absence === null) return true;
  if (typeof absence !== 'object' || Array.isArray(absence)) return false;
  if (absence.kind === 'omitted') {
    return typeof absence.reason === 'string' && absence.reason.length > 0;
  }
  if (absence.kind === 'lens') {
    return (
      typeof absence.roleId === 'string' &&
      typeof absence.roleKind === 'string' &&
      typeof absence.absenceCode === 'string' &&
      typeof absence.reason === 'string'
    );
  }
  if (absence.kind === 'terminal') {
    return (
      (absence.outcome === 'abandoned' || absence.outcome === 'failed') &&
      typeof absence.code === 'string' &&
      typeof absence.reason === 'string' &&
      typeof absence.recoveryDisposition === 'string'
    );
  }
  return false;
}

function validExecutiveBoardSeat(seat) {
  return (
    typeof seat?.roleId === 'string' &&
    typeof seat?.label === 'string' &&
    seat.roleId !== seat.label &&
    typeof seat?.roleKind === 'string' &&
    typeof seat?.roleVersion === 'string' &&
    validExecutiveBoardSeatAbsence(seat?.absence ?? null)
  );
}

function validExecutiveBoardPayload(payload) {
  const board = payload?.data?.executiveBoard;
  if (!board || !Array.isArray(board.seats)) return false;
  return board.seats.every(validExecutiveBoardSeat);
}

function validExecutiveBoardSemantics(value, expected) {
  return (
    value.integrity.sourceViewHash === value.payload.viewHash &&
    exactExpectedBinding(value.payload, expected, { executiveBoard: true }) &&
    validExecutiveBoardPayload(value.payload)
  );
}

export function validateOperateExecutiveBoardDisplaySurfaceV1(value, expected) {
  return validateDisplay(
    value,
    executiveBoardDisplaySurfaceSchema,
    'schemas/v1.2.0/operate-executive-board-display-surface.schema.json',
    validExecutiveBoardSemantics,
    expected,
  );
}

export function assertOperateExecutiveBoardDisplaySurfaceV1(value, expected) {
  if (validateOperateExecutiveBoardDisplaySurfaceV1(value, expected).length > 0) {
    const error = new TypeError(
      'The executive board display surface does not satisfy its closed integrity contract.',
    );
    error.code = 'E_OPERATE_EXECUTIVE_BOARD_DISPLAY_INVALID';
    throw error;
  }
  return value;
}

export function issueOperateExecutiveBoardDisplaySurfaceV1(payload) {
  return issueDisplay(
    'operate-executive-board-display-surface',
    EXECUTIVE_BOARD_DISPLAY_DOMAIN,
    payload,
    assertOperateExecutiveBoardDisplaySurfaceV1,
  );
}

function actionDeepLink(actionId) {
  return `#/operate/actions/${encodeURIComponent(actionId)}`;
}

function verificationFromOutcome(outcome) {
  if (outcome === null) {
    return Object.freeze({
      status: 'not-required',
      reasonCodes: Object.freeze([]),
    });
  }
  if (outcome.status === 'insufficient-evidence') {
    return Object.freeze({
      status: 'unverified',
      reasonCodes: Object.freeze(['OPERATE_VERIFICATION_EVIDENCE_MISSING']),
    });
  }
  if (['succeeded', 'failed'].includes(outcome.status) && outcomeCarriesAffirmativeProof(outcome)) {
    return Object.freeze({
      status: 'verified',
      reasonCodes: Object.freeze([]),
    });
  }
  return Object.freeze({
    status: 'unverified',
    reasonCodes: Object.freeze(['OPERATE_VERIFICATION_EVIDENCE_MISSING']),
  });
}

function recoveryStateFromInspection(inspection) {
  const status = inspection?.status;
  if (status === 'healthy' || status === 'empty') return 'restored';
  if (status === 'corrupt') return 'corrupt';
  if (status === 'incompatible') return 'incompatible';
  if (status === 'locked') return 'blocked';
  if (status === 'repairable') {
    if (inspection.allowedRecovery === 'clear-stale-lock') return 'blocked';
    if (inspection.allowedRecovery === 'restore-generation') return 'uncertain';
    return 'uncertain';
  }
  return 'blocked';
}

function validActionWorkspacePayload(payload) {
  const data = payload.data;
  const action = data.action;
  const expectedDeepLink = actionDeepLink(action.actionId);
  const allowedActions = data.allowedActions;
  const outcome = data.outcome;
  const verification = verificationFromOutcome(outcome);
  const commandable = allowedActions.some((entry) => entry.action.effect !== 'read-only');
  if (
    payload.readOnly === payload.mutationEnabled ||
    (payload.mutationEnabled && (payload.status !== 'ready' || !commandable)) ||
    action.deepLink !== expectedDeepLink ||
    !exactJson(data.boundaries, ACTION_WORKSPACE_BOUNDARIES) ||
    !exactJson(data.verification, verification) ||
    !exactJson(data.replay.finalHead, payload.eventHead) ||
    allowedActions.some((entry) => entry.subjectId !== action.actionId) ||
    data.inbox.some((item) => item.subjectId !== action.actionId) ||
    data.learnings.some(
      (learning) => outcome === null || learning.outcomeId !== outcome.outcomeId,
    ) ||
    (outcome !== null && outcome.actionId !== action.actionId)
  )
    return false;
  return true;
}

function validActionWorkspaceSemantics(value, expected) {
  return (
    value.integrity.sourceViewHash === value.payload.viewHash &&
    exactExpectedBinding(value.payload, expected, { workspace: true, action: true }) &&
    validActionWorkspacePayload(value.payload)
  );
}

export function validateOperateActionDisplayWorkspaceV1(value, expected) {
  return validateDisplay(
    value,
    actionDisplayWorkspaceSchema,
    'schemas/v1.2.0/operate-action-display-workspace.schema.json',
    validActionWorkspaceSemantics,
    expected,
  );
}

export function assertOperateActionDisplayWorkspaceV1(value, expected) {
  if (validateOperateActionDisplayWorkspaceV1(value, expected).length > 0) {
    const error = new TypeError(
      'The Action display workspace does not satisfy its closed integrity contract.',
    );
    error.code = 'E_OPERATE_ACTION_DISPLAY_INVALID';
    throw error;
  }
  return value;
}

export function issueOperateActionDisplayWorkspaceV1(payload) {
  return issueDisplay(
    'operate-action-display-workspace',
    ACTION_WORKSPACE_DOMAIN,
    payload,
    assertOperateActionDisplayWorkspaceV1,
  );
}

function validRecoveryDisplayPayload(payload) {
  const data = payload.data;
  if (
    'integrityBoundary' in data.inspection ||
    data.recoveryState !== recoveryStateFromInspection(data.inspection)
  )
    return false;
  return true;
}

function validRecoveryDisplaySemantics(value, expected) {
  return (
    value.integrity.sourceViewHash === value.payload.viewHash &&
    exactExpectedBinding(value.payload, expected, { workspace: true, recovery: true }) &&
    validRecoveryDisplayPayload(value.payload)
  );
}

export function validateOperateRecoveryDisplaySurfaceV1(value, expected) {
  return validateDisplay(
    value,
    recoveryDisplaySurfaceSchema,
    'schemas/v1.2.0/operate-recovery-display-surface.schema.json',
    validRecoveryDisplaySemantics,
    expected,
  );
}

export function assertOperateRecoveryDisplaySurfaceV1(value, expected) {
  if (validateOperateRecoveryDisplaySurfaceV1(value, expected).length > 0) {
    const error = new TypeError(
      'The recovery display surface does not satisfy its closed integrity contract.',
    );
    error.code = 'E_OPERATE_RECOVERY_DISPLAY_INVALID';
    throw error;
  }
  return value;
}

export function issueOperateRecoveryDisplaySurfaceV1(payload) {
  return issueDisplay(
    'operate-recovery-display-surface',
    RECOVERY_DISPLAY_DOMAIN,
    payload,
    assertOperateRecoveryDisplaySurfaceV1,
  );
}

export const OPERATE_ACTION_DISPLAY_WORKSPACE_SCHEMA_V1 = Object.freeze(
  structuredClone(actionDisplayWorkspaceSchema),
);
export const OPERATE_RECOVERY_DISPLAY_SURFACE_SCHEMA_V1 = Object.freeze(
  structuredClone(recoveryDisplaySurfaceSchema),
);

export const OPERATE_EXECUTIVE_BOARD_DISPLAY_SURFACE_SCHEMA_V1 = Object.freeze(
  structuredClone(executiveBoardDisplaySurfaceSchema),
);

export const OPERATE_EXPERIENCE_DISPLAY_SURFACE_SCHEMA_V1 = Object.freeze(
  structuredClone(displaySurfaceSchema),
);
export const OPERATE_CYCLE_DISPLAY_WORKSPACE_SCHEMA_V1 = Object.freeze(
  structuredClone(cycleDisplayWorkspaceSchema),
);
