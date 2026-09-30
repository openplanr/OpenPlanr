---
"@openplanr/protocol": minor
"@openplanr/artifact": patch
"@openplanr/design": patch
"planr-pipeline": patch
"openplanr": patch
---

Share a verified diagram manifest or authored bundle as a native encrypted review:

```bash
planr artifact share <manifest-or-bundle>
planr artifact publish <manifest-or-bundle>
planr artifact sync <manifest-or-bundle>
```

The local studio's **Share diagram** dialog previews the selected title, revision,
publication contents, destination and retention. It provides separate controls
for copying the stable link and access token. Reviews work while the owner's
laptop is offline and last until revoked or deleted. The native viewer preserves
saved geometry and provides outline/search, inspection, pan/zoom, Fit, Present,
Discussion, Revisions, and SVG/PNG or feedback exports without an HTML wrapper.

Publish later revisions explicitly to the same link. Sync revision-bound feedback
into the local ledger without changing the diagram; earlier revisions remain
readable and do not accept new comments. Owner credentials stay outside the
repository and ordinary command output remains credential-free.

Protocol 1.15 adds `@openplanr/protocol/diagram-review-contracts`, with validators
and TypeScript types for diagram review bundles, feedback and encrypted workspace
records. Its six schemas are `schemas/v1.15.0/diagram-review-bundle.schema.json`,
`diagram-review-feedback.schema.json`, `diagram-review-workspace.schema.json`,
`diagram-workspace-create.schema.json`, `diagram-workspace-revision.schema.json`
and `diagram-workspace-event.schema.json`. These additive contracts use payload
`schemaVersion: "1.0.0"`; existing schema versions remain unchanged.

Diagram sharing requires a compatible hosted service. An older runtime or service
reports `E_DIAGRAM_SHARE_UNSUPPORTED`. Existing HTML reviews and design links keep
working and are not migrated or republished automatically.
