# Artifact Review and Private Sharing

> planr-pipeline 0.27.1 · Protocol v1.0 planning artifacts with additive
> Protocol v1.1 artifact-review contracts

Artifact review is the portable engine behind `planr artifact`. It turns a
project-local HTML file or an existing OpenPlanr design board into a
self-contained, digest-addressed review envelope. The same generated shell is
used for local annotation and by the hosted viewer at
`https://share.openplanr.dev`.

The review surface supports dynamic JavaScript, stable pins and threads,
Approve/Request changes decisions, JSON or Markdown export, and non-destructive
feedback import. Sharing is always explicit; opening or reviewing an artifact
locally never uploads it.

## CLI contract

The public command belongs to the OpenPlanr CLI. Runtime skills and adapters
invoke `planr`, never the nested `planr-pipeline` executable.

```text
planr artifact <file>                 # alias for artifact open
planr artifact open <file>
  --title <title>
  --root <asset-root>
  --theme auto|light|dark
  --presentation auto|document|canvas
  --port <port>
  --no-open
  --json

planr artifact share <file>
  --title <title>
  --presentation auto|document|canvas
  --short
  --ttl 1d|7d|30d
  --no-open
  --json
  --yes

planr artifact import <review-url>...
  --output <path>
  --allow-stale
  --json

planr artifact export <session-id>
  --format json|markdown
  --output <path>
```

A minimal OpenPlanr installation reports `E_PIPELINE_NOT_INSTALLED` with the
full-install command. Local review binds to `127.0.0.1`; under SSH the result
includes an exact port-forwarding command instead of attempting a remote browser
launch.

`auto` is the public default. A single generic artifact resolves to `document`;
multi-variant envelopes and every design-board adapter resolve to `canvas`.
Explicit `document` or `canvas` overrides that inference. JSON results include
the resolved presentation.

## Document and canvas presentations

`document` is the default reading and review experience for generic HTML. The
complete bundled document renders edge-to-edge beneath a sticky 48px toolbar.
Only the OpenPlanr mark, title, privacy state, Interact/Comment controls,
feedback count, and Share action remain visible. Feedback starts closed and
opens as an overlay, so the artifact never reflows when a reviewer reads a
thread.

`canvas` preserves the existing zoomable artboard, view controls, variants,
split comparison, design workflow controls, and review rail behavior. Design
boards serialize `viewer.presentation: "canvas"`, including single-variant
boards.

The envelope field is optional for compatibility:

```json
{
  "viewer": {
    "mode": "single",
    "activeArtifactId": "checkout",
    "presentation": "document"
  }
}
```

`auto` is never serialized. Old single-artifact links resolve to `document` and
old variant links resolve to `canvas` without changing their canonical digest.
When an explicit presentation is stored, it is part of the review digest.

## Portable engine API

The package root exports the stable artifact boundary:

| Function | Contract |
|---|---|
| `bundleArtifact(options)` | Resolve and inline a local HTML dependency graph beneath `root`, returning deterministic, bounded HTML and asset metadata. |
| `createArtifactEnvelope(options)` | Create and validate a single-artifact or ordered multi-variant envelope with canonical digests. |
| `encodeArtifactFragment(value)` | Canonical JSON → raw DEFLATE level 9 → unpadded base64url with a `v1.` prefix. |
| `decodeArtifactFragment(source)` | Validate, bound, inflate, and parse a v1 fragment or fragment URL. |
| `encryptArtifactPayload(bytes, options)` | Encrypt compressed bytes with AES-256-GCM using a random 32-byte key and 12-byte IV. |
| `decryptArtifactPayload(payload, options)` | Authenticate and decrypt a ciphertext paste using the key supplied separately by the caller. |
| `startArtifactReview(options)` | Start or reuse the loopback-only server and return a controller with URL, export, review-state, and close operations. |
| `createReviewLink(value, options)` | Select fragment or encrypted-short transport, requiring explicit consent before any upload. |
| `importArtifactReview(options)` | Decode one or more review sources, validate their digest, merge them, and persist to a safe destination. |
| `mergeArtifactFeedback(current, incoming)` | Merge immutable review state by stable IDs while detecting conflicting edits. |

The package root also exports `ARTIFACT_ERROR_CODES` and `PipelineError` for
machine-readable handling. All public operations reject malformed, stale,
oversized, unsafe, or unsupported input with named `E_ARTIFACT_*` codes rather
than leaking payloads, keys, local paths, or secrets in error details.

Example engine use:

```js
import {
  bundleArtifact,
  createArtifactEnvelope,
  startArtifactReview,
} from 'planr-pipeline';

const bundled = await bundleArtifact({
  file: './artifact.html',
  root: process.cwd(),
});

const envelope = await createArtifactEnvelope({
  artifacts: [{
    id: 'checkout',
    title: 'Checkout flow',
    html: bundled.html,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  }],
});

const session = await startArtifactReview({ envelope, theme: 'auto' });
console.log(session.url);
```

## Envelope and feedback identity

The additive v1.1 contracts are:

- `schemas/v1.1.0/artifact-envelope.schema.json` — ordered HTML artifacts,
  frozen viewport/color scheme, viewer state, and optional review.
- `schemas/v1.1.0/artifact-review.schema.json` — review decision, overall
  feedback, stable pins, replies, authors, normalized regions, and optional
  `data-planr-id`/screen anchors.
- `schemas/v1.1.0/artifact-paste.schema.json` — the ciphertext-only short-link
  boundary.

