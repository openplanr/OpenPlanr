# Plan Revision Layer — `planr revise`

> **Status:** Formal epic — [EPIC-003: Plan Revision Layer (`planr revise`)](epics/EPIC-003-plan-revision-layer-revise-command.md). This file remains the full design brief; when the brief and the epic summary disagree, **this doc wins** for technical detail.
> **Authors:** Asem + Claude (planning pass, 2026-04-21).
> **Supersedes:** the informal spec pasted in chat. When this doc and chat disagree, this doc wins.
> **Next:** features FEAT-010–FEAT-014 and stories US-032–US-053 created under EPIC-003; task files TASK-010–TASK-014 scoped.

---

## Alignment

This brief is the source of truth for technical detail. It is aligned against the following, and `planr revise` should one day audit this file against them:

- **Epic summary:** [epics/EPIC-003-plan-revision-layer-revise-command.md](epics/EPIC-003-plan-revision-layer-revise-command.md) — summary-shaped; defers to this file on conflict.
- **Architectural precedent:** [src/cli/commands/refine.ts](../src/cli/commands/refine.ts), [src/ai/prompts/prompt-builder.ts](../src/ai/prompts/prompt-builder.ts), [src/ai/prompts/system-prompts.ts](../src/ai/prompts/system-prompts.ts), [src/ai/schemas/ai-response-schemas.ts](../src/ai/schemas/ai-response-schemas.ts) — revise follows refine's agentic orchestration pattern.
- **Reused infrastructure:** [src/ai/codebase/context-builder.ts](../src/ai/codebase/context-builder.ts), [src/services/ai-service.ts](../src/services/ai-service.ts), [src/services/artifact-service.ts](../src/services/artifact-service.ts), [src/services/prompt-service.ts](../src/services/prompt-service.ts); graph integrity reused from [src/cli/commands/sync.ts](../src/cli/commands/sync.ts) (`syncParentChildLinks`).
- **Adjacent backlog:** [backlog/BL-001-feedback-driven-refine-add-feedback-and-file-flags-to.md](backlog/BL-001-feedback-driven-refine-add-feedback-and-file-flags-to.md) — distinct command (refine `--feedback` is a directed push; revise is an open-ended pull).

---

## Why this exists (one paragraph)

Plans in `.planr/` drift from reality the moment the repo moves: PRDs change, code lands in different paths than tasks described, conventions flip, ADRs arrive late, sibling artifacts disagree. Catching that today requires a careful human re-read and manual edits. `planr revise` encodes both steps as a single command: **gather context, compare, and actively rewrite the planning artifacts so they match reality**. The product promise: *point revise at an epic (or the whole `.planr/`) and the plans come back aligned with the codebase, sources of truth, and each other — with a diff preview, an audit log, and git as the safety net.*

## Architectural thesis (this drives everything below)

Revise is a **revision command**, not a report command. Its output is **modified artifact files on disk.** An audit log is emitted as a byproduct (so the user can review what changed and why), but the audit log is not the product — aligned artifacts are.

Revise is also **not** a rule engine. Rule engines are project-specific by nature and rot when conventions shift. Hard-coding rules would force us to ship a new axis per project type.

Instead, revise is an **agentic revision command** in the same family as `planr refine`, but substantially more powerful and more dangerous. The pipeline:

```
[scope: one artifact id, or --all]
  ↓
[context assembly: artifact + parent chain + siblings + codebase + declared sources]
  ↓
[agent: per-artifact decision — revise | skip | flag-ambiguous — with typed evidence]
  ↓
[evidence gate: reject changes whose cited evidence doesn't verify]
  ↓
[diff preview per artifact → human confirm (or --yes)]
  ↓
[write artifacts in cascade order: parent → children]
  ↓
[post-flight: graph integrity check; auto-rollback if broken]
  ↓
[audit log → .planr/reports/revise-<scope>-<date>.md]
```

