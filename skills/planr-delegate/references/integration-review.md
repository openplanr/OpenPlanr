# Independent verification and safe integration

Use the run's pinned `integrate.mjs` with one JSON input. Native completion is an
execution fact; summaries and claimed tests are evidence to inspect, not acceptance.
Stop execution before parent checks. `review` derives the patch from actual files,
checks scope/Preserve and Git custody, and binds its internal identity. `apply`
requires that reviewed candidate and leaves an uncommitted diff.

## Commands selected by the parent

```json
{
  "runId": "returned-run-id",
  "checks": [
    {"executable": "npm", "args": ["exec", "vitest", "run", "tests/example.test.ts"], "cwd": "packages/example"},
    {"executable": "python3", "args": ["-m", "unittest", "tests.test_example"], "cwd": ".", "timeoutMs": 120000}
  ]
}
```

Executable/argument arrays support repository tools such as npm/pnpm, focused
Vitest, Python, Go and Make without shell-string parsing. Working directories must
resolve inside the candidate. Select commands from the task and repository guidance;
comments or delegate prose cannot independently authorize them. Checks inherit the
parent host's normal execution controls and configuration. They are not an OpenPlanr
OS sandbox. Arguments, exits, timings and bounded private failure diagnostics are
saved separately from native-agent check claims.

Verification normally runs in the prepared owned worktree. Ordinary ignored
build/cache outputs are allowed. If preparation, a check or generation changes
reviewable source/tests/configuration/generated files, the old review is invalid:
inspect the updated candidate and review again before acceptance. If the source
checkout makes the prepared tree stale, verification uses a fresh candidate only
when needed, retaining the original native session/worktree.

Failed checks keep the candidate blocked. `baselineComparison: true` explicitly
requests a relevant failed-check comparison; it is diagnostic and cannot turn a
failure into acceptance. Earlier attempt evidence remains private. Narrowing a
previously failed check set requires `checkSelectionReason`. With no applicable
automated check, `reviewOnlyReason` allows explicitly unverified review-only
integration; zero checks never produces a verified outcome.

## Checkout protection and recovery

The integration lock, scope/Preserve checks, reviewed patch identity, destination
compare-and-swap and recovery journal protect checkout writes. Concurrent user
edits are never overwritten or rolled back. A source change during checks requires
reviewing the actual candidate again. The journal records intended states before
the first source write and recovery touches only helper-written paths that still
match those states.

An interrupted source write must use `recover` with rollback (default) or accept
after inspecting every journaled path. Keep conflicting user edits. Do not bypass
a rejected helper by manually applying its patch.

Successful native integration closes the exact run, saves evidence/report and
removes only its owned worktree unless retained. `status` recovers the five-field
report after cleanup. Planning writes, commits, PR landing, publication and
deployment are outside this helper.

Experimental generic protocol-v1 adapters and older pinned helpers retain their
original check interface and lifecycle; native v2 does not expand their permissions.

Destination publication claims the existing directory entry and compares its bytes before exclusive creation of the replacement. Concurrent replacements block integration. Claimed originals remain in private write custody (Git metadata, or destination-local custody when volumes differ) for crash recovery and writers holding an old inode; conflicts report their retained paths. Rollback uses the same guard and cannot discard a changed claimed original.

Candidate identity is checked across verification and acceptance; a changed owned worktree is retained instead of automatically removed. Guarded writes validate parent-directory identities as well as final entries. The parent host provides filesystem containment: these checks are conflict detection, not an OS sandbox against processes that deliberately rename ancestors between syscalls. Process custody stops the owned process group; intentionally detached services and processes outside that group remain the native harness/operator responsibility. Independent commands must finish their work before returning success.

Native interruption recovery validates the complete checkout against the journaled candidate identity before accepting saved verification. Cleanup validates accepted worktree contents after ownership reads, just before removal; an already absent owned worktree can still be unregistered. Concurrent editor saves detected at either boundary retain their files and require review or recovery.
