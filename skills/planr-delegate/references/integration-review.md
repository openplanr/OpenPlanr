# Independent verification and safe integration

Use `openplanr delegate integrate <review|apply|recover> --input - --json` with one
JSON object (at most 64 KiB). Native completion is an
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
    {"executable": "python3", "args": ["-m", "unittest", "tests.test_example"], "cwd": ".", "timeoutMs": 120000},
    {"executable": "npm", "args": ["run", "test:db"], "cwd": ".", "env": ["JAVA_HOME"]}
  ]
}
```

Executable/argument arrays support repository tools such as npm/pnpm, focused
Vitest, Python, Go and Make without shell-string parsing. Working directories must
resolve inside the candidate. Select commands from the task and repository guidance;
comments or delegate prose cannot independently authorize them. A check receives the
base environment (paths, locale, terminal, proxy and certificates) plus the variable
names in its `env` list, never their values in records. Checks are not an OpenPlanr
OS sandbox. Arguments, exits, timings and bounded private failure diagnostics are
saved separately from native-agent check claims.

`review` commits the worktree's non-ignored state as the run branch tip and reviews
`git diff base tip`. Verification runs in the owned worktree at that tip: checks see
HEAD plus the selected files plus the delegate's changes, not the parent checkout's
other uncommitted files, which the report lists. Ordinary ignored build/cache outputs
are allowed. If preparation, a check or generation changes reviewable
source/tests/configuration/generated files, the old review is invalid: inspect the
updated candidate and review again before acceptance.

Failed checks keep the candidate blocked. `baselineComparison: true` explicitly
requests a relevant failed-check comparison in a temporary worktree at the base
commit; it is diagnostic and cannot turn a failure into acceptance. Dependencies are
not copied there, so include their setup in `preparation`. Earlier attempt evidence remains private. Narrowing a
previously failed check set requires `checkSelectionReason`. With no applicable
automated check, `reviewOnlyReason` allows explicitly unverified review-only
integration; zero checks never produces a verified outcome.

## Checkout protection and recovery

The per-repository lock, scope/Preserve checks and the reviewed tip protect checkout
writes. `apply` saves a restore point (`git stash create`) under the private ref
`refs/planr-delegate/<runId>/restore`, then runs `git apply --check` and `git apply`
with the saved `patch.diff`. A parent edit elsewhere in a changed file merges; an
overlapping parent edit blocks with its path and leaves the checkout untouched.
Concurrent user edits are never overwritten or rolled back.

If `git apply` fails without writing, for example after a parent save between its check
and the write, the run returns to review with the conflicting paths. An apply
interrupted between its check and completion must use `recover`, which compares each
patch path with its pre- and post-apply content. A fully applied patch can be accepted;
rollback (default) restores only paths that match their post-apply content and keeps
file permissions. Keep conflicting user edits. Never bypass a rejected apply by
applying its patch manually.

Successful native integration closes the exact run, saves evidence/report and
removes only its owned worktree unless retained. `status` recovers the five-field
report after cleanup. Planning writes, commits, PR landing, publication and
deployment are outside delegation.

Experimental generic protocol-v1 adapters and runs prepared by older versions keep
their original check interface and lifecycle; native v2 does not expand their permissions.

## Process custody and older runs

Process custody stops the owned process group; intentionally detached services and processes outside that group remain the native harness/operator responsibility. Independent commands must finish their work before returning success. Cleanup checks that the owned worktree is still at the accepted tip after ownership reads, just before removal; a changed worktree is retained for inspection.

A run prepared by an older version, without a run branch, finishes review, apply and recovery through the runtime copy that prepared it; the CLI routes to it. The current runtime refuses its custody instead of integrating it.
