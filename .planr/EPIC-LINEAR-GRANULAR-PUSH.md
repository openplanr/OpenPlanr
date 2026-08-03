# Linear Integration v2 — Granular Push & Flexible Epic Mapping

> **Status:** Design brief, not yet formalized as `EPIC-005`.
> **Authors:** Asem + Claude (planning pass, 2026-04-22).
> **Depends on:** EPIC-004 (`planr linear` v1) — shipped. This brief builds on that foundation.
> **Scope:** two connected UX improvements — (1) push any artifact type, not just epics; (2) let the user choose how an epic maps to Linear (new project / milestone of existing / label on existing).
> **Promote with:** hand-author `EPIC-005-*.md` + features, or run `planr epic create` once the shape is accepted.

---

## Alignment

- **Architectural precedent:** [.planr/EPIC-LINEAR-INTEGRATION.md](./EPIC-LINEAR-INTEGRATION.md) — the v1 brief; mapping table, data model, and credential plumbing stand unchanged.
- **Shipped v1:** [src/cli/commands/linear.ts](../src/cli/commands/linear.ts), [src/services/linear-push-service.ts](../src/services/linear-push-service.ts), [src/services/linear-pull-service.ts](../src/services/linear-pull-service.ts) — `runLinearPush(projectDir, config, client, epicId, options)` is the entry point we'll generalize.
- **Linear SDK capabilities confirmed:**
  - `projectMilestoneId` on issues — supported ([_generated_documents.d.ts](../node_modules/@linear/sdk/dist/_generated_documents.d.ts))
  - `labelIds` on issues — supported via `createIssueLabel` + `IssueLabel` ([_generated_sdk.d.ts](../node_modules/@linear/sdk/dist/_generated_sdk.d.ts))
  - `client.createProjectMilestone({ projectId, name, targetDate })` — supported
- **Related backlog:** none new.

---

## Why this exists

Two real gaps in the v1 UX, both surfaced by the question "can I push a single task?":

1. **Granularity.** v1 push is epic-only. Users who edit one feature, one story, or one task file must re-run the full epic push (idempotent, but wasteful) or accept that there is no targeted "just this thing" command. Quick tasks (`QT-XXX`) and backlog items (`BL-XXX`) have no push path at all — they exist in `.planr/` with no way to surface in Linear.

2. **Linear-side structure.** v1 always creates a new Linear Project per Epic. For teams where epics are small or where multiple OpenPlanr epics belong to one larger Linear initiative, "one project per epic" either floods Linear with tiny projects or forces hand-consolidation later. Linear's own model (`Project > Milestone > Issue` + `Label`) already supports finer-grained containment; we just don't expose the choice.

**Product promise of v2:** point `planr linear push` at any artifact id and get the smallest meaningful Linear update; when pushing an epic for the first time, offer three honest mapping strategies and remember the choice forever.

---

## UX principles

1. **Smallest effective unit by default.** If you point at a feature, push that feature + its direct descendants. If you point at a story, push just the story. Don't secretly touch siblings.
2. **Parent chain is a pre-requisite, not a surprise.** If a child's parent isn't in Linear yet, fail fast with a suggested fix — never silently create orphans.
3. **First push = explicit mapping choice, remembered forever.** Ask once when the mapping is undefined; never ask again once stored.
4. **Idempotency preserved.** Re-running any push command is safe; the cache + stored ids prevent duplicates across all granularities.
5. **Flag parity with `push EPIC`.** `--dry-run`, `--update-only`, `--allow-dirty` behave identically regardless of scope.
6. **Quick tasks and backlog get a home, not a hack.** `QT-XXX` and `BL-XXX` map to a **single user-chosen "standalone" Linear project** set once at init time. Not every artifact needs a special case.

---

## v2 scope

### Command surface (additions in bold; rest unchanged from v1)

```
planr linear init                             # unchanged — plus new optional --standalone-project <id|name>
planr linear push <ARTIFACT-ID>               # generalized — accepts any id prefix
  [--dry-run] [--update-only] [--allow-dirty]
  [--as project|milestone-of:<ID>|label-on:<ID>]   # NEW — override or set first-time mapping
planr linear sync ...                         # unchanged
planr linear status                           # unchanged
planr linear tasklist-sync ...                # unchanged
planr linear unlink <ARTIFACT-ID>             # NEW — clear the linear* frontmatter fields, optionally archive the Linear item
```

