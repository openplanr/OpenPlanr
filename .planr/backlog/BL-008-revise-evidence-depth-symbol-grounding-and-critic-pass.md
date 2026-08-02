---
id: "BL-008"
title: "Revise: evidence-depth upgrade — symbol grounding, AST-indexed context, diff-critic pass"
priority: "high"
tags: ["feature", "revise", "accuracy", "safety", "multi-phase"]
status: "open"
created: "2026-04-23"
updated: "2026-04-23"
---

# BL-008: Revise — evidence-depth upgrade (symbol grounding, AST-indexed context, diff-critic pass)

## Priority
HIGH

## Tags

- feature
- revise
- accuracy
- safety
- multi-phase

## Description

### Motivation

`planr revise` currently verifies the agent's **evidence array** but not the **task prose itself**. Surfaced during hands-on dogfooding of QT-004 (derived from BL-007):

- The agent's revise pass wrote `pushOneFeature()`, `pushOneUserStory()`, `pushOneTask()`, `pushOneQuickTask()`, `pushOneBacklogItem()` into task descriptions.
- None of those function names exist in [src/services/linear-push-service.ts](src/services/linear-push-service.ts). The real symbols are `pushOneFeatureAndDescendants`, `pushOneStoryUnderFeature`, `pushOneTaskListForFeature`, `pushOneQuickTaskWithContext`, `pushOneBacklogItemWithContext`.
- The agent's rationale confidently claimed "The task prose itself is consistent with the codebase." It wasn't — but nothing in the pipeline caught this because the agent never **cited** those symbols as evidence; it just **used** them in task text.
- Cost for the bad revise: 14,062 input → 2,367 output tokens. Cost for the implementer finding the bug: minute 1 of starting work on the QT.

The underlying gap: `planr revise` trusts the agent's prose if the cited evidence (file paths, grep hits, sibling artifacts) checks out. It never verifies that **new identifiers introduced in the revised markdown** (function names, class names, config keys) map to real symbols in the declared files. This makes revise a polish tool, not a correctness tool.

Fixing this is load-bearing for OpenPlanr's pitch: "planning artifacts that stay aligned with codebase reality." If the artifact says `pushOneFeature()` and no such function exists, alignment is theatre, not reality.

### Scope and provenance

- **Real gap:** the verifier pipeline has a blind spot between "evidence array citations" and "freeform prose in revisedMarkdown." Agents exploit it, not maliciously — they just don't know they should ground symbols they introduce.
- **Pre-existing:** every revise release to date has this gap. BL-008 is additive.
- **Blast radius:** improves correctness for EVERY revise run across EVERY artifact type (EPIC / FEAT / US / TASK / QT / BL). Strongest impact on TASK / QT / FEAT which reference code the most.
- **Out of scope for first release (deferred to later slices):** `planr revise` for non-TypeScript projects beyond the regex fallback (proper tree-sitter grammars for Python / Go / Rust), LSP-backed symbol resolution, cross-file import-graph aware symbol checks.

### What "good" looks like (directional)

- **After `planr revise QT-004`:** if the agent writes `pushOneFeature()` in task prose, the pipeline catches the symbol doesn't exist, demotes the decision to `flag`, and presents an `ambiguous` entry saying: _"Task 3.1 references `pushOneFeature()` but no such symbol exists in the declared relevant files. Nearest match: `pushOneFeatureAndDescendants` in src/services/linear-push-service.ts:229."_
- **After a successful revise:** the audit log records not just what changed but the full evidence chain — for each new symbol the agent introduced, show the `symbol_declared` citation line with file and line number.
- **For agents learning the pattern:** the prompt tells them explicitly that every function/class/config identifier in revisedMarkdown must either be preserved byte-for-byte from the TARGET_ARTIFACT or cited via the new `symbol_declared` evidence type. Few-shot example in the prompt.
- **For operators:** a `--no-critic` flag opts out of the second-pass critic for cost-conscious runs; a `--stats` subcommand reports accuracy over time.
- **For multi-language repos:** TypeScript and JavaScript get full AST-level symbol extraction; everything else falls back to regex-based symbol detection (weaker but catches the common patterns).

