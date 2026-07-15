# Artifact review and private sharing

`planr artifact` turns a project-local HTML file into a loopback-only review
session with comments, pins, threads, and Approve or Request changes decisions.
JavaScript inside the artifact remains interactive in an opaque-origin,
network-blocked sandbox.

Generic artifacts open in `document` presentation by default: the complete
artifact is the edge-to-edge page below a quiet 48px review toolbar. The prior
zoomable artboard is still available as `canvas` presentation and remains the
default for design boards and multi-variant workflows.

## Local review

```bash
planr artifact ./artifact.html
planr artifact open ./artifact.html --root . --theme auto
planr artifact open ./artifact.html --presentation canvas
planr artifact export <session-id> --format markdown --output review.md
```

The bundler packages project-local CSS, scripts, modules, images, SVG, fonts,
`srcset`, and CSS `url()` references. It rejects remote dependencies, forms,
path traversal, symlink escapes, and unresolved assets. Use `--no-open --json`
for remote or SSH sessions, then forward the printed loopback port explicitly.

`--presentation auto|document|canvas` is available on `open` and `share`.
`auto` resolves one generic artifact to `document`; explicit overrides win.
Document feedback starts closed and opens as an overlay without resizing the
artifact. JSON output includes the resolved presentation.

The complete local HTML/CSS/JavaScript graph is bundled into immutable bytes
before review or sharing. The viewer does not fetch the original project after
sharing. It loads those bytes through an invisible Blob iframe with
`sandbox="allow-scripts"`; it never injects artifact HTML into OpenPlanr or
executes it under the `share.openplanr.dev` origin. A bounded authenticated
layout bridge provides natural outer-page scrolling and full-document pins.

This is private artifact review, not standalone website hosting. Publishing a
top-level website would require a separate isolated artifact origin and is not
part of this command.

## Private links

```bash
planr artifact share ./artifact.html
planr artifact share ./artifact.html --presentation document
planr artifact share ./artifact.html --short --ttl 7d --yes
```

Artifacts whose encoded fragments are 8,000 characters or less use
`https://share.openplanr.dev/#v1.<payload>`. The browser fragment is not sent in
the HTTP request, so the host receives no artifact content. Fragment links are
encoded, not encrypted: anyone who receives the URL can read the review.

Larger artifacts require an explicit encrypted short-link upload. OpenPlanr
compresses the envelope, encrypts it with AES-256-GCM, uploads ciphertext, and
puts the key only after `#k=` in the URL. The service sees request metadata and
ciphertext, never plaintext or the key. Links are immutable and expire after
1, 7, or 30 days. Save the one-time deletion token when it is displayed.

## Return and import feedback

The reviewer copies a new immutable review URL from the hosted viewer. Import
one or more returned reviews non-destructively:

```bash
planr artifact import "<review-url>" "<second-review-url>"
```

Changed-artifact feedback is rejected with `E_ARTIFACT_STALE_REVIEW`. To retain
it for audit, rerun with `--allow-stale`, inspect the digest and feedback-count
preview, and confirm. Automation must use `--allow-stale --yes`.

Generic review state is stored in `.planr/artifacts/<artifact-id>/` inside a
valid project and under `~/.planr/artifacts/` elsewhere. Design-board reviews
continue to merge into the adjacent `feedback.json` contract.

## Minimal installs, offline use, and self-hosting

A planning-only installation returns `E_PIPELINE_NOT_INSTALLED`; install the
full distribution with `npm install -g openplanr@latest`. Local review and
export work offline after installation. Creating or opening a remote review
link requires network access.

The shell assets and Protocol v1.1 schemas are shipped by `planr-pipeline`.
Self-hosters may deploy the static viewer and Worker implementation from
`openplanr/openplanr-web`, then set `OPENPLANR_SHARE_BASE` to their HTTPS origin.
