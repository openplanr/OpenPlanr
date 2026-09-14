import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync,
  writeSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { verifyDocumentDigest, withDocumentDigest } from '@openplanr/protocol/canonical-json';
import { validateProtocolArtifact } from '@openplanr/protocol/contracts';

import { resolveDataFeatureConsent } from './consent.mjs';
import { prepareLifecycleEnvironment } from './environment.mjs';
import { assertIsoDate, assertNonBlank, freezeJson, hasOwn } from './internal.mjs';

export const LOCAL_LEARNING_PATH = '.planr/runtime/skill-learning.jsonl';

const CATEGORIES = new Set(['context', 'review', 'implementation', 'diagnostic']);
const PREPARED_LEARNING_RESULTS = new WeakSet();
const SECRET_PATTERNS = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/giu,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/gu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,255}\b/gu,
  /\bxox[baprs]-[A-Za-z0-9-]{10,255}\b/gu,
  /\bnpm_[A-Za-z0-9]{36}\b/gu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
  /\b(api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*(?!\[redacted\](?:\s|[,;]|$))([^\s,;]+)/giu,
]);

function preparedResult(value) {
  const result = freezeJson(value);
  PREPARED_LEARNING_RESULTS.add(result);
  return result;
}

function redactNote(note) {
  let redacted = note;
  let count = 0;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match, candidateLabel) => {
      count += 1;
      return typeof candidateLabel === 'string' ? `${candidateLabel}=[redacted]` : '[redacted]';
    });
  }
  return { note: redacted, redactions: count };
}

function grantedLearningConsent(consent, skillId, projectIdentity) {
  return resolveDataFeatureConsent({
    skillId,
    subject: 'learning',
    projectIdentity,
    consents: consent ? [consent] : [],
  }).decision === 'granted';
}

/**
 * Prepare a local learning record. Raw prompts and artifact bodies are rejected
 * at the boundary; recognizable secret values are removed before validation.
 */
export function prepareLearningRecord(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('learning input must be an object.');
  }
  const { learningId, skillId, observedAt, category, note, consent, projectIdentity } = input;
  assertNonBlank(learningId, 'learningId');
  assertNonBlank(skillId, 'skillId');
  assertNonBlank(note, 'note');
  if (!CATEGORIES.has(category)) throw new TypeError(`Unknown learning category: ${category}.`);

  const disallowed = [
    hasOwn(input, 'rawPrompt') ? 'raw-prompt' : null,
    hasOwn(input, 'artifactBody') ? 'artifact-body' : null,
  ].filter(Boolean);
  if (disallowed.length > 0) {
    return preparedResult({
      status: 'blocked',
      record: null,
      reason: 'disallowed-learning-data',
      disallowed,
    });
  }
  if (!grantedLearningConsent(consent, skillId, projectIdentity)) {
    return preparedResult({
      status: 'unavailable',
      record: null,
      reason: 'learning-disabled',
      disallowed: [],
    });
  }

  const safe = redactNote(note);
  if (safe.note.trim().length === 0) {
    return preparedResult({
      status: 'blocked',
      record: null,
      reason: 'learning-empty-after-redaction',
      disallowed: ['note'],
    });
  }
  const record = withDocumentDigest({
    kind: 'skill-learning-record',
    schemaVersion: '1.0.0',
    protocolVersion: '1.6.0',
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    learningId,
    skillId,
    observedAt: assertIsoDate(observedAt, 'observedAt'),
    category,
    note: safe.note,
    consentGranted: true,
    consentRef: consent.consentId,
  });
  if (validateProtocolArtifact('skill-learning-record', record, { protocolVersion: '1.6.0' }).length > 0) {
    throw new TypeError('learning record must match the Protocol skill-learning-record contract.');
  }
  return preparedResult({
    status: 'completed',
    record,
    reason: safe.redactions === 0 ? 'learning-ready' : 'learning-redacted',
    redactions: safe.redactions,
    disallowed: [],
  });
}

