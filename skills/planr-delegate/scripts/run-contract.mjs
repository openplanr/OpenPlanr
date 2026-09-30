// Shared private run invariants. No engine execution or filesystem mutation policy lives here.
import { createHash } from 'node:crypto';
import { isAbsolute, sep } from 'node:path';
import { assertCredentialFreeText } from './context.mjs';
import { updateRunRecord } from './run-record.mjs';

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

const MAX_TIMEOUT_MS = 60 * 60 * 1000;

const MAX_RUN_DURATION_MS = 60 * 60 * 1000;

const MAX_HANDOFF_TEXT = 4096;

export const MAX_CUSTODY_BYTES = 64 * 1024 * 1024;

export const MAX_CAPSULE_BYTES = 32 * 1024 * 1024;

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

export const SHA256 = /^[a-f0-9]{64}$/u;

const RESULT_STATES = new Set(['completed', 'blocked', 'question']);

const CREDENTIAL =
  /-----BEGIN (?:[A-Z ]* )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}/iu;

export class DelegateRunError extends Error {
  constructor(code, message, runId = null, details = null) {
    super(message);
    this.name = 'DelegateRunError';
    this.code = code;
    this.runId = runId;
    if (details) this.details = details;
  }
}

export function within(root, path) {
  return path === root || path.startsWith(`${root}${sep}`);
}

export function integrationPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 64)
    throw new DelegateRunError(
      'E_DELEGATE_SCOPE',
      'Declare one to 64 integration boundary paths before dispatch.',
    );
  return [
    ...new Set(
      paths.map((path) => {
        if (
          typeof path !== 'string' ||
          !path ||
          path.includes('\\') ||
          path.includes('\0') ||
          isAbsolute(path) ||
          /^[A-Za-z]:/u.test(path) ||
          path.split('/').some((part) => !part || part === '.' || part === '..') ||
          path === '.git' ||
          path.startsWith('.git/')
        )
          throw new DelegateRunError(
            'E_DELEGATE_SCOPE',
            'Integration paths must be safe repository-relative paths.',
          );
        return path;
      }),
    ),
  ].sort();
}

export function boundedText(value, label) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Buffer.byteLength(value, 'utf8') > MAX_HANDOFF_TEXT ||
    CREDENTIAL.test(value)
  ) {
    throw new DelegateRunError(
      'E_DELEGATE_INPUT',
      `${label} must be nonempty, bounded, and free of credential material.`,
    );
  }
  assertCredentialFreeText(value, { code: 'E_DELEGATE_INPUT', label });
  return value;
}

export function sessionId(value) {
  return typeof value === 'string' && SESSION_ID.test(value) ? value : null;
}

export function timeout(value) {
  const duration = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > MAX_TIMEOUT_MS) {
    throw new DelegateRunError(
      'E_DELEGATE_TIMEOUT',
      'Run timeout must be between 1 ms and 1 hour.',
    );
  }
  return duration;
}

export function hardLimit(timeoutMs) {
  return Math.min(MAX_RUN_DURATION_MS, timeout(timeoutMs) * 3);
}

function destinationIdentity(destination) {
  if (!destination || typeof destination !== 'object') {
    throw new DelegateRunError('E_DELEGATE_PROFILE', 'Profile has no verified destination.');
  }
  const { classification, class: destinationClass, origin } = destination;
  const category = classification ?? destinationClass;
  if (typeof category !== 'string' || typeof origin !== 'string' || !origin) {
    throw new DelegateRunError('E_DELEGATE_PROFILE', 'Profile destination is incomplete.');
  }
  return { class: category, origin };
}

export function profileIdentity(prepared) {
  const name = prepared?.profile?.name;
  const backend = prepared?.profile?.kind;
  if (typeof name !== 'string' || !name || typeof backend !== 'string' || !backend) {
    throw new DelegateRunError('E_DELEGATE_PROFILE', 'Profile identity is incomplete.');
  }
  if (
    typeof prepared.adapter?.run !== 'function' ||
    typeof prepared.adapter?.resume !== 'function'
  ) {
    throw new DelegateRunError(
      'E_DELEGATE_CAPABILITY',
      'Profile adapter must run and resume exactly.',
    );
  }
  return {
    name,
    backend,
    destination: destinationIdentity(prepared.destination),
    enrollmentId:
      prepared.profile.recordDigest ??
      createHash('sha256').update(JSON.stringify(prepared.profile)).digest('hex'),
  };
}

export function profileMatches(record, prepared) {
  const identity = profileIdentity(prepared);
  return (
    identity.name === record.profileName &&
    identity.backend === record.backend &&
    identity.enrollmentId === record.profileEnrollmentId &&
    identity.destination.class === record.destination.class &&
    identity.destination.origin === record.destination.origin
  );
}

function validQuestion(question) {
  if (
    !question ||
    typeof question !== 'object' ||
    typeof question.text !== 'string' ||
    !question.text.trim() ||
    Buffer.byteLength(question.text, 'utf8') > MAX_HANDOFF_TEXT ||
    CREDENTIAL.test(question.text) ||
    (question.options !== undefined &&
      (!Array.isArray(question.options) ||
        question.options.length > 12 ||
        question.options.some(
          (option) =>
            typeof option !== 'string' ||
            Buffer.byteLength(option, 'utf8') > 256 ||
            CREDENTIAL.test(option),
        )))
  )
    return false;
  return true;
}

export function resultShape(result, expectedSessionId = null) {
  if (!result || typeof result !== 'object' || !RESULT_STATES.has(result.status)) return null;
  const exactId = sessionId(result.sessionId);
  if (
    (!exactId && (result.status !== 'blocked' || result.sessionId != null)) ||
    (expectedSessionId && exactId !== expectedSessionId)
  )
    return null;
  if (
    typeof result.summary !== 'string' ||
    Buffer.byteLength(result.summary, 'utf8') > MAX_HANDOFF_TEXT
  ) {
    return null;
  }
  if (CREDENTIAL.test(result.summary)) return null;
  if (result.status === 'blocked' && !result.summary.trim()) return null;
  if (result.status === 'question' && !validQuestion(result.question)) return null;
  if (
    (result.checks !== undefined && !Array.isArray(result.checks)) ||
    (result.issues !== undefined && !Array.isArray(result.issues))
  )
    return null;
  return { ...result, sessionId: exactId };
}

export async function blocked(runId, directory, code, message, session = null) {
  return updateRunRecord(
    runId,
    {
      status: 'blocked',
      activePid: null,
      backendSessionId: session,
      diagnostic: { code, message },
    },
    { directory },
  );
}
