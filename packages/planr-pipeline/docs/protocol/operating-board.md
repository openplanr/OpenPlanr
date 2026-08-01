# Protocol v1.2 Operating Board

The Operating Board is OpenPlanr's evidence-to-decision control plane. It
continuously answers four questions without replacing planning or delivery:

1. What verified evidence changed?
2. What is the current constraint?
3. Which bounded next move should a human accept?
4. Did the shipped move produce the declared outcome?

## Product boundary

OpenPlanr owns the public `planr operate` command and all mutations.
planr-pipeline owns the portable contracts, deterministic reduction,
conformance, and generated runtime guidance. Operating advisor lenses are not
delivery agents and never enter `registry/roles.json`.

No operating command may auto-chain SHIP, deploy, publish, spend, contact a
customer, change credentials, make a one-way decision, or mutate production
data.

## Durable state

Every persisted v1.2 object has:

```json
{
  "kind": "operating-event",
  "schemaVersion": "1.0.0",
  "protocolVersion": "1.2.0"
}
```

The durable model has four layers:

- append-only `operating-event` records with contiguous sequence numbers,
  previous-event hashes, correlation/causation IDs, evidence references, and
  typed event discriminators. Every discriminator selects exactly one strict
  payload schema, and undeclared payload fields are rejected;
- immutable `operating-record` objects addressed by JCS SHA-256 digests. The
  `recordType` discriminator selects the canonical schema for `content`;
- write-ahead `operating-transaction-journal` records for bounded mutations;
- validated `operating-checkpoint` objects and a disposable
  `operating-state` projection.

Legacy `.planr/board/` imports append strict
`migration.legacy-imported` audit events. These events bind source, backup, and
content-addressed record digests but do not mutate the operating projection;
the migration manifest remains the authoritative import and rollback record.

Canonicalization is RFC 8785 JCS over already-parsed JSON values. Readers reject
non-finite numbers, sparse arrays, lone Unicode surrogates, cycles, sequence
gaps, hash mismatches, unknown fields, and unsupported Protocol versions.
Checkpoints declare `integrity.status: hash` by default. A runtime may inject an
external Ed25519 or HMAC-SHA256 signer and verifier to produce
`integrity.status: signed`; only the algorithm, key identifier, and signature
are persisted. Key material remains outside the portable checkpoint, and a
caller may require successful external verification before replay.

## Cycle lifecycle

```text
preparing → collecting → advising → consolidating → reviewable → closed
```

`blocked`, `failed`, and `cancelled` are explicit exceptional states. A normal
successful invocation stops at `reviewable`; a human closes it separately.
Cycle health is `normal`, `quiet`, `partial`, or `blocked`. Missing non-critical
evidence can produce a partial or quiet review; missing critical evidence
blocks the affected route.
Quiet cycles may close without dispositions. A non-quiet cycle may close only
after every surfaced finding is terminal or has an applied route, and every
owner decision is closed or superseded. Route projections expose their
deduplicated `findingIds` so this close check remains deterministic.

## Evidence readiness

Each role registry entry declares:

- accepted source;
- required claim types;
- minimum item count;
- maximum age;
- observation window;
- sensitivity ceiling;
- whether requirements are all-of or any-of;
- unready behavior.

These v1.2 readiness/provider fields remain readable for artifact compatibility,
but Protocol v1.3 mandate cycles do not run OpenPlanr's former collector or hand
an evidence body to an advisor. Each native advisor investigates within the
mandate's bounded read-only roots and returns citations for every claim.
OpenPlanr resolves those citations at the pinned revision, snapshots eligible
content, and marks an ungrounded role `not_evaluated`. The Chair consumes only
verified advisor results from the current cycle.

The frozen v1.2 provider registry (`repository`, `planr`, `git`, `github`,
`linear`, and `file-import`) remains in the protocol so existing artifacts and
digests validate. It is not a selectable v1.3 collection surface and does not
authorize remote access. Repository citations may retain structured provenance
containing the ecosystem component ID, canonical remote, exact revision,
configured branch, and a dirty-worktree fingerprint. Evidence path, digest,
freshness, and sensitivity remain properties of the resolved citation snapshot.
Every derived finding declares the highest sensitivity of its cited evidence.
Consolidation may raise that classification when cited evidence changes, but
must never lower or omit it.
Each configured `operating-provider-manifest` records only a safe, redacted
endpoint display, permitted data classes, provider/local retention, bounded
request/token/time/cost limits, a policy digest, and first-use or renewal
consent timestamps. Raw credentials and endpoint authentication stay in
machine-local OpenPlanr state and never enter the portable manifest. The
`policyDigest` is JCS SHA-256 over the safe endpoint, permitted data classes,
retention, capabilities, limits, provider identity/version, and consent policy;
route planning can therefore bind the exact reviewed provider policy.

