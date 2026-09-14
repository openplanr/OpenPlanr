---
name: planr-operate
description: "Run a focused operating review across seven executive lenses and produce a decision and action brief. Use for periodic product or company-level leadership review."
license: MIT
---

# Operate

Run one useful operating review, not a ceremony. Build shared context once, fan out the five
executive advisors, use the Challenger to test material claims, and let the Chair synthesize the
result. Return a clean board report with decisions, actions, risks, gaps, and any real issues.

## Scope the review

Infer these values from the request and repository when they are clear:

- **Subject** — the product, area, change, or decision under review.
- **Window** — a date or revision range, or the current snapshot when no comparison was requested.
- **Requested decision** — the choice the review should inform, or `periodic review`.
- **Roster** — all seven lenses unless the user selects fewer.

Use the current repository, current snapshot, periodic review, and all seven lenses as sensible
defaults. When ownership is useful, a recommendation may suggest a person, a role, or
`unassigned`.

Ask only when an unresolved choice would materially change the sources inspected or the decision
being answered. Use the host's native structured-question UI when available, offering a
recommended choice and short alternatives. Otherwise ask one concise chat question at a time.
Never present the scope fields as a prose questionnaire.

Preserve the user's wording in `cycle.md`, followed by the effective scope used by the lenses.
Do not claim a trend from a current snapshot; describe current state and name any missing baseline.

## Create the cycle workspace

Use a short subject slug and today's ISO date. Choose the first unused path;
when the base path exists, append `-02`, `-03`, and so on. Reuse an existing
cycle only when the user explicitly asks to resume it and its recorded scope
matches. Never overwrite a prior cycle implicitly.

```text
.planr/operate/<date>-<slug>/
  cycle.md
  brief.md
  <selected-lens-notes>.md
  board-report.md
```

`cycle.md` records the effective scope, roster, repository revision when relevant, and the outcome
of each lens. If the directory is ignored by Git, continue locally and mention that in the report;
do not ask the user to change ignore rules. Report an exact filesystem error only when the cycle
workspace cannot be created or written.

## Build shared context once

Write `brief.md` as a compact orientation aid, not a conclusion. Include:

- effective subject, window, requested decision, and roster;
- current revision and working-tree state when relevant;
- the requested range and a short change summary when the review is historical;
- paths to relevant planning, product, customer, financial, operational, delivery, architecture,
  incident, and metric sources;
- important context that was searched for but not found.

Open enough of the repository to make these pointers useful. Keep observations separate from
interpretation so every lens can reach its own conclusion. The brief is a starting point; lenses
may inspect other relevant project sources.

## Run the selected lenses (seven by default)

Dispatch only the selected independent advisors, in parallel when subagents are
available:

| Lens | Skill | Output |
|---|---|---|
| Strategy and finance | `planr-ceo-review` | `ceo.md` |
| Technology and delivery risk | `planr-cto-review` | `cto.md` |
| Product and activation | `planr-cpo-review` | `cpo.md` |
| Growth and market | `planr-cmo-review` | `cmo.md` |
| Operations and customer health | `planr-coo-review` | `coo.md` |

Give each selected advisor the brief path, its output path, and the effective
scope. Do not invoke or create note files for advisor lenses omitted by the
roster. After the selected advisor work finishes:

1. If Challenger is selected, run `planr-challenger-review` over the available
   advisor notes to surface only material exceptions, alternatives, and downside.
2. If Chair is selected, run `planr-chair-review` over the available selected
   notes to produce the decision queue and action plan.
3. If Challenger or Chair is omitted, record `omitted by scope` in review
   coverage. Assemble the board report from the available selected notes without
   inventing the omitted lens; when Chair is absent, clearly label the result as
   an unsynthesized lens summary rather than a Chair recommendation.

Missing or malformed lens output is an issue, not a reason to fabricate that lens or discard all
other useful work. Record the problem, its effect on confidence, and the smallest next action.

## Assemble `board-report.md`

Use these sections in this order:

```markdown
# Operating board report — <subject>

> **Contract:** operate-review-quality-contract@2.0.0

## Scope
- **Subject:** <effective subject>
- **Window:** <effective window>
- **Requested decision:** <decision or periodic review>
- **Custody:** local-only | repository-trackable

## Executive summary
<overall signal and the two or three points that matter most>

## Decision queue
### D1 — [P0|P1|P2|unranked] <decision>
- **Recommendation:** <clear choice>
- **Why now:** <consequence or opportunity>
- **Suggested owner:** <person, role, or unassigned>
- **Confidence:** high | medium | low — <reason>
- **Alternative:** <credible alternative and trade-off>
- **First step:** <smallest concrete start>
- **Expected result:** <observable result>
- **Check:** <how to assess the result>
- **Dependencies:** <IDs or none>
- **Revisit when:** <observable condition>
- **Sources:** <note IDs and direct project paths>
- **Dissent:** <material exception or none>

## Action plan
| ID | Priority | Action | Suggested owner | First step | Success measure | Check | Depends on |
|---|---|---|---|---|---|---|---|
| A1 | P0 | ... | ... | ... | ... | ... | D1 |

## Risks and dissent
<only items that could change a decision or priority>

## Decision-changing gaps
<at most five; use `None.` when empty>

## Review coverage
| Lens | Outcome | Note | Informed |
|---|---|---|---|
| ... | reported / no material finding / unavailable / omitted by scope | `file.md` or `—` | D1 / watch / none |

## Issues
- **I1 — <problem>:** <impact and practical next action>
<or `None.`>
```

When Chair is selected, copy decisions and actions from `chair.md`; do not create a new executive
opinion during assembly. When Chair is omitted, summarize only the available selected notes,
label the report as an unsynthesized lens summary, and use `No decision-ready proposal was
established.` plus `No proposed actions.` unless those notes already state a directly supported
proposal. Never present that result as Chair synthesis. Keep at most five decisions, seven actions,
and five decision-changing gaps. When no decision is ready, say so plainly and retain the strongest
watch items and the context needed to improve the next review.

## Optional quality check

The packaged [note validator](scripts/validate-note.mjs) can identify missing sections, fields, or limits:

```sh
node "<skill-root>/scripts/validate-note.mjs" "<absolute-advisor-output>" --profile advisor --contract-version 2.0.0
node "<skill-root>/scripts/validate-note.mjs" "<absolute-challenger-output>" --profile challenger --contract-version 2.0.0
node "<skill-root>/scripts/validate-note.mjs" "<absolute-chair-output>" --profile chair --contract-version 2.0.0
node "<skill-root>/scripts/validate-note.mjs" "<absolute-board-report-path>" --profile board-report --contract-version 2.0.0
```

Use their diagnostics as editing help. Include unresolved structural problems under `Issues` with
their impact and next action while preserving the useful parts of the report.

Return the absolute `board-report.md` path, overall signal, decision count, action count, and a
one-line issues summary.

When the OpenPlanr dashboard is running, the operating cycle is browsable at
`#/operate/cycles/<id>` and the daily view at `#/operate/today`. This is
navigation only.
