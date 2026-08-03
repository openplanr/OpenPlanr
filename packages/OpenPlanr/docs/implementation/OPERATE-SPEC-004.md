# OPERATE-SPEC-004 — OpenPlanr agentic execution implementation

Status: planned  
Umbrella spec: `SPEC-004-operating-board-agentic-execution` (planr-pipeline)  
Ecosystem operation: `OPERATE-SPEC-004`  
Source version: `1.16.2`  
Target version: `1.17.0` (Changesets minor)  
Contract dependency: `planr-pipeline@0.33.0` (Protocol v1.3 — must be published before this work merges)

## Repository boundary

This repository owns the runtime half of every SPEC-004 functional requirement:
the live evidence index, mission-packet dispatch, bounded-tool enforcement,
citation resolution against real repositories, the storage-layout migration,
route handlers, brief rendering, cadence state, and the skill-first cycle.
Protocol v1.3 schemas, the citation/migration/cadence pure modules, generated
lens agents, and conformance fixtures are consumed from `planr-pipeline@0.33.0`.
This repository does not write into sibling repositories.

Relationship to `OPERATE-SPEC-003` (guided runtime experience): this spec
EXTENDS two SPEC-003-owned surfaces rather than owning disjoint territory —
evidence diagnosis/classification (E-001 adds index classification, sensitivity,
and signals) and setup/doctor (E-010 adds v1.3 layout checks). Both extensions
are strictly additive to the SPEC-003 contracts: no guided question, answer,
diagnosis, or doctor behavior changes shape. Question/answer interaction remains
SPEC-003-owned; where a mission cycle needs a user decision it routes through
the existing guided surfaces unchanged.

## Work items

Each item lists its umbrella FR, the engine deliverable, and binding DoD.
Every item builds on the published pipeline modules — nothing pure is
reimplemented here.

### E-001 — Live evidence index and mission-packet state (FR1)

Build `operating-evidence-index-item@1.3.0` records from the real workspace:
path, pinned revision, content hash, source, classification, freshness,
sensitivity, and detected signals — **no file bodies**. The index extends the
SPEC-003-owned evidence diagnosis surface additively (same classifier, new
fields). **Pin the cycle revision at cycle start** and record it in the cycle
manifest and every index item; all citation resolution binds to this pin.
**Source the packet's non-evidence payload from live cycle state**: charter and
current goals, prior-cycle summary, open decisions/gaps/pending outcomes,
planning and delivery status, and `declaredRoots` — the pipeline's
`createOperatingMissionPacket` receives them as inputs; the engine owns
producing them. **Mission budgets are defined in the v1.3 derived registry**
(single-digit-KiB targets per FR1), never by mutating the v1.2 on-disk budget
values, which pack mode still requires; surface
`E_OPERATE_MISSION_PACKET_BUDGET` through the CLI with the offending role
named. DoD: index built from a real git workspace respects sensitivity
ceilings and ignore rules; the pinned revision is recorded once and identical
across manifest, index, and packets; packets carry charter/prior-cycle/status
payload sourced from real state; every demo-project packet meets the
single-digit-KiB mission budget from the derived registry; oversized
construction fails closed before any dispatch; no body bytes appear in any
packet (content-scan test).

### E-002 — Bounded read-only dispatch (FR2, FR4)

Consume the v1.3 mission branch of the pipeline's adapter handoff. Native
dispatch runs the generated lens agents with exactly the granted tool set,
path-confined to declared roots. **Sensitivity ceilings apply at read time**:
each role's declared roots are narrowed (or deny-listed) so no file above the
role's ceiling is readable even inside a granted root — the pack-era
filter-before-handoff guarantee is preserved under agent-driven reads. **Fan
out native mission lenses in parallel where the adapter reports
`parallelDispatch: true`**, sequentially otherwise. FR4 reconciliation,
recorded explicitly: FR4 says Codex SHOULD dispatch natively, but FR2's
fail-closed rule overrides it — `codex` (`toolIsolation: advisory`) and
`cursor` route to the structured provider path until their isolation is
enforceable. **Add a mission honeytoken suite; keep the SPEC-002 empty-tool
suite fully intact** — the pack path (E-004 rollback) still requires its proof;
`dispatchMode` selects which suite governs which dispatch. DoD: mission
honeytokens prove write, exec, network, environment read, root-escape, and
above-ceiling-read are each refused while in-root permitted reads succeed; the
v1.2 empty-tool honeytoken suite still passes unmodified; parallel and
sequential fan-out both function; a runtime that cannot enforce the grant never
receives a native lens.

