import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildUnresolvableCitationGap,
  resolveOperatingCitation,
  validateOperatingCitation,
} from '../../lib/operate/citation.mjs';
import { assertProtocolArtifact } from '../../lib/protocol/contracts.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureDir = join(packageRoot, 'conformance', 'fixtures', 'operating-board');
const readFixture = (name) => JSON.parse(readFileSync(join(fixtureDir, name), 'utf8'));

const REVISION = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const GAP_ID_PATTERN = /^GAP-[A-Za-z0-9._-]+$/;
const EVIDENCE_ID_PATTERN = /^EVD-[A-Za-z0-9._-]+$/;

// Canonical operating-citation@1.3.0 anchors: exactly one locator, bound to
// pinnedRevision. These mirror the T-001 fixtures under
// conformance/fixtures/operating-board/citation-*.json.
function repoPathCitation(overrides = {}) {
  return {
    citationKey: 'cto-payment-idempotency-1',
    repositoryPath: 'lib/operate/reducer.mjs',
    lineRange: { start: 10, end: 42 },
    pinnedRevision: REVISION,
    ...overrides,
  };
}

function gitRevisionCitation(overrides = {}) {
  return {
    citationKey: 'cto-git-revision-1',
    gitRevision: REVISION,
    pinnedRevision: REVISION,
    ...overrides,
  };
}

function planrArtifactCitation(overrides = {}) {
  return {
    citationKey: 'cto-planr-artifact-1',
    planrArtifactId: 'SPEC-004',
    pinnedRevision: REVISION,
    ...overrides,
  };
}

const ALL_FACTS_TRUE = Object.freeze({
  pathExistsAtRevision: true,
  lineRangeInBounds: true,
  revisionIsCurrent: true,
  artifactExists: true,
});

test('each citation kind validates with pinnedRevision and fails without it', () => {
  for (const factory of [repoPathCitation, gitRevisionCitation, planrArtifactCitation]) {
    const citation = factory();
    assert.equal(validateOperatingCitation(citation), citation);

    const { pinnedRevision, ...withoutPinned } = citation;
    assert.throws(
      () => validateOperatingCitation(withoutPinned),
      (error) => error.code === 'E_OPERATE_CITATION_INVALID' && /pinnedRevision/.test(error.message),
    );
  }
});

test('a fabricated path rejects the proposal as fabricated-path', () => {
  const outcome = resolveOperatingCitation(repoPathCitation(), {
    ...ALL_FACTS_TRUE,
    pathExistsAtRevision: false,
  });
  assert.equal(outcome.outcome, 'rejected');
  assert.equal(outcome.reason, 'fabricated-path');
  assert.match(outcome.gapId, GAP_ID_PATTERN);
  assert.equal(outcome.evidenceId, undefined);
});

test('an out-of-bounds line range rejects as wrong-line-range when the path exists', () => {
  const outcome = resolveOperatingCitation(repoPathCitation(), {
    ...ALL_FACTS_TRUE,
    pathExistsAtRevision: true,
    lineRangeInBounds: false,
  });
  assert.equal(outcome.outcome, 'rejected');
  assert.equal(outcome.reason, 'wrong-line-range');
  assert.match(outcome.gapId, GAP_ID_PATTERN);
});

test('a stale revision rejects as stale-revision only when path and line range are both fine', () => {
  const stale = resolveOperatingCitation(repoPathCitation(), {
    ...ALL_FACTS_TRUE,
    pathExistsAtRevision: true,
    lineRangeInBounds: true,
    revisionIsCurrent: false,
  });
  assert.equal(stale.outcome, 'rejected');
  assert.equal(stale.reason, 'stale-revision');
  assert.match(stale.gapId, GAP_ID_PATTERN);

  // Precedence: a missing path outranks a stale revision.
  const pathWins = resolveOperatingCitation(repoPathCitation(), {
    ...ALL_FACTS_TRUE,
    pathExistsAtRevision: false,
    revisionIsCurrent: false,
  });
  assert.equal(pathWins.reason, 'fabricated-path');

  // Precedence: a wrong line range outranks a stale revision.
  const lineWins = resolveOperatingCitation(repoPathCitation(), {
    ...ALL_FACTS_TRUE,
    pathExistsAtRevision: true,
    lineRangeInBounds: false,
    revisionIsCurrent: false,
  });
  assert.equal(lineWins.reason, 'wrong-line-range');

  // A git-revision citation with a stale revision also rejects as stale-revision.
  const gitStale = resolveOperatingCitation(gitRevisionCitation(), {
    ...ALL_FACTS_TRUE,
    revisionIsCurrent: false,
  });
  assert.equal(gitStale.reason, 'stale-revision');
});

