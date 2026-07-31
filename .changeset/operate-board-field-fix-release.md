---
"openplanr": minor
---

Field-fix release for the `planr operate` Operating Board (SPEC-002), hardening the
Protocol v1.3 agentic engine against issues found once real field incidents drove the
board. Native mission dispatch is now wired end to end: a bound role prepares a mission
packet (not a v1.2 pack) and hands back a v1.3 mission record action on a claude-code
runtime, threading v1.3 citation-bearing responses through the recorded-proposal gate,
while codex/cursor fail closed to the pack path — proven by
`tests/unit/operate-adapter-mission-dispatch.test.ts` ("native mission dispatch reaches
the record action"). Advisor pack budgets now fail closed at field-incident scale:
`createOperatingAdvisorPack` throws before returning a field-scale pack, and both the
dispatch and adapter-lifecycle prepare call sites refuse with no provider invocation and
persist no session, with checkpoints holding at 10,000 events. The human review renderer
presents the write-free `review` stage — question, evidence, options, and blockers —
before any initialization is applied. Guided continuations return `ok: true` and hand the
runner a directly executable `confirmArgv` on a digest-confirmable action. Adapter sessions
bind to board identity so a re-inited board never collides with a prior generation, and
`doctor` gains two staleness diagnostics (FR11): a stale adapter session bound to a
superseded board generation and a stale incremental baseline whose `workspaceDigest`
drifted, each with a scoped fix. Provider bootstrap failures surface as typed
`E_OPERATE_ADVISOR_FAILED` errors with a remedy, the readiness preflight names a missing
provider key before a cycle starts, and runtime detection resolves the real host from env
markers instead of stamping `unknown`/`none`. The init questionnaire is on a diet with
preselection (only unanswered canonical questions are returned; the decision owner is
suggested from the git user) and accepts `--answers-file` as a bounded stdin-parity alias
under the same 64 KiB cap. Adapter leases surface their expiry and remaining time in prepare
output and the handoff (default 15 minutes), refresh on each successful record, and honor a
machine-local configured lease duration. Pins the optional `planr-pipeline` runtime to
`0.34.0`, the build that ships the regenerated v1.3 templates this release proves against.
