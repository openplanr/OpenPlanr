import { buildSkillMatchIndex, matchSkillRequest } from './matcher.mjs';

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4));
}

export const ROUTING_CASE_KINDS = Object.freeze([
  'positive',
  'paraphrase',
  'near-miss',
  'ambiguous',
  'explicit',
  'unrelated',
  'optional-context',
]);

/** Derive complete per-skill routing coverage from the versioned trigger registry. */
export function buildRegistryRoutingCases(registry) {
  if (!Array.isArray(registry?.skills))
    throw new TypeError('registry must contain a skills array.');
  return Object.freeze(
    registry.skills.flatMap((skill) => {
      const [primary, paraphrase = primary] = skill.triggerPolicy.include;
      const [nearMiss] = skill.triggerPolicy.exclude;
      const base = { subjectSkillId: skill.skillId };
      return [
        {
          ...base,
          id: `${skill.skillId}:positive`,
          kind: 'positive',
          input: primary,
          expectedSkillId: skill.skillId,
        },
        {
          ...base,
          id: `${skill.skillId}:paraphrase`,
          kind: 'paraphrase',
          input: paraphrase,
          expectedSkillId: skill.skillId,
        },
        {
          ...base,
          id: `${skill.skillId}:near-miss`,
          kind: 'near-miss',
          input: nearMiss,
          forbiddenSkillId: skill.skillId,
        },
        {
          ...base,
          id: `${skill.skillId}:ambiguous`,
          kind: 'ambiguous',
          input: `${primary}. Some optional details remain ambiguous, but that is the requested outcome.`,
          expectedSkillId: skill.skillId,
        },
        {
          ...base,
          id: `${skill.skillId}:explicit`,
          kind: 'explicit',
          input: `Use $${skill.skillId} for this request`,
          expectedSkillId: skill.skillId,
          expectedReason: 'explicit-name',
        },
        {
          ...base,
          id: `${skill.skillId}:unrelated`,
          kind: 'unrelated',
          input: 'Translate this unrelated paragraph into French',
          forbiddenSkillId: skill.skillId,
        },
        {
          ...base,
          id: `${skill.skillId}:optional-context`,
          kind: 'optional-context',
          input: `${primary} using the current repository and any available project context`,
          expectedSkillId: skill.skillId,
        },
      ];
    }),
  );
}

export function evaluateRoutingCorpus({ registry, cases, threshold = 0.95 } = {}) {
  if (!Array.isArray(cases) || cases.length === 0)
    throw new TypeError('cases must be a non-empty array.');
  const index = buildSkillMatchIndex(registry);
  const families = new Map(
    registry.skills.map(({ family }) => [
      family,
      {
        family,
        truePositive: 0,
        falsePositive: 0,
        falseNegative: 0,
        deferred: 0,
      },
    ]),
  );
  const familyBySkill = new Map(registry.skills.map(({ skillId, family }) => [skillId, family]));
  const results = cases.map((fixture) => {
    const actual = matchSkillRequest({ index, input: fixture.input });
    const expectedSkillId = fixture.expectedSkillId ?? null;
    const expectedStatus = fixture.expectedStatus ?? (expectedSkillId ? 'matched' : null);
    const pass =
      (fixture.forbiddenSkillId
        ? actual.skillId !== fixture.forbiddenSkillId
        : actual.status === expectedStatus &&
          (expectedSkillId === null || actual.skillId === expectedSkillId)) &&
      (fixture.expectedReason === undefined || actual.reason === fixture.expectedReason);
    const expectedFamily = expectedSkillId ? familyBySkill.get(expectedSkillId) : null;
    if (expectedFamily) {
      const metrics = families.get(expectedFamily);
      if (actual.skillId === expectedSkillId) metrics.truePositive += 1;
      else {
        metrics.falseNegative += 1;
        if (actual.status === 'deferred') metrics.deferred += 1;
      }
    }
    if (!fixture.forbiddenSkillId && actual.skillId && actual.skillId !== expectedSkillId) {
      families.get(familyBySkill.get(actual.skillId)).falsePositive += 1;
    }
    return {
      id: fixture.id,
      kind: fixture.kind,
      subjectSkillId: fixture.subjectSkillId ?? expectedSkillId,
      input: fixture.input,
      expectedStatus,
      expectedSkillId,
      forbiddenSkillId: fixture.forbiddenSkillId ?? null,
      actualStatus: actual.status,
      actualSkillId: actual.skillId,
      reason: actual.reason,
      pass,
    };
  });

  const familyMetrics = [...families.values()]
    .filter(
      ({ truePositive, falsePositive, falseNegative }) =>
        truePositive + falsePositive + falseNegative > 0,
    )
    .map((metrics) => {
      const precision = ratio(metrics.truePositive, metrics.truePositive + metrics.falsePositive);
      const recall = ratio(metrics.truePositive, metrics.truePositive + metrics.falseNegative);
      return { ...metrics, precision, recall, pass: precision >= threshold && recall >= threshold };
    })
    .sort((left, right) => left.family.localeCompare(right.family));
  const falsePositives = results.filter(
    ({ actualSkillId, expectedSkillId, forbiddenSkillId }) =>
      forbiddenSkillId === null && actualSkillId !== null && actualSkillId !== expectedSkillId,
  );
  const falseNegatives = results.filter(
    ({ expectedSkillId, actualSkillId }) =>
      expectedSkillId !== null && actualSkillId !== expectedSkillId,
  );
  const failedFamilies = familyMetrics.filter(({ pass }) => !pass);
  const coverage = registry.skills.map(({ skillId }) => {
    const relevant = results.filter(({ subjectSkillId }) => subjectSkillId === skillId);
    const kinds = [...new Set(relevant.map(({ kind }) => kind))].sort();
    const missingKinds = ROUTING_CASE_KINDS.filter((kind) => !kinds.includes(kind));
    return {
      skillId,
      cases: relevant.length,
      kinds,
      missingKinds,
      pass: missingKinds.length === 0 && relevant.every(({ pass }) => pass),
    };
  });
  return Object.freeze({
    kind: 'skill-routing-evaluation',
    schemaVersion: '1.0.0',
    threshold,
    passed:
      failedFamilies.length === 0 &&
      results.every(({ pass }) => pass) &&
      coverage.every(({ pass }) => pass),
    totals: {
      cases: results.length,
      passed: results.filter(({ pass }) => pass).length,
      falsePositives: falsePositives.length,
      falseNegatives: falseNegatives.length,
      deferred: results.filter(({ actualStatus }) => actualStatus === 'deferred').length,
    },
    families: familyMetrics,
    falsePositives,
    falseNegatives,
    coverage,
    results,
  });
}
