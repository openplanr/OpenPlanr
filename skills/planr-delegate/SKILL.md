---
name: planr-delegate
description: Coordinate an explicitly requested implementation with Claude Code, Codex or Cursor, then independently review and integrate its observed changes. Use when the user asks another coding agent to implement.
license: MIT
---

# OpenPlanr Delegate

Delegate one coherent repository scope through the user's installed native CLI.
The delegate owns investigation, implementation, build/test and correction. The
parent owns scope, complete context, independent review, acceptance and integration.
Ordinary implementation remains with `planr-ship`.

## Start

Probe the CLI as [openplanr-cli](references/openplanr-cli.md) says; at a stop, stop.
Every action is `openplanr delegate <action> --input - --json` with one JSON object on
stdin (`--run <runId>` alone is enough for `dispatch`, `wait`, `status` and `abandon`).
Review is `openplanr delegate integrate <review|apply|recover>`.

Run `probe` with `repositoryRoot`. Selection precedence: explicit engine/profile,
saved choice, then a sole compatible native choice; otherwise ask, engine first if the
chooser is short. Show each choice's engine, profile/model, readiness and effective
destination; keep saved local-model profiles visible. A name does not prove local
routing: for an explicit local request, confirm effective routing before dispatch and
never substitute cloud execution. Conflicting routes block preparation. See the
[operator guide](references/operator-guide.md) for inputs, profiles and environment,
and the [adapter contract](references/adapter-protocol.md) for native CLI compatibility.

Read the task, binding repository instructions and relevant source/tests. Build the
[complete capsule](references/capsule-contract.md), including required
ignored planning files. Never silently omit, truncate or summarize a required source;
for a large local task, narrow the sources or split the task.

`E_CAPSULE_SECRET`: show the masked findings. Never edit, redact or drop a required
source to pass. Resolve a finding only after the user confirms that exact value is not a
credential, by preparing again with `credentialResolutions` (`id`, `contentDigest`).

Call `prepare` with engine/profile, context and explicit `scopePaths`. Show the
engine, model selection, routing, trusted configuration, working directory and
context inventory once before `dispatch`. Trusted hooks, plugins and MCP may run code;
the worktree is not an OS sandbox. Use `prepare-worktree` for dependencies.

## Run and review

`dispatch`, bounded `wait` and `status` report the exact session and progress. No
bypass, force or yolo flags, tool exclusions or model fallbacks. A permission denial is
an attention state: resolve it in the native CLI, then `resume` the recorded session
with an answer or correction. Never use the latest session. Send review findings to the
delegate; do not implement its changes yourself. See [lifecycle](references/run-handoff.md).

When execution stops, `integrate review` the run branch's patch against the scope.
Select independent checks from the task and repository as
`{ executable, args, cwd, timeoutMs?, env? }`, and `integrate apply` only the reviewed
candidate. Failed checks stay blocked; changes made by checks need another review. See
[verification and integration](references/integration-review.md) and
[worktree custody](references/worktree-custody.md).

`apply` leaves an uncommitted diff and saves the report. Commit, landing, publication
and deployment are separate decisions. `abandon` only a run that never executed.

## Return

Lead with the outcome: integrated, blocked with its attention state, or stopped at a
named CLI stop. Then the five-field report: changed files, independent checks, the
native agent's own claims labelled as claims, issues, and the report location. End with
`next` from the last result, or the stop's command.