### E-003 — Citation resolution runtime (FR3)

Resolve every returned citation against the cycle's pinned revision using the
existing read-only git provider; snapshot cited content into machine-local
evidence through the standard redaction + secret-scan path; attach evidence IDs
to the finding; reject unresolvable citations via the pipeline's fail-closed
resolver and open the derived gap. Wire into `adapter record`/`finalize` so an
unresolvable citation can never reach consolidation. **Resolve all three
citation kinds**: repository path+range and git revision via the read-only git
provider, and **planr artifact IDs** against `.planr/` artifacts (snapshotting
artifact content with the same redaction path; `artifactExists` fact computed
by the engine). **Dirty-working-tree policy**: the pin is taken at cycle start;
uncommitted changes are surfaced at collection as a workspace warning, and a
citation into uncommitted content resolves against the pinned revision —
rejection messages must name the dirty-tree cause distinctly from
`fabricated-path` so legitimate findings are not silently discarded. DoD: e2e
on a real repository — valid citation snapshots byte-faithfully at the pinned
revision; fabricated path, wrong line range, and moved-revision each reject the
proposal and surface one gap; a planr artifact citation resolves and snapshots;
a citation into dirty uncommitted content produces the distinct dirty-tree
rejection, not `fabricated-path`; snapshots carry sensitivity inherited from
the cited file; a secret in cited content is redacted in the snapshot and never
persisted raw.

### E-004 — Dispatch-mode coexistence (FR4, FR10)

Per-role `pack | mission` routing from the derived v1.3 registry (all lenses
default `mission`); the v1.2 pack path remains fully operational for any role
rolled back — governed by the intact empty-tool honeytoken suite (E-002).
**Add a per-project override** in the operating config
(`dispatchModeOverrides: { <roleId>: "pack" | "mission" }`) so an operator can
roll a single lens back without waiting for a registry release; the derived
registry default applies where no override exists. DoD: a mixed-mode cycle
configured via the override (one role `pack`, rest `mission`) completes;
reduced events are byte-identical across parallel and sequential dispatch and
across dispatch order; v1.2 projects run unmodified.

### E-005 — Storage layout migration (FR5)

Apply the pipeline's lossless transform through the write-ahead journal:
`records/sha256/**` → `.state/records.jsonl`, events/checkpoint under
`.state/`, readable Markdown at the top (`charter.md`, `brief.md`,
`cycles/CYCLE-NNN/board/*.md`, `findings.md`, `decisions.md`, `gaps.md`,
`routes.md`, `evidence-index.json`). **Migration is automatic**: any operate
command that opens a SPEC-002-layout project detects it and migrates through
the journal before proceeding (with the same crash-safety), in addition to the
explicit `operate migrate` inspect/apply/rollback surface. Reversible via the
inverse transform. DoD: opening a v1.2 project with any mutating operate
command performs the migration automatically and journal-safely; migrating a genuine
SPEC-002-era project preserves every record digest and event (verified by
checkpoint revalidation); rollback restores the byte-exact prior layout; a
crash injected mid-migration recovers cleanly; new projects initialize directly
into the v1.3 layout; every lens report renders as Markdown including
`not_evaluated`.

### E-006 — Route handlers (FR6)

Implement `create-quick-task` against the v1.3 route plan; keep spec, decision,
and agent-artifact routes working under v1.3 findings. Accept ≠ apply, digest
preview, and rollback semantics unchanged. DoD: an accepted small finding
applies to a real quick-task file through the journal with provenance; rollback
is byte-exact; no route invokes SHIP (R1 test retained).

### E-007 — Decision-brief rendering (FR7)

`operate brief` / `operate decisions show` render self-contained artifacts via
the SPEC-001 sandbox: question, cited evidence, options, and what the decision
blocks — readable without a terminal, local, share-on-request only. DoD:
artifact renders offline under the opaque-origin sandbox; sharing requires the
explicit existing share flow; nothing publishes automatically; sensitivity
ceilings hold in rendered content.

### E-008 — Cadence state (FR8)

Store `lastRunAt` per project; surface due-ness in `operate status` via the
pipeline's pure calculator with the injected clock; a cadence-triggered run
stops at `reviewable` and never accepts findings, applies routes, or invokes
PLAN/SHIP. DoD: status shows `nextDueAt` for weekly/monthly and null for
manual; clock injection keeps tests deterministic; the never-acts guarantee has
an explicit test.

### E-009 — Skill-first cycle (FR9)

