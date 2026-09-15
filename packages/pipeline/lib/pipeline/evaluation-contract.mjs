import { PipelineError } from './errors.mjs';
import { assertEvaluationIdentity } from './evaluation-identity.mjs';
import { assertEvaluationAggregatePublishable, assertEvaluationNoPrivateMaterial } from './evaluation-redaction.mjs';

export const EVALUATION_PROTOCOL_VERSION = '1.4.0';
export const EVALUATION_SCHEMA_VERSION = '1.0.0';

export const EVALUATION_PROMPT_CLASSES = Object.freeze(['positive', 'negative', 'ambiguous', 'permission-denied']);
export const EVALUATION_TRIGGER_OUTCOMES = Object.freeze(['invoke', 'decline', 'clarify', 'refuse']);
export const EVALUATION_RISK_CLASSES = Object.freeze(['read-only', 'local-write', 'destructive', 'external-effect']);
export const EVALUATION_CAPABILITIES = Object.freeze(['file-read', 'file-write', 'command-execute', 'network', 'browser', 'credential', 'git', 'publish', 'deploy']);
export const EVALUATION_EFFECTFUL_CAPABILITIES = Object.freeze(['file-write', 'command-execute', 'network', 'browser', 'credential', 'git', 'publish', 'deploy']);
export const EVALUATION_GRADER_TYPES = Object.freeze(['deterministic-schema', 'deterministic-behaviour', 'live-model-judgement']);
export const EVALUATION_ABSENCE_CODES = Object.freeze(['grader-missing', 'grader-errored', 'grader-unavailable', 'host-unavailable', 'fixture-unavailable', 'budget-exceeded', 'not-run']);
export const EVALUATION_METRICS = Object.freeze(['trigger-precision', 'trigger-recall', 'journey-completion', 'schema-validity', 'asset-parity', 'export-parity', 'package-parity', 'finding-severity-p0', 'finding-severity-p1', 'latency-regression', 'cost-regression']);
export const EVALUATION_UNWAIVABLE_METRICS = Object.freeze(['schema-validity', 'package-parity', 'finding-severity-p0', 'finding-severity-p1']);
export const EVALUATION_WAIVABLE_METRICS = Object.freeze(EVALUATION_METRICS.filter((metric) => !EVALUATION_UNWAIVABLE_METRICS.includes(metric)));
export const EVALUATION_WAIVER_REASON_CODES = Object.freeze(['accepted-risk', 'known-defect', 'environment-limitation', 'deferred-remediation', 'external-dependency']);

/** A waiver with no horizon is a permanent exemption, so validity is capped rather than left open. */
export const EVALUATION_WAIVER_MAX_HORIZON_DAYS = 90;

/** Mandatory certification thresholds. A policy that states anything else is not this policy. */
export const EVALUATION_GATE_THRESHOLDS = Object.freeze({
  'trigger-precision': Object.freeze({ comparator: '>=', unit: 'basis-points', threshold: 9500, waivable: true }),
  'trigger-recall': Object.freeze({ comparator: '>=', unit: 'basis-points', threshold: 9500, waivable: true }),
  'journey-completion': Object.freeze({ comparator: '>=', unit: 'basis-points', threshold: 9000, waivable: true }),
  'schema-validity': Object.freeze({ comparator: '==', unit: 'basis-points', threshold: 10_000, waivable: false }),
  'asset-parity': Object.freeze({ comparator: '==', unit: 'basis-points', threshold: 10_000, waivable: true }),
  'export-parity': Object.freeze({ comparator: '==', unit: 'basis-points', threshold: 10_000, waivable: true }),
  'package-parity': Object.freeze({ comparator: '==', unit: 'basis-points', threshold: 10_000, waivable: false }),
  'finding-severity-p0': Object.freeze({ comparator: '<=', unit: 'count', threshold: 0, waivable: false }),
  'finding-severity-p1': Object.freeze({ comparator: '<=', unit: 'count', threshold: 0, waivable: false }),
  'latency-regression': Object.freeze({ comparator: '<=', unit: 'basis-points', threshold: 2_000, waivable: true, measuredAgainst: 'frozen-baseline' }),
  'cost-regression': Object.freeze({ comparator: '<=', unit: 'basis-points', threshold: 2_000, waivable: true, measuredAgainst: 'frozen-baseline' }),
});

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const PUBLISHED_NAME = /^[a-z][a-z0-9-]{1,63}$/u;
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const SKILL_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u;
const TERMINAL_REASON = /^[A-Z][A-Z0-9_]{2,63}$/u;
const ACTOR_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RELATIVE_PATH = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/u;
const SCENARIO_SOURCE_PATH = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*\.json$/u;
const CREDENTIAL_REF_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u;
const WAIVER_STATEMENT = /^[A-Za-z0-9][A-Za-z0-9 ,.()'-]{9,279}$/u;
const MARKUP = /(?:<[^>]+>|\{\{[^}]+\}\})/u;
const AUTHORITY_KEY = /^(?:authority|authorities|grant|grants|granted|capability|capabilities|entitlement|permit|permission(?:s)?Granted|promotion|activation|approval|approvals|releaseAuthority|publishAuthority|deployAuthority|tagAuthority|pushAuthority|marketplacePromotion|roomActivation)$/iu;

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label} must be one plain JSON object.`, 'Pass the parsed contract record itself.');
  }
  return value;
}

function exact(value, keys, label) {
  object(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const unknown = actual.filter((key) => !expected.includes(key));
    const missing = expected.filter((key) => !actual.includes(key));
    fail('E_EVALUATION_CONTRACT_INVALID', `${label} has missing or unknown fields.`, 'Contracts are closed; remove unknown fields and supply every required field.', { missing, unknown });
  }
  return value;
}

function envelope(value, kind, label) {
  object(value, label);
  if (value.kind !== kind) fail('E_EVALUATION_CONTRACT_INVALID', `${label} is not a ${kind} record.`, `Set kind to "${kind}".`, { kind: value.kind ?? null });
  if (value.schemaVersion !== EVALUATION_SCHEMA_VERSION || value.protocolVersion !== EVALUATION_PROTOCOL_VERSION) {
    fail('E_EVALUATION_VERSION_UNSUPPORTED', `${label} carries an implicit or unsupported contract version.`, `Declare schemaVersion "${EVALUATION_SCHEMA_VERSION}" and protocolVersion "${EVALUATION_PROTOCOL_VERSION}" explicitly.`, { schemaVersion: value.schemaVersion ?? null, protocolVersion: value.protocolVersion ?? null });
  }
  return value;
}

function constant(value, expected, label) {
  if (value !== expected) fail('E_EVALUATION_CONTRACT_INVALID', `${label} must be ${JSON.stringify(expected)}.`, 'This field is a constant; no other value is representable.', { actual: value ?? null });
  return value;
}

function member(value, allowed, label) {
  if (!allowed.includes(value)) fail('E_EVALUATION_CONTRACT_INVALID', `${label} is not a member of its closed vocabulary.`, `Use one of: ${allowed.join(', ')}.`, { actual: value ?? null });
  return value;
}

function pattern(value, expression, label, hint) {
  if (typeof value !== 'string' || !expression.test(value)) fail('E_EVALUATION_CONTRACT_INVALID', `${label} does not match its closed pattern.`, hint, { actual: typeof value === 'string' ? value.slice(0, 48) : null });
  return value;
}

function digest(value, label) {
  return pattern(value, DIGEST, label, 'Bind the input by an exact sha256:<64 hex> digest.');
}

function boolean(value, label) {
  if (typeof value !== 'boolean') fail('E_EVALUATION_CONTRACT_INVALID', `${label} must be an explicit boolean.`, 'Declare the value; an absent declaration is never a default.');
  return value;
}

function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label} must be an integer between ${min} and ${max}.`, 'Use whole units; measurements are integers, never floats.', { actual: value ?? null });
  }
  return value;
}

const counter = (value, label) => integer(value, label, 0, 1_000_000);
const rate = (value, label) => integer(value, label, 0, 10_000);

function timestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label} must be one canonical RFC 3339 UTC timestamp.`, 'Use the exact form 2026-01-01T00:00:00.000Z so identical instants canonicalize identically.', { actual: value ?? null });
  }
  return value;
}

function boundedText(value, label, max) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value.trim().length === 0) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label} must be non-blank text of at most ${max} characters.`, 'Supply a statement a reader can act on.');
  }
  return assertEvaluationNoPrivateMaterial(value, label);
}

function title(value, label) {
  boundedText(value, label, 160);
  if (value !== value.trim()) fail('E_EVALUATION_CONTRACT_INVALID', `${label} must not carry leading or trailing whitespace.`, 'Trim the title so identical titles canonicalize identically.');
  if (MARKUP.test(value)) fail('E_EVALUATION_CONTRACT_INVALID', `${label} must not carry markup or template syntax.`, 'Titles are plain text.');
  return value;
}

function boundedArray(value, label, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label} must be an array of ${min} to ${max} entries.`, 'Bound the collection explicitly.');
  }
  if (new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label} repeats an entry.`, 'Duplicate members are refused, never collapsed.');
  }
  return value;
}

