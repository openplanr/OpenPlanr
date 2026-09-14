import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  OPERATE_ADVISOR_REVIEW_RUBRICS,
  OPERATE_REVIEW_CONTRACT,
  OPERATE_REVIEW_CONTRACT_V1,
  OPERATE_REVIEW_CONTRACT_V2,
  OPERATE_REVIEW_CONTRACTS,
  OPERATE_REVIEW_NOTE_PROFILES,
  SkillRuntimeError,
  detectOperateReviewNoteContract,
  inspectOperateReviewNote,
  validateOperateReviewNote,
} from '../../packages/skill-runtime/src/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const advisor = `# CTO review — technology-risk

> **Contract:** operate-review-quality-contract@2.0.0
> **Signal:** action
> **Bottom line:** The release path has no demonstrated rollback rehearsal.

## Findings

### F1 — Rollback has not been rehearsed
- **Priority:** P0
- **Status:** observed
- **Why it matters:** A failed release could extend customer impact.
- **Sources:** \`docs/release.md:18\`, \`.github/workflows/release.yml:42\`
- **Confidence:** high — both sources describe the current path
- **Decision impact:** changes whether the next release is ready

## Recommended next move

- **Recommendation:** Rehearse rollback before the next release.
- **Suggested owner:** delivery lead
- **First step:** Run one staging rollback rehearsal.
- **Expected result:** The service returns to the previous version without data loss.
- **Check:** Confirm restored health and data consistency.
- **Revisit when:** The release workflow or recovery mechanism changes.

## Decision-changing gaps

None.

## Sources consulted

- \`docs/release.md\` — release and recovery expectations.
- \`.github/workflows/release.yml\` — current automated release path.
`;

const legacyAdvisor = `# CTO review — technology-risk

> **Signal:** action
> **Bottom line:** The release path has no demonstrated rollback rehearsal.

## Findings

### F1 — Rollback has not been rehearsed
- **Priority:** P0
- **Status:** observed
- **Why it matters:** A failed release could extend customer impact.
- **Evidence:** \`docs/release.md:18\`, \`.github/workflows/release.yml:42\`
- **Confidence:** high — both sources describe the current path
- **Decision implication:** changes whether the next release is ready

## Recommended next move

- **Recommendation:** Rehearse rollback before the next release.
- **Proposed owner:** delivery lead
- **First step:** Run one staging rollback rehearsal.
- **Expected result:** The service returns to the previous version without data loss.
- **Verification:** Confirm restored health and data consistency.
- **Reversible / revisit when:** The release workflow or recovery mechanism changes.
- **Evidence:** \`docs/release.md:18\`

## Decision-changing gaps

None.

## Evidence index

- \`docs/release.md\` — release and recovery expectations.

## Review coverage

- **Questions answered:** rollback readiness
- **Questions not established:** failure frequency
- **Evidence boundary:** current repository snapshot

## Audit note

Read-only review of the current repository snapshot.
`;

const legacyBoardReport = `# Operating board report — release readiness

## Scope and custody

- **Subject:** release readiness
- **Evidence window:** current snapshot
- **Pending decision:** whether to accept the next release candidate
- **Cycle owner:** Asem
- **Custody:** local-only

## Executive call

The available evidence does not establish a decision-ready proposal.

## Decision queue

No decision-ready proposal was established.

## Action plan

No proposed actions.

## Material risks and dissent

None.

## Decision-changing gaps

None.

## Review trail

| Lens | Outcome |
|---|---|
| CTO | reported |

## Human gate

Close this cycle or supply evidence for another review.
`;

const legacyChallenger = `# Challenger review — independent-challenge

> **Verdict:** holds
> **Bottom line:** No material exception was established.

## Material exceptions

No material exception found.

## Decisions that still hold

- Rehearse rollback before release.

## Material dissent

- **Dissent:** None.
- **Resolution condition:** Not applicable.

## Decision-changing gaps

None.

## Audit note

Reviewed the available advisor notes.
`;

