# Observed change review and local integration

Delegate prose is never changed-file authority. `reviewDelegateDelta` compares the
worktree with its recorded starting state. Selected dirty files use their copied
baseline; other tracked paths use Git identity (kind, executable bit and filtered
content), so unrelated permission bits do not become false drift. Scope cannot
widen after preparation. Inspect the observed patch, paths and violations.

## Review and apply

Invoke the pinned `integrate.mjs` through Node with `review`, then `apply`, and one
bounded JSON object on stdin containing `runId`, `runDirectory` and `scopePaths`.
Review records the patch that may be applied; later worktree changes require a
new review. A delegate commit or staged change, Preserve violation, destination
change or out-of-scope edit blocks integration. An unrelated source commit or
staged path does not itself block an unchanged destination.

`apply` verifies the reviewed patch in a private scratch Git repository seeded
with the source state and delegate delta. Root and package-local dependencies are copied there; relative workspace links
resolve within scratch, and escaping dependency links block. Checks and declared generators run with a minimal environment and
private HOME. They execute delegate-written code; this is credential reduction,
not an OS sandbox for trusted scripts. The user's source checkout is written only
after checks pass and destination states are rechecked under an integration lock.
Concurrent unrelated edits are reported, never restored or deleted by rollback.

`discoverDelegateChecks` reads task Test Requirements, declared npm scripts and
repository/CI guidance. Supported commands are `npm run <declared-script> [-- <relative-test-files>...]` and safe
`node --test <paths>` invocations; shell fragments are rejected. An explicit
package-scoped `checks` array can select an appropriate verification set, for
example `[{"cwd":"packages/artifact","command":"npm run test"}]`. Include focused
and relevant regression checks. File selectors may also be supplied as an `args` array after `--`; flags, shell
fragments, absolute paths and traversal are rejected. Other package managers or languages need an
explicit supported npm wrapper, or verification stays incomplete.

Use `preparation` for ordered, declared npm build scripts required by the selected
checks. These execute after the reviewed delta is seeded into scratch and before
checks; they may produce ignored build files but cannot change tracked or
nonignored files. Generation of reviewed source remains a separate `generators`
operation. Preparation stops on its first failure. No dependency installation or
lifecycle script is inferred or run automatically.

For example, build the needed library and test only the selected package:

```json
{
  "preparation": [{"cwd":"packages/library","command":"npm run build"}],
  "checks": [{"cwd":"packages/client","command":"npm run test","args":["--","tests/focused.test.mjs"]}]
}
```

The orchestrator selects actual dependency order from repository manifests and
build guidance. Failed candidate checks rerun against a separate source baseline
with the same preparation; candidate build outputs are never reused there.

Checks have a ten-minute default per command. Supply `timeoutMs` for a measured
longer baseline and follow the helper to its result. Check output and environment
values are omitted. Failed checks block integration; known baseline failures remain
visible and do not become a pass by selecting zero checks.

Each scratch verification attempt saves its own private `verification-<id>.json` under the run.
It records preparation, commands, exit codes, start/finish times, durations and
baseline results, without command output or environment values. `status` exposes
the current phase and latest evidence; earlier attempt files remain available.
A failed verification cannot be bypassed by retrying with `checks: []`. Choose
appropriate checks and retain the failed evidence when narrowing the scope.

A generator must name a declared npm script in a package under `packages/` and
its exact output paths, for example
`[{"packagePath":"packages/artifact","script":"generate","outputPaths":["packages/artifact/lib/artifact/ui/generated/artifact-shell-assets.json"]}]`.
Generated outputs are validated in scratch and included in the reviewed integration
surface. Undeclared tracked/nonignored side effects block; ignored files are not
part of the accepted diff. Scratch execution is not filesystem confinement.

## Interrupted writes

Before writing source, the helper atomically records an applying journal with the
approved paths and before/after states. Writes use same-directory temporaries and
compare-and-swap against those recorded states. Failure rolls back only paths the
helper wrote that still match its own written state. It never overwrites a user's
concurrent save or removes an unrelated new file.

An unresolved journal blocks review, apply and abandonment. The runner's `status`
and `recover` report it. Resolve it explicitly with the pinned integration helper:
`recover` accepts `{ "runId": "...", "resolution": "rollback" }` to restore safe
helper-owned writes, or `resolution: "accept"` only when the complete validated
patch is present. Conflicting paths remain untouched and visible for inspection.

## Finish

Successful integration closes the exact run as integrated and returns its five-field
`report`: **Outcome**, **Task**, **Changed**, **Checks**, **Issues**. These fields
come from observed paths and independent checks; zero checks is explicitly
unverified. `status` recovers the report and later drift. Repeated close with the
same disposition is idempotent. Integrated runs cannot apply or resume again.

The result is an uncommitted local diff. The orchestrator sends source/test
corrections to the exact delegated session before integration; host-authored edits
afterward are separate work. The helper never commits, pushes, opens a PR,
publishes or deploys. Planning status is report-only. Worktree cleanup remains a
separate explicit accepted/abandoned operation.