What the agent uniquely contributes: reading code and plan side-by-side, recognizing that a task's "Relevant Files" list points at a file path that no longer exists, that a sibling story's Gherkin contradicts this feature's acceptance criteria, that an epic claims a dependency the code actually dropped. Project-type agnosticism comes for free — the agent doesn't need a routing plugin to notice that an App Router project has `src/pages/` paths in its tasks, because it reads the repo.

## Design principles

1. **Agent proposes, evidence permits, human confirms, guards protect.** Four layers. No shortcut past any of them in v1.
2. **Code wins on *facts*; plan wins on *intent*; ambiguity is flagged, not guessed.** Paths, file existence, stack, actual implementation → aligned to code without asking. *What the feature is supposed to do* → never rewritten; intent conflicts become `ambiguous` entries in the audit log for human decision.
3. **Cascade top-down.** Revise the parent first so children see the *revised* parent in their context window, not the stale one. One pass, deterministic order.
4. **Git is the safety net.** Require a clean working tree by default. `--allow-dirty` for override. After success, print a suggested commit message. Post-flight rollback leans entirely on git.
5. **Context is the product.** Quality of revision is bounded by the richness and honesty of the context pack. More engineering effort goes into context assembly than into prompt wording.
6. **Structured decisions, always.** The agent returns a typed decision object per artifact — never free-form prose. This is what makes evidence gating, diff preview, and audit logs possible.
7. **Compose with existing infra.** Reuse `ai-service.ts`, `codebase/context-builder.ts`, `prompt-builder.ts`, `artifact-service.ts`, and `syncParentChildLinks`. No parallel stack.
8. **Narrow before broad.** v1 ships single-artifact and cascade-from-epic. `--all` lands in Phase 4 with extra guardrails. Structural changes (moving artifacts between parents, creating new ones, deleting) are explicitly v2.

---

## v1 scope

### Command surface

```
planr revise <ARTIFACT-ID> | --all
  [--cascade | --no-cascade]       # default: on for epic/feature, off for story/task
  [--dry-run]                      # show diffs, never write (audit log still emitted)
  [--yes]                          # skip per-artifact confirmation (non-interactive mode)
  [--allow-dirty]                  # run with uncommitted changes (overrides clean-tree gate)
  [--scope-to prose|references|paths|all]   # which parts of each artifact revise can write
  [--audit <path>]                 # override audit log path
  [--format md|json]               # audit log format
  [--no-code-context]              # skip codebase assembly (fast mode)
  [--no-cascade]                   # explicit opt-out from default cascade
```

- **Bare `planr revise`** (no artifact, no `--all`) **is an error** with usage help. Bulk revision requires explicit opt-in.
- `<ARTIFACT-ID>` accepts any id: `EPIC-002`, `FEAT-007`, `US-021`, `TASK-005`.
- `--all` iterates every epic in the project, top-down, skipping artifacts whose cached hash matches a prior successful revise.
- `--scope-to` lets users narrow what revise will touch: `prose` (descriptions, requirements), `references` (parent/child links), `paths` (Relevant Files sections in tasks), or `all` (default).
- `--yes` in an interactive TTY still requires a single "type YES" confirmation so nobody runs `planr revise --all --yes` by muscle memory.

### What v1 delivers (per artifact in scope)