const legacyChair = `# Chair synthesis — release readiness

> **Overall signal:** act now
> **Executive call:** Rehearse rollback before accepting the release candidate.

## Decision queue

### D1 — [P0] Rehearse rollback before release
- **Recommendation:** Require one successful rehearsal before release.
- **Why now:** Recovery has not been observed.
- **Owner:** Asem
- **Confidence:** medium — recovery policy exists but execution is unproven
- **Alternative:** Release now and accept uncertain recovery time.
- **First step:** Run the staging rollback rehearsal.
- **Expected result:** The previous version and healthy service state are restored.
- **Verification:** Confirm service health and data consistency.
- **Dependencies:** none
- **Reversible / revisit when:** Recovery behavior or the release workflow changes.
- **Evidence:** \`cto.md#F1\`
- **Dissent:** none

## Action plan

| ID | Priority | Action | Owner | First step | Success measure | Verification | Depends on |
|---|---|---|---|---|---|---|---|
| A1 | P0 | Rehearse rollback | Asem | Run staging rollback | Healthy prior version | Check health and data | D1 |

## Material risks and dissent

None.

## Decision-changing gaps

None.

## Review trail

| Lens | Outcome |
|---|---|
| CTO | reported |

## Evidence index

- \`cto.md#F1\`

## Human gate

Asem may adopt, reject, or defer D1 with a reason.
`;

const challenger = `# Challenger review — independent-challenge

> **Contract:** operate-review-quality-contract@2.0.0
> **Verdict:** holds with exceptions
> **Bottom line:** The recommendation is useful, but its confidence should be lower.

## Material exceptions

### X1 — Failure likelihood is not established
- **Target:** \`cto.md#F1\`
- **Type:** overconfident
- **Decision impact:** changes the urgency, not the value, of a rehearsal
- **Challenge:** The sources show no rehearsal but do not establish failure frequency.
- **Sources:** \`cto.md#F1\`, \`docs/release.md:18\`
- **Resolution:** Run one rehearsal and record the observed recovery behavior.

## Decisions that still hold

- Rehearse rollback before release (\`cto.md#Recommended next move\`).

## Risks and dissent

- **Dissent:** The missing rehearsal does not by itself require cancelling the release.
- **Resolution condition:** A failed rehearsal would make postponement the safer option.

## Decision-changing gaps

None.
`;

const chair = `# Chair synthesis — release readiness

> **Contract:** operate-review-quality-contract@2.0.0
> **Overall signal:** act now
> **Executive call:** Rehearse rollback before accepting the next release candidate.

## Decision queue

### D1 — [P0] Rehearse rollback before release
- **Recommendation:** Require one successful rehearsal before release.
- **Why now:** The current path has no observed recovery result.
- **Suggested owner:** delivery lead
- **Confidence:** medium — policy is clear but failure likelihood is unknown
- **Alternative:** Release now and accept uncertain recovery time.
- **First step:** Run the staging rollback rehearsal.
- **Expected result:** The previous version and healthy service state are restored.
- **Check:** Confirm service health and data consistency after rollback.
- **Dependencies:** none
- **Revisit when:** Recovery behavior or the release workflow changes.
- **Sources:** \`cto.md#F1\`, \`challenger.md#X1\`, \`docs/release.md:18\`
- **Dissent:** \`challenger.md#X1\`

## Action plan

| ID | Priority | Action | Suggested owner | First step | Success measure | Check | Depends on |
|---|---|---|---|---|---|---|---|
| A1 | P0 | Rehearse rollback | delivery lead | Run staging rollback | Healthy prior version | Check health and data | D1 |

## Risks and dissent

- Challenger X1 lowers confidence because failure frequency is unknown.

## Decision-changing gaps

None.

## Review coverage

| Lens | Outcome | Note | Informed |
|---|---|---|---|
| CTO | reported | \`cto.md\` | D1 |
| Challenger | reported | \`challenger.md\` | D1 |
`;

