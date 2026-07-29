# OpenPlanr Operating Board

`planr operate` turns verified product and engineering evidence into a concise
operating brief and governed next actions. It helps a technical founder or
product-engineering lead decide what should happen next; it does not deploy,
publish, spend, contact customers, or invoke SHIP.

```text
product workspace + charter + verified evidence
                         ↓
              independent advisory lenses
                         ↓
          deterministic consolidation and scoring
                         ↓
              DEV | OWNER | AGENT routes
                         ↓
             accept → apply → PLAN review
                         │
                         │ separate, user-invoked delivery workflow
                         ▼
                       SHIP
                         │
                         ▼
                 observed outcomes
```

## First five minutes

Inspecting and trying the deterministic demo require neither initialization nor
provider credentials:

```bash
planr operate inspect
planr operate demo
```

Initialize from a Git worktree or an existing OpenPlanr project, then run the
first cycle:

```bash
planr operate init
planr operate run
planr operate review
```

Initialization guides you through a profile, product charter, control
repository, read-only component repositories, decision owner, planning engine,
runtime, privacy policy, evidence sources, cadence, and IANA display timezone.
The default cadence is manual.

### Guided initialization

One canonical question registry drives both the terminal flow and
machine-readable runtimes. It progresses through:

1. **Foundation** — profile, explicit decision owner, planning engine, runtime,
   cadence, timezone, evidence sensitivity, sources, imports, and component
   roots.
2. **Product charter** — purpose, stage, business model, ideal customer, goals,
   success metrics, human guardrails, and known unknowns.
3. **Review** — exact writes, warnings, evidence readiness, and a write-free
   preview.

Suggestions such as the Git user name, detected runtime, and local timezone are
visibly suggestions: accepting one is an explicit answer. OpenPlanr never
infers the decision owner, planning authority, goals, business facts, metrics,
guardrails, or known unknowns.

For the charter purpose only, OpenPlanr may offer a deterministic local draft
from a sanitized `package.json#description` or, when that is absent, the Planr
project name. The question includes its source, evidence digest, confidence
category, and rule-engine version. The user must explicitly accept, replace,
or skip the draft. Instruction-shaped or secret-bearing metadata is ignored;
unsupported charter fields stay blank. This assistance performs no
provider/model call and writes no project state.

In `--json` mode, omitted input returns `E_OPERATE_INPUT_REQUIRED` and a
Protocol v1.2 `guided-questionnaire` instead of prompting or returning a generic
configuration error. Fully specified flag-based automation remains supported:

```bash
planr operate init \
  --profile saas \
  --decision-owner "Product owner" \
  --planning-engine openplanr \
  --runtime codex \
  --cadence manual \
  --timezone UTC \
  --sensitivity-ceiling internal \
  --source repository \
  --source git \
  --purpose "Help technical founders make cited operating decisions" \
  --product-stage "Early growth" \
  --business-model "Subscription SaaS" \
  --ideal-customer "Technical founders and product-engineering leads" \
  --goal "Produce a trustworthy operating brief" \
  --success-metric "First useful brief within five minutes" \
  --guardrail "Never invoke SHIP automatically" \
  --known-unknown "Which signal will become the leading indicator" \
  --preview \
  --json
```

Question collection is write-free and provider-free. Reviewing or answering a
question does not authorize initialization, starting a cycle, provider use,
route application, PLAN, or SHIP.

## Advisory lenses

Operating Board uses six canonical, read-only lenses:

| Lens | Canonical role | Scope |
|---|---|---|
| CEO | `strategy-finance` | Direction, focus, economics, pricing, packaging, and what to stop |
| CTO | `technology-risk` | Reliability, security, privacy, payments, data integrity, and blast radius |
| CPO | `product-activation` | Journeys, activation, retention, friction, and accessibility |
| CMO | `growth-market` | ICP, demand, proof, lifecycle coverage, and bounded experiments |
| COO | `operations-customer` | Support, billing, contracts, compliance, vendors, and owner bottlenecks |
| Chair | `chair` | Reconcile verified proposals, merge duplicates, and sequence conflicts |

