# Operate note checklist

Check a written Operate note line by line before returning it. Each item names the diagnostic
code `openplanr operate validate-note` reports for the same problem. Fix what you can; report each
item that stays unresolved as a structural issue, with its code.

This checklist is the check. Never run `npx`, install or download anything, or search the
filesystem for a validator or the CLI. Run `openplanr operate validate-note <note> --profile
<profile> --contract-version 2.0.0` only if `command -v openplanr` succeeds, and treat its
diagnostics the same way.

Profiles: `advisor` (CEO, CTO, CPO, CMO and COO reviews), `challenger`, `chair` and
`board-report`. Notes written now use contract 2.0.0.

## Every profile

- [ ] The profile is one of the four above (`E_OPERATE_REVIEW_PROFILE_INVALID`).
- [ ] The preamble, before the first `##` heading, holds at most one contract line, written
      `> **Contract:** …` or `- **Contract:** …`
      (`E_OPERATE_REVIEW_CONTRACT_DECLARATION_DUPLICATE`). A note with no contract line passes.
      Only a contract line that is present is checked: its value must be exactly
      `operate-review-quality-contract@2.0.0` (`E_OPERATE_REVIEW_CONTRACT_DECLARATION_INVALID`
      for an unsupported kind or version, `E_OPERATE_REVIEW_CONTRACT_VERSION_INVALID`,
      `E_OPERATE_REVIEW_CONTRACT_VERSION_MISMATCH`).
- [ ] The note has exactly one level-one `#` title (`E_OPERATE_REVIEW_TITLE_MISSING`,
      `E_OPERATE_REVIEW_TITLE_DUPLICATE`).
- [ ] The note fits its size limit in UTF-8 bytes: advisor 16 KiB, challenger 12 KiB, chair and
      board-report 24 KiB (`E_OPERATE_REVIEW_SIZE_LIMIT`).
- [ ] Every required `##` section for the profile is present (`E_OPERATE_REVIEW_SECTION_MISSING`)
      and appears once (`E_OPERATE_REVIEW_SECTION_DUPLICATE`); there is no other `##` section
      (`E_OPERATE_REVIEW_SECTION_UNEXPECTED`); and the sections follow the order listed below
      (`E_OPERATE_REVIEW_SECTION_ORDER`).
- [ ] Check section items, section fields and item fields only in sections that are present. A
      missing section is reported once, as `E_OPERATE_REVIEW_SECTION_MISSING`, and yields no
      field or item code for what it would have held. The preamble fields are always checked.
- [ ] Each required field is written as `- **Name:** value` or `> **Name:** value`, appears once
      in its scope (`E_OPERATE_REVIEW_FIELD_DUPLICATE`), and holds a real value, not empty, `...`,
      `TBD`, `TODO` or a `<placeholder>` (`E_OPERATE_REVIEW_FIELD_MISSING`).
- [ ] A field with a fixed value list uses one of the listed values exactly
      (`E_OPERATE_REVIEW_FIELD_VALUE_INVALID`).
- [ ] The item section holds at least one item or its exact empty-state sentence
      (`E_OPERATE_REVIEW_ITEM_OR_EMPTY_STATE_MISSING`), at most five items
      (`E_OPERATE_REVIEW_ITEM_LIMIT`), headed `### <prefix><n> — <title>` and numbered 1, 2, 3
      with no gaps or repeats (`E_OPERATE_REVIEW_ITEM_SEQUENCE`).
- [ ] `Decision-changing gaps` is `None.` or a list within its limit (advisor and challenger 3,
      chair and board-report 5) counted as `- ` lines (`E_OPERATE_REVIEW_SECTION_ITEM_LIMIT`).

## advisor

- [ ] Preamble fields: `Signal` (`action`, `watch` or `insufficient context`) and `Bottom line`.
- [ ] Sections: `Findings`, `Recommended next move`, `Decision-changing gaps`,
      `Sources consulted`.
- [ ] Items `F1`…`F5` under `Findings`, or `No decision-relevant finding was established.` Each
      has `Priority` (`P0`, `P1`, `P2` or `unranked`), `Status` (`observed` or `inferred`),
      `Why it matters`, `Sources`, `Confidence` and `Decision impact`.
- [ ] `Recommended next move` is exactly `No recommendation from current context.` or has
      `Recommendation`, `Suggested owner`, `First step`, `Expected result`, `Check` and
      `Revisit when`.

## challenger

- [ ] Preamble fields: `Verdict` (`holds`, `holds with exceptions` or `not decision-ready`) and
      `Bottom line`.
