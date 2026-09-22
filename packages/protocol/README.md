# @openplanr/protocol

Public, MIT-licensed contracts for OpenPlanr local tools and hosted consumers.
Package releases use their own semantic version; document and schema versions do
not change just because the npm package advances.

- `schemas/` preserves the original 180 public schemas byte-for-byte, adds the 13-schema Protocol 1.5 family, and adds 19 Protocol 1.6 skill-source and semantic-diagram schemas.
- `registry/` preserves the 12 compatibility registries byte-for-byte.
- `registries/` owns seven canonical Protocol 1.5 catalogs plus five Protocol 1.6 skill-source and diagram registries.
- `src/` provides browser-safe canonical JSON, typed errors, schema validation, registry readers, and an explicit Node compatibility contract loader.
- Workspace-only `projections/`, `preservation/`, and conformance tooling are not
  published. CLI and pipeline compatibility projections stay self-contained.

Run `npm run generate` after changing canonical definitions and `npm run check && npm test` before integration.

## Project-mode output paths

The closed `outputs.json` catalog remains the default-path contract used by
existing Protocol 1.5 readers. The additive `output-paths.json` catalog binds
that exact catalog digest and declares `default` and `spec-driven` templates for
planning outputs whose layouts differ. Readers without the additive catalog
fall back to the existing `pathTemplate` value.

Use `getOutputPathTemplate()` when a caller needs the template and
`resolveOutputPath()` when it has the named path arguments. Spec-driven
professional specifications, stories, tasks, and Gherkin files resolve below
`.planr/specs/{specId}-{specSlug}/`; they do not require duplicate files below
`input/specs/`.

## Semantic diagram contracts

Protocol 1.6 defines a renderer-independent diagram document, manifest, quality
report, fidelity report, grammar registry, and semantic-pattern registry.
`diagramDocumentPath(slug)` resolves the canonical
`diagrams/{slug}/{slug}.planr-diagram.json` path, while grammar fixture and
reference paths remain package-relative for private and projected consumers.

## Diagram authoring contracts

Protocol 1.13 adds portable semantic/presentation bundles, typed edit
transactions, source correspondence, fidelity, proposals, publication references
and an M1 capability catalog. Import the dependency-free validators from
`@openplanr/protocol/diagram-authoring-contracts`. The existing diagram URL helper
retains its Protocol 1.6 default; request `{ protocolVersion: '1.13.0' }` for the
new contracts. Validation does not apply edits or grant hosted access.

See the [authoring contract guide](../../docs/diagrams/authoring-contracts.md) for
content boundaries, digest coverage and legacy compatibility.

## Design document contract

The additive `schemas/v1.9.0/design-document.schema.json` defines stable design,
screen, frame and variant identities, local authored sources, ordered journeys,
interaction flows and design-system provenance. Import the browser-safe contract
and validators from `@openplanr/protocol/design-contracts`. Rendering and review
belong to the design and artifact packages. Legacy manifests and frozen schema
families retain their existing formats.

Design comment categories are separate from the frozen artifact pin intent.
Protocol 1.11 adds metadata payload `schemaVersion: "1.1.0"` for the explicit
`change-request` category. `assertDesignReviewMetadata()` accepts both 1.0.0 and
1.1.0 payloads; old category events and `fix`/`improve` pin intents keep their
original meaning. A requested change does not imply an owner disposition,
approval, or pin resolution.

## Consumers and release boundary

Install an exact published version with `npm install --save-exact @openplanr/protocol`.
Until its first release is available, use the reviewed packed candidate; existing
hosted consumers retain their digest-verified dependencies.

The root and portable contract subpaths run in Node, browser ESM, and Cloudflare
Workers without runtime dependencies. For example:

```js
import { sha256Jcs, withDocumentDigest } from '@openplanr/protocol';
import { assertEnterpriseRevision } from '@openplanr/protocol/enterprise-contracts';
```

`/contracts` and the legacy `/operate-experience-live-patch`, `/live-evidence-v2`,
and `/operating-planning-contracts` adapters load packaged schemas with Node
filesystem APIs. Use the portable domain validators in browser/Workers code.
Schema and registry wildcard exports expose JSON assets; `protocolAssetUrl()` and
`diagramContractUrl()` resolve relative to their original installed modules.
Bundlers must copy those JSON assets or handle their URLs explicitly. Native ESM
consumers can fetch them directly.

The release proof installs all three candidate packages in a temporary consumer,
imports every Protocol entry point in Node, checks declarations and asset paths,
loads portable exports in Chromium, and executes a bundled consumer in Workers.
It rejects source overrides, private workspace imports, missing exports, and
missing schema references. Run `npm run verify:packed:strict` at the workspace
root after generation and build; install Chromium with
`npm exec --workspace=@openplanr/protocol -- playwright install chromium` first.
