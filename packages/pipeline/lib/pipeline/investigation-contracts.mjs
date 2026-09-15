import { sha256Jcs } from '../protocol/jcs.mjs';
import { PipelineError } from './errors.mjs';

export const INVESTIGATION_PROTOCOL_VERSION = '1.1.0';
export const INVESTIGATION_SCHEMA_VERSION = '1.0.0';
export const INVESTIGATION_MODES = Object.freeze(['diagnose', 'fix']);
export const INVESTIGATION_EFFECTS = Object.freeze(['read-only', 'destructive', 'live', 'network']);

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const PRIVATE_TEXT = /(?:\b(?:password|secret|credential|api[_-]?key|private[_-]?key|bearer)\b\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|(?:^|\s)\/(?:Users|home|private|var|tmp|etc|root)\/\S+|[A-Za-z]:\\[^\s"'`,]+|\n\s*at\s+\S+\s*\()/iu;
const FORBIDDEN_KEY = /^(?:password|secret|credential|environment|env|rawError|stdout|stderr)$/iu;

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('E_INVESTIGATION_CONTRACT_INVALID', `${label} must be one object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('E_INVESTIGATION_CONTRACT_INVALID', `${label} has missing or unknown fields.`);
  return value;
}

function text(value, label, max = 4_000) {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > max) {
    fail('E_INVESTIGATION_CONTRACT_INVALID', `${label} must be trimmed text between 1 and ${max} characters.`);
  }
  return value;
}

function identifier(value, label, max = 96) {
  if (typeof value !== 'string' || value.length > max || !IDENTIFIER.test(value)) fail('E_INVESTIGATION_CONTRACT_INVALID', `${label} is not a closed identifier.`);
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? '')) fail('E_INVESTIGATION_CONTRACT_INVALID', `${label} must be an exact SHA-256 digest.`);
  return value;
}

function date(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail('E_INVESTIGATION_CONTRACT_INVALID', `${label} must be one canonical ISO timestamp.`);
  }
  return value;
}

function unique(values, label, { min = 0, max = 128 } = {}) {
  if (!Array.isArray(values) || values.length < min || values.length > max || new Set(values.map((entry) => JSON.stringify(entry))).size !== values.length) {
    fail('E_INVESTIGATION_CONTRACT_INVALID', `${label} must be a bounded unique array.`);
  }
  return values;
}

function relativePath(value, label) {
  text(value, label, 512);
  if (value !== '.' && (value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..'))) {
    fail('E_INVESTIGATION_SCOPE_INVALID', `${label} must be a normalized repository-relative path.`);
  }
  return value;
}

export function assertInvestigationPortable(value, path = '$') {
  if (Buffer.byteLength(JSON.stringify(value)) > 262_144) fail('E_INVESTIGATION_OUTPUT_OVERSIZED', 'Portable investigation artifact exceeds 256 KiB.');
  function visit(entry, cursor) {
    if (typeof entry === 'string') {
      if (entry.length > 8_000 || PRIVATE_TEXT.test(entry)) fail('E_INVESTIGATION_PRIVATE_DATA', `${cursor} contains secret, private-path, raw-error, or oversized text.`);
      return;
    }
    if (Array.isArray(entry)) entry.forEach((item, index) => visit(item, `${cursor}[${index}]`));
    else if (entry && typeof entry === 'object') Object.entries(entry).forEach(([key, item]) => {
      if (FORBIDDEN_KEY.test(key)) fail('E_INVESTIGATION_PRIVATE_DATA', `${cursor}.${key} is not a portable evidence field.`);
      visit(item, `${cursor}.${key}`);
    });
  }
  visit(value, path);
  return value;
}

export function assertInvestigationScope(value, label = 'scope') {
  unique(value, label, { min: 1, max: 128 });
  const result = value.map((entry, index) => {
    exact(entry, ['repositoryKey', 'path'], `${label}[${index}]`);
    return { repositoryKey: identifier(entry.repositoryKey, `${label}[${index}].repositoryKey`, 64), path: relativePath(entry.path, `${label}[${index}].path`) };
  });
  const ordered = [...result].sort((a, b) => a.repositoryKey.localeCompare(b.repositoryKey) || a.path.localeCompare(b.path));
  if (JSON.stringify(result) !== JSON.stringify(ordered)) fail('E_INVESTIGATION_SCOPE_INVALID', `${label} must use canonical repository/path order.`);
  return result;
}

export function assertInvestigationCommand(value, { label = 'command', allowedEffects = INVESTIGATION_EFFECTS } = {}) {
  exact(value, ['argv', 'effect', 'expectedExitCodes', 'id', 'inputPaths', 'repositoryKey'], label);
  identifier(value.id, `${label}.id`, 64);
  identifier(value.repositoryKey, `${label}.repositoryKey`, 64);
  if (!allowedEffects.includes(value.effect)) fail('E_INVESTIGATION_COMMAND_INVALID', `${label}.effect is not permitted here.`);
  if (!Array.isArray(value.argv) || value.argv.length < 1 || value.argv.length > 32) fail('E_INVESTIGATION_COMMAND_INVALID', `${label}.argv must be one bounded argument vector.`);
  value.argv.forEach((argument, index) => {
    text(argument, `${label}.argv[${index}]`, 512);
    if (argument.includes('\0') || (index === 0 && (argument.includes('/') || argument.includes('\\')))) fail('E_INVESTIGATION_COMMAND_INVALID', `${label}.argv must use a PATH-resolved executable and bounded literal arguments.`);
  });
  unique(value.inputPaths, `${label}.inputPaths`, { max: 128 });
  value.inputPaths.forEach((path, index) => relativePath(path, `${label}.inputPaths[${index}]`));
  unique(value.expectedExitCodes, `${label}.expectedExitCodes`, { min: 1, max: 16 });
  if (value.expectedExitCodes.some((code) => !Number.isSafeInteger(code) || code < 0 || code > 255)) fail('E_INVESTIGATION_COMMAND_INVALID', `${label}.expectedExitCodes contains an invalid exit code.`);
  assertInvestigationPortable(value, label);
  return value;
}

function assertFeature(value) {
  exact(value, ['featureId', 'mode', 'slug'], 'feature');
  if (!['spec-driven', 'default'].includes(value.mode)) fail('E_INVESTIGATION_CONTRACT_INVALID', 'feature.mode is unsupported.');
  if (!/^(?:SPEC|FEAT)-[0-9]{3}$/.test(value.featureId)) fail('E_INVESTIGATION_CONTRACT_INVALID', 'feature.featureId is invalid.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) || value.slug.length > 160) fail('E_INVESTIGATION_CONTRACT_INVALID', 'feature.slug is invalid.');
  return value;
}

export function assertInvestigationAuthority(value) {
  exact(value, ['actorId', 'authorityId', 'diagnosisReceiptHash', 'digest', 'expiresAt', 'issuedAt', 'kind', 'reason', 'schemaVersion', 'scope', 'targetBaselineDigest'], 'authority');
  if (value.kind !== 'investigation-fix-authority' || value.schemaVersion !== INVESTIGATION_SCHEMA_VERSION) fail('E_INVESTIGATION_AUTHORITY_INVALID', 'Fix authority identity is unsupported.');
  if (!/^auth_[a-f0-9]{32}$/.test(value.authorityId)) fail('E_INVESTIGATION_AUTHORITY_INVALID', 'authorityId is invalid.');
  identifier(value.actorId, 'authority.actorId', 160);
  text(value.reason, 'authority.reason');
  digest(value.diagnosisReceiptHash, 'authority.diagnosisReceiptHash');
  digest(value.targetBaselineDigest, 'authority.targetBaselineDigest');
  assertInvestigationScope(value.scope, 'authority.scope');
  date(value.issuedAt, 'authority.issuedAt');
  if (value.expiresAt !== null) date(value.expiresAt, 'authority.expiresAt');
  digest(value.digest, 'authority.digest');
  if (value.digest !== sha256Jcs({ ...value, digest: null })) fail('E_INVESTIGATION_AUTHORITY_INVALID', 'Fix authority digest does not bind the exact authority artifact.');
  assertInvestigationPortable(value);
  return value;
}

export function assertInvestigationRequest(value) {
  const common = ['feature', 'kind', 'mode', 'protocolVersion', 'schemaVersion'];
  const keys = value?.mode === 'diagnose'
    ? [...common, 'question', 'reproduction', 'targetScope']
    : [...common, 'authority', 'diagnosisReceiptHash', 'regression', 'relevantSuite'];
  exact(value, keys, 'investigation request');
  if (value.kind !== 'investigation-request' || value.schemaVersion !== INVESTIGATION_SCHEMA_VERSION || value.protocolVersion !== INVESTIGATION_PROTOCOL_VERSION || !INVESTIGATION_MODES.includes(value.mode)) {
    fail('E_INVESTIGATION_REQUEST_INVALID', 'Investigation request identity is unsupported.');
  }
  assertFeature(value.feature);
  if (value.mode === 'diagnose') {
    text(value.question, 'question');
    assertInvestigationScope(value.targetScope, 'targetScope');
    assertInvestigationCommand(value.reproduction, { label: 'reproduction', allowedEffects: ['read-only'] });
  } else {
    digest(value.diagnosisReceiptHash, 'diagnosisReceiptHash');
    assertInvestigationAuthority(value.authority);
    if (value.authority.diagnosisReceiptHash !== value.diagnosisReceiptHash) fail('E_INVESTIGATION_AUTHORITY_FOREIGN', 'Fix authority is bound to a different diagnosis receipt.');
    assertInvestigationCommand(value.regression, { label: 'regression', allowedEffects: ['read-only'] });
    assertInvestigationCommand(value.relevantSuite, { label: 'relevantSuite', allowedEffects: ['read-only'] });
    if (value.regression.id === value.relevantSuite.id || sha256Jcs(value.regression) === sha256Jcs(value.relevantSuite)) fail('E_INVESTIGATION_COMMAND_INVALID', 'Regression and relevant suite must be distinct named commands.');
  }
  assertInvestigationPortable(value);
  return value;
}

export function assertInvestigationApproval(value, { experimentId, experimentKind, baselineDigest } = {}) {
  exact(value, ['actorId', 'approvalId', 'baselineDigest', 'digest', 'experimentId', 'experimentKind', 'issuedAt', 'kind', 'reason', 'schemaVersion'], 'experiment approval');
  if (value.kind !== 'investigation-experiment-approval' || value.schemaVersion !== INVESTIGATION_SCHEMA_VERSION || !/^app_[a-f0-9]{32}$/.test(value.approvalId)) fail('E_INVESTIGATION_APPROVAL_INVALID', 'Experiment approval identity is unsupported.');
  identifier(value.actorId, 'approval.actorId', 160);
  text(value.reason, 'approval.reason');
  if (!['destructive', 'live', 'network'].includes(value.experimentKind)) fail('E_INVESTIGATION_APPROVAL_INVALID', 'Only risky experiments use independent approval.');
  if (!/^exp_[a-f0-9]{32}$/.test(value.experimentId)) fail('E_INVESTIGATION_APPROVAL_INVALID', 'approval.experimentId is invalid.');
  digest(value.baselineDigest, 'approval.baselineDigest');
  date(value.issuedAt, 'approval.issuedAt');
  digest(value.digest, 'approval.digest');
  if (value.digest !== sha256Jcs({ ...value, digest: null }) || value.experimentId !== experimentId || value.experimentKind !== experimentKind || value.baselineDigest !== baselineDigest) {
    fail('E_INVESTIGATION_APPROVAL_FOREIGN', 'Experiment approval does not bind this exact experiment and baseline.');
  }
  assertInvestigationPortable(value);
  return value;
}

export function investigationArtifactId(prefix, value) {
  return `${prefix}_${sha256Jcs(value).slice(7, 39)}`;
}

export function investigationEventIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('E_INVESTIGATION_EVENT_INVALID', 'Investigation event must be one object.');
  const canonical = structuredClone(value);
  delete canonical.eventId;
  delete canonical.evidence;
  delete canonical.baseline;
  delete canonical.change;
  const eventId = investigationArtifactId('ive', canonical);
  if (value.eventId !== undefined && value.eventId !== eventId) fail('E_INVESTIGATION_EVENT_INVALID', 'eventId does not match canonical submitted bytes.');
  return { canonical, eventId, inputDigest: sha256Jcs(canonical) };
}

export function assertInvestigationExecutionEvidence(value) {
  exact(value, ['commandDigest', 'commandId', 'completedAt', 'evidenceDigest', 'exitCode', 'matchedExpectation', 'outputBytes', 'outputDigest', 'startedAt', 'status', 'truncated'], 'execution evidence');
  identifier(value.commandId, 'evidence.commandId', 64);
  digest(value.commandDigest, 'evidence.commandDigest');
  date(value.startedAt, 'evidence.startedAt');
  date(value.completedAt, 'evidence.completedAt');
  if (!['completed', 'unavailable', 'output-limit'].includes(value.status)) fail('E_INVESTIGATION_EVIDENCE_INVALID', 'Execution evidence status is unsupported.');
  if (value.exitCode !== null && (!Number.isSafeInteger(value.exitCode) || value.exitCode < 0 || value.exitCode > 255)) fail('E_INVESTIGATION_EVIDENCE_INVALID', 'Execution evidence exitCode is invalid.');
  if (typeof value.matchedExpectation !== 'boolean' || typeof value.truncated !== 'boolean' || !Number.isSafeInteger(value.outputBytes) || value.outputBytes < 0) fail('E_INVESTIGATION_EVIDENCE_INVALID', 'Execution evidence bounded fields are invalid.');
  digest(value.outputDigest, 'evidence.outputDigest');
  digest(value.evidenceDigest, 'evidence.evidenceDigest');
  if (value.evidenceDigest !== sha256Jcs({ ...value, evidenceDigest: null })) fail('E_INVESTIGATION_EVIDENCE_INVALID', 'Execution evidence digest does not bind exact evidence.');
  return value;
}

export function assertInvestigationReceipt(value) {
  if (!value || value.kind !== 'investigation-receipt' || value.schemaVersion !== INVESTIGATION_SCHEMA_VERSION || value.protocolVersion !== INVESTIGATION_PROTOCOL_VERSION || value.recordType !== 'receipt') {
    fail('E_INVESTIGATION_RECEIPT_INVALID', 'Investigation receipt identity is unsupported.');
  }
  if (!/^inv_[a-f0-9]{32}$/.test(value.runId ?? '') || !INVESTIGATION_MODES.includes(value.mode) || !['proven', 'unknown', 'blocked', 'passed'].includes(value.state)) fail('E_INVESTIGATION_RECEIPT_INVALID', 'Investigation receipt terminal identity is invalid.');
  digest(value.receiptHash, 'receiptHash');
  if (value.receiptHash !== sha256Jcs({ ...value, receiptHash: null })) fail('E_INVESTIGATION_RECEIPT_INVALID', 'Investigation receipt hash does not bind exact terminal bytes.');
  assertInvestigationPortable(value);
  return value;
}