### Accepted `<ARTIFACT-ID>` values by prefix

| Prefix | Type | What push does |
|---|---|---|
| `EPIC-` | epic | Same as v1 — full subtree (project/milestone/label + features + stories + tasklists) |
| `FEAT-` | feature | Feature issue + its stories + its tasklist sub-issue. **Requires parent epic already mapped.** |
| `US-` | story | One story sub-issue. **Requires parent feature already mapped.** |
| `TASK-` | task file | One "Tasks for FEAT-XXX" sub-issue (or its update). **Requires parent feature already mapped.** |
| `QT-` | quick task | One top-level issue in the configured standalone project. Independent — no parent required. |
| `BL-` | backlog item | Same as QT: top-level issue in standalone project, with a `backlog` label applied. |
| `SPRINT-` | sprint | **Out of scope v2** — Linear cycles vs OpenPlanr sprints is a separate mapping question. |
| `ADR-` | ADR | **Out of scope** — not pushed to Linear at all. |

### Epic mapping strategies (first-push-only prompt)

Stored in frontmatter as `linearMappingStrategy` on the Epic:

| Strategy | Linear shape | When it's right |
|---|---|---|
| `project` (default) | One Linear Project, Epic = Project | Large epic; its own roadmap; independent lifecycle. |
| `milestone-of:<PROJECT-ID>` | Epic becomes a `ProjectMilestone` inside an existing project; features become issues with `projectMilestoneId` set | Epic is a phase of a larger initiative (e.g., "Alpha milestone of the 2026 platform rebuild"). Keeps cross-epic visibility on one Linear board. |
| `label-on:<PROJECT-ID>` | Epic becomes a label in the project; features become issues in that project with the label applied | Small epic / mini-initiative that shouldn't own its own project scaffolding. |

Frontmatter on the Epic after first push:
```yaml
linearMappingStrategy: "project" | "milestone-of" | "label-on"
linearProjectId: "9b2f4c3e-..."                 # the project (always present — the container)
linearProjectIdentifier: "ENG-ROADMAP-26"       # human-readable
linearProjectUrl: "https://linear.app/..."
linearMilestoneId: "..."                        # present only when strategy === "milestone-of"
linearLabelId: "..."                            # present only when strategy === "label-on"
```

Feature/Story/TaskList frontmatter adds (when strategy ≠ `project`):
```yaml
linearProjectMilestoneId: "..."    # if epic is a milestone-of
linearLabelIds: ["..."]            # if epic is a label-on
```

### Config additions

```jsonc
{
  "linear": {
    "teamId": "...",
    "standaloneProjectId": "UUID",         // NEW — where QT-* and BL-* land
    "standaloneProjectName": "Planr Tasks", // NEW — display only
    "defaultEpicStrategy": "project"        // NEW — skip the first-push prompt when set
  }
}
```

---

## User journeys

Six flows cover every reasonable interaction. Each is designed to make the user's next action obvious.

### Journey 1 — First-time epic push (mapping prompt)

```
$ planr linear push EPIC-003
First Linear push for EPIC-003. How should this epic map to Linear?

  (a) Create a new Linear Project                    ← recommended; Epic = Project (the v1 behavior)
  (b) Attach to an existing project as a Milestone   ← good for phased initiatives
  (c) Attach to an existing project as a Label       ← good for small epics inside a larger project

  › a

Creating Linear project "Plan Revision Layer"...
  ✓ project created  linear.app/acme/project/plan-revision-layer
  ✓ 5 features pushed
  ✓ 18 stories pushed as sub-issues
  ✓ 5 tasklist sub-issues with 67 checkboxes

linearMappingStrategy written to EPIC-003 frontmatter — re-runs will skip this prompt.
Next: `planr linear status --scope EPIC-003` to verify.
```

Choosing `(b)` or `(c)` branches into:

