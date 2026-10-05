# `@openplanr/design`

Canonical MIT workspace package for deterministic design helpers and the local
design-loop engine. It depends on `@openplanr/artifact` and
`@openplanr/protocol`; shared primitives are re-exported from artifact to keep
the dependency graph acyclic.

Public `planr-pipeline` compatibility files are deterministic projections, not
an independent implementation.

This workspace is npm-private; its source remains part of the public MIT monorepo.
Its required runtime is distributed through the public CLI and pipeline packages.

## Professional design workflow

The active host agent performs consultation, source authoring, craft review and
revision through the canonical Design, Design Loop and Design Review skills.
`lib/design/utility.mjs` provides deterministic operations without a model,
provider credentials, a global CLI or downloaded runtime:

```sh
node lib/design/utility.mjs render /path/to/design-document.json
node lib/design/utility.mjs open /path/to/design-document.json --no-open
node lib/design/utility.mjs export /path/to/design-document.json --view prototype --output /path/to/review.html
```

The public CLI accepts the same document with `openplanr artifact open`. All three
views render the same authored local HTML/CSS/JavaScript. Protocol owns the
additive `v1.9.0/design-document.schema.json` contract; this package owns source
validation, rendering and the studio. Shared review serving, iframe isolation,
pin persistence and capture remain in the artifact package.

Canvas uses an unbounded camera rather than a document-sized scroll surface.
Artboards can cross the origin and move directly in Canvas mode; background,
Space-drag, middle-button and trackpad pan share one persisted camera, with
cursor-centered zoom and a separate viewport for each studio view. Screen
guidance lives in compact markers and an external Notes accordion so the authored
artboards remain production-like product surfaces. Prototype mode restores live
product interactions, and Annotate mode reserves the surface for review pins.

Walkthrough steps keep the previous screen painted while the next retained
iframe lays out, then use a short directional reveal. Rapid navigation coalesces
to the latest requested step; changing views cancels pending motion. Product
state and frame identities are preserved, controls stay fixed, and reduced-motion
preferences skip the animation. Only the review presentation is animated.

Keep `design-document.json`, local sources, assets and `design-spec.md` under
version control. Generated `.design/revisions/` snapshots and compatibility
`finalized.json` retain a recoverable working design. A render publishes only
after source, assets and all ten specification sections validate. Concurrent
feedback writes use revision and state-version checks; stale pins stay visible.

Browser readiness is separate from visual verification. `browser-audit.mjs`
checks computed styles, clipping, overflow, assets and focus; host screenshot
inspection and exercised journey evidence are required to mark a render verified.
Without browser evidence the artifact remains unverified. Design ends with its
specification handoff; Plan and Ship are separate user invocations.

## Persistent company review

`share.mjs` owns local private custody and explicit publishing. `workspace-client.mjs`
is the portable encrypted transport shared with the hosted viewer. Protocol's
additive design-workspace contracts describe immutable revisions and signed,
revision-bound feedback; existing generic artifact room contracts are unchanged.
The hosted companion lives in the separate `openplanr-web` repository.

A review URL contains only an opaque workspace identity. Reviewers enter a
separate 256-bit generated token. Domain-separated authentication and encryption
keys prevent the service from decrypting designs. Owner signing keys are saved
before network writes, outside the repository, with private filesystem permissions.
Publishing and rotation persist their exact pending request for idempotent retries.
Nothing publishes automatically on render. Production service rollout is separate
from local rendering and installation.

Notes provide an explicit close control, Escape/outside dismissal, and per-screen
information toggles, with viewport-contained scrolling and restored keyboard focus.

Focused checks run with `node --test packages/design/tests/*.test.mjs` from the
workspace root. Browser integration uses the locally available Playwright browser
or installed Chrome. Installed-skill checks live in
`tests/skill-runtime/design-installed-workflow.test.mjs`.

### OpenPlanr review chrome

The studio uses OpenPlanr's charcoal/mint palette and bundled Outfit and DM Sans
fonts. Product artboards retain their own design system. One header contains the
three views, Share design and icon-based Screens/Review toggles; both sidebars
collapse independently, and focused previews refit when their available space
changes. Mobile uses full-height sidebar drawers. Refinement instructions are
available under an expandable section in Review. Font copyright notices and
licenses travel with the canonical stylesheet, including portable exports.

### Team review and handoff

The studio shares reviewer orientation, resizable panels, screen thumbnails,
revision comparison, canvas presentation controls, and a read-only inspector
across the local review and hosted viewer. Author review purpose, questions,
and share-safe implementation guidance in sibling `review-context.json`.
Product and guidance fingerprints are independent of studio runtime changes.

