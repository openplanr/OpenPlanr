import { createHash } from 'node:crypto';
import { sha256Jcs } from '../protocol/jcs.mjs';
import { PipelineError } from './errors.mjs';

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SCENARIO_ID = /^esc_[a-f0-9]{64}$/u;

/** Self-digest field pair and runtime identity shape for every evaluation contract kind. */
export const EVALUATION_IDENTITY_BINDINGS = Object.freeze({
  'evaluation-scenario': Object.freeze({ prefix: 'esc', width: 64, idField: 'scenarioId', digestField: 'scenarioDigest' }),
  'evaluation-corpus': Object.freeze({ prefix: 'ecp', width: 64, idField: 'corpusId', digestField: 'corpusDigest' }),
  'evaluation-fixture': Object.freeze({ prefix: 'efx', width: 64, idField: 'fixtureId', digestField: 'fixtureDigest' }),
  'evaluation-host-profile': Object.freeze({ prefix: 'ehp', width: 32, idField: 'hostProfileId', digestField: 'profileDigest' }),
  'evaluation-host-profile-registry': Object.freeze({ prefix: 'ehpr', width: 32, idField: 'registryId', digestField: 'registryDigest' }),
  'evaluation-grader-registration': Object.freeze({ prefix: 'egr', width: 32, idField: 'graderId', digestField: 'registrationDigest' }),
  'evaluation-grader-registry': Object.freeze({ prefix: 'egrr', width: 32, idField: 'registryId', digestField: 'registryDigest' }),
  'evaluation-budget': Object.freeze({ prefix: 'ebg', width: 32, idField: 'budgetId', digestField: 'budgetDigest' }),
  'evaluation-gate-policy': Object.freeze({ prefix: 'egp', width: 32, idField: 'policyId', digestField: 'gatePolicyDigest' }),
  'evaluation-observation': Object.freeze({ prefix: 'eob', width: 32, idField: 'observationId', digestField: 'observationDigest' }),
  'evaluation-run-result': Object.freeze({ prefix: 'ers', width: 32, idField: 'runResultId', digestField: 'runResultDigest' }),
  'evaluation-aggregate-report': Object.freeze({ prefix: 'ear', width: 32, idField: 'reportId', digestField: 'reportDigest' }),
  'evaluation-waiver': Object.freeze({ prefix: 'evw', width: 32, idField: 'waiverId', digestField: 'waiverDigest' }),
  'skill-certification-receipt': Object.freeze({ prefix: 'scr', width: 32, idField: 'receiptId', digestField: 'receiptDigest' }),
});

/** Every input digest a scenario's evidence is bound to. Reuse survives only when all of them match. */
export const EVALUATION_EVIDENCE_INPUTS = Object.freeze([
  'budgetDigest',
  'fixtureSetDigest',
  'graderRegistrationDigest',
  'hostProfileDigest',
  'packageDigest',
  'scenarioDigest',
  'sourceDigest',
]);

export const EVALUATION_EVIDENCE_INVALIDATION_REASONS = Object.freeze(['input-digest-changed', 'scenario-absent']);

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('E_EVALUATION_IDENTITY_INVALID', `${label} must be one JSON object.`, 'Pass the parsed contract record itself, not a wrapper or array.');
  }
  return value;
}

function bindingFor(kind) {
  if (!Object.prototype.hasOwnProperty.call(EVALUATION_IDENTITY_BINDINGS, kind)) {
    fail('E_EVALUATION_IDENTITY_INVALID', `Contract kind "${String(kind)}" has no evaluation identity binding.`, `Use one of: ${Object.keys(EVALUATION_IDENTITY_BINDINGS).join(', ')}.`);
  }
  return EVALUATION_IDENTITY_BINDINGS[kind];
}

