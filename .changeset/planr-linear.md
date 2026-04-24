---
"openplanr": minor
---

**`planr linear`** — full Linear.app integration for OpenPlanr (EPIC-004).

### Subcommands

- `planr linear init` — validate a Linear PAT, pick a team, save settings.
- `planr linear push <artifactId>` — create/update Linear entities at any scope:
  - `EPIC-XXX` → project + features + stories + tasklists
  - `FEAT-XXX` → feature + its stories + its tasklist
  - `US-XXX` → one story sub-issue
  - `TASK-XXX` → one tasklist sub-issue
  - `QT-XXX` → quick task in the standalone project
  - `BL-XXX` → backlog item (auto-labeled) in the standalone project
- `planr linear sync` — pull workflow status + bidirectional task checkboxes.
- `planr linear tasklist-sync` — sync TASK checkbox lines with Linear issue bodies.
- `planr linear status` — local mapping table (no API calls).

### Flags on `push`

`--dry-run`, `--update-only`, `--push-parents`, `--as <strategy>`.

### Epic mapping strategies (chosen once, stored in `linearMappingStrategy`)

- `project` (default) — Epic = Linear Project, one-to-one.
- `milestone-of:<projectId>` — Epic becomes a `ProjectMilestone` in an existing project; descendants carry `projectMilestoneId`.
- `label-on:<projectId>` — Epic becomes a team-scoped label; descendants carry `labelIds` (merged with user-added labels, never stomped).

First-time push prompts interactively. CI consumers use `--as` or `linear.defaultEpicStrategy`.

### Parent-chain pre-flight

Granular pushes (`FEAT-/US-/TASK-`) refuse to run when the parent chain is not yet in Linear — unless `--push-parents` is set, which cascades up. Unsupported prefixes (`ADR-/SPRINT-/checklist-`) error with a pointer to the parent epic.

### Standalone project for `QT-` / `BL-`

Quick tasks and backlog items push as top-level issues in a user-chosen Linear project (`linear.standaloneProjectId`, set once via an interactive first-push prompt). Backlog items auto-apply a team-scoped `backlog` label for filtering.

### Security & reliability

- Linear IDs validated before every API call — accepts UUID or `ENG-42` identifier; corrupted frontmatter falls through to create instead of 404-ing.
- Frontmatter writer preserves regex-special sequences (`$1`, `$&`, `$$`) literally — Linear values can contain them.
- SDK error fallback sanitizes raw GraphQL bodies; known error types keep their user-friendly guidance.
- Rate-limit retries honor Linear's `Retry-After` (never retry sooner than the server asked, never faster than our exponential backoff).
- Non-interactive conflict decisions audited to `.planr/reports/`.
- Three-way checkbox merge warns when a baseline looks corrupted.
- PATs stored via keychain-first credentials service, never in `config.json`.

### Bidirectional status sync with three-way merge (fixes silent data loss)

`planr linear sync` now reconciles workflow status in **both directions** via a three-way merge:

