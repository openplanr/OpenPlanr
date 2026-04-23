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
