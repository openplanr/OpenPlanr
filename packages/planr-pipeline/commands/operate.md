---
description: Run the OpenPlanr evidence-to-decision operating loop through the public CLI
argument-hint: "<command> [options]"
---

# /planr-pipeline:operate

This command owns the end-to-end interactive workflow and orchestrates the adapter
`prepare → record → finalize` lifecycle invisibly, so you are never required to
type an adapter lifecycle subcommand. The `planr operate` CLI remains the complete,
scriptable, authoritative surface for state, locks, validation, provenance,
routing, and recovery. Cadence-triggered runs obey the same rule: R1 applies —
nothing auto-chains to PLAN or SHIP, and a scheduled run never accepts findings or
applies routes.

With no arguments, run one complete Operating Board cycle and stop at review:

1. Run `planr operate inspect --json`.
2. Skip initialization when `data.initialized` is already `true`.
3. Otherwise complete CLI-owned guided initialization.
4. Preview and execute the exact returned cycle action.
5. Complete the native CEO, CTO, CPO, CMO, COO, and Chair lifecycle.
6. Print `planr operate report` as concise Markdown.

With explicit arguments, delegate only that public command:

```bash
planr operate $ARGUMENTS
```

The CLI owns evidence collection, provider consent, advisor dispatch,
deterministic consolidation, state, route previews, recovery, and outcome
reconciliation. Never edit `.planr/operate` directly and never invoke
`planr-pipeline` as a nested executable.

Start guided setup with exactly `planr operate init --json` only after inspect
reports that initialization is absent, or when reconfiguration was explicitly
requested. Guided mode is the self-describing response from that command; there
is no `--guided` flag. Do not probe `operate --help` or `init --help` to
discover the questionnaire transport.

Consume only schema-valid `questionnaire` and `actions` returned by the CLI.
Present questions verbatim through a positively verified native question
surface; otherwise prefer the CLI-owned interactive flow in an attached
terminal, then structured chat one question at a time, then the CLI's named
handoff. Never dump the full questionnaire as a form. Submit typed answers only
through the bounded stdin/resume lifecycle. Never copy question definitions,
infer missing answers, or reconstruct commands from conversation.

For a self-describing questionnaire, copy `submission.envelope.fixedFields`
verbatim, resolve its declared dynamic fields, and for each chosen descriptor
copy only the fields named by `answers.copyFields`, then add `value`. Treat
`required` and `valueType` as constraints, never answer-envelope properties.
Connect one complete bounded JSON document and EOF before launching
`submission.transport.argv` as tokens. Never launch a bare `--stdin` action
against a terminal and wait to send input later. Prefer native argv-plus-stdin
execution. A shell-only runtime may use one bounded pipe that closes EOF in the
same invocation only for `public` or `internal` answers; higher-sensitivity
answers require the CLI handoff and must not enter argv, shell text, logs, or
temporary files. Never guess metadata. If `submission` is absent, return the
compatible CLI update/handoff.

A no-argument command or explicit request to run one Operating Board cycle
selects the exact CLI-returned cycle-start action and authorizes only its
reversible local native continuation through `reviewable`, `blocked`, or
`failed`. Preview first, then perform adapter prepare/record/finalize, resume,
Chair, and report steps without asking the user to paste commands. Ask
separately for external provider consent, finding acceptance, route application
or rollback, planning-artifact creation, PLAN, SHIP, and external effects.

