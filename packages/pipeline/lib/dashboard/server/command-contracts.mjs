/** Governed command transport contracts: strict bodies, exact bindings and closed responses. */

import { types as utilTypes } from 'node:util';

import {
  assertOperateExperienceTransportView,
  assertOperatingReviewReceiptV2,
  sha256Jcs,
} from './operate.mjs';
import {
  closedReviewWorkspace,
  exactEventHead,
  experienceBinding,
  OPERATE_BINDING_QUERY_KEYS,
  OPERATE_SUBJECT_SEGMENT,
  sameExperienceBinding,
} from './operate-routes.mjs';
import { LIVE_HASH, validLiveHead } from './planning.mjs';
import {
  assertDashboardSafeError,
  mapDashboardSafeError,
  safeDashboardErrorRecord,
} from './responses.mjs';

const OPERATE_COMMAND_BODY_LIMIT = 32 * 1024;
const OPERATE_COMMAND_SESSION_MIN_TTL_MS = 1_000;
const OPERATE_COMMAND_SESSION_MAX_TTL_MS = 60 * 60 * 1_000;
const OPERATE_COMMAND_MUTATIONS = new Set([
  'operate.assignment.submit',
  'operate.review.submit',
  'operate.action.approve',
  'operate.action.execute',
  'operate.action.rollback',
]);
export const OPERATE_COMMAND_ROUTES = new Map([
  [
    '/api/operate/session',
    Object.freeze({
      kind: 'session',
      fields: ['cycleId', 'eventHead', 'sourceViewHash', 'actionLocator'],
    }),
  ],
  [
    '/api/operate/commands/preview',
    Object.freeze({
      kind: 'preview',
      fields: ['sessionId', 'actionReference'],
    }),
  ],
  [
    '/api/operate/commands/confirm',
    Object.freeze({
      kind: 'confirm',
      fields: ['sessionId', 'previewId', 'previewHash'],
      optionalFields: ['note'],
    }),
  ],
  [
    '/api/operate/planning/preview',
    Object.freeze({
      kind: 'planning-preview',
      fields: ['sessionId', 'actionId'],
      optionalFields: ['framing'],
    }),
  ],
  [
    '/api/operate/planning/create-spec',
    Object.freeze({
      kind: 'planning-create-spec',
      fields: ['sessionId', 'proposalId', 'confirmDigest'],
    }),
  ],
]);

const PLANNING_FRAMING_FIELDS = Object.freeze([
  'title',
  'slug',
  'problem',
  'objective',
  'users',
  'scope',
  'nonScope',
  'risks',
  'constraints',
  'requirements',
  'acceptanceOutcomes',
]);

function exactPlanningFraming(value) {
  if (!exactObject(value, PLANNING_FRAMING_FIELDS)) return false;
  return (
    ['title', 'slug', 'problem', 'objective'].every((field) => typeof value[field] === 'string') &&
    [
      'users',
      'scope',
      'nonScope',
      'risks',
      'constraints',
      'requirements',
      'acceptanceOutcomes',
    ].every(
      (field) =>
        Array.isArray(value[field]) && value[field].every((entry) => typeof entry === 'string'),
    )
  );
}

function strictJsonError(code = 'OPERATE_BODY_INVALID') {
  const error = new Error(
    code === 'OPERATE_DUPLICATE_MEMBER'
      ? 'The command body contains a duplicate JSON object member.'
      : 'The command body is invalid JSON.',
  );
  error.code = code;
  error.status = 400;
  return error;
}

/**
 * Scan one bounded JSON body before JSON.parse can collapse duplicate object
 * members. Decoded property names are compared, so `"actor"` and
 * `"\u0061ctor"` are the same member; nested objects receive the same check.
 */
