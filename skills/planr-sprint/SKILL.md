---
name: planr-sprint
description: Refine every open backlog item against the code and the calendar, refute the picks, and select a sprint that fits capacity and the release cut. Use before a cut or sprint; not for decomposing one specification or reporting status.
license: MIT
---

# OpenPlanr Sprint

Backlog refinement followed by sprint selection. **Refine** reads every open
item in full and judges it against the default branch and the calendar.
**Select** fits the surviving items to the stated capacity and the next release
cut, refutes the picks with three independent lenses, and writes the sprint.
Perform the reasoning in this session; never delegate it to a model subprocess.
The CLI (`openplanr sprint …`) stores what this skill decides. It is optional: when
it is unavailable, write the same files by hand in the shapes given in
[sprint formats](references/sprint-formats.md).

Use `planr-plan` to decompose one specification, `planr-status` to report
without judging, and `planr-operate` for an executive decision queue. This skill
never implements work and never chains into `planr-ship`.

`--refine-only` runs the refine phase (steps 1 to 4 for the blocked and
close-or-demote buckets) and writes the refinement note without creating a
sprint. Any run can be repeated and diffed against the previous one.

## Inputs are tiers, not gates

Every input except the backlog is optional. A missing tier removes one
capability; it never blocks the run. Name every degraded input in `Issues`.

| Input | If present | If absent |
| --- | --- | --- |
| Open backlog and quick tasks (`.planr/backlog/`, `.planr/quick/`, open spec tasks) | The core: read, score, bucket | The only hard requirement; zero items means "nothing to refine" |
| Git history and the code paths items cite | Evidence lens: stale, already fixed, premise false | Buckets rest on the items' own dates; say "not verified against code" |
| Release profile (`.release/profile.md`: cut date, cadence, freezes) | Size the In-progress bucket to the cut; the sprint gets `releaseCut` | Ask once for a horizon; default to a two-week sprint from today |
| Capacity (engineers × working days) | Fit the list and name the overflow | Ask once; default 1 engineer × 10 days, stated in the return |
| Previous sprint or refinement note (`.planr/sprints/SPRINT-NNN/refinement.json`) | Carry `leftovers`; `openplanr sprint diff` is possible | First run, no diff |
| Last Operate cycle | Rank its unfinished actions alongside | Skipped silently |
| ~~project tracker or ~~source control ([connectors](references/connectors.md)) | Update linked issues on approval, read PR state | Local files only; report the external step as not run and name the category to add |

## Step 0: Frame the run

Before reading the backlog, ask through the host's structured question surface
(Claude Code `AskUserQuestion`, the Codex equivalent), never through free text
when a structured surface exists.

- One call, at most three questions, each with mutually exclusive options and
  a recommended default; the user can always answer "Other".
- Ask only what the repository cannot answer: capacity and horizon when no
  profile and no argument supplies them; a focus (one product or area, or
  everything); what to do with items judged dead (close, demote, or list only);
  refine only, or refine and select.
- Never ask about facts derivable from files (the cut date in the profile, the
  last sprint, the open item count). Never ask mid-run.
- With `--yes` or no structured surface, take the defaults and list the ones
  taken in `Issues`.

The only other question is the approval at the end (step 6).

## Step 1: Read the calendar and capacity

Next cut and freezes from `.release/profile.md`; capacity from the framing
question or argument; `leftovers` from the previous sprint's `refinement.json`;
unfinished actions from the last Operate cycle. Record the git revision the run
judges against (`git rev-parse --short HEAD` on the default branch).

## Step 2: Read every open item in full

Backlog items, quick tasks and open spec tasks: the whole file, not the title.
For each item record the fields in the
[refinement contract](references/refinement-contract.md): what it claims, the
latest dated evidence, the code path it names and whether that path still
exists on the default branch as described, what blocks it (partner, team
decision, another item, nothing), an effort class (`hours`, `day`, `days`,
`week+`), and a score: production impact this month × tractability now.

Read the code an item names before believing its claim. `git log -S`, `git
log -- <path>` and the merged pull requests since the item's evidence date are
the cheapest refutations.

## Step 3: Rank into four buckets

- **In progress now**: fits capacity to the cut, in execution order, grouped
  into PR batches by product or into sessions. Each batch carries a title and
  an effort in days.
- **Plan next**: real, but after the cut.
- **Blocked**: the named blocker and the one question that unblocks it.
- **Close or demote**: with the evidence (`file:line`, PR number or date) and
  the target status or priority in the repository's own vocabulary.

Carry the previous Operate cycle's unfinished actions explicitly. Include the
release cut itself as work; when it has no artifact yet, file it with
`openplanr quick create "Release cut <date>"` so the sprint contains only artifact
ids.