```
  › b
Pick the target Linear project:
  1. 2026 Platform rebuild      linear.app/acme/project/platform-rebuild-2026
  2. Reporting layer            linear.app/acme/project/reporting
  3. (back)

  › 1
Milestone name for EPIC-003 in "2026 Platform rebuild":
  › Plan Revision Layer

  ✓ milestone created
  ✓ 5 features pushed as issues with projectMilestoneId set
  ✓ ...
```

### Journey 2 — Push a single feature under an already-mapped epic

```
$ planr linear push FEAT-015
Detected type: feature. Parent epic EPIC-004 → project linear.app/acme/project/linear-integration

  ✓ FEAT-015: Linear Authentication and Team Selection — updated
  ✓ 3 stories under FEAT-015 — 2 updated, 1 unchanged
  ✓ tasklist sub-issue — 14 checkboxes, 2 flipped

Tokens: 0 (push is local+API only, no AI)
```

### Journey 3 — Push a feature whose parent epic isn't pushed yet

```
$ planr linear push FEAT-015
⚠ Parent epic EPIC-004 has not been pushed to Linear yet.

  (a) Push the full epic first (recommended — creates project + all features + stories)
  (b) Cancel and push the epic manually first
  (c) Attach this single feature as an orphaned top-level issue (not recommended)

  › a
Running full epic push for EPIC-004...
  ✓ ...
```

### Journey 4 — Push a single story

```
$ planr linear push US-054
Detected type: story. Parent feature FEAT-015 → linear.app/acme/issue/ENG-42

  ✓ US-054: Linear PAT Authentication Setup — updated

Re-running is idempotent; only the story's issue body changes.
```

### Journey 5 — Push a task file (checkbox state only)

```
$ planr linear push TASK-015
Detected type: task file. Parent feature FEAT-015 → issue ENG-42

  ✓ Tasks for FEAT-015 — 14 checkboxes, 5 now ticked in Linear
  Note: bidirectional state merging is `planr linear sync` territory; push is local→Linear only.

Tip: if you want the Linear side reflected back, run `planr linear tasklist-sync` after.
```

### Journey 6 — Push a quick task

```
$ planr linear push QT-007
Detected type: quick task.

(first time — prompts for a standalone project to host QTs and BLs)
No standalone project configured for quick tasks and backlog items.
Pick one of your Linear projects to act as the "Planr standalone" bucket:

  1. Quick tasks & ops          linear.app/acme/project/quick-tasks
  2. + Create new project "Planr"
  3. Cancel

  › 1
Saved to .planr/config.json → linear.standaloneProjectId.
Re-runs will use this without asking.

  ✓ QT-007: Implement webhook retry — created as issue ENG-501
```

---

## Error & edge-case handling

| Case | Behavior |
|---|---|
| Artifact id unknown (typo) | Error: "No artifact matches `FEAT-999`. Did you mean FEAT-915?" (uses existing fuzzy-match logic). |
| Parent chain partially broken (epic has linearProjectId but the project was deleted in Linear) | Sync detects this on next run; push refuses and suggests `planr linear unlink EPIC-XXX` + re-push. |
| Epic pushed with strategy A, user now wants strategy B | `planr linear push EPIC-XXX --as milestone-of:<project-id>` — unlinks old mapping first, re-creates under new strategy. Prompts for confirmation because this archives the old Linear project/issues. |
| Label-on strategy: existing feature has the label removed by someone in Linear | Push re-applies the label idempotently. |
| Milestone-of strategy: target milestone deleted | Push errors with "milestone not found; re-run with `--as project` or `--as milestone-of:<id>`". |
| `QT-XXX` pushed before standalone project is configured | Interactive: pick or create a project. Non-interactive: error telling user to set `linear.standaloneProjectId` in config. |
| `SPRINT-XXX` or `ADR-XXX` push attempted | Error: "Sprints and ADRs don't push to Linear in v2. Track sprints via Linear cycles manually." |
| `planr linear unlink EPIC-XXX` while features are still linked | Warns and cascades unlinking: strips Linear fields from epic + all its descendants. Does NOT delete the Linear items (reversible by re-push). |

