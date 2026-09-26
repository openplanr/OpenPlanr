import { PipelineError } from './errors.mjs';

export const EVALUATION_REDACTION_POLICY_VERSION = '1.0.0';

/** Field names that can only ever hold raw evidence, a filesystem location, or credential material. */
export const EVALUATION_PUBLISH_FORBIDDEN_KEYS = Object.freeze([
  'absolutePath',
  'accessToken',
  'apiKey',
  'authorization',
  'bearer',
  'body',
  'command',
  'completion',
  'content',
  'credential',
  'credentials',
  'cwd',
  'env',
  'environment',
  'filePath',
  'fixturePath',
  'homeDir',
  'image',
  'imageData',
  'message',
  'messages',
  'modelOutput',
  'output',
  'password',
  'path',
  'prompt',
  'promptText',
  'prompts',
  'rawOutput',
  'rawPrompt',
  'rawTrace',
  'response',
  'screenshot',
  'screenshots',
  'secret',
  'secrets',
  'sourcePath',
  'stack',
  'stackTrace',
  'stderr',
  'stdout',
  'text',
  'token',
  'trace',
  'traces',
  'transcript',
]);

export const EVALUATION_REDACTION_DECLARATIONS = Object.freeze([
  'absolutePathsExcluded',
  'credentialMaterialExcluded',
  'modelOutputExcluded',
  'rawPromptsExcluded',
  'screenshotsExcluded',
  'tracesExcluded',
]);

const FORBIDDEN_KEY = new Set(EVALUATION_PUBLISH_FORBIDDEN_KEYS.map((key) => key.toLowerCase()));
const KEY = /^[A-Za-z][A-Za-z0-9]*$|^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

