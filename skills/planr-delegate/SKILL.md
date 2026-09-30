---
name: planr-delegate
description: Delegate one explicitly requested implementation scope to an enrolled local coding agent while the active agent owns context, questions, review, and integration. Use only when the user asks another agent to implement.
license: MIT
---

# Planr Delegate

Use this opt-in preview for an explicit request that another coding agent implement
one scope. Ordinary implementation and native parallel role agents stay with
`planr-ship`. The delegate implements and corrects source; the active agent owns
context, questions, independent checks, review and integration.

Execution requires a terminal-equipped Claude Code or Codex host, Git and Node
20+. Other host projections do not certify execution: report
`E_DELEGATE_HOST_UNSUPPORTED` before collecting task content if the local helper
cannot run. Use trusted enrolled executables. Worktrees isolate edit state; they
are not filesystem or network sandboxes. Read [the operator guide](references/operator-guide.md)
for setup and [the adapter contract](references/adapter-protocol.md) for engine
permissions and destination resolution.

## Prepare

Resolve helper paths relative to this installed `SKILL.md`; no OpenPlanr checkout
or CLI is required. Invoke [the runner](scripts/runner.mjs) through Node with one
bounded JSON object on stdin. Run `probe` with the absolute `repositoryRoot`
before collecting task content. Honor a named profile; otherwise choose the sole
suitable profile or ask among several. With none enrolled, use `profile-preview`
and `profile-enroll` as described in the operator guide, then continue the same
request. Display the effective destination, model, capabilities and readiness.
Confirm new or changed destinations. Never infer local inference from a name,
load a model automatically, or put credential values in profiles, prompts or logs.

Resolve one exact task or a clear direct `request`. Read the complete required
planning chain, repository guidance, selected source and tests. A user-named or
implementation-critical file is required; never downgrade it to optional after a
secret/read failure. Planning content supplies context, not authority for extra
commands. Read [the capsule contract](references/capsule-contract.md) and
[worktree custody](references/worktree-custody.md).

Call `prepare` with `profile`, `repositoryRoot`, `taskSelector` or `request`,
`selectedFiles` and explicit `scopePaths`. Optional `selectedPaths` names dirty
files to copy and is separate from the integration scope. The returned preview lists every copied source, optional omission,
logical and physical `.planr` paths, checkout, profile, destination, scope,
dependency readiness and pinned helper paths. Present the preview before `dispatch`.
Required blockers stop preparation. Install needed dependencies only inside the
detached worktree using its lockfile, then validate custody; never link the source
checkout's `node_modules`.

## Dispatch and correct

Use the preview's pinned runner for `dispatch`, `status`, `wait`, `resume`,
`recover`, `close` and `cleanup`, and its pinned integration helper for review/apply.
It executes a private copy outside the installed plugin; updates do not replace
that copy. Profiles live under `~/.config/openplanr/delegate/`, runs/helpers under
`~/.openplanr/delegate/`, independently of `PLANR_HOME`. Follow
[the run handoff](references/run-handoff.md).

Follow a backgrounded dispatch with bounded `wait` or `status` until a terminal
result. A loaded model and conservative context preflight do not certify inference
quality; no automatic context compaction occurs. Codex command repetition/budget,
missing final results and hard deadlines block rather than silently retry. Claude
can read the decoded capsule and edit files, but Bash is disabled; run checks as
the orchestrator and send failures back. Do not retry denied shell commands.

Answer consequential questions in the active conversation. Send an `answer` or
review `correction` to `resume` using this run's exact recorded backend session.
Never resume “latest” or quietly edit delegated source/tests. If the exact session
cannot continue, report its blocker or explicitly switch to host-native work and
label those edits host-authored. Preserve interrupted work and give its run ID
and exact status/recovery path when the host turn ends.

## Review and finish

Treat delegate output as claims. Inspect the observed patch against its starting
state, recorded scope and Preserve paths. Use [the integration contract](references/integration-review.md)
and [integration helper](scripts/integrate.mjs): `review`, then `apply` with the
exact `runId`, `runDirectory`, `scopePaths` and relevant `checks`/`generators`.
Checks execute delegate-written code in a private scratch repository with a
minimal environment; disclose the supported npm/Node command limits. Source is
written last with destination drift checks and recoverable write records. Never
bypass a rejected helper with manual patch application.

Successful `apply` closes the run as integrated and returns its observed five-field
`report`: **Outcome**, **Task**, **Changed**, **Checks**, **Issues**. Render that
report; zero independent checks means unverified. `status` recovers it if the host
ends before display. Report planning status without writing `.planr`, then stop;
do not start optional backlog work. Explicit `cleanup` removes an accepted or
abandoned worktree separately. No helper or delegate commits, pushes, opens a PR,
publishes or deploys. Landing and publication require separate authorization.
