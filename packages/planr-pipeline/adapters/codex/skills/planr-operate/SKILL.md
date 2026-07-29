---
name: planr-operate
description: Run the OpenPlanr evidence-to-decision operating loop without crossing human or SHIP boundaries.
license: MIT
---

# Planr Operating Board

Use only the public `planr operate` command surface. OpenPlanr owns operating
state, evidence collection, advisor dispatch, deterministic consolidation,
routing, recovery, and outcome reconciliation; this skill must not reimplement
those behaviors.

## Guided interaction

Consume only schema-valid `questionnaire` and `actions` returned by the CLI.
Present questions verbatim through the active runtime's verified interaction
surface; if native questions are unavailable, use structured chat, then an
attached terminal, otherwise return the CLI handoff. Submit typed answers only
through the bounded stdin/resume lifecycle, preserving question IDs and declared
answer types. Do not copy question definitions, infer missing answers or
defaults, rebuild commands from chat, or edit operating configuration to answer
a question.

After a preview, ask separately for the exact named action. Echo only the
CLI-returned command and confirmation digest for that choice. A field answer or
prior confirmation never authorizes initialization, cycle start, provider use,
route application, PLAN, or SHIP. Stop after each selected non-read-only action.
Never add `--yes`, execute prose-only legacy `next` strings, or treat a previous
answer as authority for the next action.

When the CLI returns `E_OPERATE_SECRET_DETECTED`, use only the returned
`planr operate evidence diagnose …` command. Present its value-free recovery
choices and stop for the user's selection. Never trial-edit sources or
`.planr/operate` state to isolate a candidate. Exact false-positive
classification requires its own reason, preview digest, and confirmation;
known credential signatures remain blocked.

Canonical advisory lenses: CEO (strategy-finance: Direction, business model, pricing and packaging, focus, economics, and what to stop.); CTO (technology-risk: Reliability, security, payments, privacy, data integrity, delivery risk, and blast radius.); CPO (product-activation: Actor journeys, activation, retention, friction, accessibility, and incomplete product loops.); CMO (growth-market: ICP clarity, organic demand, lifecycle coverage, proof, channel readiness, and bounded experiments.); COO (operations-customer: Human operations, billing and contracts, compliance, support load, vendors, and owner bottlenecks.); Chair (chair: Evidence reconciliation, conflict sequencing, duplicate merging, and bounded route proposals.). They are independent,
read-only executive perspectives—not delivery agents and not permission to
role-play without evidence. A native runtime must follow the exact handoff returned
by `planr operate run`, obtain each immutable digest-bound `rolePack` from
`planr operate adapter prepare`, run every independent pack with enforced
empty-tool isolation, and record only its schema-valid result. Finalize those
results, rerun the same cycle, and execute the separately prepared Chair pack only
after the independent results are verified. If the runtime cannot enforce that
isolation, use the structured provider path or fail closed.

1. Run the requested `planr operate` command with `--json` when machine-readable
   output is available. Before a new cycle, use the CLI preview so the user can
   inspect evidence sources, enabled lenses, budgets, provider use, and writes.
2. Treat `--preview` as provider-free and write-free. Treat `--dry-run` as
   write-free but potentially provider-backed and billable. A provider-backed
   run requires explicit consent to the disclosed endpoint, data classes,
   retention, limits, and policy digest. Never translate a flag or consent into
   approval for a later mutation.
3. Read only the paths and next actions returned by `planr operate`. Do not edit `.planr/operate`
   events, immutable records, journals, projections, routes, or outcome links
   directly.
4. Configure component roots and JSON/CSV import paths through `planr operate
   init`; use `planr operate sources test` only to validate an already configured
   read-only source.
5. Keep proposal acceptance and route application separate. Apply a route only
   after the user has reviewed its exact confirmation digest and explicitly
   authorized that named route.
6. An answered gap remains unverified. Close it only through `planr operate gaps
   verify` with explicit evidence IDs and named-action confirmation.
7. If a DEV route returns `awaiting-plan`, present the exact native PLAN
   invocation, stop for human review, and resume the same route only after PLAN
   artifacts and planning-producer provenance exist. `shipInvoked` must remain
   false.
8. If a cycle or route is interrupted, use the exact `planr operate` recovery,
   resume, cancel, or rollback command returned by the CLI. Do not bypass locks,
   reconstruct history, or invent missing events.
9. Use `planr operate run --review-only` to reconcile already-produced shipment
   proof and due outcome observations without evidence collection or model
   calls. It observes SHIP; it never starts SHIP.
10. Summarize the cited brief, decisions, gaps, proposed routes, warnings, and
    next actions. In a planning-only installation, keep help, inspect, and demo
    usable; surface the CLI's exact `E_PIPELINE_NOT_INSTALLED` recovery for
    everything requiring Protocol v1.2.

Never invoke SHIP, deploy, publish, spend, contact customers, apply a one-way
door, or call `planr-pipeline` directly. Runtime adapters may dispatch advisory
work only through the machine lifecycle returned by `planr operate`; capability
tiers and native runtime isolation remain engine-controlled.
