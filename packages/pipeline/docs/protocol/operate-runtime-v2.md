# Operate Runtime Protocol 2.0

> Package: local `planr-pipeline@0.44.0` development baseline
> Protocol: `2.0.0`
> Status: unpublished development work; no release claim
> Contract owner: `planr-pipeline`

This is the technical protocol reference, not the single source for product
vision or dashboard completion. Follow the authority precedence in the Operate
2.0 constitution. The current local branch is unreleased; this document makes
no installed-release claim.

Operate Runtime Protocol 2.0 is the portable boundary between OpenPlanr's
deterministic governance kernel and a selected agent runtime. It defines the
durable identities, bounded Assignment lifecycle, typed tool envelopes,
authorization table, and deterministic replay rules needed to run one
operating cycle without relying on a sibling checkout.

This development work is a runtime foundation, not a second orchestration engine. It does not
accept findings, approve proposal drafts, invoke unrelated pipeline commands, deploy, publish,
spend, contact customers, change credentials, or perform another external
effect.

## Public package surface

Consumers use declared package exports only:

| Export | Contract |
|---|---|
| `planr-pipeline/protocol` | Protocol catalog, strict v2 validators, binding checks, canonical hashing, and shared types |
| `planr-pipeline/dashboard/operate-experience-reader` | Owner-side, access-safe experience and verified display selection; no browser authority |
| `planr-pipeline/dashboard/operate-experience-audit-display-contract` | Browser-safe verifier for the owner-issued Evidence, Outcomes, History, Search, and Export display envelope |
| `planr-pipeline/operate/runtime-v2` | Assignment transitions, guards/actions, event-chain verification, deterministic replay, failure envelopes, and byte-proven challenged-ledger materialization |
| `planr-pipeline/operate/intelligence-router-v2` | Pure deterministic Delta-to-plan routing and exact plan-to-Assignment graph validation; never role dispatch or authority |
| `planr-pipeline/operate/persistent-work-v2` | Runtime-only deterministic payload builder for the legacy work-change-set compatibility contract; the current board path uses a Decision Ledger and bounded Action materialization |
| `planr-pipeline/operate/persistent-work-projections-v2` | Read-only scope ledger and Cycle work-view rebuilders |
| `planr-pipeline/operate/execution-verification-v2` | Exact execution-result, verification-plan, observation, Outcome, and Learning correlation; execution is never inferred to be success |
| `planr-pipeline/operate/authorization-v2` | Pure, deterministic, fail-closed authority evaluation shared by allowed-action derivation, refusals, and review/approve/execute/rollback guards; no target access or effects |
| `planr-pipeline/operate/policy-v2` | Immutable versioned ActionPolicy construction and deterministic core → project → narrowing domain evaluation; no provider dispatch or effects |
| `planr-pipeline/operate/approvals-v2` | Exact Action-scoped approval requirement/record, quorum, replay, consumption, supersession-history, and Review functions; no execution authority |
| `planr-pipeline/operate/governed-extensions-v2` | Exact governed provider/Executor discovery plus closed request-fingerprint, Executor-envelope, and trusted host-binding contracts |
| `planr-pipeline/operate/reference-governed-executors-v2` | Contained disposable-local and synthetic reference targets/hosts with no ambient filesystem, network, process, credential, or provider reach |
| `planr-pipeline/operate/governed-execution-v2` | Stateful at-most-once Action execution journal: one execution Assignment, one-use grant, pre-effect dispatch intent, contained effect, exact accepted result, and pure terminal replay |
| `planr-pipeline/operate/governed-recovery-v2` | Deterministic crash reconciliation and separately governed exact-baseline rollback with immutable plan/result history and no blind redispatch |
| `planr-pipeline/operate/scheduler-v2` | Compiler-bound dependency graph validation and deterministic release-intent derivation |
| `planr-pipeline/operate/extensions-v2` | Authority-free public domain and agent-runtime registration declarations |
| `planr-pipeline/operate/operating-domains-v2` | Pure business/software projection facade over one immutable core state and exact snapshot sources |
| `planr-pipeline/operate/experience-projection-v2` | Access-safe Today/Cycle/Inbox/Audit source view, preview, and live-patch projection over validated owner state |
| `planr-pipeline/operate/planning-bridge-v2` | Governed Action-to-Planning proposal, origin, and delivery-evidence correlation with the PLAN-to-SHIP gate intact |
| `planr-pipeline/operate/operating-signal-providers-v2` | Closed reference Snapshot, Metric, and Verification candidate validation; never a connected provider or executor |
| `planr-pipeline/operate/evidence-v2` | Deterministic, capability-checked registration and explicit built-in evidence dispatch |
| `planr-pipeline/operate/evidence-materialization-v2` | Runtime-only builder for one resolved/rejected evidence transaction; it never exposes a normal-agent write path |
| `planr-pipeline/operate/evidence-projections-v2` | Read-only, deterministic scope/domain evidence graph rebuilder |
| `planr-pipeline/operate/executive-board-materialization-v2` | Executive board record construction, closed validation, and deterministic materialization from accepted Artifacts |
| `planr-pipeline/operate/result-packet-v2` | Role result template construction and the exact schema dependency set a result must satisfy |
| `planr-pipeline/operate/review-workspace-projection-v2` | Shared-truth summary derivation and review workspace payload construction for the human review gate |
| `planr-pipeline/operate/trace-matrix-v2` | Closed trace-matrix construction and validation, with typed identities for roles omitted from a Cycle |
| `planr-pipeline` | The closed pipeline API, including the live-evidence companion validators/reducers and governed-landing contract validators; these portable contracts grant no provider or landing authority |
| `planr-pipeline/schemas/*` | Versioned schema/data modules, including the compiler-derived runtime-kernel catalog, nine product-experience contracts, and Protocol 1.2 governed-landing companions |
| `planr-pipeline/registry/*` | Versioned public registry data, including the canonical Operate contract and role registrations |

The Operate implementation exports have adjacent, narrowly scoped type
declarations. Their declarations import shared contract types from
`planr-pipeline/protocol`; they do not expose package-internal source paths.

## Contract identities

Every Protocol 2.0 durable object declares:

```json
{
  "kind": "operating-assignment",
  "schemaVersion": "1.0.0",
  "protocolVersion": "2.0.0"
}
```

The runtime-kernel catalog membership is compiler-derived from
`registry/operate-v2-contracts.json`. The same `schemas/v2.0.0/` directory also
contains nine product-experience contracts. The kernel contract kinds are:

- `operating-cycle`
- `operating-cycle-input-binding`
- `operating-assignment`
- `operating-review`
- `operating-review-read`
- `operating-review-receipt`
- `operating-trace-matrix`
- `operating-executive-board`
- `operating-submission`
- `operating-artifact`
- `operating-event`
- `operating-runtime-state`
- `operating-checkpoint`
- `operate-allowed-action`
- `operate-api-envelope`
- `operate-tool-call`
- `operate-domain-registration`
- `agent-runtime-manifest`
- `operating-finding`
- `operating-decision`
- `operating-action`
- `operating-work-change-set`
- `operating-work-ledger`
- `operating-evidence-candidate`
- `operating-evidence-ref`
- `operating-evidence-resolution`
- `operate-evidence-provider-registration`
- `operate-evidence-resolver-registration`
- `operating-evidence-edge`
- `operating-evidence-graph`
- `operating-model-state`
- `operating-snapshot`
- `operating-objective`
- `operating-metric`
- `operating-metric-observation`
- `operating-risk`
- `operating-assumption`
- `operating-claim`
- `operating-domain-projection`
- `business-operating-snapshot-projection` (schema version `1.0.0`)
- `software-operating-snapshot-projection` (schema version `1.0.0`)
- `operating-delta`
- `operating-intelligence-plan`
- `operating-intelligence-input-bundle`
- `operating-advisor-result`
- `operating-challenger-review`
- `operating-context-capture`
- `operating-decision-ledger`
- `operating-action-verification-plan`
- `operating-outcome`
- `operating-learning`
- `operating-scenario`
- `operating-event-trigger`
- `operate-snapshot-provider-registration`
- `operate-metric-provider-registration`
- `operate-verification-provider-registration`
- `operating-action-policy`
- `operating-policy-evaluation`
- `operating-approval-requirement`
- `operating-approval-record`
- `operating-capability-availability`
- `operating-capability-grant`
- `operating-governed-operation`
- `operating-execution-result`
- `operating-rollback-plan`
- `operating-rollback-result`
- `operate-capability-provider-registration`
- `operate-policy-provider-registration`
- `operate-executor-registration`
- `operate-live-evidence-provider-registration`
- `operate-live-evidence-provider-registry`
- `operating-live-evidence-consent-record`
- `operating-connector-checkpoint`
- `operating-live-evidence-ingestion`
- `operating-measurement-plan`
- `operating-measurement-schedule`
- `operating-measurement-schedule-receipt`
- `operating-evidence-observation`
- `operating-outcome-evaluation`
- `operating-learning-receipt`

Readers require an explicit version. A missing, mixed, unknown, or silently
downgraded version fails closed. The v2 runtime neither reads nor reinterprets
legacy records.

## Canonical contract catalog

`registry/operate-v2-contracts.json` is the portable source of the v2 catalog.
`npm run generate:operate-contracts` emits the catalog module and
`npm run check:operate-contracts` verifies that it, every v2 schema, the public
declaration, conformance fixtures, validators, and this reference document
match the registry-approved contract digests. Check mode is read-only: an
intentional surface change requires an explicit reviewed registry update before
the catalog can be regenerated.

Every v2 JSON Schema carries a compiler-verified identity extension:

```json
"x-openplanr-contract": { "id": "operating-assignment", "version": "2.0.0" }
```

The package loader verifies that identity before resolving an Operate schema.
It therefore never selects a missing, mixed, unknown, older, or newer contract
identity by fallback.

### Live evidence and governed landing companions

The live-evidence family is additive to the existing Operate truth model. A
data-only provider registration composes with the frozen provider and resolver
registrations; it is not executable authority. A connected read requires a
current consent record and a process-private runtime capability. Its durable
checkpoint follows the closed `prepared` → `requesting` → `materialized` →
`committed` lifecycle, with explicit `absent` and `uncertain` terminals. Normal
Assignment submission must first produce the accepted Artifact and Event chain;
the existing `operate-artifact` resolver then materializes the EvidenceRef.
Measurement plans, schedules, observations, evaluations, and learning receipts
bind those existing records and wrap the canonical Outcome and Learning truth;
they never create a parallel truth store or infer authority from a digest.

Governed landing is a Protocol 1.2 companion described by
`landing-operation-registry`, `landing-plan`, `landing-confirmation`,
`landing-event`, `landing-phase-receipt`, and `landing-receipt`. It consumes an
authoritatively verified Protocol 1.1 PASS SHIP receipt and compatibility
projection. Portable validity grants no landing authority: each effect phase
requires its own unchanged, owner-confirmed docket, and execution/recovery is
recorded as a closed hash-chained journal with immutable phase receipts.

### Evidence-backed operating intelligence