OpenPlanr must disclose that safe policy before the first provider call and
renew consent when the endpoint, permitted data classes, retention,
configuration, credential policy, or review window changes. A preview cannot
call a provider. A dry-run may call the disclosed provider but commits no
operating state, so first-use consent still applies.

Read-only component roots are selected through `planr operate init` and stored
machine-locally. The retired source registry, file-import flow, per-profile
collector tuning, and evidence-classification commands are not part of the v1.3
public contract.

## Advisor and consolidation contract

The five domain lenses are Strategy/Finance, Technology/Risk,
Product/Activation, Growth/Market, and Operations/Customer. The Chair receives
their verified results and may merge duplicates, sequence proposals, surface
conflicts, or return quiet.

Advisor results do not allocate persistent IDs, compute authoritative scores,
or mutate state. The deterministic engine validates evidence references,
allocates IDs, computes projections, applies caps, and persists the final
finding/decision/data-gap records.

### State-aware native adapter handoff

A native advisor boundary returns a strict Protocol v1.2
`operating-adapter-handoff`. The handoff is self-describing and contains:

- the advisor/Chair `phase` and lifecycle `state`;
- the binding tuple: cycle ID, immutable evidence digest, selected runtime,
  CLI-owned idempotency key, nullable pre-prepare lease, and nullable expiry;
- role status plus an input digest after preparation;
- only the exact currently valid actions in `next`, with interrupted-session
  actions separately identified in `recovery`;
- absolute role-pack and compact-response schema pointers into the retained
  `adapter.prepare` result.

Argument tokens use the Protocol safe-token grammar and are executed as an
argument vector, never through shell evaluation. A runtime must not parse
human-readable next-step strings, append role-specific data to the
idempotency key, substitute a lease or digest, or probe lifecycle commands with
`--help`. The returned arrays are the only lifecycle invocation contract.

The adapter session progresses:

```text
prepare-required → record-required → finalize-required → continue-required
                            └───────────────→ cancelled
```

Independent advisor roles and the Chair are distinct dispatch phases. Every
successful record response includes a new handoff whose `next` array contains
only missing record actions. Once every role is recorded, `next` contains only
finalize; after commit it contains only the cycle-bound continuation. Resume and
cancel appear only in `recovery` for an unexpired recording/finalizing session.
Expired or cancelled sessions require a fresh CLI-owned prepare binding; valid
already-recorded role results are recovered by digest.

The fixed effect classification is:

| Lifecycle action | Effect classification |
|---|---|
| prepare, record, cancel | `machine-local-write` |
| resume | `read-only` |
| finalize | `project-write` |
| continue | `project-write` |

No handoff grants provider consent, finding disposition, route application,
planning, PLAN, SHIP, or `external-effect` authority.

## Route governance

```text
proposed → accepted → prepared → applied
                         └──────→ failed → rolled_back
```

`accepted` means the decision owner approved the proposal. It does not write a
SPEC or any destination artifact. `prepared` binds the route digest, preview
digest, evidence digest, provider digest, destination digest, and verified
event head. `applied` requires a separate confirmation digest plus a
write-ahead transaction ID.

Route application targets either OpenPlanr planning or pipeline PO explicitly.
Every created SPEC links back to the source cycle/finding and declares a typed
outcome. Existing PLAN→SHIP review gate R1 remains mandatory.

Finding acceptance and route application are distinct transitions. Acceptance
records governance only. Application requires a separate digest-bound preview
and confirmation of the exact local write set.

For Pipeline-PO, the first DEV application calls `preparePlan()` and returns
`awaiting-plan` with the exact native PLAN invocation and
`shipInvoked: false`. After the user runs and reviews PLAN, resuming the same
route calls `completePlan()`, validates route-bound `planr-pipeline` PO
provenance, and applies the route idempotently. Missing, unknown, or mixed
planning producers fail closed. No Operating Board transition calls SHIP.

## Gap lifecycle

```text
open → answered → verified → closed
```

A human answer is context, not verified evidence. `gap.verified` requires one
or more explicit evidence IDs before `gap.closed`; runtimes must not infer
verification from an answer or replace missing evidence with generic advice.

