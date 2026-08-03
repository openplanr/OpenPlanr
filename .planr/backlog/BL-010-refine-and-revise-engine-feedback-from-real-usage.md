---
id: "BL-010"
title: "refine and revise engines: real-usage feedback — grounding, non-goal enforcement, user-stated focus, deliverable preservation"
priority: "critical"
tags: ["feedback", "refine", "revise", "accuracy", "grounding", "regression-fixture"]
status: "open"
created: "2026-04-25"
updated: "2026-04-25"
---

# BL-010: refine and revise — real-usage feedback

## Priority
CRITICAL

## Tags

- feedback
- refine
- revise
- accuracy
- grounding
- regression-fixture

## Description

Verbatim feedback from a user who ran OpenPlanr 1.3.0 on a 60-task implementation effort. The structural output (`quick create`) was good; both `refine` and `revise` failed to fix flagged inaccuracies and `refine` actively made the artifact worse. This BL captures the full report so we can act on it without re-deriving it. Implementation of the recommendations is a follow-up — track here, slice into Phase plans only after triage.

---

# Feedback for OpenPlanr Developers — Improving `refine` and `revise`

## Context
We used OpenPlanr 1.3.0 to plan a 60-task implementation effort (audit-driven framework completion). The initial `quick create` output was structurally good but had ~4 technical inaccuracies. We then ran `refine` and `revise` to fix them. **Both passes failed to fix the inaccuracies, and `refine` actively made the artifact worse.** This document specifies what went wrong and how to fix the engine.

---

## What `refine` did wrong

### 1. It added fluff instead of fixing facts
Refine appended ornamental phrases — "with proper error handling", "with exponential backoff", "with connection pooling", "with rollback capabilities", "with deployment automation" — to nearly every task. None of these were grounded in repo reality. Examples:
- Added **"exponential backoff"** to a 3-iteration deterministic build/test loop. Backoff is meaningless when failures are compile errors, not transient network issues.
- Added **"connection pooling"** to a one-shot DB schema introspection. Pools serve repeated queries, not a single scan.
- Added **"rollback capabilities"** to a snapshot generator. Snapshots are append-only logs; rollback has no semantics here.
- Added **"deployment automation"** to a DevOps agent — directly contradicting the framework's documented non-goal ("It doesn't deploy").

**Root cause:** the refine prompt appears to reward verbosity ("make tasks more detailed") without verifying that added detail is consistent with the source PRD's scope and non-goals.

### 2. It ignored repo reality
Refine left tasks like `1.1 Create /po-phase slash command handler in CLAUDE.md` untouched — even though slash commands in Claude Code live in `.claude/commands/*.md`, not in CLAUDE.md. The refine pass had no mechanism to verify whether a path or pattern in a task is actually correct for the target system.

### 3. It introduced new contradictions
Refine recommended placing `error-report.md` at "project root" — directly conflicting with rules already in `docs/rules.md` (task-folder location). It made unilateral architectural decisions without checking existing project rules.

---

## What `revise` did wrong

### 1. Inconsistent application of its own evidence
The audit log cited four missing files as evidence:
- `templates/error-report.md`
- `agents/qa-agent/AGENT.md`
- `agents/devops-agent/AGENT.md`
- `agents/doc-gen-agent/AGENT.md`

Then revise removed only the **first** from Relevant Files and kept the other three. Same logic ("file doesn't exist"), opposite actions. There was no rule distinguishing "file to create" from "dead reference".

### 2. Confused "needs to be created" with "doesn't exist (delete it)"
`templates/error-report.md` was explicitly the deliverable of task 5.3. Revise treated it as a dead reference and removed it from the file list. After revise, the QT now had a task to "Create shared error-report.md schema/template" with no entry in Relevant Files describing what file gets created.

### 3. Didn't address the inaccuracies the user actually flagged
The user (us) had explicitly listed 4 inaccuracies in conversation context. Revise had no way to ingest user-stated correction targets — it ran its own generic audit and missed all four.

---

## What we did manually (after both passes failed)

We applied four targeted edits the engine should have caught:

1. **`1.1, 1.2`** — changed "in CLAUDE.md" to specific files (`.claude/commands/po-phase.md`, `.claude/commands/dev-phase.md`) with frontmatter conventions and the `$ARGUMENTS` mechanism.
2. **`5.4`** — replaced vague "agent handlers" with the actual two files (`frontend-agent/AGENT.md`, `backend-agent/AGENT.md`) and spelled out the loop's exit conditions.
3. **`6.1`** — moved the Stop hook config target from `helpers/snapshot.md` to the correct location, `.claude/settings.json`.
4. **`10.5`** — replaced non-existent `AGENTS.md` with files that actually exist (`docs/pipeline-overview.md`, `README.md`).

