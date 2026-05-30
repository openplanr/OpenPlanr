# Procedure: `/ship` Step 2 — DAG-aware wave scheduler (M1)

Companion to `${CLAUDE_PLUGIN_ROOT}/commands/ship.md` Step 2.

Replaces the per-US sequential walk **when `DISPATCH_MODE == multi-task`**. The other two modes (`per-task`, `single-task`) bypass this file entirely — they keep their existing one-task-per-invocation contract (SPEC-013 FR15). When `DISPATCH_MODE == single-task` *(i.e., `--task T-NNN` bound)* control returns straight to `ship.md` Step 2c without entering this scheduler.

Per SPEC-013 the scheduler is **prompt-driven, not a runtime engine**: a "wave" is the orchestrator emitting K `Agent` tool-calls in **one** assistant turn. There is no daemon, no new process, no new npm dependency. Everything below is executed by the LLM following this procedure in-context.

The optional explicit `dependsOn:` task-frontmatter field is **M2**; M1 derives every serialize edge from file-scope inference + the inlined lock list below.

---

## Section 1 — Input contract

Inputs (already bound by `ship.md` Step 1 / Step 2a):

| Name | Type | Source | Notes |
|---|---|---|---|
| `${TASKS}` | list of task records | `ship.md` Step 2a dispatch queue | After `done`-skip + `$SHIP_TASK_ID` narrowing. Each record carries the fields listed below. |
| `${MAX_PARALLEL}` | positive integer | `procedures/ship-arguments-and-cost-gate.md` Phase A binding for `--max-parallel N` (T-005) | **Default `4`** when the flag is absent. Validated upstream (positive integer; soft warn above ~20). |
| `${MODE}` | `default` \| `spec-driven` | `procedures/mode-detection.md` | Drives task-path resolution only; algorithm is mode-agnostic. |
| `${SPEC_DIR}` / `${FEAT_DIR}` | path | mode-detection | Used to anchor write-set paths to repo-relative POSIX. |

Each task record in `${TASKS}` MUST be normalized to:

```yaml
id: "T-NNN"                # YAML frontmatter id, regex ^T-\d{3}$
status: "pending" | "in-progress" | "blocked"
agent: "<agent-slug>"      # frontend-agent | backend-agent | db-agent | …
type: "UI" | "Tech"
write_set:                 # POSIX, repo-relative; union of ### Create + ### Modify entries
  - "<path>"
  - "<path>"
```

**Normalization rules (apply once, before any of the sections below):**

1. Parse `### Create` and `### Modify` from the task body. Strip leading list markers (`- `), backticks, and trailing inline comments (`— note`, `# note`). The remaining token is the path.
2. Resolve every path **repo-relative** (POSIX `/`). Reject absolute paths and `../` segments — both are normalization fatals per `procedures/fatal-error-format.md`.
3. **Empty write-set policy:** a task whose `### Create` AND `### Modify` lists are both empty (or absent) is treated as conflicting with **every** other task (SPEC-013 Acceptance Criteria: *"empty/absent declared write-set → serialized alone"*). Implementation: union its write-set with the sentinel glob `**` so disjointness checks always fail.
4. Glob entries (e.g., `src/widgets/*.tsx`) are preserved as-is — disjointness checks below use gitignore-style glob matching, not literal-string equality.

If any task in `${TASKS}` fails normalization, halt with a two-line fatal per `procedures/fatal-error-format.md` naming the offending `T-NNN` and the bad path — do not dispatch.

---

## Section 2 — Cycle detection (fail-fast fatal)

The dependency graph for M1 is **implicit**: two tasks A and B are serialized iff their write-sets overlap (after glob-matching against the lock list — see Section 3). To detect impossible orderings, encode each serialize edge as a directed edge `A → B` **iff `id(A) < id(B)`** (lexical compare on the `T-NNN` string). This rule is purely a determinism tiebreaker — it guarantees a unique adjacency representation across runs.

Algorithm:

