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

Resolve [runner.mjs](scripts/runner.mjs) from this installed skill. Call it through
Node as `node <installed-skill>/scripts/runner.mjs <action>`, with one JSON object
on stdin. Alternatively, include `action` in that object and omit the command-line
action; conflicting actions are rejected. `probe` discovers Node 20+, Git, installed
CLIs and optional profiles; an OpenPlanr checkout or public CLI command is not
needed. Reuse normal signed-in authentication. Preserve selection precedence:
explicit engine/profile, saved choice, then a sole compatible native choice; ask
when the remaining engine or profile choice is ambiguous. Without an explicit or
saved selection, show the available native defaults and saved profiles returned
by `probe` for this repository. Include the engine, profile/model, readiness and
verified local/cloud destination or native-managed routing. If the host's chooser
cannot show all choices, ask for the engine first and its profile next; never drop
saved local-model choices. Distinguish recorded configuration from effective probe
results, and show unavailable profiles with their recovery action. A name does not
prove local routing. For an explicit local request, confirm effective routing
before dispatch; never silently substitute cloud execution.
Conflicting routes and a declared destination that differs from the effective
selection block preparation and dispatch; inspect the named configuration sources.
Native runs need no enrollment or renewal. See [onboarding](references/operator-guide.md)
for private helper inputs and optional model/configuration profiles. Read the
[adapter contract](references/adapter-protocol.md) when diagnosing native CLI compatibility.

Read the requested task, binding repository instructions and relevant source/tests.
Build the [complete capsule](references/capsule-contract.md), including required
ignored planning files. Use a short brief and ordered index, retaining every
required file without repeating its full contents in the prompt. Native repository
exploration is allowed under the selected harness's permissions.
Review decoded context bytes, required/optional counts and the largest sources.
Capacity and duration remain unverified without matching measurements. For a large
local task, select only relevant sources or split the task before a new preparation;
never silently omit, truncate or replace a required source with a summary.

If `prepare` reports `E_CAPSULE_SECRET`, show its masked findings (path, line, rule,
confidence); never edit, redact or drop a required source to pass the check. For a
resolvable finding, ask whether that exact value is a credential. Only when the user
confirms it is not, prepare again with `credentialResolutions` naming that finding's
`id` and `contentDigest`. Recognizable credential formats, private keys and credential
files are never resolvable: ask the user to remove the credential from the source.

Call `prepare` with the engine/profile, context and explicit integration scope.
Show its engine, model selection, known provider or native-managed routing,
trusted configuration, working directory and context inventory once before
`dispatch`. Trusted hooks, plugins and MCP may execute code or contact additional
services. Integration scope limits accepted changes; a worktree is not an OS sandbox.

Prepare dependencies/build prerequisites once in the owned worktree, using
`prepare-worktree` and parent-selected structured commands when needed. Preparation
is attributed internally; tracked changes join the scoped candidate. There is no
digest-acceptance step or permanently frozen setup baseline. See
[worktree custody](references/worktree-custody.md) for preparation attribution and cleanup.

## Run and review

Use the returned pinned helper for subsequent actions. `dispatch`, bounded `wait`
and `status` expose the exact session, native progress, inactivity and phase timings.
Native tools, permissions, configuration and implementation loops remain native.
Do not add bypass/force/yolo flags, blanket tool exclusions or silent model fallbacks.
Local backend probes are compatibility diagnostics, not a separate execution policy.
They read model metadata without submitting inference, loading models or sending
task content. Known model failures and HTTP status are shown with safe native
diagnostics; resolve routing before treating an authentication error as a login problem.

Surface permission requests/denials as attention states. Resolve them through the
native harness, then `resume` the recorded session with the answer or correction.
Never substitute the latest session. Send actual review findings to the delegate;
do not quietly implement its source changes yourself. Native summaries may be plain
text; formatting never requires a corrective turn. See [lifecycle](references/run-handoff.md).

Once execution stops, inspect the observed patch through the pinned
[integration helper](scripts/integrate.mjs). Select independent commands from the
task/repository, using `{ executable, args, cwd, timeoutMs? }`. Review, verify and
accept the actual candidate under the parent host's execution controls. Source
changes caused by preparation or checks require another review. Failed checks
remain blocked; baseline comparison is an explicit diagnostic action. See
[verification and integration](references/integration-review.md).

`apply` leaves an uncommitted local diff and saves the five-field report and evidence.
Successful native integration removes only the owned worktree unless retention was
requested. Failed/interrupted worktrees remain available. `status` recovers the
report after cleanup. Planning updates are report-only. Commit, landing, publication
and deployment remain separately authorized actions.
Use explicit `abandon` only for a run that never executed. The helper checks that
its owned worktree still matches initial custody and retains modified, unknown,
active or session-bearing work. Old runs continue using their pinned helper;
upgrading the installed skill never rewrites their execution code or records.

## Return

Lead with the observed integration outcome, or the partial result and attention
state. Render the saved five-field report concisely: link material changes and
the recoverable report, summarize independent checks, and label native-agent
claims separately. Name any blocker, impact and exact-session recovery action.
Keep full inventories, private diagnostics and native transcripts in their existing
records. Preserve the report fields; plain text or different summary wording
never requires a corrective delegate turn.
