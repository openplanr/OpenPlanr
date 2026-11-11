# Worktree and context custody

One run owns one locked worktree on its own branch, `planr-delegate/<runId>`, outside
the user's checkout. Only selected dirty state is copied, preserving starting bytes,
deletion and the Git executable bit, then committed as the run's base commit without
repository hooks. Full required ignored planning and repository instructions live in
the readable capsule. The source checkout and unrelated worktrees remain independent.

Custody records bind the run, worktree ownership, base commit, selected source state,
Preserve paths and the repository's refs. The delegate may commit; the run branch must
stay checked out and descend from its base. The branch checked out in the parent at
prepare may not be deleted or moved to a commit that contains the run's base, and a
restore ref may not be deleted while its run is still applying or interrupted. Any
other ref change, such as a branch switch, amend, reset, stash, fetch or tag, is a
report warning.
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
Old runs continue through the runtime copy that prepared them; never broaden their
policy or migrate their records automatically. Runs prepared before the run branch use
detached worktrees and their own integration.
