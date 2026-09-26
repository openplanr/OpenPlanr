import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

assert.equal(
  typeof process.env.PLANR_OPENPLANR_ROOT,
  'string',
  'run this paired test through npm run test:unified-dashboard:paired',
);
const helperModule = join(
  process.env.PLANR_OPENPLANR_ROOT,
  'dist/services/operate/planning-handoff-service.js',
);

test('planning handoff transport helpers stay available to the dashboard server boundary', async () => {
  await access(helperModule);
  const { assertPlanningFraming, buildPlanningDeliveryProgress } = await import(
    pathToFileURL(helperModule).href
  );
  const framing = assertPlanningFraming({
    title: 'Reviewed title',
    slug: 'reviewed-title',
    problem: 'Problem',
    objective: 'Objective',
    users: ['Operators'],
    scope: ['One change'],
    nonScope: [],
    risks: [],
    constraints: [],
    requirements: ['Requirement'],
    acceptanceOutcomes: ['Accepted outcome'],
  });
  assert.equal(framing.slug, 'reviewed-title');
  const nodes = buildPlanningDeliveryProgress({
    decision: { id: 'dec_release_0001' },
    proposalId: 'oprop_planning_release_0001',
    spec: { specId: 'SPEC-001', status: 'shaping' },
  }).nodes;
  assert.equal(nodes[2].href, '#/detail/SPEC-001');
});