function parseStrictCommandJson(source) {
  let offset = 0;
  const whitespace = () => {
    while (/[\t\n\r ]/u.test(source[offset] ?? '')) offset += 1;
  };
  const string = () => {
    if (source[offset] !== '"') throw strictJsonError();
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      const character = source[offset];
      if (character === '"') {
        offset += 1;
        try {
          return JSON.parse(source.slice(start, offset));
        } catch {
          throw strictJsonError();
        }
      }
      if (character === '\\') {
        offset += 1;
        const escape = source[offset];
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/u.test(source.slice(offset + 1, offset + 5))) {
            throw strictJsonError();
          }
          offset += 5;
          continue;
        }
        if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) {
          throw strictJsonError();
        }
        offset += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) throw strictJsonError();
      offset += 1;
    }
    throw strictJsonError();
  };
  const value = () => {
    whitespace();
    const character = source[offset];
    if (character === '{') {
      offset += 1;
      whitespace();
      const members = new Set();
      if (source[offset] === '}') {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        const member = string();
        if (members.has(member)) throw strictJsonError('OPERATE_DUPLICATE_MEMBER');
        members.add(member);
        whitespace();
        if (source[offset] !== ':') throw strictJsonError();
        offset += 1;
        value();
        whitespace();
        if (source[offset] === '}') {
          offset += 1;
          return;
        }
        if (source[offset] !== ',') throw strictJsonError();
        offset += 1;
        whitespace();
      }
      throw strictJsonError();
    }
    if (character === '[') {
      offset += 1;
      whitespace();
      if (source[offset] === ']') {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        value();
        whitespace();
        if (source[offset] === ']') {
          offset += 1;
          return;
        }
        if (source[offset] !== ',') throw strictJsonError();
        offset += 1;
      }
      throw strictJsonError();
    }
    if (character === '"') {
      string();
      return;
    }
    const remainder = source.slice(offset);
    const primitive = /^(?:true|false|null)(?=[\t\n\r ,}\]]|$)/u.exec(remainder);
    if (primitive) {
      offset += primitive[0].length;
      return;
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?=[\t\n\r ,}\]]|$)/u.exec(
      remainder,
    );
    if (!number) throw strictJsonError();
    offset += number[0].length;
  };
  if (Buffer.byteLength(source, 'utf8') > OPERATE_COMMAND_BODY_LIMIT) {
    const error = new Error('The command body is too large.');
    error.code = 'OPERATE_BODY_TOO_LARGE';
    error.status = 413;
    throw error;
  }
  value();
  whitespace();
  if (offset !== source.length) throw strictJsonError();
  try {
    return JSON.parse(source);
  } catch {
    throw strictJsonError();
  }
}

function sameCommandSessionBinding(sessionBinding, requestBinding, request) {
  return (
    sameExperienceBinding(sessionBinding, requestBinding) &&
    typeof request?.cycleId === 'string' &&
    sessionBinding?.cycleId === request.cycleId &&
    exactEventHead(sessionBinding?.eventHead, request.eventHead) &&
    sessionBinding?.sourceViewHash === request.sourceViewHash &&
    sessionBinding?.actionLocator?.subjectId === request.actionLocator?.subjectId &&
    sessionBinding?.actionLocator?.actionDigest === request.actionLocator?.actionDigest
  );
}

export function validCommandSessionBinding(sessionBinding, requestBinding) {
  return (
    sameExperienceBinding(sessionBinding, requestBinding) &&
    typeof sessionBinding?.cycleId === 'string' &&
    OPERATE_SUBJECT_SEGMENT.test(sessionBinding.cycleId) &&
    validLiveHead(sessionBinding.eventHead) &&
    typeof sessionBinding.sourceViewHash === 'string' &&
    LIVE_HASH.test(sessionBinding.sourceViewHash) &&
    exactObject(sessionBinding.actionLocator, ['subjectId', 'actionDigest']) &&
    typeof sessionBinding.actionLocator.subjectId === 'string' &&
    OPERATE_SUBJECT_SEGMENT.test(sessionBinding.actionLocator.subjectId) &&
    typeof sessionBinding.actionLocator.actionDigest === 'string' &&
    LIVE_HASH.test(sessionBinding.actionLocator.actionDigest)
  );
}

function closedCommandSessionBinding(value) {
  const source = safeDashboardErrorRecord(value);
  if (
    !source ||
    !exactObject(source, [
      'actorId',
      'scopeId',
      'domainId',
      'domainVersion',
      'cycleId',
      'eventHead',
      'sourceViewHash',
      'actionLocator',
    ])
  )
    return null;
  const eventHead = safeDashboardErrorRecord(source.eventHead);
  const actionLocator = safeDashboardErrorRecord(source.actionLocator);
  const binding = {
    actorId: source.actorId,
    scopeId: source.scopeId,
    domainId: source.domainId,
    domainVersion: source.domainVersion,
    cycleId: source.cycleId,
    eventHead,
    sourceViewHash: source.sourceViewHash,
    actionLocator,
  };
  return eventHead &&
    actionLocator &&
    validCommandSessionBinding(binding, {
      actorId: binding.actorId,
      scopeId: binding.scopeId,
      domainId: binding.domainId,
      domainVersion: binding.domainVersion,
    })
    ? binding
    : null;
}

