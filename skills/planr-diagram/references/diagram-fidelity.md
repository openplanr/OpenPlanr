# Diagram fidelity and editable sources

Use this reference when the user requests Mermaid or Excalidraw editing, imports
an existing source, or asks why a projection was omitted.

- Canonical `.planr-diagram.json` is the semantic source and is always editable.
- Mermaid is emitted only when the selected grammar has a certified projection.
  `editable`, `partial`, and `unsupported` are honest compatibility levels, not
  success or failure labels.
- Excalidraw is emitted only for grammars with a certified native scene
  projection. Free-form scene edits become scene-owned pixels and do not imply
  semantic round-trip equivalence.
- SVG, PNG, and HTML are render outputs. They are not canonical sources.
- When multiple source branches changed, show the runtime's choices and let the
  user select `ir`, `mermaid`, `excalidraw`, or a new slug.

Use the command envelope's fidelity and omission reasons verbatim enough to
preserve their meaning; do not promise lossless conversion that the registry
does not certify.
