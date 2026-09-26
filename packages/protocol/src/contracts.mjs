// @ts-check
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGN_HANDOFF_CONTRACT_FILES } from './design-handoff-contracts.mjs';
import {
  DIAGRAM_AUTHORING_CONTRACT_FILES,
  validateDiagramAuthoringArtifact,
} from './diagram-authoring-contracts.mjs';
import { ENTERPRISE_SCHEMAS } from './enterprise-contracts.mjs';
import { PipelineError } from './errors.mjs';
import { OPERATE_CONTRACT_CATALOG_V2 } from './generated/contract-catalog-v2.mjs';
import { validateJson } from './json-schema.mjs';
import {
  PROTOCOL_V16_CONTRACT_FILES,
  PROTOCOL_V17_CONTRACT_FILES,
  PROTOCOL_V18_CONTRACT_FILES,
} from './skill-source-contracts.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Versioned path for a Protocol 1.6 additive skill-source contract, derived from
// the one canonical kind -> file map shared with browser-contracts.mjs.
const v16Schema = (kind) => `schemas/v1.6.0/${PROTOCOL_V16_CONTRACT_FILES[kind]}`;
const v17Schema = (kind) => `schemas/v1.7.0/${PROTOCOL_V17_CONTRACT_FILES[kind]}`;
const v18Schema = (kind) => `schemas/v1.8.0/${PROTOCOL_V18_CONTRACT_FILES[kind]}`;