These are advisory roles, not the pipeline's nine delivery agents and not
autonomous executives. Their canonical mandates, evidence permissions,
forbidden actions, budgets, output schemas, and minimum-readiness rules live in
the Protocol-owned operating-role registry. OpenPlanr derives an immutable,
digest-bound role pack for each invocation: trusted brief, role-filtered
untrusted evidence, bounded operating context, and input digest. Structured
providers consume that pack directly. A certified native runtime may execute
the same pack only with enforced empty-tool isolation; it records and finalizes
independent lenses before OpenPlanr prepares the Chair pack from their verified
results. This avoids divergent hand-written CEO or CTO prompt files while
preserving explicit, testable prompt contracts.

### Planning-only installations

`planr operate --help`, `planr operate inspect`, and `planr operate demo` remain
available when OpenPlanr was installed with `--minimal`. `inspect` reports
whether the Protocol v1.2 pipeline package is available. A command that needs
Protocol schemas, state, routing, or providers fails before provider use with
`E_PIPELINE_NOT_INSTALLED` and these recovery steps:

```bash
npm install -g openplanr@latest
planr setup --scope user
planr operate inspect
```

## Safety boundaries

- A successful run ends in `reviewable`, not `completed`.
- Missing minimum evidence marks a lens `not_evaluated`; it does not produce
  generic model advice.
- `findings accept` records governance only.
- `routes apply` is a separate, digest-bound, previewed mutation.
- A non-quiet cycle closes only after surfaced findings and owner decisions
  are disposed. Otherwise `cycles close` returns
  `E_OPERATE_CYCLE_NOT_DISPOSED` with blocking IDs and exact next commands.
- DEV routes create a substantive spec and outcome contract, then stop at the
  PLAN review gate. They never invoke SHIP.
- AGENT routes generate validated local artifacts. They never publish or share
  automatically.
- OWNER routes record a decision request for the named human owner.
- Evidence collectors are mechanically read-only.

`--preview` and `--dry-run` are deliberately different:

| Mode | Evidence/model work | Persistent writes |
|---|---|---|
| `--preview` | No provider or model calls | None |
| `--dry-run` | May collect evidence and make the disclosed, budgeted model calls | None |

A first remote `--dry-run` can still require provider-policy consent because it
may transmit data. Neither option accepts, applies, ships, or publishes
anything.

## Storage and privacy

The project stores sanitized, commit-safe events, content-addressed record
metadata, briefs, routes, outcome contracts, observations, and causality
sidecars under `.planr/operate/`.

Raw evidence, prompts and responses, credentials, temporary transaction data,
locks, machine paths, and restricted material remain under user-local
`~/.planr/operate/` storage. Eligible internal evidence uses a bounded TTL and
mode `0600`. Inspect or purge it explicitly:

```bash
planr operate cache status
planr operate cache purge
```

Evidence is untrusted data. It is role-filtered, bounded, scanned for secrets,
and never inserted into system instructions. Provider consent is bound to the
provider endpoint, retention policy, and permitted data classes, and is renewed
when any of those change.

Every persisted finding inherits the highest sensitivity of all cited evidence.
This classification is deterministic and may be raised when evidence changes;
it is never lowered by an advisor or by consolidation.

### Provider consent

Before the first configured provider call, OpenPlanr discloses the provider and
endpoint, permitted data classes, retention policy, request/token/time/cost
limits, and the policy digest. In an interactive terminal, review the disclosure
and approve the prompt. In `--json` mode there is never a prompt: the command
returns `E_OPERATE_AUTHORITY_REQUIRED`, and automation must inspect that result
before repeating the same named run with `--yes`.

Consent is stored without credentials. It is requested again when the endpoint,
provider configuration, permitted data classes, retention policy, credential
policy, or scheduled review changes. `--yes` confirms that disclosed policy for
the named run only.

