import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  analyzeSkillGraphImpact,
  assessLearningPromotion,
  assessVersionChange,
  assessVersionSet,
  createLearningProposal,
  planSkillGraphRollback,
} from '../../packages/skill-runtime/src/versioning/index.mjs';

const root = new URL('../..', import.meta.url).pathname;

test('source, module, host, skill, and asset versions follow independent policies', () => {
  const report = assessVersionSet([
    { dimension: 'source', changeKind: 'none', previousVersion: '1.0.0', nextVersion: '1.0.0' },
    { dimension: 'module', changeKind: 'editorial', previousVersion: '2.0.0', nextVersion: '2.0.1' },
    { dimension: 'host-profile', changeKind: 'compatible', previousVersion: '1.0.0', nextVersion: '1.1.0' },
    { dimension: 'skill', changeKind: 'behavior', previousVersion: '2.0.0', nextVersion: '2.1.0' },
    { dimension: 'asset', changeKind: 'compatible', previousVersion: '1.0.0', nextVersion: '1.0.1' },
  ]);
  assert.equal(report.complete, true);
  assert.equal(report.passed, true);
  const invalid = assessVersionChange({
    dimension: 'skill',
    changeKind: 'breaking',
    previousVersion: '2.0.0',
    nextVersion: '2.1.0',
  });
  assert.equal(invalid.pass, false);
  assert.equal(invalid.reason, 'version-bump-too-small');
});

test('impact analysis closes over standard-package resources and generated assets', () => {
  const report = analyzeSkillGraphImpact({
    repoRoot: root,
    changes: [
      { kind: 'module', id: 'operate-advisor-contract' },
      { kind: 'host-profile', source: 'shared/profiles/codex.md' },
    ],
  });
  const advisor = report.changes[0];
  assert.deepEqual(advisor.affectedSkills, [
    'planr-ceo-review',
    'planr-cmo-review',
    'planr-coo-review',
    'planr-cpo-review',
    'planr-cto-review',
  ]);
  assert.deepEqual(report.changes[1].affectedSkills, []);
  assert.deepEqual(report.affectedSkills, advisor.affectedSkills);
  assert.ok(advisor.generatedAssets.includes('dist/plugins/claude/openplanr/skills/ceo-review/SKILL.md'));
  assert.ok(advisor.generatedAssets.includes('dist/plugins/openai/openplanr/skills/ceo-review/SKILL.md'));
  assert.ok(advisor.generatedAssets.includes('adapters/manifests/generated-assets.json'));
});

test('rollback is scoped to affected families and leaves unrelated skills named', () => {
  const impact = analyzeSkillGraphImpact({
    repoRoot: root,
    changes: [{ kind: 'module', id: 'operate-advisor-contract' }],
  });
  const rollback = planSkillGraphRollback({
    impactReport: impact,
    previousVersions: { 'module:operate-advisor-contract': '1.0.0' },
  });
  assert.equal(rollback.scope, 'affected-family-only');
  assert.equal(rollback.changes[0].affectedSkills.length, 5);
  assert.equal(
    rollback.unaffectedSkills.length,
    impact.allSkills.length - impact.affectedSkills.length,
  );
  assert.ok(rollback.unaffectedSkills.includes('planr-ship'));
});

test('local learning stays a redacted proposal until review and evaluation', () => {
  const sourcePath = new URL('../../skills/planr-plan/SKILL.md', import.meta.url);
  const before = readFileSync(sourcePath, 'utf8');
  const proposal = createLearningProposal({
    proposalId: 'SLP-001',
    skillId: 'planr-plan',
    createdAt: '2026-08-31T00:00:00Z',
    summary: 'Prefer repository-native naming',
    observation: 'A project used an unfamiliar term; api_key=super-secret-value',
    suggestedChange: 'Add one discriminatory trigger example',
  });
  assert.equal(proposal.sourceMutation, false);
  assert.equal(proposal.status, 'proposed');
  assert.match(proposal.observation, /\[redacted\]/u);
  assert.equal(readFileSync(sourcePath, 'utf8'), before);

  const pending = assessLearningPromotion({ proposal, review: null, evaluation: { passed: true } });
  assert.equal(pending.eligible, false);
  const eligible = assessLearningPromotion({
    proposal,
    review: { status: 'accepted', reviewedBy: 'maintainer' },
    evaluation: { passed: true },
  });
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.sourceMutation, false);
  assert.equal(readFileSync(sourcePath, 'utf8'), before);
});
