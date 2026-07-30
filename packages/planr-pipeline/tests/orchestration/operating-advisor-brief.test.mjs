import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createOperatingAdvisorBrief,
  listOperatingAdvisorBriefs,
  sha256Jcs,
} from '../../lib/pipeline/index.mjs';

test('executive advisor briefs are registry-derived, distinct, and digest-bound', () => {
  const ceo = createOperatingAdvisorBrief('strategy-finance');
  const cto = createOperatingAdvisorBrief('technology-risk');

  assert.equal(ceo.role.displayLabel, 'CEO');
  assert.equal(cto.role.displayLabel, 'CTO');
  assert.match(ceo.role.mandate, /pricing and packaging/);
  assert.match(cto.role.mandate, /security/);
  assert.notEqual(ceo.briefDigest, cto.briefDigest);
  assert.equal(
    ceo.briefDigest,
    sha256Jcs(Object.fromEntries(Object.entries(ceo).filter(([key]) => key !== 'briefDigest'))),
  );
  assert.ok(ceo.authority.sharedBoundaries.some((boundary) => /untrusted data/.test(boundary)));
  assert.ok(cto.authority.forbiddenRecommendationCategories.includes('production-write'));
  assert.equal(ceo.output.schema, 'operating-advisor-response@1.2.0');
  assert.deepEqual(ceo.output.jsonSchema.required, [
    'outcome',
    'proposals',
    'gaps',
    'conflicts',
  ]);
  assert.deepEqual(ceo.output.jsonSchema.properties.outcome.enum, ['proposals', 'quiet']);
  assert.deepEqual(ceo.output.jsonSchema.examples[0], {
    outcome: 'quiet',
    proposals: [],
    gaps: [],
    conflicts: [],
  });
  assert.deepEqual(ceo.output.allowedProposalTypes, ['data-gap', 'decision', 'finding']);
});

test('chair brief is consolidation-only and cannot assign deterministic state', () => {
  const chair = createOperatingAdvisorBrief('chair');
  assert.deepEqual(chair.output.allowedProposalTypes, ['merge', 'sequence']);
  assert.equal(chair.output.scoring, null);
  assert.ok(chair.output.requiredBehavior.some((rule) => /Never assign persistent IDs/.test(rule)));
  assert.ok(chair.evidence.permittedKinds.includes('verified-advisor-result'));
});

test('all six launch lenses expose canonical role briefs', () => {
  const briefs = listOperatingAdvisorBriefs();
  assert.deepEqual(
    briefs.map((brief) => brief.role.displayLabel).sort(),
    ['CEO', 'CMO', 'COO', 'CPO', 'CTO', 'Chair'].sort(),
  );
  assert.throws(
    () => createOperatingAdvisorBrief('delivery-agent'),
    (error) => error.code === 'E_OPERATE_ROLE_UNKNOWN',
  );
});