An operating Delta is a deterministic comparison of one accepted immutable
Snapshot/state pair with its exact predecessor. It reports source revisions,
observations, stale or conflicting evidence, invalidated Assumptions, exposed
Risks, and Decisions whose durable revisit conditions have been met. Risk and
Assumption changes come from the two bound immutable operating-model-state
collections, rather than a mutable side ledger. Distinct supporting and
contradicting EvidenceRefs are surfaced as an explicit, sorted conflict set;
using the same EvidenceRef on both sides remains invalid. An empty comparison
is reported explicitly as `no-material-change`; no model or hidden heuristic
is consulted.

Claims, observations, Risks, Assumptions, and Decision revisions are
append-only runtime facts. Every fact Event binds both `snapshotId` and
`stateId`, and those bindings are part of the canonical request hash and replay
identity. A fact must name a source Artifact declared by that Snapshot. The
runtime and public builders select only EvidenceRefs declared by that exact
Snapshot; unrelated global registry entries are ignored, while every cited ref
outside that selection is rejected. Each selected EvidenceRef resolves to its
exact typed `evidence-snapshot` Artifact (including its raw and canonical
hashes) derived from its accepted source Artifact. A fact—and each Scenario
case—may cite only EvidenceRefs from its own `sourceArtifactId`; dangling,
ambient, foreign-source, or hash-mismatched references fail before a state
mutation.

Risks and Assumptions carry required `revisionId`, `revision`, and
`predecessorRevisionId` fields. The first revision has an explicit `null`
predecessor; every successor has a new immutable record/revision identity,
names the unique current leaf, increments its revision once, preserves its
immutable scope, statement, and creation timestamp, and makes only a legal
lifecycle transition. A new Event cannot reuse an existing Risk or Assumption
identity, and a predecessor cannot fork. Prior revisions remain durable and
auditable. A Decision revision retains its own predecessor/history property.

Scenario and Trigger records are analytical inputs only. A Trigger can request
ordinary observation or cycle work, but it never schedules, assigns, approves,
authorizes, executes, or grants a capability. Runtime-issued intelligence
Events carry a canonical request hash, making reuse of an Event identity with
different request, Snapshot/state binding, or draft content fail closed.
Events, state, and error contexts retain safe identifiers and hashes—not raw
Artifact bytes.

### Explainable intelligence-board planning

`planOperatingIntelligenceBoardV2()` is a pure domain-aware router. Its complete
input is one validated Delta, its immutable Snapshot, canonical focus IDs, an
exact public domain descriptor, the Cycle ID, the human Decision owner, and an
explicit timestamp. It returns one immutable `operating-intelligence-plan`,
ordinary pending executive Advisor/Challenger/Chair Assignment intents, and a
stable routing hash. Equal canonical inputs produce equal role selection,
omissions, reasons, versions, Artifact inputs, output contracts, dependencies,
challenger requirement, bounded scenario request, and Decision ownership.

The full business board is five independent executive Advisors, then
Challenger, then Chair. A scoped route may select fewer lenses only by recording
each omitted role as typed absence. Every selected Advisor feeds Challenger;
every selected Advisor plus the selected or explicitly absent Challenger feeds
Chair. No selected role may be hidden or silently unavailable. Chair stays
pending until each dependency has a validated Artifact or a typed terminal
absence explicitly permitted by the declared dependency policy. The Scheduler
derives the complete ordered `inputAbsences` custody and validates that the
persisted plan and deterministic ordinary Assignment identities still match
exactly before every availability derivation.

Every intelligence Assignment contains a closed `intelligenceContext` with the
exact plan, Snapshot, scope/domain/version, source Artifact set, allowed
EvidenceRef set, and Decision owner needed to construct its advertised DTO.
These owner-issued values contain no private paths, locators, or actor claims.
Pre-plan evidence/manifest capture uses the truthful non-intelligence
`context-capture` Assignment kind and exact `operating-context-capture` output;
it is never disguised as executive advice.

A validated dependency proof is the complete durable binding, not Artifact-ID
presence. The accepted Submission, referenced Artifact, dependency Assignment,
and Cycle must be valid and agree on Assignment, Cycle, Artifact identity,
exact raw hash, canonical hash, byte size, and output contract. The Artifact's
byte size cannot exceed the Assignment maximum, every immutable input must be
declared by the Assignment, and its producer actor, runtime, and role must match
the Assignment's retained claim and role. The complete Submission must equal its
durable replay-index entry, including acceptance Events and response data. A
foreign Artifact or any Assignment, Cycle, claim, contract, hash, or replay
mismatch fails before acceptance, restart, or downstream release can mutate the
runtime projection.

`planOperatingRuntimeIntelligenceBoardV2()` atomically records that plan and
its pending Assignment graph, then invokes only the deterministic Scheduler.
An exact retry returns the durable plan and Assignments without appending an
Event. A partial or divergent reuse fails closed. Neither function loads or
dispatches an agent, model, tool, provider, or source; creates a capability,
policy, approval, decision, or Action; reads Artifact bytes; invokes a
connector; or causes an external effect.

### Challenged decision-ledger materialization

`materializeOperatingDecisionLedgerV2()` is a runtime-only, deterministic
transaction over already accepted Advisor, Challenger, and Chair Artifacts. It
reads each local byte payload only through the immutable Artifact byte store,
verifies that the canonical JSON matches the accepted Artifact hash, and never
places raw bytes in Events, projections, or error contexts. The resulting
`operating-decision-ledger` preserves the Chair’s material evidence,
alternatives, confidence, assumptions, upside/downside, uncertainty,
reversibility, dissent, owner, and revisit conditions. The runtime derives
append-only `operating-decision` revisions from that ledger; neither caller nor
Chair supplies their durable revision identities.

Advisor and Challenger submissions use the closed
`operating-advisor-result@2.0.0` and
`operating-challenger-review@2.0.0` contracts; Chair uses
`operating-decision-ledger@2.0.0`. All role Artifacts must bind exactly to the recorded intelligence plan, role,
scope/domain, Snapshot, declared input Artifacts, output contract, accepted
Submission/replay proof, and producer claim. A required Challenger cannot be
omitted. The Challenger must independently identify a claim, account for every
Advisor claim, and preserve disjoint supporting/contradicting current Evidence.
The Chair must copy its issued `inputAbsences` byte-for-byte and in order,
retain that material Evidence, every material alternative, the exact issued
Decision owner, and explicit Challenger dissent. Role-local claim and ledger
identities are deterministically derived from the issued Assignment ID.
Submission validates these schemas and their references against trusted
predecessor bytes before `assignment.validated`, so copied claims, foreign
assumptions, suppressed conflicts or
alternatives, missing evidence/provenance, incomplete materialization identity,
or divergent replay reject before state mutation.

The ledger may contain typed Action hypotheses solely as explanatory data. This
transaction creates no durable `operating-action`, Assignment, approval, policy,
provider call, execution, or external effect; durable Action materialization is
an explicitly separate runtime boundary.

### Bounded Action verification

`materializeOperatingActionVerificationV2()` is the separate runtime-only
boundary that turns a complete Action hypothesis from an already validated,
byte-proven Chair ledger into a proposed `operating-action` and its
`operating-action-verification-plan` in one replay-safe transaction. The
runtime derives both identities; a caller cannot supply or alter either record.
It rechecks the exact Chair bytes, immutable Snapshot/state, runtime-derived
source Decision, Objective, Metric, and source Findings before it appends the
records.

Every material Action has a trimmed title, Objective, accountable owner or an
explicit unowned/blocking disposition, expected result, source Decision and
Findings, dependencies, typed metric baseline and target, a verification
window, and a verification method. It is distinct from an Assignment and
contains no Assignment ID, operation identity, executable capability, approval,
policy state, executor, connector, or external-effect field.

The byte-proven Chair hypothesis must state its canonical
`dependsOnActionIds` (including an explicit empty list) and a trimmed
`verificationMethod`. The runtime does not default either value: it carries
the exact dependency IDs into the Action and the exact method into the paired
verification plan. Missing, malformed, non-canonical, or unavailable
dependency IDs reject before either record is materialized.

The paired verification plan is a future, read-only observation/analysis
request. It declares success, failure, blocked, cancelled, and
insufficient-evidence evaluation rules plus its Decision revisit targets. The
bounded runtime currently accepts one typed metric observation and deterministically
records only a succeeded or failed `operating-outcome` and one
`operating-learning`; the other declared rule outcomes remain future accepted
analysis inputs. Neither result asserts or implies that the Action was approved,
queued, executed, retried, rolled back, or cancelled.

`recordOperatingActionVerificationOutcomeV2()` validates the Action, plan,
source Decision, current Snapshot/state, accepted observation Artifact, and
EvidenceRefs before atomically appending that Outcome/Learning pair. The
Learning may revisit only the Action's source Decision and its retained
Assumptions. A later Delta therefore surfaces the Learning's decision ID as a
revisit target. Stale or foreign evidence, a missing Decision, malformed metric,
duplicate identity, divergent replay, or any Action-to-Assignment coercion
rejects before a projection mutation.

An acknowledgement lost after the atomic Outcome/Learning append is a normal
replay: the same canonical request and runtime Event identities return the
durable pair without another mutation. A changed request or partial identity
reuse fails closed; duplicate-plan checks run only after this replay lookup.

### Compiler-owned role mandates

The current bounded mandates are declarative templates, not dynamic extension
registration. A caller resolves one with an explicit role version through
`loadOperateRoleMandate()` and validates its exact advertised output template
with `assertOperateRoleOutputContract()` before creating the Assignment that the
normal submit-time validator receives.

| Role | Version | Output schema | Media type | Maximum bytes | Proposal limit | Action limit |
|---|---:|---|---|---:|---:|---:|
| `advisor` | `2.0.0` | `operating-advisor-result@2.0.0` | `application/json` | 262144 | 1 | 0 |
| `chair` | `2.0.0` | `operating-decision-ledger@2.0.0` | `application/json` | 262144 | 1 | 0 |
| `challenger` | `2.0.0` | `operating-challenger-review@2.0.0` | `application/json` | 262144 | 1 | 0 |

The template is explicit because the runtime accepts only the Assignment's
disclosed schema identity, encoding, media type, and byte ceiling at submit
time. Domain/role registration and any broader role catalog remain separate,
authority-free declarations; this document defines no generic integration, executor, or
approval contract.

### Agentic business executive board

The first Operate product release must retain the business executive-board
mechanism. The kernel role kinds remain `advisor`, `challenger`, and `chair`,
but the business domain must own multiple stable role identities:

| Business role ID | Product label | Kernel role kind |
|---|---|---|
| `strategy-finance` | CEO | `advisor` |
| `technology-risk` | CTO | `advisor` |
| `product-activation` | CPO | `advisor` |
| `growth-market` | CMO | `advisor` |
| `operations-customer` | COO | `advisor` |
| `independent-challenge` | Challenger | `challenger` |
| `chair` | Chair | `chair` |

`roleId` is the domain-owned identity; `roleKind` is the kernel scheduling
archetype; the product label is presentation only. A full business Cycle
releases the five executive advisors independently, then challenges their
terminal accepted Artifacts, then releases Chair synthesis. A deliberately
scoped routing policy may select fewer advisors only when every omitted lens is
represented by typed absence. Missing work is never synthesized.

There is no separate CFO role in this contract. Finance belongs to the CEO's
`strategy-finance` mandate until a later versioned product decision says
otherwise. The kernel must not hard-code any executive title.