- **Local changed, Linear unchanged** → pushes local to Linear (fixes the data-loss bug where `planr quick update --status done` followed by `planr linear sync` silently reverted local back to Linear's stale state).
- **Linear changed, local unchanged** → pulls Linear to local (existing behavior, preserved).
- **Both changed** → conflict resolved per `--on-conflict prompt|local|linear`. Interactive runs prompt per artifact; CI/non-interactive runs auto-resolve to `linear` and log the decision to `.planr/reports/linear-sync-conflicts-<date>.md`.

Baseline is stored per-artifact in new frontmatter fields `linearStatusReconciled` and `linearStatusSyncedAt`, written on every successful sync. `planr quick update --status` and `planr backlog update --status` automatically clear `linearStatusReconciled` so the next sync recognizes the local change and pushes it up.

`--on-conflict` now applies to both status and checkbox conflicts (previously checkbox-only). Applies to FEAT / US / QT / BL. TASK stays deferred (aggregate issue, needs its own aggregation rules).

### Status sync now covers QT + BL (zero-config)

`planr linear push QT-XXX` and `planr linear push BL-XXX` now write local status to Linear's workflow state. `planr linear sync` pulls state changes back into QT and BL frontmatter alongside features and stories.

- **Zero-config:** push auto-derives the status→stateId map from Linear's canonical state types (`backlog` / `unstarted` / `started` / `completed` / `canceled`) on every run. `linear.pushStateIds` is now an optional override, not a requirement.
- Quick tasks use the task vocabulary (`pending` / `in-progress` / `done`), plus transparent aliases for Linear-native wording (`completed` / `cancelled` / `canceled` / `todo`).
- Backlog items use their own vocabulary (`open` / `closed` / `promoted`). Pull is asymmetric by design: any Linear "in flight" state maps to `open`, `Done`/`Cancelled` maps to `closed`, and local `promoted` is never overwritten (it implies a target pointer Linear can't know about).
- TASK status sync stays on the TODO list. One Linear TaskList issue aggregates many task files, so a 1:1 status mapping doesn't apply; use `planr linear tasklist-sync` for per-checkbox state.

**Fix:** Linear's API rejects `stateId: null` on update (`InvalidInput`). All push paths — feature, story, QT, BL — now omit the `stateId` field entirely when unmapped instead of sending an explicit null, so pushes without any state configuration continue to succeed.

### `planr revise` — unchanged-content short-circuit

Revise now detects when the agent returns content that is effectively identical to the original (byte-exact, or differs only in trailing whitespace that LLM markdown serializers routinely strip). Behavior in that case:

- No file write, no backup sidecar produced, no confirm prompt.
- New audit outcome `unchanged-by-agent` (distinct from `skipped-by-agent` / `flagged`).
- UI renders "(no changes — agent's revised output matches the current file; nothing to apply)" in place of an empty diff block.

Prevents the confusing `Outcome: applied` report when the only on-disk delta was a trailing newline strip.

### `planr linear status` — full URLs, no truncation

Reordered the table so the URL column is last and never truncated. Clickable URLs are the primary value of the table; the previous 28-char ellipsis made them useless for copy-paste.

### Estimate sync for FEAT / US / QT / BL

`planr linear push` now writes local `estimatedPoints` (from `planr estimate --save`, or hand-edited `storyPoints`) to Linear's native Issue estimation field, snapped to the team's configured scale:

- **Fibonacci** — snap to `{0, 1, 2, 3, 5, 8, 13, 21}` (e.g. `4 → 5`, `7 → 8`).
- **Linear** — snap to `{0, 1, 2, 3, 4, 5}`.
- **Exponential** — snap to `{0, 1, 2, 4, 8, 16}`.
- **tShirt** — skipped with one-per-run warning (no reliable numeric → XS/S/M/L/XL mapping).
- **notUsed** — skipped silently.

Zero-config: the team's `issueEstimationType` is auto-detected per push run (one extra API round-trip, cached). TASK is deferred — one Linear TaskList issue aggregates multiple task files, so 1:1 estimate mapping doesn't apply.

### Story body fixes

- **Empty role/goal/benefit no longer renders `As a ****, I want **** so that ****.`** Suppresses the "As a" sentence entirely when any of the three fields is blank (or whitespace-only).
- **Gherkin scenarios now push to Linear.** Stories following the OpenPlanr convention store acceptance criteria as Gherkin in a sibling `<storyId>-gherkin.feature` file. Before this fix the push path never loaded the `.feature` content and Linear stories rendered empty for convention-following teams.
- **Epic project description trims whitespace-only fields** — no more empty `**Risks**` headers.

### Linear label case + workspace-scope fix

`ensureIssueLabel` lookup is now **case-insensitive and workspace-wide** (matching Linear's own uniqueness rule). Previously a workspace with a `Feature` label blocked creation of `feature` with an `InvalidInput: Label already exists` error. Push now adopts the existing cross-team label instead of failing.

### Revise — next-step guidance + rejected-proposal preservation

- Flagged outcomes now print actionable next steps (read the audit log, hand-edit, re-run with `--scope-to prose`, re-run with `--no-code-context`) instead of leaving users in a dead end.
- Demoted `revise → flag` decisions preserve the agent's rejected rewrite in the audit log as a `REJECTED by verifier` diff so users can inspect and hand-apply the parts that make sense. The file is still not written (action remains `flag`); the markdown is kept for audit purposes only.

### BL → QT promote is now AI-driven

`planr backlog promote BL-XXX --quick` feeds the full BL markdown body (description, acceptance criteria, notes, threat models) through the same AI pipeline used by `planr quick create`, producing a realistic task breakdown instead of a single checkbox that restates the title. The new QT carries `sourceBacklog: "BL-XXX"` as provenance and inherits `epicId` from the BL (or an explicit `--epic` override) so `planr linear push EPIC-XXX` cascades to it. Use `--manual` to opt out of AI and keep the legacy single-task behavior.

### Config additions

```jsonc
{
  "linear": {
    "teamId": "UUID",
    "teamKey": "ENG",
    "defaultProjectLead": "UUID",
    "pushStateIds": { "pending": "UUID", "in-progress": "UUID", "done": "UUID" },
    "statusMap": { "In Review": "in-progress" },
    "standaloneProjectId": "UUID",
    "standaloneProjectName": "Planr",
    "defaultEpicStrategy": "project"
  }
}
```
