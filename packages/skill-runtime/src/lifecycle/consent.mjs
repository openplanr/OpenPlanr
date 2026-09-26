import { verifyDocumentDigest, withDocumentDigest } from '@openplanr/protocol/canonical-json';
import { validateProtocolArtifact } from '@openplanr/protocol/contracts';

import { assertIsoDate, assertNonBlank, freezeJson } from './internal.mjs';

export const DATA_FEATURES = Object.freeze(['learning', 'telemetry', 'external-data']);
export const OPERATION_CLASSES = Object.freeze([
  'planning',
  'read-only',
  'implementation',
  'external-effect',
  'destructive',
]);
export const DEFAULT_LIFECYCLE_SETTINGS = Object.freeze({
  learning: false,
  history: false,
  telemetry: false,
  sync: false,
  updates: false,
  externalData: false,
});

const DATA_FEATURE_SET = new Set(DATA_FEATURES);
const OPERATION_CLASS_SET = new Set(OPERATION_CLASSES);
const CONSENT_DECISIONS = new Set(['granted', 'declined', 'withdrawn']);
const CONSENT_ACTIONS = Object.freeze({
  learning: 'consent.learning',
  telemetry: 'consent.telemetry',
  'external-data': 'consent.external-data',
});

function consentConfirmationArguments(skillId, subject, decision) {
  return ['--skill', skillId, '--subject', subject, '--decision', decision];
}

function confirmationError(
  confirmation,
  { skillId, subject, decision, recordedAt, projectIdentity },
) {
  const errors = validateProtocolArtifact('guided-confirmation', confirmation, {
    protocolVersion: '1.2.0',
  });
  if (errors.length > 0)
    return 'confirmation must match the Protocol guided-confirmation contract.';
  if (confirmation.state !== 'confirmed')
    return 'confirmation must be a completed guided confirmation.';
  if (confirmation.actionId !== CONSENT_ACTIONS[subject]) {
    return `confirmation.actionId must be ${CONSENT_ACTIONS[subject]} for ${subject} consent.`;
  }
  if (confirmation.projectIdentity !== projectIdentity) {
    return 'confirmation must be bound to the active project identity.';
  }
  const expectedArguments = consentConfirmationArguments(skillId, subject, decision);
  if (
    confirmation.arguments.length !== expectedArguments.length ||
    confirmation.arguments.some((value, index) => value !== expectedArguments[index])
  ) {
    return 'confirmation arguments must be bound to the exact skill, subject, and decision.';
  }

  const createdAt = Date.parse(confirmation.createdAt);
  const confirmedAt = Date.parse(confirmation.confirmedAt);
  const expiresAt = Date.parse(confirmation.expiresAt);
  const capturedAt = Date.parse(recordedAt);
  if (!(createdAt <= confirmedAt && confirmedAt <= capturedAt && capturedAt <= expiresAt)) {
    return 'confirmation must be captured after confirmation and before its Protocol expiry.';
  }
  return null;
}

function validConsentRecord(record, subject, skillId, projectIdentity) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (
    validateProtocolArtifact('skill-consent-record', record, { protocolVersion: '1.6.0' }).length >
    0
  ) {
    return false;
  }
  return (
    record.subject === subject &&
    record.skillId === skillId &&
    CONSENT_DECISIONS.has(record.decision) &&
    verifyDocumentDigest(record) &&
    confirmationError(record.confirmation, {
      skillId,
      subject,
      decision: record.decision,
      recordedAt: record.recordedAt,
      projectIdentity,
    }) === null
  );
}

function latestConsent(consents, subject, skillId, projectIdentity) {
  return (
    consents
      .filter((record) => validConsentRecord(record, subject, skillId, projectIdentity))
      .sort(
        (left, right) =>
          Date.parse(right.recordedAt) - Date.parse(left.recordedAt) ||
          String(right.consentId).localeCompare(String(left.consentId)),
      )[0] ?? null
  );
}

function configuredBoolean(configured, key) {
  const value = configured[key];
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new TypeError(`configured.${key} must be a boolean.`);
  return value;
}