function ascending(values, label, compare) {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(values[index - 1], values[index]) >= 0) {
      fail('E_EVALUATION_MEMBER_ORDER', `${label} is not in canonical ascending order.`, 'Sort members canonically so identical membership always yields an identical digest.', { at: index });
    }
  }
  return values;
}

/** Version ordering is numeric, so 1.9.0 precedes 1.10.0. */
function compareVersion(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
}

const byNameThenVersion = (nameField, versionField) => (left, right) =>
  left[nameField].localeCompare(right[nameField]) || compareVersion(left[versionField], right[versionField]);

function skillIdentity(value, label) {
  exact(value, ['id', 'version'], label);
  pattern(value.id, IDENTIFIER, `${label}.id`, 'Use a lowercase closed skill identifier.');
  if (value.id.length < 2 || value.id.length > 64) fail('E_EVALUATION_CONTRACT_INVALID', `${label}.id must be 2 to 64 characters.`, 'Use a lowercase closed skill identifier.');
  pattern(value.version, SEMVER, `${label}.version`, 'Use an explicit semantic version.');
  return value;
}

function provenance(value, label) {
  exact(value, ['packageName', 'packageVersion', 'sourceDigest'], label);
  pattern(value.packageName, NAME, `${label}.packageName`, 'Use the published package name.');
  pattern(value.packageVersion, SEMVER, `${label}.packageVersion`, 'Use an explicit semantic version.');
  digest(value.sourceDigest, `${label}.sourceDigest`);
  return value;
}

/** Refuse any field a reader could mistake for release, publish, or activation authority. */
function assertNoAuthorityClaim(value, label) {
  const visit = (entry, cursor, depth) => {
    if (depth > 12 || !entry || typeof entry !== 'object') return;
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${cursor}[${index}]`, depth + 1));
      return;
    }
    for (const [key, item] of Object.entries(entry)) {
      if (AUTHORITY_KEY.test(key)) {
        fail('E_EVALUATION_RECEIPT_AUTHORITY_CLAIM', `${cursor}.${key} would read as release authority.`, 'A certification receipt records readiness only; it grants nothing.');
      }
      visit(item, `${cursor}.${key}`, depth + 1);
    }
  };
  visit(value, label, 0);
  return value;
}

export function assertEvaluationScenario(value, label = 'scenario') {
  envelope(value, 'evaluation-scenario', label);
  exact(value, ['kind', 'schemaVersion', 'protocolVersion', 'scenarioId', 'scenarioDigest', 'title', 'intent', 'skill', 'hostProfileRef', 'promptClass', 'expectedTrigger', 'declaredPermissions', 'riskClass', 'fixtureRefs', 'budgetRef'], label);
  title(value.title, `${label}.title`);
  boundedText(value.intent, `${label}.intent`, 2_048);
  skillIdentity(value.skill, `${label}.skill`);

  exact(value.hostProfileRef, ['hostProfileId', 'hostProfileDigest'], `${label}.hostProfileRef`);
  pattern(value.hostProfileRef.hostProfileId, IDENTIFIER, `${label}.hostProfileRef.hostProfileId`, 'Reference the host profile by its closed identifier.');
  digest(value.hostProfileRef.hostProfileDigest, `${label}.hostProfileRef.hostProfileDigest`);

  exact(value.budgetRef, ['budgetId', 'budgetDigest'], `${label}.budgetRef`);
  pattern(value.budgetRef.budgetId, IDENTIFIER, `${label}.budgetRef.budgetId`, 'Reference the budget by its closed identifier.');
  digest(value.budgetRef.budgetDigest, `${label}.budgetRef.budgetDigest`);

  member(value.promptClass, EVALUATION_PROMPT_CLASSES, `${label}.promptClass`);
  member(value.riskClass, EVALUATION_RISK_CLASSES, `${label}.riskClass`);

  exact(value.expectedTrigger, ['outcome', 'rationale'], `${label}.expectedTrigger`);
  member(value.expectedTrigger.outcome, EVALUATION_TRIGGER_OUTCOMES, `${label}.expectedTrigger.outcome`);
  boundedText(value.expectedTrigger.rationale, `${label}.expectedTrigger.rationale`, 2_048);

  boundedArray(value.declaredPermissions, `${label}.declaredPermissions`, 0, 32);
  const capabilities = new Set();
  value.declaredPermissions.forEach((entry, index) => {
    const cursor = `${label}.declaredPermissions[${index}]`;
    exact(entry, ['capability', 'decision'], cursor);
    member(entry.capability, EVALUATION_CAPABILITIES, `${cursor}.capability`);
    member(entry.decision, ['granted', 'denied'], `${cursor}.decision`);
    if (capabilities.has(entry.capability)) fail('E_EVALUATION_CONTRACT_INVALID', `${cursor}.capability is declared twice.`, 'Declare each capability once; a repeated decision is ambiguous.');
    capabilities.add(entry.capability);
  });

  boundedArray(value.fixtureRefs, `${label}.fixtureRefs`, 1, 32);
  let promptFixtures = 0;
  value.fixtureRefs.forEach((entry, index) => {
    const cursor = `${label}.fixtureRefs[${index}]`;
    exact(entry, ['fixtureId', 'contentDigest', 'role'], cursor);
    pattern(entry.fixtureId, /^efx_[a-f0-9]{64}$/u, `${cursor}.fixtureId`, 'Use the efx_ identity derived from the fixture record.');
    digest(entry.contentDigest, `${cursor}.contentDigest`);
    member(entry.role, ['prompt', 'context', 'expected-output', 'asset'], `${cursor}.role`);
    if (entry.role === 'prompt') promptFixtures += 1;
  });
  if (promptFixtures !== 1) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label}.fixtureRefs must reference exactly one prompt fixture.`, 'Prompt text lives in a fixture so no identity-bearing record carries a raw prompt.', { promptFixtures });
  }

  const expectedOutcome = { positive: ['invoke'], negative: ['decline'], ambiguous: ['clarify', 'decline'], 'permission-denied': ['refuse'] }[value.promptClass];
  if (!expectedOutcome.includes(value.expectedTrigger.outcome)) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label}.expectedTrigger.outcome is not the correct terminal behaviour for prompt class ${value.promptClass}.`, `Use one of: ${expectedOutcome.join(', ')}.`);
  }
  if (value.promptClass === 'permission-denied' && !value.declaredPermissions.some((entry) => entry.decision === 'denied')) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label} declares no denied capability for a permission-denied prompt class.`, 'Declare the capability the host denies; an absent capability is denied but never assumed.');
  }
  if (value.riskClass === 'read-only' && value.declaredPermissions.some((entry) => entry.decision === 'granted' && EVALUATION_EFFECTFUL_CAPABILITIES.includes(entry.capability))) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label} grants an effectful capability under a read-only risk class.`, 'Raise the risk class or withdraw the grant; the risk class states the widest blast radius.');
  }

  return assertEvaluationIdentity(value, 'evaluation-scenario');
}

export function assertEvaluationCorpus(value, { sourceDigests = null, label = 'corpus' } = {}) {
  envelope(value, 'evaluation-corpus', label);
  exact(value, ['kind', 'schemaVersion', 'protocolVersion', 'corpusId', 'corpusDigest', 'title', 'skill', 'members'], label);
  title(value.title, `${label}.title`);
  skillIdentity(value.skill, `${label}.skill`);
  boundedArray(value.members, `${label}.members`, 1, 1_024);

  const seenScenarios = new Set();
  const seenPaths = new Set();
  value.members.forEach((entry, index) => {
    const cursor = `${label}.members[${index}]`;
    exact(entry, ['scenarioId', 'scenarioDigest', 'sourcePath'], cursor);
    pattern(entry.scenarioId, /^esc_[a-f0-9]{64}$/u, `${cursor}.scenarioId`, 'Use the esc_ identity derived from the scenario source bytes.');
    digest(entry.scenarioDigest, `${cursor}.scenarioDigest`);
    pattern(entry.sourcePath, SCENARIO_SOURCE_PATH, `${cursor}.sourcePath`, 'Use a normalized repository-relative .json path.');
    if (entry.scenarioId.slice(4) !== entry.scenarioDigest.slice(7)) {
      fail('E_EVALUATION_IDENTITY_FOREIGN', `${cursor}.scenarioId is a foreign identity for its own digest.`, 'Derive the member identity from the member digest.');
    }
    if (seenScenarios.has(entry.scenarioId)) fail('E_EVALUATION_CONTRACT_INVALID', `${cursor}.scenarioId is already a member.`, 'A duplicate scenario identity is refused, never deduplicated.');
    if (seenPaths.has(entry.sourcePath)) fail('E_EVALUATION_CONTRACT_INVALID', `${cursor}.sourcePath is already a member.`, 'Each member has its own source document.');
    seenScenarios.add(entry.scenarioId);
    seenPaths.add(entry.sourcePath);
  });
  ascending(value.members, `${label}.members`, (left, right) => left.scenarioId.localeCompare(right.scenarioId));

  if (sourceDigests !== null) {
    object(sourceDigests, `${label} sourceDigests`);
    for (const entry of value.members) {
      const recomputed = sourceDigests[entry.sourcePath];
      if (recomputed === undefined) {
        fail('E_EVALUATION_DIGEST_MISMATCH', `${label} member ${entry.scenarioId} has no recomputed digest for ${entry.sourcePath}.`, 'Recompute every member digest from its source bytes; an unread member is not a valid member.');
      }
      if (recomputed !== entry.scenarioDigest) {
        fail('E_EVALUATION_DIGEST_MISMATCH', `${label} member ${entry.scenarioId} no longer matches its source bytes.`, 'Reseal the corpus against the current scenario sources; evidence never carries across a changed digest.', { sourcePath: entry.sourcePath, expected: entry.scenarioDigest, actual: recomputed });
      }
    }
  }

  return assertEvaluationIdentity(value, 'evaluation-corpus');
}

export function assertEvaluationFixture(value, label = 'fixture') {
  envelope(value, 'evaluation-fixture', label);
  exact(value, ['kind', 'schemaVersion', 'protocolVersion', 'fixtureId', 'fixtureDigest', 'mediaKind', 'byteLength', 'contentDigest', 'sourcePath', 'retention', 'containsCredentialMaterial'], label);
  member(value.mediaKind, ['text', 'markdown', 'json', 'source', 'html', 'image', 'archive', 'binary'], `${label}.mediaKind`);
  integer(value.byteLength, `${label}.byteLength`, 0, 67_108_864);
  digest(value.contentDigest, `${label}.contentDigest`);
  pattern(value.sourcePath, RELATIVE_PATH, `${label}.sourcePath`, 'Use a normalized repository-relative path; absolute paths and dot segments are refused.');
  constant(value.retention, 'local-only', `${label}.retention`);
  constant(value.containsCredentialMaterial, false, `${label}.containsCredentialMaterial`);
  return assertEvaluationIdentity(value, 'evaluation-fixture');
}

export function assertEvaluationHostProfile(value, label = 'host profile') {
  envelope(value, 'evaluation-host-profile', label);
  exact(value, ['kind', 'schemaVersion', 'protocolVersion', 'hostProfileId', 'host', 'profileVersion', 'runtime', 'platform', 'capabilityTier', 'permissionModel', 'outputModes', 'skillHostSupport', 'certifiedFullPipelineRuntime', 'adapterBinding', 'provenance', 'profileDigest'], label);
  pattern(value.host, NAME, `${label}.host`, 'Use the lowercase host name.');
  pattern(value.profileVersion, SEMVER, `${label}.profileVersion`, 'Use an explicit semantic version.');
  member(value.runtime, ['cli', 'desktop', 'web', 'mobile', 'ide-extension', 'headless-browser'], `${label}.runtime`);
  member(value.platform, ['darwin', 'linux', 'win32', 'browser', 'mobile'], `${label}.platform`);
  member(value.capabilityTier, ['artifact', 'workflow', 'product'], `${label}.capabilityTier`);

  exact(value.permissionModel, ['mode', 'promptSurface', 'toolIsolation', 'escalation'], `${label}.permissionModel`);
  member(value.permissionModel.mode, ['prompted', 'preauthorized', 'sandboxed', 'denied'], `${label}.permissionModel.mode`);
  member(value.permissionModel.promptSurface, ['terminal', 'chat', 'native-dialog', 'none'], `${label}.permissionModel.promptSurface`);
  member(value.permissionModel.toolIsolation, ['enforced', 'advisory', 'none', 'enforced-read-only'], `${label}.permissionModel.toolIsolation`);
  constant(value.permissionModel.escalation, 'refused', `${label}.permissionModel.escalation`);

  boundedArray(value.outputModes, `${label}.outputModes`, 1, 8);
  value.outputModes.forEach((mode, index) => member(mode, ['text', 'markdown', 'json', 'file', 'artifact', 'image', 'web-page'], `${label}.outputModes[${index}]`));

  boolean(value.skillHostSupport, `${label}.skillHostSupport`);
  boolean(value.certifiedFullPipelineRuntime, `${label}.certifiedFullPipelineRuntime`);

  if (value.adapterBinding !== null) {
    const cursor = `${label}.adapterBinding`;
    exact(value.adapterBinding, ['contractId', 'schemaVersion', 'protocolVersion', 'adapterId', 'adapterVersion', 'recordDigest'], cursor);
    constant(value.adapterBinding.contractId, 'adapter-registry', `${cursor}.contractId`);
    constant(value.adapterBinding.schemaVersion, '1.1.0', `${cursor}.schemaVersion`);
    constant(value.adapterBinding.protocolVersion, EVALUATION_PROTOCOL_VERSION, `${cursor}.protocolVersion`);
    member(value.adapterBinding.adapterId, ['claude-code', 'codex', 'cursor'], `${cursor}.adapterId`);
    pattern(value.adapterBinding.adapterVersion, SEMVER, `${cursor}.adapterVersion`, 'Use an explicit semantic version.');
    digest(value.adapterBinding.recordDigest, `${cursor}.recordDigest`);
  } else if (value.certifiedFullPipelineRuntime) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label} claims a certified full pipeline runtime with no adapter binding.`, 'Bind the registered adapter record by digest, or declare certifiedFullPipelineRuntime false.');
  }

  provenance(value.provenance, `${label}.provenance`);
  return assertEvaluationIdentity(value, 'evaluation-host-profile');
}

