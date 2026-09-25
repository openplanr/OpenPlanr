# Procedure: /design-loop Phase B — the concept gate (no spend before confirm)

> Hard rule 1: never spend credits on generation the user hasn't confirmed.
> AskUserQuestion enforcement is the same as `design-step1-clarify.md` "B — Enforcement":
> a REAL tool_use, never prose, never auto-decided; if no AskUserQuestion variant is
> callable, STOP with `BLOCKED — AskUserQuestion unavailable`.

## B.1 — Present the run, then gate

Issue ONE mandatory `AskUserQuestion` that shows, in the question text:

- the `COUNT` concepts (one line each, A/B/C/D);
- the **provider + cost** (`PROVIDER` from Phase A):
  - `PROVIDER=claude-svg` (the default) → "claude-svg — I author precise SVG sheets myself
    ($0, no key). For logos and UI this is often BETTER than diffusion: exact geometry, real
    type, production-ready vector.";
  - `PROVIDER=openai` (only because the user asked for it) →
    `openai — gpt-5.5 with the gpt-image-2.5-sunburst image model (or the --model /
    --image-model overrides), ~N images at <size>/<quality>, billed to your OpenAI account`.
    Never quote a price. With `HAS_KEY=false`, say so and **offer both repairs, never
    dead-end** (hard rule 9): `planr-design setup` (stores the key + one billed smoke image)
    or claude-svg;
- where artifacts will live (the user-space session dir).

Options:
> A) **Generate these {COUNT}** — provider {name}, {cost} *(recommended)*
> B) **Revise the concepts** — tell me what to change (loops back to A.4 once)
> C) **Switch provider** — {the other provider + its tradeoff: claude-svg is $0 vector authored
>    here; openai is raster generation billed to your OpenAI account and needs a key}
> D) **Cancel**

- **A** → Phase C. **B** → revise once, re-gate. **C** → flip provider, re-gate. **D** → STOP.
- Under `--yes`: NOT honored for the first gate of a session — the concept gate is the one
  ask that always happens (it is the spend authorization). Say so if `--yes` was passed.
