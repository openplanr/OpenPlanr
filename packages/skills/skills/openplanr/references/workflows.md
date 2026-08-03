# OpenPlanr Workflows

Seven canonical end-to-end flows. Each one lists the trigger, the step-by-step command sequence, decision points (where to pause and confirm with the user), and common failure modes.

---

## 1. Initialize a new project

**Trigger:** User asks to plan anything in a repo with no `.planr/` directory, or explicitly says "set up OpenPlanr."

**Steps:**

1. Verify Node 20+ and the CLI:
   ```bash
   npx openplanr@latest --version
   ```
2. Initialize:
   ```bash
   planr init --name "<project-name>" --yes
   ```
3. Check AI is configured:
   ```bash
   planr config show
   ```
4. If AI provider missing, configure:
   ```bash
   planr config set-provider anthropic
   planr config set-key anthropic          # prompt the user for the key
   planr config set-model claude-sonnet-4-20250514
   ```

**Decision points:**
- Before writing credentials, confirm with the user which provider to use and whether a key is already exported in their environment.

**Failure modes:**
- "Node not found" → instruct user to install Node 20+.
- `.planr/` already exists → skip `init`; go straight to the planning command.

---

## 2. PRD → full agile hierarchy

**Trigger:** User hands you a PRD or spec file and says "plan this out" / "break this into epics and tasks."

**Steps:**

1. Ensure project is initialized (see Workflow 1).
2. Generate the epic from the PRD:
   ```bash
   planr epic create --file ./prd.md --yes
   ```
3. Read the generated `.planr/epics/EPIC-NNN-*.md` and summarize.
4. Cascade through the hierarchy — easiest with `plan`:
   ```bash
   planr plan --epic EPIC-001 --yes
   ```
   Or run each level manually:
   ```bash
   planr feature create --epic EPIC-001 --yes
   planr story create --epic EPIC-001 --yes       # all features at once
   planr task create --feature FEAT-001 --yes     # merged task list per feature
   ```
5. Generate agent rule files so the implementation agent has context:
   ```bash
   planr rules generate --yes
   ```
6. Summarize: count of epics/features/stories/tasks created, paths to the key artifacts, and suggested next step (pick a task to implement).

**Decision points:**
- After the epic is generated, confirm the scope with the user before cascading — they often want to adjust scope before committing to features.
- After stories are generated, offer to `refine --cascade` if quality looks low.

**Failure modes:**
- AI quota exhausted mid-cascade → resume with the specific sub-command (`planr story create --epic ...`, etc.) — already-created artifacts are not regenerated.
- PRD too large → model truncates; split the PRD into sections and run `epic create --file` per section.

---

## 3. Story → tasks

**Trigger:** User points at a story and says "break this into tasks" or "generate implementation tasks."

**Steps:**

1. Verify the story exists: `planr story list` (or `planr status`).
2. Run:
   ```bash
   planr task create --story US-001 --yes
   ```
3. Read `.planr/tasks/TASK-NNN-*.md` and summarize the subtask groups.
4. (Optional) If the feature has multiple related stories, consider the feature-level form instead:
   ```bash
   planr task create --feature FEAT-001 --yes      # merged across all stories
   ```

**Decision points:**
- Story-level vs feature-level: if the user wants a single cohesive work package, use `--feature`. If they want per-story granularity, use `--story`.

**Failure modes:**
- "Parent not found" → run `planr sync`, then retry.
- AI returns too-coarse tasks → refine with `planr refine TASK-NNN --yes`.

---

## 4. Quick task (no hierarchy)

**Trigger:** "I just need a task list for X — no need for the full agile ceremony."

**Steps:**

1. Create:
   ```bash
   planr quick create "migrate from sqlite to postgres" --yes
   ```
   Or from a spec:
   ```bash
   planr quick create --file migration-spec.md --yes
   ```
2. Read `.planr/quick/QT-NNN-*.md` and summarize.
3. (Optional) Later, promote into the hierarchy:
   ```bash
   planr quick promote QT-001 --feature FEAT-001
   ```

**Decision points:**
- If the task grows beyond ~8–10 subtasks, suggest promoting it to a proper story.

**Failure modes:**
- AI unavailable → use `--manual` (but that requires interactive input, so not agent-friendly).

---

## 5. Sprint cycle

**Trigger:** User wants to start, manage, or close a sprint.

**Steps:**

1. **Create:**
   ```bash
   planr sprint create --name "Sprint 12" --duration 2w --yes
   ```
2. **Load with tasks** — explicit or AI auto:
   ```bash
   planr sprint add TASK-001 TASK-002 QT-003 --yes
   # or
   planr sprint add --auto --yes
   ```
3. **Track mid-sprint:**
   ```bash
   planr sprint status
   ```
4. **Generate report:**
   ```bash
   planr report sprint --sprint SPRINT-012 --yes
   ```
5. **Close:**
   ```bash
   planr sprint close --yes
   ```
   Review carry-over tasks; re-add to the next sprint as needed.

**Decision points:**
- Before `sprint close`, ask whether incomplete tasks should carry over to the next sprint.
- `--auto` only makes sense with enough history for velocity calculation — fall back to explicit IDs for the first 2–3 sprints.

**Failure modes:**
- "A sprint is already active" → close it first.
- `--auto` requires AI; surface the AI config check from Workflow 1 if it fails.

---

## 6. Backlog grooming

**Trigger:** User is capturing ideas in bulk, or says "prioritize these."

**Steps:**

1. **Capture** one or many:
   ```bash
   planr backlog add "add user profiles" --priority medium --tag feature
   planr backlog add "fix login redirect" --priority critical --tag bug
   ```
2. **List and review:**
   ```bash
   planr backlog list --status open
   ```
3. **AI prioritize** by impact/effort:
   ```bash
   planr backlog prioritize --yes
   ```
4. **Promote ready items** into tasks or stories:
   ```bash
   planr backlog promote BL-001 --quick --yes
   planr backlog promote BL-002 --story --feature FEAT-005 --yes
   ```

**Decision points:**
- After `prioritize`, show the reordered list to the user before applying — the AI's priority shuffle is worth a human sanity check.
- For `promote --quick`, the AI generates a task breakdown from the BL body; for tiny items, use `--manual` instead.

**Failure modes:**
- `prioritize` requires AI; check config if it fails.

---

## 7. Refinement pass

**Trigger:** "Improve the quality of our plan", "refine the epic", "the stories look thin."

**Steps:**

1. Start at the highest level that needs work:
   ```bash
   planr refine EPIC-001 --yes
   ```
2. Preview and apply (AI shows suggestions + improved version).
3. For a full cascade through all children:
   ```bash
   planr refine EPIC-001 --cascade --yes
   ```
4. After refinement, re-align cross-references:
   ```bash
   planr sync
   ```

**Decision points:**
- `--cascade` can edit dozens of files — confirm with the user first if the hierarchy is large.

**Failure modes:**
- Refinement introduces drift between parent and children → `planr sync` reports mismatches.

---

## Bonus: Export / GitHub sync

Not "workflows" per se, but common follow-ups:

- **Export** a planning report:
  ```bash
  planr export --format html --yes
  planr export --format json --scope EPIC-001 --yes
  ```
- **Push to GitHub** (requires `gh auth login`):
  ```bash
  planr github push --all --yes
  planr github sync --direction both --yes
  ```
- **Push to Linear** (requires `planr linear init`):
  ```bash
  planr linear push EPIC-001 --yes
  planr linear sync --yes
  ```
