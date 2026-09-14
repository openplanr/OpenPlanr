# Agentic Executive Board

> Status: constitution-locked by
> [EXECUTIVE_BOARD_SKILL_SPLIT_DECISION.md](../../.planr/products/operate-2.0/phases/EXECUTIVE_BOARD_SKILL_SPLIT_DECISION.md)
> Source-checkout status: the candidate seven-seat contracts, generated role
> executors, owner display projection, and React Cycle-detail seats are present
> across planr-pipeline and OpenPlanr. SPEC-022 and SPEC-020 are locally complete
> and independently reviewed, but remain unpublished; this work has not shipped
> in a release.

This document preserves the business operating mechanism behind the historical
CEO/CTO/CPO/CMO/COO workflow while keeping the Operate kernel domain-neutral.
It is a release requirement and a map of the current candidate implementation,
not release certification. Contract, task, QA, packed-package, and browser
evidence remain authoritative for the exact bytes under review.

The Operate kernel schedules typed Assignments. The business domain owns the
human-facing executive identities and their mandates. A runtime adapter may
dispatch those Assignments, but it must not invent, merge, or silently omit the
executive lenses.

## Default business board

The default full business cycle has five independent executive advisors, one
independent challenge control, and one Chair synthesis:

| Stable role ID | Product label | Kernel role kind | Mandate |
|---|---|---|---|
| `strategy-finance` | CEO | `advisor` | Strategy, company direction, capital allocation, and financial viability |
| `technology-risk` | CTO | `advisor` | Technology leverage, architecture, security, delivery risk, and technical constraints |
| `product-activation` | CPO | `advisor` | Product value, customer activation, retention, discovery, product trade-offs, backlog value ordering, and acceptance-criteria quality |
| `growth-market` | CMO | `advisor` | Market, positioning, acquisition, growth loops, and demand evidence |
| `operations-customer` | COO | `advisor` | Operations, service delivery, customer health, capacity, and execution readiness |
| `independent-challenge` | Challenger | `challenger` | Tests the accepted executive artifacts for unsupported claims, conflict, and missing evidence |
| `chair` | Chair | `chair` | Makes the final evidence-bound synthesis and proposes governed Decisions and Actions |

The catalog-copy source for allowed evidence, output limits, capability
ceilings, forbidden effects, and skill ids is the SPEC-022 mandate appendix.
This table remains the human-readable summary. SHIP MUST NOT invent mandate
text beyond that appendix.

Each seat also carries a versioned `analysisRubric` — required questions,
required evidence, failure modes, an Artifact quality bar, and a binding
`outOfScope` list — authored in the SPEC-022 analysis rubric appendix. The
mandate states what a seat covers; the rubric states how it reasons. Both travel
on the Assignment and are generated into role skills from one catalog, so a
hand-tuned or per-runtime prompt is never authoritative.

There is no separate CFO seat in the current product contract. Finance is part
of `strategy-finance` and the CEO mandate. Adding a CFO later requires an
explicit, versioned business-domain decision; an adapter must not introduce the
role by inference.

There is likewise no separate product-owner seat. Product-owner depth — backlog
value ordering, the scope cut list, and acceptance-criteria testability — lives
in the `product-activation` rubric, because an advisor that first read a peer's
Artifact would be anchored rather than independent.

Engineering lenses such as a senior-engineer code-health view belong to the
software domain rather than this board, and are planned separately in SPEC-023.

## Required choreography

```text
validated Snapshot + Delta
        |
        +--> CEO assignment --------+
        +--> CTO assignment --------+
        +--> CPO assignment --------+--> Challenger --> Chair --> Review
        +--> CMO assignment --------+
        +--> COO assignment --------+
```

1. The runtime binds every Assignment to the same Cycle, domain registration,
   Snapshot, Delta, evidence boundary, and output contract.
2. The five executive assignments are independent. They may run in parallel,
   and one advisor never rewrites another advisor's Artifact.
3. A full business cycle releases all five executive lenses. A deliberately
   scoped cycle may select a smaller board only under an explicit routing
   policy, and every omitted lens must remain visible as `not-selected` or an
   equivalent typed absence. Silence is not evidence.
4. The Challenger runs only after the selected advisor assignments are
   terminal. It tests their accepted Artifacts, not hidden reasoning or prompts.
