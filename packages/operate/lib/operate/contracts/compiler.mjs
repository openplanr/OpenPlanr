const IDENTIFIER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const LIFECYCLE_STATE = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/u;
const OPERATION = /^operate\.[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/u;
const EVENT =
  /^(?:assignment|artifact|cycle|review|finding|decision|action|work|evidence|operating-state|snapshot|metric|claim|risk|assumption|delta|intelligence|decision-ledger|executive-board|verification|outcome|learning|scenario|trigger|domain-projection|policy|approval|capability|operation|execution|rollback)\.[a-z][a-z0-9-]*$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_]*$/u;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const SAFE_RELATIVE_PATH = /^(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

const FORBIDDEN_TEXT = [
  /\b(?:adatalabs|private[-_ ]?consumer|customer[-_ ]?(?:id|data|name)|tenant[-_ ]?(?:id|data|name)|credential|secret|api[-_ ]?key|access[-_ ]?token)\b/iu,
  /\b(?:codex|claude(?:-code)?|cursor|openai|anthropic|gpt|sonnet|opus)\b/iu,
];

const ROOT_FIELDS = new Set([
  'kind',
  'schemaVersion',
  'registryVersion',
  'protocol',
  'contracts',
  'roles',
  'guards',
  'transitions',
  'operations',
  'actions',
  'dependencyPolicies',
  'errors',
  'generation',
  'extensions',
  'persistentWorkContractIds',
  'evidence',
  'operatingIntelligence',
  'governedExecution',
  'experience',
]);

/**
 * Kernel scheduling archetypes. A domain owns its own stable `roleId` values and
 * presentation `label`s; only these three kinds drive kernel scheduling.
 */
const KERNEL_ROLE_KINDS = Object.freeze(['advisor', 'challenger', 'chair']);
const BUSINESS_DOMAIN_ROLE_IDS_V1 = Object.freeze([
  'chair',
  'growth-market',
  'independent-challenge',
  'operations-customer',
  'product-activation',
  'strategy-finance',
  'technology-risk',
]);
const FORBIDDEN_BUSINESS_ROLE_IDS_V1 = Object.freeze(['cfo', 'finance-cfo', 'product-owner']);
const FORBIDDEN_SOFTWARE_EXECUTIVE_ROLE_IDS_V1 = Object.freeze([
  'growth-market',
  'independent-challenge',
  'operations-customer',
  'product-activation',
  'strategy-finance',
  'technology-risk',
]);
const SOFTWARE_DOMAIN_ROLE_IDS_V1 = Object.freeze(['advisor', 'chair', 'challenger']);

/** The clause set a rubric declares, and the order a generated skill renders. */
export const ANALYSIS_RUBRIC_CLAUSES = Object.freeze([
  'requiredQuestions',
  'requiredEvidence',
  'failureModes',
  'artifactQualityBar',
  'outOfScope',
]);
export const EXECUTIVE_SELF_AUDIT_CLAUSES = Object.freeze([
  'evidenceCoverage',
  'questionCoverage',
  'claimQuality',
  'profileCompleteness',
  'gapsAndUncertainty',
  'forbiddenEffects',
  'promptInjection',
  'machinePreflight',
]);

const EXPERIENCE_CONTRACTS = Object.freeze([
  ['operate-experience-view', 'api'],
  ['operate-review-display-workspace', 'api'],
  ['operate-review-bound-submission', 'api'],
  ['operate-experience-live-patch', 'api'],
  ['operate-experience-preview', 'api'],
  ['operating-delivery-route', 'entity'],
  ['operating-planning-proposal', 'entity'],
  ['operating-origin', 'entity'],
  ['operating-delivery-evidence', 'entity'],
]);
const DELIVERY_ROUTES = Object.freeze([
  'contained-execution',
  'planning-work',
  'human-external',
  'observe-only',
]);

const EVIDENCE_CONTRACTS = Object.freeze([
  ['operating-evidence-candidate', 'entity'],
  ['operating-evidence-ref', 'entity'],
  ['operating-evidence-resolution', 'entity'],
  ['operate-evidence-provider-registration', 'extension'],
  ['operate-evidence-resolver-registration', 'extension'],
  ['operating-evidence-edge', 'entity'],
  ['operating-evidence-graph', 'entity'],
]);
const LOCAL_EVIDENCE_KINDS = Object.freeze(['filesystem', 'git', 'operate-artifact', 'planr']);
const EVIDENCE_SOURCE_CONTRACT_IDS = Object.freeze([
  'capacity-throughput',
  'channel-economics',
  'ci-test-evidence',
  'competitor-positioning',
  'context-manifest',
  'demand-market',
  'finance-metrics',
  'incident-history',
  'objective-metrics',
  'operations-customer-health',
  'planning-acceptance',
  'prior-decisions',
  'product-activation',
  'repository-architecture',
  'retention-discovery',
  'support-incidents',
]);
const EVIDENCE_EDGE_RELATIONS = Object.freeze(['contradictedBy', 'supportedBy']);
const EVIDENCE_RESOLVER_ERROR_CODES = Object.freeze([
  'ANCESTRY_MISMATCH',
  'ARTIFACT_HASH_MISMATCH',
  'ARTIFACT_NOT_FOUND',
  'CAPABILITY_DENIED',
  'CONSENT_REQUIRED',
  'EVIDENCE_LOCATOR_INVALID',
  'EVIDENCE_PROVIDER_UNAVAILABLE',
  'EVIDENCE_RESOLVER_UNAVAILABLE',
  'EVIDENCE_RESOLVER_UNREGISTERED',
  'EVIDENCE_RESOLVER_VERSION_UNSUPPORTED',
  'EVIDENCE_SOURCE_SCOPE_MISMATCH',
  'LINE_RANGE_INVALID',
  'OBJECT_TYPE_MISMATCH',
  'PATH_NOT_FOUND',
  'REVISION_NOT_FOUND',
  'SECRET_DETECTED',
  'SENSITIVITY_BLOCKED',
  'SOURCE_NOT_FOUND',
  'SOURCE_STALE',
  'SOURCE_UNTRACKED',
  'UNSUPPORTED_EVIDENCE_KIND',
]);

const OPERATING_INTELLIGENCE_CONTRACTS = Object.freeze([
  ['operating-model-state', 'entity', '2.0.0'],
  ['operating-snapshot', 'entity', '2.0.0'],
  ['operating-objective', 'entity', '2.0.0'],
  ['operating-metric', 'entity', '2.0.0'],
  ['operating-metric-observation', 'entity', '2.0.0'],
  ['operating-risk', 'entity', '2.0.0'],
  ['operating-assumption', 'entity', '2.0.0'],
  ['operating-claim', 'entity', '2.0.0'],
  ['operating-domain-projection', 'entity', '2.0.0'],
  ['business-operating-snapshot-projection', 'entity', '1.0.0'],
  ['software-operating-snapshot-projection', 'entity', '1.0.0'],
  ['operating-delta', 'entity', '2.0.0'],
  ['operating-intelligence-plan', 'entity', '2.0.0'],
  ['operating-intelligence-input-bundle', 'entity', '2.0.0'],
  ['operating-advisor-result', 'entity', '2.0.0'],
  ['operating-challenger-review', 'entity', '2.0.0'],
  ['operating-decision-ledger', 'entity', '2.0.0'],
  ['operating-action-verification-plan', 'entity', '2.0.0'],
  ['operating-outcome', 'entity', '2.0.0'],
  ['operating-learning', 'entity', '2.0.0'],
  ['operating-scenario', 'entity', '2.0.0'],
  ['operating-event-trigger', 'entity', '2.0.0'],
  ['operate-snapshot-provider-registration', 'extension', '2.0.0'],
  ['operate-metric-provider-registration', 'extension', '2.0.0'],
  ['operate-verification-provider-registration', 'extension', '2.0.0'],
]);
const OPERATING_PROJECTION_IDENTITIES = Object.freeze([
  'business-operating-snapshot-projection@1.0.0',
  'software-operating-snapshot-projection@1.0.0',
]);

const GOVERNED_EXECUTION_CONTRACTS = Object.freeze([
  ['operating-action-policy', 'entity'],
  ['operating-policy-evaluation', 'entity'],
  ['operating-approval-requirement', 'entity'],
  ['operating-approval-record', 'entity'],
  ['operating-capability-availability', 'entity'],
  ['operating-capability-grant', 'entity'],
  ['operating-governed-operation', 'entity'],
  ['operating-execution-result', 'entity'],
  ['operating-rollback-plan', 'entity'],
  ['operating-rollback-result', 'entity'],
  ['operate-capability-provider-registration', 'extension'],
  ['operate-policy-provider-registration', 'extension'],
  ['operate-executor-registration', 'extension'],
]);
const GOVERNED_EXECUTION_PROVIDER_CONTRACTS = Object.freeze([
  'operate-capability-provider-registration',
  'operate-policy-provider-registration',
  'operate-executor-registration',
]);
const GOVERNED_EFFECT_CLASSES = Object.freeze([
  'read-only',
  'machine-local-write',
  'project-write',
  'provider-call',
  'external-effect',
  'destructive',
]);
const GOVERNED_POLICY_OUTCOMES = Object.freeze([
  'automatic',
  'named-single-party',
  'named-multi-party',
  'threshold',
  'deferred',
  'rejected',
  'prohibited',
]);
const GOVERNED_POLICY_TIERS = Object.freeze([
  { id: 'core', precedence: 300, narrowingOnly: false },
  { id: 'project', precedence: 200, narrowingOnly: true },
  { id: 'domain', precedence: 100, narrowingOnly: true },
]);
const GOVERNED_CORE_PROHIBITIONS = Object.freeze([
  'credential-change',
  'customer-contact',
  'destructive',
  'funds-transfer',
  'payment-transfer',
  'production-deploy',
  'production-merge',
  'publication',
  'secret-mutation',
]);
const GOVERNED_OPERATION_STATES = Object.freeze([
  'authorized',
  'intent-recorded',
  'dispatching',
  'succeeded',
  'failed',
  'partial',
  'uncertain',
  'blocked',
  'cancelled',
  'rolled-back',
]);

export const OPERATE_CONTRACT_REGISTRY_KIND = 'operate-contract-registry';
export const OPERATE_CONTRACT_COMPILER_VERSION = '1.4.0';

export class OperateContractCompileError extends Error {
  constructor(code, message, { path = '$', details = {} } = {}) {
    super(message);
    this.name = 'OperateContractCompileError';
    this.code = code;
    this.path = path;
    this.details = Object.freeze({ path, ...details });
  }
}

function fail(code, message, path, details) {
  throw new OperateContractCompileError(code, message, { path, details });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, path) {
  if (!isPlainObject(value))
    fail('E_OPERATE_CONTRACT_MALFORMED', `${path} must be an object.`, path);
  return value;
}

function requireArray(value, path) {
  if (!Array.isArray(value))
    fail('E_OPERATE_CONTRACT_MALFORMED', `${path} must be an array.`, path);
  return value;
}

function requireString(value, path) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('E_OPERATE_CONTRACT_MALFORMED', `${path} must be a non-empty string.`, path);
  }
  assertSafeText(value, path);
  return value;
}

function requireBoolean(value, path) {
  if (typeof value !== 'boolean')
    fail('E_OPERATE_CONTRACT_MALFORMED', `${path} must be a boolean.`, path);
  return value;
}

function requirePositiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('E_OPERATE_CONTRACT_MALFORMED', `${path} must be a positive integer.`, path);
  }
  return value;
}

function requireNonNegativeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('E_OPERATE_CONTRACT_MALFORMED', `${path} must be a non-negative integer.`, path);
  }
  return value;
}

function assertSafeText(value, path) {
  if (
    value.includes('\u0000') ||
    value.startsWith('/') ||
    value.startsWith('~') ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.split(/[\\/]/u).includes('..') ||
    value.includes('node_modules')
  ) {
    fail('E_OPERATE_CONTRACT_UNSAFE', `${path} contains an unsafe path or token.`, path, { value });
  }
  const forbidden = FORBIDDEN_TEXT.find((pattern) => pattern.test(value));
  if (forbidden) {
    fail(
      'E_OPERATE_CONTRACT_NON_PORTABLE',
      `${path} contains a vendor-specific or consumer-specific declaration.`,
      path,
      {
        value,
        pattern: String(forbidden),
      },
    );
  }
}

function requireIdentifier(value, path) {
  const identifier = requireString(value, path);
  if (!IDENTIFIER.test(identifier)) {
    fail('E_OPERATE_CONTRACT_MALFORMED', `${path} must be a lower-kebab identifier.`, path, {
      value,
    });
  }
  return identifier;
}

function requireLifecycleState(value, path) {
  const state = requireString(value, path);
  if (!LIFECYCLE_STATE.test(state)) {
    fail('E_OPERATE_CONTRACT_MALFORMED', `${path} must be a lifecycle-state identifier.`, path, {
      value,
    });
  }
  return state;
}

function requireOperation(value, path) {
  const operation = requireString(value, path);
  if (!OPERATION.test(operation)) {
    fail('E_OPERATE_CONTRACT_MALFORMED', `${path} must be an operate.* operation.`, path, {
      value,
    });
  }
  return operation;
}

function requireEvent(value, path) {
  const event = requireString(value, path);
  if (!EVENT.test(event)) {
    fail('E_OPERATE_CONTRACT_MALFORMED', `${path} must be a supported event identifier.`, path, {
      value,
    });
  }
  return event;
}

function requireVersion(value, path) {
  const version = requireString(value, path);
  if (!SEMVER.test(version)) {
    fail('E_OPERATE_CONTRACT_MALFORMED', `${path} must be an explicit semantic version.`, path, {
      value,
    });
  }
  return version;
}

function requirePath(value, path, { prefix } = {}) {
  const candidate = requireString(value, path);
  if (!SAFE_RELATIVE_PATH.test(candidate) || (prefix && !candidate.startsWith(prefix))) {
    fail(
      'E_OPERATE_CONTRACT_UNSAFE',
      `${path} must be a safe relative path${prefix ? ` below ${prefix}` : ''}.`,
      path,
      { value },
    );
  }
  return candidate;
}

function assertExactFields(value, path, fields, required = fields) {
  requireObject(value, path);
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) {
      fail(
        'E_OPERATE_CONTRACT_UNKNOWN_DECLARATION',
        `${path}.${field} is not a declared registry field.`,
        `${path}.${field}`,
      );
    }
  }
  for (const field of required) {
    if (!(field in value)) {
      fail('E_OPERATE_CONTRACT_MALFORMED', `${path}.${field} is required.`, `${path}.${field}`);
    }
  }
  return value;
}