/** SHA-256 over exact bytes. Fixture and package content digests bind bytes, not canonical JSON. */
export function evaluationContentDigest(bytes) {
  if (typeof bytes !== 'string' && !ArrayBuffer.isView(bytes) && !(bytes instanceof ArrayBuffer)) {
    fail('E_EVALUATION_IDENTITY_INVALID', 'Content digest input must be a string, TypedArray, or ArrayBuffer.', 'Read the source file as bytes and pass the buffer.');
  }
  let buffer;
  if (typeof bytes === 'string') buffer = Buffer.from(bytes, 'utf8');
  else if (bytes instanceof ArrayBuffer) buffer = Buffer.from(new Uint8Array(bytes));
  else buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

/** Canonical digest of a record with the named fields removed, so identity fields are never self-referential. */
export function evaluationPayloadDigest(value, omitFields = []) {
  plainObject(value, 'evaluation record');
  if (!Array.isArray(omitFields)) fail('E_EVALUATION_IDENTITY_INVALID', 'omitFields must be an array of field names.', 'Pass the identity and digest field names to omit.');
  const payload = { ...value };
  for (const field of omitFields) delete payload[field];
  return sha256Jcs(payload);
}

/** Canonical digest a record of this kind must carry in its own digest field. */
export function evaluationSelfDigest(value, kind) {
  const binding = bindingFor(kind);
  return evaluationPayloadDigest(value, [binding.idField, binding.digestField]);
}

export function evaluationIdentityFrom(digest, kind) {
  const binding = bindingFor(kind);
  if (typeof digest !== 'string' || !DIGEST.test(digest)) {
    fail('E_EVALUATION_IDENTITY_INVALID', `${kind} identity requires an exact SHA-256 digest.`, 'Compute the digest with evaluationSelfDigest before deriving the identity.');
  }
  return `${binding.prefix}_${digest.slice(7, 7 + binding.width)}`;
}

/** Identity a record of this kind must carry, derived from its own canonical bytes. */
export function deriveEvaluationIdentity(value, kind) {
  const binding = bindingFor(kind);
  const digest = evaluationSelfDigest(value, kind);
  return Object.freeze({ id: evaluationIdentityFrom(digest, kind), digest, idField: binding.idField, digestField: binding.digestField });
}

export function assertEvaluationIdentity(value, kind) {
  const binding = bindingFor(kind);
  plainObject(value, `${kind} record`);
  const derived = deriveEvaluationIdentity(value, kind);
  if (value[binding.digestField] !== derived.digest) {
    fail('E_EVALUATION_DIGEST_MISMATCH', `${kind}.${binding.digestField} does not bind this record's canonical bytes.`, `Recompute ${binding.digestField} from the record with ${binding.idField} and ${binding.digestField} removed.`, { expected: derived.digest, actual: value[binding.digestField] ?? null });
  }
  if (value[binding.idField] !== derived.id) {
    fail('E_EVALUATION_IDENTITY_FOREIGN', `${kind}.${binding.idField} is a foreign identity for these bytes.`, `Set ${binding.idField} to ${derived.id}.`, { expected: derived.id, actual: value[binding.idField] ?? null });
  }
  return value;
}

/**
 * Refuse a JSON document that repeats a key inside one object.
 * JSON.parse keeps the last occurrence silently, which would let a foreign field
 * overwrite a governed one without any reader noticing.
 */
export function assertUniqueJsonKeys(text, label = 'source document') {
  if (typeof text !== 'string') fail('E_EVALUATION_CONTRACT_INVALID', `${label} must be decoded JSON text.`, 'Decode the source bytes as UTF-8 before parsing.');
  const stack = [];
  let expectKey = false;
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      const start = index;
      index += 1;
      while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1;
      if (index >= text.length) fail('E_EVALUATION_CONTRACT_INVALID', `${label} ends inside a string literal.`, 'Repair the document so it is well-formed JSON.');
      const literal = text.slice(start, index + 1);
      index += 1;
      if (expectKey) {
        const keys = stack[stack.length - 1]?.keys;
        const key = JSON.parse(literal);
        if (!keys || keys.has(key)) fail('E_EVALUATION_CONTRACT_INVALID', `${label} repeats the object key "${key}".`, 'Remove the duplicate field; a repeated key is refused, never merged.');
        keys.add(key);
        expectKey = false;
      }
      continue;
    }
    if (character === '{') { stack.push({ object: true, keys: new Set() }); expectKey = true; }
    else if (character === '[') { stack.push({ object: false }); expectKey = false; }
    else if (character === '}' || character === ']') { stack.pop(); expectKey = false; }
    else if (character === ',') expectKey = Boolean(stack[stack.length - 1]?.object);
    else if (character === ':') expectKey = false;
    index += 1;
  }
  return text;
}

/**
 * Scenario identity from its own source bytes.
 * Canonicalization happens before hashing, so identity survives reformatting but
 * changes on any byte that changes the record's meaning.
 */