const foundationPaths = {
  ...Object.fromEntries(
    Object.keys(ENTERPRISE_SCHEMAS).map((name) => [
      name,
      { '1.12.0': `schemas/v1.12.0/${name}.schema.json` },
    ]),
  ),
  'design-document': { '1.9.0': 'schemas/v1.9.0/design-document.schema.json' },
  'design-review-workspace': { '1.9.0': 'schemas/v1.9.0/design-review-workspace.schema.json' },
  'design-workspace-create': { '1.9.0': 'schemas/v1.9.0/design-workspace-create.schema.json' },
  'design-workspace-revision': { '1.9.0': 'schemas/v1.9.0/design-workspace-revision.schema.json' },
  'design-workspace-event': { '1.9.0': 'schemas/v1.9.0/design-workspace-event.schema.json' },
  'design-review-bundle': {
    '1.9.0': 'schemas/v1.9.0/design-review-bundle.schema.json',
    '1.10.0': 'schemas/v1.10.0/design-review-bundle.schema.json',
  },
  'design-review-context': { '1.10.0': 'schemas/v1.10.0/design-review-context.schema.json' },
  'design-review-handoff': { '1.10.0': 'schemas/v1.10.0/design-review-handoff.schema.json' },
  'design-review-metadata-payload': {
    '1.10.0': 'schemas/v1.10.0/design-review-metadata-payload.schema.json',
    '1.11.0': 'schemas/v1.11.0/design-review-metadata-payload.schema.json',
  },
  ...Object.fromEntries(
    Object.keys(DESIGN_HANDOFF_CONTRACT_FILES).map((name) => [
      name,
      { '1.11.0': `schemas/v1.11.0/${DESIGN_HANDOFF_CONTRACT_FILES[name]}` },
    ]),
  ),

  spec: { '1.0.0': 'schemas/v1.0.0/spec.schema.json', '1.7.0': v17Schema('spec') },
  story: { '1.0.0': 'schemas/v1.0.0/story.schema.json', '1.7.0': v17Schema('story') },
  task: { '1.0.0': 'schemas/v1.0.0/task.schema.json', '1.7.0': v17Schema('task') },
  'pipeline-shipped': { '1.0.0': 'schemas/v1.0.0/pipeline-shipped.schema.json' },
  'run-manifest': { '1.0.0': 'schemas/v1.0.0/run-manifest.schema.json' },
  'runtime-lock': { '1.1.0': 'schemas/v1.1.0/runtime-lock.schema.json' },
  'provenance-event': { '1.1.0': 'schemas/v1.1.0/provenance-event.schema.json' },
  'ship-closure': { '1.1.0': 'schemas/v1.1.0/ship-closure.schema.json' },
  'professional-specification': {
    '1.1.0': 'schemas/v1.1.0/professional-specification.schema.json',
  },
  'planning-review-record': { '1.1.0': 'schemas/v1.1.0/planning-review-record.schema.json' },
  'planning-review-state': { '1.1.0': 'schemas/v1.1.0/planning-review-state.schema.json' },
  'planning-review-event': { '1.1.0': 'schemas/v1.1.0/planning-review-event.schema.json' },
  'planning-review-receipt': { '1.1.0': 'schemas/v1.1.0/planning-review-receipt.schema.json' },
  'ship-review-specialist-registry': {
    '1.1.0': 'schemas/v1.1.0/ship-review-specialist-registry.schema.json',
  },
  'specialist-review-result': { '1.1.0': 'schemas/v1.1.0/specialist-review-result.schema.json' },
  'ship-risk-classification': { '1.1.0': 'schemas/v1.1.0/ship-risk-classification.schema.json' },
  'browser-qa-session': { '1.1.0': 'schemas/v1.1.0/browser-qa-session.schema.json' },
  'browser-qa-result': { '1.1.0': 'schemas/v1.1.0/browser-qa-result.schema.json' },
  'browser-qa-gate': { '1.1.0': 'schemas/v1.1.0/browser-qa-gate.schema.json' },
  'professional-skills': { '1.1.0': 'schemas/v1.1.0/professional-skills.schema.json' },
  'investigation-request': { '1.1.0': 'schemas/v1.1.0/investigation-request.schema.json' },
  'investigation-observation': { '1.1.0': 'schemas/v1.1.0/investigation-observation.schema.json' },
  'investigation-hypothesis': { '1.1.0': 'schemas/v1.1.0/investigation-hypothesis.schema.json' },
  'investigation-experiment': { '1.1.0': 'schemas/v1.1.0/investigation-experiment.schema.json' },
  'investigation-diagnosis': { '1.1.0': 'schemas/v1.1.0/investigation-diagnosis.schema.json' },
  'investigation-fix': { '1.1.0': 'schemas/v1.1.0/investigation-fix.schema.json' },
  'investigation-event': { '1.1.0': 'schemas/v1.1.0/investigation-event.schema.json' },
  'investigation-record': { '1.1.0': 'schemas/v1.1.0/investigation-record.schema.json' },
  'investigation-receipt': { '1.1.0': 'schemas/v1.1.0/investigation-receipt.schema.json' },
  'adapter-registry': {
    '1.1.0': 'schemas/v1.1.0/adapter-registry.schema.json',
    '1.4.0': 'schemas/v1.4.0/adapter-registry.schema.json',
  },
  'ecosystem-manifest': {
    '1.1.0': 'schemas/v1.1.0/ecosystem-manifest.schema.json',
    '1.3.0': 'schemas/v1.3.0/ecosystem-manifest.schema.json',
  },
  'release-ledger': { '1.3.0': 'schemas/v1.3.0/release-ledger.schema.json' },
  'release-compatibility-claim': {
    '1.3.0': 'schemas/v1.3.0/release-compatibility-claim.schema.json',
  },
  'release-ledger-receipt': { '1.3.0': 'schemas/v1.3.0/release-ledger-receipt.schema.json' },
  'artifact-envelope': { '1.1.0': 'schemas/v1.1.0/artifact-envelope.schema.json' },
  'artifact-review': { '1.1.0': 'schemas/v1.1.0/artifact-review.schema.json' },
  'artifact-paste': { '1.1.0': 'schemas/v1.1.0/artifact-paste.schema.json' },
  'artifact-room-event': { '1.1.0': 'schemas/v1.1.0/artifact-room-event.schema.json' },
  'artifact-room-descriptor': { '1.1.0': 'schemas/v1.1.0/artifact-room-descriptor.schema.json' },
  'artifact-room-signed-event': {
    '1.1.0': 'schemas/v1.1.0/artifact-room-signed-event.schema.json',
  },
  'ecosystem-saga': { '1.2.0': 'schemas/v1.2.0/ecosystem-saga.schema.json' },
  'ecosystem-release-operation': {
    '1.2.0': 'schemas/v1.2.0/ecosystem-release-operation.schema.json',
  },
  'guided-question': { '1.2.0': 'schemas/v1.2.0/guided-question.schema.json' },
  'guided-questionnaire': { '1.2.0': 'schemas/v1.2.0/guided-questionnaire.schema.json' },
  'guided-answer-envelope': { '1.2.0': 'schemas/v1.2.0/guided-answer-envelope.schema.json' },
  'guided-session': { '1.2.0': 'schemas/v1.2.0/guided-session.schema.json' },
  'guided-confirmation': { '1.2.0': 'schemas/v1.2.0/guided-confirmation.schema.json' },
  'structured-action': { '1.2.0': 'schemas/v1.2.0/structured-action.schema.json' },
  'evidence-diagnostic': { '1.2.0': 'schemas/v1.2.0/evidence-diagnostic.schema.json' },
  'dashboard-bootstrap': { '1.2.0': 'schemas/v1.2.0/dashboard-bootstrap.schema.json' },
  'landing-plan': { '1.2.0': 'schemas/v1.2.0/landing-plan.schema.json' },
  'landing-confirmation': { '1.2.0': 'schemas/v1.2.0/landing-confirmation.schema.json' },
  'landing-event': { '1.2.0': 'schemas/v1.2.0/landing-event.schema.json' },
  'landing-phase-receipt': { '1.2.0': 'schemas/v1.2.0/landing-phase-receipt.schema.json' },
  'landing-receipt': { '1.2.0': 'schemas/v1.2.0/landing-receipt.schema.json' },
  'landing-operation-registry': {
    '1.2.0': 'schemas/v1.2.0/landing-operation-registry.schema.json',
  },
  'landing-workflow-catalog': { '1.2.0': 'schemas/v1.2.0/landing-workflow-catalog.schema.json' },
  'evaluation-scenario': { '1.4.0': 'schemas/v1.4.0/evaluation-scenario.schema.json' },
  'evaluation-corpus': { '1.4.0': 'schemas/v1.4.0/evaluation-corpus.schema.json' },
  'evaluation-fixture': { '1.4.0': 'schemas/v1.4.0/evaluation-fixture.schema.json' },
  'evaluation-host-profile': { '1.4.0': 'schemas/v1.4.0/evaluation-host-profile.schema.json' },
  'evaluation-host-profile-registry': {
    '1.4.0': 'schemas/v1.4.0/evaluation-host-profile-registry.schema.json',
  },
  'evaluation-grader-registration': {
    '1.4.0': 'schemas/v1.4.0/evaluation-grader-registration.schema.json',
  },
  'evaluation-grader-registry': {
    '1.4.0': 'schemas/v1.4.0/evaluation-grader-registry.schema.json',
  },
  'evaluation-budget': { '1.4.0': 'schemas/v1.4.0/evaluation-budget.schema.json' },
  'evaluation-gate-policy': { '1.4.0': 'schemas/v1.4.0/evaluation-gate-policy.schema.json' },
  'evaluation-observation': { '1.4.0': 'schemas/v1.4.0/evaluation-observation.schema.json' },
  'evaluation-run-result': { '1.4.0': 'schemas/v1.4.0/evaluation-run-result.schema.json' },
  'evaluation-aggregate-report': {
    '1.4.0': 'schemas/v1.4.0/evaluation-aggregate-report.schema.json',
  },
  'evaluation-waiver': { '1.4.0': 'schemas/v1.4.0/evaluation-waiver.schema.json' },
  'skill-certification-receipt': {
    '1.4.0': 'schemas/v1.4.0/skill-certification-receipt.schema.json',
  },
  'role-registry': {
    '1.1.0': 'schemas/v1.1.0/role-registry.schema.json',
    '1.5.0': 'schemas/v1.5.0/role-registry.schema.json',
  },
  'task-kind-registry': { '1.5.0': 'schemas/v1.5.0/task-kind-registry.schema.json' },
  'task-manifest': { '1.5.0': 'schemas/v1.5.0/task-manifest.schema.json' },
  'task-output-manifest': { '1.5.0': 'schemas/v1.5.0/task-output-manifest.schema.json' },
  'implementation-result': { '1.5.0': 'schemas/v1.5.0/implementation-result.schema.json' },
  'rule-catalog': { '1.5.0': 'schemas/v1.5.0/rule-catalog.schema.json' },
  'command-catalog': { '1.5.0': 'schemas/v1.5.0/command-catalog.schema.json' },
  'skill-catalog': {
    '1.5.0': 'schemas/v1.5.0/skill-catalog.schema.json',
    '1.6.0': v16Schema('skill-catalog'),
    '1.7.0': v17Schema('skill-catalog'),
  },
  'output-catalog': { '1.5.0': 'schemas/v1.5.0/output-catalog.schema.json' },
  'output-path-catalog': { '1.5.0': 'schemas/v1.5.0/output-path-catalog.schema.json' },
  'generated-asset-manifest': {
    '1.5.0': 'schemas/v1.5.0/generated-asset-manifest.schema.json',
    '1.6.0': v16Schema('generated-asset-manifest'),
    '1.7.0': v17Schema('generated-asset-manifest'),
  },
  'migration-preservation-manifest': {
    '1.5.0': 'schemas/v1.5.0/migration-preservation-manifest.schema.json',
  },
  'skill-source': { '1.6.0': v16Schema('skill-source'), '1.7.0': v17Schema('skill-source') },
  'skill-module-registry': {
    '1.6.0': v16Schema('skill-module-registry'),
    '1.7.0': v17Schema('skill-module-registry'),
  },
  'skill-host-profile-registry': {
    '1.6.0': v16Schema('skill-host-profile-registry'),
    '1.7.0': v17Schema('skill-host-profile-registry'),
  },
  'skill-routing-registry': {
    '1.6.0': v16Schema('skill-routing-registry'),
    '1.7.0': v17Schema('skill-routing-registry'),
  },
  'skill-completion-receipt': {
    '1.6.0': v16Schema('skill-completion-receipt'),
    '1.7.0': v17Schema('skill-completion-receipt'),
  },
  'skill-consent-record': {
    '1.6.0': v16Schema('skill-consent-record'),
    '1.7.0': v17Schema('skill-consent-record'),
  },
  'skill-learning-record': {
    '1.6.0': v16Schema('skill-learning-record'),
    '1.7.0': v17Schema('skill-learning-record'),
  },
  'skill-session': { '1.6.0': v16Schema('skill-session'), '1.7.0': v17Schema('skill-session') },
  'planning-id-sequence': { '1.7.0': v17Schema('planning-id-sequence') },
  'request-authority': { '1.7.0': v17Schema('request-authority') },
  'skill-package': { '1.8.0': v18Schema('skill-package') },
  'utility-command-catalog': { '1.8.0': v18Schema('utility-command-catalog') },
  'diagram-document': { '1.6.0': v16Schema('diagram-document') },
  'diagram-fidelity-report': { '1.6.0': v16Schema('diagram-fidelity-report') },
  'diagram-manifest': { '1.6.0': v16Schema('diagram-manifest') },
  'diagram-consumer-reference': { '1.6.0': v16Schema('diagram-consumer-reference') },
  'diagram-review-binding': { '1.6.0': v16Schema('diagram-review-binding') },
  'diagram-quality-report': { '1.6.0': v16Schema('diagram-quality-report') },
  'diagram-semantic-pattern-registry': { '1.6.0': v16Schema('diagram-semantic-pattern-registry') },
  'diagram-type-registry': { '1.6.0': v16Schema('diagram-type-registry') },
};