const boardReport = `# Operating board report — release readiness

> **Contract:** operate-review-quality-contract@2.0.0

## Scope

- **Subject:** release readiness
- **Window:** current snapshot
- **Requested decision:** whether to accept the next release candidate
- **Custody:** local-only

## Executive summary

Act now: rehearse rollback before accepting the next release candidate.

## Decision queue

### D1 — [P0] Rehearse rollback before release
- **Recommendation:** Require one successful rehearsal before release.
- **Why now:** The current path has no observed recovery result.
- **Suggested owner:** unassigned
- **Confidence:** medium — policy is clear but failure likelihood is unknown
- **Alternative:** Release now and accept uncertain recovery time.
- **First step:** Run the staging rollback rehearsal.
- **Expected result:** The previous version and healthy service state are restored.
- **Check:** Confirm service health and data consistency after rollback.
- **Dependencies:** none
- **Revisit when:** Recovery behavior or the release workflow changes.
- **Sources:** \`cto.md#F1\`, \`challenger.md#X1\`, \`docs/release.md:18\`
- **Dissent:** \`challenger.md#X1\`

## Action plan

| ID | Priority | Action | Suggested owner | First step | Success measure | Check | Depends on |
|---|---|---|---|---|---|---|---|
| A1 | P0 | Rehearse rollback | unassigned | Run staging rollback | Healthy prior version | Check health and data | D1 |

## Risks and dissent

- Challenger X1 lowers confidence because failure frequency is unknown.

## Decision-changing gaps

None.

## Review coverage

| Lens | Outcome | Note | Informed |
|---|---|---|---|
| CTO | reported | \`cto.md\` | D1 |
| Challenger | reported | \`challenger.md\` | D1 |

## Issues

None.
`;

const noDecisionBoardReport = boardReport
  .replace(
    /### D1[\s\S]*?(?=## Action plan)/u,
    'No decision-ready proposal was established.\n\n',
  )
  .replace(
    /\| ID \| Priority[\s\S]*?(?=## Risks and dissent)/u,
    'No proposed actions.\n\n',
  );

test('guidance-first advisor, challenger, chair, and board examples satisfy their profiles', () => {
  for (const [profile, note] of [
    ['advisor', advisor],
    ['challenger', challenger],
    ['chair', chair],
    ['board-report', boardReport],
  ]) {
    const result = validateOperateReviewNote(note, { profile });
    assert.equal(result.itemCount, 1);
    assert.equal(result.contractVersion, '2.0.0');
    assert.equal(result.contractKind, 'operate-review-quality-contract');
    assert.equal(result.versionSource, 'declared');
  }
});

test('quality v2 is current while the released v1 contract remains an additive reader', () => {
  assert.equal(OPERATE_REVIEW_CONTRACT.kind, 'operate-review-quality-contract');
  assert.equal(OPERATE_REVIEW_CONTRACT.schemaVersion, '2.0.0');
  assert.equal(OPERATE_REVIEW_CONTRACT, OPERATE_REVIEW_CONTRACT_V2);
  assert.equal(OPERATE_REVIEW_CONTRACT_V1.kind, 'operate-human-review-contract');
  assert.equal(OPERATE_REVIEW_CONTRACT_V1.schemaVersion, '1.0.0');
  assert.deepEqual(Object.keys(OPERATE_REVIEW_CONTRACTS), ['1.0.0', '2.0.0']);
  assert.equal(Object.keys(OPERATE_ADVISOR_REVIEW_RUBRICS).length, 5);
  const serialized = JSON.stringify(OPERATE_REVIEW_NOTE_PROFILES);
  assert.doesNotMatch(serialized, /Human gate|Cycle owner|Evidence index|Audit note|Proposed owner|"Owner"/u);
  assert.match(serialized, /Suggested owner/u);
  assert.match(serialized, /Sources consulted/u);
  assert.match(serialized, /Issues/u);
});

test('legacy v1 notes are detected by structure and remain strictly readable', () => {
  assert.deepEqual(
    detectOperateReviewNoteContract(legacyAdvisor, { profile: 'advisor' }),
    {
      contractVersion: '1.0.0',
      contractKind: 'operate-human-review-contract',
      versionSource: 'structure',
      declaredContractVersion: null,
    },
  );
  const automatic = validateOperateReviewNote(legacyAdvisor, { profile: 'advisor' });
  assert.equal(automatic.contractVersion, '1.0.0');
  assert.equal(automatic.itemCount, 1);

  const selected = validateOperateReviewNote(legacyAdvisor, {
    profile: 'advisor',
    contractVersion: '1.0.0',
  });
  assert.equal(selected.contractVersion, '1.0.0');
  assert.equal(selected.versionSource, 'requested');

  const board = validateOperateReviewNote(legacyBoardReport, { profile: 'board-report' });
  assert.equal(board.contractVersion, '1.0.0');
  assert.equal(board.itemCount, 0);

  assert.equal(
    validateOperateReviewNote(legacyChallenger, { profile: 'challenger' }).contractVersion,
    '1.0.0',
  );
  assert.equal(
    validateOperateReviewNote(legacyChair, { profile: 'chair' }).contractVersion,
    '1.0.0',
  );

  const malformedChair = inspectOperateReviewNote(
    legacyChair.replace(
      'Asem may adopt, reject, or defer D1 with a reason.',
      'Asem may adopt or defer D1.',
    ),
    { profile: 'chair' },
  );
  assert.equal(malformedChair.contractVersion, '1.0.0');
  assert.equal(malformedChair.ok, false);
  assert.deepEqual(malformedChair.diagnostics[0].missing, ['reject', 'reason']);
});

test('contract declarations and explicit selectors expose version drift', () => {
  const result = inspectOperateReviewNote(advisor, {
    profile: 'advisor',
    contractVersion: '1.0.0',
  });
  assert.equal(result.contractVersion, '1.0.0');
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'E_OPERATE_REVIEW_CONTRACT_VERSION_MISMATCH');
  assert.throws(
    () => inspectOperateReviewNote(advisor, {
      profile: 'advisor',
      contractVersion: '3.0.0',
    }),
    (error) => (
      error instanceof SkillRuntimeError
      && error.code === 'E_OPERATE_REVIEW_CONTRACT_VERSION_INVALID'
    ),
  );
});