| Layer | Behavior |
|---|---|
| Context assembly | Artifact body + parent chain + **immediate siblings** (other features under the same epic; other stories under the same feature) + codebase context via existing `context-builder.ts` + declared sources from `.planr/revise.yaml`. |
| Agent decision | Structured output: `action ∈ {revise, skip, flag}`, `revisedMarkdown` (if `revise`), `rationale`, `evidence[]`, `ambiguous[]`. |
| Evidence gate | Every change in `revisedMarkdown` must trace to at least one verified evidence item. Claims like "file X doesn't exist" are checked with `fs.stat`; "sibling Y says Z" is checked by grepping the sibling artifact; unverifiable claims → the change is dropped, logged for prompt tuning. |
| Diff preview | Unified diff shown in terminal, section-by-section. Prompt: `[a]pply / [s]kip / [e]dit rationale / [d]iff again / [q]uit`. |
| Write | Only after confirm (or `--yes`). Atomic per-artifact write with file-level backup to `.planr/reports/revise-<scope>-<date>/backup/` so manual rollback is trivial even without git. |
| Cascade | Top-down: epic → its features → their stories → their tasks. Children receive the revised parent in their context. Siblings refreshed from disk between writes. |
| Post-flight | Re-runs `syncParentChildLinks` in check-only mode. If the graph broke (shouldn't, but), automatic `git checkout` of the affected files + audit-log entry describing the rollback. |
| Audit log | Always written, even on `--dry-run`. Lists applied, skipped, flagged-ambiguous artifacts with rationale, evidence, and diffs. |

### Sample audit log (`planr revise EPIC-002` on this repo, dry-run)

```markdown
# Revise audit — EPIC-002 (2026-04-21)
> Generated with claude-opus-4-7 · cascade=on · mode=dry-run
> Scope: 1 epic · 5 features · 18 stories · 9 task files = 33 artifacts
> Applied: 0 (dry-run) · Would-apply: 4 · Skipped: 26 · Flagged: 3
> Tokens: 48,210 in → 6,892 out · 14.1s

## Would-apply revisions

### TASK-007 — `src/templates/linter/linter-config.json.hbs` removed from Relevant Files
**Rationale:** Path does not exist; default rules live inline in
`src/services/report-linter-service.ts`.
**Evidence:**
- `file_absent`: src/templates/linter/linter-config.json.hbs
- `file_exists`: src/services/report-linter-service.ts
- `grep_match`: "getDefaultRules" in src/services/report-linter-service.ts:42
**Scope-to:** paths
**Diff:**
```diff
- `src/templates/linter/linter-config.json.hbs` — Default configuration template with validation rules
+ `src/services/report-linter-service.ts` — Default rules defined inline in getDefaultRules()
```

### FEAT-009 — title "Standup Dictation Mode" → "Standup from Transcript"
**Rationale:** Acceptance criteria only cover transcript-file ingestion;
live-microphone support is explicitly `@v2` in US-030 Gherkin.
**Evidence:**
- `sibling_artifact`: US-030-gherkin.feature (all @v1 scenarios use transcript files)
- `file_absent`: no microphone SDK imported in src/services/voice-service.ts
**Scope-to:** prose
**Diff:** [...]

## Skipped (no drift detected)
EPIC-002, FEAT-005, FEAT-006, FEAT-007, FEAT-008, US-014–US-020, US-023–US-029, US-031, TASK-005, TASK-006, TASK-008

## Flagged (ambiguous — human decision required, no write)

### US-022 §Acceptance Criteria — "flags 90%+ of vague phrases"
Gherkin asserts a ≥90% catch rate, but the current linter has a hard-coded
4-pattern list with no measurement in place. Is 90% an aspiration (keep as-is,
add v2 milestone) or a contract (needs instrumentation before release)?
Not revised.

### EPIC-002 §Dependencies — "Handlebars template system"
Reporting layer now uses a mix of Handlebars and plain string templates.
Ambiguous whether the dependency line should be narrowed or the
implementation consolidated. Not revised.

### TASK-009 subtask 3.2 — "Implement live microphone streaming"
All US-030 microphone scenarios tagged `@v2`. Unclear whether the subtask
should be dropped, marked `(v2)`, or the task split. Not revised.
```

### Config (`.planr/revise.yaml`)

```yaml
# All fields optional. Missing config = artifact chain + siblings + codebase context.
sources:
  prds: [".planr/backlog/PRD-*.md"]
  design: [".planr/backlog/design/*.{html,md}"]
  rules: [".cursor/rules/*.mdc", "AGENTS.md"]
  adrs: [".planr/adrs/*.md"]
context:
  include_code: true
  include_siblings: true
  max_code_context_chars: 48000
agent:
  model_tier: "default"           # "default" | "heavy"
  max_writes_per_run: 50          # safety rail for --all
writable:
  # default scope of what revise may modify; can be overridden per-run with --scope-to
  prose: true                     # descriptions, requirements, risks, criteria
  references: true                # parent/child link lists
  paths: true                     # Relevant Files sections in tasks
  subtask_checkboxes: false       # v2: only flip [ ] ↔ [x] with strong evidence
  frontmatter_status: false       # v2: "in-progress" → "done" with subtask evidence
  gherkin: false                  # v2: different format, needs its own handler
```

### Explicitly out of v1

- **Creating new artifacts.** Revise can't decide "this epic needs a new feature." That's a human or `planr plan` job.
- **Deleting artifacts.** Revise never removes `.md` files.
- **Moving artifacts** between parents (story from FEAT-A to FEAT-B).
- **Flipping subtask checkboxes** based on code evidence (`writable.subtask_checkboxes`).
- **Updating frontmatter status** (`in-progress` → `done`).
- **Revising Gherkin** (`.feature` files).
- **Live microphone / interactive editing** beyond the `[e]dit rationale` prompt.
- **Cross-run baseline / ratchet** — every run is independent.

---

## Engineering plan — phases

Each phase = one reviewable PR. Order is picked so the riskiest piece (decision schema + prompt + evidence gate) gets tested on single artifacts before write mechanics and cascade pile on.

### Phase 1 — Schema, prompt, single-artifact decision (dry-run only)

- `src/models/types.ts`: `ReviseDecision`, `ReviseEvidence`, `ReviseEvidenceType`, `ReviseAmbiguity`, `ReviseAudit`.
- `src/ai/schemas/ai-response-schemas.ts`: `aiReviseDecisionSchema` (zod).
- `src/ai/prompts/system-prompts.ts`: `REVISE_SYSTEM_PROMPT` — persona, decision rubric (revise/skip/flag), evidence-type taxonomy, "code wins on facts, plan wins on intent" rule, explicit hallucination guardrails, few-shot pair.
- `src/ai/prompts/prompt-builder.ts`: `buildRevisePrompt(artifact, parents, siblings, codebaseContext, sources, scopeTo)`.
- `src/services/revise-service.ts`: `reviseArtifact(id, { dryRun: true })` → returns `ReviseDecision`, doesn't write, prints diff.
- `src/cli/commands/revise.ts` + register in `src/cli/index.ts`.
- Tests against fixture artifacts with stubbed AI provider.

**Done when:** `planr revise TASK-007 --dry-run` returns a schema-valid decision with a unified diff in the terminal.

### Phase 2 — Evidence gate + write path + confirmation UX

- `src/services/revise-verifier.ts`: verifies every `ReviseEvidence` item. Types: `file_exists`, `file_absent`, `grep_match`, `sibling_artifact`, `source_quote`, `pattern_rule`.
- Drops any change whose evidence doesn't verify; tags `verified: false` on dropped items, logged for prompt tuning.
- Clean-tree check via `git status --porcelain`; `--allow-dirty` override.
- Atomic write with per-file backup to `.planr/reports/revise-<scope>-<date>/backup/<artifact>.bak`.
- Interactive confirmation loop (`[a]/[s]/[e]/[d]/[q]`) via existing `prompt-service.ts`.
- `--yes` mode (still requires typed "YES" in TTY for safety).

**Done when:** a planted hallucinated evidence item is caught and the change is dropped before the diff ever appears.

### Phase 3 — Cascade + sibling context

- Cascade ordering: epic → its features in id order → their stories → their tasks.
- Children's context pack always loaded from disk *after* parents have been written, so siblings and parents are fresh.
- Audit log groups entries by cascade level.
- Cascade can be interrupted (`q` at any prompt) without leaving the tree partially revised without record — audit log entries flush immediately, not at end.

**Done when:** `planr revise EPIC-002 --dry-run` produces a 30-ish-entry audit log with entries for every artifact in the subtree, in top-down order, and children's rationale visibly references their (would-be) revised parent.

### Phase 4 — `--all` + post-flight graph check + rollback

- `--all` walks every epic top-down, with a hard `max_writes_per_run` safety rail.
- Post-flight: re-run graph-integrity checks (`syncParentChildLinks` in check-only mode).
- On broken graph: `git checkout -- <affected artifact paths>` (requires clean tree pre-run, which is already enforced), plus an `AUTO_ROLLBACK` section in the audit log.
- Non-interactive mode (`--yes`) still prompts once at start: "About to touch N artifacts in project P. Type YES."

**Done when:** running `--all` on this repo touches nothing in dry-run; with a synthetic graph-break test, auto-rollback restores files to pre-run state.

### Phase 5 — Ergonomics, cost, docs

- `--no-code-context` fast mode.
- Token budget: aggressive trimming of codebase context when artifact chain alone exceeds half the budget.
- Skip artifacts whose `(artifact hash + codebase digest + sources digest)` matches the last successful revise (cache in `.planr/reports/.revise-cache.json`).
- README + `docs/` section with golden-path example; suggested git commit message convention (`chore(plan): revise <SCOPE> against codebase`).

**Done when:** a re-run of `planr revise EPIC-002` with no codebase changes exits in <5s, touches nothing.

### Phase 6+ (v2, explicit non-goals for initial release)

- `writable.subtask_checkboxes` — flip `[ ]` ↔ `[x]` only with strong multi-source evidence.
- `writable.frontmatter_status` — `in-progress` → `done` inference.
- `writable.gherkin` — Gherkin revision with its own prompt and parser.
- Artifact creation / deletion / moves.
- Cross-run baseline: suppress findings marked `accepted` in a previous run.
- Parallel cascade (revise independent subtrees concurrently) — only if Phase 5 shows wall-clock is the bottleneck.

---

## Relationship to `planr refine`

Legitimate question for anyone reading this cold. They are related but *not* the same command, and merging them makes both worse.

| | `refine` | `revise` |
|---|---|---|
| Purpose | Improve *prose quality* of an artifact (clarity, completeness, phrasing) | Align artifact with *reality* (code, sources, siblings) |
| Cross-references | **Forbidden to touch** (per current `REFINE_SYSTEM_PROMPT`) | **Can modify** (adds/removes/fixes parent/child links when drifted) |
| Context needed | The artifact itself | Artifact + parents + siblings + codebase + declared sources |
| Cascade | Re-runs refine on each child independently | Top-down, children see *revised* parents in their context |
| Evidence | None required (prose judgment) | Every change must cite verified evidence |
| Failure mode | "This reads awkwardly now" | "The agent cited a file that doesn't exist" — caught by evidence gate |
| Safety | Low — rewriting prose | High — rewriting structural facts; needs git clean tree, diff preview, rollback |

**They compose.** Revise corrects facts, refine polishes prose. A realistic workflow:

```
planr revise EPIC-003            # align with codebase; review diffs; commit
planr refine EPIC-003 --cascade  # tighten prose of the newly-aligned artifacts
```

[BL-001](.planr/backlog/BL-001-feedback-driven-refine-add-feedback-and-file-flags-to.md) (refine `--feedback`/`--file`) is also distinct from revise: BL-001 takes *one* external doc and rewrites artifacts around it (directed push). Revise systematically compares to *all* declared sources + code + siblings (open-ended pull).

---

## Architecture sketch (where things live)

| Concern | File | Reuses |
|---|---|---|
| Command entry | `src/cli/commands/revise.ts` | register pattern from `refine.ts`, `sync.ts` |
| Orchestration | `src/services/revise-service.ts` | `ai-service.ts`, `artifact-service.ts`, `config-service.ts` |
| Config + sources loader | `src/services/revise-sources-service.ts` | zod schema pattern |
| Evidence verifier | `src/services/revise-verifier.ts` | `artifact-service.ts`, `fs`, codebase rules |
| Diff + confirmation UX | `src/services/revise-service.ts` (inline) | `prompt-service.ts`, diff library |
| Git safety | `src/services/revise-git.ts` (thin wrapper) | `child_process` / existing git helpers |
| System prompt | `src/ai/prompts/system-prompts.ts` → `REVISE_SYSTEM_PROMPT` | `BASE_PERSONA` |
| Prompt builder | `src/ai/prompts/prompt-builder.ts` → `buildRevisePrompt` | same pattern as `buildRefinePrompt` |
| Response schema | `src/ai/schemas/ai-response-schemas.ts` → `aiReviseDecisionSchema` | zod |
| Codebase context | existing `src/ai/codebase/context-builder.ts` | used as-is |
| Types | `src/models/types.ts` | existing `ArtifactType`, `ArtifactFrontmatter` |
| Config schema | `src/models/schema.ts` | zod pattern from `reportLinter` |
| Tests | `tests/revise/*.test.ts` + fixtures under `tests/fixtures/revise/` | stub AI provider pattern from refine tests |

**No new top-level directories.** Every file sits beside a precedent in the same folder.

---

## Prompt-engineering deliverable

The `REVISE_SYSTEM_PROMPT` must answer, within a token budget:

1. **Role.** "You are a senior planning maintainer actively revising agile artifacts so they match repo reality."
2. **Inputs framing.** Labels for `[TARGET_ARTIFACT]`, `[PARENT_CHAIN]`, `[SIBLINGS]`, `[CODEBASE_CONTEXT]`, `[DECLARED_SOURCES]`, `[WRITABLE_SCOPE]`.
3. **Decision rubric.** `revise` = confident aligned change with evidence. `skip` = no drift detected. `flag` = drift detected but cannot resolve without human judgment (intent conflict, ambiguity).
4. **Facts vs intent rule (load-bearing).** "You may rewrite structural facts (paths, file lists, references, stack names, terminology) when evidence contradicts them. You may NOT rewrite what the feature is supposed to *do* — if intent conflicts, flag as ambiguous."
5. **Evidence taxonomy.** Every entry in the output's `evidence[]` array must be one of the typed kinds (`file_exists`, `file_absent`, `grep_match`, `sibling_artifact`, `source_quote`, `pattern_rule`) with a `ref` the verifier can check.
6. **Hallucination guardrails.** "Never cite a path, function, symbol, or artifact id unless it appears verbatim in the provided context. Citations that can't be verified will be dropped in post-processing."
7. **Scope respect.** "If `[WRITABLE_SCOPE]` excludes `references`, do not emit revisions that modify the `## Features` / `## Stories` / `## Tasks` sections."
8. **Output contract.** Reference the zod schema shape explicitly; forbid markdown fences, prose, explanations outside the JSON object.
9. **Few-shot pair.** One positive example (a real-looking path-alignment revise with verified evidence), one negative (a hallucinated evidence that the verifier would reject, with the guard explanation) — so the agent learns what will be dropped.

Phase 1 lands v0.1 of this prompt; Phases 2–3 iterate with hallucination-rate telemetry from the verifier.

---

## Open questions (decide before Phase 1 lands)

1. **Cascade default on or off for `planr revise FEAT-007`?** Epic scope wants cascade on. Feature scope is less obvious — a feature's stories are small enough to revise in one call with feature context. *Proposal: cascade default `on` for epic and feature, `off` for story and task. Override with `--no-cascade` / `--cascade`.*
2. **`revise.yaml` or extend `.planr/config.json`?** Globs read badly in JSON; rest of `.planr/` config is JSON. *Proposal: extend `.planr/config.json` with a `revise` block for non-glob settings; keep source globs in a dedicated `.planr/revise-sources.yaml` (optional file) only when users actually need external sources. Avoids forcing yaml on everyone.* Revisit Phase 2 with real config ergonomics.
3. **Does revise require clean git tree, or just warn?** *Proposal: hard require by default; `--allow-dirty` opt-out. Rollback safety depends on it.*
4. **Diff presentation: unified diff, side-by-side, or section-aware?** Unified diff is simple and readable for small changes; prose rewrites of whole sections render badly. *Proposal: unified diff for Phase 1; consider section-aware "here's the old §Description, here's the new §Description" in Phase 5 if users complain.*
5. **External coding agents (Claude Code, Cursor) as executors — via configured provider or emitted prompt?** *Proposal: configured provider only in v1 (matches refine). A `--emit-prompt` mode for pasting into external agents is a plausible v2 add if users ask.*
6. **`--all` on a project with 50+ artifacts — cost and wall-clock concerns.** *Proposal: Phase 5 caching + `max_writes_per_run` safety rail. If a real user hits the rail, that's a real signal we should split `--all` into an interactive paginated mode.*

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Agent confidently rewrites correct content into wrong content. | Evidence gate (Phase 2) rejects changes without verified evidence; diff preview + human confirm (Phase 2) catches residual cases; git clean tree + rollback make reverse-out trivial. |
| Bulk mode amplifies one bad decision across a subtree. | Top-down cascade means the parent revise lands before children see it; `--yes` still requires typed confirmation in TTY; `max_writes_per_run` caps blast radius. |
| Conflict between code and plan where plan was the right reference. | Facts-vs-intent rule in the prompt: code wins on paths/existence/stack, plan wins on intent; intent conflicts → flagged, not rewritten. |
| Agent hallucinates file paths or artifact ids. | Typed evidence taxonomy + verifier drops unverifiable citations before diff; telemetry tracks hallucination rate per run for prompt tuning. |
| Token cost on `--all` or large epics. | `--no-code-context` fast mode; aggressive codebase trimming; Phase 5 cache; explicit token usage in every audit log. |
| User runs revise with dirty tree, loses in-progress edits. | Hard require clean tree by default; `--allow-dirty` is explicit opt-in, logged in the audit header with a warning. |
| Post-write graph integrity broken by inconsistent reference changes. | Phase 4 post-flight graph check + auto-rollback via git. |
| Prompt quality is the whole product but lands early. | Telemetry (hallucination rate, flag vs revise vs skip distribution, verifier-drop rate) instrumented from Phase 2 so Phases 3–5 iterate on data. |

---

## Success criteria (for the engineer taking this on)

- `planr revise EPIC-002 --dry-run` on this repo produces an audit log where at least one `would-apply` entry and one `flagged` entry are things a human agrees with on first read.
- Planting a hallucinated evidence item in a test AI response causes the verifier to drop the change before the diff preview is shown.
- `planr revise EPIC-002` with a dirty working tree exits cleanly with an error telling the user to commit or pass `--allow-dirty`.
- `planr revise --all` on this repo with `--dry-run` writes nothing and produces a per-artifact audit log in top-down order.
- A synthetic graph-break test during Phase 4 triggers auto-rollback and produces an `AUTO_ROLLBACK` audit entry; the repo state matches pre-run exactly.
- Total v1 diff (Phase 1–5) lands as five PRs, each reviewable in under 30 minutes of a senior reviewer's time.

---

## Next action

Epic [.planr/epics/EPIC-003-plan-revision-layer-revise-command.md](epics/EPIC-003-plan-revision-layer-revise-command.md) is in place and matches this brief. Next: create `FEAT-010` (schema + prompt + single-artifact decision + CLI, Phase 1) through `FEAT-014` (ergonomics + docs, Phase 5), with matching stories and tasks.

If you want changes first — different cascade default, different confirmation UX, different conflict rule, different scope boundaries — edit this brief and align the epic summary.