Every domain role also carries a versioned `analysisRubric` beside its output
mandate: `requiredQuestions`, `requiredEvidence`, `failureModes`,
`artifactQualityBar`, and `outOfScope`. The mandate states what a seat covers;
the rubric states how it reasons, and `outOfScope` is how neighbouring seats stay
distinct. A registration whose role omits a rubric registers no domain and
issues no Assignment. An issued Assignment carries the rubric of the
`roleVersion` its Cycle bound, so a seat receives its reasoning contract as data
rather than as skill prompt text. Rewording a bound rubric is a `roleVersion`
change, not an edit.

The registry is the sole hand-authored mandate/rubric source. The catalog,
appendix, and current seven `planr-ceo-review` through `planr-chair-review` lenses are
compiler-generated from it. Each executor accepts the adapter-issued
Assignment ID, stable actor ID, and registered runtime; claims the exact
Assignment; reads only issued Artifact inputs; constructs the role-specific
DTO; submits once; and returns the accepted Artifact identity. Only the parent
`operate` skill starts or resumes a Cycle.

## Narrow public registrations

The catalog exposes `operate-domain-registration` and `agent-runtime-manifest`.
The evidence family adds `operate-evidence-provider-registration` and
`operate-evidence-resolver-registration`. They are versioned declarations, validated by the
compiler-owned catalog and discoverable only by their exact ID and version. The
open reference records name public package provenance, fixed supported contract
identities, requested capabilities, bounded limits, conformance health, and an
explicit fallback result.

Registration is read-only declaration: it does not load an implementation,
contact a network service, grant a capability, approve an effect, add a core
transition, or accept output outside the existing Assignment, Artifact, Event,
and validator boundaries. An unavailable runtime resolves only to its declared
exact fallback or an explicit unavailable result.

Evidence registration is limited to the four local kinds described below.
`operate/evidence-v2` accepts JSON-only declarations for those exact built-ins,
requires exact provider/resolver versions, validates their contract/effect/
classification/retention/provenance/fallback fields, and checks the caller's
scope binding plus required local read capability before dispatch. Registration
data cannot name a function, path, module, URL, plugin, external service, or
non-public implementation. The dispatch table is closed: Git, filesystem, Planr,
and Operate Artifact have only their static, local, read-only resolver paths.
An absent registered source configuration returns its declared structured
unavailable result; there is no discovery, code loading, authority grant,
Artifact/Event write, or fallback to a connected provider.

The operating-intelligence family adds exact data-only registration identities for Snapshot, Metric, and
Verification providers. They are declaration contracts only: a provider names
only public contract inputs/outputs, a fixed public domain-contract binding,
the `candidate` return semantics, and an explicit unavailable fallback. It
cannot name code, a path, module, URL, connector, credential, capability,
policy, approval, executor, or external effect.

`createOperateExtensionRegistryV2()` admits the two exact public registrations
`business-domain@1.0.0` and `software-domain@1.0.0`. Their API bindings are
literal data: `business` maps to `business-domain@1.0.0`, and `software` maps
to `software-domain@1.0.0`; neither is derived from a string convention. A
test-only `synthetic-domain` can be enabled explicitly for conformance, but it
has the same data-only validation and receives no provider, capability, or
authority.

`canonicalizeOperateExtensionRegistryV2()` is the consumer-boundary form: it
requires all ten registry fields and reruns the same data-only validation.
Public projection and signal-provider facades use it before lookup, so a
partial or authority-bearing registry-shaped object cannot acquire defaults or
participate in selection.

`projectPublicOperatingDomainV2()` is a pure facade. It validates the exact
registered binding, immutable operating state/snapshot pair, and the full set
of referenced Artifact descriptors before returning the corresponding public
projection descriptor. It does not read raw bytes, mutate state, load code, or
assume fields from the other domain. The three reference signal helpers select
only the named built-ins and return validated Snapshot, Metric-observation, or
Outcome candidates through the normal Artifact/Event boundary. A Verification
candidate must declare exactly the Action plan's accepted Chair Artifact and
the Outcome's accepted observation Artifact; it does not fetch either source or
evaluate the plan. Selection and candidate validation never contact a source,
invoke a model, grant a capability, create an operation identity, approve work,
or execute an Action.

## Operating intelligence contracts

This contract family defines a domain-neutral operating model without creating a second
runtime, dispatching a model or tool, or authorizing a business action. Its
state holds objectives, metrics, findings, decisions, actions, risks, and
assumptions. Claims, observations, snapshots, deltas, intelligence plans,
challenged decision ledgers, action-verification plans, outcomes, learnings,
scenarios, and event triggers remain typed records linked by public IDs and
EvidenceRefs; raw evidence bytes and implementation-specific data are excluded.

The two public projection identities are exactly
`business-operating-snapshot-projection@1.0.0` and
`software-operating-snapshot-projection@1.0.0`. API `domainId` is never
converted by string convention: `business` explicitly maps to
`business-domain@1.0.0` and `software` explicitly maps to
`software-domain@1.0.0`, both in schemas and the canonical registry.

The contract family permits candidate analysis and future-observation requests
only. It does not define a policy engine, approval, executor, connector,
capability grant, dynamic provider, or external-effect operation. The
mechanics that materialize or reduce these records are introduced by their
own runtime tasks; this contract boundary intentionally remains portable and
release-free.

## Operating state and snapshots

`materializeOperatingStateSnapshotV2()` is the sole runtime-owned transaction
that writes an `operating-snapshot` and its `operating-model-state`. It accepts
only an existing Cycle binding, accepted v2 Artifact provenance, typed
EvidenceRefs, and a public domain-contract binding. Before it emits either
Event, it reads and revalidates the exact immutable Artifact bytes through the
machine-local byte-store boundary. The resulting `snapshot.materialized` and
`operating-state.materialized` Events are one ordered transaction: a failed
validation exposes neither durable record.

An operating-model state has exactly seven base collections: objectives,
metrics, findings, decisions, actions, risks, and assumptions. It is a
domain-neutral immutable projection, not a provider response or a mutable
working store. Snapshot and state identities, JCS/SHA-256 runtime hashes,
scope binding, source/revision descriptors, and the prior same-scope snapshot
link are deterministic. An exact retry recognizes the existing two-Event
transaction and returns it effect-free; a divergent identity, Event, source,
evidence, or scope binding fails closed. Restart rebuild reduces the durable
Event tail without model or provider dispatch.

State, snapshots, Events, errors, and public return values retain only IDs,
hashes, classifications, and other safe metadata. Raw Artifact bytes, resolver
captures, credentials, provider responses, model calls, and local paths remain
outside those records in the opaque byte store.

## Typed evidence contract family

The evidence contract family defines a compiler-owned, v2-only evidence boundary. A normal agent
may place an `operating-evidence-candidate` inside an already accepted result
Artifact, but cannot create an EvidenceRef, Artifact, Event, graph edge, or
authority. The runtime is the sole resolver. It validates the accepted source
Artifact and Cycle input binding, dispatches exactly one explicit built-in
resolver, then atomically records either an immutable `evidence-snapshot`,
runtime-issued EvidenceRef, and `evidence.resolved` Event or a safe
`evidence.rejected` Event. The identity/candidate/source binding/registered
resolver/captured outcome fingerprint is durable: an identical retry replays
without a duplicate effect, while divergent reuse fails before mutation.

Before a first resolution, the runtime reads the accepted source Artifact's
exact raw bytes from its machine-local Artifact byte store and requires a UTF-8
JSON evidence declaration of this form:

```json
{
  "evidenceCandidates": [{ "candidateId": "evc_...", "...": "typed candidate fields" }],
  "evidenceClaimLinks": [{ "candidateId": "evc_...", "sourceArtifactId": "art_...", "localClaimId": "...", "relation": "supportedBy", "confidence": 0.8 }]
}
```

The external candidate and optional proof-link request must semantically equal
that validated body; they never become trusted caller assertions. The runtime
computes the replay fingerprint before an Artifact-store or resolver read, so
an exact retry returns the recorded result even if a filesystem source changes
later. A divergent reuse fails before either read can occur.

The only shipped local source kinds are `git`, `filesystem`, `planr`, and
`operate-artifact`. Each candidate/ref is scope-, domain-, version-, source
Artifact-, provider-, and resolver-bound. Generic strings, URLs, untyped
paths, implicit versions, dynamic module/function declarations, connected
providers, and legacy citations are invalid.

An `operating-evidence-ref` binds to exactly one immutable
`evidence-snapshot` Artifact identity and its raw/canonical hash metadata.
`operating-evidence-resolution` reports either that ref or a finite, safe
error reason. The reasons distinguish source, revision, object type, path,
range, ancestry, hash, untracked Planr content, freshness, capability,
consent, sensitivity, secret, unsupported-kind, resolver, scope, and locator
failures without exposing raw bytes, secrets, or machine paths.

`operating-evidence-edge` is deliberately a small proof surface: a
source-Artifact-local `localClaimId` may connect to a resolved EvidenceRef
only as `supportedBy` or `contradictedBy`. `operating-evidence-graph` is a
read-only, rebuildable scope/domain projection of those refs and edges. It is
not a durable Claim store, Finding/Decision/Action mutation path, Operating
State, policy, approval, executor, or external-effect API.

This contract slice contains no v1 citation reader, translator, migrator,
compatibility fixture, support window, dynamic plugin loader, remote source,
or unpublished external dependency. Local resolvers still cannot materialize
an EvidenceRef, Artifact, Event, replay record, or graph edge; only the
bounded runtime transaction may do so. Its optional proof proposals are
limited to a source-Artifact-local `localClaimId` plus `supportedBy` or
`contradictedBy`; the transaction derives the edge ID, creator, timestamp,
and conservative classification. This does not create a durable Claim,
Finding, Decision, Action, Operating State, approval, policy, executor, or
connected effect.

Resolver captures that contain `contentBase64` are decoded, byte-counted, and
SHA-256-verified before the resolution result is returned. They are staged in
the opaque runtime Artifact byte store under the new `evidence-snapshot`
Artifact ID and raw hash in the same transaction as the Event/projection
result. Raw bytes are retrievable only through the Artifact byte-store/read
boundary; they are never embedded in an Event, checkpoint, graph projection,
or safe error context. Metadata-only Operate Artifact references reuse the
already accepted Artifact's exact stored bytes under the snapshot identity
without opening a second acceptance route.

### Planr and accepted Artifact resolver semantics

The Planr resolver reads only a configured project root, declared `.planr/`
artifact identity/type/location, matching scope binding, and exact declared
SHA-256. It does not call Git. A valid untracked Planr artifact therefore
remains Planr evidence; an attempt to dispatch it through a Git provider or
resolver fails as a kind mismatch rather than inventing a tracked source path.

The Operate Artifact resolver reads no Artifact bytes. It accepts only a
host-supplied record already marked accepted whose `operating-artifact@2.0.0`
metadata validates and whose scope/domain/type/schema/version/raw hash (and
requested canonical hash) match the candidate. It checks both the resolver
capability and the record's explicit access declaration, then returns an
immutable reference preserving the Artifact ID, raw/canonical hashes,
sensitivity, retention class, and machine-local storage fact. It never creates
another acceptance route or a mutable content alias.

## Bounded public vocabulary

Protocol 2.0 ships one closed vocabulary. Phase 6 extends the certified Phase 5
surface in place; the lists below are exhaustive rather than historical subsets.

Cycle states:

```text
created | observing | advising | challenging | synthesizing | awaiting_review
approved | executing | verifying | closed | blocked | failed | cancelled
```

