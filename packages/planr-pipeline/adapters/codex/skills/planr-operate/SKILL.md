---
name: planr-operate
description: Initialize when needed, run one complete OpenPlanr operating cycle, and present the executive report without crossing human or SHIP boundaries.
license: MIT
---

# Planr Operating Board

Use only the public `planr operate` command surface. OpenPlanr owns operating
state, evidence collection, advisor dispatch, deterministic consolidation,
routing, recovery, and outcome reconciliation; this skill must not reimplement
those behaviors.

## Default workflow

Invoking `planr-operate` without an explicit public subcommand means: run one
complete Operating Board cycle and stop at its review gate. The user must not
write an orchestration prompt or run adapter commands.

1. Run `planr operate inspect --json`.
2. When `data.initialized` is `true`, do not reopen initialization. Continue
   directly to the provider-free cycle preview.
3. When `data.initialized` is `false`, complete guided initialization, then
   continue to the cycle preview in the same invocation.
4. Treat this bare skill invocation as the explicit request for one cycle. Run
   the exact CLI-returned start and native advisor lifecycle through CEO, CTO,
   CPO, CMO, COO, and Chair until `reviewable`, `blocked`, or `failed`.
   Evidence-unready lenses still appear as `not_evaluated`; never invent advice.
5. Render `planr operate report` as concise Markdown in chat, including every
   lens result, gaps, findings, and exact proposed next actions. The dashboard
   is optional.

When the user supplies an explicit public subcommand such as `inspect`,
`status`, `report`, or `findings list`, perform only that command. Do not turn a
read-only inspection request into a new cycle.

## Guided interaction

Start guided setup with exactly `planr operate init --json` only after inspect
reports that initialization is absent, or when the user explicitly requests
reconfiguration. Guided mode is the self-describing response from that command;
there is no `--guided` flag. Do not probe `operate --help` or `init --help` to
discover the questionnaire transport.

Consume only schema-valid `questionnaire` and `actions` returned by the CLI.
Present questions verbatim through the active runtime's verified interaction
surface. If native questions are unavailable, prefer the CLI-owned interactive
flow in an attached terminal. If neither is available, use structured chat one
question at a time; never dump the whole questionnaire as a form. Otherwise
return the CLI handoff. Submit typed answers only through the bounded
stdin/resume lifecycle, preserving question IDs and declared answer types. Do
not copy question definitions, infer missing answers or defaults, rebuild
commands from chat, or edit operating configuration to answer a question.

For a self-describing questionnaire, construct the JSON document only from its
`submission` contract: copy `submission.envelope.fixedFields` verbatim, resolve
`questionnaireDigest` from the declared `/digest` pointer, and for each chosen
descriptor copy only the fields named by `answers.copyFields`, then add `value`.
Treat `required` and `valueType` as constraints, never answer-envelope
properties. Omit only unanswered optional descriptors and set `submittedAt`
from the runtime clock.
Serialize once. Before launch, connect the complete bounded document and EOF to
stdin, then execute `transport.argv` as argument tokens. Never launch a bare
`--stdin` action against a terminal and wait to send input later. Prefer the
runtime's native argv-plus-stdin process API. A shell-only runtime may use one
bounded pipe that closes EOF in the same invocation only when every answer is
classified `public` or `internal`; for higher-sensitivity answers, return the CLI
handoff instead of putting JSON in argv, shell text, logs, or temporary files. Do
not guess envelope metadata. If `submission` is absent, return the CLI's
compatible update/handoff instead of reverse-engineering it.

Treat an explicit request to **run one Operating Board cycle**, including a bare
`planr-operate` invocation, as authority for that cycle's reversible local
continuation only. Preview first, then execute the CLI-returned cycle start and
its digest-bound adapter prepare, record, finalize, resume, Chair, and read-only
report steps until the cycle is `reviewable`, `blocked`, or `failed`. Do not ask
the user to paste or manually rerun those internal commands. `--yes` may be
supplied only to the exact cycle-start action selected by that explicit request;
never infer it from a questionnaire answer, an explicit read-only subcommand, or
a prior action.

