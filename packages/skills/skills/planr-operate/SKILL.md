---
name: planr-operate
description: Run one complete agent-native OpenPlanr operating cycle in Codex, from project research through CEO/CTO/CPO/CMO/COO/Chair synthesis and provisional drafts, stopping at review.
license: MIT
---

# Planr Operate — Codex-native workflow

This skill is the primary workflow. The user does not write an orchestration
prompt or run machine lifecycle commands. Use only public `planr operate`
commands for user actions and the CLI-returned `harness` actions internally.

## Default invocation

A bare `$planr-operate` means:

1. Inspect with `planr operate inspect --json`.
2. Select Codex through normal runtime precedence and keep that binding for the
   entire cycle. Never invoke another vendor runtime or its commands, assets, or models.
3. If context is absent or stale, run the returned bootstrap harness. Follow
   [bootstrap](references/bootstrap.md): inspect the workspace first, produce
   cited context claims, then present one compact context review only when owner
   confirmation is genuinely needed. Use Codex's native question tool when it is
   available; otherwise ask naturally in chat. Never dump a questionnaire.
4. Preview, then start exactly one local cycle. The bare skill invocation is
   authority for reversible local cycle continuation through `reviewable`,
   `blocked`, or `failed`; it is not authority for connected research, draft
   approval, route application, PLAN, SHIP, or external effects.
5. Execute current `handoff.next[].argv` actions only. For each `harness.record`,
   dispatch the named Codex role with its mandate and [advisor
   procedure](references/advisor.md). Use native Codex subagents when exposed;
   otherwise run the same role sequentially in this Codex session. Parallelize
   independent advisors when safe, and record each result the instant that role
   returns — one role at a time against the shared session, but never waiting on
   a sibling first. The handoff exposes a record action for every pending role,
   so a slow lens cannot strand a finished one. If a role is still running as the
   lease window approaches, issue `harness heartbeat` to renew the session rather
   than let it expire. If a dispatched lens genuinely never returns — it exceeded
   its budget even after a heartbeat, or crashed — record it terminal with
   `harness abandon --role <role> --reason "<why>"`. That lens becomes
   `not_evaluated` with your reason, its recorded siblings are untouched, and the
   Chair names it as an explicit gap it must not synthesize around. Never fabricate
   a result for a lens that did not return.
6. Run CEO, CTO, CPO, CMO, COO, then [Chair](references/chair.md). Each role
   explores the project with Codex tools and current session permissions. Planr
   grants no extra permissions and supplies no repository JSON evidence body.
7. Submit exactly one `operating-advisor-response@1.4` response per role:
   flexible `analysisMarkdown` plus
   citation-bearing `claims`, `actions`, `gaps`, and `conflicts`. Uncited opinion
   may remain narrative but cannot materialize work.
8. Finalize and follow [review](references/review.md). Use `planr operate report`
   when the handoff requests it, then present the Markdown report and provisional
   draft paths in chat. The dashboard is optional.
9. Stop at review. Ask separately before approving/discarding drafts,
   accepting/rejecting findings, applying/rolling back routes, invoking PLAN,
   invoking SHIP, connected research, or any external effect.

If the user names a public subcommand (`status`, `report`, `context show`,
`drafts list`, and so on), perform only that command.

## Research and runtime rules

- Local repository, Planr, and Git research is automatic and read-oriented.
- Connected/web research requires the CLI's per-cycle preview and explicit
  consent. Never infer consent from the bare invocation.
- Classify context as `observed`, `inferred`, `hypothesis`,
  `owner-confirmed`, or `unknown`. Business model, ICP, stage, goals, and metrics
  may be inferred with citations and confidence; never present inference as
  confirmed fact.
- If the user says “find it from the project,” continue investigating. Unknown
  context lowers confidence or opens a gap; it does not block the cycle.
- The binding must remain `runtime: codex`, `runtimeBinding: required`,
  `crossRuntimeFallback: false`, `assurance: runtime-governed`. Codex advisory
  isolation is supported; the runtime sandbox and user-approved access govern.
- A mismatch is `E_OPERATE_RUNTIME_MISMATCH`. Do not work around it; start a new
  cycle or use the explicit migration action returned by Planr.

## Machine lifecycle

The public skill hides `planr operate harness prepare|record|finalize|resume|cancel|heartbeat|abandon`.
Execute only argv arrays in the current handoff, preserve cycle/runtime/digest/
lease/idempotency fields byte-for-byte, submit the complete JSON response over
stdin, and replay identical bytes after transport failure. `harness abandon --role
<role> --reason "<why>"` is the one action taken for a lens that never returns: it
governs that lens terminal `not_evaluated` with a recorded reason so finalize and
the Chair can proceed without it. If this Codex session itself stops before it can
abandon a stalled lens, the operator's escape is `planr operate cycles abandon-role
<cycleId> --reason "<why>" --yes`, valid once the session lease has lapsed — it
reaches a reviewable cycle without discarding the recorded work. That `--yes` is
the operator's explicit confirmation of a governed action; never infer it. The
older `adapter` aliases are compatibility-only and must not appear in new guidance.

Qualified recommendations may create reversible canonical proposal drafts
automatically. Do not edit them directly. Use `planr operate drafts
list|show|approve|discard`; an unapproved draft must remain blocked by
`E_OPERATE_DRAFT_UNAPPROVED` and cannot enter PLAN or SHIP.

Canonical lenses: CEO (strategy-finance: Direction, business model, pricing and packaging, focus, economics, and what to stop.); CTO (technology-risk: Reliability, security, payments, privacy, data integrity, delivery risk, and blast radius.); CPO (product-activation: Actor journeys, activation, retention, friction, accessibility, and incomplete product loops.); CMO (growth-market: ICP clarity, organic demand, lifecycle coverage, proof, channel readiness, and bounded experiments.); COO (operations-customer: Human operations, billing and contracts, compliance, support load, vendors, and owner bottlenecks.); Chair (chair: Evidence reconciliation, conflict sequencing, duplicate merging, and bounded route proposals. Name any absent or not-evaluated lens as an explicit gap and never synthesize a missing lens's conclusions; consolidate only the recorded, verified board.).

Never call `planr-pipeline` directly. Never invoke another vendor runtime.
Never deploy, publish, spend, contact customers, change credentials, destroy
data, accept work, apply routes, invoke PLAN, or invoke SHIP without separate,
named user authorization.
