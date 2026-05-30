// T-001 — declared write src/feature.ts, authored inside the worktree.
// In the HAPPY path this blob WOULD be applied to main. But because the same
// worktree ALSO wrote the undeclared src/undeclared.ts, Section 7 step 1
// withholds the ENTIRE worktree — this blob never lands in main either.
export const feature = () => 'feature';
