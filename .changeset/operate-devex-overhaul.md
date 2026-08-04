---
"openplanr": minor
---

Make the Operating Board's contracts visible to the agents they bind, and its state visible to the surfaces that render it.

A full board cycle run through real coding agents took fourteen schema rejections, three
lease expiries, and a Chair that could only be recorded with zero actions — every failure
traced to a contract that was enforced precisely and disclosed nowhere. This release fixes
the habit, not just the symptoms.

**The response contract ships inside every mandate.** `harness prepare` now discloses the
response `jsonSchema`, the per-role proposal cap, and the allowed proposal types — the
exact values the record path enforces. A new `planr operate harness validate` dry-run
checks a payload with the same validator as `record`, returns **every** violation in one
response, and consumes no lease and no idempotency key.

**The Chair can propose again.** Its proposal bounds are now derived from the operating
registry — the runtime and the registry can no longer disagree — so a consolidation with
real route proposals records instead of being rejected wholesale. Registry agreement is
asserted for every role by iterating the registry itself.

**Citations accept what mandates authorize.** The record-time anchor is aligned with the
v1.4 citation contract: dot-prefixed roots (`.github`, `.planr`, …) anchor with line
precision; backlog (`BL-`) and quick-task (`QT-`) artifacts are citable; citations into
sibling workspace components resolve against that component's checkout, and a component
that cannot be resolved is reported honestly as unresolved — never as fabricated. A second
stale copy of the old pattern in the git read layer was found and aligned too.

**The lease is a visible deadline.** Every harness handoff carries `session.expiresAt` and
`leaseTtlSeconds`; recording renews the lease; the default window now comfortably outlasts
a long single-agent dispatch and is tunable via `OPENPLANR_ADAPTER_LEASE_MS`.

**The dashboard can finally see cycles.** The CLI emits a public, read-only projection at
the paths the pipeline dashboard reads — a deliberate un-retirement of the v1.3 path as a
derived surface, including a fix for a storage-migration collision that would otherwise
have silently deleted the projection on the next write.

**The CLI stops succeeding silently.** The non-interactive `operate init` that printed
nothing and exited 0 now states what input is needed and exits with the input-required
code; unrecognized result shapes always render something; `inspect` points first-time
users at the research-first path; and `planr operate report --html` renders a cycle as a
self-contained page ready for `planr artifact open`.

**Commitment conflicts are representable and visible.** An advisor can record a conflict
between an action and a published commitment (one action key plus the commitment
reference), and the rendered conflict line carries the commitment's statement and source.

A cross-component conformance suite now asserts the seams that failed — mandate roots are
citable, registry equals runtime, the projection writer and the dashboard reader name the
same paths, disclosed contracts equal enforced contracts — so this class of skew fails CI
instead of a live cycle. The release workflow also gains a post-publish check that turns
manifest drift into a red run instead of a silent gap.
