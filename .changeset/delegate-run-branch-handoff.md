---
'openplanr': minor
---

Delegated runs now hand their work back through a Git branch. Each new run works on its own branch from a base commit that holds your selected files, and `apply` uses `git apply` to leave the same uncommitted diff as before.

- If you edit another part of a file the delegate changed, the two edits now merge. An edit to the same lines still blocks, and the blocked result names the file.
- Checks run on your last commit plus the selected files and the delegate's changes. Your other uncommitted files are no longer part of the checks; the report lists them.
- A change to a submodule pointer blocks review, because `git apply` cannot update it. This holds when `ignore` settings hide the submodule.
- Branch switches, stashes, fetches and tags made during a run are listed in the report and do not block it. The run blocks if its own branch is moved off its base, if your checked-out branch is rewound or picks up the run's commits, or if another run's restore point is deleted.
- A dangling symlink or a submodule in your checkout no longer makes apply fail when you have other uncommitted edits.
- If an apply is interrupted, `recover` can accept a fully applied patch or roll it back without overwriting your edits.

Runs prepared before this release finish with the helper they started with.