export function assertEvaluationHostProfileRegistry(value, label = 'host profile registry') {
  envelope(value, 'evaluation-host-profile-registry', label);
  exact(value, ['kind', 'schemaVersion', 'protocolVersion', 'registryId', 'registryVersion', 'digestAlgorithm', 'canonicalization', 'memberOrder', 'profiles', 'registryDigest'], label);
  constant(value.registryVersion, '1.0.0', `${label}.registryVersion`);
  constant(value.digestAlgorithm, 'sha256', `${label}.digestAlgorithm`);
  constant(value.canonicalization, 'jcs', `${label}.canonicalization`);
  constant(value.memberOrder, 'host-ascending', `${label}.memberOrder`);
  boundedArray(value.profiles, `${label}.profiles`, 1, 64);
  const seen = new Set();
  value.profiles.forEach((profile, index) => {
    assertEvaluationHostProfile(profile, `${label}.profiles[${index}]`);
    if (seen.has(profile.hostProfileId)) fail('E_EVALUATION_CONTRACT_INVALID', `${label}.profiles[${index}].hostProfileId is already registered.`, 'Register each host profile identity once.');
    seen.add(profile.hostProfileId);
  });
  ascending(value.profiles, `${label}.profiles`, byNameThenVersion('host', 'profileVersion'));
  return assertEvaluationIdentity(value, 'evaluation-host-profile-registry');
}