Assignment kinds:

```text
context-capture | advisor | challenger | chair | execution | verification
```

Assignment states and legal transitions:

```text
pending   → available
available → claimed | abandoned
claimed   → running | abandoned
running   → submitted | abandoned | failed
submitted → validated | rejected | failed
rejected  → running
validated | abandoned | failed → terminal
```

The only trigger is `manual`. The public tools are:

```text
operate.cycle.start
operate.cycle.get
operate.cycle.resume
operate.assignment.claim
operate.assignment.submit
operate.artifact.get
operate.review.get
operate.review.submit
operate.action.approve
operate.action.execute
operate.action.rollback
```

The exact effect classification vocabulary is `read-only`,
`machine-local-write`, `project-write`, `provider-call`, `external-effect`, and
`destructive`; classification never grants authority. Governed provider and
executor registrations are valid only through their closed data-only Protocol
2.0 schemas. Dynamic roles, recurring cadence, unregistered cross-cycle
dependencies, executable module paths, and generic untyped domain input remain
invalid. Unknown enum values and placeholder tokens are rejected, not retained
for later interpretation.

## Guard and action equivalence

`OPERATE_GUARD_TABLE_V2` is the sole authorization and allowed-action source.
Each row owns one tool's guard, exact typed arguments, effect, and label.
`deriveOperateAllowedActionsV2()` emits an action only when the same row permits
it and its complete arguments validate against `operate-allowed-action`.
`assertOperateAuthorizedV2()` evaluates that row again immediately before use.
For the four governed operations, guard evaluation and assertion return the
canonical discriminated authorization decision rather than erasing replay
metadata; a replay retains its durable `replayResultId` through both APIs.

Possession of a cycle, Assignment, submission, or Artifact ID is not authority.
Capabilities, current state, runtime-issued identities, media type, encoding,
and byte ceiling are revalidated for the requested effect. Cross-cycle and
cross-Assignment submission identities fail with a stable error and produce no
allowed submit action.

`operate.cycle.start` requires an explicit human `ownerActorId`; its optional
delivery route is one of the declared delivery-route values and omission means
the adapter's canonical observe-only default. `operate.assignment.claim`
returns the complete now-running Assignment, one runtime-issued Submission ID,
and a positive capability list—never private state, reserved result IDs, or a
browser-authored mandate. `operate.assignment.submit` requires the exact actor
ID, kind, and runtime retained by that claim and rejects a missing, stale,
terminal, foreign, or substituted claimant before staging bytes or appending an
Event.

`operate.artifact.get` is equally bound to actor, exact scope/domain/version,
and nullable Assignment identity. An agent must hold a running Assignment
claimed by that actor and may read only an Artifact in its issued input set. A
human read requires explicit adapter-owned scope membership. Both the Artifact
and any supplied Assignment must validate as closed protocol records before the
guard can authorize a read.

## Cycle-scoped Review

A Review is a small, cycle-scoped human checkpoint, not persistent operating
work. A runtime-created pending Review is attached only to a cycle in
`awaiting_review`. An advisor may inspect it. Its named human owner may submit
exactly one compiled disposition: `approved`, `changes_requested`, `rejected`,
or `cancelled`. An approved Review is the sole normal successful-close path:
it must contain one explicit lawful disposition for every unresolved work item
created by the Cycle and every carried item it touches. The runtime applies
those human dispositions and transitions the eligible Cycle to `closed` as one
pure Event reduction; a failed validation exposes neither partial work changes
nor a partial Cycle close. `cancelled` always means abandonment and never
success. There is no `operate.cycle.close`, `finalize`, general approval engine,
or agent-facing persistent-work write operation.

## Persistent operating work

The persistent-work contract family defines `operating-finding`,
`operating-decision`, and `operating-action` records plus the
`operating-work-ledger` projection contract. Persistent work is not an agent
tool and cannot be created with a caller-selected durable identity.

`operating-work-change-set` remains a readable compatibility contract from the
earlier Phase 3 design. No current intelligence Assignment advertises it:
Advisor, Challenger, and Chair now have exact role-kind output contracts, and
Chair emits `operating-decision-ledger`. The retained
`materializeValidatedOperatingWorkV2()` compatibility boundary therefore fails
closed for a current Chair Artifact; adapters must not forge legacy Artifact
metadata to reach it. Its pure payload builder remains available for validating
historical work-change-set bytes without granting a normal-agent write path.

Current persistent work is created through
`materializeOperatingDecisionLedgerV2()` and the separate bounded Action
materialization described above. Those transactions verify accepted bytes,
immutable Cycle and scope/domain custody, provenance, references, and replay
before exposing a replacement state. They remain runtime-internal boundaries,
not additional allowed actions, approval mechanisms, or execution surfaces.
Rebuildable global and Cycle projections remain a separate runtime
responsibility; policy, approval, execution, recovery, and verification stay
under their dedicated Protocol 2.0 contracts.

## Rebuildable work views

`buildOperatingWorkLedgerV2()` derives a scope- and domain-bound ledger from a
validated runtime checkpoint. `buildOperatingCycleWorkViewV2()` selects the
same ledger records for one Cycle and exposes only `source`, `touched`, and
`carried-forward` links. Later Cycles therefore retain prior work without
copying, deleting, or taking mutable ownership of it. The Cycle read envelope
contains this read-only ledger/view data; no projection is a command, policy,
executor, or historical conversion path.

## Deterministic dependency scheduling

Availability is a runtime-owned consequence of the compiled dependency-policy
algebra, never a normal caller operation. A policy is either `none`,
`all-required`, or a structured `threshold` with an explicit minimum and a
closed list of permitted terminal outcomes. One-of is a threshold of one.

Before a scheduler transaction reduces any source Event, it rejects duplicate,
unknown, cross-cycle, self-referential, cyclic, or cardinality-invalid graphs.
It evaluates pending Assignments in Assignment-ID order and creates at most one
`assignment.available` Event per ready Assignment. Each Event carries the
runtime-owned release identity plus proof for every qualifying dependency: an
accepted Artifact ID and validation Event for a validated dependency, or a
named typed absence/recovery proof for a terminal outcome explicitly allowed
by the policy. Missing work never becomes a conclusion.

`scheduleOperatingRuntimeEventsV2()` atomically reduces creation or qualifying
terminal source Events with the complete release batch. The direct-submit
transaction uses the same path. Its acceptance draft and public response
contain no caller-selected release targets; exact-byte/replay rules remain
unchanged. An identical retry contributes no second availability Event.

## Durable bindings and replay

A cycle binds its scope, domain version, immutable input binding, output
contract versions, and selected runtime. `assertOperateRuntimeBindingsV2()`
checks those fields plus Assignment/submission identities and the checkpoint's
event head in a deterministic order. A mismatch returns only the safe field
name and expected/actual binding values.

Events are append-only, contiguously sequenced, previous-hash linked, and
RFC 8785 JCS/SHA-256 verified. `reduceOperatingRuntimeEventsV2()` validates the
tail before reduction and accepts an explicit prior runtime state for
checkpoint-plus-tail recovery. `createNoModelReplayHookV2()` proves replay
performs no model or runtime dispatch.

An accepted submission records its raw hash, exact size, Artifact identity,
acceptance event IDs, and response in `submissionReplayIndex`. Intelligence
replay also binds every non-lifecycle intent field, including role version,
mandate, rubric, output contract, dependency policy, and
`intelligenceContext`. Expanded Artifact inputs and `inputAbsences` are
recomputed from durable dependency Events. An exact late replay therefore
succeeds after legitimate scheduler expansion, while extra, missing, foreign,
or reordered custody and any role/rubric substitution fail closed.

## Exact-byte Artifact contract

The Artifact contract separates bytes from metadata. Raw bytes are represented
at the tool boundary as base64 with an exact decoded byte count and SHA-256
`rawHash`. Metadata, raw, and canonical reads are separately requested
representations. A metadata response cannot carry content bytes.

The portable runtime validates identity, declared media type and encoding,
maximum bytes, output schema reference, sensitivity, producer, inputs, and
hashes. Machine-local blob persistence and transactional storage are consumer
responsibilities and must retain these identities exactly. The runtime exposes
an `OperatingArtifactByteStoreV2` boundary with `stageRaw({ artifact,
rawBytes })` and `readRaw({ artifactId, rawHash })`; production adapters make
those calls part of their Artifact/Event transaction. The reference store and
read helper verify the requested identity, byte count, and raw hash on every
write/read without serializing the bytes into runtime state.

## Phase 6 governed-execution contracts

Protocol 2.0 defines thirteen additional closed contracts for policy,
approval, capability availability, runtime-issued grants, governed operations,
execution results, rollback plans/results, and the three data-only registration
families. The contracts alone grant no authority and provide no effects runtime.

The exact identities are `operating-action-policy`,
`operating-policy-evaluation`, `operating-approval-requirement`,
`operating-approval-record`, `operating-capability-availability`,
`operating-capability-grant`, `operating-governed-operation`,
`operating-execution-result`, `operating-rollback-plan`,
`operating-rollback-result`, `operate-capability-provider-registration`,
`operate-policy-provider-registration`, and `operate-executor-registration`.

An Action may carry one complete execution binding: exact Action revision and
hash, action kind, requested capability, revision-bound target, effect class,
precondition Artifact identities, policy identity, rollback requirement, and
verification requirement. Supplying any execution field requires the complete
binding. Review can identify either a Cycle or one exact Action revision, and
Assignment admits the separately governed `execution` and `verification`
kinds without changing the Phase 1 Advisor/Challenger/Chair mandates.

The policy outcomes are exactly `automatic`, `named-single-party`,
`named-multi-party`, `threshold`, `deferred`, `rejected`, and `prohibited`.
The effect classifications are exactly `read-only`, `machine-local-write`,
`project-write`, `provider-call`, `external-effect`, and `destructive`.
Classification is descriptive and never grants authority. Provider and
executor registrations cannot advertise `destructive`; their schemas are
closed data records with classified implementation sources and an explicit
`unavailable` fallback. Each frozen registration declares supported Action
kinds; exact input, output, rollback, and error contracts; its bounded error
vocabulary; timeout and retry behavior; runtime-fingerprint idempotency;
reconciliation and health behavior; protocol/runtime compatibility; public
provenance; and a fail-closed fallback. Registrations remain data only: no
module path, function, URL, credential, discovery, or implicit default is an
implementation declaration.

Reconciliation declarations are coherent pairs only: `supported: false` binds
`mode: none`, while `supported: true` binds `mode: deterministic`. Mixed pairs
are rejected rather than interpreted as a fallback.

Policy authority has an immutable tier: `core` precedence 300 establishes
prohibitions, `project` precedence 200 may narrow them, and `domain`
precedence 100 may narrow them again. The tier fixes both precedence and
whether narrowing is required; a provider cannot raise its own authority with
a caller-controlled integer. Approval requirements and records bind the exact
policy evaluation, Action revision, scope/domain, capability, revision-bound
target, effect, named party, actor kind and actor approval capability.