function assertUnique(entries, key, path, label) {
  const seen = new Set();
  for (const entry of entries) {
    const value = key(entry);
    if (seen.has(value)) {
      fail('E_OPERATE_CONTRACT_DUPLICATE', `${label} ${value} is declared more than once.`, path, {
        value,
      });
    }
    seen.add(value);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function compareBy(...selectors) {
  return (left, right) => {
    for (const selector of selectors) {
      const comparison = String(selector(left)).localeCompare(String(selector(right)));
      if (comparison !== 0) return comparison;
    }
    return 0;
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function compileContract(raw, index, protocolVersion) {
  const path = `$.contracts[${index}]`;
  const value = assertExactFields(
    raw,
    path,
    new Set([
      'id',
      'version',
      'category',
      'runtimeOrder',
      'schemaPath',
      'docsSection',
      'fixtureKey',
    ]),
  );
  const id = requireIdentifier(value.id, `${path}.id`);
  const version = requireVersion(value.version, `${path}.version`);
  const isExplicitOperatingProjection = OPERATING_PROJECTION_IDENTITIES.includes(
    `${id}@${version}`,
  );
  if (version !== protocolVersion && !isExplicitOperatingProjection) {
    fail(
      'E_OPERATE_CONTRACT_VERSION_MISMATCH',
      `${path}.version must equal the explicit registry protocol version.`,
      `${path}.version`,
      {
        version,
        protocolVersion,
      },
    );
  }
  if (!['entity', 'api', 'extension'].includes(value.category)) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.category must be entity, api, or extension.`,
      `${path}.category`,
    );
  }
  return {
    id,
    version,
    category: value.category,
    runtimeOrder: requirePositiveInteger(value.runtimeOrder, `${path}.runtimeOrder`),
    schemaPath: requirePath(value.schemaPath, `${path}.schemaPath`, {
      prefix: `schemas/v${protocolVersion}/`,
    }),
    docsSection: requireIdentifier(value.docsSection, `${path}.docsSection`),
    fixtureKey: requireIdentifier(value.fixtureKey, `${path}.fixtureKey`),
  };
}

/**
 * Compile the reasoning contract a seat is bound to. A mandate states a seat's
 * scope; the rubric states how it must reason, so it is contract text rather
 * than prompt text and is versioned with the role.
 */
function compileAnalysisRubric(raw, path) {
  const value = assertExactFields(raw, path, new Set(ANALYSIS_RUBRIC_CLAUSES));
  const rubric = {};
  for (const clause of ANALYSIS_RUBRIC_CLAUSES) {
    const clausePath = `${path}.${clause}`;
    const entries = requireArray(value[clause], clausePath).map((text, textIndex) =>
      requireString(text, `${clausePath}[${textIndex}]`),
    );
    if (entries.length === 0) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${clausePath} must state at least one clause.`,
        clausePath,
      );
    }
    assertUnique(
      entries.map((text) => ({ text })),
      ({ text }) => text,
      clausePath,
      'Rubric clause',
    );
    rubric[clause] = entries;
  }
  return rubric;
}

function compileExecutiveSelfAudit(raw, path) {
  const value = assertExactFields(raw, path, new Set(EXECUTIVE_SELF_AUDIT_CLAUSES));
  return Object.fromEntries(
    EXECUTIVE_SELF_AUDIT_CLAUSES.map((clause) => {
      const clausePath = `${path}.${clause}`;
      const entries = requireArray(value[clause], clausePath).map((entry, index) =>
        requireString(entry, `${clausePath}[${index}]`),
      );
      if (entries.length === 0 || entries.length > 16) {
        fail(
          'E_OPERATE_CONTRACT_MALFORMED',
          `${clausePath} must contain between one and sixteen checks.`,
          clausePath,
        );
      }
      assertUnique(
        entries.map((text) => ({ text })),
        ({ text }) => text,
        clausePath,
        'Self-audit check',
      );
      return [clause, entries];
    }),
  );
}

const ANALYSIS_EVIDENCE_KINDS = Object.freeze(['filesystem', 'git', 'operate-artifact', 'planr']);
const ANALYSIS_EVIDENCE_FRESHNESS = Object.freeze(['current', 'historical', 'stale']);
const RESULT_TARGET_CEILINGS = Object.freeze({
  analysis: 1,
  claims: 128,
  measurements: 128,
  risks: 128,
  alternatives: 64,
  gaps: 2048,
  recommendation: 1,
  findings: 256,
  dissent: 256,
  decisions: 256,
  'source-dispositions': 4096,
  'question-coverage': 16,
});
const RESULT_OUTCOMES = Object.freeze(['always', 'recommendation', 'partial', 'quiet']);
const ROLE_ANALYSIS_PROFILES = Object.freeze({
  chair: 'decision-synthesis',
  'growth-market': 'growth-market',
  'independent-challenge': 'independent-challenge',
  'operations-customer': 'operations-customer',
  'product-activation': 'product-activation',
  'strategy-finance': 'strategy-finance',
  'technology-risk': 'technology-risk',
});

function compileAnalysisProfile(raw, path, analysisRubric) {
  const value = assertExactFields(raw, path, new Set(['id', 'version', 'questionIds']));
  const questionIds = requireArray(value.questionIds, `${path}.questionIds`).map(
    (questionId, index) => requireIdentifier(questionId, `${path}.questionIds[${index}]`),
  );
  if (questionIds.length === 0 || questionIds.length > 16) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.questionIds must contain between one and sixteen identities.`,
      `${path}.questionIds`,
    );
  }
  assertUnique(
    questionIds.map((id) => ({ id })),
    ({ id }) => id,
    `${path}.questionIds`,
    'Analysis question',
  );
  if (questionIds.length !== analysisRubric.requiredQuestions.length) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.questionIds must map the required rubric questions one-for-one in canonical order.`,
      `${path}.questionIds`,
      {
        questionCount: questionIds.length,
        rubricQuestionCount: analysisRubric.requiredQuestions.length,
      },
    );
  }
  return {
    id: requireIdentifier(value.id, `${path}.id`),
    version: requireVersion(value.version, `${path}.version`),
    questionIds,
  };
}

function compileEvidenceRequirements(raw, path) {
  const requirements = requireArray(raw, path).map((entry, index) => {
    const requirementPath = `${path}[${index}]`;
    const value = assertExactFields(
      entry,
      requirementPath,
      new Set([
        'requirementId',
        'description',
        'necessity',
        'acceptedEvidenceKinds',
        'acceptedSourceContracts',
        'minimumEvidenceRefs',
        'maximumEvidenceRefs',
        'acceptedFreshness',
      ]),
    );
    if (!['required', 'preferred'].includes(value.necessity)) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${requirementPath}.necessity is unsupported.`,
        `${requirementPath}.necessity`,
      );
    }
    const minimumEvidenceRefs = requireNonNegativeInteger(
      value.minimumEvidenceRefs,
      `${requirementPath}.minimumEvidenceRefs`,
    );
    const maximumEvidenceRefs = requirePositiveInteger(
      value.maximumEvidenceRefs,
      `${requirementPath}.maximumEvidenceRefs`,
    );
    if (minimumEvidenceRefs > 128 || (value.necessity === 'required' && minimumEvidenceRefs < 1)) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${requirementPath}.minimumEvidenceRefs must be 1..128 for required evidence and 0..128 otherwise.`,
        `${requirementPath}.minimumEvidenceRefs`,
      );
    }
    if (maximumEvidenceRefs > 128 || minimumEvidenceRefs > maximumEvidenceRefs) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${requirementPath}.maximumEvidenceRefs must be between the minimum and the Assignment evidence ceiling.`,
        `${requirementPath}.maximumEvidenceRefs`,
        {
          minimumEvidenceRefs,
          maximumEvidenceRefs,
          assignmentEvidenceCeiling: 128,
        },
      );
    }
    const acceptedEvidenceKinds = requireArray(
      value.acceptedEvidenceKinds,
      `${requirementPath}.acceptedEvidenceKinds`,
    )
      .map((kind, kindIndex) => {
        const candidate = requireString(
          kind,
          `${requirementPath}.acceptedEvidenceKinds[${kindIndex}]`,
        );
        if (!ANALYSIS_EVIDENCE_KINDS.includes(candidate)) {
          fail(
            'E_OPERATE_CONTRACT_MALFORMED',
            `${requirementPath}.acceptedEvidenceKinds contains an unsupported kind.`,
            `${requirementPath}.acceptedEvidenceKinds[${kindIndex}]`,
          );
        }
        return candidate;
      })
      .sort();
    const acceptedFreshness = requireArray(
      value.acceptedFreshness,
      `${requirementPath}.acceptedFreshness`,
    )
      .map((freshness, freshnessIndex) => {
        const candidate = requireString(
          freshness,
          `${requirementPath}.acceptedFreshness[${freshnessIndex}]`,
        );
        if (!ANALYSIS_EVIDENCE_FRESHNESS.includes(candidate)) {
          fail(
            'E_OPERATE_CONTRACT_MALFORMED',
            `${requirementPath}.acceptedFreshness contains an unsupported value.`,
            `${requirementPath}.acceptedFreshness[${freshnessIndex}]`,
          );
        }
        return candidate;
      })
      .sort();
    const acceptedSourceContracts = requireArray(
      value.acceptedSourceContracts,
      `${requirementPath}.acceptedSourceContracts`,
    )
      .map((entry, sourceIndex) => {
        const sourcePath = `${requirementPath}.acceptedSourceContracts[${sourceIndex}]`;
        const source = assertExactFields(entry, sourcePath, new Set(['id', 'version']));
        const id = requireIdentifier(source.id, `${sourcePath}.id`);
        const version = requireVersion(source.version, `${sourcePath}.version`);
        if (!EVIDENCE_SOURCE_CONTRACT_IDS.includes(id) || version !== '1.0.0') {
          fail(
            'E_OPERATE_CONTRACT_MALFORMED',
            `${sourcePath} must reference a registry-owned Evidence source contract.`,
            sourcePath,
            { id, version },
          );
        }
        return { id, version };
      })
      .sort(
        compareBy(
          ({ id }) => id,
          ({ version }) => version,
        ),
      );
    if (
      acceptedEvidenceKinds.length === 0 ||
      acceptedSourceContracts.length === 0 ||
      acceptedFreshness.length === 0
    ) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${requirementPath} must declare accepted evidence kinds, source contracts, and freshness.`,
        requirementPath,
      );
    }
    assertUnique(
      acceptedEvidenceKinds.map((id) => ({ id })),
      ({ id }) => id,
      `${requirementPath}.acceptedEvidenceKinds`,
      'Evidence kind',
    );
    assertUnique(
      acceptedFreshness.map((id) => ({ id })),
      ({ id }) => id,
      `${requirementPath}.acceptedFreshness`,
      'Evidence freshness',
    );
    assertUnique(
      acceptedSourceContracts,
      ({ id, version }) => `${id}@${version}`,
      `${requirementPath}.acceptedSourceContracts`,
      'Evidence source contract',
    );
    return {
      requirementId: requireIdentifier(value.requirementId, `${requirementPath}.requirementId`),
      description: requireString(value.description, `${requirementPath}.description`),
      necessity: value.necessity,
      acceptedEvidenceKinds,
      acceptedSourceContracts,
      minimumEvidenceRefs,
      maximumEvidenceRefs,
      acceptedFreshness,
    };
  });
  if (requirements.length > 64) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path} cannot contain more than sixty-four requirements.`,
      path,
    );
  }
  assertUnique(requirements, ({ requirementId }) => requirementId, path, 'Evidence requirement');
  const requiredMinimum = requirements
    .filter(({ necessity }) => necessity === 'required')
    .reduce((total, { minimumEvidenceRefs }) => total + minimumEvidenceRefs, 0);
  const maximumIssuedEvidence = requirements.reduce(
    (total, { maximumEvidenceRefs }) => total + maximumEvidenceRefs,
    0,
  );
  if (requiredMinimum > 128 || maximumIssuedEvidence > 128) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path} exceeds the bounded evidence capacity of one Assignment.`,
      path,
      {
        requiredMinimum,
        maximumIssuedEvidence,
        assignmentEvidenceCeiling: 128,
      },
    );
  }
  return requirements.sort(compareBy(({ requirementId }) => requirementId));
}

