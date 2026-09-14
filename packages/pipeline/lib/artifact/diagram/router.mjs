import { DIAGRAM_ERROR_CODES, diagramFail } from './errors.mjs';
import {
  DIAGRAM_GRAMMARS,
  DIAGRAM_SEMANTIC_PATTERNS,
  findGrammarAliases,
  getGrammar,
} from './registry.mjs';

function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
}

function phraseMatch(intent, phrase) {
  const normalized = normalize(phrase);
  return normalized.length > 1 && (` ${intent} `).includes(` ${normalized} `);
}

export function routeDiagramIntent({
  intent = '',
  grammarId = null,
  direction = null,
  detailTier = 'balanced',
  destination = 'fit',
} = {}) {
  let grammar;
  if (grammarId) {
    grammar = getGrammar(grammarId);
  } else {
    const exact = findGrammarAliases(intent);
    if (exact.length === 1) grammar = getGrammar(exact[0]);
    if (exact.length > 1) {
      diagramFail(DIAGRAM_ERROR_CODES.GRAMMAR_AMBIGUOUS, `Diagram intent matches multiple exact aliases: ${intent}`, { candidates: exact });
    }
    if (!grammar) {
      const text = normalize(intent);
      const scores = new Map(DIAGRAM_GRAMMARS.map(({ grammarId: id }) => [id, 0]));
      for (const candidate of DIAGRAM_GRAMMARS) {
        for (const phrase of [candidate.title, ...candidate.aliases]) {
          if (phraseMatch(text, phrase)) scores.set(candidate.grammarId, scores.get(candidate.grammarId) + normalize(phrase).split(' ').length);
        }
      }
      for (const pattern of DIAGRAM_SEMANTIC_PATTERNS) {
        if (!pattern.triggers.some((trigger) => phraseMatch(text, trigger))) continue;
        pattern.candidateGrammars.forEach((id, index) => scores.set(id, scores.get(id) + Math.max(1, 3 - index)));
      }
      const ranked = [...scores.entries()].filter(([, score]) => score > 0).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
      const highest = ranked[0]?.[1] ?? 0;
      const leaders = ranked.filter(([, score]) => score === highest).map(([id]) => id);
      if (leaders.length !== 1) {
        diagramFail(DIAGRAM_ERROR_CODES.GRAMMAR_AMBIGUOUS, 'Diagram intent does not select one compatible grammar.', {
          intent,
          candidates: leaders.length > 0 ? leaders : DIAGRAM_GRAMMARS.map(({ grammarId: id }) => id),
          repair: 'Provide a grammar ID or clarify the information relationship.',
        });
      }
      grammar = getGrammar(leaders[0]);
    }
  }
  const selectedDirection = direction ?? grammar.directions[0];
  if (!grammar.directions.includes(selectedDirection)) {
    diagramFail(DIAGRAM_ERROR_CODES.GRAMMAR_RULE_INVALID, `Direction ${selectedDirection} is not supported by ${grammar.grammarId}.`, {
      allowed: grammar.directions,
    });
  }
  if (!grammar.readability.aspectRatios.includes(destination)) {
    diagramFail(DIAGRAM_ERROR_CODES.GRAMMAR_RULE_INVALID, `Destination ${destination} is not supported by ${grammar.grammarId}.`, {
      allowed: grammar.readability.aspectRatios,
    });
  }
  if (!['simplified', 'balanced', 'faithful'].includes(detailTier)) {
    diagramFail(DIAGRAM_ERROR_CODES.GRAMMAR_RULE_INVALID, `Unknown detail tier: ${detailTier}`);
  }
  return Object.freeze({
    grammar,
    grammarId: grammar.grammarId,
    layoutFamily: grammar.layoutFamily,
    direction: selectedDirection,
    detailTier,
    destination,
    readabilityBudget: grammar.detailLimits[detailTier],
  });
}