- [ ] Sections: `Material exceptions`, `Decisions that still hold`, `Risks and dissent`,
      `Decision-changing gaps`.
- [ ] Items `X1`…`X5` under `Material exceptions`, or `No material exception found.` Each has
      `Target`, `Type` (`unsupported`, `contradicted`, `correlated reasoning`,
      `missing alternative`, `unpriced downside` or `overconfident`), `Decision impact`,
      `Challenge`, `Sources` and `Resolution`.
- [ ] `Risks and dissent` has `Dissent` and `Resolution condition`.

## chair

- [ ] Preamble fields: `Overall signal` (`act now`, `decide next`, `watch` or
      `insufficient context`) and `Executive call`.
- [ ] Sections: `Decision queue`, `Action plan`, `Risks and dissent`, `Decision-changing gaps`,
      `Review coverage`.
- [ ] The decision queue and action plan items below.

## board-report

- [ ] No preamble fields are required.
- [ ] Sections: `Scope`, `Executive summary`, `Decision queue`, `Action plan`,
      `Risks and dissent`, `Decision-changing gaps`, `Review coverage`, `Issues`.
- [ ] `Scope` has `Subject`, `Window`, `Requested decision` and `Custody`.
- [ ] `Executive summary` is not empty (`E_OPERATE_REVIEW_SUMMARY_MISSING`); a missing
      `Executive summary` section is reported both as `E_OPERATE_REVIEW_SECTION_MISSING` and as
      `E_OPERATE_REVIEW_SUMMARY_MISSING`.
- [ ] Exceptions to "a missing section yields no other code": with at least one decision, a
      missing `Action plan` (chair or board-report) also yields
      `E_OPERATE_REVIEW_ACTION_PLAN_INVALID`; in a contract 1.0.0 note, a missing `Executive call`
      also yields `E_OPERATE_REVIEW_EXECUTIVE_CALL_MISSING` and a missing `Human gate` also yields
      `E_OPERATE_REVIEW_HUMAN_GATE_INCOMPLETE`.
- [ ] The decision queue and action plan items below.

## Decision queue and action plan (chair and board-report)

- [ ] Items `D1`…`D5` under `Decision queue`, or `No decision-ready proposal was established.`
- [ ] Each heading carries a priority: `### D1 — [P0] <title>`, with `P0`, `P1`, `P2` or
      `unranked` (`E_OPERATE_REVIEW_ITEM_HEADING_INVALID`).
- [ ] Each decision has `Recommendation`, `Why now`, `Suggested owner`, `Confidence`,
      `Alternative`, `First step`, `Expected result`, `Check`, `Dependencies`, `Revisit when`,
      `Sources` and `Dissent`.
- [ ] With at least one decision, `Action plan` has the table header
      `| ID | Priority | Action | Suggested owner | First step | Success measure | Check | Depends on |`
      and at least one `A<n>` row (`E_OPERATE_REVIEW_ACTION_PLAN_INVALID`).
- [ ] The action plan has at most seven rows (`E_OPERATE_REVIEW_ACTION_LIMIT`), and every row
      has exactly eight columns, none empty or a placeholder from the field list above (`...`,
      `TBD`, `TODO`, `<placeholder>`); `—` is accepted, for example in `Depends on`
      (`E_OPERATE_REVIEW_ACTION_ROW_INVALID`).

## Older notes (contract 1.0.0)

Only for reading a note that declares `operate-human-review-contract@1.0.0`; never write one.
Its sections and fields differ from the lists above. A 1.0.0 board report also needs:

- [ ] A non-empty `Executive call` section (`E_OPERATE_REVIEW_EXECUTIVE_CALL_MISSING`).
- [ ] A `Human gate` with one statement per decision naming adopt, reject, defer, the decision's
      owner and a reason; with no decision, it offers close, supply evidence, and re-run for any
      absent review seat (`E_OPERATE_REVIEW_HUMAN_GATE_INCOMPLETE`), and never offers adopt,
      reject or defer (`E_OPERATE_REVIEW_HUMAN_GATE_CONTRADICTORY`).

A caller that requires a conforming note fails it as a whole when any item above is unresolved
(`E_OPERATE_REVIEW_NOTE_INVALID`); that whole-note code is never listed on the `CODES:` line.

## Report format

End the reply with exactly one line: `CODES: ` followed by every distinct code from the items
above, each written in full, sorted alphabetically and comma-separated; write
`CODES: none` when every item passes. Each code appears once however many times the problem
occurs.
