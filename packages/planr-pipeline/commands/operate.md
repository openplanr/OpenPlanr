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
5. Dispatch the five independent `operating-<role>` agents with their v1.4
   mandates and `procedures/operate/advisor.md`, preferably in parallel. Record
   their exact results serially through `planr operate harness record`; retries
   must replay identical bytes for the same role and idempotency key.
6. Dispatch Chair with `procedures/operate/chair.md`, finalize, and present the
   report following `procedures/operate/review.md`.

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

Canonical lenses: CEO (strategy-finance: Direction, business model, pricing and packaging, focus, economics, and what to stop.); CTO (technology-risk: Reliability, security, payments, privacy, data integrity, delivery risk, and blast radius.); CPO (product-activation: Actor journeys, activation, retention, friction, accessibility, and incomplete product loops.); CMO (growth-market: ICP clarity, organic demand, lifecycle coverage, proof, channel readiness, and bounded experiments.); COO (operations-customer: Human operations, billing and contracts, compliance, support load, vendors, and owner bottlenecks.); Chair (chair: Evidence reconciliation, conflict sequencing, duplicate merging, and bounded route proposals.).