/** Create the optional Protocol record from an already-completed guided interaction. */
export function createConsentRecord({
  consentId,
  skillId,
  subject,
  decision,
  recordedAt,
  projectIdentity,
  confirmation,
} = {}) {
  assertNonBlank(consentId, 'consentId');
  assertNonBlank(skillId, 'skillId');
  if (!DATA_FEATURE_SET.has(subject))
    throw new TypeError(`Unknown data-feature consent subject: ${subject}.`);
  if (!CONSENT_DECISIONS.has(decision))
    throw new TypeError(`Unknown consent decision: ${decision}.`);
  if (!confirmation || typeof confirmation !== 'object' || Array.isArray(confirmation)) {
    throw new TypeError('confirmation must be an existing guided confirmation.');
  }
  assertNonBlank(projectIdentity, 'projectIdentity');
  const capturedAt = assertIsoDate(recordedAt, 'recordedAt');
  const error = confirmationError(confirmation, {
    skillId,
    subject,
    decision,
    recordedAt: capturedAt,
    projectIdentity,
  });
  if (error) throw new TypeError(error);
  const record = withDocumentDigest({
    kind: 'skill-consent-record',
    schemaVersion: '1.0.0',
    protocolVersion: '1.6.0',
    documentVersion: '1.0.0',
    digestAlgorithm: 'sha256',
    canonicalization: 'rfc8785',
    consentId,
    skillId,
    subject,
    decision,
    recordedAt: capturedAt,
    confirmation,
  });
  if (
    validateProtocolArtifact('skill-consent-record', record, { protocolVersion: '1.6.0' }).length >
    0
  ) {
    throw new TypeError('consent record must match the Protocol skill-consent-record contract.');
  }
  return freezeJson(record);
}

/** Resolve one explicit data-feature decision without changing runtime behavior. */
export function resolveDataFeatureConsent({
  skillId,
  subject,
  projectIdentity,
  consents = [],
} = {}) {
  assertNonBlank(skillId, 'skillId');
  if (!DATA_FEATURE_SET.has(subject))
    throw new TypeError(`Unknown data-feature consent subject: ${subject}.`);
  if (!Array.isArray(consents)) throw new TypeError('consents must be an array.');
  const record = latestConsent(consents, subject, skillId, projectIdentity);
  return freezeJson({
    decision: record?.decision ?? 'unset',
    consentId: record?.consentId ?? null,
  });
}

/**
 * Resolve lifecycle configuration. Configuration can explicitly enable local
 * history/sync/update behavior; data collection additionally needs a current
 * granted record. Headless mode never invents that grant.
 */
export function resolveLifecycleSettings({
  skillId,
  projectIdentity,
  configured = {},
  consents = [],
  headless = false,
} = {}) {
  assertNonBlank(skillId, 'skillId');
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    throw new TypeError('configured must be an object.');
  }
  if (!Array.isArray(consents)) throw new TypeError('consents must be an array.');
  if (typeof headless !== 'boolean') throw new TypeError('headless must be a boolean.');

  const decisions = Object.fromEntries(
    DATA_FEATURES.map((subject) => [
      subject,
      resolveDataFeatureConsent({ skillId, subject, projectIdentity, consents }).decision,
    ]),
  );
  const wantsLearning = configuredBoolean(configured, 'learning');
  const wantsTelemetry = configuredBoolean(configured, 'telemetry');
  const wantsExternalData = configuredBoolean(configured, 'externalData');
  const enabledWithConsent = (requested, subject) => requested && decisions[subject] === 'granted';
  const settings = {
    learning: enabledWithConsent(wantsLearning, 'learning'),
    history: configuredBoolean(configured, 'history'),
    telemetry: enabledWithConsent(wantsTelemetry, 'telemetry'),
    sync: configuredBoolean(configured, 'sync'),
    updates: configuredBoolean(configured, 'updates'),
    externalData: enabledWithConsent(wantsExternalData, 'external-data'),
  };

  const diagnostics = [];
  for (const [key, subject] of [
    ['learning', 'learning'],
    ['telemetry', 'telemetry'],
    ['externalData', 'external-data'],
  ]) {
    if (configuredBoolean(configured, key) && !settings[key]) {
      diagnostics.push({
        feature: key,
        status: headless && decisions[subject] === 'unset' ? 'unavailable' : 'disabled',
        reason:
          decisions[subject] === 'unset'
            ? 'explicit-opt-in-required'
            : `consent-${decisions[subject]}`,
      });
    }
  }

  return freezeJson({ settings, decisions, diagnostics });
}

/** Classify an effect for routing; the host remains the execution boundary. */
export function classifyOperation(operationClass) {
  if (!OPERATION_CLASS_SET.has(operationClass)) {
    throw new TypeError(`Unknown operation class: ${operationClass}.`);
  }
  const definitions = {
    planning: { effect: 'none', execution: 'local' },
    'read-only': { effect: 'read-only', execution: 'local' },
    implementation: { effect: 'project-write', execution: 'host' },
    'external-effect': { effect: 'external', execution: 'host' },
    destructive: { effect: 'destructive', execution: 'host' },
  };
  return freezeJson({ operationClass, ...definitions[operationClass] });
}