### AGENT artifact generation

AGENT routes use the portable generation lifecycle exported by this package:

```text
prepared → generating → validated → committed
                     ↘ failed → prepared (resume, at most three attempts)
                                ↘ cancelled
```

`prepareOperatingArtifactGeneration()` binds the input digest, evidence IDs,
typed/versioned template, output format and contained destination before any
runtime call. It also declares byte, time, token and cost budgets plus an
empty-tool, network-disabled sandbox. `validateOperatingArtifactOutput()`
applies format-specific defenses for Markdown, HTML, JSON and CSV, records the
output and template digests, and emits provenance before
`commitOperatingArtifactGeneration()` makes the session eligible for an
OpenPlanr journal transaction. `runOperatingArtifactGeneration()` provides the
bounded retry/resume orchestration while accepting generation as an injected
runtime callback; it does not itself select or contact a provider.

OpenPlanr owns the write-ahead journal and event commit. Runtime adapters only
dispatch the injected generation call and must not reimplement these
transitions or write the destination directly.

## Typed outcomes

An `operating-outcome` binds:

- metric and unit;
- query identity;
- direction, operator, and aggregation;
- baseline and target windows;
- threshold;
- minimum sample and coverage;
- stale and missing-data policies;
- guardrail precedence;
- observation and verification dates;
- rollout and rollback statements.

`operating-outcome-observation` records actual value, sample, coverage,
freshness, guardrail evaluation, and evidence references. Missing or stale data
never silently becomes success.

Outcome state is evented in three explicit steps: `outcome.registered` records
the immutable contract, `outcome.observed` accepts only a validated
`operating-outcome-observation`, and `outcome.evaluated` records the
deterministic result. An observation cannot create or replace its contract, and
an unknown outcome ID fails replay.

OpenPlanr’s review-only reconciliation may emit `ship.observed` only after the
linked spec’s shipped marker, run manifest, QA evidence, and
`planr-pipeline` shipment provenance agree. Only then may it import due,
schema-valid observation envelopes. This observes a separately invoked SHIP;
it never initiates SHIP or calls a model.

## Dashboard contract

The dashboard API reads only:

```text
.planr/operate/projections/state.json
```

`GET /api/operate` returns `absent`, `invalid`, `stale`, or `ready`, always with
`readOnly: true`. It does not expose absolute machine paths. A mismatch against
the canonical `.planr/operate/checkpoints/current.json` checkpoint is
diagnostic; the UI never repairs or replays events. Operators inspect integrity
with `planr operate integrity status` and explicitly recover with
`planr operate cycles recover`. The coded preview in
`templates/operating-dashboard-preview.html` was approved on 2026-07-28; the
production dashboard shell now consumes the same generated tokens and read-only
projection contract.

## Ecosystem release operations

`ecosystem-release-operation` binds the umbrella SPEC digest to each repository's
local SPEC ID, target branch/version, commit, pull request, checks, approvals,
tag, package version, and tarball digest.

Lifecycle:

```text
drafted → preparing → prepared → promoting → verified → completed
```

`blocked`, `compensating`, and `forward-fix` preserve non-happy paths. Before
publication, compensation may restore reversible state. After any package is
published, the operation is forward-fix-only. The generic `ecosystem-saga`
provides unique idempotency keys and dependency-safe ready steps.

## Runtime adapters

All runtimes call the public `planr operate` surface:

- Claude Code: `/planr-pipeline:operate`
- Codex: `$planr-operate`
- Cursor: `planr operate`

Generated guidance never calls `planr-pipeline` directly and never implements
state transitions itself. Use `npm run generate:operating-assets` after registry
changes; CI uses `npm run check:operating-assets`.

## Compatibility

Protocol v1.0 planning artifacts and v1.1 capability contracts remain readable
and unchanged. Protocol v1.2 is additive. Consumers must reject a v1.2 kind they
do not support rather than attempting a lossy downgrade.

## Protocol v1.3 agentic execution

Protocol v1.3.0 is additive. Every v1.2 contract above remains in force and v1.2
readers continue to read v1.2 artifacts unchanged. The new kinds live in
`schemas/v1.3.0/` and are registered alongside — never in place of — their v1.2
entries. See ADR-010 for the full amendment record against SPEC-002 and the list
of clauses that remain binding.

### Mission packet replaces the role pack