1. Build adjacency map `deps: { taskId → [taskId, …] }` over all pairs `(A, B)` in `${TASKS}` where `id(A) < id(B)` AND `overlaps(A, B)` is true (see Section 3 for the overlap predicate).
2. Run Kahn's topological sort:
   - Compute in-degrees from `deps`.
   - Initialize a queue of zero-in-degree nodes (sorted by id, ascending).
   - Repeatedly pop, decrement neighbors, push newly-zero nodes.
   - If the sort consumes `len(${TASKS})` nodes, the graph is acyclic → continue to Section 4.
3. **Cycle case** — if any node remains with positive in-degree after Kahn's sort, OR a self-edge `A → A` was generated (must not happen given `id(A) < id(B)`, but guard anyway):
   1. Collect the cycle members (every node still in the residual graph; this over-approximates "the cycle" but is the safe set to surface).
   2. Sort cycle members by id.
   3. Emit a two-line fatal per `procedures/fatal-error-format.md`:
      - **Line 1:** `⚠ Cyclic write-set dependency among tasks: T-NNN, T-MMM, …`
      - **Line 2:** `Repair: resolve the overlap (split write-sets or rename files) then re-run /planr-pipeline:ship ${SLUG}`
   4. **Dispatch nothing.** Do not emit any `Agent` tool-call. Do not write task `status` transitions.

> **Why fail fast:** with M1's inference-only model, a cycle means the orchestrator cannot prove either task is safe to schedule first. M2 (`execution-plan.json` + explicit `dependsOn`) is the path to disambiguate; M1's contract is "halt rather than guess".

---

## Section 3 — Lock list (inlined, gitignore-style globs)

The declared `### Create` / `### Modify` lists are untrusted text. Two tasks can be "disjoint" on paper yet both write the same shared file (`package.json`, a barrel `index.ts`, a migration registry). The lock list below forces any task touching a listed path to serialize with every other lock-listed task in the queue, even when their declared write-sets look disjoint.

**Stack-extensible lock lists are deferred to M3.** For M1 this list is the single source of truth and is inlined here so the scheduler, the conformance fixtures, and the agents share one definition.

```yaml
# planr-pipeline M1 Node/TS lock list — gitignore-style globs
lock_list:
  - "package.json"
  - "package-lock.json"
  - "pnpm-lock.yaml"
  - "yarn.lock"
  - "**/index.ts"
  - "**/index.js"
  - "prisma/schema.prisma"
  - "**/migrations/**"
```

**Glob semantics (gitignore-style, gitignore subset sufficient for M1):**

| Pattern | Matches |
|---|---|
| literal `package.json` | a path equal to `package.json` at the repo root |
| `**/index.ts` | `index.ts` at any depth (`index.ts`, `src/index.ts`, `src/a/b/index.ts`) |
| `**/migrations/**` | any path under any `migrations/` directory at any depth |
| `prisma/schema.prisma` | exact root-anchored path |

**`overlaps(A, B)` predicate (used by Section 2 and Section 4):**

A pair `(A, B)` is considered overlapping (i.e., they must be serialized) if **any** of the following holds:

1. **Direct intersection:** there exists a path `p` in `write_set(A)` and a path `q` in `write_set(B)` such that `p == q` after normalization, OR one is a glob and the other a literal path matched by it, OR both are globs whose match sets intersect (for M1, treat any two globs sharing the same first non-`**` segment as intersecting — sound, may be conservative).
2. **Both lock-listed:** at least one path in `write_set(A)` matches a `lock_list` glob AND at least one path in `write_set(B)` matches a (possibly different) `lock_list` glob. Two lock-listed tasks are **always** serialized, even when their declared write-sets look disjoint, because the lock list captures undeclared shared writes.
3. **Sentinel `**`** : either task carries the `**` sentinel from the empty-write-set policy (Section 1, rule 3).

When `overlaps(A, B)` is true the pair is encoded as the directed edge `A → B` (with `id(A) < id(B)`) in Section 2 and as a wave-membership conflict in Section 4.

`lock_listed(T)` is `true` iff at least one path in `write_set(T)` matches any glob in `lock_list`. Cache the flag per task on first computation.

---

## Section 4 — Greedy wave selection

Given a non-empty dispatch queue, compute the next wave:

