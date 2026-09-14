# Procedure: /design-loop Phase B — the concept gate (no spend before confirm)

> Hard rule 1: never spend credits on generation the user hasn't confirmed.
> AskUserQuestion enforcement is the same as `design-step1-clarify.md` "B — Enforcement":
> a REAL tool_use, never prose, never auto-decided; if no AskUserQuestion variant is
> callable, STOP with `BLOCKED — AskUserQuestion unavailable`.

## B.1 — Present the run, then gate

Issue ONE mandatory `AskUserQuestion` that shows, in the question text:

- the `COUNT` concepts (one line each, A/B/C/D);
- the **provider + estimated cost**:
  - `HAS_KEY=true` → `openai (gpt-image-2) — ~N images ≈ $X.XX` (size/quality dependent;
    state the assumption);
  - `HAS_KEY=false` → **offer claude-svg explicitly, never dead-end** (hard rule 9):
    "no OpenAI key — I'll author precise SVG sheets myself ($0). For logos this is often
    BETTER than diffusion: exact geometry, real type, production-ready vector.";
- where artifacts will live (the user-space session dir).

Options:
> A) **Generate these {COUNT}** — provider {name}, est. {cost} *(recommended)*
> B) **Revise the concepts** — tell me what to change (loops back to A.4 once)
> C) **Switch provider** — {the other provider + its tradeoff}
> D) **Cancel**

- **A** → Phase C. **B** → revise once, re-gate. **C** → flip provider, re-gate. **D** → STOP.
- Under `--yes`: NOT honored for the first gate of a session — the concept gate is the one
  ask that always happens (it is the spend authorization). Say so if `--yes` was passed.