`operate.action.approve`, `operate.action.execute`, and
`operate.action.rollback` accept only exact Action identity plus the operation
references required by rollback. They do not accept policy decisions, Approval sets,
CapabilityGrants, executor/connector selection, credentials, leases, caller
idempotency keys, request fingerprints, or caller-minted operation identities.
The runtime derives the request fingerprint internally. A returned
`operationId` is durable runtime-issued state. The Event, runtime-state,
checkpoint, and Artifact schemas can retain the immutable authority and
operation history as IDs, revisions, and hashes without raw effect bytes,
credentials, or machine-private paths.

A governed operation binds its runtime-derived fingerprint to the complete
evaluation, approvals, grant, capability, target, effect, executor/connector,
input and precondition Artifacts, verification plan, and rollback class.
Execute and rollback operation shapes are mutually closed. Execution and
rollback results repeat that exact authority chain and add target-before/after
hashes, captured baseline identity, input/output Artifacts, effect summary,
verification identity, and Event identities. The low-to-high effect order is
`read-only`, `machine-local-write`, `project-write`, `provider-call`,
`external-effect`, `destructive`.

Every Phase 6 Action/Cycle lifecycle transition declared by the canonical
registry has a strict Event payload containing the exact `from`/`to` states
and required Action, operation, result, and reason bindings. This includes
queued/in-progress cancellation, blocked-to-queued/in-progress recovery, and
the Cycle `approved`-to-`verifying`/`closed` skip paths. Historical Phase
5 runtime state remains readable only when it has no Phase 6 authority slices;
once any authority slice appears, all authority-history arrays plus the
operation replay index are required atomically. Checkpoints likewise carry
the operation-replay and authority-history hashes together or omit both.

### Integrated execution and verification lifecycle

`planr-pipeline/operate/execution-verification-v2` keeps effect truth and
hypothesis truth separate. An approved Action follows
`approved → queued → in_progress → completed | blocked | cancelled`; only a
blocked Action can re-enter execution, and its Event must retain the prior
result plus an explicit recovery reason. Completed and cancelled Actions have
no reopening edge. A Cycle follows
`awaiting_review → approved → executing → verifying → closed`; the existing
registry skip edges remain explicit reason-bearing Events rather than hidden
state changes.

When a terminal execution result is recorded for a Phase 5 Action plan, the
same durable transaction appends the exact Action/Cycle transition Events and
creates one deterministic `verification` Assignment owned by that operation
and the existing `operating-action-verification-plan`. Rollback retains its
own result and verification Assignment. The closed execution vocabulary is
`success`, `failure`, `blocked`, `uncertain`, `partial`, `cancelled`, and
`rolled-back`. These values never claim that the Action hypothesis succeeded.

The Action, source Cycle, and verification plan must carry the same exact
`scopeId`, `domainId`, and `domainVersion` at direct construction, Event
reduction, checkpoint loading, replay, projection, and closure. Verification
Assignment lookup derives the expected identity and complete canonical record
from the Action/Cycle/plan/operation/result set; it never selects the first
candidate or parses ownership from objective text. Missing, forged, duplicate,
foreign-scope, or order-dependent candidates fail closed.

An accepted metric observation remains the only normal source of the atomic
`operating-outcome`/`operating-learning` pair. The derived hypothesis status is
independently `pending`, `confirmed`, `failed`, `blocked`, `cancelled`, or
`revisit`, with exact Outcome, Learning, Delta, Snapshot, observation,
EvidenceRef, and source-Artifact provenance. A later immutable Snapshot/Delta
may revisit the source Decision without changing execution history. Explicitly
carried blocked/deferred Actions remain persistent work after their source
Cycle closes.

Lifecycle and verification identities are deterministic consequences of the
operation/result pair. Exact replay returns the durable checkpoint with no new
Events, Assignments, dispatches, provider/model calls, connector/target access,
or effects; divergent identity reuse fails closed. Run the focused suite with
`npm run test:operate-execution-verification`.

### Versioned policy and approvals

The public `policy-v2` evaluator applies one immutable policy per tier in the
only legal order: `core` (300), `project` (200), then `domain` (100). Input
order cannot change the result. Applicability is derived from the complete
configured runtime `actionPolicies` registry, never from evaluation references
or a caller-selected subset. Every governed Action requires exactly one
applicable core policy; an applicable project or domain policy cannot be
omitted, and multiple matches at one tier fail closed. Each lower tier must preserve or narrow the
higher outcome, target/effect ceiling, rollback requirement, and verification
requirement. The reference
core set prohibits destructive work, funds/payment transfer, secret mutation,
production deploy/merge, publication, customer contact, and credential change;
no lower outcome may weaken or relabel one of those prohibitions. Evaluation
records retain exact applied policy IDs, versions, hashes, deterministic reason
codes, Action authority tuple, provider version, input hash, and evaluation
hash.

The public `approvals-v2` module creates immutable requirement and decision
records bound to the exact Action ID/revision/hash, policy evaluation/version,
scope/domain, capability, target revision, effect, actor identity/capability,
party, decision, issuance, expiry, and consumption rule. Automatic, deferred,
rejected, and prohibited outcomes accept an exact empty approval set. Named
single-party, named all-party, and threshold outcomes require their exact
declared distinct parties; one actor cannot satisfy two parties anywhere in
the complete current evaluation, including across separate requirements. An identical
approval-ID retry is harmless, while divergent reuse fails terminally. Partial,
expired, future, copied, target-drifted, consumed, or prior-evaluation records
never authorize the current Action. Consumption requires the bound requirement
to declare `consumable: true`; non-consumable approvals remain durable authority
records and cannot be rewritten as consumed.

One canonical requirement-integrity assertion owns party and quorum semantics
at construction, checkpoint indexing/replay, record append, quorum evaluation,
and consumption. Named-single means exactly one non-null named party and
threshold one; named-multi means all distinct parties are named and the
threshold equals their count; threshold mode means all eligible parties are
named and `2 <= threshold <= party count`. `namedActorIds` and
`requiredActorKinds` must exactly equal their derived party sets, so a
schema-valid, rehashed wildcard or cardinality forgery still fails closed.

Policy approval IDs are immutable requirement-template identities. Each
evaluation deterministically derives distinct evaluation-scoped requirement
instance IDs. An Action-scoped Review binds one exact Action revision and remains separate
from the Cycle `activeReviewId` gate. Re-evaluation partitions superseded
evaluations, requirements, and approvals into preserved history; it does not
rewrite or erase prior authority. When the same Action is reevaluated, the
runtime materializes new requirement instances from the prior immutable
configuration and appends them alongside every prior evaluation, requirement,
approval, and consumption record. The runtime persists `policy.evaluated` and
`approval.recorded` facts, then materializes exactly the evaluator's complete
`action.approved`, `action.rejected`, or `action.deferred` disposition through
the same canonical authorization boundary. None of these functions registers
or invokes a provider, connector, executor, target, effect, PLAN, or SHIP.

### Canonical authorization engine

The public `authorization-v2` module implements one pure authority decision
function for exact Cycle/Action-subject Review submission, approval, execution,
and rollback. Runtime allowed-action derivation, direct assertions, and refusal
envelopes all call the same evaluator with the same exact request and context;
an operation cannot be advertised through a weaker predicate than the guard
used to accept it.

Governed authority uses exact versioned tool capability identities; wildcard,
bare-operation, and unversioned strings do not authorize these operations:

| Operation | Required tool capability |
|---|---|
| `operate.review.submit` | `operate-review-submit@2.0.0` |
| `operate.action.approve` | `operate-action-approve@2.0.0` |
| `operate.action.execute` | `operate-action-execute@2.0.0` |
| `operate.action.rollback` | `operate-action-rollback@2.0.0` |

Execution and rollback additionally require the engine actor's exact versioned
Action capability, and live authorization requires that actor identity to equal
the runtime issuer recorded by the one-use grant.

Every live Action approve, execute, and rollback decision also requires the
complete configured `actionPolicies` registry and recomputes policy hashes,
applicability, precedence, outcome, reasons, and evaluation bytes. Supplying an
effective policy and coordinated evaluation without that registry, omitting an
applicable higher tier, or deriving applicability from evaluation references is
always `POLICY_EVALUATION_REJECTED`.

The evaluator fails closed across exact Action identity/revision/hash/state and
scope/domain/target; the concrete applicable ActionPolicy and its identity,
hash, tier, precedence, decision mode, capability, target/effect declarations,
approval requirement IDs, provider, rollback, and verification bindings; exact
unique approval requirements, declared parties, and approval records; capability
availability and runtime-issued grants; reviewed inputs and preconditions;
rollback classification; executor health and ceiling; and immutable governed
operation history. Times form one causal proof:
`evaluation <= approval <= grant <= operation <= now`, while availability and
executor checks require `checkedAt <= now < expiresAt`.
Named-single approval has exactly one non-null named party and threshold one.
Named-multi approval requires every declared party to be non-null and named, with
the threshold equal to the exact all-party cardinality. Threshold approval means
at least N distinct valid declared records, up to the declared party count, not
exactly N. Automatic execution and rollback accept no approval requirement or
approval record inputs.

The contained connector registry accepts either a connectorless authority
envelope or one exact host-owned binding beneath the already validated
Executor registration. A non-null connector is never loaded from registration
data: it must equal the closed two-field connector identity held by the exact
built-in host object for the same Executor identity and implementation. A
caller-built host, byte-cloned binding, extended connector, URL, secret, or
self-hashed lookalike carries no host proof and fails closed. The
compiler-owned operation effect remains a hard ceiling, so an Action above
that classification is omitted rather than advertised with a lower effect
label. A connectorless authority decision performs no dispatch by itself.

Execute and rollback replay is recognized only from one complete,
contract-valid terminal governed operation whose immutable envelope exactly
matches the current runtime-issued operation and whose durable result identity
is non-null. Recognition occurs after exact request, actor capability, current
Action identity/scope binding, and proof of the exact durable historical grant.
The grant ID, operation, evaluation, Action, capability, target, effect, and
original issuer must all match; historical expiry or consumption does not
invalidate an idempotent retry only when the grant was live at the original
operation start. Grant expiry must be after that start, consumption may be
atomic with or after it, and revocation must be strictly later. Recognition
remains before live state, policy,
approval, availability, grant currency/usage, precondition, executor, or
rollback checks. Duplicate, partial, non-terminal, resultless, or divergent
history is a conflict. A replay returns `replayResultId` through direct
evaluation, runtime guard evaluation, and runtime assertion, and performs no
effects. Allowed-action derivation may show only the same schema-valid
idempotent retry; re-assertion identifies it as replay-only so no connector,
executor, target, provider, or model seam is called.

The engine projects only its closed authority context and returns a frozen,
canonically hashed discriminated decision: denial always carries a registered
safe error and a null replay result; an accepted terminal replay carries the
durable result identity. Provider/model selection, connector dispatch,
credential access, target reads/writes, and effect callbacks are not authority
inputs and are never invoked by denial or replay. Rejections use registered,
publicly safe error codes. Approval, execution, and rollback remain distinct
operations; no authority can be inferred from proposal text, evidence,
provider availability, model output, or an unbound capability name.

This module does not implement policy-provider business logic, Approval or
grant storage, executor/connector dispatch, target access, effects, or rollback
effects. Those remain separate governed runtime responsibilities.

### Contained governed extensions

