# Procedure: normalize SHIP arguments and preview the reviewed scope

Thin companion to `commands/ship.md`. The filename is retained for installed
adapter compatibility; this procedure no longer creates a second cost or approval
gate. The user's separate SHIP invocation is the R1 authorization boundary.

## Phase A — parse arguments

Treat `$ARGUMENTS` as the raw tokens after the command name.

- Consume one required kebab-case feature slug and bind it as `${SLUG}`.
- Accept optional `--task T-NNN`; bind `${SHIP_TASK_ID}` only when it matches
  `^T-\d{3}$`.
- Reject missing values, duplicate slugs, and every unknown flag using
  `procedures/fatal-error-format.md`.

Do not ask for another approval, cost confirmation, dispatch style, reviewer, or
gate selection. Do not infer authority to PLAN, publish, deploy, reopen, or release.

## Phase B — validate and preview

After mode detection, read the exact output from:

```bash
planr pipeline prepare-ship "${SLUG}" --json
```

When `${SHIP_TASK_ID}` is set, use the bounded form instead:

```bash
planr pipeline prepare-ship "${SLUG}" --task "${SHIP_TASK_ID}" --json
```

Pass the same exact selector to `start-ship`; the runtime, not the prompt, binds
the approved task scope.

Require a schema-valid preview with unresolved task identities, initial-ready IDs,
dependency edges, relevant parent references, structured Preserve boundaries, and
active/terminal closure summary. A terminal summary with
`projectionVerified: false` authorizes only one exact `finalize-ship` replay to
repair receipt-derived projections; it never authorizes a new SHIP run.

When `${SHIP_TASK_ID}` is set, require that ID in the unresolved task graph and
restrict the implementation batch to that task. The selector intentionally performs
one bounded task lifecycle; it never authorizes later work or another invocation.

Print one compact, non-interactive scope summary. Do not calculate model prices,
token spend, or wall-clock promises in this protocol procedure.
