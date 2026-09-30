---
name: planr-delegate
description: Delegate one explicitly requested implementation scope to an enrolled local coding agent while the active agent owns context, questions, review, and integration. Use only when the user asks another agent to implement.
license: MIT
---

# Planr Delegate

Use this opt-in preview when the user explicitly asks another coding agent to
implement one scope. The delegate implements and corrects source; the active
agent owns context, questions, independent verification and integration.
Ordinary implementation stays with `planr-ship`.

## Prepare

Resolve [runner.mjs](scripts/runner.mjs) relative to this installed skill. Invoke
it through Node with one JSON object on stdin; no OpenPlanr checkout or CLI is
required. Run `probe` before collecting task content. It checks Node 20+, Git,
the repository, installed engines and enrolled profiles. Claude Code and Codex
can use their existing signed-in cloud account or an explicitly configured local
provider. Cursor engine execution is not certified by its skill projection.
A terminal-less host returns `E_DELEGATE_HOST_UNSUPPORTED`.

Honor a named profile; otherwise use the sole suitable profile or ask among
several. With none enrolled, follow [the operator guide](references/operator-guide.md)
for `profile-preview` and `profile-enroll`, then continue the original request.
Display the actual destination, model, capabilities and readiness; confirm a new
or changed destination. Enroll trusted executables, not shell aliases. Never
infer local inference from a name, load models automatically or put credential
values in profiles, prompts or logs. [Adapter permissions](references/adapter-protocol.md)
apply independently of worktree custody; a worktree is not an OS sandbox.

Read the exact task or direct request, required planning chain, repository
instructions and relevant code/tests. Follow [the capsule contract](references/capsule-contract.md):
retain every required file, keep optional context focused and treat planning text
as context rather than authorization. Call `prepare` with `profile`,
`repositoryRoot`, `taskSelector` or `request`, `selectedFiles` and explicit
`scopePaths`. `selectedPaths` separately selects dirty files to copy.
The returned preview lists every copied source, optional omission,
logical and physical `.planr` paths, scope, worktree and destination.
Present it before `dispatch`.

Install needed dependencies only inside the detached worktree using its lockfile.
Inspect changed files with `setup-preview`; accept their exact digest with
`setup-accept` before dispatch. Setup is host-authored, excluded from the delegate
patch and frozen during execution. Unacknowledged changes block dispatch.
See [worktree custody](references/worktree-custody.md); do not link source dependencies.

## Execute and correct

Use the preview's pinned runner for every subsequent action. Plugin updates leave
retained runs on their original helper. Call `dispatch`, then follow background
execution with bounded `wait` or `status` until terminal. Follow
[the run handoff](references/run-handoff.md) for process recovery and exact sessions.

Claude's Bash is disabled; the orchestrator runs checks. Send an `answer` or
review `correction` through `resume` to the recorded session. Never resume
“latest”, retry denied tools, switch providers silently or quietly repair delegate
source. If switching to host-native implementation is necessary, label those edits
host-authored. Context preflight and model visibility do not certify execution.

## Review and finish

Treat output as claims. Inspect the actual delta, scope and Preserve paths. Use
the pinned [integration helper](scripts/integrate.mjs): `review`, then `apply`
with the exact run, scope and relevant verification. Declare dependency build
scripts as ordered `preparation` before focused `checks` and `generators`.
Read [the integration contract](references/integration-review.md) for supported
npm/Node commands, scratch execution, side-effect rejection and source recovery.
Never bypass a rejected helper by manually applying its patch.

Render the returned five-field report: **Outcome**, **Task**, **Changed**,
**Checks**, **Issues**, with phase timings. Zero checks means unverified; private
attempt evidence survives failures and interruption. Successful `apply` closes
the exact run as integrated and `status` recovers its report. Report planning
status without modifying `.planr`, then stop. Explicit `cleanup` removes an
accepted or abandoned worktree. No helper commits, pushes, opens PRs, publishes
or deploys; those need separate authorization.