`planr-pipeline/operate/governed-extensions-v2` owns deterministic public
discovery for CapabilityProvider, PolicyProvider, and Executor registrations.
Each identity is selected only by its exact package contract version,
Protocol 2.0, a compatible runtime version, an explicit decision time inside
the declared health window, and complete domain, Action-kind, capability,
target, operation, and effect ceilings. Unknown, incompatible, unhealthy, or
insufficient entries return their declared `unavailable` failure. Discovery
never substitutes another provider or executor and registration order cannot
change the selected bytes.

The registry accepts closed `Object.prototype` JSON data only. Duplicate identities,
accessors, functions, custom prototypes, module/path/URL/loader/connector
fields, credentials, private references, inverted compatibility or health
windows, prohibited effect identifiers, and fallback substitution are rejected
before a registry exists. Registration and health do not create, widen, renew,
delegate, or consume a CapabilityGrant; satisfy an approval; weaken policy;
add a lifecycle transition; open a target; or accept an Artifact/Event. The
three shipped provider/executor IDs and implementation IDs are reserved across
every version and registration kind: a registry may use any reserved identity
only when its canonical bytes equal that identity's compiler-owned catalog
declaration, including health, package provenance, contracts, and conformance
data. Effect-ceiling comparison uses a null-prototype, own-known-key rank table;
prototype names and unknown ranks are unavailable for CapabilityProvider,
PolicyProvider, and Executor selection. Every registration string is screened
by the same order-independent, camel/snake/kebab/punctuation-normalized
token, stem, and synonym matcher used for contained inputs.
`OPEN_REFERENCE_OPERATE_GOVERNED_EXTENSION_CATALOG_DIGEST_V2` is the
restart-stable digest of the exact shipped set.
The `0.42.0` built-in declarations use the finite release-validity interval
`2026-08-01T00:00:00Z` through `2027-08-12T00:00:00Z`; selection remains
fail-closed at or beyond expiry, including for otherwise equivalent external
registrations.

The package includes four independently useful references:

- deterministic capability availability for the two public domains;
- a narrowing-only policy provider that delegates to the canonical
  core/project/domain policy engine;
- an in-memory reversible disposable-local `project-record` executor; and
- an in-memory `synthetic-target` containment executor with no filesystem,
  network, process, environment, credential, or dynamic-loader surface.

Capability availability is bounded by both its explicit interval and the
selected provider health interval; it cannot renew or extend provider health.
The two executors receive only explicitly constructed branded target adapters,
the exact live canonical authority decision, the selected closed Executor
registration, its host-owned connector binding, and one closed
`operate-contained-executor-input@1.0.0` envelope. The envelope contains the
exact governed operation plus one reviewed payload Artifact identity/hash/value
and, when reversible, one rollback-baseline Artifact identity/hash/value. Its
request fingerprint commits the immutable operation tuple and both content
identities/hashes; content hashes are recomputed before authorization or target
access. A different initial payload, baseline, target, custom prototype, extra
field, or envelope hash is a conflict. For rollback, the baseline identity and
hash must also equal the authorized rollback plan.

Before execute, rollback, or reconciliation can touch an adapter, its branded
target kind, ID, and revision must equal the governed operation. A same-kind
adapter for another target is not substitutable. Reconciliation requires both
the stored operation ID and its exact request fingerprint. Rollback additionally
requires the stored parent receipt identity and fingerprint to equal the one
validated parent operation in durable operation history before mutation.
Payload objects recursively
use plain data only, and normalized keys and string values are checked against
all core prohibitions: credential change, customer contact, destructive work,
funds/payment transfer, production deploy/merge, publication, and secret
mutation. The references return isolated
effect receipts and deterministic reconciliation data. They do not create or
persist an execution result, Artifact, Event, grant, approval, policy decision,
or lifecycle transition. `governed-execution-v2` composes the forward
execution boundary and `governed-recovery-v2` composes the separately
authorized rollback boundary with the normal Assignment, Submission, Artifact,
Event, authority, policy, and approval boundaries. The open registrations cannot
declare destructive, payment/funds transfer, secret mutation, production
delivery, publication, or customer-contact effects.

### At-most-once governed execution runtime

`planr-pipeline/operate/governed-execution-v2` is the contained forward-effect
boundary for an approved Action; the separately authorized rollback effect
boundary belongs to `governed-recovery-v2`. The execution request carries only an Action ID, one
reviewed payload Artifact identity/hash/closed value, and an explicit
rollback-baseline Artifact identity/hash/closed value when the Action is
reversible. Operation, Assignment, grant, Submission, Artifact, result, and
Event identities are runtime-owned. The runtime selects one exact healthy
package-owned Executor/host binding and derives the request fingerprint from
the immutable Action revision/hash, evaluation and approval IDs, target and
preconditions, capability, effect class, Executor and connector versions,
reviewed inputs, verification plan, rollback classification, payload hash, and
baseline hash.

One shared exact execute-operation validator owns that derivation. Runtime
construction, direct `operation.intent-recorded` reduction, checkpoint
indexing/loading, and replay all reconstruct the dispatching operation from the
current Action, policy evaluation, approved IDs, one-use grant, execution
Assignment, reviewed request, and exact shipped Executor registration. The
trusted connector is derived from that registration's package-owned host; it is
never accepted as caller authority. Execute operations always derive their
rollback class from `Action.executionBinding`, keep `rollbackPlanId` and
`parentOperationId` null, and have `updatedAt === createdAt` at dispatch. Target,
capability/effect, preconditions, inputs, verification, executor/connector, and
both canonical hashes must equal the reconstructed record byte-for-byte.
The governed Action revision hash is derived from one immutable projection:
`actionHash`, `revisionId`, lifecycle `state`, and lifecycle `updatedAt` are
excluded, while every other Action field remains identity-bearing. Lifecycle
progress therefore preserves one revision, but a retained hash cannot conceal a
title, authority, dependency, target, outcome, metric, or provenance rewrite.
Checkpoint loading re-runs the deterministic policy evaluation against the
complete configured policy set and that exact Action rather than trusting a
self-consistent evaluation hash. One resolver selects the latest deterministic
evaluation effective at operation creation for the exact Action revision/hash;
construction, direct intent reduction, checkpoint loading, and replay all use
that same result, so an older still-valid evaluation cannot authorize execution.

Before calling the contained host or inspecting the target, the runtime runs
the canonical non-I/O Action, dependency, policy, approval, grant, capability,
Executor, connector, input, effect-ceiling, and verification authority checks.
Only an authorized closed operation may inspect the branded target. The runtime
then requires the exact current target state hash to equal the reviewed rollback
baseline, revalidates the final operation fingerprint and canonical authority,
and reduces the pending-to-available execution Assignment, runtime claim
and single bounded attempt, capability availability, one-use grant, and one
`operation.intent-recorded` dispatch owner. That intent binds the payload and
baseline Artifact identities/hashes plus the observed target-before hash. It
also reserves two collision-free terminal identity families before the effect:
one for succeeded/partial proof and a distinct one for
failed/blocked/uncertain proof. Each family owns its result, result Artifact,
Submission, and four terminal Event identities; completion time and correlation
remain shared. The unused Submission remains issued as durable evidence that
its identity was reserved but never accepted. Any result, Artifact, Submission,
or Event collision fails before dispatch rather than after it. Its
reducer atomically locks the exact Action ID/revision/hash to one operation and
consumes the grant at the dispatch timestamp while the grant is valid. The
shared validator receives the exact approval requirements and the complete
current-evaluation approval-record set, including rejected or deferred records
that do not appear in the operation's approved ID projection. It reconstructs
only selected consumed records for historical evaluation, re-evaluates the
complete set, and requires `operation.approvalIds` to equal the resulting
approved disposition IDs exactly. Omitting an adverse record therefore cannot
turn a rejected history into quorum authority during direct Event reduction,
checkpoint loading, or replay. The validator also requires the grant expiry not
to outlive capability availability or any non-null requirement or approval
expiry. These rules are identical in construction, direct Event reduction,
checkpoint loading, and replay.

The caller-supplied checkpoint store must provide read-only `readSnapshot()`
and durable compare-and-swap. Every execution first refreshes and validates the
shared checkpoint, so a stale runtime replays a terminal operation before live
authority, host, or target access and treats an existing nonterminal owner as
non-redispatchable. The store must durably compare-and-swap that complete intent
state against the prior Event head before any contained host call is
reachable. A lost compare-and-swap replays the elected operation or fails with
the durable owner; it cannot create another Assignment, grant, operation, or
effect, including under automatic policy. Only the elected dispatcher gives
the exact reference host the closed Executor envelope and explicit branded
target adapter. The host receives no store, policy, approval, grant,
repository, network, process, credential, or model interface.

Returned receipt data is untrusted until the runtime proves one operation-local
effect (`effectCount: 1` even when the contained target's diagnostic count is
cumulative), strips raw values into a closed durable pre/post hash proof, and constructs a strict
`operating-execution-result`, recomputes its canonical hash, encodes its exact
JCS bytes, and accepts those bytes through the existing direct
Submission → Artifact → Event transaction. `execution.result-recorded` then
validates the complete operation/Assignment/Action/evaluation/approval/grant,
capability/target/effect, Executor/connector, input/output, target pre/post hash,
baseline, affected-target set, changed/effect summary, causal timestamps,
verification plan, accepted Artifact, receipt proof, and Event-chain binding.
Succeeded and partial results require a matching contained receipt; failed and
blocked results prove no post-state or affected target; uncertainty proves no
post-state and names the target requiring reconciliation. The same closed
status rules run during direct Event reduction and checkpoint loading. The
runtime then durably compare-and-swaps the terminal projection. If an unrelated
Event wins that compare-and-swap after success bytes stage, the runtime rebases
and commits the same proven success. A configured Artifact byte store must
provide both `stageRaw()` and exact `readRaw({ artifactId, rawHash })`. If a
write-once stage persists bytes and then loses its acknowledgement, exact
read-back proves custody and the runtime continues committing that same success.
If success custody cannot be proven, the runtime records uncertainty only with
the separately pre-reserved uncertainty family; it never writes different bytes
or publishes different metadata under the success Artifact identity. A completion after the
grant expiry is accepted only when the persisted intent proves that the
one-use grant was consumed at dispatch before expiry.

Checkpoint loading also reconstructs the records that only this runtime can
produce. The execution Assignment must retain its exact creation, availability,
and completion times, `maxAttempts: 1`, attempt `1`, 30-second timeout, governed
claim, output contract, and validated state. The selected terminal Submission
must have been issued at dispatch and resolved at result completion with the
exact three-Event acceptance chain; the unused reservation remains a pristine
issued Submission. The result Artifact is created at completion with
`machine-local` storage, `internal` sensitivity, `project` retention, the exact
producer and declared inputs, and byte-derived raw/canonical hashes and size.
The complete assignment/availability/grant/intent and terminal Event replay
chains, including timestamps and causation, are re-derived as well. The exact
registered capability-availability record used at intent must be available,
canonically identified and hashed, match the Action capability/target/effect
and selected provider, remain inside its checked/expiry and provider-health
interval, and equal its `capability.availability-recorded` Event proof. The
first `assignment.created` Event must name the pre-transaction Event head as
its causation (or null only at genesis), after which every operation Event is
contiguous by identity and previous hash. A
self-consistently rehashed checkpoint that could not have been emitted by these
direct transactions is rejected.

