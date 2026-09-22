import {
  DIAGRAM_AUTHORING_SCHEMAS,
  DIAGRAM_AUTHORING_CONTRACT_FILES,
  DIAGRAM_AUTHORING_CAPABILITIES,
} from '../src/diagram-authoring-contracts.mjs';

export { DIAGRAM_AUTHORING_CONTRACT_FILES };
export function buildDiagramAuthoringSchemas() {
  return new Map(Object.entries(DIAGRAM_AUTHORING_CONTRACT_FILES).map(([kind, filename]) => [filename, DIAGRAM_AUTHORING_SCHEMAS[kind]]));
}
export function buildDiagramAuthoringRegistries() {
  return new Map([['diagram-authoring-capabilities.json', DIAGRAM_AUTHORING_CAPABILITIES]]);
}