Each dispatched lens receives an `operating-mission-packet` instead of a
pre-loaded role pack. The packet is compact, digest-bound, and carries the
product charter and current goals, the prior-cycle summary, planning and
delivery status, the role mandate/authority/output contract, the declared
read-only roots, the bounded tool grant, and an **evidence index**. Each
`operating-evidence-index-item` is a pointer only — path or revision, content
hash, source, classification, freshness, sensitivity, and detected signals. The
packet MUST NOT contain file bodies; `additionalProperties` is `false` at every
level so a body field cannot be added without a schema bump. `maxInputBytes` is
enforced at construction and fails closed with a named error identifying the
offending role.

### Bounded read-only tool grant and fail-closed dispatch

An `operating-tool-grant` lists only read-only capabilities — `file-read`,
`glob`, `content-search`, and read-only git history (`git-log`, `git-show`,
`git-diff`, `git-blame`) — and the repo-relative roots they are confined to. A
native advisory agent MUST NOT write, edit, execute commands, run build or test
steps, open network connections, read environment variables, or read outside its
declared roots. The `operating-adapter-handoff` dispatch selects an `isolation`
of `enforced-read-only-bounded`; runtimes that cannot enforce that boundary fall
back to `fail-closed-structured-provider`. Adapter capabilities gain
`toolIsolation: enforced-read-only` and `operatingAdvisorDispatch:
native-read-only` additively; all v1.2 capability values keep validating.

### Citation resolution, snapshot, and reject

Every proposal cites at least one `operating-citation` — a repository path with
an optional line range, a git revision, or a planr artifact — each bound to the
cycle's pinned revision. After the agent returns, the engine records an
`operating-citation-resolution` per citation: a `resolved` verdict snapshots the
cited content into machine-local evidence and records the `evidenceId` and
`snapshotDigest`; a `rejected` verdict records the reason (`fabricated-path`,
`wrong-line-range`, `stale-revision`, or `unresolvable`) and the opened `gapId`.
A proposal with any unresolvable citation is rejected and surfaced as a
release-blocking data gap of category `unresolvable-citation`. Snapshotted
citation content is subject to the same redaction and secret-scan rules as
collected evidence.

### `.state/records.jsonl` layout

Content-addressed records move from the v1.2 directory-per-digest-prefix layout
to a single append-only `.state/records.jsonl`, one
`operating-records-log-entry` per line, retaining the digest as a field. Route
records are never one file per route in the readable tree. Migration from the
v1.2 layout is automatic, reversible, and lossless: an `operating-migration-record`
carries `sourceLayout`/`targetLayout` and before/after `recordCount` and
`eventCount` pairs so losslessness can be asserted mechanically.

### `dispatchMode` coexistence

The `operating-role-registry` carries a required per-role `dispatchMode:
"pack" | "mission"`. `pack` continues the v1.2 role-pack execution model;
`mission` uses the v1.3 mission packet. Both models can run during migration and
reduce identically, so a project can move roles over one at a time.

### Cadence contract

`operating-cadence-status` makes cadence a real contract. `manual` runs only on
request and has no next due date (`nextDueAt` is `null`). `weekly` and `monthly`
compute and surface the next due date in status. Optional scheduled execution
never accepts findings, applies routes, invokes PLAN, or invokes SHIP; R1
remains mandatory.

### FR6 route targets

Accepted findings route to the delivery surfaces the product already has.
Nothing invokes SHIP, and R1 remains mandatory.

| Shape of work | Route target |
|---|---|
| Small, bounded implementation | Quick task (`create-quick-task`, under `.planr/quick/`) |
| Substantial product or technical work | Spec + mandatory PLAN review |
| Human or business choice | Decision record |
| Research, content, or report | Agent artifact |

The v1.3 `operating-route-plan` adds the `create-quick-task` action kind so
small, bounded work reaches the existing quick-task surface directly. Every
action stays reversible and requires confirmation.

### Decision brief rendering

Operating briefs and owner decisions render as self-contained artifacts through
the existing artifact-review infrastructure.
`createOperatingDecisionBriefArtifact` turns a brief — its question, evidence,
options, and what the decision blocks — plus an optional owner decision into one
HTML artifact carried by an `artifact-envelope@1.1.0`, so a non-technical owner
can read it without a terminal. The rendered document references no remote CSS,
JS, or font; a decision owner opens it fully offline, and the renderer fails
closed if any `http(s)` reference is present. Rendering is local and
share-on-request; nothing publishes automatically.
