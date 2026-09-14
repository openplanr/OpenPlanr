import {
  DIAGRAM_GRAMMAR_REGISTRY,
  DIAGRAM_SEMANTIC_PATTERN_REGISTRY,
} from '@openplanr/protocol/diagram-contracts';

import { DIAGRAM_ERROR_CODES, diagramFail } from './errors.mjs';

const grammarIndex = new Map(
  DIAGRAM_GRAMMAR_REGISTRY.grammars.map((grammar) => [grammar.grammarId, grammar]),
);

const aliasIndex = new Map();
for (const grammar of DIAGRAM_GRAMMAR_REGISTRY.grammars) {
  for (const alias of [grammar.grammarId, grammar.title, ...grammar.aliases]) {
    const key = alias.toLowerCase();
    const grammarIds = aliasIndex.get(key) ?? new Set();
    grammarIds.add(grammar.grammarId);
    aliasIndex.set(key, grammarIds);
  }
}

export const DIAGRAM_GRAMMARS = DIAGRAM_GRAMMAR_REGISTRY.grammars;
export const DIAGRAM_PRIMITIVES = DIAGRAM_GRAMMAR_REGISTRY.primitives;
export const DIAGRAM_LAYOUT_FAMILIES = DIAGRAM_GRAMMAR_REGISTRY.layoutFamilies;
export const DIAGRAM_SEMANTIC_PATTERNS = DIAGRAM_SEMANTIC_PATTERN_REGISTRY.patterns;

export function getGrammar(grammarId) {
  const grammar = grammarIndex.get(grammarId);
  if (!grammar) {
    diagramFail(DIAGRAM_ERROR_CODES.GRAMMAR_UNKNOWN, `Unknown diagram grammar: ${grammarId}`, {
      grammarId,
      available: [...grammarIndex.keys()],
    });
  }
  return grammar;
}

export function findGrammarAliases(value) {
  return Object.freeze([...(aliasIndex.get(String(value).trim().toLowerCase()) ?? new Set())]);
}
