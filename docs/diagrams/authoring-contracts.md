# Diagram authoring contracts

Protocol 1.13 defines the portable M1 authoring boundary for a diagram's meaning,
shared presentation and typed edits. It is an additive contract family. The
Protocol 1.6 diagram schemas, Protocol 1.12 enterprise schemas and existing
historical manifests keep their original formats.

These contracts do not implement an editor, rendering, persistence, Mermaid
conversion, company authorization or live collaboration. Consumers must provide
and verify those behaviors separately. A valid document is not necessarily
readable at one scale, exportable without loss, or ready to publish.

## Installed API and ownership

Import the browser-safe runtime from the installed Protocol package:

```js
import {
  assertDiagramAuthoringBundle,
  validateDiagramAuthoringBundle,
  diagramAuthoringBundleDigest,
} from '@openplanr/protocol/diagram-authoring-contracts';

const diagnostics = validateDiagramAuthoringBundle(candidate);
if (diagnostics.length === 0) {
  assertDiagramAuthoringBundle(candidate);
  const digest = diagramAuthoringBundleDigest(candidate);
}
```

The shared API includes `DIAGRAM_AUTHORING_SCHEMAS`,
`validateDiagramAuthoringArtifact(kind, value, options)` and its assertion
counterpart, plus document, presentation, bundle and edit-transaction helpers.
Validation reports located `path`, `rule` and `detail` diagnostics. Treat
submitted content and diagnostic paths as untrusted text when displaying them;
validation does not make labels, descriptions or review context executable.

Canonical schema definitions live in
`packages/protocol/src/diagram-authoring-contracts.mjs`; the generation adapter is
`packages/protocol/scripts/diagram-authoring-definitions.mjs`. Generated schemas
live under `packages/protocol/schemas/v1.13.0/`, and the authoring capability
catalog is `packages/protocol/registries/diagram-authoring-capabilities.json`.
Regenerate those assets and compatibility projections from their owners.
Do not patch generated copies in pipeline, installed plugins or vendor mirrors.
Canonical source changes flow through generated and verified distribution
artifacts in one direction. Protocol versions and npm package versions are
independent; adding this contract family does not publish a package.

## Content and authority

The canonical editable file is
`diagrams/{slug}/{slug}.planr-diagram-bundle.json`. Its closed bundle pairs one
semantic document with one presentation companion for the same diagram and
semantic basis. Retained Mermaid source and correspondence are part of the same
content snapshot: `originalSource` and `sourceMap` are both `null`, or both are
present. Omitting one member or retaining only one side is invalid.

| Contract | Responsibility |
| --- | --- |
| `diagram-document` | Stable identity, semantic primitives, relationship meaning and one containment forest. |
| `diagram-presentation` | Global logical bounds, routing and attachment geometry, label placement, stacking, bounded appearance and locks. |
| `diagram-authoring-bundle` | One complete semantic/presentation snapshot with optional original source and correspondence. |
| `diagram-edit-transaction` | One identified edit against an exact base, with typed operations and affected-object preconditions. |
| `diagram-source-map` | Source identity, ranges, parser/certification version, semantic correspondence and ambiguity/loss diagnostics. |
| `diagram-fidelity-report` | Separate claims about meaning, presentation retention and source-text fidelity. |
| `diagram-manifest` | References to the complete authored basis and its derived output set. |
| `diagram-change-proposal` | A scoped proposal carrying an exact diagram edit transaction. |
| `diagram-publication-state` | Separate draft/published revision references and audience capability semantics. |
| `diagram-authoring-capabilities` | The versioned grammar/construct capability boundary. |

Semantic membership belongs in the document exactly once. Presentation cannot
create membership, change a connector endpoint or grant permission to edit.
Relationship direction is `forward`, `both` or `none`; reversing a relationship
swaps its semantic endpoints. Geometry uses global logical canvas coordinates,
including route points. Each route declares `mode: automatic | manual` and
`strategy: straight | orthogonal`; automatic routes do not carry authored points.
Shape attachments identify a boundary side and normalized offset rather than
substituting a different semantic target.

The bundle has no fields for company roles, publication state or grants,
credentials, comments, review authority, transaction history or personal
camera/selection state. Temporary collapse and focus filters are personal view state. A portable
bundle does not require company metadata.

Proposal and publication-state validation only checks their contract. The
authenticated service still owns current identity, membership, guest scope,
publication visibility, revocation and atomic compare-and-set. A valid proposal
does not approve local repository application; a published diagram does not
authorize code execution, Git, deployment, Plan or Ship.

## Digest coverage

All three embedded content digests use the shared canonical JSON implementation
and SHA-256. Each covers the complete corresponding object **except its own
named digest field**:

| Helper | Excluded field | Covered content |
| --- | --- | --- |
| `diagramDocumentDigest(document)` | `documentDigest` | Every other document field, including identity, versions and semantic collections. |
| `diagramPresentationDigest(presentation)` | `presentationDigest` | Every other presentation field, including identity, semantic basis and authored visual data. |
| `diagramAuthoringBundleDigest(bundle)` | `bundleDigest` | Every other bundle field, including embedded documents, their digests, original source and correspondence. |

A digest is not computed over a document containing itself. Verify embedded
document/presentation digests and cross-document references as well as the bundle
digest; hashing an inconsistent object does not make it valid.

