import { DESIGN_HANDOFF_CONTRACT_FILES } from './design-handoff-contracts.mjs';
import { DIAGRAM_AUTHORING_CONTRACT_FILES } from './diagram-authoring-contracts.mjs';
import {
  PROTOCOL_V16_CONTRACT_FILES,
  PROTOCOL_V17_CONTRACT_FILES,
  PROTOCOL_V18_CONTRACT_FILES,
} from './skill-source-contracts.mjs';

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

export const PROTOCOL_V16_CONTRACTS = PROTOCOL_V16_CONTRACT_FILES;
export const PROTOCOL_V17_CONTRACTS = PROTOCOL_V17_CONTRACT_FILES;
export const PROTOCOL_V18_CONTRACTS = PROTOCOL_V18_CONTRACT_FILES;
export const PROTOCOL_V111_CONTRACTS = Object.freeze({
  'design-review-metadata-payload': 'design-review-metadata-payload.schema.json',
  ...DESIGN_HANDOFF_CONTRACT_FILES,
});

export const PROTOCOL_V113_CONTRACTS = DIAGRAM_AUTHORING_CONTRACT_FILES;

const PROTOCOL_CONTRACTS_BY_VERSION = Object.freeze({
  '1.5.0': PROTOCOL_V15_CONTRACTS,
  '1.6.0': PROTOCOL_V16_CONTRACTS,
  '1.7.0': PROTOCOL_V17_CONTRACTS,
  '1.8.0': PROTOCOL_V18_CONTRACTS,
  '1.11.0': PROTOCOL_V111_CONTRACTS,
  '1.13.0': PROTOCOL_V113_CONTRACTS,
});

/** Resolve a packaged schema asset without a source checkout or Node-only API. */
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
