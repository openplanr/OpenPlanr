# English intent to canonical diagram IR

Use this reference only when turning natural-language intent into a Protocol 1.6
`planr-diagram` document.

1. Identify the audience, the question the visual must answer, and the semantic
   relationships that must remain visible.
2. Use `planr diagram gallery --json` to select the narrowest grammar that
   represents those relationships. Prefer an explicit user choice over an
   inferred one.
3. Choose `simplified`, `balanced`, or `faithful` detail from the requested use:
   quick explanation, normal engineering communication, or complete source
   coverage. Split the diagram when the runtime quality result requires it.
4. Express meaning with semantic nodes, relations, groups, lanes, events,
   series, axes, sets, annotations, and emphasis. Never invent renderer
   coordinates; the runtime owns geometry.
5. Provide a useful accessible title, description, and semantic reading order.
   Keep labels concise enough to scan at the target size.

Ask a question only if selecting a different answer would change the grammar,
meaning, or audience. Infer presentation details from context and let the
runtime validate them.