---

## Implementation plan — phases

Each phase is one reviewable PR. Phase 1 ships the biggest win (granular push for feature/story/task); everything else layers on.

### Phase 1 — Generalize push scope: feature / story / task

- Rename `runLinearPush(projectDir, config, client, epicId, options)` →
  `runLinearPush(projectDir, config, client, artifactId, options)`.
- Add `loadLinearPushScope` variants: `loadForFeature`, `loadForStory`, `loadForTaskFile` — each returns the minimal subtree the push needs.
- Detect type from the id prefix via existing `findArtifactTypeById`.
- Validate parent chain: if parent epic/feature isn't mapped in Linear, interactive prompt (or `--push-parents` flag for non-interactive) to run the missing parent pushes first.
- Update `buildLinearPushPlan` to plan at any scope (single-artifact plan returns 1-row plan).
- Tests: fake-client pattern from `linear-service-errors.test.ts` covers create + update for each granularity, plus one test per "parent missing" path.

**Done when:** `planr linear push FEAT-015 --dry-run`, `planr linear push US-054 --dry-run`, and `planr linear push TASK-015 --dry-run` all produce accurate 1- or few-row plans without calling the API.

### Phase 2 — Epic mapping strategies (project / milestone-of / label-on)

- First-push interactive prompt (Journey 1).
- Persist strategy + related Linear id to epic frontmatter.
- Three code paths in `runLinearPush` for the epic-creation branch:
  - `project` — existing behavior (creates `LinearProject`).
  - `milestone-of` — calls `createProjectMilestone({ projectId, name })`, sets `linearMilestoneId` on epic; every descending issue carries `projectMilestoneId`.
  - `label-on` — calls `createIssueLabel({ teamId, name })`, sets `linearLabelId` on epic; every descending issue carries `labelIds: [...]`.
- `--as` flag overrides or sets the strategy explicitly (useful for CI and for restrategizing).
- Tests: one per strategy, including the descendant-attribute propagation.

**Done when:** an epic pushed under each of the three strategies lands with the right Linear-side shape and correct frontmatter.

### Phase 3 — Quick task + backlog push (`QT-`, `BL-`)

- New `loadLinearPushScope.loadForQuickTask` and `loadForBacklogItem`.
- `linear.standaloneProjectId` config resolution + first-time interactive setup.
- Backlog items get a `backlog` label applied automatically so PMs can filter.
- Tests: create/update path, standalone-project-missing → interactive prompt stub.

**Done when:** `planr linear push QT-007` and `planr linear push BL-001` land issues in the configured standalone project, and re-runs are idempotent.

### Phase 4 — Unlink command (`planr linear unlink <ID>`)

- Clears the `linear*` frontmatter on the target artifact.
- Cascades to descendants when target is an epic (with confirmation).
- Optional `--archive-remote` flag: also archive the corresponding Linear item (never deletes).
- Tests: cascade semantics, dry-run preview.

**Done when:** a user can cleanly re-strategize an epic (unlink + push with new `--as`).

### Phase 5 — Restrategize flow

- `planr linear push EPIC-XXX --as <new-strategy>` when a strategy is already stored.
- Interactive confirmation that explains the blast radius (archives old mapping, re-creates under new strategy, all descendant ids change).
- Preserves issue/story content; only the containment shape changes.

**Done when:** a user who picked `project` for EPIC-003 can migrate it to `milestone-of:ENG-26` with one command.

### Out of scope for v2 (explicit non-goals)