export function assertEvaluationGraderRegistration(value, label = 'grader registration') {
  envelope(value, 'evaluation-grader-registration', label);
  exact(value, ['kind', 'schemaVersion', 'protocolVersion', 'graderId', 'graderName', 'graderVersion', 'graderType', 'declaredInputs', 'determinism', 'telemetry', 'consent', 'credentialReference', 'outputContract', 'unavailableBehavior', 'blocksContractValidation', 'provenance', 'registrationDigest'], label);
  pattern(value.graderName, NAME, `${label}.graderName`, 'Use the lowercase grader name.');
  pattern(value.graderVersion, SEMVER, `${label}.graderVersion`, 'Use an explicit semantic version.');
  member(value.graderType, EVALUATION_GRADER_TYPES, `${label}.graderType`);
  constant(value.telemetry, false, `${label}.telemetry`);
  constant(value.unavailableBehavior, 'typed-absence', `${label}.unavailableBehavior`);
  constant(value.blocksContractValidation, false, `${label}.blocksContractValidation`);

  boundedArray(value.declaredInputs, `${label}.declaredInputs`, 1, 16);
  const seenInputs = new Set();
  value.declaredInputs.forEach((entry, index) => {
    const cursor = `${label}.declaredInputs[${index}]`;
    exact(entry, ['inputKind', 'required', 'binding'], cursor);
    member(entry.inputKind, ['scenario', 'fixture', 'host-profile', 'budget', 'skill-source', 'declared-output', 'package-manifest', 'run-trace'], `${cursor}.inputKind`);
    boolean(entry.required, `${cursor}.required`);
    constant(entry.binding, 'digest', `${cursor}.binding`);
    if (seenInputs.has(entry.inputKind)) fail('E_EVALUATION_GRADER_INVALID', `${cursor}.inputKind is declared twice.`, 'Declare each input kind once.');
    seenInputs.add(entry.inputKind);
  });

  const determinism = `${label}.determinism`;
  exact(value.determinism, ['deterministic', 'modelCall', 'network', 'credentialUse', 'filesystemWrite', 'replay'], determinism);
  boolean(value.determinism.deterministic, `${determinism}.deterministic`);
  boolean(value.determinism.modelCall, `${determinism}.modelCall`);
  boolean(value.determinism.network, `${determinism}.network`);
  boolean(value.determinism.credentialUse, `${determinism}.credentialUse`);
  constant(value.determinism.filesystemWrite, false, `${determinism}.filesystemWrite`);
  member(value.determinism.replay, ['identical-output', 'not-guaranteed'], `${determinism}.replay`);

  exact(value.outputContract, ['contractId', 'schemaVersion', 'protocolVersion'], `${label}.outputContract`);
  constant(value.outputContract.contractId, 'evaluation-observation', `${label}.outputContract.contractId`);
  constant(value.outputContract.schemaVersion, EVALUATION_SCHEMA_VERSION, `${label}.outputContract.schemaVersion`);
  constant(value.outputContract.protocolVersion, EVALUATION_PROTOCOL_VERSION, `${label}.outputContract.protocolVersion`);
  provenance(value.provenance, `${label}.provenance`);

  const deterministic = value.graderType !== 'live-model-judgement';
  if (deterministic) {
    if (!value.determinism.deterministic || value.determinism.modelCall || value.determinism.network || value.determinism.credentialUse || value.determinism.replay !== 'identical-output') {
      fail('E_EVALUATION_GRADER_INVALID', `${label} is a deterministic grader that declares a model call, network access, a credential use, or non-identical replay.`, 'A deterministic grader must declare no model call, no network, no credential use, and identical-output replay.');
    }
    if (value.consent !== null || value.credentialReference !== null) {
      fail('E_EVALUATION_GRADER_INVALID', `${label} is a deterministic grader carrying consent or a credential reference.`, 'Set consent and credentialReference to null; the deterministic path holds neither.');
    }
  } else {
    if (value.determinism.deterministic || !value.determinism.modelCall || value.determinism.replay !== 'not-guaranteed') {
      fail('E_EVALUATION_GRADER_INVALID', `${label} is a live-model grader that claims determinism.`, 'Declare deterministic false, modelCall true, and not-guaranteed replay.');
    }
    const consent = `${label}.consent`;
    exact(value.consent, ['required', 'mode', 'scope', 'recordDigest', 'grantedAt', 'expiresAt', 'noDefaultChoice'], consent);
    constant(value.consent.required, true, `${consent}.required`);
    constant(value.consent.mode, 'named-owner-current', `${consent}.mode`);
    member(value.consent.scope, ['single-run', 'single-corpus'], `${consent}.scope`);
    digest(value.consent.recordDigest, `${consent}.recordDigest`);
    timestamp(value.consent.grantedAt, `${consent}.grantedAt`);
    timestamp(value.consent.expiresAt, `${consent}.expiresAt`);
    constant(value.consent.noDefaultChoice, true, `${consent}.noDefaultChoice`);
    if (Date.parse(value.consent.expiresAt) <= Date.parse(value.consent.grantedAt)) {
      fail('E_EVALUATION_GRADER_INVALID', `${consent}.expiresAt must be after grantedAt.`, 'Consent is bounded; an unbounded grant is refused.');
    }
    const credential = `${label}.credentialReference`;
    exact(value.credentialReference, ['refKind', 'refName', 'custody'], credential);
    member(value.credentialReference.refKind, ['environment-name', 'os-custody-key'], `${credential}.refKind`);
    pattern(value.credentialReference.refName, CREDENTIAL_REF_NAME, `${credential}.refName`, 'Reference the credential by logical name; a credential value is never representable here.');
    assertEvaluationNoPrivateMaterial(value.credentialReference.refName, `${credential}.refName`);
    constant(value.credentialReference.custody, 'host-owned', `${credential}.custody`);
  }

  return assertEvaluationIdentity(value, 'evaluation-grader-registration');
}

export function assertEvaluationGraderRegistry(value, label = 'grader registry') {
  envelope(value, 'evaluation-grader-registry', label);
  exact(value, ['kind', 'schemaVersion', 'protocolVersion', 'registryId', 'registryVersion', 'digestAlgorithm', 'canonicalization', 'memberOrder', 'graders', 'registryDigest'], label);
  constant(value.registryVersion, '1.0.0', `${label}.registryVersion`);
  constant(value.digestAlgorithm, 'sha256', `${label}.digestAlgorithm`);
  constant(value.canonicalization, 'jcs', `${label}.canonicalization`);
  constant(value.memberOrder, 'graderName-ascending', `${label}.memberOrder`);
  boundedArray(value.graders, `${label}.graders`, 1, 64);
  const seen = new Set();
  value.graders.forEach((grader, index) => {
    assertEvaluationGraderRegistration(grader, `${label}.graders[${index}]`);
    if (seen.has(grader.graderId)) fail('E_EVALUATION_CONTRACT_INVALID', `${label}.graders[${index}].graderId is already registered.`, 'Register each grader identity once.');
    seen.add(grader.graderId);
  });
  ascending(value.graders, `${label}.graders`, byNameThenVersion('graderName', 'graderVersion'));
  return assertEvaluationIdentity(value, 'evaluation-grader-registry');
}

/** A grader may never certify the skill it is part of. */
export function assertEvaluationGraderIndependence(registration, subject, label = 'grader registration') {
  assertEvaluationGraderRegistration(registration, label);
  exact(subject, ['skillId', 'skillSourceDigest'], `${label} subject`);
  pattern(subject.skillId, PUBLISHED_NAME, `${label} subject.skillId`, 'Name the skill under evaluation.');
  digest(subject.skillSourceDigest, `${label} subject.skillSourceDigest`);
  if (registration.graderName === subject.skillId || registration.provenance.sourceDigest === subject.skillSourceDigest) {
    fail('E_EVALUATION_GRADER_NOT_INDEPENDENT', `${label} shares its identity or source bytes with the skill under evaluation.`, 'Grade a skill with a grader that is not part of it.', { graderName: registration.graderName, skillId: subject.skillId });
  }
  return registration;
}

export function assertEvaluationBudget(value, label = 'budget') {
  envelope(value, 'evaluation-budget', label);
  exact(value, ['kind', 'schemaVersion', 'protocolVersion', 'budgetId', 'carriesMeasurement', 'scope', 'ceilings', 'baseline', 'budgetDigest'], label);
  constant(value.carriesMeasurement, false, `${label}.carriesMeasurement`);

  exact(value.scope, ['kind', 'id'], `${label}.scope`);
  member(value.scope.kind, ['corpus', 'skill', 'scenario'], `${label}.scope.kind`);
  pattern(value.scope.id, IDENTIFIER, `${label}.scope.id`, 'Name the scope by its closed identifier.');

  const ceilings = `${label}.ceilings`;
  exact(value.ceilings, ['latencyMsP50Ceiling', 'latencyMsP95Ceiling', 'inputTokensCeiling', 'outputTokensCeiling', 'totalTokensCeiling', 'costEstimateCurrency', 'costEstimateMicrosCeiling', 'permissionPromptCeiling', 'retryCeiling'], ceilings);
  integer(value.ceilings.latencyMsP50Ceiling, `${ceilings}.latencyMsP50Ceiling`, 1, 86_400_000);
  integer(value.ceilings.latencyMsP95Ceiling, `${ceilings}.latencyMsP95Ceiling`, 1, 86_400_000);
  integer(value.ceilings.inputTokensCeiling, `${ceilings}.inputTokensCeiling`, 0, 100_000_000);
  integer(value.ceilings.outputTokensCeiling, `${ceilings}.outputTokensCeiling`, 0, 100_000_000);
  integer(value.ceilings.totalTokensCeiling, `${ceilings}.totalTokensCeiling`, 0, 100_000_000);
  constant(value.ceilings.costEstimateCurrency, 'USD', `${ceilings}.costEstimateCurrency`);
  integer(value.ceilings.costEstimateMicrosCeiling, `${ceilings}.costEstimateMicrosCeiling`, 0, 1_000_000_000_000);
  counter(value.ceilings.permissionPromptCeiling, `${ceilings}.permissionPromptCeiling`);
  counter(value.ceilings.retryCeiling, `${ceilings}.retryCeiling`);
  if (value.ceilings.latencyMsP95Ceiling < value.ceilings.latencyMsP50Ceiling) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${ceilings}.latencyMsP95Ceiling is below the p50 ceiling.`, 'A p95 ceiling is never tighter than its p50 ceiling.');
  }
  if (value.ceilings.totalTokensCeiling < value.ceilings.inputTokensCeiling || value.ceilings.totalTokensCeiling < value.ceilings.outputTokensCeiling) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${ceilings}.totalTokensCeiling is below a component ceiling.`, 'The total ceiling covers both the input and the output ceiling.');
  }

  const baseline = `${label}.baseline`;
  exact(value.baseline, ['frozen', 'baselineDigest', 'capturedAt'], baseline);
  constant(value.baseline.frozen, true, `${baseline}.frozen`);
  digest(value.baseline.baselineDigest, `${baseline}.baselineDigest`);
  timestamp(value.baseline.capturedAt, `${baseline}.capturedAt`);

  return assertEvaluationIdentity(value, 'evaluation-budget');
}