### Evidence sources

Repository, Planr, and Git evidence are local and read-only. Configured GitHub
evidence includes bounded issues, pull requests, releases, and check runs.
Configured Linear evidence includes bounded teams, issues, and projects. Remote
collectors reject non-canonical hosts, redirects, oversized responses, and
unbounded pagination; GitHub permits GET/HEAD only and Linear permits GraphQL
queries only.

Explicit JSON and CSV imports must remain inside the control or component
repositories. Their absolute machine paths are stored only in user-local state:

```bash
planr operate init \
  --source file-import \
  --evidence-file evidence/product-metrics.json \
  --evidence-file evidence/customer-signals.csv

planr operate sources test file-import
```

`operate init` is the public configuration surface for source selection,
component roots, and import paths. `operate config edit` points to the
commit-safe operating configuration; import paths and absolute component roots
remain machine-local and therefore are not written there. Use:

```bash
planr operate sources list
planr operate sources show file-import
planr operate sources test file-import
```

to inspect the registry contract and test the already configured source. Source
tests are read-only and never add a source implicitly.

Imports use strict UTF-8, JSON depth/key/scalar limits, CSV row/column/field
limits, symlink containment, and spreadsheet-formula neutralization. Raw input
is not written into commit-safe operating artifacts.

## Multi-repository products

One product has one control repository. Component repositories are read-only
evidence sources identified by stable component ID, canonical remote, configured
branch, pinned revision, and dirty-state fingerprint. Absolute local paths stay
in machine-local state.

Only one process on one filesystem host may mutate an operating workspace at a
time. Git is the explicit machine-handoff mechanism. Divergent operating heads
block mutation with `E_OPERATE_HEAD_DIVERGED`; OpenPlanr does not claim a
distributed lock.

## Findings, routes, and the PLAN gate

```bash
planr operate findings list
planr operate findings accept FND-001
planr operate routes show ACT-001
planr operate routes apply ACT-001
```

Acceptance and application are separate governance acts:

1. `findings accept` records the human disposition and accepts the proposed
   route; it writes none of the route destinations.
2. `routes apply --preview` computes the exact writes and confirmation digest.
3. `routes apply --preview-digest … --yes` performs only that named route.

The apply preview binds the project, route, evidence and event heads, provider
policy, destination paths, and exact writes. Reversible writes can be restored
byte-for-byte with `routes rollback`.

Select exactly one planning producer:

- `openplanr` creates the spec with the dedicated planning CLI.
- `pipeline-po` creates the spec, prepares the pipeline PLAN handoff, and waits
  for the exact native PLAN invocation and provenance validation.

For a Pipeline-PO DEV route, the first application normally returns:

```text
state: awaiting-plan
invocation: planr pipeline plan "<feature>" --runtime <runtime>
shipInvoked: false
```

Run exactly that PLAN command and review its generated stories and tasks. Then
repeat the same digest-bound `routes apply` command. OpenPlanr calls
`completePlan()`, validates that the selected `planr-pipeline` PO producer
recorded matching provenance, and marks the route applied. Repeating either
side of the handoff is resumable and idempotent; mixed or unknown planning
producers fail with `E_OPERATE_PLANNER_CONFLICT`.

Operating Board never invokes SHIP. PLAN and SHIP remain separate user
invocations, and the user starts SHIP only after the mandatory PLAN review.

## Evidence gaps

An answer is useful context, but it is not verified evidence:

```bash
printf '%s' "$ANSWER" |
  planr operate gaps answer GAP-001 --stdin --yes --json

planr operate gaps verify GAP-001 \
  --evidence-ref EVD-001 \
  --yes \
  --json
```

`gaps answer` moves an open gap to `answered`. `gaps verify` requires at least
one explicit evidence ID, records the verification, and then closes the gap.
Unanswered or unverified gaps remain visible; they cannot be silently converted
into model advice.