Then we overhauled Relevant Files: added all NEW files explicitly marked, restored what revise wrongly removed, made each entry describe *what to change* rather than generic descriptions, and added conditional entries tied to scope decisions (e.g. "create mongodb.md only if MongoDB stays as supported").

---

## Concrete improvements we recommend

### A. Refine engine
1. **Adopt a "no embellishment without evidence" rule.** Every additive clause should cite a source: a PRD line, an existing repo file, a task DoD. If refine wants to add "with exponential backoff", it must point to a PRD constraint demanding it. Otherwise drop the phrase.
2. **Honor explicit non-goals.** Parse PRD's "Non-Goals" / "Out of Scope" sections and strip any task content that contradicts them.
3. **Verify file paths against the repo file tree.** Before changing or keeping a path in a task, check it against the actual filesystem. If `slash command handler in CLAUDE.md` is the input and the project is a Claude Code project, refine should know that slash commands live in `.claude/commands/` and either fix it or flag it.
4. **Detect over-specification.** Heuristic: if a task adds an architectural pattern (pooling, backoff, rollback, automation) that isn't in the PRD or parent artifact, prompt for justification or drop.

### B. Revise engine
1. **Distinguish "missing dead reference" from "missing deliverable".** A file listed in Relevant Files that doesn't exist is only dead if no task creates it. Cross-reference task descriptions before deleting Relevant Files entries.
2. **Apply the same rule consistently.** If 4 files trip the same evidence type, treat them identically — or surface a clarifying question.
3. **Accept user-stated correction targets.** Add `--focus "<comma-separated list of issues>"` so a user can say `planr revise QT-001 --focus "1.1 should be .claude/commands/, 6.1 should be settings.json, 10.5 references nonexistent AGENTS.md"`. Without this, revise re-runs a generic audit and misses what the user is actually asking for.
4. **Show before/after diffs grouped by inaccuracy class** (path correction, contradiction resolution, stale reference removal) instead of one big diff. Lets the user accept selectively.

### C. Both engines: shared improvements
1. **Tool-aware path validation.** Detect the toolchain (Claude Code, Cursor, Codex) from `.claude/`, `.cursor/`, `.codex/` and validate slash-command/hook/config paths against that toolchain's actual conventions. Ship a small registry of conventions per tool.
2. **Specificity score per task.** Before writing, compute a score: does this task name a file? a function? an exit condition? Tasks scoring below threshold get auto-flagged for follow-up clarification rather than shipped.
3. **Cross-task consistency check.** If task X creates file Y, file Y must appear in Relevant Files. If file Y is in Relevant Files but no task creates or modifies it, flag.
4. **Surface low-confidence claims.** When the LLM adds a path, framework name, or config target, attach a confidence — and gate acceptance for low-confidence ones rather than silently writing them.
5. **PRD non-goal enforcement.** Both engines should treat PRD non-goals as **hard constraints**, not suggestions. Currently refine added "deployment automation" despite the PRD explicitly saying the framework doesn't deploy.

---

## Test cases to add to the OpenPlanr regression suite

Use this session as a regression fixture. Concrete tests:

1. **Path correctness:** A PRD asking for "slash commands" in a Claude Code repo. Expected: tasks reference `.claude/commands/`, not `CLAUDE.md`.
2. **Non-goal honoring:** A PRD with "Non-Goals: does not deploy". Expected: no task or agent description mentions deployment automation.
3. **Refine idempotency on a clean artifact:** Running refine on an already-good QT should produce minimal or no diff, not append filler phrases.
4. **Revise consistency:** When N files trip the same evidence rule, all N should receive the same treatment, or revise should request clarification.
5. **Deliverable preservation:** A file listed in Relevant Files that is created by a task in the same QT must never be removed by revise.
6. **User-targeted revision:** With `--focus "X is wrong, should be Y"`, revise must address X→Y or explain why it can't.

---

## Net assessment

OpenPlanr's structural output is excellent — the QT created on first pass had the right shape, right scope, right grouping. The weakness is in the **second-pass quality engines** (`refine`, `revise`). They behave like generic LLM rewriters: they add detail without grounding, audit without consistency, and have no concept of "the user has already told us what's wrong." Fixing these is more about constraint engineering than prompt tuning — bake repo awareness, non-goal enforcement, and cross-artifact consistency into the engines as hard checks rather than soft suggestions.

The session that produced this feedback is reproducible against the artifact at `.planr/quick/QT-001-po-dev-framework-completion-full-implementation.md` and the audit log at `.planr/reports/revise-QT-001-2026-04-25.md`.

---
_Promote to agile hierarchy: `planr backlog promote BL-010 --story` or `planr backlog promote BL-010 --quick`_
_Close when done: `planr backlog close BL-010`_