export function assertEvaluationGatePolicy(value, label = 'gate policy') {
  envelope(value, 'evaluation-gate-policy', label);
  exact(value, ['kind', 'schemaVersion', 'protocolVersion', 'policyId', 'budgetDigest', 'baselineDigest', 'gates', 'gatePolicyDigest'], label);
  digest(value.budgetDigest, `${label}.budgetDigest`);
  digest(value.baselineDigest, `${label}.baselineDigest`);
  exact(value.gates, EVALUATION_METRICS, `${label}.gates`);

  for (const metric of EVALUATION_METRICS) {
    const cursor = `${label}.gates["${metric}"]`;
    const expected = EVALUATION_GATE_THRESHOLDS[metric];
    exact(value.gates[metric], Object.keys(expected), cursor);
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (value.gates[metric][field] !== expectedValue) {
        fail('E_EVALUATION_GATE_POLICY_INVALID', `${cursor}.${field} does not state the mandatory certification threshold.`, `This gate is fixed at ${JSON.stringify(expectedValue)}; a policy that lowers or widens it is not this policy.`, { metric, field, expected: expectedValue, actual: value.gates[metric][field] ?? null });
      }
    }
    if (EVALUATION_UNWAIVABLE_METRICS.includes(metric) && value.gates[metric].waivable !== false) {
      fail('E_EVALUATION_GATE_POLICY_INVALID', `${cursor} marks an unwaivable gate as waivable.`, 'Schema validity, package parity, and P0/P1 findings can never be waived.');
    }
  }

  return assertEvaluationIdentity(value, 'evaluation-gate-policy');
}

export function assertEvaluationObservation(value, { subject = null, label = 'observation' } = {}) {
  envelope(value, 'evaluation-observation', label);
  exact(value, ['kind', 'schemaVersion', 'protocolVersion', 'observationId', 'runId', 'scenario', 'grader', 'hostProfile', 'fixtures', 'packageDigest', 'budgetDigest', 'outcome', 'terminalReason', 'graderOutputDigest', 'absence', 'observedAt', 'observationDigest'], label);
  pattern(value.runId, /^eru_[a-f0-9]{32}$/u, `${label}.runId`, 'Bind the observation to its run identity.');

  const scenario = `${label}.scenario`;
  exact(value.scenario, ['scenarioId', 'scenarioDigest', 'corpusDigest', 'promptClass'], scenario);
  pattern(value.scenario.scenarioId, /^esc_[a-f0-9]{64}$/u, `${scenario}.scenarioId`, 'Use the esc_ identity derived from the scenario source bytes.');
  digest(value.scenario.scenarioDigest, `${scenario}.scenarioDigest`);
  digest(value.scenario.corpusDigest, `${scenario}.corpusDigest`);
  member(value.scenario.promptClass, EVALUATION_PROMPT_CLASSES, `${scenario}.promptClass`);
  if (value.scenario.scenarioId.slice(4) !== value.scenario.scenarioDigest.slice(7)) {
    fail('E_EVALUATION_IDENTITY_FOREIGN', `${scenario}.scenarioId is a foreign identity for its own digest.`, 'Observations bind the scenario whose bytes were actually run.');
  }

  const grader = `${label}.grader`;
  exact(value.grader, ['graderId', 'graderVersion', 'graderType', 'registrationDigest', 'registryDigest'], grader);
  pattern(value.grader.graderId, /^egr_[a-f0-9]{32}$/u, `${grader}.graderId`, 'Bind the registered grader identity.');
  pattern(value.grader.graderVersion, SEMVER, `${grader}.graderVersion`, 'Use an explicit semantic version.');
  member(value.grader.graderType, EVALUATION_GRADER_TYPES, `${grader}.graderType`);
  digest(value.grader.registrationDigest, `${grader}.registrationDigest`);
  digest(value.grader.registryDigest, `${grader}.registryDigest`);

  const hostProfile = `${label}.hostProfile`;
  exact(value.hostProfile, ['hostProfileId', 'profileDigest', 'registryDigest'], hostProfile);
  pattern(value.hostProfile.hostProfileId, /^ehp_[a-f0-9]{32}$/u, `${hostProfile}.hostProfileId`, 'Bind the registered host profile identity.');
  digest(value.hostProfile.profileDigest, `${hostProfile}.profileDigest`);
  digest(value.hostProfile.registryDigest, `${hostProfile}.registryDigest`);

  boundedArray(value.fixtures, `${label}.fixtures`, 1, 32);
  value.fixtures.forEach((entry, index) => {
    const cursor = `${label}.fixtures[${index}]`;
    exact(entry, ['fixtureId', 'contentDigest'], cursor);
    pattern(entry.fixtureId, /^efx_[a-f0-9]{64}$/u, `${cursor}.fixtureId`, 'Bind the fixture identity.');
    digest(entry.contentDigest, `${cursor}.contentDigest`);
  });

  digest(value.packageDigest, `${label}.packageDigest`);
  digest(value.budgetDigest, `${label}.budgetDigest`);
  member(value.outcome, ['pass', 'fail', 'absent'], `${label}.outcome`);
  pattern(value.terminalReason, TERMINAL_REASON, `${label}.terminalReason`, 'Use an upper-case terminal reason code.');
  timestamp(value.observedAt, `${label}.observedAt`);

  if (value.outcome === 'absent') {
    const absence = `${label}.absence`;
    exact(value.absence, ['code', 'reason', 'treatedAsPass', 'recoveryDisposition'], absence);
    member(value.absence.code, EVALUATION_ABSENCE_CODES, `${absence}.code`);
    boundedText(value.absence.reason, `${absence}.reason`, 2_048);
    member(value.absence.recoveryDisposition, ['rerun', 'register-grader', 'refresh-fixture', 'escalate'], `${absence}.recoveryDisposition`);
    if (value.absence.treatedAsPass !== false) {
      fail('E_EVALUATION_ABSENCE_INVALID', `${absence}.treatedAsPass must be false.`, 'A missing, errored, or unavailable grader is a typed absence and can never be read as a pass.');
    }
    if (value.graderOutputDigest !== null) {
      fail('E_EVALUATION_ABSENCE_INVALID', `${label}.graderOutputDigest must be null for a typed absence.`, 'An absent observation has no grader output to bind.');
    }
  } else {
    if (value.absence !== null) {
      fail('E_EVALUATION_ABSENCE_INVALID', `${label}.absence must be null for a ${value.outcome} outcome.`, 'A recorded result and a typed absence are mutually exclusive.');
    }
    digest(value.graderOutputDigest, `${label}.graderOutputDigest`);
  }

  if (subject !== null) {
    exact(subject, ['registration', 'skill'], `${label} subject`);
    object(subject.registration, `${label} subject.registration`);
    if (subject.registration.graderId !== value.grader.graderId || subject.registration.registrationDigest !== value.grader.registrationDigest) {
      fail('E_EVALUATION_GRADER_INVALID', `${label} subject.registration is not the grader that produced this observation.`, 'Pass the registration the observation binds by digest.');
    }
    assertEvaluationGraderIndependence(subject.registration, subject.skill, `${label} subject.registration`);
  }
  return assertEvaluationIdentity(value, 'evaluation-observation');
}