function validPreparedLearning(prepared) {
  if (
    !prepared
    || typeof prepared !== 'object'
    || Array.isArray(prepared)
    || !PREPARED_LEARNING_RESULTS.has(prepared)
    || prepared.status !== 'completed'
    || prepared.reason === undefined
    || !Number.isInteger(prepared.redactions)
    || prepared.redactions < 0
    || !Array.isArray(prepared.disallowed)
    || prepared.disallowed.length !== 0
    || !prepared.record
    || typeof prepared.record !== 'object'
    || Array.isArray(prepared.record)
  ) return false;

  const errors = validateProtocolArtifact('skill-learning-record', prepared.record, {
    protocolVersion: '1.6.0',
  });
  if (
    errors.length > 0
    || !verifyDocumentDigest(prepared.record)
    || prepared.record.consentGranted !== true
    || typeof prepared.record.consentRef !== 'string'
  ) return false;

  const rescanned = redactNote(prepared.record.note);
  return rescanned.redactions === 0 && rescanned.note === prepared.record.note;
}

function containedPath(root, target) {
  const relativePath = relative(root, target);
  return relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath);
}

function prepareLocalDirectory(root, relativeDirectory) {
  let current = root;
  for (const segment of relativeDirectory.split('/')) {
    const target = join(current, segment);
    if (!containedPath(root, target)) return null;
    if (!existsSync(target)) mkdirSync(target, { mode: 0o700 });
    current = realpathSync(target);
    if (!containedPath(root, current)) return null;
  }
  return current;
}

function openLocalLearningFile(root, target) {
  const existing = lstatSync(target, { throwIfNoEntry: false });
  if (existing && (!existing.isFile() || existing.nlink !== 1)) return null;

  let descriptor = null;
  let accepted = false;
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    descriptor = openSync(
      target,
      fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_WRONLY | noFollow,
      0o600,
    );
    const opened = fstatSync(descriptor);
    if (!opened.isFile()) return null;
    const canonicalTarget = realpathSync(target);
    if (!containedPath(root, canonicalTarget) || canonicalTarget !== target) return null;
    const named = statSync(canonicalTarget);
    if (opened.dev !== named.dev || opened.ino !== named.ino) return null;
    accepted = true;
    return descriptor;
  } catch {
    return null;
  } finally {
    if (descriptor !== null && !accepted) closeSync(descriptor);
  }
}

/** Persist only to the one project-local ignored lifecycle destination. */
export function persistLearningRecord({
  projectRoot,
  prepared,
  relativePath = LOCAL_LEARNING_PATH,
} = {}) {
  assertNonBlank(projectRoot, 'projectRoot');
  if (relativePath !== LOCAL_LEARNING_PATH) {
    return freezeJson({
      status: 'blocked',
      path: null,
      reason: 'learning-destination-denied',
    });
  }
  if (!prepared || typeof prepared !== 'object' || !PREPARED_LEARNING_RESULTS.has(prepared)) {
    return freezeJson({
      status: 'blocked',
      path: null,
      reason: 'learning-record-invalid',
    });
  }
  if (prepared.status !== 'completed') {
    return freezeJson({
      status: prepared.status,
      path: null,
      reason: prepared.reason,
    });
  }
  if (!validPreparedLearning(prepared)) {
    return freezeJson({ status: 'blocked', path: null, reason: 'learning-record-invalid' });
  }

  const environment = prepareLifecycleEnvironment({ projectRoot });
  if (!environment.stateAvailable || !environment.runtimeIgnored) {
    return freezeJson({ status: 'blocked', path: null, reason: 'learning-destination-denied' });
  }
  let descriptor;
  try {
    const root = realpathSync(resolve(environment.projectRoot));
    const directory = prepareLocalDirectory(root, '.planr/runtime');
    if (!directory) {
      return freezeJson({ status: 'blocked', path: null, reason: 'learning-destination-denied' });
    }
    descriptor = openLocalLearningFile(root, join(directory, 'skill-learning.jsonl'));
  } catch {
    return freezeJson({ status: 'blocked', path: null, reason: 'learning-destination-denied' });
  }
  if (descriptor === null) {
    return freezeJson({ status: 'blocked', path: null, reason: 'learning-destination-denied' });
  }
  try {
    writeSync(descriptor, `${JSON.stringify(prepared.record)}\n`, undefined, 'utf8');
  } catch {
    return freezeJson({ status: 'blocked', path: null, reason: 'learning-destination-denied' });
  } finally {
    closeSync(descriptor);
  }
  return freezeJson({
    status: 'completed',
    path: relativePath,
    reason: 'learning-stored-locally',
  });
}