function sameClosedCommandSessionBinding(left, right) {
  return (
    sameExperienceBinding(left, right) &&
    left?.cycleId === right?.cycleId &&
    exactEventHead(left?.eventHead, right?.eventHead) &&
    left?.sourceViewHash === right?.sourceViewHash &&
    left?.actionLocator?.subjectId === right?.actionLocator?.subjectId &&
    left?.actionLocator?.actionDigest === right?.actionLocator?.actionDigest
  );
}

function exactObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return (
    actual.length === expected.length && actual.every((field, index) => field === expected[index])
  );
}

export function exactRouteBody(value, route) {
  if (exactObject(value, route.fields)) {
    if (route.kind !== 'session') return true;
    return (
      typeof value.cycleId === 'string' &&
      OPERATE_SUBJECT_SEGMENT.test(value.cycleId) &&
      validLiveHead(value.eventHead) &&
      typeof value.sourceViewHash === 'string' &&
      LIVE_HASH.test(value.sourceViewHash) &&
      exactObject(value.actionLocator, ['subjectId', 'actionDigest']) &&
      typeof value.actionLocator.subjectId === 'string' &&
      OPERATE_SUBJECT_SEGMENT.test(value.actionLocator.subjectId) &&
      typeof value.actionLocator.actionDigest === 'string' &&
      LIVE_HASH.test(value.actionLocator.actionDigest)
    );
  }
  const optional = route.optionalFields ?? [];
  if (optional.length === 0 || !exactObject(value, [...route.fields, ...optional])) return false;
  if (Object.hasOwn(value, 'framing') && !exactPlanningFraming(value.framing)) return false;
  if (
    Object.hasOwn(value, 'note') &&
    !(
      value.note === null ||
      (typeof value.note === 'string' &&
        value.note.length <= 2048 &&
        /^\S(?:[\s\S]*\S)?$/u.test(value.note))
    )
  )
    return false;
  return true;
}

function exactReturnedSessionAction(response, request) {
  if (!Array.isArray(response?.allowedActions) || response.allowedActions.length !== 1)
    return false;
  const [action] = response.allowedActions;
  return (
    exactObject(action, ['actionReference', 'subjectId', 'actionDigest']) &&
    typeof action.actionReference === 'string' &&
    /^[A-Za-z0-9_-]{16,256}$/u.test(action.actionReference) &&
    action.subjectId === request.actionLocator.subjectId &&
    action.actionDigest === request.actionLocator.actionDigest
  );
}

function canonicalCommandTimestamp(value) {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp)) return null;
  try {
    return new Date(timestamp).toISOString() === value ? timestamp : null;
  } catch {
    return null;
  }
}

export function closedCommandSessionResponse(response, requestBinding, request) {
  const source = safeDashboardErrorRecord(response);
  const issuedAtMs = source ? canonicalCommandTimestamp(source.issuedAt) : null;
  const expiresAtMs = source ? canonicalCommandTimestamp(source.expiresAt) : null;
  if (
    !source ||
    !exactObject(source, [
      'kind',
      'schemaVersion',
      'protocolVersion',
      'sessionId',
      'sessionCapability',
      'issuedAt',
      'expiresAt',
      'binding',
      'allowedActions',
      'readOnly',
    ]) ||
    source.kind !== 'operate-command-session' ||
    source.schemaVersion !== '1.0.0' ||
    source.protocolVersion !== '2.0.0' ||
    typeof source.sessionId !== 'string' ||
    !/^opsess_[A-Za-z0-9_-]{16,249}$/u.test(source.sessionId) ||
    typeof source.sessionCapability !== 'string' ||
    !/^[A-Za-z0-9_-]{43,256}$/u.test(source.sessionCapability) ||
    issuedAtMs === null ||
    expiresAtMs === null ||
    expiresAtMs - issuedAtMs < OPERATE_COMMAND_SESSION_MIN_TTL_MS ||
    expiresAtMs - issuedAtMs > OPERATE_COMMAND_SESSION_MAX_TTL_MS ||
    source.readOnly !== false ||
    !Array.isArray(source.allowedActions) ||
    utilTypes.isProxy(source.allowedActions) ||
    source.allowedActions.length !== 1
  )
    return null;
  const binding = closedCommandSessionBinding(source.binding);
  const action = safeDashboardErrorRecord(source.allowedActions[0]);
  if (
    !binding ||
    !action ||
    !sameCommandSessionBinding(binding, requestBinding, request) ||
    !exactReturnedSessionAction({ allowedActions: [action] }, request)
  )
    return null;
  return Object.freeze({
    kind: source.kind,
    schemaVersion: source.schemaVersion,
    protocolVersion: source.protocolVersion,
    sessionId: source.sessionId,
    sessionCapability: source.sessionCapability,
    issuedAt: source.issuedAt,
    expiresAt: source.expiresAt,
    binding: Object.freeze(structuredClone(binding)),
    allowedActions: Object.freeze([Object.freeze(structuredClone(action))]),
    readOnly: false,
  });
}

