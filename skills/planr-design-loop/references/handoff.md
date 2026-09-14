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

Return concise links to the studio, document/source, specification and quality
result. State the selected direction and any decisions still open. Plan can read
the specification and selected sources to create UI tasks; it must not re-extract
an authored specification from preview pixels. Stop at the handoff. Starting Plan,
Ship, external sharing, publication or deployment needs that user request.
