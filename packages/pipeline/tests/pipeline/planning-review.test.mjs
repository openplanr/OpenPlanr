import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { decidePlanReview, preparePlanReviewOwnerDecision } from '../../lib/pipeline/engine.mjs';
import {
  advancePlanReview,
  getShipClosure,
  preparePlanReview,
  startPlanReview,
  startShip,
} from '../../lib/pipeline/index.mjs';
import { issuePlanningReviewOwnerDecisionCapability } from '../../lib/pipeline/planning-review.mjs';
import { sha256Jcs } from '../../lib/protocol/jcs.mjs';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture({ professional = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'planr-planning-review-'));
  mkdirSync(join(root, '.planr', 'specs', 'SPEC-001-professional', 'stories'), { recursive: true });
  mkdirSync(join(root, '.planr', 'specs', 'SPEC-001-professional', 'tasks'), { recursive: true });
  mkdirSync(join(root, 'input', 'tech'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(
    join(root, '.planr', 'config.json'),
    `${JSON.stringify({ idPrefix: { spec: 'SPEC' } }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, 'input', 'tech', 'stack.md'),
    '# Stack\nBuildCommand: "node --check src/app.js"\nTestCommand: "node --test tests/smoke.test.mjs"\n',
  );
  writeFileSync(join(root, 'src', 'app.js'), 'export const value = 1;\n');
  writeFileSync(
    join(root, 'tests', 'smoke.test.mjs'),
    "import test from 'node:test'; test('ok',()=>{});\n",
  );
  const specDir = join(root, '.planr', 'specs', 'SPEC-001-professional');
  writeFileSync(
    join(specDir, 'SPEC-001-professional.md'),
    [
      '---',
      'id: "SPEC-001"',
      'title: "Professional plan"',
      'slug: "professional"',
      'schemaVersion: "1.0.0"',
      'status: "ready-for-pipeline"',
      'priority: "P1"',
      'created: "2026-08-24"',
      'updated: "2026-08-24"',
      'ui_files: []',
      'tech_dependencies: []',
      ...(professional
        ? ['specificationContract: "professional-specification@1.0.0"', 'review_specialists: []']
        : []),
      '---',
      '',
      '# SPEC-001: Professional plan',
      '',
      '## Audience',
      '',
      '- Primary: Release owners',
      '- Engineering and design teams',
      '',
      '## Outcome & Measurement',
      '',
      '- Outcome: Delivery begins only from reviewed scope',
      '- Measure: invalid starts rejected',
      '- Target: 100 percent',
      '- Timeframe: every SHIP start',
      '',
      '## Constraints',
      '',
      '- Preserve historical receipts',
      '',
      '## Evidence Expectations',
      '',
      '- A receipt hash and exact plan digest',
      '',
      '## Failure Modes',
      '',
      '- A stale receipt attempts to certify changed scope',
      '',
      '## Rollback',
      '',
      '- Trigger: admission regression',
      '- Strategy: disable new starts',
      '- Verification: legacy receipts remain readable',
      '',
      '## Scope Boundaries',
      '',
      '### In Scope',
      '',
      '- Planning review and SHIP admission',
      '',
      '### Out of Scope',
      '',
      '- Publication and deployment',
      '',
      '## Acceptance Criteria',
      '',
      '- [ ] Given a reviewed plan, when SHIP starts, then the exact receipt is required',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(specDir, 'stories', 'US-001-review.md'),
    '---\nid: "US-001"\nstatus: "pending"\nupdated: "2026-08-24"\n---\n\n# Review\n',
  );
  writeFileSync(
    join(specDir, 'stories', 'US-001-gherkin.feature'),
    'Feature: Review\n Scenario: Bound\n  Given scope\n  When reviewed\n  Then bound\n',
  );
  writeFileSync(
    join(specDir, 'tasks', 'T-001-review.md'),
    '---\nid: "T-001"\nstoryId: "US-001"\nstatus: "pending"\nupdated: "2026-08-24"\ndependsOn: []\npreserve: []\n---\n\n## Definition of Done\n- [ ] Bound\n',
  );
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline');
  return { root, specDir };
}

function reviewClosed(summary, findings = []) {
  return {
    type: 'review.closed',
    expectedGeneration: summary.generation,
    phase: 'initial',
    candidateRevision: 1,
    candidateDigest: summary.planDigest,
    reviewerIds: summary.reviewerRoster,
    contributions: summary.reviewerRoster.map((reviewerId) => ({
      reviewerId,
      reviewerVersion: '1.0.0',
      summary: `${reviewerId} completed review.`,
      evidenceDigest: sha256Jcs({ reviewerId }),
    })),
    findings,
    dissent: [],
    reviewedFindingIds: [],
    summary: 'Consolidated initial review.',
  };
}

function approve(summary) {
  return {
    type: 'owner.decided',
    expectedGeneration: summary.generation,
    ownerId: 'owner-12345678',
    decision: 'approved',
    reason: 'The exact reviewed scope is approved.',
    candidateRevision: summary.candidateRevision,
    planDigest: summary.planDigest,
  };
}

function ownerCapability(
  root,
  summary,
  {
    decision = 'approved',
    ownerId = 'owner-12345678',
    reason = 'The exact reviewed scope is approved.',
  } = {},
) {
  const preview = preparePlanReviewOwnerDecision({
    projectRoot: root,
    feature: 'professional',
    runId: summary.runId,
  });
  return issuePlanningReviewOwnerDecisionCapability({
    runId: summary.runId,
    expectedGeneration: preview.generation,
    ownerId,
    decision,
    reason,
    candidateRevision: preview.candidateRevision,
    planDigest: preview.planDigest,
  });
}

function decide(root, summary, options = {}) {
  const capability = ownerCapability(root, summary, options);
  return {
    capability,
    summary: decidePlanReview({
      projectRoot: root,
      feature: 'professional',
      runId: summary.runId,
      capability,
    }),
  };
}

function blockingFinding() {
  return {
    id: null,
    severity: 'P1',
    basis: 'acceptance',
    title: 'Scope is not decision complete',
    evidence: 'The reviewed acceptance statement leaves one bounded outcome unresolved.',
    artifactRefs: ['SPEC-001', 'T-001'],
    acceptanceRefs: ['AC-1'],
    disposition: 'open',
  };
}

test('professional plan review issues one immutable content-addressed PASS receipt and exact replay is idempotent', () => {
  const { root, specDir } = fixture();
  const prepared = preparePlanReview({ projectRoot: root, feature: 'professional' });
  assert.match(prepared.planDigest, /^sha256:/);
  let summary = startPlanReview({
    projectRoot: root,
    feature: 'professional',
    runtime: 'codex',
    runId: 'prr_11111111111111111111111111111111',
  });
  summary = advancePlanReview({
    projectRoot: root,
    feature: 'professional',
    runId: summary.runId,
    event: reviewClosed(summary),
  });
  assert.equal(summary.state, 'awaiting_owner');
  const ownerEvent = approve(summary);
  assert.throws(
    () =>
      advancePlanReview({
        projectRoot: root,
        feature: 'professional',
        runId: summary.runId,
        event: ownerEvent,
      }),
    { code: 'E_PLAN_REVIEW_OWNER_BOUNDARY_REQUIRED' },
  );
  const decision = decide(root, summary);
  summary = decision.summary;
  assert.equal(summary.state, 'passed');
  const path = join(specDir, '.plan-review', 'receipts', `${summary.receiptHash.slice(7)}.json`);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).receiptHash, summary.receiptHash);
  const replay = decidePlanReview({
    projectRoot: root,
    feature: 'professional',
    runId: summary.runId,
    capability: decision.capability,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.receiptHash, summary.receiptHash);
});

test('SHIP starts professional scope without a receipt and preserves optional legacy receipt binding', () => {
  const direct = fixture();
  const directShip = startShip({
    projectRoot: direct.root,
    feature: 'professional',
    runtime: 'codex',
  });
  assert.equal(
    getShipClosure({ projectRoot: direct.root, feature: 'professional', runId: directShip.runId })
      .schemaVersion,
    '1.0.0',
  );
  assert.equal(existsSync(join(direct.specDir, '.ship')), true);

  const { root, specDir } = fixture();
  let review = startPlanReview({ projectRoot: root, feature: 'professional', runtime: 'codex' });
  review = advancePlanReview({
    projectRoot: root,
    feature: 'professional',
    runId: review.runId,
    event: reviewClosed(review),
  });
  review = decide(root, review).summary;
  assert.equal(existsSync(join(specDir, '.ship')), false);
  const ship = startShip({
    projectRoot: root,
    feature: 'professional',
    runtime: 'codex',
    planningReviewReceiptHash: review.receiptHash,
  });
  const closure = getShipClosure({ projectRoot: root, feature: 'professional', runId: ship.runId });
  assert.equal(closure.schemaVersion, '1.2.0');
  assert.equal(closure.planningReview.receiptHash, review.receiptHash);
  assert.deepEqual(closure.riskClassification.reviewerRoster, ['qa-agent']);

  const changed = fixture();
  let changedReview = startPlanReview({
    projectRoot: changed.root,
    feature: 'professional',
    runtime: 'codex',
  });
  changedReview = advancePlanReview({
    projectRoot: changed.root,
    feature: 'professional',
    runId: changedReview.runId,
    event: reviewClosed(changedReview),
  });
  changedReview = decide(changed.root, changedReview).summary;
  writeFileSync(
    join(changed.specDir, 'tasks', 'T-001-review.md'),
    `${readFileSync(join(changed.specDir, 'tasks', 'T-001-review.md'), 'utf8')}\nChanged reviewed scope.\n`,
  );
  assert.throws(
    () =>
      startShip({
        projectRoot: changed.root,
        feature: 'professional',
        runtime: 'codex',
        planningReviewReceiptHash: changedReview.receiptHash,
      }),
    { code: 'E_PLAN_REVIEW_STALE' },
  );
  assert.equal(existsSync(join(changed.specDir, '.ship')), false);
});

test('legacy unmarked scope remains readable through schema 1.0 compatibility', () => {
  const { root } = fixture({ professional: false });
  const ship = startShip({ projectRoot: root, feature: 'professional', runtime: 'codex' });
  assert.equal(
    getShipClosure({ projectRoot: root, feature: 'professional', runId: ship.runId }).schemaVersion,
    '1.0.0',
  );
});

test('one correction and one targeted review are the hard ceiling, and private evidence fails without mutation', () => {
  const { root, specDir } = fixture();
  let summary = startPlanReview({ projectRoot: root, feature: 'professional', runtime: 'codex' });
  const unsafe = reviewClosed(summary, [
    {
      ...blockingFinding(),
      evidence: '/Users/private/account/work/project/secret.txt exposes private custody.',
    },
  ]);
  assert.throws(
    () =>
      advancePlanReview({
        projectRoot: root,
        feature: 'professional',
        runId: summary.runId,
        event: unsafe,
      }),
    { code: 'E_PLAN_REVIEW_PRIVATE_DATA' },
  );
  assert.equal(
    preparePlanReview({ projectRoot: root, feature: 'professional' }).activeRunIds.length,
    1,
  );

  summary = advancePlanReview({
    projectRoot: root,
    feature: 'professional',
    runId: summary.runId,
    event: reviewClosed(summary, [blockingFinding()]),
  });
  assert.equal(summary.state, 'correction_required');
  const original = summary.latestFindings[0];
  const specPath = join(specDir, 'SPEC-001-professional.md');
  writeFileSync(
    specPath,
    `${readFileSync(specPath, 'utf8')}\nCorrection clarifies the exact reviewed boundary.\n`,
  );
  const corrected = preparePlanReview({ projectRoot: root, feature: 'professional' });
  summary = advancePlanReview({
    projectRoot: root,
    feature: 'professional',
    runId: summary.runId,
    event: {
      type: 'correction.registered',
      expectedGeneration: summary.generation,
      expectedPlanDigest: corrected.planDigest,
      summary: 'Clarify the bounded acceptance outcome.',
      findingIds: [original.id],
    },
  });
  assert.equal(summary.state, 'reviewing_targeted');
  const targeted = {
    ...reviewClosed(summary),
    phase: 'targeted',
    candidateRevision: 2,
    candidateDigest: summary.planDigest,
    reviewedFindingIds: [original.id],
    findings: [{ ...original, disposition: 'resolved' }],
    summary: 'The exact blocker is resolved.',
  };
  summary = advancePlanReview({
    projectRoot: root,
    feature: 'professional',
    runId: summary.runId,
    event: targeted,
  });
  assert.equal(summary.state, 'awaiting_owner');
  assert.throws(
    () =>
      advancePlanReview({
        projectRoot: root,
        feature: 'professional',
        runId: summary.runId,
        event: {
          type: 'correction.registered',
          expectedGeneration: summary.generation,
          expectedPlanDigest: summary.planDigest,
          summary: 'Second correction.',
          findingIds: [original.id],
        },
      }),
    { code: 'E_PLAN_REVIEW_TRANSITION_INVALID' },
  );
});

test('owner PASS requires an engine-issued exact capability and rejects forged, foreign, or stale authority without mutation', () => {
  const { root, specDir } = fixture();
  let summary = startPlanReview({ projectRoot: root, feature: 'professional', runtime: 'codex' });
  summary = advancePlanReview({
    projectRoot: root,
    feature: 'professional',
    runId: summary.runId,
    event: reviewClosed(summary),
  });
  const activePath = join(specDir, '.plan-review', 'active', `${summary.runId}.json`);
  const before = readFileSync(activePath, 'utf8');

  const valid = ownerCapability(root, summary);
  assert.throws(
    () =>
      decidePlanReview({
        projectRoot: root,
        feature: 'professional',
        runId: summary.runId,
        capability: structuredClone(valid),
      }),
    { code: 'E_PLAN_REVIEW_OWNER_AUTHORITY_REQUIRED' },
  );
  const foreign = issuePlanningReviewOwnerDecisionCapability({
    runId: `prr_${'f'.repeat(32)}`,
    expectedGeneration: summary.generation,
    ownerId: 'owner-12345678',
    decision: 'approved',
    reason: 'The exact reviewed scope is approved.',
    candidateRevision: summary.candidateRevision,
    planDigest: summary.planDigest,
  });
  assert.throws(
    () =>
      decidePlanReview({
        projectRoot: root,
        feature: 'professional',
        runId: summary.runId,
        capability: foreign,
      }),
    { code: 'E_PLAN_REVIEW_OWNER_AUTHORITY_FOREIGN' },
  );
  const stale = issuePlanningReviewOwnerDecisionCapability({
    runId: summary.runId,
    expectedGeneration: summary.generation - 1,
    ownerId: 'owner-12345678',
    decision: 'approved',
    reason: 'The exact reviewed scope is approved.',
    candidateRevision: summary.candidateRevision,
    planDigest: summary.planDigest,
  });
  assert.throws(
    () =>
      decidePlanReview({
        projectRoot: root,
        feature: 'professional',
        runId: summary.runId,
        capability: stale,
      }),
    { code: 'E_PLAN_REVIEW_OWNER_AUTHORITY_FOREIGN' },
  );
  assert.equal(readFileSync(activePath, 'utf8'), before);
  assert.equal(existsSync(join(specDir, '.plan-review', 'receipts')), true);
  assert.equal(
    JSON.stringify(preparePlanReview({ projectRoot: root, feature: 'professional' }).terminal),
    '[]',
  );

  summary = decidePlanReview({
    projectRoot: root,
    feature: 'professional',
    runId: summary.runId,
    capability: valid,
  });
  assert.equal(summary.state, 'passed');
});
