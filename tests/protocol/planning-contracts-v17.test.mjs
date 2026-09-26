import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listProtocolSchemas,
  resolveProtocolSchema,
  validateProtocolArtifact,
} from '../../packages/protocol/src/contracts.mjs';
import {
  normalizePlanningTask,
  validatePlanningAcceptanceCoverage,
} from '../../packages/protocol/src/planning-contracts.mjs';
import { assertAuthorityNarrows } from '../../packages/skill-runtime/src/compiler/authority.mjs';

const DATE = '2026-09-02';
const story = {
  id: 'US-1000',
  title: 'Stable acceptance coverage',
  specId: 'SPEC-1000',
  slug: 'stable-acceptance-coverage',
  schemaVersion: '1.7.0',
  status: 'pending',
  created: DATE,
  updated: DATE,
  acceptanceCriteria: [
    { id: 'AC-001', statement: 'Every criterion maps to executable verification.' },
  ],
};
const task = {
  id: 'T-1000',
  title: 'Implement coverage',
  storyId: story.id,
  specId: story.specId,
  slug: 'implement-coverage',
  schemaVersion: '1.7.0',
  type: 'Tech',
  agent: 'backend-agent',
  status: 'pending',
  created: DATE,
  updated: DATE,
  dependsOn: [],
  preserve: [],
  reviewRisks: ['data-integrity'],
  browserSurfaces: [],
  acceptanceRefs: ['AC-001'],
  testRequirements: 'Verify AC-001 with the focused Protocol test.',
};

test('Protocol 1.7 publishes the planning and authority contracts without replacing v1.0 readers', () => {
  const kinds = listProtocolSchemas()
    .filter(({ protocolVersion }) => protocolVersion === '1.7.0')
    .map(({ kind }) => kind);
  for (const kind of ['planning-id-sequence', 'request-authority', 'spec', 'story', 'task']) {
    assert.ok(kinds.includes(kind), kind);
  }
  assert.match(
    resolveProtocolSchema('story', { protocolVersion: '1.0.0' }).path,
    /schemas\/v1\.0\.0\/story/u,
  );
  assert.match(
    resolveProtocolSchema('story', { protocolVersion: '1.7.0' }).path,
    /schemas\/v1\.7\.0\/story/u,
  );
});

test('Protocol 1.7 validates global IDs, stable acceptance IDs, metadata, and request scope', () => {
  const spec = {
    id: 'SPEC-1000',
    title: 'Global planning IDs',
    slug: 'global-planning-ids',
    schemaVersion: '1.7.0',
    status: 'decomposed',
    priority: 'P1',
    created: DATE,
    updated: DATE,
    ui_files: [],
    tech_dependencies: [],
  };
  const sequence = {
    kind: 'planning-id-sequence',
    schemaVersion: '1.0.0',
    protocolVersion: '1.7.0',
    next: { SPEC: 1001, US: 1001, T: 1001 },
  };
  const authority = {
    kind: 'request-authority',
    schemaVersion: '1.0.0',
    protocolVersion: '1.7.0',
    repositoryAccess: 'request-scope',
    capabilities: ['context-gathering', 'local-execution', 'read', 'write'],
    tools: ['read', 'edit', 'shell'],
    forbiddenEffects: ['external-publish', 'remote-deploy'],
  };
  const { testRequirements: _testRequirements, ...taskFrontmatter } = task;
  for (const [kind, value] of [
    ['spec', spec],
    ['story', story],
    ['task', taskFrontmatter],
    ['planning-id-sequence', sequence],
    ['request-authority', authority],
  ]) {
    assert.deepEqual(validateProtocolArtifact(kind, value, { protocolVersion: '1.7.0' }), [], kind);
  }
});

test('legacy snake-case metadata translates to canonical task fields', () => {
  assert.deepEqual(
    normalizePlanningTask({
      id: 'T-001',
      review_risks: ['security'],
      browser_surfaces: ['authentication'],
      acceptance_refs: ['AC-001'],
    }),
    {
      id: 'T-001',
      reviewRisks: ['security'],
      browserSurfaces: ['authentication'],
      acceptanceRefs: ['AC-001'],
    },
  );
  assert.deepEqual(normalizePlanningTask({ id: 'T-002' }), {
    id: 'T-002',
    reviewRisks: [],
    browserSurfaces: [],
    acceptanceRefs: [],
  });
});

test('acceptance coverage requires both task mapping and a verification statement', () => {
  assert.deepEqual(validatePlanningAcceptanceCoverage([story], [task]), []);
  assert.equal(
    validatePlanningAcceptanceCoverage([story], [{ ...task, acceptanceRefs: [] }])[0].rule,
    'coverage',
  );
  assert.equal(
    validatePlanningAcceptanceCoverage([story], [{ ...task, testRequirements: 'Run tests.' }])[0]
      .rule,
    'verification',
  );
  assert.equal(
    validatePlanningAcceptanceCoverage([story], [{ ...task, acceptanceRefs: ['AC-999'] }]).length,
    2,
  );
});

test('request-scope authority may narrow but never widen', () => {
  const base = {
    repositoryAccess: 'request-scope',
    externalDataAccess: 'none',
    allowedCapabilities: ['context-gathering', 'local-execution', 'read', 'write'],
    allowedTools: ['read', 'edit', 'shell'],
    allowedOperations: ['compile', 'render'],
    allowedOutputClasses: ['A', 'B', 'C'],
    forbiddenEffects: ['external-publish'],
  };
  const edge = { from: 'ship', to: 'host' };
  assert.doesNotThrow(() =>
    assertAuthorityNarrows(base, { ...base, repositoryAccess: 'declared-paths' }, { edge }),
  );
  assert.throws(
    () => assertAuthorityNarrows({ ...base, repositoryAccess: 'declared-paths' }, base, { edge }),
    { code: 'E_SKILL_AUTHORITY_WIDENED' },
  );
});