// Authoring successors are additive; preserve every legacy diagram registration.
for (const [kind, filename] of Object.entries(DIAGRAM_AUTHORING_CONTRACT_FILES)) {
  foundationPaths[kind] = { ...foundationPaths[kind], '1.13.0': `schemas/v1.13.0/${filename}` };
}

function compiledOperatePaths() {
  const catalog = OPERATE_CONTRACT_CATALOG_V2;
  if (
    catalog?.kind !== 'operate-contract-catalog' ||
    catalog.protocol?.id !== 'operate' ||
    catalog.protocol?.version !== '2.0.0' ||
    catalog.protocol?.versionPolicy !== 'exact' ||
    !Array.isArray(catalog.contracts)
  ) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_UNSUPPORTED',
      'The packaged Operate contract catalog is not an explicit Protocol 2.0.0 catalog.',
    );
  }
  const entries = catalog.contracts.map(({ id, schemaPath }) => [id, { '2.0.0': schemaPath }]);
  if (new Set(entries.map(([id]) => id)).size !== entries.length) {
    throw new PipelineError(
      'E_SCHEMA_UNKNOWN',
      'The packaged Operate contract catalog contains duplicate contract IDs.',
    );
  }
  return Object.fromEntries(entries);
}

function compiledOperateExperienceVocabulary() {
  const experience = OPERATE_CONTRACT_CATALOG_V2?.experience;
  const expectedKinds = [
    'operate-experience-live-patch',
    'operate-experience-preview',
    'operate-experience-view',
    'operate-review-bound-submission',
    'operate-review-display-workspace',
    'operating-delivery-evidence',
    'operating-delivery-route',
    'operating-origin',
    'operating-planning-proposal',
  ];
  const expectedRoutes = ['contained-execution', 'human-external', 'observe-only', 'planning-work'];
  const kinds = Array.isArray(experience?.contracts)
    ? experience.contracts.map(({ id }) => id).sort()
    : [];
  const routes = Array.isArray(experience?.deliveryRoutes)
    ? [...experience.deliveryRoutes].sort()
    : [];
  if (
    JSON.stringify(kinds) !== JSON.stringify(expectedKinds) ||
    JSON.stringify(routes) !== JSON.stringify(expectedRoutes) ||
    experience.contracts.some(
      ({ version, schemaPath }) =>
        version !== '1.0.0' ||
        typeof schemaPath !== 'string' ||
        !schemaPath.startsWith('schemas/v2.0.0/'),
    )
  ) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_UNSUPPORTED',
      'The packaged Operate catalog does not declare the exact public experience contract family.',
    );
  }
  return Object.freeze({
    kinds: Object.freeze(kinds),
    routes: Object.freeze(routes),
    paths: Object.freeze(
      Object.fromEntries(experience.contracts.map(({ id, schemaPath }) => [id, schemaPath])),
    ),
  });
}

function compiledOperateRoleMandates() {
  const catalog = OPERATE_CONTRACT_CATALOG_V2;
  if (!Array.isArray(catalog?.roles)) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_UNSUPPORTED',
      'The packaged Operate contract catalog does not declare role mandates.',
    );
  }
  const mandates = catalog.roles.map((role) => ({
    id: role?.id,
    version: role?.version,
    output: role?.output,
    limits: role?.limits,
  }));
  if (
    mandates.some(
      ({ id, version, output, limits }) =>
        typeof id !== 'string' ||
        version !== '2.0.0' ||
        typeof output?.schemaId !== 'string' ||
        output.schemaVersion !== '2.0.0' ||
        !Number.isSafeInteger(output.maxBytes) ||
        output.maxBytes < 1 ||
        !Number.isSafeInteger(limits?.maxProposals) ||
        !Number.isSafeInteger(limits?.maxActions),
    ) ||
    new Set(mandates.map(({ id, version }) => `${id}@${version}`)).size !== mandates.length
  ) {
    throw new PipelineError(
      'E_SCHEMA_UNKNOWN',
      'The packaged Operate contract catalog has invalid role mandates.',
    );
  }
  return mandates.map(({ id, version, output, limits }) =>
    Object.freeze({
      id,
      version,
      output: Object.freeze({ ...output }),
      limits: Object.freeze({ ...limits }),
    }),
  );
}

function compiledOperateEvidenceVocabulary() {
  const evidence = OPERATE_CONTRACT_CATALOG_V2?.evidence;
  const fields = ['contractIds', 'kinds', 'edgeRelations', 'resolverErrorCodes'];
  if (
    !evidence ||
    fields.some((field) => !Array.isArray(evidence[field])) ||
    evidence.contractIds.length !== 7 ||
    evidence.kinds.length !== 4 ||
    evidence.edgeRelations.length !== 2 ||
    evidence.contractIds.some(
      (id) => !OPERATE_CONTRACT_CATALOG_V2.contracts.some((contract) => contract.id === id),
    ) ||
    new Set(evidence.contractIds).size !== evidence.contractIds.length ||
    new Set(evidence.kinds).size !== evidence.kinds.length ||
    new Set(evidence.edgeRelations).size !== evidence.edgeRelations.length ||
    new Set(evidence.resolverErrorCodes).size !== evidence.resolverErrorCodes.length
  ) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_UNSUPPORTED',
      'The packaged Operate catalog does not declare the exact Phase 4 evidence vocabulary.',
    );
  }
  return Object.freeze({
    contractIds: Object.freeze([...evidence.contractIds]),
    kinds: Object.freeze([...evidence.kinds]),
    edgeRelations: Object.freeze([...evidence.edgeRelations]),
    resolverErrorCodes: Object.freeze([...evidence.resolverErrorCodes]),
  });
}

function compiledOperateOperatingIntelligenceVocabulary() {
  const vocabulary = OPERATE_CONTRACT_CATALOG_V2?.operatingIntelligence;
  const fields = ['contractIds', 'projectionIdentities', 'providerRegistrationContractIds'];
  if (
    !vocabulary ||
    fields.some((field) => !Array.isArray(vocabulary[field])) ||
    vocabulary.contractIds.length !== 25 ||
    vocabulary.projectionIdentities.length !== 2 ||
    vocabulary.providerRegistrationContractIds.length !== 3 ||
    vocabulary.contractIds.some(
      (id) => !OPERATE_CONTRACT_CATALOG_V2.contracts.some((contract) => contract.id === id),
    ) ||
    new Set(vocabulary.contractIds).size !== vocabulary.contractIds.length ||
    new Set(vocabulary.projectionIdentities).size !== vocabulary.projectionIdentities.length ||
    new Set(vocabulary.providerRegistrationContractIds).size !==
      vocabulary.providerRegistrationContractIds.length
  ) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_UNSUPPORTED',
      'The packaged Operate catalog does not declare the exact Phase 5 operating-intelligence vocabulary.',
    );
  }
  return Object.freeze({
    contractIds: Object.freeze([...vocabulary.contractIds]),
    projectionIdentities: Object.freeze([...vocabulary.projectionIdentities]),
    providerRegistrationContractIds: Object.freeze([...vocabulary.providerRegistrationContractIds]),
  });
}

