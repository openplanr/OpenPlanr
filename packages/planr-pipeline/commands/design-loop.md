---
description: Interactive design exploration — parallel AI variants on a live comparison board (pins, ratings, remix), conversational iteration, taste memory. For ANY design target (logo, brand-sheet, screen, og-image).
argument-hint: "<target|slug> [--provider openai|claude-svg|auto] [--count N] [--project <slug>]"
---

# /planr-pipeline:design-loop {target}

The generalized design shotgun: concept list → **confirm before any spend** → N parallel
variants → a live localhost **board** (the board is the chooser; chat is only the wait) →
file-handshake feedback (pins on exact regions, ratings, remix) → session-chained iteration →
approval → taste memory. Works with an OpenAI key (image generation) **and without one**
(claude-svg: agent-authored SVG — for logos/UI often better: exact hex, real type, vector output).

**Engine:** `${CLAUDE_PLUGIN_ROOT}/lib/design-engine/cli.mjs` (`node <abs-path> <cmd> …`).
Resolve `PLUG` exactly as `design-step2-generate.md` C.1 does (this file's path minus
`/commands/design-loop.md`); **always substitute absolute paths** — shell vars don't reach
subagents (hard rule 6).

**R1:** this loop STOPS at approval. It never auto-chains into `/plan` or `/ship`.

**Sharing is explicit:** the board's **Share** control creates an immutable multi-variant
artifact review only when the user selects it. Opening the board, submitting feedback,
regenerating, or approving never publishes anything. A remote reviewer returns a new review
URL; bring it back with `planr artifact import "<returned-review-url>"`. Importing feedback is
also explicit and never advances PLAN → SHIP.

## Task tracking

Create one task per phase (`TaskCreate`, advance with `TaskUpdate`; pre-2.1.142 runtimes:
TodoWrite; no task tool: inline). Verify each phase's outputs on disk before advancing.

1. `Phase A — Context + taste + concepts`
2. `Phase B — Concept gate (no spend before confirm)`
3. `Phase C — Parallel variant generation`
4. `Phase D — Board loop (feedback → iterate)`
5. `Phase E — Approve + taste + handoff`

## Phases (execute in order)

| Phase | Procedure |
|---|---|
| A — context, taste read, concept list | `${CLAUDE_PLUGIN_ROOT}/procedures/design-loop-step0-context.md` |
| B — the concept gate | `${CLAUDE_PLUGIN_ROOT}/procedures/design-loop-step1-gate.md` |
| C — parallel variants | `${CLAUDE_PLUGIN_ROOT}/procedures/design-loop-step2-variants.md` |
| D — board + iteration loop | `${CLAUDE_PLUGIN_ROOT}/procedures/design-loop-step3-board.md` |
| E — approve, taste, handoff | `${CLAUDE_PLUGIN_ROOT}/procedures/design-loop-step4-approve.md` |

## Hard rules (verbatim — paid-for lessons; the procedures encode the detail)

1. **Concept gate before credits** — never generate anything the user hasn't confirmed.
2. **AskUserQuestion is the blocking wait, never the chooser** — the board chooses; put the
   BOARD_URL in the question text.
3. **Feedback is a FILE next to the board HTML** — read it only after the user says done;
   never parse feedback from chat. `feedback-pending.json` is consumed on read.
4. Variant subagents own their lifecycle and report `VARIANT_X_DONE/FAILED/RATE_LIMITED` —
   failures explicit, never silently skipped; all-fail → sequential fallback, reason stated.
5. Generate to `/tmp` first, then `cp` (the engine does this; keep it when hand-authoring).
6. Absolute paths in every subagent prompt.
7. Never print/echo keys; disclose cwd-`.env` key usage before generating; check it's gitignored.
8. Anti-convergence: different font family + palette + layout per variant — "if you could swap
   two variants' headlines unnoticed, one failed — regenerate it."
9. No key ⇒ claude-svg is first-class, not an apology.
10. Vision/structural quality gate before human review; one retry.
11. Taste updates on BOTH approve and reject; conflicts flagged, never silently resolved.
12. R1: stop at approval.
13. Every artifact dir gets a scoped `.gitignore` (the engine writes it).
14. Board survives a dead agent; agent survives a dead daemon (re-`board` the same dir).
15. **Share/import are explicit** — no board lifecycle event uploads, publishes, imports, or
    continues into `/plan` or `/ship` automatically.
