import { randomUUID } from 'node:crypto';

import {
  sha256Jcs,
  verifyDocumentDigest,
  withDocumentDigest,
} from '@openplanr/protocol/canonical-json';
import { validateProtocolArtifact } from '@openplanr/protocol/contracts';

import {
  assertIsoDate,
  assertNonBlank,
  cloneJson,
  freezeJson,
  immutableJson,
} from './internal.mjs';

const SESSION_PREFIX = 'GIS-';
const CHECKPOINT_VERSION = '1.0.0';
const SESSION_STATES = new Set(['open', 'answered', 'closed', 'expired']);
const DISALLOWED_STATE_KEY = /(?:artifact.?bod(?:y|ies)|credential|password|private.?key|raw.?prompt|secret|token)/iu;

function nowIso(now) {
  const value = typeof now === 'function' ? now() : (now ?? new Date().toISOString());
  return assertIsoDate(value, 'now');
}

function defaultSessionId() {
  return `${SESSION_PREFIX}${randomUUID().replaceAll('-', '')}`;
}

function sessionId(createSessionId) {
  const value = createSessionId?.() ?? defaultSessionId();
  if (typeof value !== 'string' || !/^GIS-[A-Za-z0-9._-]{8,128}$/u.test(value)) {
    throw new TypeError('createSessionId must return a Protocol-compatible internal session identifier.');
  }
  return value;
}

function findDisallowedStatePath(value, path = '$') {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findDisallowedStatePath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    if (DISALLOWED_STATE_KEY.test(key)) return `${path}.${key}`;
    const found = findDisallowedStatePath(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function contextBinding(context) {
  return sha256Jcs(cloneJson(context, 'context'));
}

function questionBinding(questions) {
  return sha256Jcs(cloneJson(questions, 'questions'));
}

function sessionValidationErrors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['session must be an object'];
  try {
    return validateProtocolArtifact('skill-session', value, { protocolVersion: '1.6.0' });
  } catch (error) {
    return [error instanceof Error ? error.message : 'session validation failed'];
  }
}

function isSession(value) {
  return sessionValidationErrors(value).length === 0 && verifyDocumentDigest(value);
}

function requireSession(value, label = 'session') {
  const errors = sessionValidationErrors(value);
  if (errors.length > 0 || !verifyDocumentDigest(value)) {
    throw new TypeError(`${label} must satisfy the complete Protocol 1.6 skill-session contract.`);
  }
  return value;
}

/** Create an internal Protocol session. Its identifier is runtime plumbing, not a user input. */
export function createSkillSession({
  skillId,
  questions = [],
  startedAt,
  now,
  createSessionId,
} = {}) {
  assertNonBlank(skillId, 'skillId');
  const start = startedAt ? assertIsoDate(startedAt, 'startedAt') : nowIso(now);
  const document = withDocumentDigest({
    kind: 'skill-session',
    schemaVersion: '1.0.0',
    protocolVersion: '1.6.0',
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    sessionId: sessionId(createSessionId),
    skillId,
    startedAt: start,
    state: 'open',
    questions: cloneJson(questions, 'questions'),
  });
  return freezeJson(requireSession(document, 'created session'));
}

/** Return a new immutable Protocol document for an existing session state transition. */
export function updateSkillSession(session, { state, questions = session?.questions } = {}) {
  if (!isSession(session)) throw new TypeError('session must be a Protocol 1.6 skill session.');
  if (!SESSION_STATES.has(state)) throw new TypeError(`Unknown skill session state: ${state}.`);
  const { documentDigest: _documentDigest, ...unsigned } = session;
  const updated = withDocumentDigest({
    ...unsigned,
    state,
    questions: cloneJson(questions, 'questions'),
  });
  return freezeJson(requireSession(updated, 'updated session'));
}

/**
 * Build a best-effort local checkpoint. Sensitive or oversized state is skipped
 * without turning checkpointing into a prerequisite for the skill run.
 */
export function checkpointSession({ session, context, safeState = {}, checkpointedAt, now } = {}) {
  if (!isSession(session)) {
    return freezeJson({
      status: 'partial',
      checkpoint: null,
      notice: 'Continued without a local checkpoint because the session was not recoverable.',
    });
  }

  const unsafePath = findDisallowedStatePath(safeState);
  if (unsafePath) {
    return freezeJson({
      status: 'partial',
      checkpoint: null,
      notice: 'Continued without a local checkpoint because the selected state contained private data.',
    });
  }

  try {
    const checkpoint = withDocumentDigest({
      kind: 'skill-session-checkpoint',
      version: CHECKPOINT_VERSION,
      skillId: session.skillId,
      session: cloneJson(session, 'session'),
      contextBinding: contextBinding(context ?? {}),
      questionBinding: questionBinding(session.questions),
      safeState: cloneJson(safeState, 'safeState'),
      checkpointedAt: checkpointedAt
        ? assertIsoDate(checkpointedAt, 'checkpointedAt')
        : nowIso(now),
    });
    return freezeJson({
      status: 'completed',
      checkpoint,
      notice: 'Saved a local recovery checkpoint.',
    });
  } catch {
    return freezeJson({
      status: 'partial',
      checkpoint: null,
      notice: 'Continued without a local checkpoint because its safe state could not be encoded.',
    });
  }
}

function compatibleCheckpoint(checkpoint, skillId, context, questions) {
  if (
    !checkpoint
    || typeof checkpoint !== 'object'
    || checkpoint.kind !== 'skill-session-checkpoint'
    || checkpoint.version !== CHECKPOINT_VERSION
    || checkpoint.skillId !== skillId
    || !verifyDocumentDigest(checkpoint)
    || !isSession(checkpoint.session)
    || checkpoint.session.skillId !== skillId
    || !['open', 'answered'].includes(checkpoint.session.state)
  ) return false;
  try {
    return checkpoint.contextBinding === contextBinding(context ?? {})
      && checkpoint.questionBinding === questionBinding(checkpoint.session.questions)
      && checkpoint.questionBinding === questionBinding(questions)
      && !findDisallowedStatePath(checkpoint.safeState ?? {})
      && Boolean(cloneJson(checkpoint.safeState ?? {}, 'checkpoint.safeState'));
  } catch {
    return false;
  }
}

/** Recover compatible local state, or start fresh with a concise non-blocking notice. */
export function recoverSession({
  checkpoint,
  skillId,
  context = {},
  questions = [],
  now,
  createSessionId,
} = {}) {
  assertNonBlank(skillId, 'skillId');
  if (compatibleCheckpoint(checkpoint, skillId, context, questions)) {
    return freezeJson({
      status: 'completed',
      mode: 'recovered',
      session: immutableJson(checkpoint.session, 'checkpoint.session'),
      safeState: immutableJson(checkpoint.safeState ?? {}, 'checkpoint.safeState'),
      notice: 'Restored compatible local context.',
    });
  }

  const hadCheckpoint = checkpoint !== undefined && checkpoint !== null;
  return freezeJson({
    status: 'completed',
    mode: 'fresh',
    session: createSkillSession({ skillId, questions, now, createSessionId }),
    safeState: freezeJson({}),
    notice: hadCheckpoint
      ? 'Started fresh because the local context changed.'
      : 'Started a new local session.',
  });
}
