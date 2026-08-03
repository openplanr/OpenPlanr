# Linear Integration — `planr linear`

> **Status:** Design brief, not yet formalized as `EPIC-004`.
> **Authors:** Asem + Claude (planning pass, 2026-04-21 → 2026-04-22 refinement).
> **Scope:** push **Epic + Features + User Stories + TaskList** to Linear. Uses Linear's native Project + Issue + Sub-issue hierarchy so sprint-planners can estimate and assign stories, and tasks remain visible as checklists without flooding the board.
> **Promote with:** hand-author `EPIC-004-*.md` + features, or run `planr epic create`/`planr feature create` once the shape is accepted.

---

## Alignment

Sources of truth this brief is aligned against:

- **Architectural precedent:** [src/cli/commands/github.ts](../src/cli/commands/github.ts), [src/services/github-service.ts](../src/services/github-service.ts) — the existing GitHub push/sync command is the closest pattern; Linear integration should match its shape wherever possible (auth flow, config block, dry-run defaults, per-artifact frontmatter annotations).
- **Credentials:** [src/services/credentials-service.ts](../src/services/credentials-service.ts) — existing three-tier resolver (env var → keytar → encrypted file). Linear PAT must plug into this, not grow a parallel mechanism.
- **Artifact hierarchy ground truth:** OpenPlanr's TaskList is **per-feature**, not per-story. One `TASK-XXX-*.md` file covers all the stories grouped under `FEAT-XXX`. Tasks are markdown checkboxes inside that one file. Confirmed by [src/templates/tasks/task-list.md.hbs](../src/templates/tasks/task-list.md.hbs) and every existing task artifact in `.planr/tasks/`.
- **External SDK:** [@linear/sdk](https://developers.linear.app/docs/sdk/getting-started) — first-party TypeScript SDK wrapping Linear's GraphQL API. Authentication via personal access token or OAuth.
- **Not the foundation:** [@linear/import](https://github.com/linear/linear/tree/master/packages/import) — a one-way CSV/JSON importer for seeding Linear from other tools. Useful as a reference for issue-body formatting and label conventions, but not the base — we need ongoing push/sync, not one-shot ingestion.

---

## Why this exists (one paragraph)

OpenPlanr hierarchies live in `.planr/` where developers and AI agents can reach them. Product managers and sprint planners don't work in `.planr/` — they work in Linear. Today the gap is bridged by copy-paste (a PM reads the epic.md, retypes it as a Linear project, creates feature issues by hand) or ignored (Linear drifts from the plan). `planr linear` closes the gap with a **full-hierarchy push plus bidirectional sync**: epic → Linear Project, features → top-level issues, user stories → sub-issues (sprint-plannable, estimable), and the per-feature TaskList → a dedicated "Tasks for FEAT-XXX" sub-issue where tasks live as Linear-native markdown checkboxes. Checking a box in Linear syncs back to the local `.md`; flipping `[ ]`→`[x]` locally pushes to Linear.

## Architectural thesis (this drives everything below)

Three decisions, load-bearing:

1. **Mirror the OpenPlanr hierarchy into Linear's native constructs — but respect OpenPlanr's grouping.** Epic ↔ Project, Feature ↔ top-level Issue, Story ↔ sub-issue, **TaskList ↔ one sub-issue per Feature (not per story)**. The last one is the key insight: OpenPlanr groups all a feature's tasks into one file because that's the implementation unit. Linear reflects that — one "Tasks for FEAT-XXX" sub-issue per feature, tasks inside as checkboxes. Item count scales as features × (stories + 1), not features × stories × tasks. Medium project ≈ 31 Linear items.
2. **One direction first for status; bidirectional for task checkboxes.** OpenPlanr → Linear push is v1 for everything. Linear → OpenPlanr status sync is v1 for issues. **Task checkbox state syncs both ways** (this is the hard bit — see risks). Comment threading, assignee routing, cycle assignment, label taxonomy land in v2+.
3. **Linear-side objects mirror meaning, not structure.** Epic becomes a Linear Project because Projects group related work with a roadmap. Feature becomes a top-level Issue because it's the PM tracking unit. Stories are sub-issues because they're the sprint-planning unit. Tasks are *inside* the TaskList sub-issue's description because they're a developer checklist, not tracking units.

## Design principles

1. **Mirror the hierarchy, respect the grouping.** Four OpenPlanr artifact types → four Linear constructs. Don't invent new levels; don't collapse existing ones.
2. **Match `planr github` where possible.** Users already know the push/sync shape from GitHub integration. Same flag surface, same frontmatter annotations, same credential resolution.
3. **Idempotent writes.** Re-running any push updates existing items (via stored `linearIssueId` in frontmatter); never creates duplicates.
4. **Dry-run first-class.** Every destructive command has `--dry-run` that prints exactly what would be created/updated in Linear. CI-friendly.
5. **Fail closed on auth / permissions / name collisions.** If the PAT can't resolve the team, or a Linear Project with the same name already exists uncoupled to OpenPlanr, refuse to run rather than creating orphans or silent merges.
6. **Cross-link, don't embed.** When a Feature has a GitHub issue in frontmatter, the Linear description includes a markdown link. We don't pull GitHub issue bodies into Linear — we link.
7. **Treat Linear state as source of truth for Linear-side fields.** Once an issue exists in Linear, status/assignee/cycle are whatever Linear says. OpenPlanr mirrors them into frontmatter on sync.
8. **Tasks are markdown, not sub-sub-issues.** A feature with 30 tasks produces 1 "Tasks for FEAT-XXX" sub-issue, not 30 sub-sub-issues. Linear checkboxes are first-class UI; use them.

---

## v1 scope

### Command surface

```
planr linear init                      # auth + team selection; writes config
planr linear push <ARTIFACT-ID>        # push epic (→ project + features + stories + tasklist sub-issues)
  [--dry-run]                          # print plan, no writes
  [--update-only]                      # don't create new items; only update existing
  [--levels project,features,stories,tasks]   # default: all four; limit to a subset
planr linear sync                      # pull back: issue status/assignee + task-checkbox state
  [--dry-run]
  [--scope EPIC-XXX]                   # limit sync to one epic's subtree
planr linear status                    # mapping table: OpenPlanr id ↔ Linear id/url, last sync timestamp
```

Accepted `<ARTIFACT-ID>` values: epic, feature, story, or task. Push descends — pushing an epic pushes everything underneath. Pushing a feature pushes that feature's stories + tasklist. Pushing a story pushes only that story. Pushing a tasklist pushes only the tasks checklist update.

**Explicitly not in v1:**

- Bidirectional comment sync
- Label taxonomy sync (labels are a Linear-side admin concern)
- Cycle / sprint assignment (Linear has cycles; OpenPlanr has sprints; mapping is non-trivial)
- Custom field sync
- Linear → OpenPlanr artifact creation (if a PM creates an issue in Linear, it stays there)
- OAuth (PAT only in v1)

### Mapping table


| OpenPlanr                                 | Linear                                                                                                          | Fields carried across                                                                                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epic (`.planr/epics/EPIC-XXX-*.md`)       | **Project**                                                                                                     | `title` → project name; `businessValue + problemStatement + solutionOverview` → project description; `status` → project state                                                                      |
| Feature (`.planr/features/FEAT-XXX-*.md`) | **Top-level Issue** inside the Epic's Project                                                                   | `title` → issue title; `overview + functionalRequirements + risks + successMetrics` → issue description (markdown); `status` → issue state; GitHub issue link appended to description when present |
| User Story (`.planr/stories/US-XXX-*.md`) | **Sub-issue of the parent Feature**                                                                             | `title` → sub-issue title; `role / goal / benefit` formatted as "As a ... I want ... so that ..."; `@v1` Gherkin scenarios inlined as "Acceptance Criteria"; `additionalNotes` → appended section  |
| TaskList (`.planr/tasks/TASK-XXX-*.md`)   | **Dedicated "Tasks for FEAT-XXX" sub-issue of the parent Feature** (one per feature, regardless of story count) | Every `- [ ]`/`- [x]` task from the file → Linear markdown checkbox in the issue description; "Relevant Files" section appended verbatim; "Acceptance Criteria Mapping" appended verbatim          |
| Sprint                                    | —                                                                                                               | Linear has Cycles; mapping non-trivial; deferred to v2+                                                                                                                                            |
| ADR                                       | —                                                                                                               | Stays in `.planr/adrs/`; link from the epic's project description when present                                                                                                                     |
| Gherkin (`US-XXX-gherkin.feature`)        | Inlined under "Acceptance Criteria" in the parent Story's sub-issue — only `@v1` scenarios                      | —                                                                                                                                                                                                  |


Item count for a medium project:

```
1 Project (epic)
5 top-level Issues (features)
20 sub-issues (stories, avg 4 per feature)
5 sub-issues (TaskList, one per feature)
= 31 Linear items
```

Not 86. Not 10. The right size for Linear's UI to handle gracefully while keeping every OpenPlanr artifact represented.

### Frontmatter additions

On the **epic**:

```yaml
linearProjectId: "9b2f4c3e-…"
linearProjectIdentifier: "ENG-PLAN-1"
linearProjectUrl: "https://linear.app/acme/project/..."
```

On the **feature**:

```yaml
linearIssueId: "…"
linearIssueIdentifier: "ENG-42"
linearIssueUrl: "https://linear.app/acme/issue/ENG-42"
```

On the **user story**:

```yaml
linearIssueId: "…"
linearIssueIdentifier: "ENG-43"
linearIssueUrl: "https://linear.app/acme/issue/ENG-43"
linearParentIssueId: "…"       # FK to the feature's Linear issue
```

On the **TaskList**:

```yaml
linearIssueId: "…"
linearIssueIdentifier: "ENG-47"
linearIssueUrl: "https://linear.app/acme/issue/ENG-47"
linearParentIssueId: "…"       # FK to the feature's Linear issue
linearTaskChecklistSyncedAt: "2026-04-22T12:00:00Z"   # last bidirectional checkbox sync
```

These are additive to the existing `githubIssue` fields — both can coexist.

### Config (`.planr/config.json`)

```json
{
  "linear": {
    "teamId": "team-uuid",
    "teamKey": "ENG",
    "defaultProjectLead": "user-uuid",
    "statusMap": {
      "planning": "Backlog",
      "in-progress": "In Progress",
      "done": "Done"
    }
  }
}
```

Written by `planr linear init`. Users can hand-edit if they already know the IDs or want to customize the status mapping for a team with non-default workflow states.

### Credential storage

Reuses [credentials-service.ts](../src/services/credentials-service.ts):

- Env var: `LINEAR_API_KEY`
- Keytar entry: `planr:linear`
- Encrypted file fallback: `~/.planr/credentials.enc` under key `linear`

`planr linear init` prompts for a PAT (with a link to `https://linear.app/settings/account/security`) and stores via the same three-tier resolver every other provider uses. No new credential plumbing.

### Dry-run output shape

```
$ planr linear push EPIC-002 --dry-run

Linear team: Engineering (ENG)
Would create Linear Project: "Stakeholder Reporting & PM Intelligence Layer"
  Description: [first 200 chars from epic.md]
  Lead: Asem Abdo

Would create 5 top-level issues (features):
  ENG-TBD: Report Generation Engine with Template System (from FEAT-005)
  ENG-TBD: Evidence-Linked Claims System (from FEAT-006)
  ENG-TBD: Report Quality Linter with Validation Rules (from FEAT-007)
  ENG-TBD: Multi-format Delivery & Distribution (from FEAT-008)
  ENG-TBD: Standup Dictation Mode (from FEAT-009)

Would create 18 story sub-issues:
  Under FEAT-005 (3): US-014, US-015, US-016
  Under FEAT-006 (3): US-017, US-018, US-019
  Under FEAT-007 (3): US-021, US-022, US-023
  Under FEAT-008 (4): US-024, US-025, US-026, US-027
  Under FEAT-009 (3): US-029, US-030, US-031
  Under FEAT-011 from EPIC-003 (1): US-052 (moved after revise fix #2)

Would create 5 "Tasks for FEAT-XXX" sub-issues:
  ENG-TBD: Tasks for FEAT-005 (14 checkbox items)
  ENG-TBD: Tasks for FEAT-006 (12 checkbox items)
  ENG-TBD: Tasks for FEAT-007 (18 checkbox items)
  ENG-TBD: Tasks for FEAT-008 (11 checkbox items)
  ENG-TBD: Tasks for FEAT-009 (13 checkbox items)

Total: 1 project + 5 + 18 + 5 = 29 Linear items.
Nothing written. Re-run without --dry-run to push.
```

---

## Engineering plan — phases

Each phase = one reviewable PR, sized against the `planr github` integration as a reference.

### Phase 1 — Auth, team selection, config (`planr linear init`)

- Add `@linear/sdk` dependency
- `src/services/linear-service.ts`: thin wrapper around `LinearClient` with `getTeams()`, `createProject()`, `createIssue()`, `updateIssue()`, `getIssue()`, `createSubIssue()`, typed error mapping
- Interactive selection flow: list teams → pick → validate PAT with a round-trip read test
- Write `linear.teamId` / `linear.teamKey` / `linear.statusMap` defaults to `.planr/config.json`
- Credential storage via existing `saveCredential('linear', token)`
- New `src/cli/commands/linear.ts` registering `linear init`
- Tests: mocked LinearClient, credential round-trip, collision detection

**Done when:** `planr linear init` successfully stores a PAT and team ID, and `planr linear status` (added in Phase 4) can query the team name back.

### Phase 2 — `planr linear push` — four-level descent

- Resolve the full subtree under the target artifact:
  - Epic → its features → their stories → their tasklist
  - Feature → its stories → its tasklist
  - Story → just that story
  - TaskList → just that tasklist (checkbox sync)
- `buildProjectDescription(epic)`, `buildFeatureIssueBody(feature, githubIssue)`, `buildStoryIssueBody(story, gherkin)`, `buildTasklistIssueBody(tasklist)` helpers
- `buildTasklistIssueBody` preserves task numbering (`1.1`, `1.2`, etc.) and renders each as a Linear markdown checkbox with state mirroring the local `[ ]`/`[x]`
- Idempotent create-or-update per artifact: check the relevant `linear*Id` frontmatter field
- Parent-child linking via Linear's `parentId` on sub-issue creation
- Write all new IDs back to frontmatter via existing `updateArtifactFields`
- `--dry-run` prints the full four-level plan without writing anywhere
- `--update-only` skips `create` calls
- `--levels` restricts which levels get pushed (`project,features` to skip stories/tasklist; `tasks` for just tasklist-checkbox sync; etc.)
- Tests: create path, update path, mixed (some artifacts new / some existing), frontmatter round-trip, parent-id FK integrity

**Done when:** `planr linear push EPIC-002` on this repo creates a Linear Project with 5 feature issues, 18 story sub-issues, 5 TaskList sub-issues, writes IDs back to every artifact's frontmatter, and re-running touches nothing when content is unchanged.

### Phase 3 — `planr linear sync` — issue status + task checkbox bidirectional

- Iterate all artifacts with a `linear*Id`; fetch current Linear state
- **Issue status sync (one-way Linear → OpenPlanr):** Linear state → OpenPlanr `status` via `statusMap`; write to frontmatter on drift
- **Task checkbox sync (bidirectional, load-bearing):**
  - Fetch the TaskList sub-issue's current description from Linear
  - Parse checkbox lines; match to local `TASK-XXX-*.md` lines by task number (`1.1`, `1.2`)
  - Three-way merge: if local and Linear agree, no-op. If only one side changed, adopt that side. If both changed to different values, prompt the user (or auto-pick Linear if `--prefer-remote`, local if `--prefer-local`)
  - Update `linearTaskChecklistSyncedAt` frontmatter after each successful sync
- `--scope EPIC-XXX` limits to one epic's subtree
- `--dry-run` shows the diff without writing
- Per-run summary: "8 status updates, 14 checkbox flips (12 local→remote, 2 remote→local), 3 conflicts resolved, 0 errors"
- Tests: divergent Linear state (Linear ahead, local ahead, both changed), conflict resolution, merge edge cases (task added locally but not in Linear, etc.)

**Done when:** ticking a checkbox in Linear and running `planr linear sync` flips the matching `TASK-XXX-*.md` checkbox locally; flipping one locally and running `planr linear push` flips it in Linear. Both directions tested.

### Phase 4 — Ergonomics + docs

- `planr linear status` — mapping table (OpenPlanr id, Linear identifier, Linear URL, current Linear state, last sync ts)
- README section (matching the `planr revise` / `planr github` sections)
- Troubleshooting: PAT permission scopes, team not found, project name collision, checkbox parsing failures
- Optional: `planr context` emits Linear links in the context pack so stakeholder reports can include them

**Done when:** a new user can read the README and get from zero to "my first epic pushed to Linear with stories and tasks" without reading source code.

### Phase 5 (v2, explicit non-goal for initial release)

- Bidirectional comment/thread sync
- Cycle ↔ Sprint mapping
- Label taxonomy sync
- OAuth flow (currently PAT-only)
- Assignee sync (requires user-id mapping between OpenPlanr author strings and Linear user IDs)
- Bulk backfill of existing Linear content into new `.planr/` artifacts (inverse direction)

---

## Architecture sketch (where things live)


| Concern                     | File                                                                                                                                            | Reuses                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Command entry               | `src/cli/commands/linear.ts`                                                                                                                    | registration pattern from `github.ts`, `revise.ts` |
| SDK wrapper                 | `src/services/linear-service.ts`                                                                                                                | `@linear/sdk`                                      |
| Credentials                 | existing [credentials-service.ts](../src/services/credentials-service.ts)                                                                       | no new plumbing                                    |
| Config schema               | [src/models/schema.ts](../src/models/schema.ts) — add `linear` block                                                                            | zod pattern from `reportLinter`                    |
| Frontmatter fields          | [src/models/types.ts](../src/models/types.ts) — add `linear`* fields as optional on ArtifactFrontmatter                                         | —                                                  |
| Body/description builders   | `src/services/linear-service.ts` (`buildProjectDescription`, `buildFeatureIssueBody`, `buildStoryIssueBody`, `buildTasklistIssueBody`)          | patterns from `github-service.ts` `buildIssueBody` |
| Status + checkbox mapping   | `src/services/linear-service.ts` (`linearStateToStatus`, `statusToLinearState`, `parseCheckboxes`, `serializeCheckboxes`, `mergeCheckboxState`) | parallel to `github-service.ts` mappers            |
| Checkbox bidirectional sync | `src/services/linear-checkbox-sync.ts` (new — merge logic lives here, isolated from the rest for testability)                                   | `src/utils/diff.ts` for conflict visualization     |
| Tests                       | `tests/unit/linear-service.test.ts`, `tests/unit/linear-checkbox-sync.test.ts`, `tests/unit/commands/linear.test.ts`                            | stub-client pattern from `github-service` tests    |


**No new top-level directories. No parallel stack.** Linear integration slots in as a sibling to `github-service.ts`. The checkbox sync logic is the one new concern that deserves its own file because the three-way merge is genuinely non-trivial.

---

## Open questions (decide before Phase 1 lands)

1. **Team selection: single team per project, or support multi-team?** Most OpenPlanr projects map to one Linear team. *Proposal: single `linear.teamId` in config; multi-team is a future extension.*
2. **Project-name collisions.** What if a Linear Project already exists with the epic's title? *Proposal: `planr linear push EPIC-XXX` errors on collision unless `--attach-project <linear-id>` is passed explicitly. No silent merges.*
3. **Status mapping granularity.** Linear workflows are per-team customizable. Default mapping assumes standard `Backlog/Todo/In Progress/Done`. *Proposal: ship a default mapping + let users override in config (`linear.statusMap`). Print the resolved mapping in `planr linear status`.*
4. **Rate limits.** Linear caps requests per team per hour. A full epic push (1 project + 5 features + 18 stories + 5 tasklists = 29 mutations) is comfortably under. A full sync across many epics might approach the limit. *Proposal: log request count in verbose mode; simple retry-with-backoff; batch queries only if/when measured 429s appear.*
5. **What happens when an artifact's frontmatter has `linearIssueId` but the issue doesn't exist in Linear anymore?** *Proposal: on sync, log a warning ("issue ENG-42 referenced but not found"), leave the frontmatter untouched. On next push, detect and offer to clear the stale ID.*
6. **Gherkin scenarios: inline or link?** Inline is denser and stands alone in Linear; linking requires Linear readers to have repo access. *Proposal: inline the `@v1` scenarios only (skip `@v2`) as an "Acceptance Criteria" section in the Story sub-issue body. Truncate scenario bodies to first 3 lines + "…" to keep issues readable.*
7. **Checkbox conflict resolution policy.** When local and Linear both changed a task checkbox between syncs, who wins? *Proposal: default is interactive prompt ("Local: checked / Linear: unchecked — keep which?"). `--prefer-remote` / `--prefer-local` flags for non-interactive runs. Never silently pick a side.*
8. **Task numbering stability.** Checkbox sync matches lines by task number (`1.1`, `1.2`). What if someone renumbers tasks locally? *Proposal: match by `(number, first-5-words-of-title)` composite key so renumbering with preserved text still matches. Fully-rewritten tasks are treated as delete + insert.*
9. **TaskList sub-issue state.** Does the "Tasks for FEAT-XXX" sub-issue itself have a status (e.g., "In Progress")? *Proposal: yes — `in-progress` when any checkbox is checked, `done` when all are checked, `Backlog` when none. Auto-updated on checkbox sync. Users can override the auto-state manually in Linear; auto-updates skip when a manual override is detected (different-state-and-recent-update heuristic).*

---

## Risks & mitigations


| Risk                                                                                         | Mitigation                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Large epics create 40+ Linear items — Linear board becomes noisy                             | Features-only push flag (`--levels project,features`) for PMs who want the top-level view; default full push keeps sprint-planners happy because stories are sub-issues (collapsed in most Linear views). |
| Checkbox three-way merge conflicts mid-sync — user picks wrong side                          | Interactive prompt by default; dry-run preview shows the merge plan before writing; task numbering composite key (#8) resists false conflicts from renumbering.                                           |
| Task number drift breaks matching                                                            | Composite key (number + first 5 words) tolerates renumbering; `planr linear status` surfaces unmapped tasks.                                                                                              |
| Idempotency breaks if frontmatter is edited by hand and IDs drift                            | Sync verifies IDs resolve on every run; stale IDs log a warning but don't cause errors. `planr linear status` surfaces drift.                                                                             |
| Linear rate limits on larger syncs                                                           | Simple retry-with-backoff; per-request logging in verbose mode; batch queries only if/when measured 429s appear.                                                                                          |
| PAT scopes too narrow — user generates read-only token, push fails with cryptic error        | `planr linear init` does a round-trip write test (create + immediately delete a test label, or similar low-blast-radius check) before accepting the token.                                                |
| Name collisions (epic title matches existing Linear project name)                            | Fail closed — require `--attach-project <id>` to opt into merging; never silently adopt an unrelated project.                                                                                             |
| Two-way comment sync deferred to v2 — users expect comments to flow                          | README leads with "v1 syncs status + task checkboxes. Comment and assignee bidirectional sync is v2." Set expectations explicitly.                                                                        |
| Linear-side schema changes (GraphQL) over time                                               | `@linear/sdk` abstracts this; pin the SDK minor version; add a post-install schema check in CI if it becomes an issue.                                                                                    |
| Auto-status inference on the TaskList sub-issue (question #9) overwrites a PM's manual state | Heuristic skip: if the issue's state was manually set within N minutes of sync and disagrees with checkbox-derived state, don't auto-update; log and leave it.                                            |


---

## Success criteria (for the engineer taking this on)

- `planr linear init` on a fresh machine gets a real user from zero to stored PAT + team ID in under 90 seconds.
- `planr linear push EPIC-002 --dry-run` on this repo prints a plausible four-level plan (project + 5 features + ~18 stories + 5 tasklists) without making any API calls.
- Running the same command without `--dry-run` creates all items, links parent-child correctly, and writes `linear`* fields to every artifact's frontmatter.
- Re-running the same command produces zero creates and zero updates when nothing changed locally or remotely — idempotency verified.
- Closing a Linear issue manually, then `planr linear sync`, flips the matching artifact's `status` in frontmatter.
- Ticking a checkbox in a "Tasks for FEAT-XXX" Linear sub-issue, then `planr linear sync`, flips the matching `- [ ]`→`- [x]` in the local `TASK-XXX-*.md`.
- Flipping a checkbox locally, then `planr linear push`, flips it in Linear.
- Both checkboxes touched between syncs → conflict prompt; `--prefer-remote` or `--prefer-local` resolves non-interactively.
- Total v1 diff (Phases 1–4) fits in four PRs, each reviewable in under 30 minutes.
- No new patterns introduced — every decision aligns with how `planr github` already works.

---

## Out of scope (for clarity — not just "maybe later")

- Sub-sub-issues for individual tasks (tasks are checkboxes by design, not issues)
- Bidirectional comment / thread sync (deferred)
- Cycle ↔ Sprint mapping (deferred, non-trivial)
- Label taxonomy sync (admin concern, out of OpenPlanr's lane)
- OAuth authentication (PAT is sufficient for CLI workflows)
- Assignee sync (requires user-id mapping — deferred)
- Linear → OpenPlanr artifact creation (if a PM creates work in Linear, it stays in Linear)
- Multi-team push (one OpenPlanr project → one Linear team in v1)

---

## Next action

If this brief is directionally right: I turn it into `EPIC-004-linear-integration.md` + five FEAT files (FEAT-019 Auth & init, FEAT-020 Four-level push, FEAT-021 Status sync, FEAT-022 Task-checkbox bidirectional sync, FEAT-023 Ergonomics & docs) + matching stories and tasks, so the work is plannable in OpenPlanr itself.

If you want changes first — different conflict-resolution default, narrower scope, split task-sync from status-sync, change the tasklist-sub-issue convention — redirect me here and I'll revise this doc before promoting it.