5. The Chair runs only after the challenge dependency is terminal. The Chair
   records unresolved conflict, abandoned work, and evidence gaps instead of
   synthesizing missing advice.
6. The Chair may propose Decisions and Actions. It cannot approve, execute,
   publish, deploy, spend, contact a customer, or bypass the human Review and
   PLAN-to-SHIP gates.

## Identity model

`roleKind` and `roleId` are different concepts:

- `roleKind` is the small kernel scheduling archetype: `advisor`,
  `challenger`, or `chair`.
- `roleId` is the domain-owned stable identity such as `technology-risk`.
- `label` is presentation text such as `CTO` and is never an authority key.
- `roleVersion` binds the versioned mandate; it and the output contract version
  are exact Cycle bindings.

The kernel must remain usable by software and future domains without learning
business titles. The business registration must nevertheless retain all five
executive role IDs and their versioned mandates. This separation is the path
that lets the current three-kind kernel schedule the seven stable business
roles without turning presentation titles into authority.

## Artifact and evidence rules

Every executive result is an immutable, attributed Artifact. It must include:

- exact Cycle, Assignment, role ID, mandate version, Snapshot, and Delta
  bindings;
- evidence references for material claims;
- confidence, assumptions, uncertainty, and what would change the conclusion;
- at most the proposal/action limits declared by its output contract;
- no prompt, hidden chain of thought, credential, machine path, or executable
  capability.

Rejected or malformed output does not become advice. An unavailable advisor is
represented by typed absence and reaches the Chair as a gap, never as a locally
fabricated summary.

## Dashboard projection

The Operate dashboard must be able to show, from owner-issued verified data:

- the five executive labels and stable role IDs;
- assignment state, accepted Artifact, evidence coverage, and typed absence;
- Challenger findings and which executive artifacts they address;
- Chair synthesis, unresolved conflict, Decisions, and proposed Actions;
- the exact Event head and Cycle binding for the displayed board.

The browser presents this authority. It must not derive role selection,
advisor completion, evidence sufficiency, or Chair readiness from labels or
free text.

## Current source-checkout implementation

The current unpublished candidate keeps the kernel kinds small while carrying
the complete business board through typed contracts:

- the registry and business-domain registration define the five advisor role
  IDs plus `independent-challenge` and `chair`, with exact role versions,
  mandate appendices, analysis rubrics, and output contracts;
- Assignment, compiler, router, scheduler, ledger, and replay paths distinguish
  `roleKind` from `roleId`, release the selected advisors before Challenger and
  Chair, and carry typed absence instead of treating silence as completion;
- the canonical catalog generates the repo-owned role executor skills and
  Codex/Cursor adapter assets, so adapter prose is not a second policy source;
- the owner projection emits the verified executive-board display surface, and
  OpenPlanr's production composition consumes that surface for Cycle detail
  without inferring seats from labels.

Those are source and test claims, not installed-product claims. The globally
installed release may still contain the previous implementation. SPEC-022 and
SPEC-020 passed their local independent reviews; always read their task
frontmatter and QA ledgers before claiming the same for different bytes. Do not
copy an older installed skill back into the runtime.

## Release acceptance

Before the first v2 release, retained evidence must prove all of the following:

- the business registration contains the five exact executive role IDs above;
- a full business cycle creates five independently bound advisor Assignments;
- scheduler and ledger logic accept multiple roles with role kind `advisor`;
- missing, duplicate, stale, foreign, or label-substituted roles fail closed;
- Challenger and Chair dependency ordering is deterministic and replay-safe;
- business and software domains remain isolated and the kernel contains no
  hard-coded executive titles;
- CLI, agent runtime, packed install, and dashboard expose the same attributed
  board without revealing private prompt or reasoning data;
- Review and PLAN-to-SHIP remain human gates.

The current source checkout has automated contract, adapter, replay,
packed-package, production-composition, and real-browser coverage for this
candidate, and the independent reviews passed. Manual VoiceOver, NVDA, and
physical-device sessions remain explicitly unclaimed under the accepted local
closure limitation. Passing local automation does not publish or install the
candidate.

The implementation sequence and exact handoff gates are in
[CONTINUATION_PLAN.md](CONTINUATION_PLAN.md).
