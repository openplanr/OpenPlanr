# Complete design and handoff to Plan

The active design author owns `design-spec.md` in this run. This includes designs
based on PNG/SVG mockups: inspect the source visually, document approximations and
produce the specification now. Do not defer required context to a later Plan run.
Use the [ten-section template](design-spec-template.md) without dropping sections.

Read the board's persisted `.design/studio-state.json` before finalizing. Its
`selectedVariant` is authoritative when a selection was recorded. Synchronize
the authored document's selection and the specification's direction and affected
sections, then render and verify that result. Keep the handoff incomplete until
the selected source, document and specification agree; a board click or export
does not perform this semantic synchronization. Reuse an explicit settled choice
without asking for permission again.

## Resolve the project location

| Project mode | Design source/studio | Specification |
| --- | --- | --- |
| Spec-driven: `.planr/config.json` declares `idPrefix.spec` | `.planr/specs/SPEC-NNN-<slug>/design/` | Same directory's `design-spec.md` |
| Default feature | `output/feats/feat-<slug>/design/` | `output/feats/feat-<slug>/design-spec.md` |
| Explicit standalone destination | Requested directory | Same directory's `design-spec.md`; report that Plan needs an explicit association |

Resolve an existing spec's actual identifier; do not invent `SPEC-NNN` or reuse a
different feature's images. Keep legacy flat specification paths unchanged.

## Deliverable closure

- Editable design document, screen sources, assets and project design-system
  references suitable for version control.
- Complete rendered studio, with the selected direction accessible in Canvas,
  Prototype and Walkthrough. Label static image references clearly.
- Compatibility `finalized.json` alongside additive document/revision metadata.
- Ten-section `design-spec.md` covering the chosen design, screen inventory,
  required component states, responsive behavior and explicit assumptions.
- Actual verification result and browser evidence, or an explicit unverified
  status with remaining checks. Keep unresolved feedback visible.

Generated previews and copied runtimes are separate from authored source. Follow
the project's tracking conventions; never discard editable source or the prior
working revision merely to clean generated output.

## Implementation package custody

After review feedback has explicit owner decisions and the current review handoff
is approved, the owner may prepare an implementation package. The package is a
compact navigation and acceptance aid; it never replaces the design document,
screen sources, `design-spec.md`, verification record, review ledger or approved
review handoff.

- Keep source references repository-relative and bind them to their exact revision
  and integrity value. A screen, component, state, flow, token, review decision or
  element anchor must resolve exactly once inside the repository.
- Keep canonical bodies in their owning files. Do not embed whole HTML documents,
  screenshots, design documents, review ledgers or source code in the package.
- Give every implementation requirement observable verification and one or more
  stable source references. Requirement IDs derive from canonical requirement
  content and ordered references; do not renumber them for presentation.
- Treat `implementation-handoff/draft.json` as the machine record and
  `implementation-handoff/draft.md` as its generated human projection. Never edit
  the Markdown independently. Portable import validates JSON first and then exact
  Markdown parity; optional source verification can run fully offline.
- Drafting, regeneration, export and import grant no Plan, Ship, Git, release,
  publication or deployment authority. Package approval and immutable history are
  separate owner actions.
- Approval binds the exact draft version and internal content identity loaded by
  the owner. The confirmation describes the title, revision, requirement count,
  unresolved nonblocking items and `Prepare Plan` effect; integrity values stay
  out of the decision copy.
- Approved packages live below `implementation-handoff/versions/` and never
  change. `implementation-handoff/current.json` is a small lifecycle pointer;
  supersession and revocation append auditable events without rewriting history.
  Regeneration always creates a newer draft version. Exact request retries reuse
  their completed result, while reused request IDs with different input conflict.
- Approval authorizes only preparation for a later Plan invocation. It never
  starts Plan, Ship, an agent, a Git write, publication, release or deployment.

Return concise links to the studio, document/source, specification and quality
result. State the selected direction and any decisions still open. Plan can read
the specification and selected sources to create UI tasks; it must not re-extract
an authored specification from preview pixels. Stop at the handoff. Starting Plan,
Ship, external sharing, publication or deployment needs that user request.
