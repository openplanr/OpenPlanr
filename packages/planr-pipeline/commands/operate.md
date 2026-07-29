---
description: Run the OpenPlanr evidence-to-decision operating loop through the public CLI
argument-hint: "<command> [options]"
---

# /planr-pipeline:operate

Delegate this request to the public OpenPlanr CLI:

```bash
planr operate $ARGUMENTS
```

The CLI owns evidence collection, provider consent, advisor dispatch, deterministic
consolidation, state, route previews, recovery, and outcome reconciliation. Never
edit `.planr/operate` directly and never invoke `planr-pipeline` as a nested
executable.

Consume only schema-valid `questionnaire` and `actions` returned by the
CLI. Present questions verbatim through a positively verified native question
surface; otherwise downgrade to structured chat, an attached terminal, or the
CLI's named handoff. Submit typed answers only through the bounded stdin/resume
lifecycle. Never copy question definitions, infer missing answers, or reconstruct
commands from conversation.

After a preview, ask separately for the exact named non-read-only action. Echo
only its CLI-returned command and confirmation digest. Field answers and prior
confirmations never authorize initialization, cycle start, provider use, route
application, PLAN, or SHIP. Stop after every selected action.

Treat `--preview` as provider-free and write-free; `--dry-run` may use a disclosed,
consented provider but commits no state. Configure component roots and bounded
JSON/CSV import paths through `planr operate init`; `sources test` only validates
an already configured read-only source. Keep finding acceptance separate from
route application. An answered gap closes only after `gaps verify` cites explicit
evidence. If a DEV route returns `awaiting-plan`, present its exact native PLAN
invocation and resume the same route only after human review and matching planning
provenance; `shipInvoked` stays false. `run --review-only` observes existing
shipment proof and due outcome observations but does not start SHIP.

Canonical advisory lenses: CEO (strategy-finance: Direction, business model, pricing and packaging, focus, economics, and what to stop.); CTO (technology-risk: Reliability, security, payments, privacy, data integrity, delivery risk, and blast radius.); CPO (product-activation: Actor journeys, activation, retention, friction, accessibility, and incomplete product loops.); CMO (growth-market: ICP clarity, organic demand, lifecycle coverage, proof, channel readiness, and bounded experiments.); COO (operations-customer: Human operations, billing and contracts, compliance, support load, vendors, and owner bottlenecks.); Chair (chair: Evidence reconciliation, conflict sequencing, duplicate merging, and bounded route proposals.). They are independent, read-only executive
perspectives—not delivery agents and not permission to role-play without evidence.
Native advisor work must consume the digest-bound `rolePacks` returned by
`planr operate adapter prepare` with enforced empty-tool isolation. Finalize independent results, rerun the same cycle, and prepare the Chair separately. Never
improvise or widen a role prompt in this command. If the runtime cannot enforce
isolation, use the structured provider path or fail closed.

Planning-only installations retain help, `inspect`, and `demo`; surface the CLI's
exact `E_PIPELINE_NOT_INSTALLED` recovery for Protocol v1.2 commands. Stop at every
explicit human confirmation and PLAN review gate. This command must not invoke
SHIP, deploy, publish, spend, contact customers, or apply a one-way door.