test('an unresolvable planr artifact rejects as unresolvable', () => {
  const outcome = resolveOperatingCitation(planrArtifactCitation(), {
    ...ALL_FACTS_TRUE,
    artifactExists: false,
  });
  assert.equal(outcome.outcome, 'rejected');
  assert.equal(outcome.reason, 'unresolvable');
  assert.match(outcome.gapId, GAP_ID_PATTERN);
});

test('a fully-true facts object resolves with a stable, reproducible snapshot binding', () => {
  const citation = repoPathCitation();
  const first = resolveOperatingCitation(citation, ALL_FACTS_TRUE);
  const second = resolveOperatingCitation(repoPathCitation(), { ...ALL_FACTS_TRUE });

  assert.equal(first.outcome, 'resolved');
  assert.equal(first.citationKey, citation.citationKey);
  assert.match(first.evidenceId, EVIDENCE_ID_PATTERN);
  assert.match(first.snapshotDigest, /^sha256:[a-f0-9]{64}$/);
  // Deterministic and reproducible from identical inputs.
  assert.deepEqual(first, second);
  assert.equal(first.evidenceId, second.evidenceId);
  assert.equal(first.snapshotDigest, second.snapshotDigest);

  // Different facts produce a different snapshot binding.
  const differentFacts = resolveOperatingCitation(gitRevisionCitation(), ALL_FACTS_TRUE);
  assert.notEqual(differentFacts.snapshotDigest, first.snapshotDigest);
});

test('declared snapshot sensitivity/classification bind into the resolved snapshot digest', () => {
  // The canonical resolution envelope carries no sensitivity field, but the
  // snapshot binding must be sensitivity-aware so the evidence record minted
  // under evidenceId (and the redaction/secret-scan pipeline over it) is
  // deterministic and tamper-evident. Changing declared sensitivity/classification
  // therefore changes the snapshot binding.
  const internal = resolveOperatingCitation(repoPathCitation(), {
    ...ALL_FACTS_TRUE,
    sensitivity: 'internal',
    classification: 'source-code',
  });
  const confidential = resolveOperatingCitation(repoPathCitation(), {
    ...ALL_FACTS_TRUE,
    sensitivity: 'confidential',
    classification: 'secret-config',
  });
  assert.equal(internal.outcome, 'resolved');
  assert.equal(confidential.outcome, 'resolved');
  assert.notEqual(internal.snapshotDigest, confidential.snapshotDigest);
  assert.notEqual(internal.evidenceId, confidential.evidenceId);
});

test('no citation with an unresolvable component reaches a resolved outcome', () => {
  const factsMatrix = [
    { pathExistsAtRevision: false, lineRangeInBounds: true, revisionIsCurrent: true, artifactExists: true },
    { pathExistsAtRevision: true, lineRangeInBounds: false, revisionIsCurrent: true, artifactExists: true },
    { pathExistsAtRevision: true, lineRangeInBounds: true, revisionIsCurrent: false, artifactExists: true },
    {}, // fully missing facts must fail closed
  ];
  for (const facts of factsMatrix) {
    const outcome = resolveOperatingCitation(repoPathCitation(), facts);
    assert.equal(outcome.outcome, 'rejected');
    assert.match(outcome.gapId, GAP_ID_PATTERN);
  }
});

test('a produced citation validates against the canonical operating-citation@1.3.0 contract', () => {
  for (const factory of [repoPathCitation, gitRevisionCitation, planrArtifactCitation]) {
    const citation = factory();
    validateOperatingCitation(citation);
    assert.doesNotThrow(() =>
      assertProtocolArtifact('operating-citation', citation, { protocolVersion: '1.3.0' }));
  }

  // The T-001 canonical fixtures are directly usable by this module.
  const fixture = readFixture('citation-valid.json');
  assert.equal(validateOperatingCitation(fixture), fixture);
  const resolved = resolveOperatingCitation(fixture, ALL_FACTS_TRUE);
  assert.equal(resolved.outcome, 'resolved');
  assert.equal(resolved.citationKey, fixture.citationKey);
});

