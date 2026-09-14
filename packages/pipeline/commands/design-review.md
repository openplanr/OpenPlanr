---
description: Pin-comment review loop on an existing generated design — serve finalized.html/canvas.html on the live board, pin "fix THIS", regenerate only that screen, sync the PO artifacts
argument-hint: "<slug> [--yes]"
---

# /planr-pipeline:design-review {slug}

Turns a `/planr-pipeline:design` artifact into a **live review canvas**: the board daemon
serves the real `finalized.html` / `canvas.html`, the user pins comments on exact regions
(each pin auto-maps to its screen/section id), and this loop regenerates **only the pinned
screen** — then the results flow back into the PO artifacts (`design-spec.md`,
`finalized.json`, `.run-manifest.jsonl`).

**Engine:** `${CLAUDE_PLUGIN_ROOT}/lib/design-engine/cli.mjs` (absolute paths everywhere —
hard rule 6). **R1:** STOPS after approval; print `next: /planr-pipeline:plan {slug}`.

The board may be shared only through its explicit **Share** control (or an explicit
`planr artifact share <artifact-file>` command). Opening, commenting, regenerating, or
approving does not publish the artifact. A remote reviewer returns an immutable review URL;
`planr artifact import "<returned-review-url>"` deliberately merges that review into the
adjacent feedback lifecycle. Share/import never auto-chain this review into `/plan` or `/ship`.

## Task tracking

1. `Phase A — Locate artifact + serve review board`
2. `Phase B — Pin loop (regenerate pinned screens, lint-gated)`
3. `Phase C — Approve + sync PO artifacts (R1 stop)`

## Execute

`${CLAUDE_PLUGIN_ROOT}/procedures/design-review-loop.md` — all three phases.

## Non-negotiables

- The **lint gate stays at 0 errors** after every regeneration
  (`node $PLUG/lib/design/lint.mjs <artifact>` — off-grid spacing + AA contrast are hard
  failures; design-system token/font adherence warnings get fixed, not ignored).
- Only the pinned screen/section is regenerated — never the whole artifact for one pin.
- Feedback is the board's FILE; `feedback-pending.json` is consumed on read (hard rule 3).
- AskUserQuestion is only the blocking wait; the board is where review happens (hard rule 2).
- Share and review-URL import require explicit user actions; neither is an approval signal,
  regeneration request, publication side effect, or PLAN → SHIP transition.