An artifact digest covers its canonical bundled HTML bytes. `reviewOf` covers
the canonical envelope's `schemaVersion`, ordered `artifacts`, and `viewer`, but
not `review`. Feedback therefore cannot change the identity of the artifact it
reviews. Imports reject a changed identity with `E_ARTIFACT_STALE_REVIEW` unless
the caller explicitly previews and accepts `--allow-stale`; the original digest
is retained for auditability.

## Local sandbox and bundling boundary

The bundler resolves local scripts/modules, stylesheets, CSS imports and
`url()` references, images, SVG, fonts, and `srcset` candidates. Every real path
must remain beneath `--root`, including after symlink resolution.

The following limits are enforced before rendering or sharing:

- 1,000 unique input files.
- 10 MiB total decoded input and 10 MiB generated HTML.
- 5 MiB compressed or encrypted payload.
- 8,000 characters for fragment transport.

Remote resources, traversal, symlink escape, unresolved or dynamic imports,
forms, navigation targets, absolute machine paths, repository remotes,
environment references, and recognized secrets fail closed.

Artifact HTML runs in an opaque-origin iframe with exactly
`sandbox="allow-scripts"`. The complete HTML/CSS/JavaScript dependency graph is
loaded from immutable bundled bytes through a Blob URL; it is never fetched from
the original project after sharing and never executes under the
`share.openplanr.dev` origin. An injected CSP blocks network connections,
navigation, forms, popups, downloads, storage, parent access, objects, base URL
changes, and nested frames while allowing packaged inline code and data/blob
assets. Never add `allow-same-origin` to this sandbox.

In document presentation, the iframe is an invisible security boundary rather
than visible canvas chrome. A nonce-authenticated, throttled `ResizeObserver`
reports bounded document dimensions so the outer OpenPlanr page scrolls
naturally. Measurements are capped at 16,384px wide and 262,144px high;
malformed, forged, or excessive messages are ignored. Pin regions use the
measured full-document coordinate space, with `data-planr-id` anchors preferred
and normalized coordinates retained as fallback.

Private artifact review is not standalone website hosting. A future publishing
mode would require a separate isolated artifact origin and a different security
contract.

## Sharing and privacy

### Fragment links

Payloads whose encoded fragment is at most 8,000 characters use:

```text
https://share.openplanr.dev/#v1.<payload>
```

The envelope is compressed and encoded, not encrypted. URL fragments are not
sent in the HTTP request, so the share service does not receive the artifact.
Anyone who obtains the complete URL can read its content.

### Encrypted short links

Larger payloads, or an explicit `--short`, use:

```text
https://share.openplanr.dev/p/<id>#k=<key>
```

The client compresses first, then encrypts with AES-256-GCM. The random key is
kept only in the fragment and is never sent to the paste service. The service
stores only version, IV, ciphertext, expiry, size, and a deletion-token hash.
Allowed expiries are one, seven, or thirty days; seven days is the default.
Creation requires explicit confirmation (`--yes` for non-interactive use).

The creator receives a one-time deletion token separately. It is intentionally
absent from the review URL. Short-link requests still expose ordinary request
metadata and ciphertext to the service, but not plaintext or the decryption key.

Shared payloads are immutable. A remote reviewer produces a new review URL;
they do not mutate the original link or create a live collaboration room.

## Design-board integration

`design`, `design-loop`, and `design-review` reuse the same shell primitives.
Multi-variant boards create one ordered `artifacts[]` envelope rather than
nesting an existing board inside another review shell. Existing board URLs,
ratings, regeneration/remix controls, SSE updates, pending-feedback semantics,
`feedback.json`, approval markers, and the R1 PLAN→SHIP gate remain intact.
All design-board envelopes explicitly select `canvas`, even when a review has
only one artifact.

Design review imports translate into the adjacent legacy `feedback.json` plus
the artifact review state sidecar. Generic reviews are stored under
`.planr/artifacts/<artifact-id>/` in a valid OpenPlanr project or under
`~/.planr/artifacts/` outside one. Merges are atomic and preserve stable IDs,
authors, threads, decisions, and the reviewed digest.

## Runtime integration

Artifact review is available across the three certified adapters:

- Claude Code: native pipeline assets; public invocation is `planr artifact`.
- Codex: installed `$planr-artifact` skill; the skill invokes only `planr`.
- Cursor: generated portable project guidance with `planr artifact` handoff.

Adapter assets are generated from `registry/adapters.json`. Portable assets must
not contain `${CLAUDE_PLUGIN_ROOT}`, vendor model names, Claude-only commands,
or calls to a globally installed `planr-pipeline` binary.

## Verification

```bash
npm run test:artifact
npm run test:artifact:browser
npm run test:artifact:contracts
npm run test:artifact:share
npm run conformance:artifact-review
npm run check:artifact-shell
npm test
```

The browser suite verifies internal artifact interaction and blocks hostile
network, navigation, persistence, popup, form, parent, and sandbox escape
attempts. Hostile-capability certification runs in Chromium, Firefox, and
WebKit; pixel baselines remain pinned to macOS Chromium to avoid font-rendering
noise. Release gates also install the packed tarball into an isolated HOME
and verify public exports, packaged schemas, generated shell assets, adapter
portability, and local review.

For the normative security rationale, see
[`adrs/ADR-005-artifact-review-sharing-security.md`](adrs/ADR-005-artifact-review-sharing-security.md).
