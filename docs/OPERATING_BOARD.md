# OpenPlanr Operating Board

> **Protocol v1.4 agent-native workflow:** the selected Claude Code, Codex, or
> Cursor runtime researches the workspace and runs all six advisory roles. The
> CLI validates, records, and materializes reversible proposal drafts; it is not
> the reasoning engine. Runtime binding is sticky and cross-vendor fallback is
> forbidden.

`planr operate` turns verified product and engineering evidence into a concise
operating brief and governed next actions. It helps a technical founder or
product-engineering lead decide what should happen next; it does not deploy,
publish, spend, contact customers, or invoke SHIP.

```text
skill/plugin supplies the procedure and role instructions
                         ↓
selected runtime researches the product workspace
                         ↓
      CEO | CTO | CPO | CMO | COO → Chair
                         ↓
 cited report + proposed Quick Task/Spec/Epic/decision drafts
                         ↓
          review → approve draft → PLAN review
                         │
                         │ separate, user-invoked delivery workflow
                         ▼
                       SHIP
                         │
                         ▼
                 observed outcomes
```

## First five minutes

Inspection and the deterministic demo require neither initialization nor
provider credentials:

```bash
planr operate inspect
planr operate demo
```

On an uninitialized project, the recommended first command is bare
`planr operate`. It runs the research-first bootstrap (`context refresh`),
pre-filling most charter fields from the repository before initialization —
rather than starting cold in the guided questionnaire:

```bash
planr operate                     # research-first: pre-fill the charter, then guide init
planr operate context refresh     # run only the research step
```

In an installed runtime, invoke the workflow once:

```bash
$planr-operate                    # Codex
/planr-pipeline:operate           # Claude Code
```

The skill initializes when needed, researches the project before asking
questions, runs independent CEO, CTO, CPO, CMO, and COO advisors, synthesizes
them through the Chair, writes Markdown and JSON reports, and materializes
qualified proposed drafts. Existing initialized projects skip onboarding. The
cycle stops at `reviewable`; draft approval, PLAN, SHIP, provider consent,
connected research, and external effects remain separate gates.

### Guided initialization

The bootstrap agent first inspects repository documentation and code, pricing
and billing surfaces, product journeys, Planr artifacts, Git history, delivery
state, risks, and incomplete loops. It proposes purpose, stage, business model,
likely customers, goals, and metrics as cited claims labeled `observed`,
`inferred`, `hypothesis`, or `unknown`. A single compact review asks only for
genuine human authority, such as the final decision owner, and lets the owner
confirm or amend inferred context. “Find it from the project” is a request to
continue research, not a dead end.

Local research uses the runtime's existing workspace permissions and requires
no additional provider consent. Connected or web research is opt-in per cycle
and receives a digest-bound preview before use.

The legacy guided-questionnaire transport remains readable for existing v1.2
automation. New v1.4 runtime workflows use native questions and a compact
context review. Fully specified flag-based automation remains supported:

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

Operating Board uses six canonical runtime-native lenses:

| Lens | Canonical role | Scope |
|---|---|---|
| CEO | `strategy-finance` | Direction, focus, economics, pricing, packaging, and what to stop |
| CTO | `technology-risk` | Reliability, security, privacy, payments, data integrity, and blast radius |
| CPO | `product-activation` | Journeys, activation, retention, friction, and accessibility |
| CMO | `growth-market` | ICP, demand, proof, lifecycle coverage, and bounded experiments |
| COO | `operations-customer` | Support, billing, contracts, compliance, vendors, and owner bottlenecks |
| Chair | `chair` | Reconcile verified proposals, merge duplicates, and sequence conflicts |

These are advisory roles, not the pipeline's nine delivery agents and not
autonomous executives. Canonical procedures and role instructions live in
`planr-pipeline` and are generated for all three runtimes. Each agent receives
a mandate, workspace roots, labeled context, forbidden effects, and an output
schema—not a serialized repository body. The agent investigates with its
current runtime permissions and returns flexible `analysisMarkdown` plus typed
claims, actions, gaps, and conflicts. Material facts and actions require
resolvable citations. OpenPlanr rejects only invalid claims/actions, records
valid results, and then prepares the Chair synthesis.

Codex with advisory tool-isolation remains Operate-capable under
`assurance: runtime-governed`; Planr grants it no extra permission. Claude Code
and Cursor use the same policy. Native subagents run in parallel when available,
with a sequential fallback inside the same selected runtime.

### Native harness lifecycle

When native execution is required, the public run result returns a
Protocol-validated `operating-adapter-handoff` before prepare. That object is
the complete state-aware execution contract for the current boundary:

- `phase` and `state` identify the independent-advisor or Chair boundary;
- the binding fixes the cycle, evidence digest, runtime, CLI-owned idempotency
  key, nullable pre-prepare lease, and nullable expiry;