Treat every top-level `handoff` as the only lifecycle command contract. Execute
only its current `handoff.next[].argv` token arrays, never an action from a prior
state. For `adapter.record`, resolve `dispatch.rolePackPointer` and
`stdin.schemaPointer` against the retained `adapter.prepare` JSON result and
submit exactly one bounded compact response. Independent advisor inference may
run in parallel, but adapter lifecycle mutations are serial: execute only the
single current `adapter.record`, wait for its returned handoff, then record the
next role. Retain each role's exact serialized response until finalization and
replay it byte-for-byte after a transport failure; never regenerate or rephrase
a recorded response. Use `handoff.recovery` only after a failed current action.
Never derive, suffix, or replace a returned idempotency key, lease, digest,
cycle, role, runtime, or argv token; never probe machine commands with `--help`.

Ask separately for external provider consent, finding acceptance, route
application or rollback, planning-artifact creation, PLAN, SHIP, and every
external effect. A field answer or prior confirmation never authorizes one of
those boundaries. Never execute prose-only legacy `next` strings.

When the CLI reports quarantined evidence, continue with the sanitized eligible
evidence if the returned cycle action remains available. Use
`planr operate evidence diagnose …` only when the CLI reports that required
evidence is blocked. Present its value-free recovery choices and stop for the user's
selection. Never trial-edit sources or `.planr/operate` state to isolate a
candidate. Exact false-positive classification requires its own reason, preview
digest, and confirmation; known credential signatures remain blocked.

Canonical advisory lenses: CEO (strategy-finance: Direction, business model, pricing and packaging, focus, economics, and what to stop.); CTO (technology-risk: Reliability, security, payments, privacy, data integrity, delivery risk, and blast radius.); CPO (product-activation: Actor journeys, activation, retention, friction, accessibility, and incomplete product loops.); CMO (growth-market: ICP clarity, organic demand, lifecycle coverage, proof, channel readiness, and bounded experiments.); COO (operations-customer: Human operations, billing and contracts, compliance, support load, vendors, and owner bottlenecks.); Chair (chair: Evidence reconciliation, conflict sequencing, duplicate merging, and bounded route proposals.). They are independent,
read-only executive perspectives—not delivery agents and not permission to
role-play without evidence. A native runtime must follow the exact handoff
returned by `planr operate run`, obtain each immutable digest-bound `rolePack`
from `planr operate adapter prepare`, and dispatch every independent pack using
the adapter's declared `operatingAdvisorDispatch` mode. In `native-bounded`
mode, advisors may use only the supplied role pack and must not inspect the
workspace, environment, network, or other tools. In `native-isolated` mode,
retain the certified empty-tool isolation boundary. Return exactly the compact
object described by `rolePack.roleBrief.output.jsonSchema`; do not add
`kind`, cycle, role, input-digest, producer, or result-digest metadata. Record
that `operating-advisor-response@1.2.0` object through the CLI so OpenPlanr
creates and binds canonical metadata and digests. Finalize those results, rerun
the same cycle, and execute the separately prepared Chair pack only after the
independent results are verified.

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
10. Present the cycle brief plus the CEO, CTO, CPO, CMO, COO, and Chair reports
    in the user's requested format. Prefer concise Markdown for chat and strict
    JSON for automation. Include exact finding/route commands and planning
    targets offered by the CLI. The visual dashboard is optional, never the
    only result.
11. In a planning-only installation, keep help, inspect, and demo usable;
    surface the CLI's exact `E_PIPELINE_NOT_INSTALLED` recovery for everything
    requiring Protocol v1.2.

Never invoke SHIP, deploy, publish, spend, contact customers, apply a one-way
door, or call `planr-pipeline` directly. Runtime adapters may dispatch advisory
work only through the machine lifecycle returned by `planr operate`; capability
tiers and native runtime isolation remain engine-controlled.