The regenerated runtime surfaces drive one complete cycle — inspect → init (if
needed) → run → native lens dispatch → record → finalize → chair → review —
with the user never typing an adapter lifecycle command. The CLI remains the
authoritative state machine underneath. DoD: a scripted end-to-end run from a
bare project to a reviewable brief issues every adapter call from the skill
path; JSON mode parity holds; Codex and Cursor fall back per E-002.

### E-010 — Hardening, doctor, packed install

Doctor checks for v1.3 state (layout version, records log integrity, dispatch
mode validity) — additive extensions of the SPEC-003-owned doctor surface;
packed-install e2e updated for the new layout and `planr-pipeline@0.33.0`;
**update the pinned pipeline fixture ref `v0.32.1` → `v0.33.0` in all three
workflows (`ci.yml`, `publish.yml`, `release.yml`) and the exact
`optionalDependencies["planr-pipeline"]` pin** — note the ordering constraint:
tag `v0.33.0` must exist before any CI leg can go green (E-011 sequencing).
Six-platform CI green; first-cycle golden path on a clean HOME stays ≤ 5
minutes. DoD: doctor names any v1.2/v1.3 inconsistency with a repair; packed
test passes with only `planr` on PATH; all four pins reference `0.33.0`; full
suite green on macOS/Linux/Windows × Node 20/22.

### E-011 — Coordinated release and ecosystem alignment

Four participants, released in order, each from its own branch/PR/tag:

1. `planr-pipeline@0.33.0` (already prepared by the umbrella's DEV run) —
   tag `v0.33.0` is the precondition for every OpenPlanr CI leg (E-010).
2. `openplanr@1.17.0` — Changesets minor pinned to `planr-pipeline@0.33.0`
   (exact `optionalDependencies` pin + the three workflow refs, E-010).
3. **`@openplanr/skills` (named participant, target `1.19.0`)** — the skill
   runtime half of FR9: mirror regenerated from the published pipeline
   templates, repository release/tag, `cliRange ^1.17.0`. The umbrella
   verification bullet "a full cycle without typing an adapter command" is
   proven here end-to-end against the published CLI.
4. Marketplace last — full alignment, not ranges only:
   - `ecosystem.json` component versions and ranges
     (`cli ^1.17.0 / pipeline ^0.33.0 / skills 1.19.0`);
   - **protocol block**: `protocol.current: "1.3.0"`,
     `protocol.supported` += `"1.3.x"`,
     `capabilities.operatingBoard.protocolRange` widened to include `^1.3.0`;
   - **adapter capability rows**: `operatingAdvisorDispatch` re-published per
     the E-002 classification (`claude-code: native-read-only`,
     `codex/cursor: structured-provider`) in `adapters[]` and
     `capabilities.guidedOperatingBoard.advisorDispatch`;
   - **`.claude-plugin/marketplace.json` plugin pins** bumped
     (`planr-pipeline 0.33.0`, `openplanr 1.17.0`) so installed runtimes
     actually receive the generated `agents/operating/*` lenses;
   - a `releaseOperation` ledger entry for `OPERATE-SPEC-004` recording real
     branches, commits, PRs, tags, and integrity hashes.

Published packages are forward-fix only. DoD: release order holds with the tag
precondition respected; every surface above is updated in the same marketplace
PR; canary evidence recorded; no participant claims a phase it has not reached.

## Verification (release-blocking)

- honeytoken rewrite proving the read-only/path-confined boundary (E-002);
- live fabricated-citation e2e failing closed (E-003);
- real-project migration with digest-complete round-trip and crash recovery (E-005);
- mixed dispatch-mode determinism (E-004);
- quick-task route apply/rollback byte-exactness (E-006);
- sandboxed offline brief rendering (E-007);
- cadence never-acts test (E-008);
- skill-first zero-adapter-command cycle (E-009);
- packed install, clean HOME, six-platform CI, ≤ 5-minute first brief (E-010);
- release-order and ledger honesty checks (E-011).

## Required release evidence

- branch, commit, PR, approvals, and CI checks;
- `openplanr@1.17.0` npm version, tag, provenance, and tarball SHA-256;
- exact compatible `planr-pipeline@0.33.0`;
- packed clean-HOME test with only `planr` on `PATH`;
- deterministic demo/preview tests and the E-003/E-005 e2e evidence;
- real-runtime canaries where credentials are available.

## External action boundary

Merges, npm publication, tags, and marketplace promotion remain separately
authorized human actions. Nothing in this spec deploys, publishes, spends,
contacts customers, or invokes SHIP. R1 is mandatory throughout.