An identical completed retry checks the durable operation replay index before
host, target, live availability, or current approval access and returns the
original result and Artifact with zero new Events, dispatches, and effects.
Reusing the operation identity with divergent Action or fingerprint data, or
using a fresh operation identity for an already-owned exact Action revision,
is a non-retryable conflict. Every contained host, receipt, result-encoding,
Artifact-staging, acceptance, or terminal-commit failure after durable intent
but before a receipt proves the effect enters one failure boundary and
atomically records an accepted terminal `uncertain` result before the error is
returned. After a receipt or deterministic reconciliation proves the exact
effect, terminalization may only commit/rebase that same success or fail with
explicit `provenTerminal: true` metadata; malformed, rejected, divergent-CAS,
and replay-read failures cannot materialize uncertainty or redispatch. An optional raw-byte sink must
stage and read back exact bytes per reserved Artifact identity; its failure
cannot leave the operation dispatchable or alias success and uncertainty bytes.
A restart that finds durable dispatch ownership without a terminal result first
uses the exact registered Executor declaration. A deterministic reconciliation
query is permitted only through the original fingerprint-bound envelope and
trusted host/connector binding. An `applied` receipt is revalidated and committed
as the original success without another target effect. `not-applied` permits one
redispatch only when the declaration proves intrinsic idempotency or deterministic
reconciliation; `partial`, `unknown`, an unsupported declaration, or an invalid
response records the pre-reserved terminal uncertainty instead. Exact retry then
returns that durable terminal history with zero Events, dispatches, and effects.
This is a local contained at-most-once contract, not a distributed exactly-once
claim.

### Governed recovery and rollback

`planr-pipeline/operate/governed-recovery-v2` exposes the closed recovery
classifications `applied`, `not-applied`, `partial`, and `unknown`. Durable
terminal Event/Artifact history is sufficient to classify completed operations
without a model, connector, Executor, host, or target. Live reconciliation is
read-only and available only for a durable nonterminal dispatch owned by the
exact registered Executor version with deterministic reconciliation support.
Its immutable proof repeats the operation identity, request fingerprint,
Executor identity, observation time, source, optional validated receipt, and a
canonical hash. Classification cannot fabricate success, edit policy, issue a
grant, reinterpret an effect, or replace operation/result history.
The stateful recovery runtime accepts only the documented operation, request,
host, target, and observation fields. It refreshes and binds its own current
checkpoint and construction-time registry after validating those fields, so a
caller cannot substitute a foreign state or registry through the wrapper.

A reversible successful execution can produce one exact
`operating-rollback-plan`. The plan binds the original operation/result and
Action revision, Executor/capability/effect identities, immutable pre-effect
baseline Artifact and hash, expected post-execution target hash, verification
plan, expiry, and canonical plan hash. `rollback.plan-recorded` appends that
plan to durable history; it never changes the original operation or execution
result.

Rollback is a new transaction, not a status rewrite. It requires a new
runtime-issued execution Assignment, a current deterministic policy evaluation,
a complete independently valid approval disposition, current capability
availability, a new one-use grant and operation identity, the exact plan-bound
baseline, the same healthy Executor version and trusted connector binding, and
an exact target precondition equal to the plan's expected current hash. The
runtime durably records the rollback intent before the host can restore the
baseline. Its separate `operating-rollback-result` is accepted as exact JCS
bytes through Submission → Artifact → Event, links the original and rollback
operation identities, and retains its own replay reservation and verification
plan. Direct Event reduction, checkpoint loading, terminal validation, and
replay all use the same exact rollback authority-chain validator. That validator
reconstructs the dispatch-time operation and Event payload and binds the latest
policy evaluation, complete pre-consumption approval disposition, consumed
one-use grant, availability, Action, Assignment, Executor/connector, immutable
plan and parent, terminal result, accepted Submission/Artifact, expiries, and
Event projections. One shared eligibility predicate accepts exactly
`eligible` or `required` during plan construction, direct plan/intent
reduction, checkpoint validation, authorization, policy validation, and replay.
The rollback Assignment claim binds the exact selected registration provenance
as `packageName@packageVersion`; a fully rechained runtime substitution is not
authority.

The disposable-local reference operation applies once and restores the exact
baseline once. Stale or drifted targets, mismatched baselines, unsupported or
irreversible plans, expired authority, failed/partial/uncertain originals,
repeated plan use, divergent identity reuse, and concurrent losers fail closed.
After a rollback intent, an unproved host outcome becomes a terminal uncertain
rollback result and cannot be retried blindly. A completed retry reconstructs
the same rollback result and Artifact from the checkpoint with no host or target
access. When a raw Artifact byte store is configured, canonical rollback-result
bytes are staged and read back before terminal metadata can commit, including
write-then-acknowledgement-loss recovery, and replay reads those exact bytes.
Once the host receipt proves exact baseline restoration, unrelated terminal-CAS
contention rebases and commits that same success for a bounded number of attempts
without another host call. Post-proof materialization, malformed/rejected/
divergent CAS, Artifact replay-read, or acknowledgment failures either recover
that exact success or return explicit proven-terminal metadata and never create
an uncertainty result. Dispatching rollback reconciliation carries the exact
durable rollback plan into the closed host envelope. No stored receipt is
`not-applied`; an exact plan-bound baseline receipt is `applied`; a valid
plan-bound receipt with a different postcondition is `partial`; malformed,
foreign, or unsupported receipt data is `unknown`. None of those
classifications redispatches rollback.
The original execution operation, result, receipt, and Artifact remain unchanged.

### Executable governed-loop certification

`conformance/verify-operate-v2-governed-execution.mjs` is the public Phase-6
conformance entry point. It starts from the public Phase-5 business and software
Action checkpoints and runs the complete local governed continuation: policy
evaluation, one named approval, capability availability and grant, durable
operation intent, one contained Executor effect, immutable result Artifact,
exact retry and restart replay, recovery classification, verification
observation, atomic Outcome/Learning, and a later Snapshot/Delta revisit. The
business vector additionally records a required rollback plan, obtains a fresh
approval, restores the exact baseline once, and assigns verification to the
rollback terminal result. The software vector proves the no-rollback branch.

The report certifies exact counts, not lower bounds. The business journey has 52
Phase-5 Events plus 32 Phase-6 Events, two governed operations, one execution
result, one rollback result, two dispatches, and two disposable contained
effects. The software journey has 52 Phase-5 Events plus 23 Phase-6 Events, one
operation, one result, one dispatch, and one synthetic contained effect. Exact
retries and process-restart retries add zero dispatches, Events, or effects.
Missing approval, widened effect, extension-registration-as-authority, and
illegal lifecycle vectors all fail before target access.

The verifier replaces `fetch` with a fail-closed sentinel for the duration of
the run and reports zero network attempts, credential reads, external effects,
real effects, and model dispatches. Its only targets are a disposable local
project record and an in-memory no-network synthetic target. The Phase-6 package
and dogfood tests pack the local tarball, record its SHA-256, shasum, and npm
integrity, extract it into a fresh consumer with no source-checkout dependency,
and execute this same verifier through declared public package exports.

Phase 6 contract conformance is available with:

```bash
npm run test:operate-governed-execution-contracts
npm run test:operate-authorization
npm run test:operate-governed-extensions
npm run test:operate-governed-execution-runtime
npm run test:operate-governed-recovery
npm run conformance:operate-v2-contract-compilation
npm run conformance:operate-v2-governed-execution
npm run test:operate-v2-phase6-package
```

## Local package independence and conformance

The locally packed development package contains the schemas, fixtures, conformance runner,
runtime modules, declarations, and this document. It contains no local
workspace data, internal product material, tests, absolute machine paths, source
symlinks, sibling imports, or local dependency ranges.

Verify a source checkout or installed package with:

```bash
npm run conformance:operate-v2
npm run conformance:operate-v2-persistent-work
npm run conformance:operate-v2-contract-compilation
npm run conformance:operate-v2-governed-execution
npm run test:operate-v2-phase6-package
npm run test:operate-evidence-contracts
npm run test:operate-evidence-resolvers
npm run check:operate-runtime-purity
```

The development-package suite builds a clean local snapshot from committed source plus
an explicit development overlay, installs the tarball in a fresh project, loads
only declared exports and schema subpaths, executes the packaged conformance
runner, persistent-work conformance, and compiler conformance, checks
declaration targets, and repeats the purity scan against the installed package.

The tarball is local verification evidence only. It is not a release candidate,
publication request, compatibility promise, or downstream handoff. Published
package history remains immutable under its own historical identity.

## Public product experience and Planning bridge

The compiler owns a separate nine-contract experience family. It does not
expand or weaken the 69-contract runtime kernel:

- `operate-experience-view` is the access-safe, replayable read model for Today,
  cycle progress, inbox, Actions, Evidence, rationale, Outcomes, Learnings, and
  audit history. The screen-fidelity portion is still one strict read model:
  `domainMetrics` carries typed value/unit/change/window/freshness plus exact
  Snapshot/Delta and due-verification references; Cycle rows carry safe
  Assignment ownership, dependencies, blockers, stage inputs/outputs/gates,
  evidence gaps, uncertainty, persistent Actions, and deep links; Evidence and
  Claims carry support/contradiction, source/producer/time/scope/sensitivity,
  provenance, confidence, safe errors, access reasons, and causal links. Every
  EvidenceRef must bind the exact referenced Artifact identity, raw/canonical
  hashes, size, media type, and access classification before those Artifact-owned
  fields enter the view;
  Outcomes bind expected-versus-observed metric values to Decisions, execution,
  rollback, verification, next observation, revisit, Snapshot, and Delta. Their
  Metric and verification-plan hashes are canonical and the complete Outcome,
  Action, plan, baseline, target, window, Metric, and observation chain must agree;
  same-scope substitutions are rejected; and
  History carries current access-safe change/why/authority/evidence/prior/result/
  next/before-after facts beside a replay proof. History actor identities come
  only from validated canonical Events and pass through the same Artifact-backed
  access screen as the subject; restricted identities become `null`. Fields with no canonical record
  are `null` or empty rather than inferred from caller prose or UI calculation.
  Its embedded export descriptor permits only access-safe JSON
  and HTML projection. Today priority is deterministic: materiality, urgency,
  expiry proximity, blocked dependencies, due verification, ownership, and
  uncertainty contribute typed scores; equal scores use stable item identity.
  Ranking never infers priority from unrestricted prose. All identity lookups are
  qualified by the exact scope/domain/version before ranking or source-Artifact
  screening; foreign-scope ID collisions are ignored and duplicate local
  Decision, Action, Outcome, Artifact, Metric, observation, Claim, evidence,
  Snapshot, Delta, and verification identities reject the projection. Because
  Assignment and Event records bind through Cycle identity rather than repeating
  scope, a scope-local Cycle ID that is duplicated in another scope also rejects
  the projection instead of admitting ambiguous dependent records. An Inbox row
  backed by one Review choice may retain its exact mutation locator. When a
  pending Review exposes multiple valid choices, the row instead carries one
  exact read-only Review navigation locator: Review ID, Cycle ID, canonical
  Review deep link, and digest of the runtime-issued `operate.review.get` action.
  Its mutation locator remains `null` until the owner selects a choice in the
  Review workspace; the projection never preselects a disposition or reports the
  available Review as unavailable. Duplicate or divergent read locators fail
  closed.