function compileResultRequirements(raw, path, analysisProfile, roleKind) {
  const requirements = requireArray(raw, path).map((entry, index) => {
    const requirementPath = `${path}[${index}]`;
    const value = assertExactFields(
      entry,
      requirementPath,
      new Set([
        'requirementId',
        'description',
        'target',
        'appliesToOutcomes',
        'minimumItems',
        'maximumItems',
      ]),
    );
    const target = requireString(value.target, `${requirementPath}.target`);
    if (!(target in RESULT_TARGET_CEILINGS)) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${requirementPath}.target is unsupported.`,
        `${requirementPath}.target`,
      );
    }
    const minimumItems = requireNonNegativeInteger(
      value.minimumItems,
      `${requirementPath}.minimumItems`,
    );
    const maximumItems = requirePositiveInteger(
      value.maximumItems,
      `${requirementPath}.maximumItems`,
    );
    if (minimumItems > maximumItems || maximumItems > RESULT_TARGET_CEILINGS[target]) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${requirementPath} exceeds the closed result target ceiling.`,
        requirementPath,
        {
          target,
          minimumItems,
          maximumItems,
          targetCeiling: RESULT_TARGET_CEILINGS[target],
        },
      );
    }
    const appliesToOutcomes = requireArray(
      value.appliesToOutcomes,
      `${requirementPath}.appliesToOutcomes`,
    )
      .map((outcome, outcomeIndex) => {
        const candidate = requireString(
          outcome,
          `${requirementPath}.appliesToOutcomes[${outcomeIndex}]`,
        );
        if (!RESULT_OUTCOMES.includes(candidate)) {
          fail(
            'E_OPERATE_CONTRACT_MALFORMED',
            `${requirementPath}.appliesToOutcomes contains an unsupported outcome.`,
            `${requirementPath}.appliesToOutcomes[${outcomeIndex}]`,
          );
        }
        return candidate;
      })
      .sort();
    if (appliesToOutcomes.length === 0) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${requirementPath}.appliesToOutcomes cannot be empty.`,
        `${requirementPath}.appliesToOutcomes`,
      );
    }
    assertUnique(
      appliesToOutcomes.map((id) => ({ id })),
      ({ id }) => id,
      `${requirementPath}.appliesToOutcomes`,
      'Result outcome',
    );
    return {
      requirementId: requireIdentifier(value.requirementId, `${requirementPath}.requirementId`),
      description: requireString(value.description, `${requirementPath}.description`),
      target,
      appliesToOutcomes,
      minimumItems,
      maximumItems,
    };
  });
  if (requirements.length === 0 || requirements.length > 64) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path} must contain between one and sixty-four requirements.`,
      path,
    );
  }
  assertUnique(requirements, ({ requirementId }) => requirementId, path, 'Result requirement');
  if (roleKind === 'advisor') {
    for (const questionId of analysisProfile.questionIds) {
      const mapping = requirements.find(
        ({ requirementId, target }) => requirementId === questionId && target === 'analysis',
      );
      if (!mapping || mapping.minimumItems !== 1 || mapping.maximumItems !== 1) {
        fail(
          'E_OPERATE_CONTRACT_MALFORMED',
          `${path} must map each Advisor question to the exact closed analysis payload.`,
          path,
          { questionId },
        );
      }
    }
  } else {
    const [mapping, ...duplicates] = requirements.filter(
      ({ target }) => target === 'question-coverage',
    );
    if (
      !mapping ||
      duplicates.length > 0 ||
      mapping.minimumItems !== analysisProfile.questionIds.length ||
      mapping.maximumItems !== analysisProfile.questionIds.length ||
      !mapping.appliesToOutcomes.includes('always')
    ) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${path} must declare one exact always-on question-coverage result requirement.`,
        path,
        {
          roleKind,
          questionCount: analysisProfile.questionIds.length,
        },
      );
    }
  }
  return requirements.sort(compareBy(({ requirementId }) => requirementId));
}

const MANDATE_CAPABILITY_IDS = Object.freeze([
  'artifact.read',
  'artifact.submit',
  'git.read',
  'planr.read',
  'repository.read',
]);
const MANDATE_FORBIDDEN_EFFECT_IDS = Object.freeze([
  'customer-contact',
  'governed-execution',
  'payment.change',
  'production.deploy',
  'publish',
  'repository.write',
  'ship',
  'spend',
]);

function compileMandate(raw, path) {
  const value = assertExactFields(
    raw,
    path,
    new Set([
      'scope',
      'allowedEvidence',
      'allowedCapabilities',
      'forbiddenEffects',
      'capabilityCeiling',
      'skillId',
    ]),
  );
  const scope = requireString(value.scope, `${path}.scope`);
  const allowedEvidence = requireArray(value.allowedEvidence, `${path}.allowedEvidence`).map(
    (entry, index) => requireString(entry, `${path}.allowedEvidence[${index}]`),
  );
  assertUnique(
    allowedEvidence.map((text) => ({ text })),
    ({ text }) => text,
    `${path}.allowedEvidence`,
    'Mandate evidence class',
  );
  const allowedCapabilities = requireArray(value.allowedCapabilities, `${path}.allowedCapabilities`)
    .map((entry, index) => {
      const capability = requireString(entry, `${path}.allowedCapabilities[${index}]`);
      if (!MANDATE_CAPABILITY_IDS.includes(capability)) {
        fail(
          'E_OPERATE_CONTRACT_MALFORMED',
          `${path}.allowedCapabilities names an unknown intelligence capability.`,
          `${path}.allowedCapabilities[${index}]`,
          { capability },
        );
      }
      return capability;
    })
    .sort();
  assertUnique(
    allowedCapabilities.map((id) => ({ id })),
    ({ id }) => id,
    `${path}.allowedCapabilities`,
    'Mandate capability',
  );
  const forbiddenEffects = requireArray(value.forbiddenEffects, `${path}.forbiddenEffects`)
    .map((entry, index) => {
      const effect = requireString(entry, `${path}.forbiddenEffects[${index}]`);
      if (!MANDATE_FORBIDDEN_EFFECT_IDS.includes(effect)) {
        fail(
          'E_OPERATE_CONTRACT_MALFORMED',
          `${path}.forbiddenEffects names an unknown forbidden effect.`,
          `${path}.forbiddenEffects[${index}]`,
          { effect },
        );
      }
      return effect;
    })
    .sort();
  if (value.capabilityCeiling !== 'read-only') {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.capabilityCeiling must equal the compiler-owned intelligence ceiling.`,
      `${path}.capabilityCeiling`,
    );
  }
  const skillId = requireIdentifier(value.skillId, `${path}.skillId`);
  if (
    allowedCapabilities.length < 2 ||
    !allowedCapabilities.includes('artifact.read') ||
    !allowedCapabilities.includes('artifact.submit') ||
    !sameJson(forbiddenEffects, [...MANDATE_FORBIDDEN_EFFECT_IDS].sort())
  ) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path} must include Artifact read/submit and the complete forbidden-effect ceiling.`,
      path,
    );
  }
  const compiled = {
    scope,
    allowedEvidence,
    allowedCapabilities,
    forbiddenEffects,
    capabilityCeiling: 'read-only',
    skillId,
  };
  return compiled;
}

function compileRole(raw, index, contracts) {
  const path = `$.roles[${index}]`;
  const value = assertExactFields(
    raw,
    path,
    new Set(['id', 'version', 'output', 'limits', 'docsSection']),
  );
  const output = assertExactFields(
    value.output,
    `${path}.output`,
    new Set(['schemaId', 'schemaVersion', 'mediaType', 'maxBytes']),
  );
  const limits = assertExactFields(
    value.limits,
    `${path}.limits`,
    new Set(['maxProposals', 'maxActions']),
  );
  const schemaId = requireIdentifier(output.schemaId, `${path}.output.schemaId`);
  const schemaVersion = requireVersion(output.schemaVersion, `${path}.output.schemaVersion`);
  if (!contracts.has(`${schemaId}@${schemaVersion}`)) {
    fail(
      'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
      `${path}.output references an unknown contract.`,
      `${path}.output`,
      {
        schemaId,
        schemaVersion,
      },
    );
  }
  if (
    typeof output.mediaType !== 'string' ||
    !/^[a-z][a-z0-9!#$&^_.+-]*\/[a-z0-9!#$&^_.+-]+$/u.test(output.mediaType)
  ) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.output.mediaType must be a media type.`,
      `${path}.output.mediaType`,
    );
  }
  return {
    id: requireIdentifier(value.id, `${path}.id`),
    version: requireVersion(value.version, `${path}.version`),
    output: {
      schemaId,
      schemaVersion,
      mediaType: output.mediaType,
      maxBytes: requirePositiveInteger(output.maxBytes, `${path}.output.maxBytes`),
    },
    limits: {
      maxProposals:
        Number.isSafeInteger(limits.maxProposals) && limits.maxProposals >= 0
          ? limits.maxProposals
          : fail(
              'E_OPERATE_CONTRACT_MALFORMED',
              `${path}.limits.maxProposals must be a non-negative integer.`,
              `${path}.limits.maxProposals`,
            ),
      maxActions:
        Number.isSafeInteger(limits.maxActions) && limits.maxActions >= 0
          ? limits.maxActions
          : fail(
              'E_OPERATE_CONTRACT_MALFORMED',
              `${path}.limits.maxActions must be a non-negative integer.`,
              `${path}.limits.maxActions`,
            ),
    },
    docsSection: requireIdentifier(value.docsSection, `${path}.docsSection`),
  };
}

function compileActorKinds(value, path) {
  const actorKinds = requireArray(value, path).map((actor, actorIndex) => {
    const candidate = requireIdentifier(actor, `${path}[${actorIndex}]`);
    if (!['agent', 'engine', 'human'].includes(candidate)) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${path}[${actorIndex}] is not a supported actor kind.`,
        `${path}[${actorIndex}]`,
      );
    }
    return candidate;
  });
  assertUnique(
    actorKinds.map((id) => ({ id })),
    ({ id }) => id,
    path,
    'Actor kind',
  );
  return actorKinds.sort((left, right) => left.localeCompare(right));
}

function compileGuard(raw, index) {
  const path = `$.guards[${index}]`;
  const value = assertExactFields(raw, path, new Set(['id', 'actorKinds']), ['id']);
  return {
    id: requireIdentifier(value.id, `${path}.id`),
    ...(value.actorKinds === undefined
      ? {}
      : { actorKinds: compileActorKinds(value.actorKinds, `${path}.actorKinds`) }),
  };
}

function compileTransition(raw, index, entityIds, guardIds) {
  const path = `$.transitions[${index}]`;
  const value = assertExactFields(
    raw,
    path,
    new Set(['entityId', 'from', 'to', 'guard', 'event', 'actorKinds']),
  );
  const entityId = requireIdentifier(value.entityId, `${path}.entityId`);
  if (!entityIds.has(entityId)) {
    fail(
      'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
      `${path}.entityId references an unknown entity contract.`,
      `${path}.entityId`,
      { entityId },
    );
  }
  const guard = requireIdentifier(value.guard, `${path}.guard`);
  if (!guardIds.has(guard)) {
    fail(
      'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
      `${path}.guard references an unknown guard.`,
      `${path}.guard`,
      { guard },
    );
  }
  const actorKinds = compileActorKinds(value.actorKinds, `${path}.actorKinds`);
  return {
    entityId,
    from: requireLifecycleState(value.from, `${path}.from`),
    to: requireLifecycleState(value.to, `${path}.to`),
    guard,
    event: requireEvent(value.event, `${path}.event`),
    actorKinds: actorKinds.sort((left, right) => left.localeCompare(right)),
  };
}

function compileOperation(raw, index, guardIds) {
  const path = `$.operations[${index}]`;
  const value = assertExactFields(
    raw,
    path,
    new Set(['id', 'effect', 'guard', 'argumentProfile', 'docsSection']),
  );
  const guard = requireIdentifier(value.guard, `${path}.guard`);
  if (!guardIds.has(guard)) {
    fail(
      'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
      `${path}.guard references an unknown guard.`,
      `${path}.guard`,
      { guard },
    );
  }
  if (
    ![
      'read-only',
      'machine-local-write',
      'project-write',
      'provider-call',
      'external-effect',
      'destructive',
    ].includes(value.effect)
  ) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.effect is not a supported effect class.`,
      `${path}.effect`,
    );
  }
  return {
    id: requireOperation(value.id, `${path}.id`),
    effect: value.effect,
    guard,
    argumentProfile: requireIdentifier(value.argumentProfile, `${path}.argumentProfile`),
    docsSection: requireIdentifier(value.docsSection, `${path}.docsSection`),
  };
}

function compileAction(raw, index, operationIds) {
  const path = `$.actions[${index}]`;
  const value = assertExactFields(raw, path, new Set(['operationId', 'label']));
  const operationId = requireOperation(value.operationId, `${path}.operationId`);
  if (!operationIds.has(operationId)) {
    fail(
      'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
      `${path}.operationId references an unknown operation.`,
      `${path}.operationId`,
      { operationId },
    );
  }
  return { operationId, label: requireString(value.label, `${path}.label`) };
}

function compileDependencyPolicy(raw, index) {
  const path = `$.dependencyPolicies[${index}]`;
  const value = assertExactFields(
    raw,
    path,
    new Set(['id', 'version', 'kind', 'minimumValidated', 'allowedTerminalOutcomes']),
  );
  const kind = requireIdentifier(value.kind, `${path}.kind`);
  const minimumValidated = value.minimumValidated;
  if (
    !(
      minimumValidated === 'all' ||
      minimumValidated === 'declared' ||
      (Number.isSafeInteger(minimumValidated) && minimumValidated >= 0)
    )
  ) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.minimumValidated must be all, declared, or a non-negative integer.`,
      `${path}.minimumValidated`,
    );
  }
  const allowedTerminalOutcomes = requireArray(
    value.allowedTerminalOutcomes,
    `${path}.allowedTerminalOutcomes`,
  )
    .map((outcome, outcomeIndex) =>
      requireIdentifier(outcome, `${path}.allowedTerminalOutcomes[${outcomeIndex}]`),
    )
    .sort((left, right) => left.localeCompare(right));
  assertUnique(
    allowedTerminalOutcomes.map((id) => ({ id })),
    ({ id }) => id,
    `${path}.allowedTerminalOutcomes`,
    'Terminal outcome',
  );
  return {
    id: requireIdentifier(value.id, `${path}.id`),
    version: requireVersion(value.version, `${path}.version`),
    kind,
    minimumValidated,
    allowedTerminalOutcomes,
  };
}

function compileError(raw, index) {
  const path = `$.errors[${index}]`;
  const value = assertExactFields(raw, path, new Set(['code', 'retryability']));
  const code = requireString(value.code, `${path}.code`);
  if (!ERROR_CODE.test(code)) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.code must be an upper snake-case error code.`,
      `${path}.code`,
    );
  }
  if (!['never', 'state-derived'].includes(value.retryability)) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.retryability must be never or state-derived.`,
      `${path}.retryability`,
    );
  }
  return { code, retryability: value.retryability };
}

function compileProvenance(raw, path) {
  const value = assertExactFields(
    raw,
    path,
    new Set(['packageName', 'packageVersion', 'integrity']),
  );
  const integrity = requireString(value.integrity, `${path}.integrity`);
  if (!/^sha256:[a-f0-9]{64}$/u.test(integrity)) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.integrity must be a lowercase SHA-256 integrity value.`,
      `${path}.integrity`,
    );
  }
  return {
    packageName: requireIdentifier(value.packageName, `${path}.packageName`),
    packageVersion: requireVersion(value.packageVersion, `${path}.packageVersion`),
    integrity,
  };
}

