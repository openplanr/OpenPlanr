// @ts-check
import { DESIGN_HANDOFF_CONTRACT_FILES } from './design-handoff-contracts.mjs';
import { DIAGRAM_AUTHORING_CONTRACT_FILES } from './diagram-authoring-contracts.mjs';
import {
  assertDiagramReviewBundle,
  assertDiagramReviewFeedback,
  assertDiagramWorkspaceContract,
  DIAGRAM_REVIEW_SCHEMAS,
} from './diagram-review-contracts.mjs';
import {
  PROTOCOL_V16_CONTRACT_FILES,
  PROTOCOL_V17_CONTRACT_FILES,
  PROTOCOL_V18_CONTRACT_FILES,
} from './skill-source-contracts.mjs';

/** @type {typeof import('./browser-contracts.d.mts').PROTOCOL_V15_CONTRACTS} */
export const PROTOCOL_V15_CONTRACTS = Object.freeze({
  'command-catalog': 'command-catalog.schema.json',
  'generated-asset-manifest': 'generated-asset-manifest.schema.json',
  'implementation-result': 'implementation-result.schema.json',
  'migration-preservation-manifest': 'migration-preservation-manifest.schema.json',
  'output-catalog': 'output-catalog.schema.json',
  'output-path-catalog': 'output-path-catalog.schema.json',
  'role-registry': 'role-registry.schema.json',
  'rule-catalog': 'rule-catalog.schema.json',
  'skill-catalog': 'skill-catalog.schema.json',
  'task-kind-registry': 'task-kind-registry.schema.json',
  'task-manifest': 'task-manifest.schema.json',
  'task-output-manifest': 'task-output-manifest.schema.json',
});

/** @type {typeof import('./browser-contracts.d.mts').PROTOCOL_V16_CONTRACTS} */
export const PROTOCOL_V16_CONTRACTS = PROTOCOL_V16_CONTRACT_FILES;
/** @type {typeof import('./browser-contracts.d.mts').PROTOCOL_V17_CONTRACTS} */
export const PROTOCOL_V17_CONTRACTS = PROTOCOL_V17_CONTRACT_FILES;
/** @type {typeof import('./browser-contracts.d.mts').PROTOCOL_V18_CONTRACTS} */
export const PROTOCOL_V18_CONTRACTS = PROTOCOL_V18_CONTRACT_FILES;
/** @type {typeof import('./browser-contracts.d.mts').PROTOCOL_V111_CONTRACTS} */
export const PROTOCOL_V111_CONTRACTS = Object.freeze({
  'design-review-metadata-payload': 'design-review-metadata-payload.schema.json',
  ...DESIGN_HANDOFF_CONTRACT_FILES,
});

/** @type {typeof import('./browser-contracts.d.mts').PROTOCOL_V113_CONTRACTS} */
export const PROTOCOL_V113_CONTRACTS = DIAGRAM_AUTHORING_CONTRACT_FILES;

/** @type {typeof import('./browser-contracts.d.mts').PROTOCOL_V115_CONTRACTS} */
export const PROTOCOL_V115_CONTRACTS = Object.freeze(
  Object.fromEntries(
    Object.keys(DIAGRAM_REVIEW_SCHEMAS).map((kind) => [kind, `${kind}.schema.json`]),
  ),
);

/** Keep semantic checks and inert-data safety identical in Node, browsers and Workers.
 * @type {typeof import('./browser-contracts.d.mts').validateDiagramReviewArtifact}
 */
export function validateDiagramReviewArtifact(kind, value, { protocolVersion = '1.15.0' } = {}) {
  if (protocolVersion !== '1.15.0' || !Object.hasOwn(DIAGRAM_REVIEW_SCHEMAS, kind))
    throw new RangeError(`Unknown diagram review Protocol contract: ${kind}@${protocolVersion}`);
  try {
    if (kind === 'diagram-review-bundle') assertDiagramReviewBundle(value);
    else if (kind === 'diagram-review-feedback') assertDiagramReviewFeedback(value);
    else assertDiagramWorkspaceContract(value, kind);
    return [];
  } catch (error) {
    return [
      {
        path: '$',
        rule: 'diagram-review-contract',
        detail: error instanceof Error ? error.message : 'Invalid diagram review data.',
      },
    ];
  }
}

const PROTOCOL_CONTRACTS_BY_VERSION = Object.freeze({
  '1.5.0': PROTOCOL_V15_CONTRACTS,
  '1.6.0': PROTOCOL_V16_CONTRACTS,
  '1.7.0': PROTOCOL_V17_CONTRACTS,
  '1.8.0': PROTOCOL_V18_CONTRACTS,
  '1.11.0': PROTOCOL_V111_CONTRACTS,
  '1.13.0': PROTOCOL_V113_CONTRACTS,
  '1.15.0': PROTOCOL_V115_CONTRACTS,
});

/**
 * Resolve a packaged schema asset without a source checkout or Node-only API.
 * @type {typeof import('./browser-contracts.d.mts').protocolAssetUrl}
 */
export function protocolAssetUrl(kind, { protocolVersion = '1.5.0' } = {}) {
  const contracts = Object.hasOwn(PROTOCOL_CONTRACTS_BY_VERSION, protocolVersion)
    ? PROTOCOL_CONTRACTS_BY_VERSION[protocolVersion]
    : null;
  const filename = contracts && Object.hasOwn(contracts, kind) ? contracts[kind] : null;
  if (!filename) {
    throw new RangeError(`Unknown browser-safe Protocol contract: ${kind}@${protocolVersion}`);
  }
  return new URL(`../schemas/v${protocolVersion}/${filename}`, import.meta.url);
}
