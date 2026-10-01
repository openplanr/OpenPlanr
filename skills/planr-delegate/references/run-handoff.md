# Run/session lifecycle

Each new run has private v2 records, a complete readable capsule, one owned detached
worktree and a pinned helper snapshot. Records contain configuration references,
not credential values. Old runs route operations through their unchanged pinned
helpers; there is no automatic migration or permission expansion.

`dispatch` starts the native implementation loop. Native session identifiers and
terminal events establish execution completion. Plain native summaries are saved;
missing summary formatting is only a warning. A missing terminal event, failed
exit or native permission denial needs attention. Execution completion is distinct
from independent verification and integration acceptance.

`resume` requires `runId` and exactly one `answer` or `correction`. It continues only
the recorded session, sending the new handoff without repeating the complete
context. Never use latest-session selection or switch providers to work around a
denial. Permission resolution happens through normal native configuration.

`status` exposes phase timings, inactivity, session evidence, diagnostics and saved
verification. `wait` is bounded to 60 seconds and supports `afterUpdatedAt`.
No OpenPlanr deadline is imposed by default. `timeoutMs` sets an explicit per-turn
deadline. Inactivity is visible but does not terminate a healthy run. Cancellation
and interrupted-run recovery stop only the recorded owned process group. Concurrent
dispatch/resume/apply operations are excluded by private run locks. If stopping an
owned process group fails, its identity and candidate remain retained; recovery must
confirm termination before another execution, review, verification or cleanup.

Successful `apply` closes the run as integrated and automatically removes its owned
worktree unless `retainWorktree` was requested. The patch, context, verification,
report and exact native session reference remain. Failed/interrupted worktrees are
retained. Cleanup failure is reported without undoing successful integration.
Explicit `cleanup` operates only on a closed owned worktree; abandonment must be
explicit. Unresolved integration must use the integration helper's recovery action.