export function closedCommandPreviewProof(value, sessionBinding) {
  const source = safeDashboardErrorRecord(value);
  const binding = source ? closedCommandSessionBinding(source.binding) : null;
  if (
    !source ||
    !exactObject(source, ['binding', 'operation']) ||
    !binding ||
    !sameClosedCommandSessionBinding(binding, sessionBinding) ||
    typeof source.operation !== 'string' ||
    !OPERATE_COMMAND_MUTATIONS.has(source.operation)
  )
    return null;
  return Object.freeze({ binding, operation: source.operation });
}

function emptyClosedArray(value) {
  return Array.isArray(value) && !utilTypes.isProxy(value) && value.length === 0;
}

export function closedCommandFailureResponse(response, expectedOperation) {
  const source = safeDashboardErrorRecord(response);
  const error = source ? safeDashboardErrorRecord(source.error) : null;
  if (
    !source ||
    !error ||
    !exactObject(source, ['ok', 'operation', 'error', 'allowedActions']) ||
    !exactObject(error, ['code', 'message', 'retryable', 'context']) ||
    source.ok !== false ||
    source.operation !== expectedOperation ||
    !emptyClosedArray(source.allowedActions) ||
    typeof error.code !== 'string' ||
    typeof error.message !== 'string' ||
    typeof error.retryable !== 'boolean'
  )
    return null;
  const safe = assertDashboardSafeError(
    mapDashboardSafeError({
      code: error.code,
      retryable: error.retryable,
      context: error.context,
    }),
  );
  if (safe.code !== error.code) return null;
  return Object.freeze({
    ok: false,
    operation: expectedOperation,
    error: Object.freeze({
      code: safe.code,
      message:
        safe.code === 'OPERATION_UNCERTAIN'
          ? 'The durable result is uncertain. Inspect recovery state; do not retry blindly.'
          : 'The governed command was refused without effect.',
      retryable: false,
      context: Object.freeze({}),
    }),
    allowedActions: Object.freeze([]),
  });
}

export function closedCommandSuccessResponse(response, expectedOperation, refreshedView) {
  const source = safeDashboardErrorRecord(response);
  if (
    !source ||
    !exactObject(source, ['ok', 'operation', 'data', 'allowedActions', 'eventHead']) ||
    source.ok !== true ||
    source.operation !== expectedOperation ||
    !emptyClosedArray(source.allowedActions) ||
    !validLiveHead(source.eventHead) ||
    !exactEventHead(source.eventHead, refreshedView.eventHead)
  )
    return null;
  try {
    assertOperateExperienceTransportView(source.data);
  } catch {
    return null;
  }
  if (
    !sameExperienceBinding(source.data, refreshedView) ||
    !exactEventHead(source.data.eventHead, source.eventHead) ||
    source.data.viewHash !== refreshedView.viewHash
  )
    return null;
  return Object.freeze({
    ok: true,
    operation: expectedOperation,
    data: structuredClone(refreshedView),
    allowedActions: Object.freeze([]),
    eventHead: Object.freeze(structuredClone(source.eventHead)),
  });
}