function compiledOperateGovernedExecutionVocabulary() {
  const vocabulary = OPERATE_CONTRACT_CATALOG_V2?.governedExecution;
  const fields = [
    'contractIds',
    'providerRegistrationContractIds',
    'effectClasses',
    'policyOutcomes',
    'policyTiers',
    'coreProhibitions',
    'operationStates',
    'toolOperations',
  ];
  if (
    !vocabulary ||
    fields.some((field) => !Array.isArray(vocabulary[field])) ||
    vocabulary.contractIds.length !== 13 ||
    vocabulary.providerRegistrationContractIds.length !== 3 ||
    vocabulary.effectClasses.length !== 6 ||
    vocabulary.policyOutcomes.length !== 7 ||
    vocabulary.policyTiers.length !== 3 ||
    vocabulary.coreProhibitions.length !== 9 ||
    vocabulary.operationStates.length !== 10 ||
    vocabulary.toolOperations.length !== 3 ||
    vocabulary.contractIds.some(
      (id) => !OPERATE_CONTRACT_CATALOG_V2.contracts.some((contract) => contract.id === id),
    ) ||
    [
      'contractIds',
      'providerRegistrationContractIds',
      'effectClasses',
      'policyOutcomes',
      'coreProhibitions',
      'operationStates',
    ].some((field) => new Set(vocabulary[field]).size !== vocabulary[field].length) ||
    new Set(vocabulary.policyTiers.map(({ id }) => id)).size !== vocabulary.policyTiers.length ||
    vocabulary.toolOperations.some(
      ({ id }) => !OPERATE_CONTRACT_CATALOG_V2.operations.some((operation) => operation.id === id),
    ) ||
    new Set(vocabulary.toolOperations.map(({ id }) => id)).size !== vocabulary.toolOperations.length
  ) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_UNSUPPORTED',
      'The packaged Operate catalog does not declare the exact Phase 6 governed-execution vocabulary.',
    );
  }
  return Object.freeze(
    Object.fromEntries(
      fields.map((field) => [
        field,
        Object.freeze(
          vocabulary[field].map((entry) =>
            typeof entry === 'object' ? Object.freeze({ ...entry }) : entry,
          ),
        ),
      ]),
    ),
  );
}

function compiledPublicOperateDomainContractBindings() {
  const domains = OPERATE_CONTRACT_CATALOG_V2?.extensions?.domains;
  const expected = {
    business: { apiDomainId: 'business', id: 'business-domain', version: '1.0.0' },
    software: { apiDomainId: 'software', id: 'software-domain', version: '1.0.0' },
  };
  if (!Array.isArray(domains)) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_UNSUPPORTED',
      'The packaged Operate catalog does not declare public domain registrations.',
    );
  }
  const bindings = {};
  for (const [domainId, binding] of Object.entries(expected)) {
    const domain = domains.find(
      (entry) => entry?.domainId === domainId && entry?.domainVersion === binding.version,
    );
    if (domain === undefined || JSON.stringify(domain.domainContract) !== JSON.stringify(binding)) {
      throw new PipelineError(
        'E_SCHEMA_VERSION_UNSUPPORTED',
        'The packaged Operate catalog has an invalid explicit API-domain contract binding.',
      );
    }
    bindings[domainId] = Object.freeze({ ...binding });
  }
  return Object.freeze(bindings);
}

const paths = {
  ...foundationPaths,
  ...compiledOperatePaths(),
};

const OPERATE_EXPERIENCE_VOCABULARY_V1 = compiledOperateExperienceVocabulary();
const experiencePaths = Object.freeze(
  Object.fromEntries(
    Object.entries(OPERATE_EXPERIENCE_VOCABULARY_V1.paths).map(([kind, path]) => [
      kind,
      Object.freeze({ '2.0.0': path }),
    ]),
  ),
);

// Every Operate v2 identity is compiler-owned. Keeping this set derived avoids
// a second hand-maintained version boundary when the canonical registry grows.
const explicitProtocolVersionKinds = new Set([
  ...OPERATE_CONTRACT_CATALOG_V2.contracts.map(({ id }) => id),
  'role-registry',
  'task-kind-registry',
  'task-manifest',
  'task-output-manifest',
  'rule-catalog',
  'command-catalog',
  'skill-catalog',
  'output-catalog',
  'output-path-catalog',
  'generated-asset-manifest',
  'migration-preservation-manifest',
  'skill-source',
  'skill-module-registry',
  'skill-host-profile-registry',
  'skill-routing-registry',
  'skill-completion-receipt',
  'skill-consent-record',
  'skill-learning-record',
  'skill-session',
]);

/** @type {typeof import('./contracts.d.mts').PROTOCOL_SCHEMA_REGISTRY} */
export const PROTOCOL_SCHEMA_REGISTRY = Object.freeze(
  Object.fromEntries(
    Object.entries(paths).map(([kind, versions]) => [kind, Object.freeze({ ...versions })]),
  ),
);

/**
 * Closed public product-experience and Operate-to-Planning contract identities.
 * @type {typeof import('./contracts.d.mts').OPERATE_EXPERIENCE_CONTRACT_KINDS_V2}
 */
export const OPERATE_EXPERIENCE_CONTRACT_KINDS_V2 = OPERATE_EXPERIENCE_VOCABULARY_V1.kinds;
/**
 * The only delivery classifications accepted by the Operate-to-Planning bridge.
 * @type {typeof import('./contracts.d.mts').OPERATING_DELIVERY_ROUTES_V1}
 */
export const OPERATING_DELIVERY_ROUTES_V1 = OPERATE_EXPERIENCE_VOCABULARY_V1.routes;

/**
 * Compiler-owned, explicit Protocol 2.0 role mandates.
 * @type {typeof import('./contracts.d.mts').OPERATE_ROLE_MANDATES_V2}
 */
export const OPERATE_ROLE_MANDATES_V2 = Object.freeze(compiledOperateRoleMandates());

/**
 * Compiler-owned public extension record identities.
 * @type {typeof import('./contracts.d.mts').OPERATE_EXTENSION_CONTRACT_KINDS_V2}
 */
export const OPERATE_EXTENSION_CONTRACT_KINDS_V2 = Object.freeze(
  OPERATE_CONTRACT_CATALOG_V2.contracts
    .filter(({ category }) => category === 'extension')
    .map(({ id }) => id)
    .sort(),
);

const OPERATE_EVIDENCE_VOCABULARY_V2 = compiledOperateEvidenceVocabulary();
/**
 * Compiler-owned Phase 4 evidence record identities.
 * @type {typeof import('./contracts.d.mts').OPERATE_EVIDENCE_CONTRACT_KINDS_V2}
 */
export const OPERATE_EVIDENCE_CONTRACT_KINDS_V2 = OPERATE_EVIDENCE_VOCABULARY_V2.contractIds;
/**
 * The four shipped local evidence source kinds.
 * @type {typeof import('./contracts.d.mts').OPERATE_EVIDENCE_KINDS_V2}
 */
export const OPERATE_EVIDENCE_KINDS_V2 = OPERATE_EVIDENCE_VOCABULARY_V2.kinds;
/**
 * The only Phase 4 source-Artifact-local evidence edge relations.
 * @type {typeof import('./contracts.d.mts').OPERATE_EVIDENCE_EDGE_RELATIONS_V2}
 */
export const OPERATE_EVIDENCE_EDGE_RELATIONS_V2 = OPERATE_EVIDENCE_VOCABULARY_V2.edgeRelations;
/**
 * Stable, safe resolver failure reasons.
 * @type {typeof import('./contracts.d.mts').OPERATE_EVIDENCE_RESOLVER_ERROR_CODES_V2}
 */
export const OPERATE_EVIDENCE_RESOLVER_ERROR_CODES_V2 =
  OPERATE_EVIDENCE_VOCABULARY_V2.resolverErrorCodes;

const OPERATE_OPERATING_INTELLIGENCE_VOCABULARY_V2 =
  compiledOperateOperatingIntelligenceVocabulary();