function sameJson(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function compileDomainContract(raw, path, domainId) {
  const value = assertExactFields(raw, path, new Set(['apiDomainId', 'id', 'version']));
  const apiDomainId = requireIdentifier(value.apiDomainId, `${path}.apiDomainId`);
  if (apiDomainId !== domainId) {
    fail(
      'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
      `${path}.apiDomainId must explicitly equal the API domainId.`,
      `${path}.apiDomainId`,
      {
        apiDomainId,
        domainId,
      },
    );
  }
  const id = requireIdentifier(value.id, `${path}.id`);
  const version = requireVersion(value.version, `${path}.version`);
  const required = {
    business: { id: 'business-domain', version: '1.0.0' },
    software: { id: 'software-domain', version: '1.0.0' },
  }[domainId];
  if (required && (id !== required.id || version !== required.version)) {
    fail(
      'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
      `${path} must use the exact public domain-contract identity for ${domainId}.`,
      path,
      {
        domainId,
        expected: required,
        actual: { id, version },
      },
    );
  }
  return { apiDomainId, id, version };
}

function compileDomainRegistration(raw, index, roles, dependencyPolicies, contractRefs) {
  const path = `$.extensions.domains[${index}]`;
  const value = assertExactFields(
    raw,
    path,
    new Set([
      'domainId',
      'domainVersion',
      'domainContract',
      'provenance',
      'roles',
      'requirements',
      'vocabulary',
      'projectionContracts',
      'actionKinds',
      'requestedCapabilities',
      'policyRequirements',
    ]),
    [
      'domainId',
      'domainVersion',
      'provenance',
      'roles',
      'requirements',
      'vocabulary',
      'projectionContracts',
      'actionKinds',
      'requestedCapabilities',
    ],
  );
  const domainId = requireIdentifier(value.domainId, `${path}.domainId`);
  const domainVersion = requireVersion(value.domainVersion, `${path}.domainVersion`);
  const roleMandates = new Map(roles.map((role) => [`${role.id}@${role.version}`, role]));
  const policies = new Set(dependencyPolicies.map((policy) => `${policy.id}@${policy.version}`));
  const registeredRoles = requireArray(value.roles, `${path}.roles`).map((entry, roleIndex) => {
    const rolePath = `${path}.roles[${roleIndex}]`;
    const role = assertExactFields(
      entry,
      rolePath,
      new Set([
        'roleId',
        'roleKind',
        'label',
        'roleVersion',
        'output',
        'mandate',
        'analysisRubric',
        'analysisProfile',
        'evidenceRequirements',
        'resultRequirements',
        'selfAudit',
        'dependencyPolicy',
        'requirements',
      ]),
    );
    const roleId = requireIdentifier(role.roleId, `${rolePath}.roleId`);
    const roleKind = requireIdentifier(role.roleKind, `${rolePath}.roleKind`);
    const label = requireString(role.label, `${rolePath}.label`);
    const roleVersion = requireVersion(role.roleVersion, `${rolePath}.roleVersion`);
    if (!KERNEL_ROLE_KINDS.includes(roleKind)) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${rolePath}.roleKind must name a kernel scheduling kind.`,
        `${rolePath}.roleKind`,
        {
          roleKind,
          expected: [...KERNEL_ROLE_KINDS],
        },
      );
    }
    if (roleId === label) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${rolePath}.label is presentation text and cannot equal the role identity.`,
        `${rolePath}.label`,
        { roleId },
      );
    }
    if (domainId === 'business' && domainVersion === '1.0.0') {
      if (FORBIDDEN_BUSINESS_ROLE_IDS_V1.includes(roleId)) {
        fail(
          'E_OPERATE_CONTRACT_MALFORMED',
          `${rolePath}.roleId is not a registered business executive identity.`,
          `${rolePath}.roleId`,
          { roleId },
        );
      }
      if (!BUSINESS_DOMAIN_ROLE_IDS_V1.includes(roleId)) {
        fail(
          'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
          `${rolePath}.roleId is outside the unreleased business-domain 1.0.0 catalog.`,
          `${rolePath}.roleId`,
          { roleId },
        );
      }
    }
    if (domainId === 'software' && domainVersion === '1.0.0') {
      if (FORBIDDEN_SOFTWARE_EXECUTIVE_ROLE_IDS_V1.includes(roleId)) {
        fail(
          'E_OPERATE_CONTRACT_MALFORMED',
          `${rolePath}.roleId must stay software-native and cannot copy a business executive identity.`,
          `${rolePath}.roleId`,
          { roleId },
        );
      }
      if (!SOFTWARE_DOMAIN_ROLE_IDS_V1.includes(roleId)) {
        fail(
          'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
          `${rolePath}.roleId is outside the software-domain 1.0.0 catalog.`,
          `${rolePath}.roleId`,
          { roleId },
        );
      }
    }
    const kernelMandate = roleMandates.get(`${roleKind}@${roleVersion}`);
    if (!kernelMandate) {
      fail(
        'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
        `${rolePath} references an unknown role mandate.`,
        rolePath,
        { roleKind, roleVersion },
      );
    }
    const output = assertExactFields(
      role.output,
      `${rolePath}.output`,
      new Set(['schemaId', 'schemaVersion', 'mediaType', 'maxBytes']),
    );
    if (!sameJson(output, kernelMandate.output)) {
      fail(
        'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
        `${rolePath}.output must equal the compiler-owned role mandate.`,
        `${rolePath}.output`,
      );
    }
    const policy = assertExactFields(
      role.dependencyPolicy,
      `${rolePath}.dependencyPolicy`,
      new Set(['id', 'version']),
    );
    const dependencyPolicy = {
      id: requireIdentifier(policy.id, `${rolePath}.dependencyPolicy.id`),
      version: requireVersion(policy.version, `${rolePath}.dependencyPolicy.version`),
    };
    if (!policies.has(`${dependencyPolicy.id}@${dependencyPolicy.version}`)) {
      fail(
        'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
        `${rolePath}.dependencyPolicy references an unknown policy.`,
        `${rolePath}.dependencyPolicy`,
      );
    }
    const requirements = requireArray(role.requirements, `${rolePath}.requirements`)
      .map((requirement, requirementIndex) =>
        requireIdentifier(requirement, `${rolePath}.requirements[${requirementIndex}]`),
      )
      .sort((left, right) => left.localeCompare(right));
    assertUnique(
      requirements.map((id) => ({ id })),
      ({ id }) => id,
      `${rolePath}.requirements`,
      'Role requirement',
    );
    const analysisRubric = compileAnalysisRubric(role.analysisRubric, `${rolePath}.analysisRubric`);
    const analysisProfile = compileAnalysisProfile(
      role.analysisProfile,
      `${rolePath}.analysisProfile`,
      analysisRubric,
    );
    const expectedAnalysisProfile =
      domainId === 'business'
        ? ROLE_ANALYSIS_PROFILES[roleId]
        : {
            advisor: 'software-delivery',
            challenger: 'independent-challenge',
            chair: 'decision-synthesis',
          }[roleId];
    if (analysisProfile.id !== expectedAnalysisProfile || analysisProfile.version !== '1.0.0') {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${rolePath}.analysisProfile must use the exact registry-owned profile for the role.`,
        `${rolePath}.analysisProfile`,
        {
          actual: { id: analysisProfile.id, version: analysisProfile.version },
          expected: { id: expectedAnalysisProfile, version: '1.0.0' },
        },
      );
    }
    const evidenceRequirements = compileEvidenceRequirements(
      role.evidenceRequirements,
      `${rolePath}.evidenceRequirements`,
    );
    if (roleKind === 'advisor' && evidenceRequirements.length === 0) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${rolePath}.evidenceRequirements must declare at least one Advisor evidence predicate.`,
        `${rolePath}.evidenceRequirements`,
      );
    }
    const resultRequirements = compileResultRequirements(
      role.resultRequirements,
      `${rolePath}.resultRequirements`,
      analysisProfile,
      roleKind,
    );
    const selfAudit = compileExecutiveSelfAudit(role.selfAudit, `${rolePath}.selfAudit`);
    const seatMandate = compileMandate(role.mandate, `${rolePath}.mandate`);
    return {
      roleId,
      roleKind,
      label,
      roleVersion,
      output: kernelMandate.output,
      mandate: seatMandate,
      analysisRubric,
      analysisProfile,
      evidenceRequirements,
      resultRequirements,
      selfAudit,
      dependencyPolicy,
      requirements,
    };
  });
  assertUnique(
    registeredRoles,
    ({ roleId, roleVersion }) => `${roleId}@${roleVersion}`,
    `${path}.roles`,
    'Domain role',
  );
  if (domainId === 'business' && domainVersion === '1.0.0') {
    const declaredIds = registeredRoles.map(({ roleId }) => roleId).sort();
    if (JSON.stringify(declaredIds) !== JSON.stringify([...BUSINESS_DOMAIN_ROLE_IDS_V1])) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${path}.roles must declare the exact unreleased business executive catalog.`,
        `${path}.roles`,
        {
          declaredIds,
          expectedIds: [...BUSINESS_DOMAIN_ROLE_IDS_V1],
        },
      );
    }
  }
  if (domainId === 'software' && domainVersion === '1.0.0') {
    const declaredIds = registeredRoles.map(({ roleId }) => roleId).sort();
    if (JSON.stringify(declaredIds) !== JSON.stringify([...SOFTWARE_DOMAIN_ROLE_IDS_V1])) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${path}.roles must declare the exact software-native catalog.`,
        `${path}.roles`,
        {
          declaredIds,
          expectedIds: [...SOFTWARE_DOMAIN_ROLE_IDS_V1],
        },
      );
    }
  }
  const vocabulary = requireArray(value.vocabulary, `${path}.vocabulary`).map(
    (entry, vocabularyIndex) => {
      const vocabularyPath = `${path}.vocabulary[${vocabularyIndex}]`;
      const term = assertExactFields(entry, vocabularyPath, new Set(['term', 'definition']));
      return {
        term: requireIdentifier(term.term, `${vocabularyPath}.term`),
        definition: requireString(term.definition, `${vocabularyPath}.definition`),
      };
    },
  );
  assertUnique(vocabulary, ({ term }) => term, `${path}.vocabulary`, 'Domain vocabulary term');
  const projectionContracts = requireArray(
    value.projectionContracts,
    `${path}.projectionContracts`,
  ).map((entry, projectionIndex) => {
    const projectionPath = `${path}.projectionContracts[${projectionIndex}]`;
    const projection = assertExactFields(
      entry,
      projectionPath,
      new Set(['schemaId', 'schemaVersion']),
    );
    const schemaId = requireIdentifier(projection.schemaId, `${projectionPath}.schemaId`);
    const schemaVersion = requireVersion(
      projection.schemaVersion,
      `${projectionPath}.schemaVersion`,
    );
    if (!contractRefs.has(`${schemaId}@${schemaVersion}`)) {
      fail(
        'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
        `${projectionPath} references an unknown public projection contract.`,
        projectionPath,
        {
          schemaId,
          schemaVersion,
        },
      );
    }
    return { schemaId, schemaVersion };
  });
  assertUnique(
    projectionContracts,
    ({ schemaId, schemaVersion }) => `${schemaId}@${schemaVersion}`,
    `${path}.projectionContracts`,
    'Domain projection contract',
  );
  const actionKinds = requireArray(value.actionKinds, `${path}.actionKinds`).map(
    (entry, actionIndex) => {
      const actionPath = `${path}.actionKinds[${actionIndex}]`;
      const action = assertExactFields(entry, actionPath, new Set(['id', 'version']));
      return {
        id: requireIdentifier(action.id, `${actionPath}.id`),
        version: requireVersion(action.version, `${actionPath}.version`),
      };
    },
  );
  assertUnique(
    actionKinds,
    ({ id, version }) => `${id}@${version}`,
    `${path}.actionKinds`,
    'Domain action kind',
  );
  const requestedCapabilities = requireArray(
    value.requestedCapabilities,
    `${path}.requestedCapabilities`,
  ).map((entry, capabilityIndex) => {
    const capabilityPath = `${path}.requestedCapabilities[${capabilityIndex}]`;
    const capability = assertExactFields(
      entry,
      capabilityPath,
      new Set(['id', 'version', 'reason']),
    );
    return {
      id: requireIdentifier(capability.id, `${capabilityPath}.id`),
      version: requireVersion(capability.version, `${capabilityPath}.version`),
      reason: requireString(capability.reason, `${capabilityPath}.reason`),
    };
  });
  assertUnique(
    requestedCapabilities,
    ({ id, version }) => `${id}@${version}`,
    `${path}.requestedCapabilities`,
    'Requested capability',
  );
  const policyRequirements = requireArray(
    value.policyRequirements ?? [],
    `${path}.policyRequirements`,
  ).map((entry, requirementIndex) => {
    const requirementPath = `${path}.policyRequirements[${requirementIndex}]`;
    const requirement = assertExactFields(
      entry,
      requirementPath,
      new Set(['actionKind', 'capability', 'policy']),
    );
    const compileVersionedId = (rawId, field) => {
      const fieldPath = `${requirementPath}.${field}`;
      const identity = assertExactFields(rawId, fieldPath, new Set(['id', 'version']));
      return {
        id: requireIdentifier(identity.id, `${fieldPath}.id`),
        version: requireVersion(identity.version, `${fieldPath}.version`),
      };
    };
    const actionKind = compileVersionedId(requirement.actionKind, 'actionKind');
    if (!actionKinds.some((candidate) => sameJson(candidate, actionKind))) {
      fail(
        'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
        `${requirementPath}.actionKind must reference a declared domain action kind.`,
        `${requirementPath}.actionKind`,
      );
    }
    return {
      actionKind,
      capability: compileVersionedId(requirement.capability, 'capability'),
      policy: compileVersionedId(requirement.policy, 'policy'),
    };
  });
  assertUnique(
    policyRequirements,
    ({ actionKind, capability, policy }) =>
      `${actionKind.id}@${actionKind.version}:${capability.id}@${capability.version}:${policy.id}@${policy.version}`,
    `${path}.policyRequirements`,
    'Domain policy requirement',
  );
  const requirements = requireArray(value.requirements, `${path}.requirements`)
    .map((requirement, requirementIndex) =>
      requireIdentifier(requirement, `${path}.requirements[${requirementIndex}]`),
    )
    .sort((left, right) => left.localeCompare(right));
  assertUnique(
    requirements.map((id) => ({ id })),
    ({ id }) => id,
    `${path}.requirements`,
    'Domain requirement',
  );
  if ((domainId === 'business' || domainId === 'software') && value.domainContract === undefined) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.domainContract is required for the public ${domainId} domain.`,
      `${path}.domainContract`,
    );
  }
  const requiredProjection = {
    business: { schemaId: 'business-operating-snapshot-projection', schemaVersion: '1.0.0' },
    software: { schemaId: 'software-operating-snapshot-projection', schemaVersion: '1.0.0' },
  }[domainId];
  if (
    requiredProjection &&
    !projectionContracts.some((projection) => sameJson(projection, requiredProjection))
  ) {
    fail(
      'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
      `${path}.projectionContracts must name the exact public ${domainId} projection identity.`,
      `${path}.projectionContracts`,
      {
        domainId,
        requiredProjection,
      },
    );
  }
  if (domainId === 'business' || domainId === 'software') {
    for (const kind of KERNEL_ROLE_KINDS) {
      const declared = registeredRoles.filter(
        (role) => role.roleKind === kind && role.roleVersion === '2.0.0',
      );
      const permitted = kind === 'advisor' ? declared.length >= 1 : declared.length === 1;
      if (!permitted) {
        fail(
          'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
          `${path}.roles must declare the compiler-owned ${kind} mandate for ${domainId}.`,
          `${path}.roles`,
          {
            domainId,
            roleKind: kind,
            declared: declared.length,
          },
        );
      }
    }
  }
  return {
    domainId,
    domainVersion,
    ...(value.domainContract === undefined
      ? {}
      : {
          domainContract: compileDomainContract(
            value.domainContract,
            `${path}.domainContract`,
            domainId,
          ),
        }),
    provenance: compileProvenance(value.provenance, `${path}.provenance`),
    roles: registeredRoles.sort(
      compareBy(
        ({ roleId }) => roleId,
        ({ roleVersion }) => roleVersion,
      ),
    ),
    vocabulary: vocabulary.sort(compareBy(({ term }) => term)),
    projectionContracts: projectionContracts.sort(
      compareBy(
        ({ schemaId }) => schemaId,
        ({ schemaVersion }) => schemaVersion,
      ),
    ),
    actionKinds: actionKinds.sort(
      compareBy(
        ({ id }) => id,
        ({ version }) => version,
      ),
    ),
    requestedCapabilities: requestedCapabilities.sort(
      compareBy(
        ({ id }) => id,
        ({ version }) => version,
      ),
    ),
    policyRequirements: policyRequirements.sort(
      compareBy(
        ({ actionKind }) => actionKind.id,
        ({ actionKind }) => actionKind.version,
      ),
    ),
    requirements,
  };
}

function compileOperatingProvider(raw, index, contracts, kind) {
  const path = `$.extensions.${kind}[${index}]`;
  const value = assertExactFields(
    raw,
    path,
    new Set([
      'providerId',
      'providerVersion',
      'supportedDomains',
      'inputContract',
      'outputContract',
      'accessMode',
      'returnSemantics',
      'errorCodes',
      'provenance',
      'conformanceDigest',
      'implementation',
      'fallback',
    ]),
  );
  const contractById = new Map(
    contracts.map((contract) => [`${contract.id}@${contract.version}`, contract]),
  );
  const supportedDomains = requireArray(value.supportedDomains, `${path}.supportedDomains`).map(
    (entry, domainIndex) => {
      const domainPath = `${path}.supportedDomains[${domainIndex}]`;
      const domain = assertExactFields(
        entry,
        domainPath,
        new Set(['apiDomainId', 'domainContractId', 'domainContractVersion']),
      );
      const apiDomainId = requireIdentifier(domain.apiDomainId, `${domainPath}.apiDomainId`);
      const domainContractId = requireIdentifier(
        domain.domainContractId,
        `${domainPath}.domainContractId`,
      );
      const domainContractVersion = requireVersion(
        domain.domainContractVersion,
        `${domainPath}.domainContractVersion`,
      );
      compileDomainContract(
        { apiDomainId, id: domainContractId, version: domainContractVersion },
        domainPath,
        apiDomainId,
      );
      return { apiDomainId, domainContractId, domainContractVersion };
    },
  );
  assertUnique(
    supportedDomains,
    ({ apiDomainId, domainContractId, domainContractVersion }) =>
      `${apiDomainId}:${domainContractId}@${domainContractVersion}`,
    `${path}.supportedDomains`,
    'Operating provider domain',
  );
  const compileContractReference = (entry, entryPath) => {
    const reference = assertExactFields(entry, entryPath, new Set(['schemaId', 'schemaVersion']));
    const schemaId = requireIdentifier(reference.schemaId, `${entryPath}.schemaId`);
    const schemaVersion = requireVersion(reference.schemaVersion, `${entryPath}.schemaVersion`);
    if (!contractById.has(`${schemaId}@${schemaVersion}`)) {
      fail(
        'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
        `${entryPath} references an unknown explicit contract.`,
        entryPath,
        {
          schemaId,
          schemaVersion,
        },
      );
    }
    return { schemaId, schemaVersion };
  };
  const inputContract = compileContractReference(value.inputContract, `${path}.inputContract`);
  const outputContract = compileContractReference(value.outputContract, `${path}.outputContract`);
  const expectedContracts = {
    snapshotProviders: {
      inputs: ['operating-artifact', 'operating-snapshot'],
      outputs: ['operating-snapshot'],
    },
    metricProviders: {
      inputs: ['operating-artifact', 'operating-snapshot', 'operating-metric'],
      outputs: ['operating-metric-observation'],
    },
    verificationProviders: {
      inputs: [
        'operating-artifact',
        'operating-action-verification-plan',
        'operating-metric-observation',
      ],
      outputs: ['operating-outcome', 'operating-learning'],
    },
  }[kind];
  if (
    !expectedContracts ||
    !expectedContracts.inputs.includes(inputContract.schemaId) ||
    !expectedContracts.outputs.includes(outputContract.schemaId)
  ) {
    fail(
      'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
      `${path} must use the exact bounded ${kind} contract inputs and outputs.`,
      path,
      {
        inputContract,
        outputContract,
      },
    );
  }
  if (!['accepted-input-only', 'declared-read-only'].includes(value.accessMode)) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.accessMode must be accepted-input-only or declared-read-only.`,
      `${path}.accessMode`,
    );
  }
  if (value.returnSemantics !== 'candidate') {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.returnSemantics must be candidate.`,
      `${path}.returnSemantics`,
    );
  }
  const errorCodes = requireArray(value.errorCodes, `${path}.errorCodes`)
    .map((code, errorIndex) => {
      const candidate = requireString(code, `${path}.errorCodes[${errorIndex}]`);
      if (!ERROR_CODE.test(candidate)) {
        fail(
          'E_OPERATE_CONTRACT_MALFORMED',
          `${path}.errorCodes[${errorIndex}] must be an upper snake-case error code.`,
          `${path}.errorCodes[${errorIndex}]`,
        );
      }
      return candidate;
    })
    .sort((left, right) => left.localeCompare(right));
  assertUnique(
    errorCodes.map((code) => ({ code })),
    ({ code }) => code,
    `${path}.errorCodes`,
    'Operating provider error code',
  );
  if (
    JSON.stringify(errorCodes) !==
    JSON.stringify(['OPERATING_PROVIDER_INPUT_INVALID', 'OPERATING_PROVIDER_UNAVAILABLE'])
  ) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.errorCodes must declare the exact safe provider error vocabulary.`,
      `${path}.errorCodes`,
    );
  }
  const implementation = assertExactFields(
    value.implementation,
    `${path}.implementation`,
    new Set(['kind', 'id']),
  );
  if (implementation.kind !== 'built-in') {
    fail(
      'E_OPERATE_CONTRACT_UNSAFE',
      `${path}.implementation.kind must be the static built-in declaration.`,
      `${path}.implementation.kind`,
    );
  }
  const fallback = assertExactFields(
    value.fallback,
    `${path}.fallback`,
    new Set(['kind', 'errorCode']),
  );
  if (fallback.kind !== 'unavailable' || fallback.errorCode !== 'OPERATING_PROVIDER_UNAVAILABLE') {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.fallback must be the explicit unavailable provider result.`,
      `${path}.fallback`,
    );
  }
  const conformanceDigest = requireString(value.conformanceDigest, `${path}.conformanceDigest`);
  if (!/^sha256:[a-f0-9]{64}$/u.test(conformanceDigest)) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.conformanceDigest must be a lowercase SHA-256 digest.`,
      `${path}.conformanceDigest`,
    );
  }
  return {
    providerId: requireIdentifier(value.providerId, `${path}.providerId`),
    providerVersion: requireVersion(value.providerVersion, `${path}.providerVersion`),
    supportedDomains: supportedDomains.sort(
      compareBy(
        ({ apiDomainId }) => apiDomainId,
        ({ domainContractId }) => domainContractId,
        ({ domainContractVersion }) => domainContractVersion,
      ),
    ),
    inputContract,
    outputContract,
    accessMode: value.accessMode,
    returnSemantics: value.returnSemantics,
    errorCodes,
    provenance: compileProvenance(value.provenance, `${path}.provenance`),
    conformanceDigest,
    implementation: {
      kind: 'built-in',
      id: requireIdentifier(implementation.id, `${path}.implementation.id`),
    },
    fallback: { kind: 'unavailable', errorCode: 'OPERATING_PROVIDER_UNAVAILABLE' },
  };
}

