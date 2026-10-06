# Procedure: /design-loop Phase B — the concept gate (no generation before confirm)

> Hard rule 1: never generate variants the user hasn't confirmed.
## B — Enforcement

Show the concepts and artifact location before generation. Existing explicit
authorization for this run remains valid. If authorization is missing, ask through
the host's native question surface; use a direct chat question when that surface is
unavailable. Wait for the answer. Never treat a preselected option or elapsed time
as approval. Local vector authoring has no provider charge.
A clear authorized brief does not require another format/source questionnaire:
Studio offers Canvas, Prototype and Walkthrough for the same document.

## B.1 — Present the run, then gate

When the run needs authorization, issue one question that shows, in the question text:

- the `COUNT` concepts (one line each, A/B/C/D);
- how they are made: "I author precise SVG sheets myself — exact geometry, real type,
  production-ready vector.";
- where artifacts will live (the user-space session dir).

Options:
> A) **Generate these {COUNT}** *(recommended)*
> B) **Revise the concepts** — tell me what to change (loops back to A.4 once)
> C) **Cancel**

- **A** → Phase C. **B** → revise once, re-gate. **C** → STOP.
- An explicit unattended instruction may select the declared concepts.
