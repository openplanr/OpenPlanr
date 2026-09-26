import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { validateProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';
import { PipelineError } from './errors.mjs';

export const SHIP_SPECIALIST_IDS = Object.freeze([
  'security',
  'performance',
  'migration',
  'api-contract',
  'data-integrity',
]);

export const BROWSER_SURFACES = Object.freeze([
  'ui',
  'authentication',
  'session',
  'navigation',
  'network',
]);

const registry = Object.freeze(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../registry/ship-review-specialists.json', import.meta.url)),
      'utf8',
    ),
  ),
);

function fail(code, message, details) {
  throw new PipelineError(code, message, '', details);
}

function schema(kind, value, code) {
  const errors = validateProtocolArtifact(kind, value, { protocolVersion: '1.1.0' });
  if (errors.length) fail(code, `${errors[0].path}: ${errors[0].detail}`);
}

function pathKey({ repositoryKey, path }) {
  return `${repositoryKey}\0${path}`;
}

function canonicalPath(entry) {
  if (
    entry === null ||
    typeof entry !== 'object' ||
    Array.isArray(entry) ||
    JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(['path', 'repositoryKey'])
  ) {
    fail('E_SHIP_RISK_INPUT_INVALID', 'Risk paths must contain exactly repositoryKey and path.');
  }
  if (
    !/^[a-z][a-z0-9-]*$/.test(entry.repositoryKey ?? '') ||
    typeof entry.path !== 'string' ||
    entry.path.length === 0 ||
    entry.path.length > 1024 ||
    entry.path.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(entry.path)
  ) {
    fail('E_SHIP_RISK_PATH_INVALID', 'Risk paths must be bounded repository-relative paths.');
  }
  const path = entry.path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!path || path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    fail(
      'E_SHIP_RISK_PATH_INVALID',
      `Risk path contains traversal or an empty segment: ${entry.path}`,
    );
  }
  return { repositoryKey: entry.repositoryKey, path };
}

function canonicalEnum(values, allowed, field) {
  if (!Array.isArray(values) || values.some((value) => !allowed.includes(value))) {
    fail('E_SHIP_RISK_INPUT_INVALID', `${field} contains an unknown value.`);
  }
  if (new Set(values).size !== values.length)
    fail('E_SHIP_RISK_INPUT_INVALID', `${field} contains duplicates.`);
  return allowed.filter((value) => values.includes(value));
}

export function shipReviewSpecialistRegistry() {
  schema('ship-review-specialist-registry', registry, 'E_SHIP_SPECIALIST_REGISTRY_INVALID');
  const ids = registry.specialists.map(({ id }) => id);
  if (JSON.stringify(ids) !== JSON.stringify(SHIP_SPECIALIST_IDS)) {
    fail('E_SHIP_SPECIALIST_REGISTRY_INVALID', 'The specialist registry order is not canonical.');
  }
  for (const specialist of registry.specialists) {
    if (
      JSON.stringify(specialist.capabilities) !==
        JSON.stringify(['candidate.read', 'evidence.read', 'finding.contribute']) ||
      specialist.authority !== 'read-only-consolidated-review'
    ) {
      fail(
        'E_SHIP_SPECIALIST_AUTHORITY_INVALID',
        `Specialist ${specialist.id} exceeds read-only consolidated review authority.`,
      );
    }
  }
  return structuredClone(registry);
}

function pathSignals(paths) {
  const joined = paths.map(({ path }) => path.toLowerCase());
  const any = (pattern) => joined.some((path) => pattern.test(path));
  const browserSurfaces = new Set();
  if (any(/(?:^|\/)(?:src\/)?(?:dashboard|frontend|ui|pages)(?:\/|$)|\.(?:tsx|jsx|css)$/u))
    browserSurfaces.add('ui');
  if (any(/(?:^|\/)(?:auth|authentication|login|oauth)(?:\/|[-_.])/u))
    browserSurfaces.add('authentication');
  if (any(/(?:^|\/)(?:session|sessions)(?:\/|[-_.])/u)) browserSurfaces.add('session');
  if (any(/(?:^|\/)(?:router|routes|navigation)(?:\/|[-_.])/u)) browserSurfaces.add('navigation');
  if (any(/(?:^|\/)(?:network|client|fetch|http)(?:\/|[-_.])|openapi|graphql/u))
    browserSurfaces.add('network');
  return {
    browserSurfaces: BROWSER_SURFACES.filter((surface) => browserSurfaces.has(surface)),
    security: any(/auth|security|permission|credential|secret|token|crypto|live-room/u),
    performance: any(/perf|benchmark|latency|budget/u),
    migration: any(/migrat|schema-transition/u),
    contract: any(/(?:^|\/)(?:schemas?|contracts?|api)(?:\/|[-_.])|openapi|graphql/u),
    data: any(
      /database|(?:^|\/)db(?:\/|[-_.])|storage|persistence|provenance|receipt|data-integrity/u,
    ),
  };
}