function compileAgentRuntimeManifest(raw, index, contracts) {
  const path = `$.extensions.agentRuntimeManifests[${index}]`;
  const value = assertExactFields(
    raw,
    path,
    new Set([
      'runtimeId',
      'runtimeVersion',
      'provenance',
      'implementation',
      'supportedContracts',
      'capabilitiesRequested',
      'limits',
      'health',
      'fallback',
    ]),
  );
  const implementation = assertExactFields(
    value.implementation,
    `${path}.implementation`,
    new Set(['packageName', 'packageVersion', 'exportName', 'availability']),
  );
  if (!['available', 'unavailable'].includes(implementation.availability)) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.implementation.availability must be available or unavailable.`,
      `${path}.implementation.availability`,
    );
  }
  const supportedContracts = requireArray(
    value.supportedContracts,
    `${path}.supportedContracts`,
  ).map((entry, contractIndex) => {
    const contractPath = `${path}.supportedContracts[${contractIndex}]`;
    const contract = assertExactFields(entry, contractPath, new Set(['schemaId', 'schemaVersion']));
    const schemaId = requireIdentifier(contract.schemaId, `${contractPath}.schemaId`);
    const schemaVersion = requireVersion(contract.schemaVersion, `${contractPath}.schemaVersion`);
    if (!contracts.has(`${schemaId}@${schemaVersion}`)) {
      fail(
        'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
        `${contractPath} references an unknown contract.`,
        contractPath,
        { schemaId, schemaVersion },
      );
    }
    return { schemaId, schemaVersion };
  });
  assertUnique(
    supportedContracts,
    ({ schemaId, schemaVersion }) => `${schemaId}@${schemaVersion}`,
    `${path}.supportedContracts`,
    'Supported contract',
  );
  const capabilitiesRequested = requireArray(
    value.capabilitiesRequested,
    `${path}.capabilitiesRequested`,
  )
    .map((capability, capabilityIndex) =>
      requireOperation(capability, `${path}.capabilitiesRequested[${capabilityIndex}]`),
    )
    .sort((left, right) => left.localeCompare(right));
  assertUnique(
    capabilitiesRequested.map((id) => ({ id })),
    ({ id }) => id,
    `${path}.capabilitiesRequested`,
    'Requested capability',
  );
  const limits = assertExactFields(
    value.limits,
    `${path}.limits`,
    new Set(['maxConcurrentAssignments', 'maxOutputBytes']),
  );
  const health = assertExactFields(
    value.health,
    `${path}.health`,
    new Set(['status', 'checkedAt', 'conformanceDigest']),
  );
  if (health.status !== 'conformant') {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.health.status must be conformant.`,
      `${path}.health.status`,
    );
  }
  const conformanceDigest = requireString(
    health.conformanceDigest,
    `${path}.health.conformanceDigest`,
  );
  if (!/^sha256:[a-f0-9]{64}$/u.test(conformanceDigest)) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.health.conformanceDigest must be a lowercase SHA-256 digest.`,
      `${path}.health.conformanceDigest`,
    );
  }
  const fallback = assertExactFields(
    value.fallback,
    `${path}.fallback`,
    new Set(['kind', 'runtimeId', 'runtimeVersion']),
    ['kind'],
  );
  const fallbackKind = requireIdentifier(fallback.kind, `${path}.fallback.kind`);
  if (!['unavailable', 'runtime'].includes(fallbackKind)) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.fallback.kind must be unavailable or runtime.`,
      `${path}.fallback.kind`,
    );
  }
  if (
    fallbackKind === 'unavailable' &&
    (Object.hasOwn(fallback, 'runtimeId') || Object.hasOwn(fallback, 'runtimeVersion'))
  ) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.fallback must not identify a runtime when unavailable.`,
      `${path}.fallback`,
    );
  }
  if (
    fallbackKind === 'runtime' &&
    (!Object.hasOwn(fallback, 'runtimeId') || !Object.hasOwn(fallback, 'runtimeVersion'))
  ) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.fallback must identify an explicit runtime version.`,
      `${path}.fallback`,
    );
  }
  return {
    runtimeId: requireIdentifier(value.runtimeId, `${path}.runtimeId`),
    runtimeVersion: requireVersion(value.runtimeVersion, `${path}.runtimeVersion`),
    provenance: compileProvenance(value.provenance, `${path}.provenance`),
    implementation: {
      packageName: requireIdentifier(
        implementation.packageName,
        `${path}.implementation.packageName`,
      ),
      packageVersion: requireVersion(
        implementation.packageVersion,
        `${path}.implementation.packageVersion`,
      ),
      exportName: requireString(implementation.exportName, `${path}.implementation.exportName`),
      availability: implementation.availability,
    },
    supportedContracts: supportedContracts.sort(
      compareBy(
        ({ schemaId }) => schemaId,
        ({ schemaVersion }) => schemaVersion,
      ),
    ),
    capabilitiesRequested,
    limits: {
      maxConcurrentAssignments: requirePositiveInteger(
        limits.maxConcurrentAssignments,
        `${path}.limits.maxConcurrentAssignments`,
      ),
      maxOutputBytes: requirePositiveInteger(
        limits.maxOutputBytes,
        `${path}.limits.maxOutputBytes`,
      ),
    },
    health: {
      status: health.status,
      checkedAt: requireString(health.checkedAt, `${path}.health.checkedAt`),
      conformanceDigest,
    },
    fallback:
      fallbackKind === 'unavailable'
        ? { kind: 'unavailable' }
        : {
            kind: 'runtime',
            runtimeId: requireIdentifier(fallback.runtimeId, `${path}.fallback.runtimeId`),
            runtimeVersion: requireVersion(
              fallback.runtimeVersion,
              `${path}.fallback.runtimeVersion`,
            ),
          },
  };
}

