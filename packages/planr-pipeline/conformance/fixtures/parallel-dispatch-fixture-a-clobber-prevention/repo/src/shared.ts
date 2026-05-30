// Final post-merge state of src/shared.ts after BOTH waves.
// T-001 (wave 0) set version-A; T-002 (wave 1) set version-B LAST.
// Main reflects ONLY version-B — the second task's output, no clobber artifact.
export const shared = () => 'version-B';