1. **Compute the ready frontier.** A task is *ready* iff every task on which it depends has `status == done`. For M1 (file-scope inference only), task `B`'s dependencies are the set of tasks `A` with `id(A) < id(B)` AND `overlaps(A, B)` true. A `pending` or `blocked` task with no overlapping lower-id task in the queue is ready by definition.
2. **Sort ready tasks by id ascending.** Lex compare on the `T-NNN` string. Determinism matters: same inputs MUST produce the same wave membership across runs, runtimes, and operators.
3. **Initialize an empty wave** `W = []` and an empty running write-set union `U = ∅`. Track `lock_listed_in_wave = false`.
4. **Greedy pass.** Walk the sorted ready list. For each candidate `C`:
   - Compute `conflict = false`.
   - If `overlaps_set(write_set(C), U)` is true → `conflict = true`. (Same predicate as Section 3, lifted to a set/path comparison.)
   - If `lock_listed(C)` AND `lock_listed_in_wave` → `conflict = true`.
   - If `conflict == false` AND `len(W) < ${MAX_PARALLEL}` → append `C` to `W`, union its write-set into `U`, and set `lock_listed_in_wave = lock_listed_in_wave OR lock_listed(C)`.
   - Else → skip `C` (it rolls to a later wave).
5. **Floor-of-1 invariant.** If `W` is empty after the pass (every candidate conflicted with the running union — only possible when `${MAX_PARALLEL} > 0` AND the ready frontier is non-empty AND every candidate is lock-listed-vs-lock-listed or has overlapping write-sets with `U`'s seed — this last condition is degenerate when `U` starts empty, so in practice this branch is reached only via the lock-listed-vs-lock-listed clause when the ready frontier contains ≥2 lock-listed tasks and a same-wave conflict propagates from item 1 below; see note), unconditionally add the lowest-id ready candidate and proceed. This guarantees forward progress: **never an empty wave while the queue is non-empty.**

   > **Note (degenerate cases):** when `U = ∅` at step 4 start, only the lock-list clause AND the sentinel-`**` clause can flag the first candidate as conflicting; both are intentional. The floor-of-1 branch absorbs both, so a queue of N mutually-conflicting lock-listed tasks dispatches as N sequential waves of 1, lowest-id first.
6. **Carry-over.** All candidates not in `W` roll into the next wave's input — they are not dropped, just deferred.
7. **Cap behavior.** When more disjoint candidates exist than `${MAX_PARALLEL}`, the surplus rolls to the next wave. With `N` write-disjoint ready tasks and cap `K`, the queue drains in `ceil(N/K)` waves (matches SPEC-013 Acceptance Criteria).
8. **Width-1 equivalence (`--max-parallel 1`).** When `${MAX_PARALLEL} == 1`, step 4 admits at most one candidate per pass; combined with the id-sorted frontier, the dispatch order is **byte-for-byte identical** to the legacy sequential walk over an id-sorted task queue. This is the SPEC-013 FR14 backwards-compatibility guarantee.

The wave selection function returns `(W, carry_over)` where `W` is the dispatched batch and `carry_over` is the remaining ready + not-yet-ready tasks.

---

## Section 5 — Wave dispatch contract

For each non-empty wave `W` returned by Section 4:

1. **Pre-dispatch status transition (single-writer, in main tree).** For every task `T ∈ W`, the orchestrator writes the task frontmatter in the **main** working tree:
   - `status: in-progress`
   - `updated: <today's ISO date>`
   Append one manifest record `{ stage: "ship.task:<T.id>", agent: "<T.agent>", started_at: <now>, exit_status: "pending" }` per task. The `.run-manifest.jsonl` and the task `.md` `status` field are **never written from inside a worktree** — they stay single-writer in main (SPEC-013 FR9).
2. **Worktree provisioning.** For each `T ∈ W`, create a planr-managed git worktree on a short-lived branch and symlink the stack's gitignored dependency dirs (e.g., `node_modules`) from the main tree into the worktree root before the agent runs. The full lifecycle — create / checkout / branch naming / dep symlink — is specified in Section 6.
3. **One orchestrator turn, K Agent tool-calls.** In a **single** assistant turn the orchestrator emits exactly `len(W)` `Agent` tool-calls — one per task — each with:
   - `subagent_type`: the task's `agent` field (`frontend-agent`, `backend-agent`, `db-agent`, …).
   - `isolation`: `"worktree"`.
   - `description`: short label `"<T.id> — <task-title-first-35-chars>"`.
   - `prompt`: the standard per-task dispatch prompt (path to the task file, MODE/SPEC_DIR/FEAT_DIR, stack inputs, project-memory block, plus the prior `T-<id>-error-report.md` body when `status` was `blocked` — see `commands/ship.md` Step 2c). The prompt explicitly states `isolation: "worktree"` so the agent knows its writes are scoped.
4. **Wait for all K results.** The orchestrator does not start the next wave until every `Agent` call in the current wave has returned (success or R6 failure). Result merge, the undeclared-write guard, and the worktree cleanup are owned by Section 7 (T-002).
5. **Post-wave status transition (main tree only).** For each `T ∈ W`:
   - **Success:** write `status: done`, `updated: <today>` in main; close the manifest record with `exit_status: "success"`, `ended_at: <now>`, populated `files_written`/`files_modified`.
   - **R6 failure:** write `status: blocked`, `updated: <today>` in main; write `T-<T.id>-error-report.md` to the mode-resolved tasks folder; close the manifest record with `exit_status: "failure"`. Continue — a single task's R6 failure does **not** abort the surrounding wave or the rest of the run (matches `commands/ship.md` Step 2c contract).
6. **Recompute and loop.** Drop every task that just landed `done` from the queue. Re-run Section 4 against the remaining queue. Repeat until the queue is empty.
7. **Termination.** When the queue drains, return control to `commands/ship.md` Step 3 (QA Gate). The QA gate verifies every task that ran this invocation; parallelism speeds DEV, it does not weaken QA (SPEC-013 NFR1).

---

## Section 6 — Worktree setup (dep-sharing)

For every task `T ∈ W` admitted by Section 4, the orchestrator provisions a planr-managed git worktree **before** dispatching the `Agent` tool-call in Section 5 step 3. The provisioning sequence is:

1. **Create the worktree on a short-lived branch.** The branch name is the planr-managed convention `planr-wt/<T.id>-<short-slug>` (e.g., `planr-wt/T-002-worktree-safety`). The `planr-wt/` prefix is the cleanup token used by the startup `git worktree prune` + leftover-branch sweep (SPEC-013 FR12; wiring lives in `commands/ship.md`, owned by T-004). The worktree path is `${REPO_ROOT}/.planr-worktrees/<T.id>` — kept inside the repo root so relative tooling resolves the same way it does in main, but under a single gitignored prefix the reconcile step can enumerate.
   ```bash
   git worktree add .planr-worktrees/<T.id> -b planr-wt/<T.id>-<short-slug>
   ```
2. **Symlink gitignored dependency dirs from the main tree into the fresh worktree.** Identify the set of gitignored heavy build directories the active stack uses, then create one symlink per entry from the main tree root into the worktree root:
   - **Node / TypeScript (M1 default):** `node_modules`.
   - **Other stacks (M3 concern):** the per-stack file under `stacks/*/` will enumerate the equivalent (e.g., Python `.venv`, Ruby `vendor/bundle`, Rust `target/`). For M1 the orchestrator only links `node_modules`; non-Node stacks fall through with a one-line note in the dispatch log so future expansion is observable.
   - For each identified dir `D` that exists in the main tree root, execute:
     ```bash
     ln -sf "${REPO_ROOT}/${D}" ".planr-worktrees/<T.id>/${D}"
     ```
     and log `[worktree] symlinked <D> for <T.id>` to stdout. If the dir does not exist in the main tree (e.g., a freshly cloned repo where `npm install` was never run), skip it silently — the agent's R6 build will surface the missing-deps failure with a clearer signal than a dangling symlink would.
3. **Safety rationale (why symlinking shared `node_modules` does not race).** `package.json`, `package-lock.json`, `pnpm-lock.yaml`, and `yarn.lock` are all on the Section 3 `lock_list`. By the `lock_listed_in_wave` clause in Section 4 step 4, any task whose write-set includes one of those files is the **sole** lock-listed member of its wave. So while wave `W` runs, **no** sibling can mutate dependency-resolving files, which means **no** sibling can change what `node_modules` resolves to. The shared `node_modules` is read-only from the perspective of all in-flight worktrees in `W`. (Tasks that add or remove packages serialize alone as a width-1 wave; their agent runs `npm install` inside their own worktree and the symlink resolves to the main-tree result once the merge step in Section 7 lands.)
4. **Per-stack caveat.** Symlink semantics differ across toolchains: Node module resolution follows symlinks transparently (modulo `--preserve-symlinks`, which planr-pipeline does not set); Python `venv` activation scripts hard-code absolute paths; Ruby bundler ignores symlinked `vendor/` directories unless `bundle config --local path` is rewritten. The M1 implementation only commits to the Node behavior. M3's per-stack files will codify the equivalents and any pre-link rewrites required.
5. **Logging.** Append one line per symlink to the dispatch log so the run is auditable from stdout alone. The log lines are **informational** — they are not written to `.run-manifest.jsonl`, which stays single-writer for status transitions only (SPEC-013 FR9).

The agent is then dispatched per Section 5 step 3 with `isolation: "worktree"` and the cwd set to the worktree path. Inside the worktree the agent runs the R6 loop unchanged; the symlinked `node_modules` lets the `BuildCommand` / `TestCommand` from `input/tech/stack.md` succeed without a per-worktree `npm install`.

---

## Section 7 — File-scoped merge (declared writes only)

When the `Agent` tool-call for task `T` returns, the orchestrator merges the worktree's writes back into the main tree using a **file-scoped checkout**, not a branch merge. This is the only mechanism by which worktree-authored bytes land in main.

1. **Verify the worktree diff against the declared write-set.** Compute `wt_diff(T) = git -C .planr-worktrees/<T.id> diff --name-only planr-wt/<T.id>-<short-slug>` (the set of paths the agent actually touched). Compute `declared(T) = write_set(T)` from Section 1 normalization. Two paths must hold:
   - **Subset check:** `wt_diff(T) ⊆ declared(T)` (every modified file was declared).
   - **Forbidden-file check:** neither `.run-manifest.jsonl` nor any task `.md` file under the spec/feat tasks folder appears in `wt_diff(T)`. These are **orchestrator-owned in main** — see Section 5 step 1 / step 5 and Section 9.
   If either check fails, treat it as an **undeclared write**: do not apply any files from this worktree to main, mark the task `blocked`, write `T-<T.id>-error-report.md` with a section listing the offending paths, and feed the report back into R6 on the next wave (matches the per-task error-report contract in `commands/ship.md` Step 2c). The wave's other members are unaffected — file-scoped means file-scoped per task.
2. **Apply only the declared paths.** For each `f ∈ declared(T)` (after the checks above pass), execute in the main tree:
   ```bash
   git checkout planr-wt/<T.id>-<short-slug> -- <f>
   ```
   This pulls the worktree's blob for `f` into the main tree's index and working copy. Files in `declared(T)` that the agent did not actually modify (`f ∉ wt_diff(T)`) are no-ops — `git checkout` against an unchanged path is idempotent.
3. **Stage and commit in main.** After all declared paths land:
   ```bash
   git add <declared-files…>
   git commit -m "ship: merge <T.id> <slug> declared writes"
   ```
   The commit is authored in main and never touches the worktree branch's history. The orchestrator then writes the post-success status transition per Section 5 step 5 (`status: done`, manifest record closed) — again, in main only.
4. **Never `git merge` the worktree branch.** A branch merge would pull in every byte the agent wrote, including any undeclared scratch file, accidental log dump, or — most importantly — any worktree-authored mutation of the task `.md` status field or `.run-manifest.jsonl`. The file-scoped checkout is the structural guarantee that the orchestrator stays the sole writer of those two surfaces (SPEC-013 FR9, FR11).
5. **Forbidden-files invariant (restated for emphasis).** The task `.md` file (e.g., `.planr/specs/SPEC-NNN-<slug>/tasks/T-NNN-<slug>.md` in spec-driven mode, or `.planr/tasks/TASK-NNN-<slug>.md` in default mode) and `.run-manifest.jsonl` MUST NOT appear in any worktree's `wt_diff`. If they do, the step 1 forbidden-file check fires and the task lands in R6 as an undeclared write. There is no override flag and no "this one is benign" carve-out — the conformance suite (fixture G7, T-010) asserts this round-trip cannot happen.
6. **Wave-internal merge-conflict handling.** Wave members are write-disjoint by Section 4 construction, so two wave members should not contend for the same path. But a glob-vs-literal overlap can in principle dodge the disjointness check (Section 3's `overlaps` predicate is sound but conservative; it errs toward serializing, but the edge case exists where two literal declared paths happen to share a parent directory whose contents the agents both touch via the same glob). If a `git checkout` in step 2 produces a merge conflict against a path already committed earlier in the same wave:
   1. `git checkout -- <conflicted-file>` (abort the half-applied change in main).
   2. Do NOT apply any further files from this task's worktree (partial application is worse than none).
   3. Mark this task `blocked`, re-queue it for the **next** wave with a one-line note in the error report explaining the conflict. The earlier sibling's commit stays — it landed first and is canonical.
   4. The next wave's Section 4 pass will resolve the conflict naturally: with the earlier sibling's writes already merged into main and that task now `done`, the re-queued task becomes a singleton in its ready frontier and dispatches serially in a width-1 wave.
7. **Worktree cleanup (success and failure paths).** Whether step 2 succeeded, step 1 failed, or step 6 aborted:
   ```bash
   git worktree remove --force .planr-worktrees/<T.id>
   git branch -D planr-wt/<T.id>-<short-slug>
   ```

---

## Section 8 — Integration with `commands/ship.md`

`commands/ship.md` Step 2 (multi-task branch only) calls this procedure as follows (the actual wiring is authored by T-003; T-001 only specifies the contract):

1. After Step 2a builds the dispatch queue and applies `$SHIP_TASK_ID` narrowing, AND after Step 2b confirms `DISPATCH_MODE == multi-task`, hand the normalized queue + `${MAX_PARALLEL}` to this procedure.
2. This procedure runs Section 2 (cycle detection) once over the full queue. On cycle → fatal, no dispatch.
3. This procedure runs Sections 4 + 5 in a loop until the queue drains, then returns the per-task outcomes (success / blocked + error-report path) to `ship.md`.
4. `ship.md` Step 3 (QA gate) runs unchanged on the merged result set.

`per-task` and `single-task` modes never enter this procedure (SPEC-013 FR15). The legacy per-US sequential walk in `commands/ship.md` is preserved verbatim for those modes.

---

## Section 9 — Determinism & replay guarantees

This procedure is deterministic: identical inputs (same task set, same `${MAX_PARALLEL}`, same lock list) always produce the same wave partition and the same dispatch order.

1. **Stable wave partition.** Cycle detection (Section 2) and greedy selection (Section 4) both sort by `id` ascending before any decision, so wave membership and intra-wave order are reproducible across runs and runtimes.
2. **Width-1 sequential equivalence (FR14).** With `--max-parallel 1`, every wave holds exactly one task and the scheduler reduces to the legacy id-ordered sequential dispatch — byte-for-byte the task order `commands/ship.md` produced before SPEC-013. The regression fixture (T-008) asserts this.
3. **Lock-list versioning.** The lock list (Section 3) is inlined in this file, so any change to it is a visible diff that moves in lockstep with the algorithm that consumes it — no drift between *what* serializes and *why*.
4. **Single-writer status & manifest.** Task `.md` `status` fields and `.run-manifest.jsonl` are written only in the main tree by the orchestrator (Sections 5, 7); worktrees never carry them, so concurrent waves cannot race on shipped-state bookkeeping (FR9, FR11).
5. **Cycle detection is a global precondition.** It runs once over the whole task set before the first wave; a cyclic spec dispatches nothing (Section 2). Partial dispatch on a cyclic graph is impossible by construction.

---

*Reads: the pending/blocked task set (id, status, Create/Modify write-sets), `${MAX_PARALLEL}`, `input/tech/stack.md` (gitignored dep dirs).*
*Writes: nothing directly — the orchestrator applies declared files via file-scoped checkout (Section 7) and owns all status/manifest writes in main.*
*Dispatches: K backend-agent / frontend-agent subagents per wave via the `Agent` tool with `isolation: "worktree"`.*
*Fatals: cyclic dependency graph (Section 2) and write-set normalization errors (Section 1) — both follow `procedures/fatal-error-format.md` (two-line).*