function compileGovernedProviderRegistration(raw, index, contracts, kind) {
  const path = `$.extensions.${kind}[${index}]`;
  const commonFields = [
    'supportedActionKinds',
    'errorContract',
    'errorCodes',
    'timeoutPolicy',
    'retryPolicy',
    'idempotency',
    'reconciliation',
    'health',
    'versionCompatibility',
    'provenance',
    'conformanceDigest',
    'implementation',
    'fallback',
  ];
  const definitions = {
    capabilityProviders: {
      fields: [
        'providerId',
        'providerVersion',
        'capabilities',
        'supportedDomains',
        'supportedTargetKinds',
        'effectCeiling',
        'inputContract',
        'outputContract',
        ...commonFields,
      ],
      identity: ['providerId', 'providerVersion'],
      list: 'capabilities',
      fallbackError: 'CAPABILITY_PROVIDER_UNAVAILABLE',
      contracts: {
        inputContract: ['operating-action'],
        outputContract: ['operating-capability-availability'],
        errorContract: ['operate-api-envelope'],
      },
    },
    policyProviders: {
      fields: [
        'providerId',
        'providerVersion',
        'policyRefs',
        'supportedDomains',
        'effectCeiling',
        'tier',
        'precedence',
        'narrowingOnly',
        'inputContract',
        'outputContract',
        ...commonFields,
      ],
      identity: ['providerId', 'providerVersion'],
      list: 'policyRefs',
      fallbackError: 'POLICY_PROVIDER_UNAVAILABLE',
      contracts: {
        inputContract: ['operating-action'],
        outputContract: ['operating-policy-evaluation'],
        errorContract: ['operate-api-envelope'],
      },
    },
    executors: {
      fields: [
        'executorId',
        'executorVersion',
        'operationKinds',
        'capabilities',
        'supportedDomains',
        'supportedTargetKinds',
        'effectCeiling',
        'inputContract',
        'outputContract',
        'rollbackContract',
        ...commonFields,
      ],
      identity: ['executorId', 'executorVersion'],
      list: 'capabilities',
      fallbackError: 'EXECUTOR_UNAVAILABLE',
      contracts: {
        inputContract: ['operating-governed-operation'],
        outputContract: ['operating-execution-result'],
        rollbackContract: ['operating-rollback-result'],
        errorContract: ['operate-api-envelope'],
      },
    },
  }[kind];
  const value = assertExactFields(raw, path, new Set(definitions.fields));
  const contractRefs = new Set(contracts.map(({ id, version }) => `${id}@${version}`));
  const compileContractReference = (rawReference, field) => {
    const referencePath = `${path}.${field}`;
    const reference = assertExactFields(
      rawReference,
      referencePath,
      new Set(['schemaId', 'schemaVersion']),
    );
    const schemaId = requireIdentifier(reference.schemaId, `${referencePath}.schemaId`);
    const schemaVersion = requireVersion(reference.schemaVersion, `${referencePath}.schemaVersion`);
    if (
      !contractRefs.has(`${schemaId}@${schemaVersion}`) ||
      !definitions.contracts[field].includes(schemaId)
    ) {
      fail(
        'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
        `${referencePath} is outside the bounded governed-execution contract family.`,
        referencePath,
      );
    }
    return { schemaId, schemaVersion };
  };
  const compileVersionedIds = (rawList, field) => {
    const listPath = `${path}.${field}`;
    const list = requireArray(rawList, listPath).map((rawEntry, entryIndex) => {
      const entryPath = `${listPath}[${entryIndex}]`;
      const entry = assertExactFields(rawEntry, entryPath, new Set(['id', 'version']));
      return {
        id: requireIdentifier(entry.id, `${entryPath}.id`),
        version: requireVersion(entry.version, `${entryPath}.version`),
      };
    });
    if (list.length === 0)
      fail('E_OPERATE_CONTRACT_MALFORMED', `${listPath} must not be empty.`, listPath);
    assertUnique(list, ({ id, version }) => `${id}@${version}`, listPath, 'Versioned declaration');
    return list.sort(
      compareBy(
        ({ id }) => id,
        ({ version }) => version,
      ),
    );
  };
  const compileIdentifiers = (rawList, field) => {
    const listPath = `${path}.${field}`;
    const list = requireArray(rawList, listPath).map((entry, entryIndex) =>
      requireIdentifier(entry, `${listPath}[${entryIndex}]`),
    );
    if (list.length === 0)
      fail('E_OPERATE_CONTRACT_MALFORMED', `${listPath} must not be empty.`, listPath);
    assertUnique(
      list.map((id) => ({ id })),
      ({ id }) => id,
      listPath,
      'Declaration',
    );
    return list.sort((left, right) => left.localeCompare(right));
  };
  if (!GOVERNED_EFFECT_CLASSES.slice(0, -1).includes(value.effectCeiling)) {
    fail(
      'E_OPERATE_CONTRACT_UNSAFE',
      `${path}.effectCeiling cannot register the prohibited destructive class.`,
      `${path}.effectCeiling`,
    );
  }
  const supportedActionKinds = compileVersionedIds(
    value.supportedActionKinds,
    'supportedActionKinds',
  );
  const errorCodes = requireArray(value.errorCodes, `${path}.errorCodes`)
    .map((code, errorIndex) => {
      const candidate = requireString(code, `${path}.errorCodes[${errorIndex}]`);
      if (!ERROR_CODE.test(candidate))
        fail(
          'E_OPERATE_CONTRACT_MALFORMED',
          `${path}.errorCodes must use upper snake case.`,
          `${path}.errorCodes[${errorIndex}]`,
        );
      return candidate;
    })
    .sort((left, right) => left.localeCompare(right));
  if (errorCodes.length === 0 || !errorCodes.includes(definitions.fallbackError)) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.errorCodes must include the fail-closed fallback error.`,
      `${path}.errorCodes`,
    );
  }
  assertUnique(
    errorCodes.map((code) => ({ code })),
    ({ code }) => code,
    `${path}.errorCodes`,
    'Governed provider error code',
  );

  const timeoutPolicy = assertExactFields(
    value.timeoutPolicy,
    `${path}.timeoutPolicy`,
    new Set(['timeoutMs', 'onTimeout']),
  );
  const timeoutMs = requirePositiveInteger(
    timeoutPolicy.timeoutMs,
    `${path}.timeoutPolicy.timeoutMs`,
  );
  if (timeoutMs > 300000 || timeoutPolicy.onTimeout !== 'fail-closed') {
    fail(
      'E_OPERATE_CONTRACT_UNSAFE',
      `${path}.timeoutPolicy must be bounded and fail closed.`,
      `${path}.timeoutPolicy`,
    );
  }
  const retryPolicy = assertExactFields(
    value.retryPolicy,
    `${path}.retryPolicy`,
    new Set(['maxAttempts', 'backoff', 'retryableErrorCodes']),
  );
  const maxAttempts = requirePositiveInteger(
    retryPolicy.maxAttempts,
    `${path}.retryPolicy.maxAttempts`,
  );
  if (maxAttempts > 3 || !['none', 'fixed'].includes(retryPolicy.backoff)) {
    fail(
      'E_OPERATE_CONTRACT_UNSAFE',
      `${path}.retryPolicy exceeds the bounded retry contract.`,
      `${path}.retryPolicy`,
    );
  }
  const retryableErrorCodes = requireArray(
    retryPolicy.retryableErrorCodes,
    `${path}.retryPolicy.retryableErrorCodes`,
  )
    .map((code, retryIndex) => {
      const candidate = requireString(
        code,
        `${path}.retryPolicy.retryableErrorCodes[${retryIndex}]`,
      );
      if (!errorCodes.includes(candidate))
        fail(
          'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
          `${path}.retryPolicy may reference only declared error codes.`,
          `${path}.retryPolicy.retryableErrorCodes[${retryIndex}]`,
        );
      return candidate;
    })
    .sort((left, right) => left.localeCompare(right));
  assertUnique(
    retryableErrorCodes.map((code) => ({ code })),
    ({ code }) => code,
    `${path}.retryPolicy.retryableErrorCodes`,
    'Retryable error code',
  );

  const idempotency = assertExactFields(
    value.idempotency,
    `${path}.idempotency`,
    new Set(['keySource', 'replay', 'intrinsicallyIdempotent']),
  );
  if (
    idempotency.keySource !== 'runtime-derived-request-fingerprint' ||
    idempotency.replay !== 'return-recorded-result'
  ) {
    fail(
      'E_OPERATE_CONTRACT_UNSAFE',
      `${path}.idempotency must use the runtime-derived fingerprint and recorded replay.`,
      `${path}.idempotency`,
    );
  }
  const intrinsicallyIdempotent = requireBoolean(
    idempotency.intrinsicallyIdempotent,
    `${path}.idempotency.intrinsicallyIdempotent`,
  );
  const reconciliation = assertExactFields(
    value.reconciliation,
    `${path}.reconciliation`,
    new Set(['supported', 'mode']),
  );
  const reconciliationSupported = requireBoolean(
    reconciliation.supported,
    `${path}.reconciliation.supported`,
  );
  const expectedReconciliationMode = reconciliationSupported ? 'deterministic' : 'none';
  if (reconciliation.mode !== expectedReconciliationMode) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.reconciliation mode must match its support declaration.`,
      `${path}.reconciliation.mode`,
    );
  }
  const health = assertExactFields(
    value.health,
    `${path}.health`,
    new Set(['status', 'checkedAt', 'expiresAt', 'healthHash']),
  );
  if (!['available', 'degraded', 'unavailable'].includes(health.status)) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.health.status is unsupported.`,
      `${path}.health.status`,
    );
  }
  const healthHash = requireString(health.healthHash, `${path}.health.healthHash`);
  if (!/^sha256:[a-f0-9]{64}$/u.test(healthHash))
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.health.healthHash must be a SHA-256 digest.`,
      `${path}.health.healthHash`,
    );
  const versionCompatibility = assertExactFields(
    value.versionCompatibility,
    `${path}.versionCompatibility`,
    new Set(['protocolVersion', 'minimumRuntimeVersion', 'maximumRuntimeVersion']),
  );
  if (versionCompatibility.protocolVersion !== '2.0.0')
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.versionCompatibility.protocolVersion must be 2.0.0.`,
      `${path}.versionCompatibility.protocolVersion`,
    );
  const maximumRuntimeVersion =
    versionCompatibility.maximumRuntimeVersion === null
      ? null
      : requireVersion(
          versionCompatibility.maximumRuntimeVersion,
          `${path}.versionCompatibility.maximumRuntimeVersion`,
        );
  if (
    isPlainObject(value.implementation) &&
    (Object.hasOwn(value.implementation, 'kind') ||
      Object.hasOwn(value.implementation, 'path') ||
      Object.hasOwn(value.implementation, 'module'))
  ) {
    fail(
      'E_OPERATE_CONTRACT_UNSAFE',
      `${path}.implementation must be a data-only classified source, never a dynamic module declaration.`,
      `${path}.implementation`,
    );
  }
  const implementation = assertExactFields(
    value.implementation,
    `${path}.implementation`,
    new Set(['source', 'id']),
  );
  if (!['built-in', 'public-optional', 'external'].includes(implementation.source)) {
    fail(
      'E_OPERATE_CONTRACT_UNSAFE',
      `${path}.implementation.source must be a classified data-only source.`,
      `${path}.implementation.source`,
    );
  }
  const fallback = assertExactFields(
    value.fallback,
    `${path}.fallback`,
    new Set(['kind', 'errorCode']),
  );
  if (fallback.kind !== 'unavailable' || fallback.errorCode !== definitions.fallbackError) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.fallback must fail closed with ${definitions.fallbackError}.`,
      `${path}.fallback`,
    );
  }
  const conformanceDigest = requireString(value.conformanceDigest, `${path}.conformanceDigest`);
  if (!/^sha256:[a-f0-9]{64}$/u.test(conformanceDigest)) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.conformanceDigest must be a lowercase SHA-256 digest.`,
      `${path}.conformanceDigest`,
    );
  }
  const result = {
    [definitions.identity[0]]: requireIdentifier(
      value[definitions.identity[0]],
      `${path}.${definitions.identity[0]}`,
    ),
    [definitions.identity[1]]: requireVersion(
      value[definitions.identity[1]],
      `${path}.${definitions.identity[1]}`,
    ),
    [definitions.list]: compileVersionedIds(value[definitions.list], definitions.list),
    supportedActionKinds,
    supportedDomains: compileIdentifiers(value.supportedDomains, 'supportedDomains'),
    ...(value.supportedTargetKinds === undefined
      ? {}
      : {
          supportedTargetKinds: compileIdentifiers(
            value.supportedTargetKinds,
            'supportedTargetKinds',
          ),
        }),
    effectCeiling: value.effectCeiling,
    ...Object.fromEntries(
      Object.keys(definitions.contracts).map((field) => [
        field,
        compileContractReference(value[field], field),
      ]),
    ),
    errorCodes,
    timeoutPolicy: { timeoutMs, onTimeout: 'fail-closed' },
    retryPolicy: { maxAttempts, backoff: retryPolicy.backoff, retryableErrorCodes },
    idempotency: {
      keySource: 'runtime-derived-request-fingerprint',
      replay: 'return-recorded-result',
      intrinsicallyIdempotent,
    },
    reconciliation: { supported: reconciliationSupported, mode: expectedReconciliationMode },
    health: {
      status: health.status,
      checkedAt: requireString(health.checkedAt, `${path}.health.checkedAt`),
      expiresAt: requireString(health.expiresAt, `${path}.health.expiresAt`),
      healthHash,
    },
    versionCompatibility: {
      protocolVersion: '2.0.0',
      minimumRuntimeVersion: requireVersion(
        versionCompatibility.minimumRuntimeVersion,
        `${path}.versionCompatibility.minimumRuntimeVersion`,
      ),
      maximumRuntimeVersion,
    },
    provenance: compileProvenance(value.provenance, `${path}.provenance`),
    conformanceDigest,
    implementation: {
      source: implementation.source,
      id: requireIdentifier(implementation.id, `${path}.implementation.id`),
    },
    fallback: { kind: 'unavailable', errorCode: definitions.fallbackError },
  };
  if (kind === 'policyProviders') {
    const tiers = {
      core: { precedence: 300, narrowingOnly: false },
      project: { precedence: 200, narrowingOnly: true },
      domain: { precedence: 100, narrowingOnly: true },
    };
    const tier = tiers[value.tier];
    if (
      !tier ||
      value.precedence !== tier.precedence ||
      value.narrowingOnly !== tier.narrowingOnly
    ) {
      fail(
        'E_OPERATE_CONTRACT_UNSAFE',
        `${path} must retain immutable core > project > narrowing domain policy precedence.`,
        path,
      );
    }
    result.tier = value.tier;
    result.precedence = tier.precedence;
    result.narrowingOnly = tier.narrowingOnly;
  }
  if (kind === 'executors') {
    const operationKinds = compileIdentifiers(value.operationKinds, 'operationKinds');
    if (operationKinds.some((operationKind) => !['execute', 'rollback'].includes(operationKind))) {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${path}.operationKinds may contain only execute and rollback.`,
        `${path}.operationKinds`,
      );
    }
    result.operationKinds = operationKinds;
  }
  return result;
}

