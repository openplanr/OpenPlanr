# ADR-006: Operating Board Protocol and Ownership

## Status

Accepted

## Context

OpenPlanr already owns project planning and planr-pipeline owns the complete
PO → Design → Review → DEV → QA delivery flow. Neither contract represents the
continuous founder loop that turns current evidence into a bounded decision,
routes an accepted proposal into planning, and later reconciles the observed
outcome.

Embedding that loop in prompt-only CEO/CTO/CMO personas would create a second
planning engine without durable state, evidence attribution, recovery, or human
governance. Adding those personas to `registry/roles.json` would also mix
strategic advisory lenses with the canonical nine delivery roles.

## Decision

Protocol v1.2 adds an Operating Board capability without changing Protocol v1.0
planning artifacts or Protocol v1.1 compatibility contracts.

- `planr-pipeline` owns the schemas, advisor/provider registries, canonical
  reducer, JCS hashing rules, provider conformance kit, read-only dashboard
  projection contract, and ecosystem release-operation contract.
- OpenPlanr owns the public `planr operate` behavior, storage transactions,
  provider execution, model dispatch, route application, recovery, and outcome
  reconciliation.
- The six operating lenses live in `registry/operating-roles.json`. They remain
  read-only and separate from the nine delivery roles in `registry/roles.json`.
- Each lens declares machine-evaluable minimum evidence. An unready lens skips
  the model call and opens a data gap; the Chair consumes verified advisor
  results only.
- Durable state is an append-only hash-chained event stream plus immutable
  content-addressed records and validated checkpoints. Digests use RFC 8785 JCS
  and SHA-256.
- A successful cycle ends at `reviewable`; closing is a separate human action.
- Route lifecycle is `proposed → accepted → prepared → applied`. Acceptance is
  governance only. Application is a separate, digest-bound mutation.
- The dashboard reads only a validated reduced projection. It never repairs,
  replays, or mutates Operating Board state.
- Coordinated ecosystem promotion uses a digest-bound release operation and a
  dependency-safe saga. Once a package is published, recovery becomes a
  forward-fix rather than destructive rollback.

## Consequences

- Advisor suggestions become attributable proposals, not autonomous executive
  actions.
- Missing evidence is visible and suppresses wasteful or misleading model calls.
- Interrupted writes and stale projections can be detected and recovered
  explicitly.
- OpenPlanr and pipeline PO retain their intentional planning overlap while
  Operating Board routes declare which planning engine receives an accepted
  finding.
- Existing SPEC/story/task frontmatter, PLAN/SHIP separation, Preserve rules,
  and the canonical delivery-role registry remain unchanged.
- Production dashboard integration requires approval of the coded preview; the
  Protocol reader/API can ship independently.

## Rejected alternatives

- Adding CEO/CTO/CMO as delivery agents.
- Persisting only a mutable board JSON file.
- Letting advisors write specs, deploy, publish, spend, or contact customers.
- Treating route acceptance as authorization to apply it.
- Reimplementing operating state transitions in runtime skills or prompts.
