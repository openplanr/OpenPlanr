# ADR-010: Operating Board Agentic Execution (Protocol v1.3)

## Status

Accepted

## Context

ADR-006 established the Operating Board under Protocol v1.2 as a correct
governance engine: event sourcing, a write-ahead journal, deterministic
consolidation and scoring, digest-bound route previews, and human governance.
Its execution model, however, is inverted. SPEC-002 requires advisory lenses to
run with **enforced empty-tool isolation**, so the engine must pre-load the
repository into a JSON role pack and then ask a tool-capable coding agent to
reason without looking at anything.

Production use exposed the defect. A single CTO role pack on a real product
repository measured 405,820 bytes against a declared `maxInputBytes` of 393,216,
carried 85 evidence items, duplicated 274,778 bytes of source text, and enforced
its byte budget nowhere. The size overrun is a symptom; the root defect is that
the collector must choose what matters before the question is known. A lens
investigating payment idempotency needs different files than one investigating
activation, so pre-loading 85 files is simultaneously too much and never the
right file.

The SPEC-002 isolation clause is normative and the conformance suite enforces
it, so any implementation that grants advisory agents read tools **fails
SPEC-002 conformance**. The clause is the defect, so the clause must change.
Protocol increments to **1.3.0 additively**: v1.2 readers continue to read v1.2
artifacts unchanged, and the role registry carries `dispatchMode:
"pack" | "mission"` so both execution models can run during migration.

## Decision

Keep every SPEC-002 governance guarantee and replace only the execution model.
The dispatched lens receives a compact, digest-bound **mission packet** that
carries the charter, prior-cycle summary, planning status, role
mandate/authority/output contract, declared read-only roots, a bounded tool
grant, and an **evidence index** of pointers — path, revision, content hash,
source, classification, freshness, sensitivity, and detected signals — with **no
file bodies**. `maxInputBytes` is enforced at construction and fails closed with
a named, role-scoped error. Native advisory agents investigate with bounded
read-only tools (file read, glob, content search, and `git log/show/diff/blame`)
confined to their declared roots; runtimes that cannot enforce that boundary
fail closed to the structured provider path. Every proposal cites repository
paths, line ranges, revisions, or planr artifacts bound to the cycle's pinned
revision; the engine resolves and snapshots each citation after the fact or
rejects the proposal and opens a release-blocking gap.

### Amendment record against SPEC-002

| SPEC-002 clause | SPEC-004 replacement |
|---|---|
| Advisors run with enforced *empty-tool* isolation | Advisors run with enforced *read-only, path-confined* tool isolation |
| Honeytoken proves advisors cannot access files | Honeytoken proves advisors cannot **write**, **execute**, reach the **network**, read the **environment**, or escape **declared roots** |
| Role pack embeds role-filtered evidence bodies | Mission packet carries an evidence **index**; bodies are read by the agent on demand |
| Findings cite evidence IDs present in the input | Findings cite **repository paths, line ranges, revisions, and planr artifacts**, resolved and snapshotted by the engine |
| — | **New:** unresolvable citations reject the finding (release-blocking) |

Verifying citations after the fact is strictly stronger than pre-loading
everything beforehand: a fabricated citation now fails closed, where previously a
model could confabulate over a dump and nothing would catch it.

### Remains binding, unchanged

Everything else in SPEC-002 stays in force exactly as ADR-006 recorded it:

- event sourcing (append-only hash-chained event stream);
- the write-ahead journal (WAL) for durable, recoverable writes;
- deterministic consolidation and scoring;
- accept ≠ apply (route acceptance is governance only; application is a
  separate, digest-bound mutation);
- digest-bound route previews;
- byte-exact rollback;
- typed outcomes;
- R1 (nothing may invoke SHIP; PLAN review stays mandatory for spec routes);
- evidence framed as untrusted data, never as instructions;
- the post-output secret scan (snapshotted citation content is subject to the
  same redaction and secret-scanning rules as collected evidence).

**Determinism is unaffected.** SPEC-002 requires byte-equivalent *reduced*
events from the same validated results and explicitly does not expect live
models to agree. Reduction stays deterministic code, so identical validated
results reduce byte-identically across parallel and sequential dispatch.

## Consequences

- The advisory context shrinks from hundreds of kilobytes of duplicated source
  to a single-digit-kilobyte index, and the budget is enforced rather than
  advisory.
- Auditability improves: a fabricated path, a wrong line range, and a stale
  revision each reject the proposal and open a gap instead of silently entering
  the record.
- `planr-pipeline` owns the additive v1.3.0 schemas, the extended role registry
  contract, citation and mission-packet contracts, and their conformance;
  OpenPlanr owns validation, mutation, evidence indexing, citation resolution,
  and projection writing at runtime.
- Migration from the SPEC-002 directory-per-digest-prefix record layout to a
  single append-only `.state/records.jsonl` is automatic, reversible, and
  lossless, asserted by before/after record and event counts on the migration
  record.
- v1.2 and v1.3 execution coexist per role via `dispatchMode` until every role
  is migrated.

## Rejected alternatives

- Patching the SPEC-002 empty-tool clause in place rather than recording an
  explicit amendment, which would leave an implementation drifting from a
  contract it still nominally claims.
- Continuing to pre-load role-filtered evidence bodies and merely enforcing the
  byte budget, which does not fix "choose what matters before the question is
  known."
- Letting advisory agents run build steps, test suites, or arbitrary commands
  (deferred), or opening network, environment, or write access of any kind.
- Bumping the v1.0/v1.1/v1.2 schema namespaces instead of adding v1.3.0
  contracts additively.
