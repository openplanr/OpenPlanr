# OpenPlanr CLI path

Use this path only when `openplanr` is already on `PATH` and the user wants what it adds
over the native loop: a recorded context capsule, worktree custody, recorded checks and
exact-session resume. Never install it, run it through `npx`, or search
`node_modules` for it; without it, use the native loop.

## Probe

Run `openplanr --version`. Use this path only at version 3.7.0 or later.
An older version, `unknown command 'delegate'` or `E_DELEGATE_RUNTIME_MISSING` means the
native loop; tell the user that `npm install -g openplanr@3.7.0` (without
`--omit=optional`) enables this path.

## Commands

Each action is `openplanr delegate <action> --input - --json` with one JSON object on
stdin; `--run <runId>` alone is enough for `dispatch`, `wait`, `status` and `abandon`.

1. `probe` with `repositoryRoot`: engines, saved profiles, readiness and destination.
2. `prepare` with the engine or profile, `request` or `taskSelector`, `selectedFiles`
   and `scopePaths`. Show the context inventory once before `dispatch`, with the model,
   routing and trusted configuration; the worktree is not an OS sandbox.
3. `dispatch`, then `wait` or `status`. A question or block is an attention state:
   `resume` the same run with an `answer` or `correction`.
4. `integrate review` with `scopePaths`, then `integrate apply` with the checks you
   selected as `{ executable, args, cwd, timeoutMs?, env? }`. Apply leaves an
   uncommitted diff.

`E_CAPSULE_SECRET`: show the masked findings. Never edit, redact or drop a required
source to pass. Resolve a finding only after the user confirms that exact value is not
a credential, by preparing again with `credentialResolutions` (`id`, `contentDigest`).

## Results

Read `ok` first; every result has `contract`, `1` for this skill. `ok: true` carries `result` and `next`, the step to take. `ok: false`
(exit code 1) carries `code`, `problem` and `recovery`, plus `runId` and `details` when
they apply.

The CLI starts each child with an explicit environment and passes no credential
variable unless a saved profile lists it in `allowedEnv`.

Details: [operator guide](operator-guide.md), [capsule](capsule-contract.md),
[lifecycle](run-handoff.md), [integration](integration-review.md),
[custody](worktree-custody.md), [adapters](adapter-protocol.md).