export function closedReviewCommandSuccessResponse(
  response,
  refreshedView,
  reviewWorkspace,
  sessionBinding,
  expectedNote,
) {
  const source = safeDashboardErrorRecord(response);
  const data = source ? safeDashboardErrorRecord(source.data) : null;
  if (
    !source ||
    !data ||
    !exactObject(source, ['ok', 'operation', 'data', 'allowedActions', 'eventHead']) ||
    !exactObject(data, ['receipt', 'workspace']) ||
    source.ok !== true ||
    source.operation !== 'operate.review.submit' ||
    !emptyClosedArray(source.allowedActions) ||
    !validLiveHead(source.eventHead) ||
    !currentHeadIncludesCommitted(refreshedView.eventHead, source.eventHead)
  )
    return null;
  const reviewId = sessionBinding.actionLocator.subjectId;
  const workspace = closedReviewWorkspace(
    reviewWorkspace,
    sessionBinding,
    sessionBinding.cycleId,
    reviewId,
    refreshedView,
  );
  if (!workspace || sha256Jcs(workspace) !== sha256Jcs(data.workspace)) return null;
  let receipt;
  try {
    receipt = structuredClone(data.receipt);
    assertOperatingReviewReceiptV2(receipt);
    if (receipt.boundSubmission === undefined) return null;
  } catch {
    return null;
  }
  const bound = receipt.boundSubmission;
  const terminal = workspace.payload.data.terminalDisposition;
  if (
    receipt.cycleId !== sessionBinding.cycleId ||
    receipt.review.reviewId !== reviewId ||
    receipt.actor.actorId !== sessionBinding.actorId ||
    receipt.scope.scopeId !== sessionBinding.scopeId ||
    receipt.scope.domainId !== sessionBinding.domainId ||
    receipt.scope.domainVersion !== sessionBinding.domainVersion ||
    !exactEventHead(receipt.eventHead, source.eventHead) ||
    !exactEventHead(receipt.readEventHead, sessionBinding.eventHead) ||
    !exactEventHead(bound.expectedReadEventHead, sessionBinding.eventHead) ||
    bound.note !== expectedNote ||
    bound.choiceId !== receipt.appliedChoiceId ||
    bound.choiceHash !== receipt.appliedChoiceHash ||
    workspace.payload.sourceArtifactKind !== 'operating-review-receipt' ||
    workspace.payload.sourceArtifactHash !== sha256Jcs(receipt) ||
    workspace.payload.status !== 'terminal' ||
    terminal === null ||
    terminal.receiptId !== receipt.receiptId ||
    terminal.appliedChoiceId !== receipt.appliedChoiceId ||
    terminal.appliedChoiceHash !== receipt.appliedChoiceHash ||
    !exactEventHead(terminal.eventHead, receipt.eventHead) ||
    !exactEventHead(terminal.readEventHead, receipt.readEventHead)
  )
    return null;
  return Object.freeze({
    ok: true,
    operation: 'operate.review.submit',
    data: Object.freeze({ receipt, workspace }),
    allowedActions: Object.freeze([]),
    eventHead: Object.freeze(structuredClone(source.eventHead)),
  });
}

export function closedReviewCommandFailureResponse(response, workspace) {
  const source = safeDashboardErrorRecord(response);
  const error = source ? safeDashboardErrorRecord(source.error) : null;
  if (
    !source ||
    !error ||
    !exactObject(source, ['ok', 'operation', 'error', 'allowedActions']) ||
    source.ok !== false ||
    source.operation !== 'operate.review.submit' ||
    !Array.isArray(source.allowedActions) ||
    typeof error.code !== 'string' ||
    typeof error.message !== 'string' ||
    typeof error.retryable !== 'boolean'
  )
    return null;
  const safe = assertDashboardSafeError(
    mapDashboardSafeError({
      code: error.code,
      retryable: error.retryable,
      context: error.context,
    }),
  );
  if (safe.code !== error.code) return null;
  const allowedActions =
    workspace?.payload?.data?.capability?.available === true
      ? workspace.payload.data.capability.actions
      : [];
  return Object.freeze({
    ok: false,
    operation: 'operate.review.submit',
    error: Object.freeze({
      code: safe.code,
      message:
        safe.code === 'OPERATION_UNCERTAIN'
          ? 'The durable result is uncertain. Inspect recovery state; do not retry blindly.'
          : 'The governed command was refused without effect.',
      retryable: false,
      context: Object.freeze({}),
    }),
    allowedActions: Object.freeze(structuredClone(allowedActions)),
  });
}