- Sprint ↔ Cycle mapping
- ADR push to Linear Documents
- Feature-level mapping strategies (features always map to top-level issues within the epic's project)
- Multi-team push (still one team per OpenPlanr project, per v1)
- OAuth (still PAT-only)

---

## Architecture sketch (where new code lives)

| Concern | File |
|---|---|
| Generalized push entry | `src/services/linear-push-service.ts` — `runLinearPush(artifactId, ...)` dispatches on prefix |
| Scope loaders | same file — new `loadForFeature`, `loadForStory`, `loadForTaskFile`, `loadForQuickTask`, `loadForBacklogItem` |
| Mapping strategies | `src/services/linear-mapping-strategies.ts` (new) — pure functions: `createAsProject`, `createAsMilestone`, `createAsLabel` |
| Prompt flows | `src/services/prompt-service.ts` — add `promptMappingStrategy`, `promptStandaloneProject` |
| Unlink | `src/services/linear-unlink-service.ts` (new) |
| CLI wiring | `src/cli/commands/linear.ts` — `push` action routes by id prefix; new `unlink` subcommand; `--as` flag |
| Config schema | `src/models/schema.ts` — add `standaloneProjectId`, `standaloneProjectName`, `defaultEpicStrategy` |
| Types | `src/models/types.ts` — `LinearMappingStrategy` union, extended frontmatter fields |

No new top-level directories. Every file sits beside an existing linear-* precedent.

---

## Frontmatter migration

- **Existing epics pushed under v1** have `linearProjectId` but no `linearMappingStrategy`. The loader treats missing strategy as `"project"` for backward compatibility. No migration needed.
- **New fields** are all additive / optional. Running v1 commands against v2-written frontmatter is safe (v1 ignores unknown fields).

---

## Open questions (decide before Phase 1 lands)

1. **When the parent chain is missing on a granular push, is the default "push the missing parents automatically" or "ask every time"?** Proposal: interactive = ask; non-interactive (`--yes` or CI) = push parents by default (safer than failing mid-pipeline).
2. **Should `planr linear push` with no argument mean "push everything dirty"?** Attractive but ambiguous — skipping for v2. Can add later as `planr linear push --all-dirty`.
3. **Does `QT-XXX` really belong in Linear, or should it stay local?** Argument for: some teams use Linear for everything including ops tasks. Argument against: QTs are lightweight by design; pushing them creates ceremony. Proposal: opt-in via `linear.standaloneProjectId` being set; if unset, `planr linear push QT-XXX` errors with a useful message.
4. **For the label-on strategy, should the label be scoped to the team or to the project?** Linear supports both. Proposal: team-scoped (matches Linear's default UX and lets the same label get reused across projects if the user wants).
5. **Should restrategize (Phase 5) archive the old Linear items or leave them?** Archive is safer. Proposal: archive by default, with `--keep-old-linear-items` for the rare case where the user wants both to coexist.

---

## Success criteria

- A user who edits one feature's acceptance criteria can `planr linear push FEAT-015` and see exactly one Linear issue update within 5 seconds.
- A user who runs `planr linear push EPIC-003` for the first time is presented with three mapping options and the chosen strategy is stored immutably in the epic's frontmatter.
- A user who picks `milestone-of:<project-id>` sees the epic appear as a milestone (not a project) in the target Linear project, with all features as issues carrying `projectMilestoneId`.
- A user who runs `planr linear push QT-007` for the first time is prompted once to pick a standalone Linear project; subsequent QT/BL pushes use it silently.
- Every granular push command supports `--dry-run` with byte-identical "nothing was written" behavior verified by tests.
- Re-running any push at any granularity is idempotent (0 creates, 0 updates for unchanged content).

---

## Recommendation

**Ship Phase 1 first as a standalone patch.** It's the most-asked-for enhancement ("can I push just this feature?") and is additive — no breaking changes to v1. Phases 2–5 can follow as separate releases without pressure, each adding one clean feature.

**Start with Phase 1 today, defer Phases 2–5 to dedicated iterations.** This matches OpenPlanr's existing "tiny releases" cadence and lets real-world feedback on granular push inform the strategy-choice UX before we commit to it.

If you want to go all-in instead, the full 5-phase plan is 3–5 PRs' worth of work, fits cleanly on top of the existing linear integration, and carries no architectural risk. Your call on ambition level.

---

## Next action

If this brief is directionally right: I turn it into `EPIC-005-linear-integration-granular-push.md` + the matching features (FEAT-020…024) + stories + tasks. Or if you want to start narrow with just Phase 1, I can scope it as a single focused epic instead.

If you want to change the shape — different mapping strategies, different command surface, drop QT/BL entirely, restrategize differently — redirect me here and I'll revise the doc before we promote.
