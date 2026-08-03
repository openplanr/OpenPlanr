# ADR-011: Agent-native, runtime-bound Operating Board

- Status: Accepted
- Date: 2026-08-02
- Protocol: 1.4.0
- Supersedes: the CLI-reasoning and enforced-isolation eligibility clauses of
  ADR-008, ADR-009, and ADR-010

## Context

The v1.2/v1.3 Operating Board placed too much product reasoning inside the CLI.
It serialized repository evidence, drove a long deterministic questionnaire,
and treated native runtimes whose tool isolation was advisory as unsupported.
That produced a CLI experience inside chat, imposed artificial evidence-size
limits, and caused Codex cycles to fall back to Claude despite PLAN and SHIP
already working natively across runtimes.

## Decision

Operate adopts the established PLAN/SHIP split:

1. `planr-pipeline` supplies canonical procedures, role mandates, schemas, and
   generated runtime assets.
2. The selected runtime's native agents inspect the project, investigate,
   reason, and author expressive reports plus typed, cited actions.
3. OpenPlanr is the deterministic governance kernel. It owns runtime binding,
   locks, state transitions, citation validation, provenance, checkpoints,
   reversible draft materialization, and authority enforcement.

Runtime session permissions govern tools. Planr grants no additional
permissions. `toolIsolation` remains honest diagnostic metadata, but advisory
isolation does not make Codex or Cursor unsupported. Persistence is controlled
by output validation and unexpected-mutation checks.

A cycle binds to one runtime with `runtimeBinding: required` and
`crossRuntimeFallback: false`. Native subagents are preferred; sequential work
in the same runtime is the fallback. Cross-vendor fallback is forbidden.

Initialization is research-first. Agents may infer business model, ICP, stage,
goals, and metrics when claims are cited and labeled with epistemic status.
Only genuine authority decisions require a compact owner review. Unknowns lower
confidence or create gaps; they do not prevent a cycle.

Qualified recommendations may materialize reversible canonical proposal drafts.
They remain unapproved and cannot enter PLAN or SHIP until a separate human
action approves them.

## Consequences

- Codex, Claude Code, and Cursor are equally supported runtime targets.
- No repository evidence body or repository-size input ceiling exists in the
  native workflow.
- Narrative analysis is flexible; material claims and actions are deterministic
  only after citations resolve.
- The `harness` lifecycle replaces user-visible `adapter` terminology. Adapter
  aliases remain for two minor releases.
- Existing Protocol v1.2/v1.3 artifacts stay readable but new cycles use v1.4.
- Operate still never accepts work, invokes PLAN/SHIP, deploys, publishes,
  spends, contacts customers, changes credentials, or performs destructive
  actions without separately named authority.
