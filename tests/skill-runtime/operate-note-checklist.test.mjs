import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { OPERATE_REVIEW_NOTE_PROFILES } from '../../packages/skill-runtime/src/operate-review-contract.mjs';
import { inspectOperateReviewNote } from '../../packages/skill-runtime/src/operate-review-note.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const checklist = () => read('skills/shared/note-checklist.md');

test('the note checklist covers every diagnostic the Operate validator emits', () => {
  const codes = new Set(
    read('packages/skill-runtime/src/operate-review-note.mjs').match(/E_OPERATE_REVIEW_[A-Z_]+/gu),
  );
  assert.ok(codes.size > 20, 'validator diagnostics found');
  const text = checklist();
  const missing = [...codes].filter((code) => !text.includes(`\`${code}\``));
  assert.deepEqual(missing, [], 'diagnostic codes without a checklist item');
});

test('the note checklist names every current section, field, value and empty state', () => {
  const text = checklist();
  for (const [profile, contract] of Object.entries(OPERATE_REVIEW_NOTE_PROFILES)) {
    assert.match(text, new RegExp(`^## ${profile}$`, 'mu'), `${profile}: profile heading`);
    const names = [
      ...contract.sections,
      ...contract.summaryFields,
      ...Object.values(contract.summaryValues ?? {}).flat(),
      ...contract.item.fields,
      ...Object.values(contract.item.fieldValues ?? {}).flat(),
      ...Object.values(contract.sectionFields).flat(),
    ];
    for (const name of names) assert.ok(text.includes(`\`${name}\``), `${profile}: ${name}`);
    for (const sentence of [
      contract.item.emptyText,
      ...Object.values(contract.sectionEmptyStates ?? {}),
    ])
      assert.ok(text.includes(sentence), `${profile}: ${sentence}`);
    assert.ok(text.includes(`${contract.maxBytes / 1024} KiB`), `${profile}: size limit`);
  }
});

test('the proof fixtures trigger the seeded validator diagnostics', () => {
  const expected = {
    'advisor-review.md': [
      'E_OPERATE_REVIEW_FIELD_MISSING',
      'E_OPERATE_REVIEW_FIELD_VALUE_INVALID',
      'E_OPERATE_REVIEW_ITEM_SEQUENCE',
      'E_OPERATE_REVIEW_SECTION_ITEM_LIMIT',
      'E_OPERATE_REVIEW_SECTION_MISSING',
      'E_OPERATE_REVIEW_SECTION_ORDER',
      'E_OPERATE_REVIEW_SECTION_UNEXPECTED',
    ],
    'chair-review.md': [
      'E_OPERATE_REVIEW_ACTION_ROW_INVALID',
      'E_OPERATE_REVIEW_ITEM_HEADING_INVALID',
      'E_OPERATE_REVIEW_TITLE_DUPLICATE',
    ],
  };
  for (const [file, codes] of Object.entries(expected)) {
    const result = inspectOperateReviewNote(
      read(`tests/skill-runtime/fixtures/operate-note-proof/${file}`),
      { profile: file.split('-')[0], contractVersion: '2.0.0' },
    );
    assert.deepEqual([...new Set(result.diagnostics.map(({ code }) => code))].sort(), codes, file);
  }
});

const proof = (file) => read(`tests/skill-runtime/fixtures/operate-note-proof/${file}`);
const codesOf = (file, options) =>
  [
    ...new Set(inspectOperateReviewNote(proof(file), options).diagnostics.map(({ code }) => code)),
  ].sort();
const flat = () => checklist().replace(/\s+/gu, ' ');

// Each case pairs a note with the validator's codes and the checklist rule that produces them.
const MISSING_SECTION_CASES = [
  {
    file: 'challenger-missing-sections.md',
    options: { profile: 'challenger', contractVersion: '2.0.0' },
    codes: [
      'E_OPERATE_REVIEW_FIELD_MISSING',
      'E_OPERATE_REVIEW_SECTION_MISSING',
      'E_OPERATE_REVIEW_SECTION_UNEXPECTED',
    ],
    rules: [
      /A note with no contract line passes/u,
      /only in sections that are present/u,
      /reported once, as `E_OPERATE_REVIEW_SECTION_MISSING`, and yields no field or item code/u,
      /The preamble fields are always checked/u,
    ],
  },
  {
    file: 'board-report-missing-sections.md',
    options: { profile: 'board-report', contractVersion: '2.0.0' },
    codes: [
      'E_OPERATE_REVIEW_SECTION_MISSING',
      'E_OPERATE_REVIEW_SECTION_UNEXPECTED',
      'E_OPERATE_REVIEW_SUMMARY_MISSING',
    ],
    rules: [
      /missing `Executive summary` section is reported both as `E_OPERATE_REVIEW_SECTION_MISSING` and as `E_OPERATE_REVIEW_SUMMARY_MISSING`/u,
    ],
  },
  {
    file: 'chair-missing-action-plan.md',
    options: { profile: 'chair', contractVersion: '2.0.0' },
    codes: ['E_OPERATE_REVIEW_ACTION_PLAN_INVALID', 'E_OPERATE_REVIEW_SECTION_MISSING'].sort(),
    rules: [
      /with at least one decision, a missing `Action plan` \(chair or board-report\) also yields `E_OPERATE_REVIEW_ACTION_PLAN_INVALID`/u,
    ],
  },
  {
    file: 'board-report-1.0.0-missing-gate.md',
    options: { profile: 'board-report' },
    codes: [
      'E_OPERATE_REVIEW_ACTION_PLAN_INVALID',
      'E_OPERATE_REVIEW_EXECUTIVE_CALL_MISSING',
      'E_OPERATE_REVIEW_FIELD_MISSING',
      'E_OPERATE_REVIEW_HUMAN_GATE_INCOMPLETE',
      'E_OPERATE_REVIEW_ITEM_HEADING_INVALID',
      'E_OPERATE_REVIEW_SECTION_MISSING',
    ],
    rules: [
      /in a contract 1\.0\.0 note, a missing `Executive call` also yields `E_OPERATE_REVIEW_EXECUTIVE_CALL_MISSING` and a missing `Human gate` also yields `E_OPERATE_REVIEW_HUMAN_GATE_INCOMPLETE`/u,
    ],
  },
];

for (const { file, options, codes, rules } of MISSING_SECTION_CASES) {
  test(`${file}: validator codes are pinned and the checklist states the rules behind them`, () => {
    assert.deepEqual(codesOf(file, options), codes);
    const text = flat();
    for (const code of codes) assert.ok(text.includes(`\`${code}\``), `${code} named`);
    for (const rule of rules) assert.match(text, rule);
  });
}

test('the checklist keeps contract-line handling and the whole-note code out of the codes line', () => {
  const text = flat();
  assert.match(
    text,
    /`E_OPERATE_REVIEW_CONTRACT_DECLARATION_INVALID` for an unsupported kind or version/u,
  );
  assert.match(text, /that whole-note code is never listed on the `CODES:` line/u);
});

test('the checklist fixes the report line and forbids searching for a validator', () => {
  const text = checklist().replace(/\s+/gu, ' ');
  assert.match(
    text,
    /exactly one line: `CODES: ` followed by every distinct code .* sorted alphabetically and comma-separated; write `CODES: none`/u,
  );
  assert.match(
    text,
    /Never run `npx`, install or download anything, or search the filesystem for a validator or the CLI/u,
  );
  assert.match(text, /only if `command -v openplanr` succeeds/u);
});
