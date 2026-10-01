# Worktree and context custody

One run owns one detached worktree outside the user's checkout. Copy only selected
dirty state, preserving starting bytes, deletion and the Git executable bit. Full
required ignored planning and repository instructions live in the readable capsule.
The source checkout and unrelated worktrees remain independent.

Custody records bind the run, worktree ownership, starting HEAD/index, selected
source state and Preserve paths. Commits, staging, Preserve changes, scope violations
and destination conflicts block acceptance. Integration scope constrains accepted
changes; it does not sandbox every native tool operation. Native tools, hooks,
plugins and MCP run under the native harness's permissions and trusted configuration.

Preparation happens once in the owned worktree. Its tracked changes are attributed
and join the candidate; no manual digest acceptance or immutable setup-path list is
needed. Ignored dependencies/build/cache outputs are ordinary worktree outputs.

Successful native integration removes only the owned worktree by checking its
ownership token and Git registration. Retention can be requested before dispatch.
Failures/interruption retain custody. The private run keeps context, accepted patch,
verification evidence, report and exact native session reference after cleanup.
Old runs continue through their pinned helper; never broaden their policy or migrate
their records automatically.

Guarded integration keeps original directory entries for recovery and for writers holding the old inode. If Git metadata is on a different filesystem, private ignored write custody stays beside the destination and its location is recorded in the Git metadata before the first source write. Recovery validates that location inside the checkout. Existing metadata-based custody and pinned legacy helpers remain readable.
