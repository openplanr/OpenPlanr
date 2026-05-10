# Procedure: Strategy `CONTINUE` (Step 0.6)

Project is fully initialized. Step 0 has nothing to do beyond binding `STRATEGY = CONTINUE`.

1. Print: `✓ State: continue (existing planr project)`
2. Proceed to Step 1.

If `HAS_SPEC` is true, Step 1 sees the existing spec and dispatches the agents. If `HAS_SPEC` is false, Step 1's auto-scaffolding (Step 1b in `commands/plan.md`) handles spec body authoring — it uses `BRIEF` if present, falls back to the template otherwise.
