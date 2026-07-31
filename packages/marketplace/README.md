# OpenPlanr Marketplace

Official Claude Code plugin marketplace for [OpenPlanr](https://github.com/openplanr).

## Claude marketplace install

```
/plugin marketplace add openplanr/marketplace
```

Then install any of the plugins below:

```
/plugin install <plugin-name>@openplanr
```

## Plugins

<!-- ecosystem-table:start -->
| Component | Version | Compatibility |
|---|---:|---|
| OpenPlanr CLI | 1.17.0 | pipeline ^0.33.1 |
| Pipeline package/plugin | 0.33.1 | CLI ^1.17.0 |
| Runtime skills | 1.19.0 | CLI ^1.17.0 |
| Protocol | 1.2.0 | reads v1.0 artifacts; additive capabilities through v1.2.0 |
<!-- ecosystem-table:end -->

<!-- plugin-table:start -->
| Plugin | Version | Description |
|---|---|---|
| [`planr-pipeline`](https://github.com/openplanr/planr-pipeline) | 0.33.1 | Complete PO, Design, Review, DEV, and QA workflow with universal HTML artifact review and private sharing. |
| [`openplanr`](https://github.com/openplanr/skills) | 1.19.0 | Unified operating, planning, artifact review, and delivery workflow skills for the certified runtimes. |
<!-- plugin-table:end -->

Versions in this README mirror `.claude-plugin/marketplace.json`; keep both in the same release-train change.

## Operating Board capability

<!-- operating-capability:start -->
**Resolved status:** `available`

OpenPlanr Operating Board is certified for claude-code, codex, cursor through `planr operate`.

Resolved component versions: pipeline 0.33.1, CLI 1.17.0, skills 1.19.0, marketplace 1.4.0.
<!-- operating-capability:end -->

`planr operate` is the recurring evidence-to-decision control plane. It creates
cited briefs, decisions, data gaps, and reviewed routes while preserving the
separate PLAN review and SHIP invocations. Availability is generated only when
the Protocol v1.2 contracts, CLI command, thin runtime skill, and all certified
adapter entrypoints resolve to compatible released versions **and**
`OPERATE-SPEC-002` is verified against authoritative PR, commit, CI, tag, npm,
tarball, manifest, and Operating canary state. Per-adapter support remains
declared but unavailable until that global gate opens. Local version bumps
alone never unlock the capability.

The public behavior is the same across Claude Code, Codex, and Cursor:
`--preview` performs no writes or provider/model calls, while `--dry-run` may
use a disclosed, consented provider but commits no operating state. `operate
init` owns source and bounded JSON/CSV import configuration. Accepting a finding
records governance only; applying its route is a separate digest-bound action.
Answered gaps remain open until `gaps verify` cites explicit evidence.
Pipeline-PO DEV routes pause at `awaiting-plan` for the exact native PLAN
invocation and resume only after matching planning provenance. A later
`run --review-only` may observe verified shipment proof and due outcomes, but
Operating Board never invokes SHIP.

One explicit request to run a cycle may continue its reversible local native
adapter lifecycle through independent advisors, Chair consolidation, and a
reviewable result without manual internal commands. Adapter metadata declares
`native-isolated`, `native-bounded`, or `structured-provider` dispatch.
`planr operate report` renders the brief plus separate CEO, CTO, CPO, CMO, COO,
and Chair results as Markdown or strict JSON and includes exact governed
conversion commands for specs, tasks, and quick tasks. The visual dashboard is
optional.

## Guided Operating Board capability

<!-- guided-operating-capability:start -->
**Resolved status:** `available`

Guided Operating Board is certified for claude-code, codex, cursor through `planr operate`.

Candidate component versions: pipeline 0.32.1, CLI 1.16.1, skills 1.18.1, marketplace 1.3.1.
<!-- guided-operating-capability:end -->

The guided capability lets certified runtimes present CLI-owned questions and
typed next actions without reconstructing commands or expanding authority. Its
separate `OPERATE-SPEC-003` ledger preserves the already verified SPEC-002
Operating Board capability and records the independently verified
0.31/1.15/1.17/1.2 release train.

Planning-only installations keep help, `operate inspect`, and `operate demo`.
Protocol-dependent commands fail before provider use with
`E_PIPELINE_NOT_INSTALLED` and the exact full-install recovery command.

## Coordinated ecosystem releases

The four repositories promote in this order: pipeline → CLI → skills →
marketplace. A marketplace draft PR holds the append-only operation ledger
while each participant prepares and verifies its own commit, checks, PR, and
package. Every ledger participant also binds its repository-local implementation
work item. This is a coordinated saga, not a claim of cross-provider atomicity:
the coordinator reconciles actual GitHub/npm state on resume and uses a
forward-fix after publication.

The strict contract is
[`schemas/ecosystem-operation.schema.json`](./schemas/ecosystem-operation.schema.json);
[`examples/ecosystem-operation.json`](./examples/ecosystem-operation.json)
shows the prepared release shape. Ledger validation never publishes, merges,
or mutates another repository. Resume first compares an authoritative
live-state snapshot of PRs, commits, tags, CI checks, npm tarballs, the resolved
manifest, and immutable canary evidence:

```bash
npm run reconcile:operation -- operations/OPERATE-SPEC-002.json live-state.json
```

For the guided release train, use
`examples/guided-operate-operation.json`. Subsequent forward-fix trains preserve
that verified ledger and use a revisioned operation such as
`examples/native-operate-operation.json`. A revision suffix identifies a new
release transaction for the same umbrella specification; it does not rewrite
the earlier operation. The current operation becomes verified only after
authoritative PR, commit, tag, npm, tarball, reconciliation, and canary evidence
all match.

The operation digest and approvals bind promotion to the reviewed targets.
Verification additionally requires passed, digest-addressed evidence for the
packed CLI, Protocol v1.2, event replay/corruption rejection, security
boundaries, and outcome reconciliation. The read-only
`Operating Board release canary` workflow produces this evidence but cannot
edit the ledger or mark a release verified.
Once any package is published, rollback compensation is forbidden: recovery is
a new forward-fix operation, while the marketplace manifest remains withheld
until every required release is verified.

### Marketplace closeout

Marketplace closeout is deliberately two-step because the draft ledger cannot
truthfully record its own merge commit or the tag created from that merge:

1. Keep the ledger PR open and the generated Operating Board capability
   `unavailable` while the pipeline, CLI, and skills are released and verified.
   Record their immutable commits, PRs, tags, package/tarball digests, and
   checks in the open ledger.
2. Merge that still-unavailable ledger PR. Tag and verify the operation's
   marketplace target version from the merged revision. This installs the
   canary workflow on the default
   branch without exposing the guided capability.
3. Run the exact-commit canary against the released pipeline, CLI, and skills.
   Preserve its immutable report, then open a follow-up finalization update.
   Record the merged ledger PR, marketplace tag and digest, canary evidence,
   final participant digests, and authoritative reconciliation. Append
   `reconciliation.recorded` followed by `operation.verified`, then regenerate
   the compatibility manifest.
4. Merge the finalization update only after `npm run check`, `npm test`, the
   exact-commit canary, and live-state reconciliation are clean. That merge is
   the first point at which
   `operatingBoard.status` and per-adapter availability may become `available`.

The marketplace tag proves the versioned release; the finalization update
proves that post-merge facts were observed. No second package publication is
implied. If any fact drifts between those steps, keep availability withheld and
follow the operation's exact recovery action.

## Cross-runtime support

OpenPlanr is the dedicated planning CLI and common runtime control plane. The
pipeline is the complete delivery workflow and includes feature-local planning.
Install and configure all detected certified runtimes through one surface:

```bash
curl -fsSL https://openplanr.dev/install.sh | sh
cd my-project
planr setup
planr doctor
```

The web installer installs only the CLI. Guided setup runs separately in an
interactive terminal, displays detected coding agents, and defaults to safe
user scope. Project scope requires a Git or initialized OpenPlanr project.
When Claude Code is selected at user scope, the confirmed setup refreshes this
marketplace and installs or updates `openplanr@openplanr` and
`planr-pipeline@openplanr` to compatible versions. `planr doctor` reports
version or plugin-identity drift read-only; restart Claude Code after an update.

## Artifact review and private sharing

Compatible OpenPlanr CLI and pipeline releases provide a runtime-neutral review surface:

```bash
planr artifact ./artifact.html
planr artifact share ./artifact.html
planr artifact import "<returned-review-url>"
```

One generic artifact is an edge-to-edge `document` review by default. Its
minimal floating action rail exposes one-shot comments, the comments drawer,
and sharing without competing with the artifact itself.
Multi-variant and design-board workflows keep the zoomable `canvas` surface;
users can override either choice with `--presentation document|canvas`.
Complete local HTML/CSS/JavaScript is bundled into an invisible opaque-origin
sandbox. Review links are not standalone website deployments.

Sharing is never automatic. New generic shares create one stable AES-256-GCM
encrypted live room: anyone with the review URL can comment and see updates in
open tabs, while only the separate creator manage URL can pause comments, set
the final verdict, or delete the room. `--snapshot` keeps the explicit
fragment-only or encrypted-short-link alternative. Cloudflare stores ciphertext
only and the decryption key remains in the URL fragment at
`share.openplanr.dev`. Claude Code, Codex,
and Cursor all route artifact actions through the public `planr` command rather
than requiring the nested pipeline executable on `PATH`.

Compatibility matrix: [`openplanr/planr-pipeline/docs/compatibility-matrix.md`](https://github.com/openplanr/planr-pipeline/blob/main/docs/compatibility-matrix.md). Protocol spec: [`openplanr/planr-pipeline/docs/protocol/`](https://github.com/openplanr/planr-pipeline/tree/main/docs/protocol).

## License

Each plugin in this marketplace ships under its own license. The marketplace metadata itself is MIT.