- `next[]` contains only exact argv arrays legal in the current state;
- `recovery[]` contains only valid interrupted-session actions.

The skill executes those arrays internally. It must not add a role suffix to
the idempotency key, replace any binding field, derive a command from prose, or
call an internal command with `--help` to discover what comes next. Each
successful record returns a new handoff containing only the roles still
missing. Once every role is recorded, finalize is the sole next action; after
finalize, a cycle-bound continuation is the sole next action.

```text
independent advisors or Chair:
harness prepare → harness record → harness finalize → governed continuation
                                  └──────────────→ harness cancel
```

`harness validate` is the free dry-run companion to `record`: it takes the same
stdin payload, runs the same validator, and returns every violation in one
response — consuming no lease and needing no idempotency key. A runtime should
validate before recording; a rejected `record` and a rejected `validate` report
identical issues, so the two can never disagree.

`resume` returns the current state of the same unexpired, digest-bound session.
`cancel` ends only that private session. Invalid, expired, or drifted bindings
fail closed; the runtime follows the exact recovery action returned by the CLI
and never invents a new lease or idempotency key.

Lifecycle effects are fixed and intentionally narrow:

| Action | Effect |
|---|---|
| prepare, record, cancel | Machine-local write |
| resume | Read-only session inspection |
| finalize | Project write of validated advisor results |
| continue | Governed cycle continuation; later boundaries retain their own effect and authority checks |

This lifecycle is covered by the user's explicit request to run the current
cycle. It does not authorize provider consent, findings, routes, planning
artifacts, PLAN, SHIP, or external actions.

### Human-readable and machine-readable results

The dashboard is optional. Every reviewable cycle is persisted and can be rendered directly in
the terminal or returned as strict JSON:

```bash
planr operate report                    # concise Markdown for all lenses
planr operate report --lens CTO         # one executive lens
planr operate report --format json      # structured terminal output
planr operate report --json             # one versioned automation result
planr operate report --html --out report.html   # self-contained, shareable HTML
```

`--html` renders the cycle into a single, self-contained, offline HTML file
(inline CSS, real tables, no remote references) that opens cleanly in
`planr artifact open`. `--out <path>` chooses the destination; the default is
alongside the cycle directory, else a temp file. The command prints the written
path and the exact `planr artifact open <path> --title "..."` follow-up.

The report includes executive synthesis, separate CEO/CTO/CPO/CMO/COO/Chair
analysis, agreements, conflicts, priorities, decisions, experiments, proposed
metrics, cited gaps, and exact next actions. Qualified recommendations also
create canonical proposed Quick Task, Spec, Epic, decision, or agent-artifact
drafts. They are idempotent and reversible, but never approved automatically.

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

The project stores sanitized events, content-addressed record metadata, briefs,
routes, outcome contracts, observations, and causality sidecars under
`.planr/operate/`. "Sanitized" means secrets are redacted so the content is
*safe to commit* — it is not a guarantee that git tracks the directory. If
`.planr/` is gitignored, the board stays a machine-local artifact and is not
versioned; `planr operate init` and `planr operate doctor` (the
`operate-workspace-git` check) report the project's actual git status so you can
decide whether to commit the board alongside the code.

Raw evidence, prompts and responses, credentials, temporary transaction data,
locks, machine paths, and restricted material remain under user-local
`~/.planr/operate/` storage. Eligible internal evidence uses a bounded TTL and
mode `0600`. Inspect or purge it explicitly:

```bash
planr operate cache status
planr operate cache purge
```

Evidence is untrusted data. The selected native coding runtime investigates the
workspace with its own read-only tools and returns only bounded, citation-bearing
Protocol v1.3 advisor results. OpenPlanr validates those citations, scans the
result for secrets, and never promotes repository content into system
instructions. A lens becomes `not_evaluated` when the runtime cannot provide the
required evidence; OpenPlanr never fills that gap with generic model advice.

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

### Native evidence investigation

OpenPlanr no longer maintains a second repository collector, file-import
pipeline, source registry, or per-profile evidence budget. The Claude Code,
Codex, or Cursor adapter receives one bounded role mandate and investigates the
control and configured component repositories through the runtime's native
read-only harness. The runtime returns concise claims with file, Planr-artifact,
or Git citations; OpenPlanr validates the result and deterministically reduces
it into findings, gaps, routes, and projections.

The persisted Protocol v1.2 compatibility fields remain frozen for existing
artifacts, but they are not user-tunable and do not cause OpenPlanr to copy the
repository into an intermediate JSON evidence pack. Data that is not available
to the active runtime is reported as a readiness gap, not silently omitted.

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
planr operate report --json
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
