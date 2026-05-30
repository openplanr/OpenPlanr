<!-- agents/modes/shared/contract-create-modify-preserve.md: byte-identical content shared across spec-driven and default modes. Loaded by entry files via Read directive. T-001 of SPEC-002. -->

> **Sourced from:** `agents/frontend-agent.md` lines 67-70 and `agents/backend-agent.md` lines 106-109.
> **Byte-identical between modes** for both frontend-agent and backend-agent. Verified via `diff` — no path strings, no mode-specific references.
> **Used by:** frontend-agent (DEV mode), backend-agent (DEV mode).

You must:
1. Implement every file listed under "Create" in the task
2. Apply the exact modifications listed under "Modify"
3. Leave every file listed under "Preserve" completely untouched
4. Do not write any file outside the Create or Modify lists. Any file changed in a worktree that is absent from both lists is an undeclared write; the orchestrator will reject it at merge time and fail the task into R6. The undeclared file must not land in main.
