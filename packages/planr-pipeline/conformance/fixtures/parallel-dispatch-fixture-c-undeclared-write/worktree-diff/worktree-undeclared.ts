// T-001 — UNDECLARED write src/undeclared.ts, authored inside the worktree.
// This path is in NEITHER the task's Create nor Modify list. It is the rogue
// write that trips Section 7 step 1's subset check (wt_diff ⊄ declared), so the
// orchestrator rejects the whole worktree and this file NEVER lands in main.
export const undeclared = () => 'rogue';