export function evaluationScenarioIdentityFromSource(sourceText, label = 'scenario source') {
  assertUniqueJsonKeys(sourceText, label);
  let parsed;
  try {
    parsed = JSON.parse(sourceText);
  } catch (cause) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label} is not parseable JSON: ${cause.message}`, 'Repair the source document before deriving a scenario identity.');
  }
  plainObject(parsed, label);
  const derived = deriveEvaluationIdentity(parsed, 'evaluation-scenario');
  return Object.freeze({ scenarioId: derived.id, scenarioDigest: derived.digest, record: parsed });
}

function evidenceIndex(entries, label) {
  if (!Array.isArray(entries) || entries.length > 4_096) {
    fail('E_EVALUATION_EVIDENCE_STALE', `${label} must be a bounded array of scenario evidence bindings.`, 'Pass at most 4096 entries, one per scenario.');
  }
  const index = new Map();
  entries.forEach((entry, position) => {
    const cursor = `${label}[${position}]`;
    plainObject(entry, cursor);
    const keys = Object.keys(entry).sort();
    if (keys.length !== 2 || keys[0] !== 'inputs' || keys[1] !== 'scenarioId') {
      fail('E_EVALUATION_EVIDENCE_STALE', `${cursor} must carry exactly scenarioId and inputs.`, 'Remove unknown fields; evidence bindings are closed.');
    }
    if (typeof entry.scenarioId !== 'string' || !SCENARIO_ID.test(entry.scenarioId)) {
      fail('E_EVALUATION_EVIDENCE_STALE', `${cursor}.scenarioId is not a scenario identity.`, 'Use the esc_ identity derived from the scenario source bytes.');
    }
    plainObject(entry.inputs, `${cursor}.inputs`);
    const inputKeys = Object.keys(entry.inputs).sort();
    if (inputKeys.length !== EVALUATION_EVIDENCE_INPUTS.length || inputKeys.some((key, position2) => key !== EVALUATION_EVIDENCE_INPUTS[position2])) {
      fail('E_EVALUATION_EVIDENCE_STALE', `${cursor}.inputs must declare every bound input digest.`, `Declare exactly: ${EVALUATION_EVIDENCE_INPUTS.join(', ')}.`);
    }
    for (const field of EVALUATION_EVIDENCE_INPUTS) {
      if (typeof entry.inputs[field] !== 'string' || !DIGEST.test(entry.inputs[field])) {
        fail('E_EVALUATION_EVIDENCE_STALE', `${cursor}.inputs.${field} must be an exact SHA-256 digest.`, 'Bind every input by digest; a name or version is not a binding.');
      }
    }
    if (index.has(entry.scenarioId)) {
      fail('E_EVALUATION_EVIDENCE_STALE', `${label} repeats scenario ${entry.scenarioId}.`, 'Record one evidence binding per scenario identity.');
    }
    index.set(entry.scenarioId, entry);
  });
  return index;
}

/**
 * Digest-bound evidence reuse. Prior evidence carries forward only where every
 * bound input digest is byte-identical; anything else is enumerated, never inferred.
 */
export function evaluationEvidenceReuse(priorEvidence, currentInputs) {
  const prior = evidenceIndex(priorEvidence, 'priorEvidence');
  const current = evidenceIndex(currentInputs, 'currentInputs');
  const reusable = [];
  const invalidated = [];
  for (const [scenarioId, entry] of prior) {
    const now = current.get(scenarioId);
    if (!now) {
      invalidated.push(Object.freeze({ scenarioId, reason: 'scenario-absent', changedInputs: Object.freeze([...EVALUATION_EVIDENCE_INPUTS]) }));
      continue;
    }
    const changedInputs = EVALUATION_EVIDENCE_INPUTS.filter((field) => entry.inputs[field] !== now.inputs[field]);
    if (changedInputs.length > 0) invalidated.push(Object.freeze({ scenarioId, reason: 'input-digest-changed', changedInputs: Object.freeze(changedInputs) }));
    else reusable.push(scenarioId);
  }
  const unevaluated = [...current.keys()].filter((scenarioId) => !prior.has(scenarioId));
  return Object.freeze({
    reusable: Object.freeze(reusable.sort()),
    invalidated: Object.freeze(invalidated.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId))),
    unevaluated: Object.freeze(unevaluated.sort()),
  });
}