test('a produced resolution validates against the canonical operating-citation-resolution@1.3.0 contract', () => {
  const resolved = resolveOperatingCitation(repoPathCitation(), ALL_FACTS_TRUE);
  assert.equal(resolved.outcome, 'resolved');
  assert.doesNotThrow(() =>
    assertProtocolArtifact('operating-citation-resolution', resolved, { protocolVersion: '1.3.0' }));

  const rejected = resolveOperatingCitation(repoPathCitation(), {
    ...ALL_FACTS_TRUE,
    pathExistsAtRevision: false,
  });
  assert.equal(rejected.outcome, 'rejected');
  assert.doesNotThrow(() =>
    assertProtocolArtifact('operating-citation-resolution', rejected, { protocolVersion: '1.3.0' }));
});

test('a produced citation embeds in an operating-advisor-response@1.3.0 citations[] and validates end-to-end', () => {
  const citation = repoPathCitation();
  validateOperatingCitation(citation);

  const response = {
    outcome: 'proposals',
    proposals: [
      {
        proposalKey: 'cto-idempotency-hardening',
        type: 'finding',
        title: 'Charge path is not idempotent under retry',
        problem: 'A retried charge can double-bill because the handler lacks an idempotency key.',
        proposal: 'Add an idempotency key keyed on the client request id before the ledger write.',
        impact: 4,
        confidence: 4,
        ease: 3,
        severity: 'high',
        citations: [citation],
      },
    ],
    gaps: [],
    conflicts: [],
  };

  assert.doesNotThrow(() =>
    assertProtocolArtifact('operating-advisor-response', response, { protocolVersion: '1.3.0' }));
});

test('buildUnresolvableCitationGap emits a v1.3 unresolvable-citation gap for the gap.open payload', () => {
  const citation = repoPathCitation();
  const rejection = resolveOperatingCitation(citation, {
    ...ALL_FACTS_TRUE,
    pathExistsAtRevision: false,
  });
  const context = {
    cycleId: 'CYCLE-011',
    createdAt: '2026-07-30T12:00:00Z',
    owner: 'technology-risk',
    affectedRoles: ['technology-risk'],
  };
  const gap = buildUnresolvableCitationGap(citation, rejection, context);

  assert.equal(gap.kind, 'operating-data-gap');
  assert.equal(gap.protocolVersion, '1.3.0');
  assert.equal(gap.category, 'unresolvable-citation');
  assert.equal(gap.id, rejection.gapId);
  assert.match(gap.id, GAP_ID_PATTERN);
  assert.equal(gap.cycleId, 'CYCLE-011');
  assert.equal(gap.reason, 'fabricated-path');
  assert.equal(gap.status, 'open');
  assert.equal(gap.owner, 'technology-risk');
  assert.deepEqual(gap.affectedRoles, ['technology-risk']);
  assert.deepEqual(gap.evidenceRefs, []);
  assert.equal(gap.createdAt, '2026-07-30T12:00:00Z');
  assert.equal(gap.updatedAt, '2026-07-30T12:00:00Z');
  assert.ok(gap.question.length > 0);

  // The produced gap is a valid canonical operating-data-gap@1.3.0 record.
  assert.doesNotThrow(() =>
    assertProtocolArtifact('operating-data-gap', gap, { protocolVersion: '1.3.0' }));

  // Deterministic: identical inputs reproduce the identical gap record.
  assert.deepEqual(buildUnresolvableCitationGap(repoPathCitation(), rejection, context), gap);
});

test('buildUnresolvableCitationGap refuses a non-rejected outcome', () => {
  const citation = planrArtifactCitation();
  const resolved = resolveOperatingCitation(citation, ALL_FACTS_TRUE);
  assert.throws(
    () => buildUnresolvableCitationGap(citation, resolved, {
      cycleId: 'CYCLE-011',
      createdAt: '2026-07-30T12:00:00Z',
    }),
    (error) => error.code === 'E_OPERATE_CITATION_INVALID',
  );
});