## Step 4: Refute the In-progress bucket

Before the bucket is shown, run three independent lenses over every pick:

1. **Evidence**: still real on the default branch; premise not false; not
   already fixed.
2. **Capacity and sequencing**: fits the days; migrations, partner
   dependencies, PR batching and CI cost per PR are accounted for.
3. **User impact**: who is hit this month if it is not done, and which
   higher-impact item was omitted for it.

A pick that fails moves or drops, and the reason is kept in `refuted[]` with its
lens. The list must fit the stated capacity; when it does not, say what was cut.

## Step 5: Write the sprint, the note and the JSON, then stop

Write the three durable outputs (formats in
[sprint formats](references/sprint-formats.md)); the chat return is a view of
them.

```bash
openplanr sprint create --data sprint.json --json                  # name, releaseCut, capacityDays, startDate
openplanr sprint refinement SPRINT-NNN --data refinement.json --json # validates, stores the note and JSON, fills the sprint body
openplanr sprint diff SPRINT-MMM SPRINT-NNN                          # when a previous run exists
```

`refinement.json` must satisfy [the schema](schemas/refinement.schema.json); the
CLI rejects an inconsistent document with `$`-rooted diagnostics. Fix the
document, never the validation. With `--refine-only`, skip `sprint create` and
record the refinement against the current active sprint, or write only the note
and JSON when none exists.

Then stop. Ask the approval question through the structured surface: apply the
write-back, or leave the proposal as written.

## Step 6: On approval, apply

```bash
openplanr sprint apply SPRINT-NNN --dry-run          # show the status and priority changes
openplanr sprint apply SPRINT-NNN --yes --commit     # one commit: chore(planr): refine backlog for SPRINT-NNN
```

Then, if ~~project tracker is connected, update the issue linked to each changed
item through the host's connection, with the status mapping in the
[tracker sync reference](references/tracker-connections.md). Before any remote write,
list every issue change: each issue to create, update, close or reopen, with its
title and the status it moves to. Write only when the request explicitly asked for
that push or the user approves the list. Afterwards, report each item that was not
updated and why, and name the category and product used.

With nothing connected, the local apply is the whole step: report the tracker
update as not run and give the current host's step from
[connectors](references/connectors.md).

When the CLI is unavailable, apply the same status changes with the repository's
own vocabulary and commit them with the same message.

Close a finished sprint with `openplanr sprint close SPRINT-NNN`; it records the
leftovers the next run carries.

## Rules from production use

- Never move an item to In progress on its own priority label; a months-old P0
  or P1 is often dead. Evidence date beats label.
- Never accept an item's claim of impact without reading the code path it names.
- Items blocked on a partner or a team decision are never In progress; they get
  the question that unblocks them.
- The list must fit the stated capacity; if it does not, say what was cut.
- No new migration in a hand deploy unless the sprint says so explicitly.
- Use the repository's own status vocabulary (`openplanr update --help` lists it);
  never introduce a second one.
- The note and the JSON are the durable output; the chat return is a view of
  them. That is what keeps the third run from re-arguing the first two.

## Return

Lead with what was proposed or actually applied. Link the sprint, refinement note
and JSON; keep full bucket rows and refuted picks in those artifacts rather than
repeating the backlog in chat. Summarize the selection and checks that justify it,
and identify incomplete evidence or blocked inputs with their recovery action.

- **Outcome:** `proposed` (sprint written, nothing else changed) or `applied`
  (status changes written on approval), plus capacity used vs available in
  engineer-days.
- **Sprint:** the sprint id and path, and the cut it targets.
- **Buckets:** counts for the four buckets, the selected batches in execution
  order, and the most consequential blocked or close-or-demote decision.
- **Refuted:** material changes to the selection, with their evidence or capacity rationale.
- **Checks:** code/calendar evidence and refutation lenses actually completed.
- **Issues:** degraded inputs, items that could not be read or judged, defaults
  taken, or `none`.
- **Next:** the pending write-back choice or next useful action, only when needed.

The note and JSON remain complete and unchanged in shape. Omit empty chat sections;
different summary wording never causes another sprint creation or write-back.

`openplanr status` shows the active sprint with its cut and progress; the dashboard
(`planr-dashboard`) renders the sprint from the same frontmatter and checkboxes.

## Reference files

- [Refinement contract](references/refinement-contract.md): item record, scoring, effort classes, buckets, refuter lenses, `refinement.json` fields
- [Sprint formats](references/sprint-formats.md): sprint artifact, refinement note, chat return, hand-written fallback
- [Refinement schema](schemas/refinement.schema.json): the JSON Schema the CLI validates against
