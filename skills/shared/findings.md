# Findings outside the task

A finding is a defect or bad practice you observed outside the task: a wrong
value, the same bug elsewhere, a flaky check. It needs evidence you saw: a
repo-relative `file:line`, or a command and its output line. A suspicion without
evidence is not a finding. A problem that stops this task is a blocker, not a
finding.

## Never fix a finding here

Do not change code for a finding in this run. The one exception is a defect that
blocks this task's own definition of done: it becomes a blocker, you fix it, and
**Changed** says it was pre-existing and why it could not wait.

## Shape

`issues` holds two lists. `blockers`: problem, impact, next action.
`findings`, each with:

- `title`: one plain line stating the defect; it is also the backlog title.
- `severity`: `critical`, `high`, `medium` or `low`; it becomes the backlog priority.
- `evidence`: `file:line`, or the command and the output line.
- `proposed`: the backlog entry: title, priority, tags, and a `description` in
  Markdown with Problem, Why it matters ("no consequence yet" when that is the
  honest answer), Evidence, and Fix shape. Label unverified parts as unverified.
- `disposition`: `filed`, `tracked`, `declined` or `reported`, plus `{ id, path }`
  when filed or tracked.

Merge duplicates within the run. Sort by severity, highest first, and number from
1. Show at most 5 in full and summarise the rest as "+N more".

## Check what is already tracked

Before showing findings, list open backlog items with the backlog helper
linked from SKILL.md, resolved relative to that file: `node <helper> list
--project <repository-root> --open`. A finding about the same problem as an open item,
normally the same evidence file and an equivalent title, is `tracked`. Never file
it again and never edit the existing item.

## Decide, then ask at most once

After checks, and only when at least one finding is untracked, take the first
rule that applies. File only what it allows.

1. The request says to file findings, or not to: do that.
2. **Attended run**, the user can answer now: ask one question with the host's
   structured question tool: "File N findings as backlog items?" with the options
   "File all N (Recommended)" and "Don't file", and free text for numbers such as
   "1 3". Without such a tool, ask in one chat line: `File these as backlog items?
   Reply "all", "none", or the numbers, e.g. "1 3".` File what the answer names.
3. **Unattended run**, nobody can answer: the host cannot ask and wait (for
   example a print or exec mode), another skill or a delegate runner started this
   run, or the user said not to ask. Read `findings.unattended` in
   `.planr/config.json`. Only `file` files every untracked finding. With
   `report`, or no setting, do not run `add` at all: mark the findings `reported`.

Never ask per finding, never ask mid-run, and never file or drop a finding
silently.

## File

Send each item as one JSON object (`title`, `priority`, `tags`, `description`)
on stdin. Never pass `acceptanceCriteria`.

- When an `openplanr` CLI resolves (the project's `node_modules/.bin`, then
  `PATH`; never `npx`): `openplanr --project-dir <repository-root> backlog add
  --data - --json`.
- Otherwise: `node <helper> add --project <repository-root> --data -`. Its
  result can carry `cliHint`; end the result with that line, word for word,
  once. Install only if the user says yes then, by running exactly the command in
  the line. If the result says `templateOverrideIgnored`, say the default format
  was used.

If filing fails, report the command and its error, and leave the finding
`reported`.

## Report

Under **Issues**, write the blockers, or `none for this task.` when only findings
remain. Then:

```text
Found outside this task (not changed)
1. medium · /import has no rate limit · src/routes/import.ts:41
   Filed BL-431 · .planr/backlog/BL-431-import-endpoint-has-no-rate-limit.md
2. low · tests/session.test.ts timed out once, passed on rerun · npm test, first run
   Already tracked as BL-212 · .planr/backlog/BL-212-session-test-times-out.md
```

Unfiled findings say why in the heading, for example `(not changed, not filed:
unattended default is "report")`, and end with: `To file them, reply "file 1 2".` In an unattended run, add: `To file automatically in unattended runs, set "findings": { "unattended": "file" } in .planr/config.json.`
Paths are always repo-relative.