### Fix ladder (phased — each phase shippable independently)

#### Phase 1 — Prompt hardening + post-revise symbol lint (~1–2 days, ships first)

The fastest, highest-leverage slice. Closes the QT-004 class of bugs without any new AI calls.

**Prompt changes** in [src/ai/prompts/system-prompts.ts](src/ai/prompts/system-prompts.ts) (`REVISE_SYSTEM_PROMPT`):
- Add a section **"CRITICAL RULE: Symbol-level grounding"** that states:
  - Every function name, class name, exported constant, or config key mentioned in `revisedMarkdown` MUST either (a) be preserved byte-for-byte from the TARGET_ARTIFACT, OR (b) be cited via a `symbol_declared` evidence entry pointing at the file and line where it is declared.
  - If the agent wants to reference a symbol but can't verify its exact name, it emits `flag` with an `ambiguous` entry — never `revise`.
- Add one **few-shot example** showing a good `symbol_declared` citation vs. a bad guess, so the pattern is concrete.

**New evidence type** `symbol_declared` in [src/models/types.ts](src/models/types.ts) and the Zod schema:
- Shape: `{ type: 'symbol_declared', ref: '<exact-identifier>', file: '<relative-path>', line?: number, quote: '<the declaration line>' }`.
- Verifier checks: the file exists, the identifier appears in the file (strict `\b<identifier>\b`), optionally the line number lines up.

