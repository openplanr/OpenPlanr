const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'before', 'for', 'from', 'in', 'into',
  'is', 'it', 'of', 'on', 'only', 'or', 'our', 'the', 'this', 'to', 'use', 'using',
  'we', 'when', 'with', 'without',
]);

const TOKEN_EXPANSIONS = Object.freeze({
  qa: ['quality', 'test', 'browser'],
  ui: ['interface', 'design'],
  ux: ['interface', 'design', 'usability'],
  bug: ['defect', 'error', 'regression'],
  issue: ['defect', 'error'],
  release: ['landing', 'land'],
  deploy: ['deployment', 'publish'],
  roadmap: ['plan', 'planning'],
  build: ['implement', 'implementation'],
  coding: ['code', 'implementation'],
  marketing: ['market', 'growth'],
  customers: ['customer'],
  exec: ['executive', 'operate'],
  board: ['executive', 'operate'],
  tech: ['technology', 'technical'],
  docs: ['documentation'],
});

function stem(token) {
  if (token.length > 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

export function tokenizeRoutingText(value) {
  const base = String(value ?? '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  const expanded = base.flatMap((token) => [token, ...(TOKEN_EXPANSIONS[token] ?? [])]);
  return [...new Set(expanded.map(stem).filter((token) => !STOP_WORDS.has(token)))];
}

function validateRegistry(registry) {
  if (!registry || typeof registry !== 'object' || !Array.isArray(registry.skills)) {
    throw new TypeError('registry must contain a skills array.');
  }
  const ids = new Set();
  for (const skill of registry.skills) {
    if (!skill?.skillId || ids.has(skill.skillId) || !skill.triggerPolicy) {
      throw new TypeError('registry skills must have unique skillId and triggerPolicy values.');
    }
    ids.add(skill.skillId);
  }
  return registry;
}

function overlapScore(inputTokens, cueTokens, weights) {
  if (cueTokens.length === 0) return 0;
  const input = new Set(inputTokens);
  const weight = (token) => weights.get(token) ?? 1;
  const total = cueTokens.reduce((sum, token) => sum + weight(token), 0);
  const matched = cueTokens.reduce(
    (sum, token) => sum + (input.has(token) ? weight(token) : 0),
    0,
  );
  return total === 0 ? 0 : matched / total;
}

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function hasExplicitName(input, skillId, aliases) {
  const raw = input.toLowerCase();
  const canonical = escapeRegExp(skillId);
  const spoken = escapeRegExp(skillId.replaceAll('-', ' '));
  if (new RegExp(`(?:^|[\\s$/])${canonical}(?=$|[\\s.,:;!?])`, 'u').test(raw)) return true;
  if (new RegExp(`(?:^|\\s)${spoken}(?=$|[\\s.,:;!?])`, 'u').test(raw)) return true;
  const trimmed = raw.trim();
  return aliases.some((alias) => (
    trimmed === alias
    || new RegExp(`(?:^|\\s)[$/]${escapeRegExp(alias)}(?=$|[\\s.,:;!?])`, 'u').test(raw)
  ));
}

export function buildSkillMatchIndex(registry) {
  validateRegistry(registry);
  const aliasesBySkill = new Map(registry.skills.map(({ skillId }) => [skillId, []]));
  for (const alias of registry.aliases ?? []) {
    if (!aliasesBySkill.has(alias.canonicalSkillId)) {
      throw new TypeError(`Alias ${alias.id} targets unknown skill ${alias.canonicalSkillId}.`);
    }
    aliasesBySkill.get(alias.canonicalSkillId).push(alias.id);
  }

  const documents = registry.skills.map((skill) => {
    const include = skill.triggerPolicy.include.map(tokenizeRoutingText);
    const exclude = skill.triggerPolicy.exclude.map(tokenizeRoutingText);
    const description = tokenizeRoutingText(skill.description);
    return {
      skill,
      aliases: aliasesBySkill.get(skill.skillId),
      include,
      exclude,
      description,
      vocabulary: new Set([...description, ...include.flat()]),
    };
  });
  const frequencies = new Map();
  for (const document of documents) {
    for (const token of document.vocabulary) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }
  }
  const weights = new Map([...frequencies].map(([token, frequency]) => [
    token,
    1 + Math.log((documents.length + 1) / (frequency + 1)),
  ]));
  return Object.freeze({ registry, documents, weights });
}

function scoreDocument(input, inputTokens, document, weights) {
  const include = Math.max(0, ...document.include.map((tokens) => (
    overlapScore(inputTokens, tokens, weights)
  )));
  const description = overlapScore(inputTokens, document.description, weights);
  const exclusion = Math.max(0, ...document.exclude.map((tokens) => (
    overlapScore(inputTokens, tokens, weights)
  )));
  const explicit = hasExplicitName(input, document.skill.skillId, document.aliases) ? 1 : 0;
  const raw = explicit > 0
    ? 1
    : Math.max(include, description * 0.72) * (exclusion >= 0.72 ? 0.15 : 1);
  return {
    skillId: document.skill.skillId,
    family: document.skill.family,
    score: Number(raw.toFixed(6)),
    include: Number(include.toFixed(6)),
    exclusion: Number(exclusion.toFixed(6)),
    explicit: explicit === 1,
    deferTo: [...(document.skill.triggerPolicy.deferTo ?? [])],
  };
}

export function matchSkillRequest({ registry, index, input, threshold = 0.34, ambiguityDelta = 0.06 } = {}) {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new TypeError('input must be non-empty routing text.');
  }
  const activeIndex = index ?? buildSkillMatchIndex(registry);
  const tokens = tokenizeRoutingText(input);
  const candidates = activeIndex.documents
    .map((document) => scoreDocument(input, tokens, document, activeIndex.weights))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.skillId.localeCompare(right.skillId));
  const top = candidates[0];
  if (!top || top.score < threshold) {
    return Object.freeze({ status: 'deferred', skillId: null, family: null, reason: 'no-confident-match', candidates });
  }

  for (const deferredSkillId of top.deferTo) {
    const target = candidates.find(({ skillId }) => skillId === deferredSkillId);
    if (target && target.score >= top.score - ambiguityDelta) {
      return Object.freeze({
        status: 'matched',
        skillId: target.skillId,
        family: target.family,
        reason: 'declared-defer',
        candidates,
      });
    }
  }

  const second = candidates[1];
  if (
    second
    && !top.explicit
    && !second.explicit
    && top.score - second.score <= ambiguityDelta
  ) {
    return Object.freeze({
      status: 'deferred',
      skillId: null,
      family: null,
      reason: 'ambiguous-match',
      candidates,
    });
  }
  return Object.freeze({
    status: 'matched',
    skillId: top.skillId,
    family: top.family,
    reason: top.explicit ? 'explicit-name' : 'trigger-policy',
    candidates,
  });
}