const PRIVATE_MATERIAL =
  /(?:\b(?:password|secret|credential|api[_-]?key|private[_-]?key|bearer|authorization)\b\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\b(?:sk|pk|rk|ghp|gho|ghs|ghu|xox[abprs])[_-][A-Za-z0-9_-]{16,}\b|(?:^|[\s"'`(])\/(?:Users|home|private|var|tmp|etc|root|opt|mnt)\/\S+|\b[A-Za-z]:\\[^\s"'`,]+|\n\s*at\s+\S+\s*\()/iu;

/** Runtime identities, digests, timestamps, versions, closed enum members, terminal reasons. */
const SAFE_STRING = Object.freeze([
  /^sha256:[a-f0-9]{64}$/u,
  /^[a-z]{2,4}_[a-f0-9]{32}(?:[a-f0-9]{32})?$/u,
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/u,
  /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u,
  /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u,
  /^[A-Z][A-Z0-9_]{2,63}$/u,
  /^[A-Z]{3}$/u,
  /^(?:>=|<=|==)$/u,
]);

/** Actor identities are published deliberately, so they are allowed only where a contract declares one. */
const SAFE_BY_KEY = Object.freeze({
  identity: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u,
  keyIdentity: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u,
  ownerSignatureIdentity: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u,
});

const MAX_STRING = 160;
const MAX_DEPTH = 12;
const MAX_ITEMS = 4_096;
const MAX_BYTES = 1_048_576;

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

/** True when text carries a secret, a token, an absolute filesystem path, or a stack frame. */
export function evaluationCarriesPrivateMaterial(text) {
  return typeof text === 'string' && PRIVATE_MATERIAL.test(text);
}

export function assertEvaluationNoPrivateMaterial(text, label) {
  if (evaluationCarriesPrivateMaterial(text)) {
    fail(
      'E_EVALUATION_PUBLISH_UNSAFE',
      `${label} carries credential material, an absolute path, or a raw stack frame.`,
      'Reference the value by logical name or by digest instead of carrying it.',
    );
  }
  return text;
}

function assertSafeString(value, key, cursor) {
  if (value.length > MAX_STRING) {
    fail(
      'E_EVALUATION_PUBLISH_UNSAFE',
      `${cursor} exceeds ${MAX_STRING} characters.`,
      'A publishable report carries counters, rates, enums, and digests — never free text.',
    );
  }
  assertEvaluationNoPrivateMaterial(value, cursor);
  const scoped =
    key !== null && Object.prototype.hasOwnProperty.call(SAFE_BY_KEY, key)
      ? SAFE_BY_KEY[key]
      : null;
  if (scoped?.test(value)) return;
  if (SAFE_STRING.some((pattern) => pattern.test(value))) return;
  fail(
    'E_EVALUATION_PUBLISH_UNSAFE',
    `${cursor} is not a recognized publishable value.`,
    'Publish digests, runtime identities, RFC 3339 timestamps, versions, closed enum members, or terminal reason codes only.',
    { value: `${value.slice(0, 24)}…` },
  );
}

/**
 * Fail-closed publish gate. Every value must be recognizable as safe; anything
 * unrecognized is refused rather than passed through.
 */
export function assertEvaluationPublishSafe(value, label = '$') {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (cause) {
    fail(
      'E_EVALUATION_PUBLISH_UNSAFE',
      `${label} is not serializable JSON: ${cause.message}`,
      'Publish a plain JSON projection built from the aggregate report.',
    );
  }
  if (serialized === undefined)
    fail(
      'E_EVALUATION_PUBLISH_UNSAFE',
      `${label} is not a JSON value.`,
      'Publish a plain JSON projection built from the aggregate report.',
    );
  if (Buffer.byteLength(serialized) > MAX_BYTES)
    fail(
      'E_EVALUATION_PUBLISH_UNSAFE',
      `${label} exceeds ${MAX_BYTES} bytes.`,
      'Reduce the per-scenario projection; raw evidence never belongs in a published report.',
    );

  function visit(entry, cursor, key, depth) {
    if (depth > MAX_DEPTH)
      fail(
        'E_EVALUATION_PUBLISH_UNSAFE',
        `${cursor} nests deeper than ${MAX_DEPTH} levels.`,
        'Flatten the projection; deep nesting hides unreviewed evidence.',
      );
    if (entry === null || typeof entry === 'boolean') return;
    if (typeof entry === 'number') {
      if (!Number.isSafeInteger(entry))
        fail(
          'E_EVALUATION_PUBLISH_UNSAFE',
          `${cursor} must be a safe integer.`,
          'Publish counters, basis points, and integer measurements only.',
        );
      return;
    }
    if (typeof entry === 'string') {
      assertSafeString(entry, key, cursor);
      return;
    }
    if (Array.isArray(entry)) {
      if (entry.length > MAX_ITEMS)
        fail(
          'E_EVALUATION_PUBLISH_UNSAFE',
          `${cursor} exceeds ${MAX_ITEMS} entries.`,
          'Bound the projection before publishing it.',
        );
      entry.forEach((item, index) => visit(item, `${cursor}[${index}]`, key, depth + 1));
      return;
    }
    if (typeof entry !== 'object' || Object.getPrototypeOf(entry) !== Object.prototype) {
      fail(
        'E_EVALUATION_PUBLISH_UNSAFE',
        `${cursor} is not a plain JSON value.`,
        'Publish plain objects, arrays, integers, booleans, null, and recognized strings only.',
      );
    }
    for (const [childKey, item] of Object.entries(entry)) {
      const childCursor = `${cursor}.${childKey}`;
      if (!KEY.test(childKey))
        fail(
          'E_EVALUATION_PUBLISH_UNSAFE',
          `${childCursor} is not a closed field name.`,
          'Use camelCase or kebab-case metric names.',
        );
      if (FORBIDDEN_KEY.has(childKey.toLowerCase())) {
        fail(
          'E_EVALUATION_PUBLISH_UNSAFE',
          `${childCursor} names raw evidence, a filesystem location, or credential material.`,
          'Carry the value by digest in the local run result; it never reaches a published report.',
        );
      }
      visit(item, childCursor, childKey, depth + 1);
    }
  }

  visit(value, label, null, 0);
  return value;
}

export function assertEvaluationRedactionDeclaration(value, label = 'redaction') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      'E_EVALUATION_PUBLISH_UNSAFE',
      `${label} must be one object declaring every exclusion.`,
      'Declare the redaction policy explicitly; an absent declaration is not an exclusion.',
    );
  }
  const expected = [...EVALUATION_REDACTION_DECLARATIONS, 'policyVersion'].sort();
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      'E_EVALUATION_PUBLISH_UNSAFE',
      `${label} has missing or unknown declarations.`,
      `Declare exactly: ${expected.join(', ')}.`,
    );
  }
  if (value.policyVersion !== EVALUATION_REDACTION_POLICY_VERSION) {
    fail(
      'E_EVALUATION_PUBLISH_UNSAFE',
      `${label}.policyVersion must be the explicit version ${EVALUATION_REDACTION_POLICY_VERSION}.`,
      'Pin the redaction policy version; an implicit version is refused.',
    );
  }
  for (const declaration of EVALUATION_REDACTION_DECLARATIONS) {
    if (value[declaration] !== true) {
      fail(
        'E_EVALUATION_PUBLISH_UNSAFE',
        `${label}.${declaration} must be true.`,
        'A report that does not exclude every private class is not publishable.',
      );
    }
  }
  return value;
}

/**
 * The gate between a local run result and a publishable aggregate report.
 * Structural validation is the caller's; this refuses anything unsafe to publish.
 */
export function assertEvaluationAggregatePublishable(report, label = 'aggregate report') {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    fail(
      'E_EVALUATION_PUBLISH_UNSAFE',
      `${label} must be one object.`,
      'Pass the parsed aggregate report record.',
    );
  }
  if (report.kind !== 'evaluation-aggregate-report') {
    fail(
      'E_EVALUATION_PUBLISH_UNSAFE',
      `${label} is not an aggregate report.`,
      'The aggregate report is the only publishable projection of a run.',
      { kind: report.kind ?? null },
    );
  }
  assertEvaluationRedactionDeclaration(report.redaction, `${label}.redaction`);
  return assertEvaluationPublishSafe(report, label);
}
