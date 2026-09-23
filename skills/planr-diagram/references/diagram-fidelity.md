# Diagram fidelity and editable sources

Use this reference when the user requests Mermaid or Excalidraw editing, imports
an existing source, or asks why a projection was omitted.

- Canonical `.planr-diagram.json` is the semantic source and is always editable.
- For the v1.13 flowchart authoring path, the `.planr-diagram-bundle.json` holds
  the semantic document, presentation, exact original Mermaid text, and source
  correspondence. Use `@openplanr/artifact/diagram-authoring`'s
  `previewMermaidCopy`, `adoptMermaidCopy`, and `exportMermaidCopy` for copy
  interchange. Preview never saves; adoption requires acknowledgement of that
  exact preview's fidelity losses. Saving the bundle is a separate owner action.
- The certified Mermaid copy subset supports explicit flowchart node IDs,
  rectangle/rounded/decision/cylinder shapes, directed/bidirectional/undirected
  edges, labels, and nested subgraphs. It does not infer lanes or preserve
  coordinates, manual routes, annotations, styling, or exact source formatting
  on export. Keep the complete bundle when these matter. Copy import/export
  never creates a repository source link or watcher.
- Legacy sequence diagrams remain readable and renderable; they are not in the
  editable Mermaid copy certification.
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
