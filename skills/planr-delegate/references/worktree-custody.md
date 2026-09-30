# Delegation worktree custody v1

`custody.mjs` is the internal Node 20+ worktree helper. It owns one writable Git repository per run. It is not a filesystem or network sandbox; only explicitly enrolled, trusted local agent profiles may use it. No custody operation commits, publishes, or deploys.

## API

```js
import {
  planWritableScopes,
  createWorktreeCustody,
  validateWorktreeCustody,
  captureFileState,
  cleanupWorktreeCustody,
} from './custody.mjs';

const custody = await createWorktreeCustody({
  repositoryRoot: '/absolute/source/checkout',
  capsule,                         // from context.mjs
  selectedPaths: ['src/related.js'], // optional; defaults to project selected-source inventory
  preservePaths: ['src/protected'], // repository policy; task Preserve is read from capsule
  readOnlyRepositories: [],         // each must explicitly say writable: false
  worktreeParent: '/private/per-user/runs',
  runId: 'run-123',
});
const validation = await validateWorktreeCustody(custody);
// Explicit only, after accepted integration or abandonment:
await cleanupWorktreeCustody(custody, { disposition: 'accepted' });
```

`planWritableScopes({repositories,contractOwnerKey})` returns one scope per writable repository, with the contract owner first. Each scope has exactly one `writableRepository` and only selected `readOnlyRepositories` with `selectedContext`. It never creates a combined multi-repository writable run. The runner must still verify each selected read-only context file when building that run's capsule.

`createWorktreeCustody` requires an existing worktree parent outside the source repository. It creates a unique detached Git worktree under a new `planr-delegate-*` directory. It only copies explicitly selected project source files, including dirty tracked and nonignored untracked bytes, executable mode, and tracked deletions. Selected paths must stay within the repository and, when a capsule is supplied, must appear in its project `selected-source` inventory. Ignored untracked files and symlink escapes are rejected. Unrelated source-checkout changes and ignored `.planr` material are untouched. The original planning material is carried separately in the private context capsule.

The returned serializable custody record contains `repositoryRoot`, `worktreePath`, `initialHead`, SHA-256 fingerprints of the initial worktree and source Git indexes (`initialIndex`, `sourceIndex`), `selectedPaths`, `sourceFiles`, `startingFiles`, `preservePaths`, and `preservedFiles`. `sourceFiles` and `startingFiles` map selected paths to an `absent`, `file`, or `symlink` state. File states include mode, byte length, digest, and exact `contentBase64`; symlink states include the target string. Unlisted starting paths retain their `initialHead` state. These fingerprints are internal custody data, not user-facing gates.

Task Preserve paths are extracted from the capsule's full task frontmatter. Caller-supplied repository-policy paths are added. `preservedFiles` records the file or directory tree at start, including file type, mode, content digest, symlink target digest, and absence. `validateWorktreeCustody(record)` returns `{valid,violations,changedPaths}`. Violations identify worktree HEAD/index drift, staged paths, or Preserve changes. Source HEAD/index movement is information; integration checks the actual destination paths against their recorded baseline. A clean final worktree does not hide a delegate commit because HEAD changed. The runner must stop on any violation and leave the worktree available for review.

`captureFileState(root,path)` reads one safe relative path for later integration; it rejects symlink escape. A failed preparation retains its newly created run directory for diagnosis. Questions, cancellation, crash, blocked result, failed validation, and merge conflicts never trigger cleanup automatically. `cleanupWorktreeCustody` requires an explicit `accepted` or `abandoned` disposition, verifies the registered managed worktree path, then removes only that worktree. Keep custody records private; they contain copies of selected source bytes. `CustodyError` never includes file content.

The runner exposes explicit `cleanup` for accepted or abandoned runs, preserving private records until retention pruning. `prune` refuses a remaining managed worktree; failed/blocked/questioning runs are never cleaned automatically.