export function assertEvaluationRunResult(value, label = 'run result') {
  envelope(value, 'evaluation-run-result', label);
  exact(value, ['kind', 'schemaVersion', 'protocolVersion', 'runResultId', 'runId', 'visibility', 'publishable', 'evidenceTransport', 'corpusDigest', 'graderRegistryDigest', 'hostProfileRegistryDigest', 'hostProfiles', 'budgetDigest', 'gatePolicyDigest', 'packageDigest', 'sourceDigest', 'observations', 'measurements', 'findingCounts', 'rawEvidence', 'terminalReason', 'startedAt', 'completedAt', 'runResultDigest'], label);
  pattern(value.runId, /^eru_[a-f0-9]{32}$/u, `${label}.runId`, 'Bind the run identity.');
  constant(value.visibility, 'local', `${label}.visibility`);
  constant(value.publishable, false, `${label}.publishable`);
  constant(value.evidenceTransport, 'digest-only', `${label}.evidenceTransport`);
  for (const field of ['corpusDigest', 'graderRegistryDigest', 'hostProfileRegistryDigest', 'budgetDigest', 'gatePolicyDigest', 'packageDigest', 'sourceDigest']) {
    digest(value[field], `${label}.${field}`);
  }

  boundedArray(value.hostProfiles, `${label}.hostProfiles`, 1, 32);
  value.hostProfiles.forEach((entry, index) => {
    const cursor = `${label}.hostProfiles[${index}]`;
    exact(entry, ['hostProfileId', 'profileDigest'], cursor);
    pattern(entry.hostProfileId, /^ehp_[a-f0-9]{32}$/u, `${cursor}.hostProfileId`, 'Bind the registered host profile identity.');
    digest(entry.profileDigest, `${cursor}.profileDigest`);
  });

  boundedArray(value.observations, `${label}.observations`, 1, 4_096);
  const seenObservations = new Set();
  value.observations.forEach((entry, index) => {
    const cursor = `${label}.observations[${index}]`;
    exact(entry, ['observationId', 'observationDigest', 'scenarioDigest', 'outcome'], cursor);
    pattern(entry.observationId, /^eob_[a-f0-9]{32}$/u, `${cursor}.observationId`, 'Bind the observation identity.');
    digest(entry.observationDigest, `${cursor}.observationDigest`);
    digest(entry.scenarioDigest, `${cursor}.scenarioDigest`);
    member(entry.outcome, ['pass', 'fail', 'absent'], `${cursor}.outcome`);
    if (seenObservations.has(entry.observationId)) fail('E_EVALUATION_CONTRACT_INVALID', `${cursor}.observationId is recorded twice.`, 'Record each observation once.');
    seenObservations.add(entry.observationId);
  });

  const measurements = `${label}.measurements`;
  exact(value.measurements, ['latencyMsP50', 'latencyMsP95', 'inputTokens', 'outputTokens', 'totalTokens', 'costEstimateCurrency', 'costEstimateMicros', 'permissionPrompts', 'retries'], measurements);
  integer(value.measurements.latencyMsP50, `${measurements}.latencyMsP50`, 0, 86_400_000);
  integer(value.measurements.latencyMsP95, `${measurements}.latencyMsP95`, 0, 86_400_000);
  integer(value.measurements.inputTokens, `${measurements}.inputTokens`, 0, 100_000_000);
  integer(value.measurements.outputTokens, `${measurements}.outputTokens`, 0, 100_000_000);
  integer(value.measurements.totalTokens, `${measurements}.totalTokens`, 0, 100_000_000);
  constant(value.measurements.costEstimateCurrency, 'USD', `${measurements}.costEstimateCurrency`);
  integer(value.measurements.costEstimateMicros, `${measurements}.costEstimateMicros`, 0, 1_000_000_000_000);
  counter(value.measurements.permissionPrompts, `${measurements}.permissionPrompts`);
  counter(value.measurements.retries, `${measurements}.retries`);
  if (value.measurements.latencyMsP95 < value.measurements.latencyMsP50) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${measurements}.latencyMsP95 is below the observed p50.`, 'Report percentiles from the same sample.');
  }

  exact(value.findingCounts, ['p0', 'p1', 'p2', 'p3'], `${label}.findingCounts`);
  for (const severity of ['p0', 'p1', 'p2', 'p3']) counter(value.findingCounts[severity], `${label}.findingCounts.${severity}`);

  boundedArray(value.rawEvidence, `${label}.rawEvidence`, 0, 4_096);
  const seenEvidence = new Set();
  value.rawEvidence.forEach((entry, index) => {
    const cursor = `${label}.rawEvidence[${index}]`;
    exact(entry, ['evidenceId', 'class', 'contentDigest', 'byteLength'], cursor);
    pattern(entry.evidenceId, /^eev_[a-f0-9]{32}$/u, `${cursor}.evidenceId`, 'Bind the local evidence identity.');
    member(entry.class, ['prompt', 'trace', 'screenshot', 'model-output'], `${cursor}.class`);
    digest(entry.contentDigest, `${cursor}.contentDigest`);
    integer(entry.byteLength, `${cursor}.byteLength`, 0, 1_099_511_627_776);
    if (seenEvidence.has(entry.evidenceId)) fail('E_EVALUATION_CONTRACT_INVALID', `${cursor}.evidenceId is recorded twice.`, 'Record each evidence reference once.');
    seenEvidence.add(entry.evidenceId);
  });

  pattern(value.terminalReason, TERMINAL_REASON, `${label}.terminalReason`, 'Use an upper-case terminal reason code.');
  timestamp(value.startedAt, `${label}.startedAt`);
  timestamp(value.completedAt, `${label}.completedAt`);
  if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label}.completedAt precedes startedAt.`, 'Record the real interval.');
  }

  return assertEvaluationIdentity(value, 'evaluation-run-result');
}

export function assertEvaluationAggregateReport(value, label = 'aggregate report') {
  envelope(value, 'evaluation-aggregate-report', label);
  exact(value, ['kind', 'schemaVersion', 'protocolVersion', 'reportId', 'generatedAt', 'redaction', 'inputs', 'counters', 'rates', 'budget', 'absences', 'skills', 'scenarios', 'reportDigest'], label);
  timestamp(value.generatedAt, `${label}.generatedAt`);

  const inputs = `${label}.inputs`;
  exact(value.inputs, ['corpusDigest', 'graderRegistryDigest', 'hostProfileRegistryDigest', 'gatePolicyDigest', 'budgetBaselineDigest', 'hostProfileDigests', 'runResultDigests'], inputs);
  for (const field of ['corpusDigest', 'graderRegistryDigest', 'hostProfileRegistryDigest', 'gatePolicyDigest', 'budgetBaselineDigest']) digest(value.inputs[field], `${inputs}.${field}`);
  boundedArray(value.inputs.hostProfileDigests, `${inputs}.hostProfileDigests`, 1, 32);
  value.inputs.hostProfileDigests.forEach((entry, index) => digest(entry, `${inputs}.hostProfileDigests[${index}]`));
  boundedArray(value.inputs.runResultDigests, `${inputs}.runResultDigests`, 1, 256);
  value.inputs.runResultDigests.forEach((entry, index) => digest(entry, `${inputs}.runResultDigests[${index}]`));

  const counterFields = ['scenariosTotal', 'scenariosPassed', 'scenariosFailed', 'scenariosBlocked', 'scenariosAbsent', 'scenariosWaived', 'triggerTruePositives', 'triggerFalsePositives', 'triggerFalseNegatives', 'journeysAttempted', 'journeysCompleted', 'outputsValidated', 'outputsSchemaValid', 'assetsDeclared', 'assetsPresent', 'exportsDeclared', 'exportsPresent', 'packageMembersDeclared', 'packageMembersPresent', 'permissionPrompts', 'retries', 'findingsP0', 'findingsP1', 'findingsP2', 'findingsP3'];
  exact(value.counters, counterFields, `${label}.counters`);
  for (const field of counterFields) counter(value.counters[field], `${label}.counters.${field}`);
  const outcomeSum = value.counters.scenariosPassed + value.counters.scenariosFailed + value.counters.scenariosBlocked + value.counters.scenariosAbsent + value.counters.scenariosWaived;
  if (outcomeSum !== value.counters.scenariosTotal) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label}.counters outcome breakdown does not sum to scenariosTotal.`, 'Every scenario lands in exactly one terminal bucket; an unaccounted scenario is never a pass.', { outcomeSum, scenariosTotal: value.counters.scenariosTotal });
  }
  for (const [part, whole] of [['journeysCompleted', 'journeysAttempted'], ['outputsSchemaValid', 'outputsValidated'], ['assetsPresent', 'assetsDeclared'], ['exportsPresent', 'exportsDeclared'], ['packageMembersPresent', 'packageMembersDeclared']]) {
    if (value.counters[part] > value.counters[whole]) {
      fail('E_EVALUATION_CONTRACT_INVALID', `${label}.counters.${part} exceeds ${whole}.`, 'A subset counter never exceeds its population.');
    }
  }

  const rateFields = ['triggerPrecision', 'triggerRecall', 'journeyCompletion', 'schemaValidity', 'assetParity', 'exportParity', 'packageParity'];
  exact(value.rates, rateFields, `${label}.rates`);
  for (const field of rateFields) rate(value.rates[field], `${label}.rates.${field}`);

  const budget = `${label}.budget`;
  exact(value.budget, ['baselineDigest', 'latencyMsBaseline', 'latencyMsObserved', 'latencyRegression', 'costEstimateMicrosBaseline', 'costEstimateMicrosObserved', 'costRegression', 'permissionPromptCeiling', 'retryCeiling'], budget);
  digest(value.budget.baselineDigest, `${budget}.baselineDigest`);
  integer(value.budget.latencyMsBaseline, `${budget}.latencyMsBaseline`, 0, 86_400_000);
  integer(value.budget.latencyMsObserved, `${budget}.latencyMsObserved`, 0, 86_400_000);
  integer(value.budget.latencyRegression, `${budget}.latencyRegression`, -10_000, 1_000_000);
  integer(value.budget.costEstimateMicrosBaseline, `${budget}.costEstimateMicrosBaseline`, 0, 1_000_000_000_000);
  integer(value.budget.costEstimateMicrosObserved, `${budget}.costEstimateMicrosObserved`, 0, 1_000_000_000_000);
  integer(value.budget.costRegression, `${budget}.costRegression`, -10_000, 1_000_000);
  counter(value.budget.permissionPromptCeiling, `${budget}.permissionPromptCeiling`);
  counter(value.budget.retryCeiling, `${budget}.retryCeiling`);
  if (value.budget.baselineDigest !== value.inputs.budgetBaselineDigest) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${budget}.baselineDigest does not match the declared input baseline.`, 'A regression is measured against the frozen baseline this report was built from.');
  }

  const absenceFields = ['graderMissing', 'graderErrored', 'graderUnavailable', 'hostUnavailable', 'fixtureUnavailable', 'budgetExceeded', 'notRun'];
  exact(value.absences, absenceFields, `${label}.absences`);
  for (const field of absenceFields) counter(value.absences[field], `${label}.absences.${field}`);
  const absenceSum = absenceFields.reduce((total, field) => total + value.absences[field], 0);
  if (absenceSum !== value.counters.scenariosAbsent) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label}.absences does not sum to counters.scenariosAbsent.`, 'Every typed absence is counted once and stays an absence.', { absenceSum, scenariosAbsent: value.counters.scenariosAbsent });
  }

  boundedArray(value.skills, `${label}.skills`, 1, 128);
  let skillScenarioTotal = 0;
  value.skills.forEach((entry, index) => {
    const cursor = `${label}.skills[${index}]`;
    exact(entry, ['skillId', 'skillVersion', 'scenariosTotal', 'scenariosPassed', 'scenariosFailed', 'scenariosBlocked', 'scenariosAbsent', 'scenariosWaived'], cursor);
    pattern(entry.skillId, PUBLISHED_NAME, `${cursor}.skillId`, 'Use the published skill identifier.');
    pattern(entry.skillVersion, SKILL_VERSION, `${cursor}.skillVersion`, 'Use an explicit semantic version.');
    for (const field of ['scenariosTotal', 'scenariosPassed', 'scenariosFailed', 'scenariosBlocked', 'scenariosAbsent', 'scenariosWaived']) counter(entry[field], `${cursor}.${field}`);
    const sum = entry.scenariosPassed + entry.scenariosFailed + entry.scenariosBlocked + entry.scenariosAbsent + entry.scenariosWaived;
    if (sum !== entry.scenariosTotal) {
      fail('E_EVALUATION_CONTRACT_INVALID', `${cursor} outcome breakdown does not sum to scenariosTotal.`, 'Every scenario lands in exactly one terminal bucket.');
    }
    skillScenarioTotal += entry.scenariosTotal;
  });
  if (skillScenarioTotal !== value.counters.scenariosTotal) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label}.skills does not partition counters.scenariosTotal.`, 'Each scenario belongs to exactly one skill summary.', { skillScenarioTotal, scenariosTotal: value.counters.scenariosTotal });
  }

  boundedArray(value.scenarios, `${label}.scenarios`, 0, 2_048);
  value.scenarios.forEach((entry, index) => {
    const cursor = `${label}.scenarios[${index}]`;
    exact(entry, ['scenarioDigest', 'skillId', 'hostProfileDigest', 'graderRegistrationDigest', 'fixtureSetDigest', 'promptClass', 'status', 'absenceReason', 'waiverDigest', 'observations', 'latencyMs'], cursor);
    for (const field of ['scenarioDigest', 'hostProfileDigest', 'graderRegistrationDigest', 'fixtureSetDigest']) digest(entry[field], `${cursor}.${field}`);
    pattern(entry.skillId, PUBLISHED_NAME, `${cursor}.skillId`, 'Use the published skill identifier.');
    member(entry.promptClass, EVALUATION_PROMPT_CLASSES, `${cursor}.promptClass`);
    member(entry.status, ['passed', 'failed', 'blocked', 'absent', 'waived'], `${cursor}.status`);
    integer(entry.observations, `${cursor}.observations`, 0, 64);
    integer(entry.latencyMs, `${cursor}.latencyMs`, 0, 86_400_000);
    if (entry.status === 'absent') member(entry.absenceReason, EVALUATION_ABSENCE_CODES, `${cursor}.absenceReason`);
    else if (entry.absenceReason !== null) fail('E_EVALUATION_ABSENCE_INVALID', `${cursor}.absenceReason must be null unless the scenario is absent.`, 'An absence reason belongs only to a typed absence.');
    if (entry.status === 'waived') digest(entry.waiverDigest, `${cursor}.waiverDigest`);
    else if (entry.waiverDigest !== null) fail('E_EVALUATION_CONTRACT_INVALID', `${cursor}.waiverDigest must be null unless the scenario is waived.`, 'Bind a waiver only where one was applied.');
  });

  assertEvaluationIdentity(value, 'evaluation-aggregate-report');
  return assertEvaluationAggregatePublishable(value, label);
}