Treat every top-level `handoff` as the only lifecycle command contract. Execute
only its current `handoff.next[].argv` token arrays, never an action from a prior
state. For `adapter.record`, read `dispatch` and dispatch that exact
`dispatch.agent` (`operating-<role>`) subagent through the Task tool with the
role's operating mandate at `dispatch.mandatePointer` and only the bounded
read-only `dispatch.toolGrant`. The mandate carries the lens question, the read
boundaries, and the citation requirement — no evidence body and no evidence
index — so the subagent investigates with its own read tools and returns a v1.3
`operating-advisor-response@1.3.0` with a citation for every claim, recorded
against `stdin.schemaPointer`; the engine resolves and snapshots every citation
into evidence. Never widen the grant, add tools, or read outside the mandate's
declared boundaries. When `dispatch.isolation` is `unsupported` the runtime
cannot carry the mandate: report it unsupported for operate rather than degrading
to a hidden fallback. Independent advisor inference may
run in parallel, but adapter lifecycle mutations are serial: execute only the
single current `adapter.record`, wait for its returned handoff, then record the
next role. Retain each role's exact serialized response until finalization and
replay it byte-for-byte after a transport failure; never regenerate or rephrase
a recorded response. Use `handoff.recovery` only after a failed current action.
Never derive, suffix, or replace a returned idempotency key, lease, digest,
cycle, role, runtime, or argv token; never probe machine commands with `--help`.

Interim continuation rule: until the CLI emits its own `ok:true` continuation
shape, treat a CLI exit code 4 on a guided-stage advance or a first-use authority
prompt as an interaction handoff, not a failure. Present the returned
questionnaire or consent request and continue the same flow; never report the
cycle as failed on that exit code alone.

Treat `--preview` as provider-free and write-free; `--dry-run` may use a
disclosed, consented provider but commits no state. Configure component roots
and bounded JSON/CSV import paths through `planr operate init`; `sources test`
only validates an already configured read-only source. Keep finding acceptance
separate from route application. An answered gap closes only after `gaps verify`
cites explicit evidence. If a DEV route returns `awaiting-plan`, present its
exact native PLAN invocation and resume the same route only after human review
and matching planning provenance; `shipInvoked` stays false. `run --review-only`
observes existing shipment proof and due outcome observations but does not start
SHIP.

Canonical advisory lenses: CEO (strategy-finance: Direction, business model, pricing and packaging, focus, economics, and what to stop.); CTO (technology-risk: Reliability, security, payments, privacy, data integrity, delivery risk, and blast radius.); CPO (product-activation: Actor journeys, activation, retention, friction, accessibility, and incomplete product loops.); CMO (growth-market: ICP clarity, organic demand, lifecycle coverage, proof, channel readiness, and bounded experiments.); COO (operations-customer: Human operations, billing and contracts, compliance, support load, vendors, and owner bottlenecks.); Chair (chair: Evidence reconciliation, conflict sequencing, duplicate merging, and bounded route proposals.). They are independent, read-only
executive perspectives—not delivery agents and not permission to role-play
without evidence. Dispatch each lens as its generated `operating-<role>` subagent
(named by `dispatch.agent`) with the role's operating mandate at
`dispatch.mandatePointer` and only the bounded read-only tool grant, and return
the v1.3 `operating-advisor-response@1.3.0` object with a citation for every
proposal. The mandate declares the lens question, investigation focus, read
boundaries, and citation requirement; it carries no evidence body and no evidence
index, so the lens gathers what it needs with its own read tools and the engine
mints evidence from the resolved citations. A runtime that cannot enforce the
bounded read-only boundary is declared `unsupported` for operate, never silently
degraded. Finalize independent results, rerun the same cycle, and prepare the
Chair separately. Never improvise or widen a role prompt.

Planning-only installations retain help, `inspect`, and `demo`; surface the
CLI's exact `E_PIPELINE_NOT_INSTALLED` recovery for Protocol v1.2 commands. Stop
at every explicit external-effect confirmation and PLAN review gate. This
command must not invoke SHIP, deploy, publish, spend, contact customers, or
apply a one-way door.

After a completed cycle, print the concise Markdown brief and the requested
per-lens reports (CEO, CTO, CPO, CMO, COO, Chair), or return strict JSON for
automation. Include the exact CLI-provided planning conversion choices. The
dashboard is optional and must never be the only result.
