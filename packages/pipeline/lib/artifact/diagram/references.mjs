import { getGrammar } from './registry.mjs';

export const DIAGRAM_SHARED_REFERENCE = 'references/diagram/shared.md';

export function selectDiagramReferences(grammarId) {
  const grammar = getGrammar(grammarId);
  return Object.freeze([DIAGRAM_SHARED_REFERENCE, grammar.reference]);
}