export function assertEvaluationWaiver(value, label = 'waiver') {
  envelope(value, 'evaluation-waiver', label);
  exact(value, ['kind', 'schemaVersion', 'protocolVersion', 'waiverId', 'gatePolicyDigest', 'metric', 'scope', 'reason', 'ownerSignature', 'issuedAt', 'expiresAt', 'receiptVisibility', 'waiverDigest'], label);
  digest(value.gatePolicyDigest, `${label}.gatePolicyDigest`);
  constant(value.receiptVisibility, 'visible', `${label}.receiptVisibility`);

  if (EVALUATION_UNWAIVABLE_METRICS.includes(value.metric)) {
    fail('E_EVALUATION_WAIVER_REFUSED', `${label}.metric targets an unwaivable gate.`, 'Schema validity, package parity, and P0/P1 findings can never be waived; fix the finding instead.', { metric: value.metric });
  }
  member(value.metric, EVALUATION_WAIVABLE_METRICS, `${label}.metric`);

  const scope = `${label}.scope`;
  object(value.scope, scope);
  if (value.scope.kind === 'scenario') {
    exact(value.scope, ['kind', 'scenarioDigest'], scope);
    digest(value.scope.scenarioDigest, `${scope}.scenarioDigest`);
  } else if (value.scope.kind === 'skill') {
    exact(value.scope, ['kind', 'skillId', 'skillVersion', 'skillSourceDigest'], scope);
    pattern(value.scope.skillId, PUBLISHED_NAME, `${scope}.skillId`, 'Name the skill the waiver covers.');
    pattern(value.scope.skillVersion, SKILL_VERSION, `${scope}.skillVersion`, 'Use an explicit semantic version.');
    digest(value.scope.skillSourceDigest, `${scope}.skillSourceDigest`);
  } else {
    fail('E_EVALUATION_WAIVER_REFUSED', `${scope} names no scenario or skill.`, 'A scope-free waiver is refused; bind the waiver to one scenario digest or one skill version.', { kind: value.scope.kind ?? null });
  }

  exact(value.reason, ['code', 'statement'], `${label}.reason`);
  member(value.reason.code, EVALUATION_WAIVER_REASON_CODES, `${label}.reason.code`);
  pattern(value.reason.statement, WAIVER_STATEMENT, `${label}.reason.statement`, 'State the accepted risk in 10 to 280 plain characters.');
  assertEvaluationNoPrivateMaterial(value.reason.statement, `${label}.reason.statement`);

  const signature = `${label}.ownerSignature`;
  exact(value.ownerSignature, ['identity', 'keyIdentity', 'payloadDigest'], signature);
  pattern(value.ownerSignature.identity, ACTOR_IDENTITY, `${signature}.identity`, 'Name the accountable owner.');
  pattern(value.ownerSignature.keyIdentity, ACTOR_IDENTITY, `${signature}.keyIdentity`, 'Reference the signing key by logical identity, never by value.');
  digest(value.ownerSignature.payloadDigest, `${signature}.payloadDigest`);

  timestamp(value.issuedAt, `${label}.issuedAt`);
  timestamp(value.expiresAt, `${label}.expiresAt`);
  const issued = Date.parse(value.issuedAt);
  const expires = Date.parse(value.expiresAt);
  if (expires <= issued) {
    fail('E_EVALUATION_WAIVER_REFUSED', `${label}.expiresAt is not after issuedAt.`, 'A waiver that never opens a window is refused.');
  }
  if (expires - issued > EVALUATION_WAIVER_MAX_HORIZON_DAYS * 86_400_000) {
    fail('E_EVALUATION_WAIVER_REFUSED', `${label} is unbounded in practice.`, `A waiver expires within ${EVALUATION_WAIVER_MAX_HORIZON_DAYS} days of issue; a longer horizon is a permanent exemption.`, { horizonDays: Math.round((expires - issued) / 86_400_000) });
  }

  return assertEvaluationIdentity(value, 'evaluation-waiver');
}

