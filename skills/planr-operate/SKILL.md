---
name: planr-operate
description: "Run a focused operating review across seven executive lenses and produce a decision and action brief. Use for periodic product or company-level leadership review."
license: MIT
---

# OpenPlanr Operate

Run one useful operating review, not a ceremony. By default one agent applies all seven lenses in one pass and writes one report with decisions, actions, risks, gaps, and any real issues.

## Scope the review

Infer these values from the request and repository when they are clear:

- **Subject** — the product, area, change, or decision under review.
- **Window** — a date or revision range, or the current snapshot when no comparison was requested.
- **Requested decision** — the choice the review should inform, or `periodic review`.
- **Roster** — all seven lenses unless the user selects fewer.

Use the current repository, current snapshot, periodic review, and all seven lenses as sensible
defaults. A recommendation may suggest a person, a role, or `unassigned`.

Ask only when an unresolved choice would materially change the sources inspected or the decision
being answered. Use the host's native structured-question UI when available, offering a
recommended choice and short alternatives. Otherwise ask one concise chat question at a time.
Never present the scope fields as a prose questionnaire.

Record the user's wording and the effective scope in the report's Scope section. Do not claim a
trend from a current snapshot; describe current state and name any missing baseline.

## Choose the mode

Default: this agent applies the lenses itself. Use subagents only when the user names a roster or
asks for independent reviewers; then follow Fan out.

Where the report goes: with no `.planr/` in the repository, answer in chat, or write one file where
the repository already keeps such documents. With `.planr/`, write `board-report.md` in a cycle
directory (below). `cycle.md`, `brief.md` and per-lens notes only when subagents run or the user asks to persist the cycle; a persisted cycle without fan-out writes `cycle.md` and `brief.md` with the contents defined under Fan out.

## Read the sources

Read the files the request names, plus `AGENTS.md` and `CLAUDE.md` when tracked, in one batch.
Expand only for a missing contract, a dependency or a contradiction, and stop when each claim has
evidence or a named gap. Keep observations separate from interpretation.

## Apply the lenses

Work through each selected lens in one pass:

| Lens | Focus |
|---|---|
| CEO | strategy and finance: direction, runway, margin, cost of delay |
| CTO | technology and delivery risk: architecture, reliability, security, execution risk |
| CPO | product and activation: customer value, activation, prioritization, adoption |
| CMO | growth and market: acquisition, positioning, demand, retention, measurement |
| COO | operations and customer health: process, support, incidents, capacity |
| Challenger | for each material claim: the strongest alternative, the downside, and the confidence |
| Chair | the decision queue and action plan, from the findings above |

Name each Review coverage row `CEO`, `CTO`, `CPO`, `CMO`, `COO`, `Challenger` or `Chair`; the dashboard matches on those names.

Every recommendation cites a source: a project path, command output, or a named gap. Do not
fabricate a lens with no evidence; record it as `no material finding` or `unavailable` in review
coverage with the smallest next action. Then assemble the report below.

## Cycle directory

Use a short subject slug and today's ISO date: `.planr/operate/<date>-<slug>/`. Choose the first
unused path; when the base path exists, append `-02`, `-03`, and so on. Reuse an existing cycle
only when the user explicitly asks to resume it and its recorded scope matches. Never overwrite a
prior cycle implicitly. If the directory is ignored by Git, continue locally and mention that in the
report; do not ask the user to change ignore rules. Report an exact filesystem error only when the
directory cannot be created or written.

## Fan out

When the user names a roster or asks for independent reviewers, create the cycle directory with
`cycle.md` (effective scope, roster, revision when relevant, outcome of each lens) and `brief.md`
(scope, revision, source paths, context searched for but not found), then one note per selected lens. An advisor lens run on its own creates the same layout with a one-lens
roster and an unsynthesized `board-report.md`.

Dispatch only the selected independent advisors, in parallel when subagents are
available, giving each the brief path, its output path and the effective scope:

| Lens | Skill | Output |
|---|---|---|
| Strategy and finance | `planr-ceo-review` | `ceo.md` |
| Technology and delivery risk | `planr-cto-review` | `cto.md` |
| Product and activation | `planr-cpo-review` | `cpo.md` |
| Growth and market | `planr-cmo-review` | `cmo.md` |
| Operations and customer health | `planr-coo-review` | `coo.md` |

Do not create note files for omitted lenses. After the advisor work finishes:

1. If Challenger is selected, run `planr-challenger-review` over the available advisor notes to
   surface only material exceptions, alternatives, and downside.
2. If Chair is selected, run `planr-chair-review` over the available notes to produce the decision
   queue and action plan.
3. If Challenger or Chair is omitted, record `omitted by scope` in review coverage and label the
   result an unsynthesized lens summary, not a Chair recommendation.

Missing or malformed lens output is an issue, not a reason to fabricate that lens or discard the
other work. Record the problem, its effect on confidence, and the smallest next action.

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
| CEO | reported / no material finding / unavailable / omitted by scope | `file.md` or `—` | D1 / watch / none |

## Issues
- **I1 — <problem>:** <impact and practical next action>
<or `None.`>
```

In fan out with Chair, copy decisions and actions from `chair.md` without adding a new executive
opinion. Without Chair, summarize only the available notes, label the report an unsynthesized lens
summary, and use `No decision-ready proposal was established.` plus `No proposed actions.` unless
those notes already state a supported proposal. Keep at most five decisions, seven actions, and five
decision-changing gaps. When no decision is ready, say so and keep the strongest watch items.

## Quality check

Before returning, check the report (and any lens note) against [the note checklist](references/note-checklist.md), which runs the CLI's `validate-note` when `command -v openplanr` succeeds and is the check otherwise. Put unresolved structural problems under `Issues` with their impact and next action.

## Return

Lead with the grounded overall signal and most consequential decision or missing evidence.
Link `board-report.md` when one was written, summarize decision and action counts and the review
coverage completed, and name any unavailable or unsynthesized lens. Follow
[the shared return rules](references/return-contract.md).

When the OpenPlanr dashboard is running, the cycle is browsable at `#/operate/cycles/<id>`, the
review index at `#/operate/cycles`, and the latest review at `#/operate/today`, read-only.
Inbox, actions, evidence, outcomes, recovery, and all mutations require an actor-bound governed
Operate session.