/**
 * Compiler-owned Phase 5 operating-intelligence record identities.
 * @type {typeof import('./contracts.d.mts').OPERATE_OPERATING_INTELLIGENCE_CONTRACT_KINDS_V2}
 */
export const OPERATE_OPERATING_INTELLIGENCE_CONTRACT_KINDS_V2 =
  OPERATE_OPERATING_INTELLIGENCE_VOCABULARY_V2.contractIds;
/**
 * Exact public domain-projection identities; no implicit string derivation is allowed.
 * @type {typeof import('./contracts.d.mts').OPERATE_OPERATING_PROJECTION_IDENTITIES_V2}
 */
export const OPERATE_OPERATING_PROJECTION_IDENTITIES_V2 =
  OPERATE_OPERATING_INTELLIGENCE_VOCABULARY_V2.projectionIdentities;
/**
 * Public Phase 5 provider declaration identities. Registration grants no authority.
 * @type {typeof import('./contracts.d.mts').OPERATE_OPERATING_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2}
 */
export const OPERATE_OPERATING_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2 =
  OPERATE_OPERATING_INTELLIGENCE_VOCABULARY_V2.providerRegistrationContractIds;
const OPERATE_GOVERNED_EXECUTION_VOCABULARY_V2 = compiledOperateGovernedExecutionVocabulary();
/**
 * Compiler-owned Phase 6 authority and execution contract identities.
 * @type {typeof import('./contracts.d.mts').OPERATE_GOVERNED_EXECUTION_CONTRACT_KINDS_V2}
 */
export const OPERATE_GOVERNED_EXECUTION_CONTRACT_KINDS_V2 =
  OPERATE_GOVERNED_EXECUTION_VOCABULARY_V2.contractIds;
/**
 * Data-only capability, policy, and executor registration identities.
 * @type {typeof import('./contracts.d.mts').OPERATE_GOVERNED_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2}
 */
export const OPERATE_GOVERNED_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2 =
  OPERATE_GOVERNED_EXECUTION_VOCABULARY_V2.providerRegistrationContractIds;
/**
 * Exact classification vocabulary; classification alone never grants authority.
 * @type {typeof import('./contracts.d.mts').OPERATE_GOVERNED_EFFECT_CLASSES_V2}
 */
export const OPERATE_GOVERNED_EFFECT_CLASSES_V2 =
  OPERATE_GOVERNED_EXECUTION_VOCABULARY_V2.effectClasses;
/**
 * Exact closed policy disposition vocabulary.
 * @type {typeof import('./contracts.d.mts').OPERATE_GOVERNED_POLICY_OUTCOMES_V2}
 */
export const OPERATE_GOVERNED_POLICY_OUTCOMES_V2 =
  OPERATE_GOVERNED_EXECUTION_VOCABULARY_V2.policyOutcomes;
/**
 * Immutable core > project > narrowing domain policy precedence.
 * @type {typeof import('./contracts.d.mts').OPERATE_GOVERNED_POLICY_TIERS_V2}
 */
export const OPERATE_GOVERNED_POLICY_TIERS_V2 =
  OPERATE_GOVERNED_EXECUTION_VOCABULARY_V2.policyTiers;
/**
 * Non-overridable reference policy prohibitions.
 * @type {typeof import('./contracts.d.mts').OPERATE_GOVERNED_CORE_PROHIBITIONS_V2}
 */
export const OPERATE_GOVERNED_CORE_PROHIBITIONS_V2 =
  OPERATE_GOVERNED_EXECUTION_VOCABULARY_V2.coreProhibitions;
/**
 * Closed crash-recovery outcomes; none of these outcomes independently grants authority.
 * @type {typeof import('./contracts.d.mts').OPERATE_GOVERNED_RECOVERY_CLASSIFICATIONS_V2}
 */
export const OPERATE_GOVERNED_RECOVERY_CLASSIFICATIONS_V2 = Object.freeze([
  'applied',
  'not-applied',
  'partial',
  'unknown',
]);

const OPERATE_CORE_PROHIBITION_TOKEN_EXPANSIONS_V2 = Object.freeze(
  Object.assign(Object.create(null), {
    credentials: ['credential'],
    customers: ['customer'],
    funds: ['fund'],
    funding: ['fund'],
    money: ['fund'],
    monies: ['fund'],
    payments: ['payment'],
    pay: ['payment'],
    pays: ['payment'],
    paying: ['payment'],
    paid: ['payment'],
    payout: ['payment', 'transfer'],
    payouts: ['payment', 'transfer'],
    transfers: ['transfer'],
    transferred: ['transfer'],
    transferring: ['transfer'],
    remits: ['transfer'],
    remit: ['transfer'],
    remitted: ['transfer'],
    remitting: ['transfer'],
    contacted: ['contact'],
    contacting: ['contact'],
    contacts: ['contact'],
    message: ['contact'],
    messages: ['contact'],
    messaged: ['contact'],
    messaging: ['contact'],
    email: ['contact'],
    emails: ['contact'],
    emailed: ['contact'],
    emailing: ['contact'],
    reachout: ['contact'],
    reachouts: ['contact'],
    deployed: ['deploy'],
    deploying: ['deploy'],
    deploys: ['deploy'],
    ship: ['deploy'],
    ships: ['deploy'],
    shipped: ['deploy'],
    shipping: ['deploy'],
    deliver: ['deploy'],
    delivers: ['deploy'],
    delivered: ['deploy'],
    delivering: ['deploy'],
    delivery: ['deploy'],
    deliveries: ['deploy'],
    merged: ['merge'],
    merging: ['merge'],
    merges: ['merge'],
    published: ['publish'],
    publishing: ['publish'],
    publishes: ['publish'],
    publication: ['publish'],
    publications: ['publish'],
    released: ['publish'],
    release: ['publish'],
    releasing: ['publish'],
    releases: ['publish'],
    rotated: ['rotate'],
    rotating: ['rotate'],
    mutated: ['mutate'],
    mutating: ['mutate'],
    changed: ['change'],
    changing: ['change'],
    sent: ['send'],
    sending: ['send'],
    destroyed: ['destroy'],
    destroying: ['destroy'],
    deletes: ['delete'],
    deleting: ['delete'],
    deleted: ['delete'],
    erased: ['delete'],
    erase: ['delete'],
    erasing: ['delete'],
    removed: ['delete'],
    remove: ['delete'],
    removing: ['delete'],
    wiped: ['delete'],
    wipe: ['delete'],
    wiping: ['delete'],
    secrets: ['secret'],
    prod: ['production'],
  }),
);

function operateCoreProhibitionTokens(value) {
  if (typeof value !== 'string') return [];
  const normalized = value
    .normalize('NFKC')
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized
    .split('-')
    .filter((token) => token.length > 0 && !/^\d+$/u.test(token))
    .flatMap((token) => OPERATE_CORE_PROHIBITION_TOKEN_EXPANSIONS_V2[token] ?? [token]);
}

/**
 * Resolve one non-overridable governed-execution prohibition from semantic
 * identifier fragments. Matching is normalized, order-independent, and
 * intentionally shared by registration and contained-input validation.
 * @type {typeof import('./contracts.d.mts').findOperateCoreProhibitionV2}
 */
