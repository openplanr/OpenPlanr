# Worktree and context custody

One run owns one locked worktree on its own branch, `planr-delegate/<runId>`, outside
the user's checkout. Only selected dirty state is copied, preserving starting bytes,
deletion and the Git executable bit, then committed as the run's base commit without
repository hooks. Full required ignored planning and repository instructions live in
the readable capsule. The source checkout and unrelated worktrees remain independent.

Custody records bind the run, worktree ownership, base commit, selected source state,
Preserve paths and the repository's refs. The delegate may commit; the run branch must
stay checked out and descend from its base. The branch checked out in the parent at
prepare may only fast-forward to commits that do not contain the run's base, and other
runs' restore refs may not be deleted. Any other ref change, such as a branch switch,
stash, fetch or tag, is a report warning.
Preserve changes, scope violations, submodule (gitlink) changes, including ones that
`ignore` settings hide, and patches the parent
checkout no longer accepts block acceptance. Integration scope constrains accepted
changes; it does not sandbox every native tool operation. Native tools, hooks,
plugins and MCP run under the native harness's permissions and trusted configuration.

Preparation happens once in the owned worktree. Its tracked changes are attributed
and join the candidate; no manual digest acceptance or immutable setup-path list is
needed. Ignored dependencies/build/cache outputs are ordinary worktree outputs.

Successful native integration removes only the owned worktree by checking its
ownership token and Git registration, then deletes its run branch. Retention can be requested before dispatch.
Failures/interruption retain custody. The private run keeps context, accepted patch,
verification evidence, report and exact native session reference after cleanup.
Old runs continue through their pinned helper; never broaden their policy or migrate
their records automatically.

Runs prepared by older helpers use detached worktrees and guarded integration, which keeps original directory entries for recovery and for writers holding the old inode. If Git metadata is on a different filesystem, private ignored write custody stays beside the destination and its location is recorded in the Git metadata before the first source write. Recovery validates that location inside the checkout. Existing metadata-based custody and pinned legacy helpers remain readable.