Use `openplanr artifact handoff design-document.json` or the skill's bundled
`design.mjs handoff design-document.json --action draft` to prepare a factual
handoff. The active host agent refines it, preserving reviewer quotations and
source citations. The owner reviews and approves the exact draft in the local
studio. Approval does not resolve pins or run Plan. Future source, guidance,
selection, verification, or feedback changes mark the approval outdated;
approved snapshots remain preserved. Plan reads this alongside `design-spec.md`
when separately invoked.

Shared reviewers have a focused comment-and-pin interface. Question, Suggestion,
Request change and Blocker categories use labeled color badges; legacy Fix intent
is preserved. The owner studio retains implementation inspection and direction
refinement. Compact threads page progressively, search across all loaded replies,
and keep reply drafts while feedback updates arrive.

**Export reviews** downloads Markdown or JSON with original revision, artifact
digest, screen, responsive frame, stable anchor, coordinate space, authorship and
timestamps. The same projection is available with:

```sh
node lib/design/utility.mjs feedback /path/to/design-document.json --action export --scope all --format markdown --output /path/to/new-review.md
```

Exports do not accept changes or resolve pins. Missing historical mappings remain
explicitly stale, and the output never includes local sources or access credentials.

### Preview loading and responsive coverage

Studio starts with the selected screen and keeps at most three live product frames
on desktop and mobile. Each source/document/bridge phase has diagnostics, a bounded
load deadline and a retry action. One inactive failure does not block the selected
screen. Canvas leaves unloaded artboards as selectable placeholders; nearby screens
load within the same bound. Desktop thumbnails capture only paintable loaded frames.
Coarse-pointer and narrow devices use numbered navigation to avoid capture overhead.

Protocol 1.16 adds envelope 1.1 and review bundle 1.2. A screen/direction's HTML is
stored once, while each responsive frame retains its own artifact identity and
feedback. Local boards support up to 256 shared sources, 4,096 viewport references
and 100 MiB of canonical HTML. Limits are validated before bundling. Larger designs
need linked boards. Existing inline envelope and review-bundle contracts remain
readable and unchanged. Company publication converts to the hosted inline contract
and retains its existing byte/view limits; local coverage does not expand a hosted
service budget.

### Local opening, navigation and storage

`open` and `openplanr artifact open` return the actual `/studio/<design-id>/` address.
The root redirects to Studio or a design selector. Reopening the same revision and
configuration reuses the healthy owned service. Use the bundled utility's `studio
<document> --action status` or `--action stop` to inspect or stop that exact instance;
shutdown drains pending saves. Stop does not delete the design or feedback.

Local HTTP uses sandboxed srcdoc with an exact parent-origin binding. Portable
file exports use Blob frames bound to the opaque file origin. Both retain
`allow-scripts allow-forms` without same-origin authority. Do not serve a file
export over HTTP or modify its generated script to change origins; use the local
launcher. Host, Origin, Fetch Metadata and scoped session-cookie checks protect
short-route APIs. Private review session routes remain supported separately.

Preview health and save health are shown separately. About reports the loaded
package, renderer, revision, source identity and launch context; readiness is not
visual certification. Screen search and authored journey filters preserve the
selected screen. Fit, 100% and focus inspect source typography without rewriting
it. Non-secret screen/frame/direction/view hashes survive refresh and browser Back.

Pins and reviewer metadata use the canonical review ledger; direction preference
and arrangement use `.design/studio-state.json`. Saves bind to the current revision
and state version, and stale concurrent writes return a conflict. Downloaded JSON
feedback requires an explicit revision-bound import. Imports retain comments,
replies and original mappings, but never manufacture owner decisions. Historical
project `.feedback/notes.json` files remain preserved and are not silently adopted.

Evicted product previews restart when reopened; review comments, replies, draft text and personal navigation remain outside those frames. Token authentication, authored sources and published revisions are unaffected. A desktop mobile emulation checks this resource budget but cannot reproduce every physical device's memory pressure.

### Mobile shell sizing

The board shell uses 16px editable controls, 15px body text, 13px labels and 12px metadata on phones and primary touch devices, with 44px action targets. These tokens belong to the studio document; authored screens retain their own typography, appearance and responsive rules.

Phone layouts use the stable small viewport height, safe-area padding and a scrollable welcome/profile dialog. While a shell field is focused, the stage keeps its height and the dialog follows the visible keyboard area. Browser pinch zoom remains available. The hosted revision/status footer reserves its own space so it cannot cover walkthrough controls. Mobile browser tests cover both Chromium and WebKit; physical-device keyboard behavior still needs device-level validation.
