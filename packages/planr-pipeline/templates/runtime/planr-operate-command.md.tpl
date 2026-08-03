---
description: Run one complete Claude Code-native OpenPlanr operating cycle and stop at its review gate.
argument-hint: "[status|report|context|drafts|<focus>]"
allowed-tools: Read, Glob, Grep, Bash(planr:*), Bash(git log:*), Bash(git show:*), Bash(git diff:*), Bash(git blame:*), Task, AskUserQuestion
---

# OpenPlanr Operate — Claude Code-native workflow

Run the full workflow for the user. They do not write an orchestration prompt or
run lifecycle commands.
A bare command invocation means run one complete cycle through the review gate.

1. Run `planr operate inspect --json`.
2. Bind the cycle to `claude-code`; never invoke Codex or Cursor.
3. When context is absent or stale, execute the returned bootstrap harness and
   follow `procedures/operate/bootstrap.md`. Research the workspace before asking
   questions. Use AskUserQuestion for one compact review of genuine authority
   decisions. Never dump a questionnaire.
4. Preview and start one cycle, then follow only current
   `handoff.next[].argv`. The slash command authorizes reversible local
   continuation through `reviewable`, `blocked`, or `failed` only.
5. Dispatch the independent `operating-<role>` agents with their v1.4 mandates
   and `procedures/operate/advisor.md`, preferably in parallel. Record each
   advisor's exact result the instant it returns through `planr operate harness
   record` — one role at a time against the shared session, but never waiting on
   a sibling to return first; the handoff authorizes a record action for every
   pending role, so a stalled lens can never strand a completed one. Retries must
   replay identical bytes for the same role and idempotency key. If any role is
   still running as the lease window approaches, issue `planr operate harness
   heartbeat` to renew the session before it expires. If a dispatched lens
   genuinely never returns — it exceeded its budget even after a heartbeat, or
   crashed — record it terminal with `planr operate harness abandon --role <role>
   --reason "<why>"` so the board can consolidate without it. That lens is marked
   `not_evaluated` with your reason, its recorded siblings are untouched, and the
   Chair names it as an explicit gap it must not synthesize around. Never fabricate
   a result for a lens that did not return; abandon it honestly instead.
6. Dispatch Chair with `procedures/operate/chair.md`, finalize, and present the
   report following `procedures/operate/review.md`. If the runtime itself stops
   before abandoning a stalled lens, an operator can reach a reviewable cycle
   without discarding it: once the session lease has lapsed, `planr operate cycles
   abandon-role <cycleId> --reason "<why>" --yes` marks the still-unrecorded
   lenses `not_evaluated` and unblocks consolidation of the rest of the board.
   That `--yes` is the operator's explicit confirmation of a governed action;
   never infer it.

Agents inspect the project directly using current Claude Code session
permissions. Planr grants no permissions and sends no repository JSON body.
Return rich `analysisMarkdown` plus citation-bearing `claims`, `actions`, `gaps`,
and `conflicts`. Uncited opinion cannot create work.

Local research is automatic. Connected research requires a per-cycle preview
and explicit consent. Classify context as observed, inferred, hypothesis,
owner-confirmed, or unknown. If the user says “find it from the project,” keep
researching; unknown context is a confidence/gap concern, not a blocker.

The binding remains `runtime: claude-code`, `runtimeBinding: required`, and
`crossRuntimeFallback: false`. Preserve all handoff binding values exactly.
Legacy `adapter` commands are compatibility-only; new flows use `harness`.

Qualified actions may create reversible proposed Quick Tasks, Specs, Epics,
decisions, or agent artifacts. List them at review, but never approve or execute
them. Stop before finding acceptance, route application, draft approval, PLAN,
SHIP, deployment, publication, spending, customer contact, credential changes,
or destructive work.

When the user requests a public read-only subcommand, perform only it. The
dashboard is optional and never the sole report.

Completion is an explicit phase discipline, not a judgement call. A cycle
advances A (inspect/bootstrap) → B (cycle start and runtime binding) → C
(dispatch and incremental recording) → D (Chair consolidation) → E (report and
drafts materialization) → F (review gate and stop). It is done only when the
on-disk artifacts of each phase exist: the expected role records and their
Markdown, the Chair result, the final report, the actions file, the draft and
provenance results, a cycle state of `reviewable`, `blocked`, or `failed`, no
leftover scratch, a correct runtime binding, and no unauthorized effect. A cycle
that merely started, prepared, launched advisors, or left temporary result files
is not complete. `planr operate review` — the CLI, not this workflow — is
authoritative on whether a cycle has reached the review gate: when it reports an
earlier phase and the artifacts still missing, that is the truth of where the
cycle stands, and the cycle is not yet reviewable.

Canonical lenses: {{OPERATING_LENSES}}.