`originalSource.sourceDigest` covers the UTF-8 encoding of the exact retained
`originalSource.text`, without canonicalizing Mermaid, changing whitespace or
normalizing CRLF. Source text must be representable as valid Unicode scalar
values. Its exact-source digest and semantic equivalence are different facts.

An HTTP/R2/enterprise revision transport digest covers the **actual serialized
bytes**. It is separate from the embedded canonical bundle digest. Reformatting
JSON can preserve embedded canonical digests while changing the transport byte
digest. Reformatting Mermaid changes the retained source digest and the enclosing
bundle content, even if a converter later establishes semantic equivalence.

A presentation digest includes its semantic basis. Updating that basis after a
semantic edit may change the presentation digest even when geometry is unchanged.
Consumers must compare semantic and authored presentation fields to classify
meaning versus layout changes; digest inequality alone is not a layout diff.

## Validation levels and boundaries

Shape/version validation checks the closed representation and supported contract
version. Domain validation additionally checks paired identities and bases,
digests, unique semantic IDs, references, allowed primitives, containment,
presentation targets and source correspondence. A generic JSON Schema success is
insufficient before adopting, saving, applying or rendering an editable bundle.

The exported validators always run safe-data, shape and applicable domain checks.
There is no option that skips version, shape or digest validation. A complete
bundle supplies its own semantic, presentation and source context. For standalone
artifacts, provide the context needed for the relationship being checked:

| Option | Cross-document check |
| --- | --- |
| `document` | Presentation/source-map identity, semantic basis and target references. |
| `bundle` or `baseBundle` | Exact transaction/proposal/report/manifest/publication snapshot and contained document context. |
| `sourceText` | Source-map digest, byte length and UTF-8 range boundaries. |

Unknown options and conflicting contexts are rejected; supplied context is itself
validated. Success without a context does not prove that an external snapshot or
source file exists or matches. Transaction validation does not apply operations
or check their before-values sequentially; that remains the mutation engine's
job. `summarizeDiagramAuthoringContent(bundle)` reports element count and visible
content separately after bundle validation.

The runtime rejects non-JSON or unsafe values before hashing: non-finite geometry,
cycles, unsupported prototypes/accessors and forbidden prototype keys must not
enter a document. Unknown properties, versions, unsafe appearance tokens and
resource-bound violations are errors rather than extension points. Inputs remain
unchanged by validation. A plain text label or source string is not authorization
to execute code or load its referenced resources.

Blank documents and empty containers are valid authoring states. Visible content,
readability, renderer capacity and service quotas are separate evaluations.
The 1,000-element product benchmark does not remove content, operation, nesting,
geometry or hosted request limits.

The persisted edit vocabulary is:

- `insert-elements`
- `update-semantics`
- `remove-elements`
- `set-membership-order`
- `set-geometry`
- `set-appearance-locks`

Operations expose allowlisted typed fields, not arbitrary JSON patch paths.
A transaction carries its identity, exact base and optional `undoOf` plus
preconditions. Those fields describe the edit contract; the mutation engine and
storage adapter must still implement atomic application, conditional undo,
idempotency and stale-base handling. These schemas do not claim that concurrent
undo or live composition is already available.

## Bounded M1 capability claims

The M1 authoring profiles are `flowchart`, `process`, `swimlane` and
`architecture`. They certify the declared graph vocabulary, not full BPMN, C4,
UML or every construct accepted by an external syntax. Node roles use
`node.kind` for process, start, end, decision, data-store and component meaning;
visual appearance remains in presentation.

Use `getDiagramAuthoringCapability(grammarId)` and the versioned catalog for
grammar **and construct** decisions. The lookup returns `null` for an uncertified
or unknown grammar; callers must preserve that unsupported result.
Membership in the legacy renderer registry is not evidence of editing or
lossless interchange support. Unknown grammars and uncertified constructs must
not inherit an editable or lossless fallback. Existing sequence rendering/import
support does not imply sequence authoring certification.

M1 Mermaid support is the bounded copy-import/export subset declared by the
catalog. Source correspondence, semantic equivalence, retained placement and
byte-identical source text are separate claims. Ambiguity or unsupported
constructs must remain visible in diagnostics; schema validity must never turn
them into a lossless result. Source linking, file watching, repository write
authority and live collaboration are not supplied by this contract task.

## Legacy read and adoption boundary

Protocol 1.6 readers and the no-options `diagramContractUrl(kind)` behavior remain
unchanged. Consumers select Protocol 1.13 explicitly for successor contracts.
An old document is not rewritten merely because a new reader opens it.

`inspectLegacyDiagramDocument(value)` reports validity, preserved identity,
authoring availability, unsupported node kinds and the requirement for derived
presentation. It never returns migrated geometry or modifies its input. The
non-mutating legacy adapter boundary is:

1. Validate the exact legacy document and retain its original bytes and IDs.
2. Inspect its grammar/construct capability without guessing authoring support.
3. Ask the existing supported renderer for derived placement and report that
   placement as derived, with migration diagnostics.
4. Preview any successor semantic/presentation pair separately.
5. Adopt by creating a distinct successor bundle only after an explicit save.

Capture and adoption belong to the renderer and persistence integration. These
contracts establish their compatibility expectations; no contract helper claims
to have captured renderer geometry or completed migration. Unsupported legacy
node kinds are retained and reported rather than silently relabeled into an M1
role.

For an unknown successor version, preserve the original and return an
unsupported-version result. Offer only read/export behavior the installed
consumer actually supports. Never write a lossy downgrade or mutate an immutable
historical manifest to make the new reader accept it.