export function findOperateCoreProhibitionV2(values) {
  const input = Array.isArray(values) ? values : [values];
  const words = new Set(input.flatMap(operateCoreProhibitionTokens));
  /** @type {Array<[string, boolean]>} */
  const candidates = [
    ['credential-change', words.has('credential')],
    [
      'customer-contact',
      words.has('customer') && (words.has('contact') || (words.has('reach') && words.has('out'))),
    ],
    ['destructive', ['destructive', 'destroy', 'delete'].some((word) => words.has(word))],
    ['funds-transfer', words.has('fund') && (words.has('transfer') || words.has('send'))],
    ['payment-transfer', words.has('payment') && (words.has('transfer') || words.has('send'))],
    ['production-deploy', words.has('production') && words.has('deploy')],
    ['production-merge', words.has('production') && words.has('merge')],
    ['publication', words.has('publish')],
    ['secret-mutation', words.has('secret')],
  ];
  const matched = candidates.find(([, present]) => present);
  return matched && OPERATE_GOVERNED_CORE_PROHIBITIONS_V2.includes(matched[0]) ? matched[0] : null;
}
/**
 * Exact durable governed-operation lifecycle vocabulary.
 * @type {typeof import('./contracts.d.mts').OPERATE_GOVERNED_OPERATION_STATES_V2}
 */
export const OPERATE_GOVERNED_OPERATION_STATES_V2 =
  OPERATE_GOVERNED_EXECUTION_VOCABULARY_V2.operationStates;
/**
 * Terminal result-bearing states eligible for pure at-most-once replay.
 * @type {typeof import('./contracts.d.mts').OPERATE_GOVERNED_OPERATION_TERMINAL_STATES_V2}
 */
export const OPERATE_GOVERNED_OPERATION_TERMINAL_STATES_V2 = Object.freeze(
  OPERATE_GOVERNED_OPERATION_STATES_V2.filter((state) =>
    ['succeeded', 'failed', 'partial', 'uncertain', 'blocked'].includes(state),
  ).sort(),
);
/**
 * Result truth retained independently from the later Action hypothesis verdict.
 * @type {typeof import('./contracts.d.mts').OPERATE_EXECUTION_VERIFICATION_STATUSES_V2}
 */
export const OPERATE_EXECUTION_VERIFICATION_STATUSES_V2 = Object.freeze([
  'success',
  'failure',
  'blocked',
  'uncertain',
  'partial',
  'cancelled',
  'rolled-back',
]);
/**
 * Bounded verification truth; `success` is intentionally absent.
 * @type {typeof import('./contracts.d.mts').OPERATE_HYPOTHESIS_VERIFICATION_STATUSES_V2}
 */
export const OPERATE_HYPOTHESIS_VERIFICATION_STATUSES_V2 = Object.freeze([
  'pending',
  'confirmed',
  'failed',
  'blocked',
  'cancelled',
  'revisit',
]);
/**
 * Exact public tools owned by the canonical Phase 6 authority guard.
 * @type {typeof import('./contracts.d.mts').OPERATE_GOVERNED_TOOL_OPERATIONS_V2}
 */
export const OPERATE_GOVERNED_TOOL_OPERATIONS_V2 =
  OPERATE_GOVERNED_EXECUTION_VOCABULARY_V2.toolOperations;
/**
 * Compiler-owned guard identities used by governed Review and Action authority.
 * @type {typeof import('./contracts.d.mts').OPERATE_AUTHORITY_GUARD_IDS_V2}
 */
export const OPERATE_AUTHORITY_GUARD_IDS_V2 = Object.freeze(
  OPERATE_CONTRACT_CATALOG_V2.guards
    .filter(({ id }) =>
      [
        'review-submit-authorized',
        'action-approval-authorized',
        'action-execution-authorized',
        'action-rollback-authorized',
      ].includes(id),
    )
    .map(({ id }) => id)
    .sort(),
);
/**
 * Exact compiler-owned public API-domain bindings; no string conversion is permitted.
 * @type {typeof import('./contracts.d.mts').OPERATE_PUBLIC_DOMAIN_CONTRACT_BINDINGS_V2}
 */
export const OPERATE_PUBLIC_DOMAIN_CONTRACT_BINDINGS_V2 =
  compiledPublicOperateDomainContractBindings();

const OPERATE_INTELLIGENCE_KERNEL_KINDS_V2 = Object.freeze(['advisor', 'challenger', 'chair']);

function sortedRoleIds(roles) {
  return [...roles].map(({ roleId }) => roleId).sort();
}

function assertCanonicalOperateIntelligencePlanTopologyV2(plan) {
  const selected = plan.selectedRoles;
  const omitted = plan.omittedRoles;
  const advisors = selected.filter(({ roleKind }) => roleKind === 'advisor');
  const challengers = selected.filter(({ roleKind }) => roleKind === 'challenger');
  const chairs = selected.filter(({ roleKind }) => roleKind === 'chair');
  const omittedChallengers = omitted.filter(({ roleKind }) => roleKind === 'challenger');
  const omittedAdvisors = omitted.filter(({ roleKind }) => roleKind === 'advisor');
  const advisorIds = sortedRoleIds(advisors);
  const expectedSelectedIds = [
    ...advisorIds,
    ...(plan.challengerRequired ? sortedRoleIds(challengers) : []),
    ...sortedRoleIds(chairs),
  ];
  const expectedOmittedIds = [
    ...sortedRoleIds(omittedAdvisors),
    ...(plan.challengerRequired ? [] : sortedRoleIds(omittedChallengers)),
  ];
  const dependencyExpectation = (role) => {
    if (role.roleKind === 'advisor') return [];
    if (role.roleKind === 'challenger') return [...advisorIds];
    if (role.roleKind === 'chair') {
      return plan.challengerRequired ? [...advisorIds, challengers[0].roleId] : [...advisorIds];
    }
    return null;
  };
  const outputSchemaByRoleKind = {
    advisor: 'operating-advisor-result',
    challenger: 'operating-challenger-review',
    chair: 'operating-decision-ledger',
  };
  const topologyInvalid =
    advisors.length < 1 ||
    chairs.length !== 1 ||
    challengers.length !== (plan.challengerRequired ? 1 : 0) ||
    omittedChallengers.length !== (plan.challengerRequired ? 0 : 1) ||
    JSON.stringify(selected.map(({ roleId }) => roleId)) !== JSON.stringify(expectedSelectedIds) ||
    JSON.stringify(omitted.map(({ roleId }) => roleId)) !== JSON.stringify(expectedOmittedIds) ||
    selected.some((role) => {
      const expectedDeps = dependencyExpectation(role);
      return (
        role.roleVersion !== '2.0.0' ||
        role.outputContract.schemaId !== outputSchemaByRoleKind[role.roleKind] ||
        role.outputContract.schemaVersion !== '2.0.0' ||
        !OPERATE_INTELLIGENCE_KERNEL_KINDS_V2.includes(role.roleKind) ||
        expectedDeps === null ||
        JSON.stringify([...role.dependsOnRoleIds].sort()) !==
          JSON.stringify([...expectedDeps].sort())
      );
    }) ||
    omitted.some(
      (role) =>
        role.roleVersion !== '2.0.0' ||
        !OPERATE_INTELLIGENCE_KERNEL_KINDS_V2.includes(role.roleKind) ||
        typeof role.reason !== 'string' ||
        !role.reason.startsWith('not-selected:'),
    );
  if (topologyInvalid) {
    throw new PipelineError(
      'E_PROTOCOL_ARTIFACT_INVALID',
      'The operating-intelligence plan does not use the canonical advisor fan-out, challenge, and Chair topology.',
      '',
      { retryable: false, context: { planId: plan.planId } },
    );
  }
}

/**
 * Validate the exact compiler-owned explainable-plan contract and canonical topology.
 * @returns {ReturnType<typeof import('./contracts.d.mts').assertOperateIntelligencePlanContractV2>}
 */
export function assertOperateIntelligencePlanContractV2(value) {
  const plan = assertProtocolArtifact('operating-intelligence-plan', value, {
    protocolVersion: '2.0.0',
  });
  assertCanonicalOperateIntelligencePlanTopologyV2(plan);
  return plan;
}