function compileExtensions(raw, roles, dependencyPolicies, contracts, contractRefs) {
  const path = '$.extensions';
  const value = assertExactFields(
    raw,
    path,
    new Set([
      'domains',
      'agentRuntimeManifests',
      'snapshotProviders',
      'metricProviders',
      'verificationProviders',
      'capabilityProviders',
      'policyProviders',
      'executors',
    ]),
  );
  const domains = requireArray(value.domains, `${path}.domains`).map((entry, index) =>
    compileDomainRegistration(entry, index, roles, dependencyPolicies, contractRefs),
  );
  assertUnique(
    domains,
    ({ domainId, domainVersion }) => `${domainId}@${domainVersion}`,
    `${path}.domains`,
    'Domain registration',
  );
  const agentRuntimeManifests = requireArray(
    value.agentRuntimeManifests,
    `${path}.agentRuntimeManifests`,
  ).map((entry, index) => compileAgentRuntimeManifest(entry, index, contractRefs));
  assertUnique(
    agentRuntimeManifests,
    ({ runtimeId, runtimeVersion }) => `${runtimeId}@${runtimeVersion}`,
    `${path}.agentRuntimeManifests`,
    'Agent runtime manifest',
  );
  const runtimeKeys = new Set(
    agentRuntimeManifests.map(({ runtimeId, runtimeVersion }) => `${runtimeId}@${runtimeVersion}`),
  );
  for (const manifest of agentRuntimeManifests) {
    if (manifest.fallback.kind === 'runtime') {
      const fallbackKey = `${manifest.fallback.runtimeId}@${manifest.fallback.runtimeVersion}`;
      if (
        fallbackKey === `${manifest.runtimeId}@${manifest.runtimeVersion}` ||
        !runtimeKeys.has(fallbackKey)
      ) {
        fail(
          'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
          `${path}.agentRuntimeManifests fallback must identify a different registered runtime.`,
          path,
        );
      }
    }
  }
  const snapshotProviders = requireArray(value.snapshotProviders, `${path}.snapshotProviders`).map(
    (entry, index) => compileOperatingProvider(entry, index, contracts, 'snapshotProviders'),
  );
  const metricProviders = requireArray(value.metricProviders, `${path}.metricProviders`).map(
    (entry, index) => compileOperatingProvider(entry, index, contracts, 'metricProviders'),
  );
  const verificationProviders = requireArray(
    value.verificationProviders,
    `${path}.verificationProviders`,
  ).map((entry, index) =>
    compileOperatingProvider(entry, index, contracts, 'verificationProviders'),
  );
  const capabilityProviders = requireArray(
    value.capabilityProviders,
    `${path}.capabilityProviders`,
  ).map((entry, index) =>
    compileGovernedProviderRegistration(entry, index, contracts, 'capabilityProviders'),
  );
  const policyProviders = requireArray(value.policyProviders, `${path}.policyProviders`).map(
    (entry, index) =>
      compileGovernedProviderRegistration(entry, index, contracts, 'policyProviders'),
  );
  const executors = requireArray(value.executors, `${path}.executors`).map((entry, index) =>
    compileGovernedProviderRegistration(entry, index, contracts, 'executors'),
  );
  for (const [label, providers] of [
    ['Snapshot provider', snapshotProviders],
    ['Metric provider', metricProviders],
    ['Verification provider', verificationProviders],
  ]) {
    assertUnique(
      providers,
      ({ providerId, providerVersion }) => `${providerId}@${providerVersion}`,
      path,
      label,
    );
  }
  for (const [label, registrations, idField, versionField] of [
    ['Capability provider', capabilityProviders, 'providerId', 'providerVersion'],
    ['Policy provider', policyProviders, 'providerId', 'providerVersion'],
    ['Executor', executors, 'executorId', 'executorVersion'],
  ]) {
    assertUnique(registrations, (entry) => `${entry[idField]}@${entry[versionField]}`, path, label);
  }
  return {
    domains: domains.sort(
      compareBy(
        ({ domainId }) => domainId,
        ({ domainVersion }) => domainVersion,
      ),
    ),
    agentRuntimeManifests: agentRuntimeManifests.sort(
      compareBy(
        ({ runtimeId }) => runtimeId,
        ({ runtimeVersion }) => runtimeVersion,
      ),
    ),
    snapshotProviders: snapshotProviders.sort(
      compareBy(
        ({ providerId }) => providerId,
        ({ providerVersion }) => providerVersion,
      ),
    ),
    metricProviders: metricProviders.sort(
      compareBy(
        ({ providerId }) => providerId,
        ({ providerVersion }) => providerVersion,
      ),
    ),
    verificationProviders: verificationProviders.sort(
      compareBy(
        ({ providerId }) => providerId,
        ({ providerVersion }) => providerVersion,
      ),
    ),
    capabilityProviders: capabilityProviders.sort(
      compareBy(
        ({ providerId }) => providerId,
        ({ providerVersion }) => providerVersion,
      ),
    ),
    policyProviders: policyProviders.sort(
      compareBy(
        ({ providerId }) => providerId,
        ({ providerVersion }) => providerVersion,
      ),
    ),
    executors: executors.sort(
      compareBy(
        ({ executorId }) => executorId,
        ({ executorVersion }) => executorVersion,
      ),
    ),
  };
}

function compileGeneration(raw, protocolVersion) {
  const path = '$.generation';
  const value = assertExactFields(
    raw,
    path,
    new Set([
      'catalogPath',
      'packageInventoryPath',
      'documentationPath',
      'fixtureRoot',
      'verifiedTargets',
    ]),
  );
  const fixtureRoot = requirePath(value.fixtureRoot, `${path}.fixtureRoot`, {
    prefix: 'conformance/fixtures/',
  });
  const documentationPath = requirePath(value.documentationPath, `${path}.documentationPath`, {
    prefix: 'docs/',
  });
  const verifiedTargets = requireArray(value.verifiedTargets, `${path}.verifiedTargets`).map(
    (entry, index) => {
      const entryPath = `${path}.verifiedTargets[${index}]`;
      const target = assertExactFields(entry, entryPath, new Set(['path', 'sha256', 'kind']));
      const kind = requireIdentifier(target.kind, `${entryPath}.kind`);
      if (
        ![
          'schema',
          'registry',
          'declaration',
          'documentation',
          'validator',
          'compiler',
          'conformance',
          'extension',
          'generator',
          'projection',
        ].includes(kind)
      ) {
        fail(
          'E_OPERATE_CONTRACT_MALFORMED',
          `${entryPath}.kind is not a supported verified surface kind.`,
          `${entryPath}.kind`,
        );
      }
      const targetPath = requirePath(target.path, `${entryPath}.path`);
      const expectedPrefixes = {
        schema: [`schemas/v${protocolVersion}/`, 'schemas/v1.2.0/landing-'],
        registry: ['registry/live-evidence-providers.json', 'registry/landing-operations.json'],
        declaration: [
          'lib/protocol/',
          'lib/dashboard/operate-review-',
          'lib/operate/runtime-foundation.d.mts',
          'lib/pipeline/landing-contract.d.mts',
        ],
        documentation: ['docs/'],
        validator: [
          'lib/protocol/',
          'lib/dashboard/operate-review-',
          'lib/dashboard/generated/operate-review-',
          'lib/dashboard/generated/operate-schema-token-codec.mjs',
          'lib/pipeline/landing-contract.mjs',
        ],
        compiler: ['lib/operate/contracts/'],
        conformance: ['conformance/'],
        extension: ['lib/operate/extensions-v2.'],
        generator: ['scripts/'],
        projection: ['lib/operate/'],
      }[kind];
      const targetAllowed =
        kind === 'registry'
          ? expectedPrefixes.includes(targetPath)
          : expectedPrefixes.some((expectedPrefix) => targetPath.startsWith(expectedPrefix));
      if (!targetAllowed) {
        fail(
          'E_OPERATE_CONTRACT_UNSAFE',
          `${entryPath}.path is outside the allowed ${kind} surface.`,
          `${entryPath}.path`,
          {
            path: targetPath,
            expectedPrefixes,
          },
        );
      }
      const sha256 = requireString(target.sha256, `${entryPath}.sha256`);
      if (!SHA256.test(sha256)) {
        fail(
          'E_OPERATE_CONTRACT_MALFORMED',
          `${entryPath}.sha256 must be a lowercase SHA-256 digest.`,
          `${entryPath}.sha256`,
        );
      }
      return { path: targetPath, sha256, kind };
    },
  );
  assertUnique(
    verifiedTargets,
    ({ path: targetPath }) => targetPath,
    `${path}.verifiedTargets`,
    'Verified surface path',
  );
  return {
    catalogPath: requirePath(value.catalogPath, `${path}.catalogPath`, {
      prefix: 'lib/protocol/generated/',
    }),
    packageInventoryPath: requirePath(value.packageInventoryPath, `${path}.packageInventoryPath`, {
      prefix: 'lib/protocol/generated/',
    }),
    documentationPath,
    fixtureRoot,
    verifiedTargets: verifiedTargets.sort(compareBy(({ path: targetPath }) => targetPath)),
  };
}

function compilePersistentWorkContractIds(raw, contracts) {
  const path = '$.persistentWorkContractIds';
  const ids = requireArray(raw, path).map((value, index) =>
    requireIdentifier(value, `${path}[${index}]`),
  );
  assertUnique(
    ids.map((id) => ({ id })),
    ({ id }) => id,
    path,
    'Persistent-work contract',
  );
  if (ids.length !== 5) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path} must declare exactly five persistent-work contracts.`,
      path,
    );
  }
  const entities = new Set(
    contracts.filter(({ category }) => category === 'entity').map(({ id }) => id),
  );
  for (const id of ids) {
    if (!entities.has(id)) {
      fail(
        'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
        `${path} references an unknown entity contract.`,
        path,
        { id },
      );
    }
  }
  return ids.sort((left, right) => left.localeCompare(right));
}

function requireExactMembers(raw, path, expected, label, reader = requireIdentifier) {
  const values = requireArray(raw, path).map((value, index) => reader(value, `${path}[${index}]`));
  assertUnique(
    values.map((id) => ({ id })),
    ({ id }) => id,
    path,
    label,
  );
  const actual = [...values].sort((left, right) => left.localeCompare(right));
  if (
    JSON.stringify(actual) !==
    JSON.stringify([...expected].sort((left, right) => left.localeCompare(right)))
  ) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path} must declare the exact Phase 4 ${label.toLowerCase()} vocabulary.`,
      path,
      {
        expected,
        actual,
      },
    );
  }
  return actual;
}

