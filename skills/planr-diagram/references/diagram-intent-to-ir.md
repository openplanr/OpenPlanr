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

## Layout heuristics

The renderer lays out deterministically; these choices decide whether the result
reads at a glance.

- Prefer `top-down` for graphs with relations. Use `left-right` for sequences
  and timelines, where the flow axis is time.
- Keep fan-out to four relations per source and fan-in to four per target. Above
  that, introduce an intermediate node or split the diagram.
- Keep a `balanced` render to twelve semantic nodes; use `faithful` only when the
  reader needs every item and accepts a taller canvas.
- Prefer labels of one or two words. Put the explanation in the item
  `description`; the studio shows it on selection.
- Use `flow` for the main path, `dependency` for "uses" or "reads", and
  `transition` for a return or retry. Flow renders solid, dependency dashed.
- Add a back edge (a relation to an earlier node) only when the grammar is a
  cycle by nature, such as `state-machine` or `loop-flywheel`. In `architecture`
  and `flowchart` a back edge pushes its target to the bottom of the canvas.
- Use groups sparingly, at most one level, and never for the whole graph. Use
  at most one annotation; more than that draws connectors across the canvas.

Ask a question only if selecting a different answer would change the grammar,
meaning, or audience. Infer presentation details from context and let the
runtime validate them.