const schemaCache = new Map();
const canonicalSchemaPrefix = 'https://openplanr.dev/';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

// Validation reads the cached schema in place, so the cache must be immutable.
function loadSchema(path) {
  if (!schemaCache.has(path)) {
    schemaCache.set(path, deepFreeze(JSON.parse(readFileSync(join(packageRoot, path), 'utf8'))));
  }
  return schemaCache.get(path);
}

function assertCompiledOperateSchemaIdentities() {
  for (const { id, version, schemaPath } of OPERATE_CONTRACT_CATALOG_V2.contracts) {
    const schema = loadSchema(schemaPath);
    const expectedId = `https://openplanr.dev/${schemaPath}`;
    const declared = schema?.['x-openplanr-contract'];
    if (
      schema?.$schema !== 'https://json-schema.org/draft/2020-12/schema' ||
      schema?.$id !== expectedId ||
      declared?.id !== id ||
      declared?.version !== version
    ) {
      throw new PipelineError(
        'E_SCHEMA_VERSION_UNSUPPORTED',
        `The packaged Operate schema ${schemaPath} does not match compiler-owned identity ${id}@${version}.`,
      );
    }
  }
}

assertCompiledOperateSchemaIdentities();

function requireOperateRoleMandate(roleId, roleVersion) {
  if (typeof roleVersion !== 'string' || roleVersion.length === 0) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_REQUIRED',
      `Operate role mandate "${roleId}" requires an explicit version.`,
    );
  }
  const mandate = OPERATE_ROLE_MANDATES_V2.find(
    ({ id, version }) => id === roleId && version === roleVersion,
  );
  if (!mandate) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_UNSUPPORTED',
      `Operate role mandate "${roleId}" does not support version ${roleVersion}.`,
    );
  }
  return mandate;
}

/**
 * Resolve the exact mandate that an Operate Assignment can advertise. The
 * caller supplies a role version deliberately; no previous role version is
 * selected as a fallback.
 * @type {typeof import('./contracts.d.mts').loadOperateRoleMandateV2}
 */
export function loadOperateRoleMandateV2(roleId, { roleVersion } = {}) {
  const mandate = requireOperateRoleMandate(roleId, roleVersion);
  return structuredClone(mandate);
}

/**
 * Reject an advertised role output contract unless it is byte-for-byte equal
 * to the compiler-owned schema identity, media type, and maximum byte budget.
 * The runtime continues to validate the resulting Assignment at submission;
 * this boundary makes the advertised template and that validation input one
 * explicit, versioned contract.
 * @type {typeof import('./contracts.d.mts').assertOperateRoleOutputContractV2}
 */
export function assertOperateRoleOutputContractV2(roleId, outputContract, { roleVersion } = {}) {
  const mandate = requireOperateRoleMandate(roleId, roleVersion);
  const expected = /** @type {Record<string, unknown>} */ (mandate.output);
  const actual = outputContract ?? {};
  for (const field of ['schemaId', 'schemaVersion', 'mediaType', 'maxBytes']) {
    if (actual[field] !== expected[field]) {
      throw new PipelineError(
        'E_PROTOCOL_ARTIFACT_INVALID',
        `Operate role mandate "${roleId}" has an invalid advertised output ${field}.`,
        '',
        { roleId, roleVersion, field, expected: expected[field], actual: actual[field] },
      );
    }
  }
  const schema = sharedProtocolSchema(expected.schemaId, expected.schemaVersion);
  return {
    ...structuredClone(expected),
    path: schema.path,
  };
}

function referencedSchemaPath(basePath, reference) {
  const referenceWithoutFragment = reference.split('#', 1)[0];
  const requested = referenceWithoutFragment.startsWith(canonicalSchemaPrefix)
    ? referenceWithoutFragment.slice(canonicalSchemaPrefix.length)
    : join(dirname(basePath), referenceWithoutFragment);
  const absolute = resolve(packageRoot, requested);
  // `relative` yields platform separators, so normalize to POSIX before any
  // containment check. On Windows the raw value is `schemas\v1.2.0\...`, which
  // both fails the `schemas/` prefix test and hides `\..\` from the traversal
  // guard — the check has to be separator-independent to be either correct or
  // safe.
  const packageRelative = relative(packageRoot, absolute).split(sep).join('/');
  if (
    packageRelative.startsWith('..') ||
    packageRelative.includes('/../') ||
    !packageRelative.startsWith('schemas/')
  ) {
    throw new PipelineError(
      'E_SCHEMA_REFERENCE_UNSAFE',
      `Schema reference "${reference}" escapes the packaged schema directory.`,
    );
  }
  return packageRelative;
}

function resolveSchemaFragment(schema, reference) {
  const fragmentIndex = reference.indexOf('#');
  if (fragmentIndex < 0 || reference.slice(fragmentIndex) === '#') return schema;
  const fragment = reference.slice(fragmentIndex);
  if (!fragment.startsWith('#/')) return null;
  return fragment
    .slice(2)
    .split('/')
    .reduce((value, part) => value?.[part.replaceAll('~1', '/').replaceAll('~0', '~')], schema);
}

function compareProtocolVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function inferredVersion(kind, value, explicitVersion) {
  if (explicitVersion) return explicitVersion;
  if (typeof value?.protocolVersion === 'string') return value.protocolVersion;
  if (explicitProtocolVersionKinds.has(kind)) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_REQUIRED',
      `Protocol artifact "${kind}" requires an explicit protocolVersion.`,
    );
  }
  const versions = Object.keys(PROTOCOL_SCHEMA_REGISTRY[kind] ?? {});
  if (versions.length === 1) return versions[0];
  if (versions.length > 1) {
    // The value is version-agnostic (for example the compact advisor response,
    // which carries no protocol envelope). Additively resolve to the earliest
    // registered version so a v1.2 reader keeps validating v1.2 artifacts
    // unchanged; v1.3 callers pass protocolVersion explicitly.
    return [...versions].sort(compareProtocolVersions)[0];
  }
  throw new PipelineError(
    'E_SCHEMA_VERSION_REQUIRED',
    `Protocol artifact "${kind}" supports multiple versions; pass protocolVersion explicitly.`,
  );
}

/** @type {typeof import('./contracts.d.mts').listProtocolSchemas} */
export function listProtocolSchemas() {
  return Object.entries(PROTOCOL_SCHEMA_REGISTRY).flatMap(([kind, versions]) =>
    Object.entries(versions).map(([protocolVersion, path]) => ({ kind, protocolVersion, path })),
  );
}

function sharedProtocolSchema(kind, protocolVersion) {
  const versions = PROTOCOL_SCHEMA_REGISTRY[kind];
  if (!versions)
    throw new PipelineError('E_SCHEMA_UNKNOWN', `Unknown protocol artifact kind: ${kind}`);
  const path = versions[protocolVersion];
  if (!path) {
    throw new PipelineError(
      'E_SCHEMA_VERSION_UNSUPPORTED',
      `Protocol artifact "${kind}" does not support version ${protocolVersion}.`,
      `Supported versions: ${Object.keys(versions).join(', ')}.`,
    );
  }
  return { kind, protocolVersion, path, schema: loadSchema(path) };
}

function sharedOperateExperienceSchemaV2(kind, protocolVersion) {
  const versions = experiencePaths[kind];
  if (!versions)
    throw new PipelineError(
      'E_SCHEMA_UNKNOWN',
      `Unknown Operate experience artifact kind: ${kind}`,
    );
  if (protocolVersion !== '2.0.0') {
    throw new PipelineError(
      protocolVersion ? 'E_SCHEMA_VERSION_UNSUPPORTED' : 'E_SCHEMA_VERSION_REQUIRED',
      protocolVersion
        ? `Operate experience artifact "${kind}" does not support version ${protocolVersion}.`
        : `Operate experience artifact "${kind}" requires an explicit protocolVersion.`,
      'Supported versions: 2.0.0.',
    );
  }
  const path = versions[protocolVersion];
  return { kind, protocolVersion, path, schema: loadSchema(path) };
}

