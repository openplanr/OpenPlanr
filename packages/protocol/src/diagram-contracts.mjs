import { DIAGRAM_V16_CONTRACT_FILES } from './skill-source-contracts.mjs';
import { DIAGRAM_AUTHORING_CONTRACT_FILES } from './diagram-authoring-contracts.mjs';
import { DIAGRAM_REGISTRIES } from './generated/diagram-registries.mjs';

export const DIAGRAM_CONTRACT_FILES = DIAGRAM_V16_CONTRACT_FILES;
export const DIAGRAM_GRAMMAR_REGISTRY = DIAGRAM_REGISTRIES['diagram-grammars.json'];
export const DIAGRAM_SEMANTIC_PATTERN_REGISTRY =
  DIAGRAM_REGISTRIES['diagram-semantic-patterns.json'];

const grammarIndex = new Map(
  DIAGRAM_GRAMMAR_REGISTRY.grammars.map((grammar) => [grammar.grammarId, grammar]),
);

export function getDiagramGrammar(grammarId) {
  return grammarIndex.get(grammarId) ?? null;
}

export function diagramContractUrl(kind, { protocolVersion = '1.6.0' } = {}) {
  const files =
    protocolVersion === '1.6.0'
      ? DIAGRAM_CONTRACT_FILES
      : protocolVersion === '1.13.0'
        ? DIAGRAM_AUTHORING_CONTRACT_FILES
        : null;
  const filename = files && Object.hasOwn(files, kind) ? files[kind] : null;
  if (!filename) throw new RangeError(`Unknown diagram contract: ${kind}@${protocolVersion}`);
  return new URL(`../schemas/v${protocolVersion}/${filename}`, import.meta.url);
}

export function diagramDocumentPath(slug) {
  const value = String(slug);
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value)) {
    throw new TypeError(`Invalid diagram slug: ${value}`);
  }
  return `diagrams/${value}/${value}.planr-diagram.json`;
}
