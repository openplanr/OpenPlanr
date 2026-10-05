# Reliable Design and Diagram Studio

The Studio workstream covers open, edit, save, share, review, revise and recover
across local Studio, encrypted reviews and the company library. This public
candidate supplies the document/canvas contracts, portable interface assets and
client transport. Hosted receivers, company authorization and company interface
adoption belong to dependent changes in the private web repository. Complete
cross-repository acceptance is required before release; public implementation
evidence alone does not establish deployment or publication readiness.

## Compatibility

Protocol v1.17 adds resource catalogs, bounded upload manifests, prepare/status/
commit receipts, company content references, preview bridge messages and diagram
presentation. Frozen versions remain byte-identical and old revisions remain
readable. Transport readers must be deployed before clients create new formats.

The canonical limit profile permits 100 MiB of unique reconstructed HTML, 128 MiB
of decoded resources plus catalog, 256 sources, 4,096 views and 1,024 resources.
Catalogs are limited to 8 MiB and public signed manifests to 64 KiB. Encrypted
chunks are at most 1 MiB including authentication tags, at most 129 chunks.
Independent resource compression falls back to identity encoding when it grows
content. The catalog follows the resource stream. Opening one view fetches the
catalog and that view's resources instead of the complete package.

Names, source digests and semantic review metadata remain encrypted. Exact
operation bytes and private recovery custody are saved before the first mutation.
Status and retry reuse those bytes. Missing/corrupt chunks cannot commit; only an
atomic revision/head/receipt commit makes a publication visible. Interrupted or
lost-response commits can be recovered from saved custody without another logical
publication. Service receivers stream bounded resource objects into R2, reclaim
abandoned staging after 24 hours and retain revocation tombstones.

## Trusted shell and isolated content

The shared React/TypeScript shell uses Radix-based components adapted to OpenPlanr
brand tokens. One compact header groups hierarchy, status, modes and actions.
Stable canvas and iframe mounts remain owned by the existing controllers. Review
and inspector rails fill the remaining height; narrow layouts use drawers.
Diagram, Design and Artifact badges have both color and readable labels.

A company prototype runs on a different site behind an authorized exact-revision
preview. Single-use tickets expire after 30 seconds; read-only leases expire after
five minutes and authorization is checked on reads and a 30-second heartbeat.
Tickets, leases and company credentials never enter uploaded content. Opaque
inner frames preserve native form validation with `allow-forms` while CSP blocks
submissions. The bridge accepts only origin/window/nonce/view-bound navigation,
selection, anchors and bounded state. It has no arbitrary fetch, execution or
company-write authority. Unsupported captures are explicitly incomplete and have
an accessible passive outline at the declared viewport.

Diagram shapes remain directly on the canvas. The new palette is versioned;
existing palettes and saved geometry remain unchanged. Geometry-changing renders
create an explicit new revision. Contrast and connector/title/label diagnostics
report actual theme and measured collisions. Mermaid imports reject reserved
identifiers; legacy exports disclose aliases and preserve round trips.

## Feedback and recovery

Transactional IndexedDB outboxes bind operations to actor, workspace and revision.
Exact retry bytes survive reload and offline use. Permanent failures are visible
and quarantined without blocking valid later feedback. Legacy queues are retained
during migration. Saved locally, pending and acknowledged are distinct states.
Concurrent save conflicts keep the draft editable and require explicit choices
for overlapping changes before another compare-and-swap save.

New room v3 creation uses distinct read/write/manage capabilities and authenticated
reads. Semantic commitments remain encrypted. Readers verify bounded pages and
must finish authenticated hydration before applying verdicts or mutations.
Capability fragments are consumed before authored frames mount; trusted custody
stays in memory. Context-bound paste encryption checks allowed origins before a
short-link fetch. Secret screening detects actual credential material rather than
ordinary variables or mock placeholders.

`~/.planr` is the default private home, with supported overrides. Legacy private
custody is safely read/moved only when the destination is absent. CLI credential
and sign-in copies retain their originals; private receipts prevent a later deletion
from re-importing old credentials. Existing destination records stay authoritative. Credential
writers and server startup use shared cross-process locks. `openplanr server list`
reports owned dashboards/Studios; `openplanr server stop <instance>` authenticates that
instance and drains work. It never kills a process from a port or reused PID.
Malformed state receives an actionable diagnosis and is not treated as missing.

## Source and generated ownership

Canonical checked interface and editor modules use `.mts` or `.tsx`. The compiler
emits `.mjs` runtime modules and `.d.mts` consumer declarations; emitted siblings
are ignored by Git and included in package projections. Existing handwritten
JavaScript remains canonical where it has not been converted. Its declarations
are reviewed source contracts, rather than compiler outputs. A module suffix
therefore identifies its format, not whether it is generated; generated files
carry a banner and their projection manifest records their source digest. Public
documentation describes capabilities and links to those inventories; changing
resource totals belong in manifests rather than repeated prose.

Protocol owns versioned schemas. Older schemas remain available for saved
revisions and frozen consumers; artifact, design, pipeline and host packages
receive generated projections. Changes add a new contract version instead of
editing historical schemas. Generation, declaration/export checks and packed
consumer tests verify these boundaries.

The React shell replaces interface chrome while existing canvas, document and
sandbox controllers retain their responsibilities. Several legacy controllers
remain large. Further decomposition should follow cohesive responsibilities and
behavioral tests; changing file extensions or splitting by line count would not
improve those boundaries.

## Release preparation and adoption

The existing package-specific Changesets policy remains authoritative. Protocol,
artifact and design changes are additive minor candidates; CLI and portable
pipeline updates use their established patch policy. Release PR #416 stays held
until implementation, package compatibility and final CI/re-review pass.
Candidate tarballs using current versions are local test evidence, not registry
releases. Private assets must be generated from exact packed public candidates,
with digests retained, then rebuilt from the actual released pins at adoption.
The public build job publishes a `studio-public-candidate` CI artifact containing
Protocol/pipeline tarballs and a commit-bound SHA-256 receipt. The linked private
checks adopt only explicitly selected, successfully built candidate archives after
verifying their identities and bytes. Release dependency pins remain unchanged
until package adoption; local overrides alone are not fresh CI evidence.

1. Bind final public/private candidates, acceptance evidence and rollback anchors.
2. Prove legacy and new readers against the exact packed candidates.
3. With separate deployment authorization, deploy additive share/company API
   readers first, retaining storage identities and old revision formats.
4. Provision the different-site preview Worker with only the fixed private Company
   RPC boundary. Verify origins, tickets, heartbeat, guest publication and revocation.
5. Adopt released public packages and regenerate private assets from those exact
   packages. Confirm format capability support before allowing new client creation.
6. Record legacy room cutover and original-expiry audit. New legacy creation stops;
   committed exact retries retain their original expiry, capped at cutover plus
   30 days. The security transition remains pending until the expiry verification receipt.

Merge, package publication and deployment are separate actions. Local browser and
Miniflare measurements do not establish production latency, availability or a
service deployment receipt.