function compileEvidence(raw, contracts, errors) {
  const path = '$.evidence';
  const value = assertExactFields(
    raw,
    path,
    new Set(['contractIds', 'kinds', 'sourceContracts', 'edgeRelations', 'resolverErrorCodes']),
  );
  const contractIds = requireExactMembers(
    value.contractIds,
    `${path}.contractIds`,
    EVIDENCE_CONTRACTS.map(([id]) => id),
    'Evidence contract',
  );
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));
  for (const [id, category] of EVIDENCE_CONTRACTS) {
    const contract = contractsById.get(id);
    if (!contract || contract.category !== category) {
      fail(
        'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
        `${path}.contractIds must reference the exact declared Phase 4 contract category.`,
        `${path}.contractIds`,
        { id, category },
      );
    }
  }
  const kinds = requireExactMembers(
    value.kinds,
    `${path}.kinds`,
    LOCAL_EVIDENCE_KINDS,
    'Evidence kind',
  );
  const sourceContracts = requireArray(value.sourceContracts, `${path}.sourceContracts`).map(
    (entry, index) => {
      const sourcePath = `${path}.sourceContracts[${index}]`;
      const source = assertExactFields(entry, sourcePath, new Set(['id', 'version']));
      return {
        id: requireIdentifier(source.id, `${sourcePath}.id`),
        version: requireVersion(source.version, `${sourcePath}.version`),
      };
    },
  );
  assertUnique(
    sourceContracts,
    ({ id, version }) => `${id}@${version}`,
    `${path}.sourceContracts`,
    'Evidence source contract',
  );
  const expectedSourceContracts = EVIDENCE_SOURCE_CONTRACT_IDS.map((id) => ({
    id,
    version: '1.0.0',
  }));
  if (JSON.stringify(sourceContracts) !== JSON.stringify(expectedSourceContracts)) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.sourceContracts must declare the exact Evidence source-contract vocabulary.`,
      `${path}.sourceContracts`,
      {
        expected: expectedSourceContracts,
        actual: sourceContracts,
      },
    );
  }
  const edgeRelations = requireExactMembers(
    value.edgeRelations,
    `${path}.edgeRelations`,
    EVIDENCE_EDGE_RELATIONS,
    'Evidence edge relation',
    requireString,
  );
  const resolverErrorCodes = requireExactMembers(
    value.resolverErrorCodes,
    `${path}.resolverErrorCodes`,
    EVIDENCE_RESOLVER_ERROR_CODES,
    'Evidence resolver error code',
    requireString,
  );
  for (const code of resolverErrorCodes) {
    if (!ERROR_CODE.test(code) || !errors.has(code)) {
      fail(
        'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
        `${path}.resolverErrorCodes must reference a declared safe Operate error code.`,
        `${path}.resolverErrorCodes`,
        { code },
      );
    }
  }
  return { contractIds, kinds, sourceContracts, edgeRelations, resolverErrorCodes };
}

function compileOperatingIntelligence(raw, contracts) {
  const path = '$.operatingIntelligence';
  const value = assertExactFields(
    raw,
    path,
    new Set(['contractIds', 'projectionIdentities', 'providerRegistrationContractIds']),
  );
  const contractIds = requireExactMembers(
    value.contractIds,
    `${path}.contractIds`,
    OPERATING_INTELLIGENCE_CONTRACTS.map(([id]) => id),
    'Operating-intelligence contract',
  );
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
  for (const [id, category, version] of OPERATING_INTELLIGENCE_CONTRACTS) {
    const contract = contractById.get(id);
    if (!contract || contract.category !== category || contract.version !== version) {
      fail(
        'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
        `${path}.contractIds must retain exact Phase 5 contract identities and categories.`,
        `${path}.contractIds`,
        {
          id,
          category,
          version,
        },
      );
    }
  }
  const projectionIdentities = requireExactMembers(
    value.projectionIdentities,
    `${path}.projectionIdentities`,
    OPERATING_PROJECTION_IDENTITIES,
    'Operating projection identity',
    requireString,
  );
  const providerRegistrationContractIds = requireExactMembers(
    value.providerRegistrationContractIds,
    `${path}.providerRegistrationContractIds`,
    OPERATING_INTELLIGENCE_CONTRACTS.filter(([, category]) => category === 'extension').map(
      ([id]) => id,
    ),
    'Operating provider registration contract',
  );
  return { contractIds, projectionIdentities, providerRegistrationContractIds };
}

function compileGovernedExecution(raw, contracts) {
  const path = '$.governedExecution';
  const value = assertExactFields(
    raw,
    path,
    new Set([
      'contractIds',
      'providerRegistrationContractIds',
      'effectClasses',
      'policyOutcomes',
      'policyTiers',
      'coreProhibitions',
      'operationStates',
      'toolOperations',
    ]),
  );
  const contractIds = requireExactMembers(
    value.contractIds,
    `${path}.contractIds`,
    GOVERNED_EXECUTION_CONTRACTS.map(([id]) => id),
    'Governed-execution contract',
  );
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
  for (const [id, category] of GOVERNED_EXECUTION_CONTRACTS) {
    const contract = contractById.get(id);
    if (!contract || contract.category !== category || contract.version !== '2.0.0') {
      fail(
        'E_OPERATE_CONTRACT_UNKNOWN_REFERENCE',
        `${path}.contractIds must retain exact Phase 6 contract identities and categories.`,
        `${path}.contractIds`,
        { id, category },
      );
    }
  }
  const providerRegistrationContractIds = requireExactMembers(
    value.providerRegistrationContractIds,
    `${path}.providerRegistrationContractIds`,
    GOVERNED_EXECUTION_PROVIDER_CONTRACTS,
    'Governed-execution provider registration contract',
  );
  requireExactMembers(
    value.effectClasses,
    `${path}.effectClasses`,
    GOVERNED_EFFECT_CLASSES,
    'Governed effect class',
  );
  const effectClasses = [...GOVERNED_EFFECT_CLASSES];
  const policyOutcomes = requireExactMembers(
    value.policyOutcomes,
    `${path}.policyOutcomes`,
    GOVERNED_POLICY_OUTCOMES,
    'Governed policy outcome',
  );
  const policyTiers = requireArray(value.policyTiers, `${path}.policyTiers`).map(
    (rawTier, index) => {
      const tierPath = `${path}.policyTiers[${index}]`;
      const tier = assertExactFields(
        rawTier,
        tierPath,
        new Set(['id', 'precedence', 'narrowingOnly']),
      );
      return {
        id: requireIdentifier(tier.id, `${tierPath}.id`),
        precedence: requirePositiveInteger(tier.precedence, `${tierPath}.precedence`),
        narrowingOnly: requireBoolean(tier.narrowingOnly, `${tierPath}.narrowingOnly`),
      };
    },
  );
  assertUnique(policyTiers, ({ id }) => id, `${path}.policyTiers`, 'Governed policy tier');
  const orderedPolicyTiers = GOVERNED_POLICY_TIERS.map((expected) =>
    policyTiers.find(({ id }) => id === expected.id),
  );
  if (
    orderedPolicyTiers.some(
      (tier, index) => JSON.stringify(tier) !== JSON.stringify(GOVERNED_POLICY_TIERS[index]),
    )
  ) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.policyTiers must declare exact immutable core, project, and domain precedence.`,
      `${path}.policyTiers`,
    );
  }
  const coreProhibitions = requireArray(value.coreProhibitions, `${path}.coreProhibitions`);
  if (
    coreProhibitions.some((entry) => typeof entry !== 'string') ||
    coreProhibitions.length !== GOVERNED_CORE_PROHIBITIONS.length ||
    new Set(coreProhibitions).size !== coreProhibitions.length ||
    GOVERNED_CORE_PROHIBITIONS.some((identifier) => !coreProhibitions.includes(identifier))
  ) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.coreProhibitions must declare the exact non-overridable reference policy set.`,
      `${path}.coreProhibitions`,
    );
  }
  const operationStates = requireExactMembers(
    value.operationStates,
    `${path}.operationStates`,
    GOVERNED_OPERATION_STATES,
    'Governed operation state',
  );
  const expectedToolOperations = [
    'operate.action.approve',
    'operate.action.execute',
    'operate.action.rollback',
  ];
  const toolOperations = requireArray(value.toolOperations, `${path}.toolOperations`)
    .map((rawOperation, index) => {
      const operationPath = `${path}.toolOperations[${index}]`;
      const operation = assertExactFields(
        rawOperation,
        operationPath,
        new Set(['id', 'effect', 'argumentProfile', 'docsSection']),
      );
      const id = requireOperation(operation.id, `${operationPath}.id`);
      if (operation.effect !== 'project-write')
        fail(
          'E_OPERATE_CONTRACT_MALFORMED',
          `${operationPath}.effect must remain project-write at the contract boundary.`,
          `${operationPath}.effect`,
        );
      return {
        id,
        effect: operation.effect,
        argumentProfile: requireIdentifier(
          operation.argumentProfile,
          `${operationPath}.argumentProfile`,
        ),
        docsSection: requireIdentifier(operation.docsSection, `${operationPath}.docsSection`),
      };
    })
    .sort(compareBy(({ id }) => id));
  if (
    JSON.stringify(toolOperations.map(({ id }) => id)) !== JSON.stringify(expectedToolOperations)
  ) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.toolOperations must declare the exact three Phase 6 action tools.`,
      `${path}.toolOperations`,
    );
  }
  return {
    contractIds,
    providerRegistrationContractIds,
    effectClasses,
    policyOutcomes,
    policyTiers: orderedPolicyTiers,
    coreProhibitions: [...GOVERNED_CORE_PROHIBITIONS],
    operationStates,
    toolOperations,
  };
}

function compileExperience(raw, protocolVersion) {
  const path = '$.experience';
  const value = assertExactFields(raw, path, new Set(['contracts', 'deliveryRoutes']));
  const contracts = requireArray(value.contracts, `${path}.contracts`).map((rawContract, index) => {
    const contractPath = `${path}.contracts[${index}]`;
    const contract = assertExactFields(
      rawContract,
      contractPath,
      new Set(['id', 'version', 'category', 'schemaPath', 'docsSection', 'fixtureKey']),
    );
    const id = requireIdentifier(contract.id, `${contractPath}.id`);
    const expected = EXPERIENCE_CONTRACTS.find(([candidate]) => candidate === id);
    if (!expected || contract.category !== expected[1] || contract.version !== '1.0.0') {
      fail(
        'E_OPERATE_CONTRACT_MALFORMED',
        `${contractPath} is not an exact public experience contract identity.`,
        contractPath,
      );
    }
    return {
      id,
      version: requireVersion(contract.version, `${contractPath}.version`),
      category: contract.category,
      schemaPath: requirePath(contract.schemaPath, `${contractPath}.schemaPath`, {
        prefix: `schemas/v${protocolVersion}/`,
      }),
      docsSection: requireIdentifier(contract.docsSection, `${contractPath}.docsSection`),
      fixtureKey: requireIdentifier(contract.fixtureKey, `${contractPath}.fixtureKey`),
    };
  });
  assertUnique(
    contracts,
    ({ id, version }) => `${id}@${version}`,
    `${path}.contracts`,
    'Experience contract',
  );
  assertUnique(
    contracts,
    ({ schemaPath }) => schemaPath,
    `${path}.contracts`,
    'Experience schema path',
  );
  const actualContracts = contracts.map(({ id }) => id).sort();
  const expectedContracts = EXPERIENCE_CONTRACTS.map(([id]) => id).sort();
  if (JSON.stringify(actualContracts) !== JSON.stringify(expectedContracts)) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      `${path}.contracts must declare the exact product-experience contract family.`,
      `${path}.contracts`,
      { expected: expectedContracts, actual: actualContracts },
    );
  }
  const deliveryRoutes = requireExactMembers(
    value.deliveryRoutes,
    `${path}.deliveryRoutes`,
    DELIVERY_ROUTES,
    'Delivery route',
  );
  return {
    contracts: contracts.sort(compareBy(({ id }) => id)),
    deliveryRoutes,
  };
}

/**
 * Compile a JSON-only Operate registry into a stable, side-effect-free catalog.
 * Filesystem reads and writes intentionally live in the generator script so this
 * function can be used by tests, package consumers, and later build targets.
 */
export function compileOperateContractRegistry(rawRegistry) {
  const source = assertExactFields(rawRegistry, '$', ROOT_FIELDS);
  if (source.kind !== OPERATE_CONTRACT_REGISTRY_KIND) {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      '$.kind must identify an Operate contract registry.',
      '$.kind',
    );
  }
  const schemaVersion = requireVersion(source.schemaVersion, '$.schemaVersion');
  const registryVersion = requireVersion(source.registryVersion, '$.registryVersion');
  const protocol = assertExactFields(
    source.protocol,
    '$.protocol',
    new Set(['id', 'version', 'versionPolicy']),
  );
  const protocolId = requireIdentifier(protocol.id, '$.protocol.id');
  if (protocolId !== 'operate') {
    fail('E_OPERATE_CONTRACT_MALFORMED', '$.protocol.id must be operate.', '$.protocol.id');
  }
  const protocolVersion = requireVersion(protocol.version, '$.protocol.version');
  if (protocol.versionPolicy !== 'exact') {
    fail(
      'E_OPERATE_CONTRACT_MALFORMED',
      '$.protocol.versionPolicy must be exact.',
      '$.protocol.versionPolicy',
    );
  }

  const contracts = requireArray(source.contracts, '$.contracts').map((entry, index) =>
    compileContract(entry, index, protocolVersion),
  );
  assertUnique(contracts, ({ id, version }) => `${id}@${version}`, '$.contracts', 'Contract');
  assertUnique(
    contracts,
    ({ runtimeOrder }) => runtimeOrder,
    '$.contracts',
    'Runtime contract order',
  );
  assertUnique(contracts, ({ schemaPath }) => schemaPath, '$.contracts', 'Schema path');
  assertUnique(contracts, ({ fixtureKey }) => fixtureKey, '$.contracts', 'Fixture key');
  const contractRefs = new Set(contracts.map(({ id, version }) => `${id}@${version}`));
  const entityIds = new Set(
    contracts.filter(({ category }) => category === 'entity').map(({ id }) => id),
  );

  const guards = requireArray(source.guards, '$.guards').map(compileGuard);
  assertUnique(guards, ({ id }) => id, '$.guards', 'Guard');
  const guardIds = new Set(guards.map(({ id }) => id));

  const roles = requireArray(source.roles, '$.roles').map((entry, index) =>
    compileRole(entry, index, contractRefs),
  );
  assertUnique(roles, ({ id, version }) => `${id}@${version}`, '$.roles', 'Role');

  const transitions = requireArray(source.transitions, '$.transitions').map((entry, index) =>
    compileTransition(entry, index, entityIds, guardIds),
  );
  assertUnique(
    transitions,
    ({ entityId, from, to, event }) => `${entityId}:${from}:${to}:${event}`,
    '$.transitions',
    'Transition',
  );

  const operations = requireArray(source.operations, '$.operations').map((entry, index) =>
    compileOperation(entry, index, guardIds),
  );
  assertUnique(operations, ({ id }) => id, '$.operations', 'Operation');
  const operationIds = new Set(operations.map(({ id }) => id));

  const actions = requireArray(source.actions, '$.actions').map((entry, index) =>
    compileAction(entry, index, operationIds),
  );
  assertUnique(actions, ({ operationId }) => operationId, '$.actions', 'Action');

  const dependencyPolicies = requireArray(source.dependencyPolicies, '$.dependencyPolicies').map(
    compileDependencyPolicy,
  );
  assertUnique(
    dependencyPolicies,
    ({ id, version }) => `${id}@${version}`,
    '$.dependencyPolicies',
    'Dependency policy',
  );

  const errors = requireArray(source.errors, '$.errors').map(compileError);
  assertUnique(errors, ({ code }) => code, '$.errors', 'Error');

  const generation = compileGeneration(source.generation, protocolVersion);
  const persistentWorkContractIds = compilePersistentWorkContractIds(
    source.persistentWorkContractIds,
    contracts,
  );
  const evidence = compileEvidence(
    source.evidence,
    contracts,
    new Set(errors.map(({ code }) => code)),
  );
  const operatingIntelligence = compileOperatingIntelligence(
    source.operatingIntelligence,
    contracts,
  );
  const governedExecution = compileGovernedExecution(source.governedExecution, contracts);
  const experience = compileExperience(source.experience, protocolVersion);
  const extensions = compileExtensions(
    source.extensions,
    roles,
    dependencyPolicies,
    contracts,
    contractRefs,
  );
  const runtimeContracts = [...contracts].sort(
    (left, right) => left.runtimeOrder - right.runtimeOrder,
  );
  const schemaRegistry = Object.fromEntries(
    [...contracts]
      .sort(
        compareBy(
          ({ id }) => id,
          ({ version }) => version,
        ),
      )
      .map(({ id, version, schemaPath }) => [id, { [version]: schemaPath }]),
  );

  return deepFreeze(
    canonicalize({
      kind: 'operate-contract-catalog',
      schemaVersion,
      compilerVersion: OPERATE_CONTRACT_COMPILER_VERSION,
      registryVersion,
      protocol: { id: protocolId, version: protocolVersion, versionPolicy: 'exact' },
      contracts: [...contracts].sort(
        compareBy(
          ({ id }) => id,
          ({ version }) => version,
        ),
      ),
      runtimeContracts,
      schemaRegistry,
      roles: [...roles].sort(
        compareBy(
          ({ id }) => id,
          ({ version }) => version,
        ),
      ),
      guards: [...guards].sort(compareBy(({ id }) => id)),
      transitions: [...transitions].sort(
        compareBy(
          ({ entityId }) => entityId,
          ({ from }) => from,
          ({ to }) => to,
          ({ event }) => event,
        ),
      ),
      operations: [...operations].sort(compareBy(({ id }) => id)),
      actions: [...actions].sort(compareBy(({ operationId }) => operationId)),
      dependencyPolicies: [...dependencyPolicies].sort(
        compareBy(
          ({ id }) => id,
          ({ version }) => version,
        ),
      ),
      errors: [...errors].sort(compareBy(({ code }) => code)),
      persistentWorkContractIds,
      evidence,
      operatingIntelligence,
      governedExecution,
      experience,
      extensions,
      generation,
    }),
  );
}

export function renderOperateContractCatalogModule(rawRegistry) {
  const catalog = compileOperateContractRegistry(rawRegistry);
  return `// Generated by scripts/generate-operate-contracts.mjs. Do not edit.\n\nconst deepFreeze = (value) => {\n  if (value && typeof value === 'object' && !Object.isFrozen(value)) {\n    for (const nested of Object.values(value)) deepFreeze(nested);\n    Object.freeze(value);\n  }\n  return value;\n};\n\nexport const OPERATE_CONTRACT_CATALOG_V2 = deepFreeze(${JSON.stringify(catalog, null, 2)});\n\nexport default OPERATE_CONTRACT_CATALOG_V2;\n`;
}
