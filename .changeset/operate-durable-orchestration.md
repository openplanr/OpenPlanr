---
"openplanr": minor
---

Operate durable orchestration (SPEC-005): per-role durability, honest state, and a
one-invocation review gate. Bundled pipeline dependency pinned to
`planr-pipeline@0.39.0`. Every claim below is backed by a named passing test;
coordinated sibling releases still in flight under this same version are described
as landing with the release, never as a phase this repository has already verified.

**The field fix that matters most: the advisor fan-out no longer deadlocks on a
hung lens.** The pre-driver fan-out awaited every advisor together, so one lens
stalling left the whole `Promise.all` unresolved while completed analyses sat
unrecorded and the shared lease expired underneath them. Dispatch now runs through
a deterministic lifecycle driver with bounded per-role retry, a per-attempt
timeout, and an automatic lease heartbeat that renews independently of any role
recording. A stalled non-required lens is resolved `not_evaluated` with a governed
gap while its siblings record and the cycle reaches Chair. Proven by
`tests/integration/operate-lifecycle-chair-wiring.test.ts` ("terminates a stalled
lens not_evaluated while siblings record, renews the lease, and reaches Chair") and
`tests/unit/operate-lifecycle-driver.test.ts` ("resolves a role past its retry
budget to not_evaluated with a governed gap without blocking siblings" and "renews
the lease as the window approaches without any role completing").

**Immediate per-role commit and an engine-managed heartbeat lease.** Each advisor
result is validated, recorded, persisted, and reflected in cycle progress the
moment it returns, and survives a sibling stalling; recording never waits on the
batch. Proven by the lifecycle-driver state-machine and heartbeat suites in
`tests/unit/operate-lifecycle-driver.test.ts`.

**Partial validated progress and honest status/report.** Every recorded lens is
inspectable before Chair finalizes, and a mid-cycle report renders recorded lenses
with their real analysis plus the exact recovery action for pending roles — an
active advising cycle is never described as quiet. Proven by
`tests/integration/operate-partial-report.test.ts` ("renders recorded lenses with
their real analysis and the exact recovery action for pending roles").

**Chair works with partial valid boards.** Chair consolidates the recorded,
verified board and surfaces an absent lens as an explicit gap; it never invents a
missing lens's conclusions, and it stays closed while a structurally-required role
is only `not_evaluated`. Proven by `tests/unit/operate-lifecycle-driver.test.ts`
("holds the Chair closed while a structurally-required role is only
not_evaluated") and the chair-wiring happy-path test above ("records a five-lens
board and reaches Chair with no fabricated gap on the happy path").

**Owned scratch storage with a `doctor --fix` cleanup.** Operate scratch lives
under an OpenPlanr-owned, project-and-machine-keyed path recorded in an ownership
manifest, cleaned automatically after record/finalize, detected by `doctor` when
abandoned, and removed by the FR7-named `planr doctor --fix` — which acts only on
scratch a valid ownership manifest confirms is ours, never on an unrelated file
under the scratch tree. Proven by `tests/unit/operate-doctor-staleness.test.ts`
("warns on abandoned owned scratch and removes only it, leaving other
machine-local caches") and `tests/unit/operate-doctor-fix-wiring.test.ts`
("removes abandoned OpenPlanr-owned scratch and leaves an unrelated file
untouched").

**Completion discipline.** Completion requires on-disk verification of every
phase-F artifact and flips to incomplete when any is removed or abandoned owned
scratch remains. Proven by `tests/unit/operate-completion.test.ts` ("reports
complete only with every phase-F artifact, and flips when any is removed").

**Legacy operating-profile migration.** `planr operate profiles migrate
inspect|apply` detects a legacy profile, previews and converts the supported
subset, writes an exact pre-migration backup, and is idempotent — the CLI never
suggests a profile it will reject. Proven by
`tests/unit/operate-profile-migration.test.ts` ("writes an exact pre-migration
backup and rewrites the profile to the supported subset" and "is idempotent: a
second apply reports already-applied and makes no further change").

**Bundled pipeline pin.** The packed CLI carries
`optionalDependencies.planr-pipeline = 0.39.0`, asserted by
`tests/e2e/operate-packed-install.test.ts` and
`tests/e2e/operate-guided-packed-install.test.ts`.

Coordinated, not yet released with this changeset: `@openplanr/skills@1.24.0`
(thin workflow regeneration) and the marketplace ledger and real-runtime canary
land only after `planr-pipeline@0.39.0` and this `openplanr` version publish.
