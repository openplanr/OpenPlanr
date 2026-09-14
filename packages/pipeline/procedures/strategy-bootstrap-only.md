# Procedure: Strategy `BOOTSTRAP_ONLY` (Step 0.6)

Existing Node project, first-time planr install. **No scaffolding.**

1. Print: `✓ State: bootstrap-only (existing project, first planr install)`
2. Run `${CLAUDE_PLUGIN_ROOT}/procedures/write-planr-dirs.md` (writes `.planr/config.json` and creates `.planr/specs/` + `input/tech/`).
3. Run `${CLAUDE_PLUGIN_ROOT}/procedures/author-stack-from-brief.md` **if** `BRIEF` mentions stack components. (The procedure is a no-op when `BRIEF` is empty or has no stack hints; the existing self-heal in Step 1 then handles `input/tech/stack.md` creation.)
4. Proceed to Step 1 (`commands/plan.md`).