export function classifyShipRisk(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail('E_SHIP_RISK_INPUT_INVALID', 'Risk input must be a closed object.');
  const expected = [
    'browserSurfaces',
    'changedPaths',
    'contractChanges',
    'dataWrites',
    'explicitRisks',
    'migrationChanges',
    'performanceBudgets',
    'permissionEffects',
    'subjectDigest',
  ];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected))
    fail('E_SHIP_RISK_INPUT_INVALID', `Risk input fields must be exactly: ${expected.join(', ')}.`);
  const changedPaths = value.changedPaths
    .map(canonicalPath)
    .sort((left, right) => pathKey(left).localeCompare(pathKey(right)));
  if (new Set(changedPaths.map(pathKey)).size !== changedPaths.length)
    fail('E_SHIP_RISK_INPUT_INVALID', 'changedPaths contains duplicate repository paths.');
  const explicitRisks = canonicalEnum(value.explicitRisks, SHIP_SPECIALIST_IDS, 'explicitRisks');
  const declaredSurfaces = canonicalEnum(
    value.browserSurfaces,
    BROWSER_SURFACES,
    'browserSurfaces',
  );
  const input = {
    subjectDigest: value.subjectDigest,
    changedPaths,
    browserSurfaces: declaredSurfaces,
    contractChanges: value.contractChanges,
    migrationChanges: value.migrationChanges,
    permissionEffects: value.permissionEffects,
    dataWrites: value.dataWrites,
    performanceBudgets: value.performanceBudgets,
    explicitRisks,
  };
  schema(
    'ship-risk-classification',
    {
      kind: 'ship-risk-classification',
      schemaVersion: '1.0.0',
      protocolVersion: '1.1.0',
      input,
      inputDigest: sha256Jcs(input),
      selectedSpecialists: [],
      reviewerRoster: ['qa-agent'],
      browserQa: {
        required: false,
        triggers: [],
        requirementDigest: sha256Jcs({ required: false, triggers: [] }),
      },
      classificationDigest: sha256Jcs(null),
    },
    'E_SHIP_RISK_INPUT_INVALID',
  );
  const signals = pathSignals(changedPaths);
  const selected = new Set(explicitRisks);
  if (value.permissionEffects || signals.security) selected.add('security');
  if (value.performanceBudgets || signals.performance) selected.add('performance');
  if (value.migrationChanges || signals.migration) {
    selected.add('migration');
    selected.add('data-integrity');
  }
  if (value.contractChanges || signals.contract) selected.add('api-contract');
  if (value.dataWrites || signals.data) selected.add('data-integrity');
  const selectedSpecialists = SHIP_SPECIALIST_IDS.filter((id) => selected.has(id));
  const triggers = BROWSER_SURFACES.filter(
    (surface) => declaredSurfaces.includes(surface) || signals.browserSurfaces.includes(surface),
  );
  const required = triggers.length > 0;
  const browserQa = { required, triggers, requirementDigest: sha256Jcs({ required, triggers }) };
  const classification = {
    kind: 'ship-risk-classification',
    schemaVersion: '1.0.0',
    protocolVersion: '1.1.0',
    input,
    inputDigest: sha256Jcs(input),
    selectedSpecialists,
    reviewerRoster: ['qa-agent', ...selectedSpecialists],
    browserQa,
  };
  return Object.freeze({ ...classification, classificationDigest: sha256Jcs(classification) });
}

export function assertShipRiskClassification(value) {
  schema('ship-risk-classification', value, 'E_SHIP_RISK_CLASSIFICATION_INVALID');
  const expected = classifyShipRisk(value.input);
  if (sha256Jcs(value) !== sha256Jcs(expected))
    fail(
      'E_SHIP_RISK_CLASSIFICATION_INVALID',
      'Risk classification is not the canonical deterministic result.',
    );
  return value;
}

export function assertSpecialistReviewResult(value, { classification, candidateDigest } = {}) {
  schema('specialist-review-result', value, 'E_SHIP_SPECIALIST_RESULT_INVALID');
  assertShipRiskClassification(classification);
  if (
    !classification.selectedSpecialists.includes(value.specialistId) ||
    value.candidateDigest !== candidateDigest ||
    value.classificationDigest !== classification.classificationDigest
  ) {
    fail(
      'E_SHIP_SPECIALIST_RESULT_FOREIGN',
      'Specialist result does not bind the selected specialist, candidate, and classification.',
    );
  }
  if (
    /(?:-----BEGIN .*PRIVATE KEY-----|\b(?:cookie|password|secret|token)\s*[:=]|\/(?:Users|home)\/)/iu.test(
      value.summary,
    )
  ) {
    fail(
      'E_SHIP_SPECIALIST_RESULT_PRIVATE',
      'Specialist result contains private or credential-like text.',
    );
  }
  return value;
}