export function exactAdvancedHead(candidate, previous) {
  return (
    validLiveHead(candidate) && candidate.sequence > previous.sequence && candidate.hash !== null
  );
}

export function currentHeadIncludesCommitted(current, committed) {
  return (
    validLiveHead(current) &&
    validLiveHead(committed) &&
    current.sequence >= committed.sequence &&
    (current.sequence !== committed.sequence || current.hash === committed.hash)
  );
}

export function exactCommandBinding(req, searchParams, rawSearch, extraKeys = []) {
  const expectedKeys = [...OPERATE_BINDING_QUERY_KEYS, ...extraKeys];
  const seen = [...searchParams.keys()];
  const rawKeys =
    typeof rawSearch === 'string' && rawSearch.startsWith('?')
      ? rawSearch
          .slice(1)
          .split('&')
          .map((member) => member.split('=', 1)[0])
      : [];
  if (
    seen.length !== expectedKeys.length ||
    new Set(seen).size !== expectedKeys.length ||
    seen.some((key) => !expectedKeys.includes(key)) ||
    rawKeys.length !== expectedKeys.length ||
    new Set(rawKeys).size !== expectedKeys.length ||
    rawKeys.some((key) => !expectedKeys.includes(key))
  )
    return null;
  return experienceBinding(req, searchParams);
}

export function commandOrigin(req) {
  const header = req.headers.origin;
  const host = req.headers.host;
  const origins = req.headersDistinct?.origin;
  const hosts = req.headersDistinct?.host;
  if (
    Array.isArray(header) ||
    typeof header !== 'string' ||
    Array.isArray(host) ||
    typeof host !== 'string' ||
    (Array.isArray(origins) && origins.length !== 1) ||
    (Array.isArray(hosts) && hosts.length !== 1)
  )
    return null;
  try {
    const origin = new URL(header);
    const requested = new URL(`http://${host}`);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'];
    if (
      origin.origin !== header ||
      origin.origin !== requested.origin ||
      origin.protocol !== 'http:' ||
      !loopback.includes(origin.hostname) ||
      !loopback.includes(requested.hostname)
    )
      return null;
    return origin.origin;
  } catch {
    return null;
  }
}

export function loopbackCommandHost(req) {
  const host = req.headers.host;
  const hosts = req.headersDistinct?.host;
  if (
    Array.isArray(host) ||
    typeof host !== 'string' ||
    (Array.isArray(hosts) && hosts.length !== 1)
  )
    return false;
  try {
    const requested = new URL(`http://${host}`);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(requested.hostname);
  } catch {
    return false;
  }
}

export function bearerCapability(req) {
  const header = req.headers.authorization;
  const headers = req.headersDistinct?.authorization;
  if (
    Array.isArray(header) ||
    typeof header !== 'string' ||
    (Array.isArray(headers) && headers.length !== 1)
  )
    return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43,256})$/u.exec(header);
  return match?.[1] ?? null;
}

export function readCommandBody(req) {
  const contentType = req.headers['content-type'];
  if (
    Array.isArray(contentType) ||
    typeof contentType !== 'string' ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)
  ) {
    const error = new Error('The command body must be JSON.');
    error.code = 'OPERATE_CONTENT_TYPE_INVALID';
    error.status = 415;
    throw error;
  }
  const lengthHeader = req.headers['content-length'];
  const declared =
    typeof lengthHeader === 'string' && /^\d+$/u.test(lengthHeader) ? Number(lengthHeader) : null;
  if (declared !== null && declared > OPERATE_COMMAND_BODY_LIMIT) {
    const error = new Error('The command body is too large.');
    error.code = 'OPERATE_BODY_TOO_LARGE';
    error.status = 413;
    throw error;
  }
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    let refused = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > OPERATE_COMMAND_BODY_LIMIT && !refused) {
        refused = true;
        chunks.length = 0;
        const error = new Error('The command body is too large.');
        error.code = 'OPERATE_BODY_TOO_LARGE';
        error.status = 413;
        rejectBody(error);
        return;
      }
      if (!refused) chunks.push(chunk);
    });
    req.on('end', () => {
      if (refused) return;
      try {
        resolveBody(parseStrictCommandJson(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        rejectBody(error);
      }
    });
    req.on('error', rejectBody);
  });
}
