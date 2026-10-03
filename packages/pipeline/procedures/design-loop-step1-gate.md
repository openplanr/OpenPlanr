# Procedure: /design-loop Phase B — the concept gate (no spend before confirm)

> Hard rule 1: never spend credits on generation the user hasn't confirmed.
## B — Enforcement

Show the concepts, provider, cost basis and artifact location before generation.
Existing explicit authorization for this run remains valid. If generation would
spend credits and authorization is missing, ask through the host's native question
surface; use a direct chat question when that surface is unavailable. Wait for the
answer. Never treat a preselected option or elapsed time as approval, and never
silently change the provider. Pure local vector authoring has no provider charge.
A clear authorized brief does not require another format/source questionnaire:
Studio offers Canvas, Prototype and Walkthrough for the same document.

## B.1 — Present the run, then gate

When the run needs authorization, issue one question that shows, in the question text:

- the `COUNT` concepts (one line each, A/B/C/D);
- the **provider + cost** (`PROVIDER` from Phase A):
  - `PROVIDER=claude-svg` (the default) → "claude-svg — I author precise SVG sheets myself
    ($0, no key). For logos and UI this is often BETTER than diffusion: exact geometry, real
    type, production-ready vector.";
  - `PROVIDER=openai` (only because the user asked for it) →
    `openai — gpt-5.5 with the gpt-image-2.5-sunburst image model (or the --model /
    --image-model overrides), ~N images at <size>/<quality>, billed to your OpenAI account`.
    Never quote a price. With `HAS_KEY=false`, say so and **offer both repairs, never
    dead-end** (hard rule 9): `planr-pipeline design-engine setup` (stores the key + one billed smoke image)
    or claude-svg;
- where artifacts will live (the user-space session dir).

Options:
> A) **Generate these {COUNT}** — provider {name}, {cost} *(recommended)*
> B) **Revise the concepts** — tell me what to change (loops back to A.4 once)
> C) **Switch provider** — {the other provider + its tradeoff: claude-svg is $0 vector authored
>    here; openai is raster generation billed to your OpenAI account and needs a key}
> D) **Cancel**

- **A** → Phase C. **B** → revise once, re-gate. **C** → flip provider, re-gate. **D** → STOP.
- An explicit unattended instruction may select the declared concepts, but it cannot
  authorize a new billed provider implicitly. Preserve the approved provider and budget.