/** A structurally valid waiver still has to be live, in policy, and in scope at the moment it is applied. */
export function assertEvaluationWaiverApplicable(waiver, { now, gatePolicyDigest = null, scenarioDigest = null, label = 'waiver' } = {}) {
  assertEvaluationWaiver(waiver, label);
  timestamp(now, `${label} evaluation instant`);
  const instant = Date.parse(now);
  if (instant < Date.parse(waiver.issuedAt)) {
    fail('E_EVALUATION_WAIVER_REFUSED', `${label} is not yet in force.`, 'Apply a waiver only after it is issued.');
  }
  if (instant >= Date.parse(waiver.expiresAt)) {
    fail('E_EVALUATION_WAIVER_REFUSED', `${label} expired at ${waiver.expiresAt}.`, 'Re-issue the waiver or fix the finding; an expired waiver never applies.');
  }
  if (gatePolicyDigest !== null && waiver.gatePolicyDigest !== gatePolicyDigest) {
    fail('E_EVALUATION_WAIVER_REFUSED', `${label} was issued against a different gate policy.`, 'A waiver binds the exact policy it was granted under.', { expected: gatePolicyDigest, actual: waiver.gatePolicyDigest });
  }
  if (scenarioDigest !== null && waiver.scope.kind === 'scenario' && waiver.scope.scenarioDigest !== scenarioDigest) {
    fail('E_EVALUATION_WAIVER_REFUSED', `${label} was issued against a different scenario.`, 'A scenario waiver never carries to a scenario whose bytes differ.', { expected: scenarioDigest, actual: waiver.scope.scenarioDigest });
  }
  return waiver;
}

export function assertSkillCertificationReceipt(value, { aggregateReport = null, now = null, label = 'certification receipt' } = {}) {
  envelope(value, 'skill-certification-receipt', label);
  assertNoAuthorityClaim(value, label);
  exact(value, ['kind', 'schemaVersion', 'protocolVersion', 'recordType', 'receiptId', 'issuedAt', 'subject', 'inputs', 'gateEvaluation', 'appliedWaivers', 'result', 'blockingMetrics', 'receiptDigest'], label);
  constant(value.recordType, 'readiness', `${label}.recordType`);
  timestamp(value.issuedAt, `${label}.issuedAt`);

  exact(value.subject, ['skillId', 'skillVersion', 'skillSourceDigest'], `${label}.subject`);
  pattern(value.subject.skillId, PUBLISHED_NAME, `${label}.subject.skillId`, 'Name the certified skill.');
  pattern(value.subject.skillVersion, SKILL_VERSION, `${label}.subject.skillVersion`, 'Use an explicit semantic version.');
  digest(value.subject.skillSourceDigest, `${label}.subject.skillSourceDigest`);

  const inputs = `${label}.inputs`;
  exact(value.inputs, ['corpusDigest', 'graderRegistryDigest', 'hostProfiles', 'budgetBaselineDigest', 'gatePolicyDigest', 'aggregateReportDigest'], inputs);
  for (const field of ['corpusDigest', 'graderRegistryDigest', 'budgetBaselineDigest', 'gatePolicyDigest', 'aggregateReportDigest']) digest(value.inputs[field], `${inputs}.${field}`);
  boundedArray(value.inputs.hostProfiles, `${inputs}.hostProfiles`, 1, 32);
  value.inputs.hostProfiles.forEach((entry, index) => {
    const cursor = `${inputs}.hostProfiles[${index}]`;
    exact(entry, ['hostProfileId', 'hostProfileDigest'], cursor);
    pattern(entry.hostProfileId, PUBLISHED_NAME, `${cursor}.hostProfileId`, 'Name the host profile the run covered.');
    digest(entry.hostProfileDigest, `${cursor}.hostProfileDigest`);
  });

  boundedArray(value.gateEvaluation, `${label}.gateEvaluation`, EVALUATION_METRICS.length, 32);
  const evaluated = new Map();
  value.gateEvaluation.forEach((entry, index) => {
    const cursor = `${label}.gateEvaluation[${index}]`;
    exact(entry, ['metric', 'waivable', 'status', 'waiverDigest'], cursor);
    member(entry.metric, EVALUATION_METRICS, `${cursor}.metric`);
    boolean(entry.waivable, `${cursor}.waivable`);
    member(entry.status, ['met', 'not-met', 'waived'], `${cursor}.status`);
    if (evaluated.has(entry.metric)) fail('E_EVALUATION_CONTRACT_INVALID', `${cursor}.metric is evaluated twice.`, 'Evaluate each gate exactly once.');
    if (EVALUATION_UNWAIVABLE_METRICS.includes(entry.metric) && entry.waivable !== false) {
      fail('E_EVALUATION_WAIVER_REFUSED', `${cursor} marks an unwaivable gate as waivable.`, 'Schema validity, package parity, and P0/P1 findings can never be waived.');
    }
    if (entry.status === 'waived') {
      if (!entry.waivable || EVALUATION_UNWAIVABLE_METRICS.includes(entry.metric)) {
        fail('E_EVALUATION_WAIVER_REFUSED', `${cursor} waives a gate that cannot be waived.`, 'Fix the finding; this gate has no waiver path.');
      }
      digest(entry.waiverDigest, `${cursor}.waiverDigest`);
    } else if (entry.waiverDigest !== null) {
      fail('E_EVALUATION_CONTRACT_INVALID', `${cursor}.waiverDigest must be null unless the gate is waived.`, 'Bind a waiver only to a waived gate.');
    }
    evaluated.set(entry.metric, entry);
  });
  const unevaluated = EVALUATION_METRICS.filter((metric) => !evaluated.has(metric));
  if (unevaluated.length > 0) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label}.gateEvaluation omits a mandatory gate.`, 'Evaluate every mandatory gate; an unevaluated gate is never a met gate.', { unevaluated });
  }

  boundedArray(value.appliedWaivers, `${label}.appliedWaivers`, 0, 32);
  const instant = now === null ? null : Date.parse(timestamp(now, `${label} evaluation instant`));
  const applied = new Set();
  value.appliedWaivers.forEach((entry, index) => {
    const cursor = `${label}.appliedWaivers[${index}]`;
    exact(entry, ['waiverDigest', 'metric', 'scopeKind', 'reasonCode', 'ownerSignatureIdentity', 'issuedAt', 'expiresAt'], cursor);
    digest(entry.waiverDigest, `${cursor}.waiverDigest`);
    member(entry.metric, EVALUATION_WAIVABLE_METRICS, `${cursor}.metric`);
    member(entry.scopeKind, ['scenario', 'skill'], `${cursor}.scopeKind`);
    member(entry.reasonCode, EVALUATION_WAIVER_REASON_CODES, `${cursor}.reasonCode`);
    pattern(entry.ownerSignatureIdentity, ACTOR_IDENTITY, `${cursor}.ownerSignatureIdentity`, 'Name the accountable owner.');
    timestamp(entry.issuedAt, `${cursor}.issuedAt`);
    timestamp(entry.expiresAt, `${cursor}.expiresAt`);
    if (instant !== null && Date.parse(entry.expiresAt) <= instant) {
      fail('E_EVALUATION_WAIVER_REFUSED', `${cursor} expired at ${entry.expiresAt}.`, 'An expired waiver never counts toward readiness.');
    }
    applied.add(entry.waiverDigest);
  });
  const waivedDigests = new Set(value.gateEvaluation.filter((entry) => entry.status === 'waived').map((entry) => entry.waiverDigest));
  for (const waiverDigest of waivedDigests) {
    if (!applied.has(waiverDigest)) fail('E_EVALUATION_WAIVER_REFUSED', `${label} waives a gate with a waiver it does not record.`, 'Record every applied waiver so a reader can see what was accepted.', { waiverDigest });
  }
  for (const waiverDigest of applied) {
    if (!waivedDigests.has(waiverDigest)) fail('E_EVALUATION_WAIVER_REFUSED', `${label} records a waiver that waives no gate.`, 'Remove waivers that were not applied.', { waiverDigest });
  }

  member(value.result, ['release-ready', 'blocked'], `${label}.result`);
  boundedArray(value.blockingMetrics, `${label}.blockingMetrics`, 0, 16);
  value.blockingMetrics.forEach((metric, index) => member(metric, EVALUATION_METRICS, `${label}.blockingMetrics[${index}]`));
  const notMet = EVALUATION_METRICS.filter((metric) => evaluated.get(metric).status === 'not-met');
  if (JSON.stringify([...value.blockingMetrics].sort()) !== JSON.stringify(notMet.sort())) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label}.blockingMetrics does not match the gates that were not met.`, 'List exactly the gates whose status is not-met.', { declared: value.blockingMetrics, notMet });
  }
  if (value.result === 'release-ready' && notMet.length > 0) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label} reports readiness while a gate is not met.`, 'A receipt reports readiness only when every gate is met or validly waived.', { notMet });
  }
  if (value.result === 'blocked' && notMet.length === 0) {
    fail('E_EVALUATION_CONTRACT_INVALID', `${label} reports blocked with no unmet gate.`, 'Name the gate that blocks, or report readiness.');
  }

  if (aggregateReport !== null) {
    assertEvaluationAggregateReport(aggregateReport, `${label} aggregate report`);
    if (value.inputs.aggregateReportDigest !== aggregateReport.reportDigest) {
      fail('E_EVALUATION_DIGEST_MISMATCH', `${label}.inputs.aggregateReportDigest does not bind this aggregate report.`, 'A receipt reports on the exact report it was computed from.', { expected: aggregateReport.reportDigest, actual: value.inputs.aggregateReportDigest });
    }
  }

  return assertEvaluationIdentity(value, 'skill-certification-receipt');
}