test('canonical Operate guidance keeps context and seven lenses without workflow bureaucracy', () => {
  const paths = [
    'skills/planr-operate/SKILL.md',
    'skills/shared/operate-advisor-contract.md',
    'skills/planr-ceo-review/SKILL.md',
    'skills/planr-cto-review/SKILL.md',
    'skills/planr-cpo-review/SKILL.md',
    'skills/planr-cmo-review/SKILL.md',
    'skills/planr-coo-review/SKILL.md',
    'skills/planr-challenger-review/SKILL.md',
    'skills/planr-chair-review/SKILL.md',
  ];
  const forbidden = /human gate|named cycle owner|correction (?:pass|loop|attempt)|retry loop|authoritative|not deliverable|evidence index|audit note|receipt|sha-?256|digest-bound/iu;
  for (const path of paths) assert.doesNotMatch(read(path), forbidden, path);

  const operate = read('skills/planr-operate/SKILL.md');
  assert.match(operate, /native structured-question UI/iu);
  assert.match(operate, /one concise chat question at a time/iu);
  assert.match(operate, /Build shared context once/iu);
  assert.match(operate, /`planr-ceo-review`[\s\S]*`planr-cto-review`[\s\S]*`planr-cpo-review`[\s\S]*`planr-cmo-review`[\s\S]*`planr-coo-review`/iu);
  assert.match(operate, /`planr-challenger-review`/iu);
  assert.match(operate, /`planr-chair-review`/iu);
  assert.match(operate, /## Issues/iu);
  assert.match(operate, /Optional quality check/iu);
  assert.match(operate, /operate-review-quality-contract@2\.0\.0/u);
  assert.match(operate, /--contract-version 2\.0\.0/u);
});

test('a suggested role or unassigned owner satisfies the decision shape', () => {
  assert.equal(inspectOperateReviewNote(boardReport, { profile: 'board-report' }).ok, true);
  assert.equal(
    inspectOperateReviewNote(
      boardReport.replace('- **Suggested owner:** unassigned', '- **Suggested owner:** platform team'),
      { profile: 'board-report' },
    ).ok,
    true,
  );
});

test('no-decision reports remain useful without a disposition form or rerun requirement', () => {
  const result = validateOperateReviewNote(noDecisionBoardReport, { profile: 'board-report' });
  assert.equal(result.itemCount, 0);
  assert.doesNotMatch(noDecisionBoardReport, /adopt|reject|defer|re-run/iu);
});

test('inspection reports structural issues without throwing; strict validation remains explicit', () => {
  const malformed = advisor
    .replace('- **Check:** Confirm restored health and data consistency.\n', '')
    .replace('- **Sources:** `docs/release.md:18`, `.github/workflows/release.yml:42`\n', '');
  const report = inspectOperateReviewNote(malformed, { profile: 'advisor' });
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.diagnostics.map(({ code, field }) => [code, field]),
    [
      ['E_OPERATE_REVIEW_FIELD_MISSING', 'Check'],
      ['E_OPERATE_REVIEW_FIELD_MISSING', 'Sources'],
    ],
  );
  assert.throws(
    () => validateOperateReviewNote(malformed, { profile: 'advisor' }),
    (error) => error instanceof SkillRuntimeError && error.code === 'E_OPERATE_REVIEW_NOTE_INVALID',
  );
});