// Public resolvers hand out a mutable copy so callers can never reach the cache.
const withSchemaCopy = (resolved) => ({ ...resolved, schema: structuredClone(resolved.schema) });

/** @type {typeof import('./contracts.d.mts').resolveProtocolSchema} */
export function resolveProtocolSchema(kind, { protocolVersion } = {}) {
  return withSchemaCopy(sharedProtocolSchema(kind, protocolVersion));
}

/**
 * Resolve a public experience schema without adding it to the 61-contract runtime kernel.
 * @type {typeof import('./contracts.d.mts').resolveOperateExperienceSchemaV2}
 */
export function resolveOperateExperienceSchemaV2(kind, { protocolVersion } = {}) {
  return withSchemaCopy(sharedOperateExperienceSchemaV2(kind, protocolVersion));
}

function validateResolvedArtifact(value, resolved) {
  return validateJson(value, resolved.schema, {
    base: resolved.path,
    resolveRef(reference, { base } = {}) {
      const path = referencedSchemaPath(
        typeof base === 'string' && !base.startsWith('https://') ? base : resolved.path,
        reference,
      );
      const rootSchema = loadSchema(path);
      const schema = resolveSchemaFragment(rootSchema, reference);
      return { schema, rootSchema, base: path };
    },
  });
}

const GUIDED_ANSWER_COPY_FIELDS = Object.freeze(['questionId', 'questionVersion', 'sensitivity']);

function guidedQuestionnaireCompatibilityErrors(value) {
  const copyFields = value?.submission?.envelope?.dynamicFields?.answers?.copyFields;
  if (
    !Array.isArray(copyFields) ||
    JSON.stringify(copyFields) === JSON.stringify(GUIDED_ANSWER_COPY_FIELDS)
  )
    return [];
  return [
    {
      path: '$.submission.envelope.dynamicFields.answers.copyFields',
      rule: 'exactAnswerCopyFields',
      detail: 'answer copy fields must match the guided answer envelope schema',
    },
  ];
}

/** @type {typeof import('./contracts.d.mts').validateProtocolArtifact} */
export function validateProtocolArtifact(kind, value, { protocolVersion } = {}) {
  const authoringKind = Object.hasOwn(DIAGRAM_AUTHORING_CONTRACT_FILES, kind);
  let versionInput = value;
  if (authoringKind && (!protocolVersion || protocolVersion === '1.13.0')) {
    // Choose the additive validator without executing an envelope accessor.
    // Its safety preflight owns the resulting located diagnostic.
    let descriptor;
    try {
      descriptor =
        value !== null && typeof value === 'object'
          ? Object.getOwnPropertyDescriptor(value, 'protocolVersion')
          : undefined;
    } catch {
      return validateDiagramAuthoringArtifact(kind, value);
    }
    if (descriptor && !Object.hasOwn(descriptor, 'value'))
      return validateDiagramAuthoringArtifact(kind, value);
    versionInput = { protocolVersion: descriptor?.value };
  }
  const version = inferredVersion(kind, versionInput, protocolVersion);
  if (version === '1.13.0' && authoringKind) {
    return validateDiagramAuthoringArtifact(kind, value);
  }
  const resolved = sharedProtocolSchema(kind, version);
  const errors = validateResolvedArtifact(value, resolved);
  if (kind === 'guided-questionnaire' && version === '1.2.0') {
    errors.push(...guidedQuestionnaireCompatibilityErrors(value));
  }
  return errors;
}

/**
 * Validate the dashboard bootstrap schema plus invariants JSON Schema cannot
 * express, most importantly equality of the served and embedded build IDs.
 * @returns {ReturnType<typeof import('./contracts.d.mts').validateDashboardBootstrapV1>}
 */
export function validateDashboardBootstrapV1(value) {
  const errors = validateProtocolArtifact('dashboard-bootstrap', value, {
    protocolVersion: '1.2.0',
  });
  if (errors.length) return errors;

  const buildId = value.ui.buildId;
  const expectedBuildId = value.ui.expectedBuildId;
  const reasons = value.compatibility.reasonCodes;
  const mismatch = buildId !== expectedBuildId;
  const hasMismatchReason = reasons.includes('DASHBOARD_BUILD_MISMATCH');
  if (mismatch !== hasMismatchReason) {
    errors.push({
      path: '$.compatibility.reasonCodes',
      rule: 'semantic',
      detail: 'DASHBOARD_BUILD_MISMATCH must exactly reflect unequal non-null build identities',
    });
  }
  if (value.compatibility.status === 'compatible' && buildId !== expectedBuildId) {
    errors.push({
      path: '$.ui',
      rule: 'semantic',
      detail: 'compatible dashboard build identities must be equal',
    });
  }
  for (const product of ['planning', 'operate']) {
    const root = value.queryRoots[product];
    if (root !== null && root.projectId !== value.project.projectId) {
      errors.push({
        path: `$.queryRoots.${product}.projectId`,
        rule: 'semantic',
        detail: 'dashboard query roots must belong to the exact bootstrap project',
      });
    }
  }
  return errors;
}

/**
 * Assert the complete public dashboard bootstrap contract.
 * @type {typeof import('./contracts.d.mts').assertDashboardBootstrapV1}
 */
export function assertDashboardBootstrapV1(value) {
  const errors = validateDashboardBootstrapV1(value);
  if (errors.length) {
    throw new PipelineError(
      'E_PROTOCOL_ARTIFACT_INVALID',
      `dashboard-bootstrap: ${errors[0].path} ${errors[0].detail}`,
    );
  }
  return value;
}

/** @type {typeof import('./contracts.d.mts').validateOperateExperienceArtifactV2} */
export function validateOperateExperienceArtifactV2(kind, value) {
  const resolved = sharedOperateExperienceSchemaV2(kind, '2.0.0');
  return validateResolvedArtifact(value, resolved);
}

/** @type {typeof import('./contracts.d.mts').assertOperateExperienceArtifactV2} */
export function assertOperateExperienceArtifactV2(kind, value) {
  const errors = validateOperateExperienceArtifactV2(kind, value);
  if (errors.length) {
    throw new PipelineError(
      'E_PROTOCOL_ARTIFACT_INVALID',
      `${kind}: ${errors[0].path} ${errors[0].detail}`,
    );
  }
  return value;
}

/** @type {typeof import('./contracts.d.mts').assertProtocolArtifact} */
export function assertProtocolArtifact(kind, value, options) {
  const errors = validateProtocolArtifact(kind, value, options);
  if (errors.length) {
    throw new PipelineError(
      'E_PROTOCOL_ARTIFACT_INVALID',
      `${kind}: ${errors[0].path} ${errors[0].detail}`,
      '',
      { errors },
    );
  }
  return value;
}

/**
 * Validate only one of the three Phase 6 data-only registration contracts.
 * @type {typeof import('./contracts.d.mts').assertOperateGovernedExtensionRegistrationV2}
 */
export function assertOperateGovernedExtensionRegistrationV2(kind, value) {
  if (!OPERATE_GOVERNED_PROVIDER_REGISTRATION_CONTRACT_KINDS_V2.includes(kind)) {
    throw new PipelineError(
      'E_SCHEMA_UNKNOWN',
      `Unknown governed Operate extension registration kind: ${kind}`,
    );
  }
  return assertProtocolArtifact(kind, value, { protocolVersion: '2.0.0' });
}