## Outcomes

DEV specs carry a typed outcome contract with a metric unit and query identity,
comparison direction/operator, aggregation, baseline and target windows,
threshold, minimum coverage/sample, stale/missing policy, and guardrail
precedence. OpenPlanr distinguishes shipped work from observed success.
Unsupported comparisons or insufficient evidence are `inconclusive`.

Shipment is observed, never initiated, by Operating Board. After a separately
authorized pipeline SHIP, run:

```bash
planr operate run --review-only
```

This zero-model reconciliation accepts shipment only when the linked spec,
`.pipeline-shipped` marker, run manifest, QA report, and `planr-pipeline`
shipment provenance agree. It emits `ship.observed` before processing due,
schema-valid observation envelopes from:

```text
.planr/operate/outcomes/observations/*.json
```

An observation is evaluated against the route’s immutable outcome contract.
Insufficient sample/coverage, stale or missing values, identity mismatches, and
unsupported comparisons remain `inconclusive` according to that contract.
`--review-only` does not collect new evidence, call a model, or invoke SHIP.

## Automation

Every command that supports `--json` is non-interactive and emits one versioned
result on stdout. Every result carries `ok`, `action`, `state`, relative
`paths`, `counts`, `warnings`, and `nextActions`; cycle actions also carry
`cycleId`. Diagnostics use stderr. No ANSI or spinner output is emitted.

```bash
planr operate inspect --json
planr operate run --offline --json
printf '%s' "$SENSITIVE_ANSWER" |
  planr operate gaps answer GAP-001 --stdin --yes --json
planr operate gaps verify GAP-001 --evidence-ref EVD-001 --yes --json
```

Non-interactive initialization deliberately has no hidden governance defaults:

```bash
planr operate init \
  --profile saas \
  --decision-owner "$OPERATING_DECISION_OWNER" \
  --planning-engine openplanr \
  --runtime auto \
  --preview \
  --json
```

After reviewing the returned preview digest, repeat the exact command with
`--yes` and without `--preview`.

Automation may rely on these stable process-exit classes:

| Exit | Meaning |
|---:|---|
| `0` | Successful versioned result |
| `1` | Unexpected internal failure |
| `2` | Invalid invocation, input, path, profile, or configuration |
| `3` | Required project, initialization, or pipeline component is unavailable |
| `4` | Explicit human authority or a digest-bound confirmation is required |
| `5` | State, integrity, concurrency, migration, or recovery conflict |
| `6` | Evidence, provider, advisor, isolation, or execution budget failed safely |

`--yes` confirms only the named action. It does not grant broader authority.

Route application is always two-step and digest-bound:

```bash
planr operate routes apply ACT-001 --preview --json
planr operate routes apply ACT-001 \
  --preview-digest "sha256:<digest-from-preview>" \
  --yes \
  --json
```

The preview reports the exact route and current destination digest and commits
no bytes. If either the operating head, destination, provider policy, evidence,
or planned write set changes, application fails closed and requires a new
preview.

## Recovery and diagnostics

```bash
planr operate status
planr operate cycles resume CYCLE-001
planr operate cycles recover CYCLE-001
planr operate integrity status
planr operate diagnostics export
```

Canonical state is an append-only event stream plus immutable
content-addressed records and verified checkpoints. Local writes use a
write-ahead journal and can recover after interruption. Signed checkpoints are
optional and use a key held outside the repository; unsigned default integrity
detects corruption but does not claim signer authenticity.

`planr operate security repair` is an exceptional, explicitly authorized flow.
It quarantines the project, purges affected local data, provides credential and
Git-history remediation guidance, and starts a new event-stream genesis anchored
to a signed discontinuity record without retaining purged content.

## Deferred

Operating Board does not add portfolio governance, distributed multi-writer
state, scheduled/background cycles, hosted accounts, telemetry, first-party
business connectors, autonomous external actions, or automatic SHIP.