**Post-revise symbol lint** as a new step in the verifier pipeline ([src/services/evidence-verifier.ts](src/services/evidence-verifier.ts)):
- Extract candidate identifiers from `revisedMarkdown` using conservative regex: `\b([A-Z][a-zA-Z0-9_]{2,})\b` (PascalCase — classes/interfaces/types), `\b([a-z][a-zA-Z0-9_]+)\(` (camelCase calls), `` `([A-Za-z_][A-Za-z0-9_]*)` `` (backticked identifiers).
- Subtract identifiers that already appeared in `originalContent` (so existing prose doesn't trip the lint).
- For each remaining (new-in-revision) identifier, check presence in:
  1. `symbol_declared` evidence entries (trust);
  2. `codebaseContext.sourceInventory` file contents (fuzzy grep);
  3. `codebaseContext.symbolIndex` (see Phase 2) when available.
- If an identifier is introduced and unverifiable → add an `ambiguous` entry: _"Task §\<section\> introduces `<identifier>` — not found in declared relevant files. Nearest match: `<nearest>` in `<file>:<line>`. Re-run with tighter evidence."_
- Demote the decision from `revise` → `flag` when the count of unverifiable new identifiers exceeds a threshold (default: 1; configurable via `--max-unverified-symbols`).

**Acceptance criteria (Phase 1):**
1. `planr revise QT-004` on the current repo detects at least 5 unverifiable symbol introductions (the `pushOneFeature()` class of bugs).
2. Demotion is visible: `⚠ QT-004: decision demoted "revise" → "flag" (unverified symbols)` shows in the CLI, with the specific symbols listed as ambiguous entries.
3. Existing regression test suite stays green — the new lint never tightens strictness on artifacts that weren't changing identifiers (i.e., `skip` and `unchanged-by-agent` paths are untouched).
4. A new test file `tests/revise-symbol-lint.test.ts` covers: pure-prose revise (should pass), revise introducing a real symbol (should pass with `symbol_declared` citation), revise introducing a fake symbol (should demote).
5. Prompt-builder tests assert the new CRITICAL RULE section is rendered in the user message.

#### Phase 2 — AST-indexed codebase context (~3–5 days, ships second)

Gives the agent a symbol-level view of declared files so it has no plausible excuse to hallucinate. Complements Phase 1 — Phase 1 catches bad output after the fact; Phase 2 prevents the bad output upstream.

**Symbol index** added to [src/ai/codebase/context-builder.ts](src/ai/codebase/context-builder.ts):
- For TypeScript and JavaScript files: use the TypeScript Compiler API (already a devDep via `tsc`) to walk top-level declarations and collect `exports`, `functions`, `classes`, `interfaces`, `types`, `const`/`let`/`var` at module scope. Record `{ name, kind, file, line }`.
- For `.md` frontmatter keys / YAML config files: parse with `yaml` (already a dep) and record top-level keys as `kind: 'config-key'`.
- For every other language: regex-based fallback that matches `function <name>`, `class <name>`, `def <name>` (Python), `func <name>` (Go), `fn <name>` (Rust). Record with `confidence: 'regex'` so verifier knows it's fuzzy.
- Cache the symbol index per-run (already how `buildCodebaseContext` works — extend the same cache object).

**Context format** — include a `[SYMBOL_INDEX]` section in the prompt:
```
[SYMBOL_INDEX]
src/services/linear-push-service.ts:
  function pushOneFeatureAndDescendants    (line 229)
  function pushOneStoryUnderFeature        (line 335)
  function pushOneTaskListForFeature       (line 367)
  function pushOneQuickTaskWithContext     (line 917)
  function pushOneBacklogItemWithContext   (line 992)
  …
src/models/types.ts:
  interface LinearConfig                   (line 142)
  type BacklogStatus                       (line 252)
  …
```

Token-budget: for large repos, clip to the top N (default: 500) symbols across files that already appear in `CODEBASE_CONTEXT`. Don't flood the prompt with unrelated indices.

**Prompt update** — add a new section to `REVISE_SYSTEM_PROMPT`:
- "When SYMBOL_INDEX is present, prefer citing `symbol_declared` with exact names from the index. Hallucinated names will be caught by the post-revise lint."

**Acceptance criteria (Phase 2):**
1. A fresh `planr revise QT-004` after Phase 2 writes the correct names in task prose (because the agent can see them in `[SYMBOL_INDEX]`).
2. Symbol index builds in under 300ms on the OpenPlanr repo (174 files).
3. Non-TS projects (e.g., a Python-only repo in tests/fixtures) still get a useful regex-based symbol index — the lint has meaningful signal there too.
4. New fixture `tests/fixtures/revise/ts-symbol-index/` with a handful of TS files and a known symbol set; test asserts the index contains the exports we expect.
5. Symbol index respects `.gitignore` and the existing codebase-context exclude list (`node_modules`, `dist`, etc.).

#### Phase 3 — Diff-critic second pass (~2–3 days, ships third)

A cheap, optional second AI call that acts as an adversarial reviewer. First pass writes a revision confident in its rationale; second pass tries to find flaws in the diff alone. Exactly the dynamic a code-review culture relies on.

**Critic pass** as a new function in [src/services/revise-service.ts](src/services/revise-service.ts):
- Input: the **diff** (not the full revisedMarkdown), the `[SYMBOL_INDEX]`, and a tight adversarial prompt: _"You are a strict reviewer. Below is a proposed edit to an agile planning artifact. Find ONE specific, verifiable concern in this diff that would cause an implementer to fail: wrong symbol name, wrong file path, misstated behavior. Return `{ verdict: 'pass' }` if clean, or `{ verdict: 'flag', concern: '…', evidence: [...] }` otherwise."_
- Uses the cheapest capable model (default: `claude-haiku-4-5`, configurable via `config.ai.criticModel`).
- Token budget: tight — the diff is usually under 500 lines, so ~2K in / ~500 out.
- Runs only when the first pass says `action: 'revise'`. Never runs on `skip` / `flag` / `unchanged-by-agent`.

**Decision flow:**
- First-pass `revise` + critic `pass` → proceed normally.
- First-pass `revise` + critic `flag` → demote to `flag` with the critic's concern as an ambiguous entry.
- Opt-out: `--no-critic` CLI flag + `ai.critic.enabled: false` config.
- Cost reporting: audit log records both token counts separately.

**Acceptance criteria (Phase 3):**
1. The critic pass catches ≥ 50% of symbol-name mismatches that Phase 1's lint missed, measured against a hand-curated test set of 10 known-bad revises.
2. End-to-end cost increase for a typical revise run is under 10% (Haiku critic on a small diff).
3. `planr revise QT-004 --no-critic` produces exactly the same output as the Phase 2-only pipeline (regression gate).
4. Audit log shows both the first-pass rationale and the critic verdict.
5. Works when critic model is different provider from primary (e.g., primary Anthropic + critic OpenAI). Stretch.

#### Phase 4 — Apply-flagged workflow + observability + UX polish (~4–5 days, ships fourth)

The first three phases improve accuracy. Phase 4 closes two gaps: **(a)** give users a clean path to apply a flagged revise (today the only option is hand-editing from the audit log), and **(b)** let operators see whether the improvements stuck.

This is the phase the user explicitly called out: *"main goal we needed for revise is it should have apply flag where it apply the revise audit — we need simple clean apply revise result and if this needs still to use AI power, so yes add such needed improvements so Agent model selected can fix and apply the revise."*

**A. `planr revise --apply-flagged <auditPath> [<artifactId>]`** — scriptable escape hatch:
- Reads the specified audit log, locates entries with `outcome: flagged` AND a stored `diff` (the preserved rejected-proposal from Phase 0's audit-diff fix, which already shipped).
- With an artifact id argument, targets just that artifact. Without, prompts per entry.
- Applies the diff to disk using the same atomic-write + backup path as a normal revise.
- **Explicit confirmation required** — the CLI prints "WARNING: this revise was flagged by the verifier for ⟨reason⟩. Apply anyway? [y/N]" per artifact. No silent force.
- **Typed-YES gate in TTY** for multi-artifact apply batches (matches the existing bulk-revise safety).
- `--yes` skips the per-artifact confirm but the typed-YES for the batch still fires — the `--yes` flag is not a full auto-approve.
- Emits a fresh audit entry with outcome `applied-from-flagged` (new) recording the override, who applied it, and the original flag reason. Preserves the chain of decisions.

**B. Interactive `[a] apply anyway` option in the per-artifact confirm menu** — the everyday path:
- When `confirmAndMaybeEditRationale` sees a demoted-flag decision (action=flag AND `revisedMarkdown` present), it offers a new option: `[a] apply anyway (override verifier)` alongside `[s]kip`, `[q]uit`, `[d]iff again`.
- Default is still skip — applying a flagged decision must be an explicit affirmative keystroke.
- Prints the verifier's rejection reason above the prompt so the user decides with full context.
- Applies via the same code path as regular apply but tags the audit entry `applied-from-flagged`.

**C. `planr revise --retry-with-feedback`** — AI-assisted resolution of flagged revises:
- When a revise is flagged, this mode automatically re-runs the revise with the verifier's rejection feedback injected as additional user-message context.
- Feedback format: `[PRIOR_ATTEMPT_REJECTED] The previous revision was rejected because: ⟨reason⟩. Dropped evidence: ⟨list⟩. Produce a new revision that either (a) cites stronger evidence for the same changes, or (b) narrows scope to changes you can ground. If the original rejection is correct and no safe revision is possible, emit 'flag' again.`
- Bounded retries — default `--max-retries 2`, configurable. Counts tokens toward the usual budget.
- Second agent run is model-agnostic — uses `config.ai.model` like the first. (Phase 3's critic model config applies here too: `config.ai.retryModel` optional override, defaults to primary.)
- Terminal state after max retries: whatever the last attempt was. If still flagged, user still has the `--apply-flagged` and interactive `[a]` escape hatches.
- Audit log records every attempt as a nested entry so the cost + evolution of the decision is traceable.

**D. `planr revise --stats`** subcommand:
- Scans `.planr/reports/revise-*.md` and `revise-*.json` audit logs over a date range.
- Reports: total runs, outcome distribution (applied / applied-from-flagged / flagged / unchanged / …), average symbols verified per run, critic-flag rate, lint-demotion rate, retry-success rate (how often `--retry-with-feedback` converted a flag → applied), token cost including retries.
- Output format: table by default, `--json` for CI consumption, `--format markdown` for paste-into-issue.

**E. `planr revise --explain <artifactId>`** flag:
- Runs the pipeline but stops before the confirm prompt.
- Renders the full evidence chain: every `file_exists`, `grep_match`, `symbol_declared` citation, the symbol-lint verdict, the critic verdict, and the verifier's confidence score.
- Exits without writing. For auditors / reviewers evaluating a suspicious revise.

**F. Confidence scoring:**
- Aggregate: `(verified_evidence_count) / (total_evidence_count) * (1 - unverified_symbol_count / total_new_symbols)`.
- Below a configurable floor (default: 0.7): auto-demote to `flag`.
- Exposed on the audit line, the ProcessOneResult, and the `--explain` output.

**G. New audit outcome types** in [src/models/types.ts](src/models/types.ts):
- `applied-from-flagged` — user / CLI applied a flagged proposal via `--apply-flagged` or the interactive `[a]` path.
- `retry-succeeded` — `--retry-with-feedback` converted a flagged attempt into an applied revision.
- `retry-exhausted` — retry budget consumed, terminal state is the last attempt.

**Acceptance criteria (Phase 4):**
1. `planr revise --apply-flagged <auditPath>` on a flagged audit entry applies the rejected proposal to disk, with a typed-YES confirmation for TTY and `applied-from-flagged` logged in a new audit file.
2. Interactive `[a] apply anyway` option appears only for demoted-flag decisions (not for clean flags without `revisedMarkdown`). Skipping is still the default.
3. `planr revise --retry-with-feedback` converts at least 40% of synthetic flagged fixtures into applied revisions on retry (measured via the Phase 5 calibration harness).
4. `--retry-with-feedback` respects `--max-retries` and emits one audit entry per attempt with linked `retry-succeeded` / `retry-exhausted` outcomes.
5. `planr revise --stats --since 30d` on a repo with historical audit logs prints a useful table with non-zero numbers including retry stats.
6. `planr revise QT-XXX --explain` renders the full chain for a revise without writing.
7. A low-confidence revise auto-demotes (tested with a synthetic fixture).
8. Stats output is stable across re-runs (idempotent parsing of `.md` audit logs).
9. All three apply-override paths (scriptable `--apply-flagged`, interactive `[a]`, AI retry) are feature-tested with at least one happy path and one "user bailed / retry exhausted" path.

#### Phase 5 — Test-calibration harness (~2–3 days, ships fifth)

Without a harness, accuracy is impossible to maintain across model updates. Phase 5 is the regression gate for everything above.

**Calibration suite** under `tests/calibration/revise/`:
- Fixture artifacts with known-drifted content (fake function names, real function names, ambiguous cases, subtle misalignments).
- Each fixture annotated with `expectedOutcome: 'revise' | 'flag' | 'skip' | 'unchanged-by-agent'` and `expectedSymbolLintHits: number`.
- Harness: run the full pipeline against each fixture, assert outcomes match, aggregate accuracy metrics.
- Runs locally with `npm run calibrate`, reports pass/fail/uncertain counts.
- Skipped in CI by default (requires live AI credentials); opt-in via `RUN_CALIBRATION=1`.

**Acceptance criteria (Phase 5):**
1. At least 20 fixture artifacts spanning the outcome space.
2. `npm run calibrate` passes ≥ 80% on the main branch with default models.
3. Calibration harness is deterministic enough that passing/failing matches CI (no flake >5%).
4. Results persist to `.planr/reports/calibration-<date>.md` for historical comparison.

### Out of scope (deferred to future backlog items)

- **LSP-backed symbol resolution** — would use a real LSP server per language instead of regex/AST fallback. Better, but a rabbit hole. File as its own BL if Phase 2 proves insufficient.
- **Cross-file import-graph awareness** — when a symbol is declared via re-export, the current AST walker may miss it. File as a follow-up.
- **Non-code evidence types** (e.g., product-requirement quotes, ADR decisions from RFC boards) beyond `source_quote`. Separate workstream.
- **UI for editing ambiguous entries** — today the user edits the audit manually. A guided editor would be great but belongs in the CLI-interactive workstream.
- **Revise that can also modify parent artifacts** — tempting but changes the scope contract; deliberate deferral until the single-artifact version is rock-solid.

### Size estimate (multi-week)

Total: **~14–18 engineer-days** across 5 phases, each independently shippable.

| Phase | Days | Value |
|---|---|---|
| 1 — Prompt hardening + symbol lint | 1–2 | Catches QT-004-class bugs immediately |
| 2 — AST symbol index in context | 3–5 | Prevents bad output at source |
| 3 — Diff-critic second pass | 2–3 | Catches what Phase 1 misses |
| 4 — Apply-flagged workflow + observability + `--explain` + `--stats` | 4–5 | Closes the "manual-apply only" gap; operators can act on flagged output |
| 5 — Calibration harness | 2–3 | Keeps accuracy from drifting with model updates |

Release as a series of patch versions (one per phase), not a single mega-release.

**Phase 4 prioritization inside the phase:** ship sub-feature A (`--apply-flagged` scriptable) first, then B (interactive `[a]`), then C (`--retry-with-feedback`). A + B unblock the user's "manual apply only" pain immediately (~2 days). C adds AI-assisted resolution on top (~2 days). D + E + F + G are cheap once the outcome plumbing is in place (~1 day combined).

### Quick-task generation note

When promoting BL-008 to a QT via `planr backlog promote BL-008 --quick`, tasks should cover:
- The exact phase order above (don't let the agent flatten into a single task group — each phase is its own implementation slice with its own tests + docs).
- **Symbol lint's regex specificity** (PascalCase + `\w+\(` + backticked spans) and the originalContent-subtraction rule so existing prose doesn't trigger false positives.
- **Symbol index's token-budget clipping strategy** (top-N by reference count, not alphabetical).
- **Critic pass's model-provider-agnostic design** (must work when critic and primary are different providers).
- **Phase 4 apply-flagged sub-features** as independent tasks:
  - Scriptable `--apply-flagged` reading from audit log with typed-YES confirmation
  - Interactive `[a] apply anyway` menu option (only appears for demoted-flag decisions)
  - `--retry-with-feedback` AI-assisted retry loop with `--max-retries` and nested audit entries
  - New audit outcome types (`applied-from-flagged`, `retry-succeeded`, `retry-exhausted`)
- **Opt-out flags** (`--no-critic`, `--max-unverified-symbols`, `--max-retries`, `--no-retry`) with their exact defaults and config-file equivalents.
- **Calibration fixture format** and the `expectedOutcome` annotation schema, including fixtures that exercise the apply-flagged + retry paths (not just the clean-apply path).
- Tests per phase, not a single deferred test task.

Expected QT length: ~50–60 subtasks across 5 task groups. Reference implementation patterns to reuse:
- [resolveTaskStateIdForPush](src/services/linear-push-service.ts) — pattern for per-strategy resolver functions
- [buildCodebaseContext](src/ai/codebase/context-builder.ts) — extension point for symbol index
- [buildNameToBacklogStatusMap](src/services/linear-pull-service.ts) — pattern for side-car map builders
- [isEffectivelyUnchanged](src/services/revise-service.ts) — exported pure helper for the CLI + verifier + replay paths to share
- [createAuditLogWriter](src/services/audit-log-service.ts) — extend for `--stats` reader

---
_Promote to agile hierarchy: `planr backlog promote BL-008 --story` or `planr backlog promote BL-008 --quick`_
_Close when done: `planr backlog close BL-008`_