test('advisor profiles support the concise insufficient-context state', () => {
  const insufficient = advisor
    .replace('> **Signal:** action', '> **Signal:** insufficient context')
    .replace(
      /### F1[\s\S]*?(?=## Recommended next move)/u,
      'No decision-relevant finding was established.\n\n',
    )
    .replace(
      /- \*\*Recommendation:\*\*[\s\S]*?(?=## Decision-changing gaps)/u,
      'No recommendation from current context.\n\n',
    );
  assert.equal(validateOperateReviewNote(insufficient, { profile: 'advisor' }).itemCount, 0);
});

test('decision and action checks retain concise ordering and item limits', () => {
  const malformed = boardReport
    .replace('### D1 — [P0] Rehearse rollback before release', '### D1 — Rehearse rollback before release')
    .replace('- **Expected result:** The previous version and healthy service state are restored.\n', '')
    .replace('| A1 | P0 | Rehearse rollback | unassigned |', '| A1 | P0 | ... | unassigned |');
  const result = inspectOperateReviewNote(malformed, { profile: 'board-report' });
  assert.equal(result.ok, false);
  assert.deepEqual(
    new Set(result.diagnostics.map(({ code }) => code)),
    new Set([
      'E_OPERATE_REVIEW_ITEM_HEADING_INVALID',
      'E_OPERATE_REVIEW_FIELD_MISSING',
      'E_OPERATE_REVIEW_ACTION_ROW_INVALID',
    ]),
  );

  const firstAction = '| A1 | P0 | Rehearse rollback | unassigned | Run staging rollback | Healthy prior version | Check health and data | D1 |';
  const eightActions = Array.from({ length: 8 }, (_, index) => (
    firstAction.replace('| A1 |', `| A${index + 1} |`)
  )).join('\n');
  const tooMany = inspectOperateReviewNote(
    boardReport.replace(firstAction, eightActions),
    { profile: 'board-report' },
  );
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.diagnostics[0].code, 'E_OPERATE_REVIEW_ACTION_LIMIT');
});

test('board reports require a concise executive summary and ordered sections', () => {
  const emptySummary = inspectOperateReviewNote(
    boardReport.replace('Act now: rehearse rollback before accepting the next release candidate.', ''),
    { profile: 'board-report' },
  );
  assert.equal(emptySummary.ok, false);
  assert.equal(emptySummary.diagnostics[0].code, 'E_OPERATE_REVIEW_SUMMARY_MISSING');

  const reordered = inspectOperateReviewNote(
    boardReport.replace(
      /(## Risks and dissent[\s\S]*?)(## Decision-changing gaps[\s\S]*?)(?=## Review coverage)/u,
      '$2$1',
    ),
    { profile: 'board-report' },
  );
  assert.equal(reordered.ok, false);
  assert.equal(
    reordered.diagnostics.some(({ code }) => code === 'E_OPERATE_REVIEW_SECTION_ORDER'),
    true,
  );
});

test('review profiles keep concise byte and gap limits', () => {
  const oversized = inspectOperateReviewNote(
    advisor.replace('None.\n', `${'Additional prose. '.repeat(1_100)}\n`),
    { profile: 'advisor' },
  );
  assert.equal(oversized.ok, false);
  assert.ok(oversized.byteLength > OPERATE_REVIEW_NOTE_PROFILES.advisor.maxBytes);
  assert.equal(
    oversized.diagnostics.some(({ code }) => code === 'E_OPERATE_REVIEW_SIZE_LIMIT'),
    true,
  );

  const tooManyGaps = inspectOperateReviewNote(
    advisor.replace(
      '## Decision-changing gaps\n\nNone.',
      `## Decision-changing gaps

- **G1 — owner:** affects assignment
- **G2 — environment:** affects feasibility
- **G3 — recovery objective:** affects priority
- **G4 — release window:** affects timing`,
    ),
    { profile: 'advisor' },
  );
  assert.equal(tooManyGaps.ok, false);
  assert.equal(tooManyGaps.diagnostics[0].code, 'E_OPERATE_REVIEW_SECTION_ITEM_LIMIT');
});