- `operate-review-display-workspace` is the content-hashed, owner-bound Review
  display projection over either one verified pending `operating-review-read` or
  one immutable terminal `operating-review-receipt`. It carries one shared
  stage/proof/seat/evidence/claim/verification/attention summary verbatim across
  Today, Cycle, Inbox, Evidence, and Review; preserves exact pending choice IDs,
  hashes, and submit arguments; exposes only an already verified owner submit
  capability; and represents restricted or missing proof as typed omissions.
  Terminal workspaces expose no choices or mutation capability. Narrative body
  redaction precedes the payload-only integrity hash, and projection never reads
  or mutates the private Store.
- `operating-trace-matrix` is the bounded, canonically ordered reciprocal DAG
  from requirements and typed absences through seats, Assignments, accepted
  Artifacts, Claims, resolved EvidenceRefs, Findings, Decisions, Actions, and
  Outcomes. Its exported assertion applies the complete closed schema before
  verifying edge identities, inverse adjacency, scope, hashes, and limits.
  Verified Evidence requires one exact resolution and evidence-snapshot custody
  chain. A verified Action additionally requires the exact Action/verification
  plan baseline, target, and window; a current Metric on the plan's current
  Snapshot lineage; exact observations, accepted source Artifact, and accessible
  Evidence. Restricted edges are removed and counted in typed omissions; an
  intentionally unselected role is a deterministic typed absence, never a
  successful or not-required seat.
- `operating-executive-board` binds one Cycle, intelligence plan, Chair ledger,
  exact pending Review hash, seat/Artifact/absence roster, findings, Decisions,
  Actions, and the trace matrix. New Cycles accept only the `materialized`
  variant: the pipeline-owned `executive-board.materialized` Event is immediately
  followed by its hash-bound `review.created` Event in one atomic append, with no
  intervening or board-only commit. Stored records are mutation-authoritative.
  Existing Cycles may derive the schema-valid `compatibility` variant from their
  committed plan, ledger, Review, and Event head entirely in memory. That variant
  has no materialization Event, is explicitly non-authoritative, and never writes
  to or migrates the Store.
- `operate-review-bound-submission` is the closed owner-submit proof used by new
  Review gateways without changing the legacy `operate.review.submit` request.
  It retains the exact advertised `choiceId`, `choiceHash`, and submit arguments,
  binds them to the owner's expected read Event head and a bounded optional note,
  and commits a separate canonical `boundSubmissionHash`. The runtime resolves an
  exact committed replay before testing the now-stale expected head; divergent
  reuse, a changed choice or note, a foreign actor or scope, and a novel stale
  request fail without mutation. The immutable Event projection and terminal
  receipt retain the same proof. Historical legacy Events and receipts remain
  readable, but only the bound operation certifies the new owner-facing gateway.
- `operate-experience-live-patch` is an ordered, closed-path replacement delta
  bound to one actor, scope/domain/version tuple and exactly one contiguous Event
  sequence advance. The initial head is exactly sequence `0` with hash `null`;
  positive heads require hashes. Gaps, equal-sequence forks, and any mismatch in
  before/after Event-head or canonical view-hash lineage are rejected.
- `operate-experience-preview` is an expiring confirmation envelope for one
  runtime-provided `operate-allowed-action`. Its subject kind, id, revision and
  hash must resolve in the exact current actor/scope/Event-head view, and its
  action must be present there with the same subject binding. It describes
  authority and consequence without granting either. Consequence text is a
  deterministic projection of the exact effect, action label, subject, delivery
  route, and expected change. Caller-authored or divergent consequence prose is
  rejected. Projection and preview share one closed operation-specific subject
  resolver: each tool binds its exact Cycle, Assignment, Artifact, Review, or
  Action argument; Action tools additionally bind revision and action hash.
  Global replay entity IDs never create controls. Foreign subjects, same-ID
  collisions, duplicate controls, stale tuples, and actor-bearing arguments that
  differ from the current view actor fail closed before a control is emitted.
- `operating-delivery-route` binds an exact Action revision and Event head to
  exactly one of `contained-execution`, `planning-work`, `human-external`, or
  `observe-only`. A route change requires a new Action revision.
- `operating-planning-proposal` carries an approved Decision, current Action,
  exact metric and verification-plan identities/hashes, evidence identities/
  hashes, accepted attributed advisor/challenger/Chair summaries, and acceptance
  framing into human review. Summaries are derived only from closed accepted
  outputs whose canonical hashes match exact cycle-scoped, validated Assignments,
  accepted Submissions, and matching Artifacts; free caller prose and stale output
  bodies are rejected. Exactly one accepted Chair synthesis is
  normative. Approval is a one-way revision transition from the immutable
  review proposal and requires an exact human confirmation record bound to its
  proposal revision/hash, current Event head, preview digest, confirming actor,
  and expiry. Confirmation time must be on or after preview issuance and on or
  before expiry. Rejected advice, raw prompts, hidden reasoning,
  credentials, private paths, and inaccessible bodies are prohibited at this
  boundary.
- `operating-origin` is the closed Planning sidecar created only after an
  exact current human-confirmed proposal has a durable SPEC transaction receipt.
  It retains the original metric and verification-plan hashes and window.
- `operating-delivery-evidence` correlates PLAN, SHIP, tasks, changed surfaces,
  and QA back to the original Decision and Action while retaining the same
  proposal revision, metric and verification-plan identity/hash/window. A SHIP
  run cannot substitute those bindings. PLAN custody is the exact successful
  `decomposed` provenance Event identity and hash. SHIP custody is the complete
  public `.pipeline-shipped` marker plus its Event-bound manifest hash and
  current-run line slice. The latest `ship.bootstrap` starts a resumed run; all
  task attempts in that slice remain evidence, while the final attempt for each
  unique task determines its disposition and marker counts. Rolled-back
  delivery additionally requires one later origin-bound rollback provenance
  Event that closes the exact rollback plan, result, receipt, target hashes,
  producer, run, and completion time. It always records
  `outcomeStatus: verification-required`; delivery completion cannot claim a
  business Outcome.

The browser-facing selected-display family is a separate, versioned v1.2
boundary over this canonical v2 view:

- `operate-experience-display-surface@1.0.0` carries Today, Inbox, the Cycles
  collection, and the Cycle surface envelope;
- `operate-cycle-display-workspace@1.0.0` is the sanitized exact Cycle
  workspace carried by Cycle detail;
- `operate-experience-audit-display-surface@1.0.0` carries Evidence, Outcomes,
  one Outcome, History, Search, and Export.

The owner validates and selects exactly once, commits the complete selected
payload and source-view anchors with domain-separated SHA-256/JCS, and binds the
surface-specific request. The browser validates the envelope and its exact
current query identity before creating any model or DOM. A structural
look-alike, content mutation, stale/foreign binding, or unverified legacy view
refuses the whole affected surface; browser code never reconstructs owner
selection, evidence privacy, lifecycle, or graph authority.

Pure consumers use `buildOperateExperienceViewV2`,
`createOperateExperiencePreviewV1`, and the live-patch functions from
`planr-pipeline/operate/experience-projection-v2`. The Planning bridge functions
are exported from `planr-pipeline/operate/planning-bridge-v2`. Both business and
software domains use the same projection code and explicit public domain
bindings. No function in this family invokes PLAN, SHIP, a provider, an
executor, a browser, or an external effect; authorization remains with the
existing governed runtime and the R1 PLAN-to-SHIP human gate remains mandatory.

The experience is reconstructible from durable runtime state plus the complete
indexed canonical Event sequence. Before History or replay proof is projected,
every Event is schema-validated; its canonical hash, payload hash, sequence,
previous hash, actor, entity, cycle, scope, domain, version, and replay-index
metadata must agree exactly, and its final head must equal the runtime state.
Event-backed Artifacts, Decisions, Actions, approvals, Outcomes, Reviews, and
execution records are independently compared with current projection state;
Artifact comparison includes the complete immutable custody metadata. Lifecycle
Events bind the final Action/Cycle tuple, state, and update time, while History
uses the canonical transition payload rather than unproved current prose. Any
tamper rejects the view rather than admitting forged audit facts. Approval gates
reuse the canonical approval-set evaluator with the exact current Action,
policy evaluation, complete requirement/record set, and projection time, so
wrong-scope, expired, consumed, rehashed, or coordinated substitutions remain
waiting rather than becoming authority. A consumer
can render offline without live provider access; restricted
bodies remain absent, represented only by typed access stubs and omission
counts. `replay.liveAccessUsed` is always `false`; its checkpoint is `null` unless
the caller supplies a valid public `operating-checkpoint` whose runtime-state
hash, replay-index hash, and final Event head exactly match the projected state.
An operating Snapshot is never presented as a replay checkpoint. The tail,
final head, filter dimensions, redaction list, and parity hashes remain
available in either case. `parityProof.stateParityVerified` is true only when the
exact current state is bound by a validated runtime checkpoint or every
parity-tracked event-backed current collection has complete canonical Event
coverage; partial legacy Event
coverage is reported as `false`, never promoted to parity. Access screening applies to every user-visible source-derived string,
including cycle focus, Decision title/consequence, Action title/expected result,
route rationale, Assignment objectives, Learning statements, allowed-action
labels, metric values, Claim statements, evidence provenance, verification text,
History change/why text, rationale nodes, and owner identities. Raw evidence
locators, restricted bodies, hidden reasoning, and foreign identities never
enter the view, patch, export, or deep links. Verify the family with:

```bash
node --test tests/schema/operate-experience-bridge-contracts-v2.test.mjs tests/orchestration/operate-experience-projection-v2.test.mjs
npm run conformance:operate-v2-contract-compilation
```

## Installed product certification and recovery boundary

`conformance/verify-operate-v2-product-experience.mjs` composes the public
business and software intelligence journeys with governed execution, exact
retry/divergence, acknowledgement-loss replay, contained rollback, verification,
Outcome/Learning, and later revisit. Its report pins zero network attempts,
credential reads, external effects, real effects, and model dispatches. The
scripts-disabled development package executes that verifier from an external
consumer directory; the source checkout is not an import fallback.

The installed product package must carry the complete dashboard module graph and
product stylesheet, not merely its top-level dynamic importer. Product custody
tests require every Today, Planning, governed-control, origin, trace, shared
component, and stylesheet asset and then load them from the extracted package.

The certified 10,000-Event read fixture measures Node-side canonical transport
validation, Today selection, live-update selection, navigation selection,
replay, and bounded heap. The fixture requires initial construction within two
seconds and uses the median of loaded selector calls for the 200 ms route bound,
so unrelated parallel test scheduling is not misreported as selector latency.
It does not measure browser render, interaction readiness, or real-user
usability; those require the separate real-browser SPEC-020 gates.

OpenPlanr owns project-local `.planr/operate/` storage and recovery. Its private
`state/`, `packets/`, and `archive/` trees reject symlinks and traversal, use
restricted modes, and remain excluded from ordinary repository research while
public planning artifacts stay readable. A pre-change store is replay-verified,
byte-hashed, and archived before a clean state becomes active; incompatible or
ambiguous custody fails closed. Corrupt, partial, blocked, and uncertain state
remains explicit. The doctor support projection contains only protocol metadata,
hashes, counts, and redacted diagnostics—never Artifact bodies, identities,
credentials, secrets, machine paths, prompts, or hidden reasoning.

These gates are local certification only. They grant no release, version,
changelog, changeset, commit, push, deploy, publish, marketplace, credential,
network, production, customer, payment, merge, or destructive authority.
