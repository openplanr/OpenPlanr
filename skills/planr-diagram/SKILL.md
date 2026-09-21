---
name: planr-diagram
description: Create, inspect, verify, or rerender professional offline diagrams. Use for architecture, process, sequence, data, state, or relationship visuals from intent or source.
license: MIT
---

# Planr Diagram

Use the public `planr diagram` surface for deterministic validation, rendering,
fidelity reporting, and source custody. Do not reproduce renderer or manifest
logic in the prompt.

Treat a successful `planr diagram gallery --json` call as proof that the runtime
is ready. Never locate or import `planr-pipeline`, inspect `node_modules`, search
the filesystem for schemas or examples, or call internal runtime modules. The
CLI and this skill's bundled references are the complete supported boundary.

## Create from intent

When the input is an English description, read the
[intent-to-IR guide](references/diagram-intent-to-ir.md) and the
[diagram document contract](references/diagram-document.md).
Choose the grammar and detail tier from the available project context. Use
`planr diagram gallery --type <type> --json` only when grammar metadata is
needed. Ask only
when an unresolved choice would materially change the meaning; ask no more than
three short decision-changing questions at once and prefer the host's native
question UI. Write one digestless Protocol 1.6 diagram draft from the bundled
contract, then run the command below. The CLI validates it and adds the
canonical digest; the skill must not calculate that digest itself.

For "who does what, and when" between actors, use a lane grammar (`swimlane`
or `process`): one lane per actor with its `members`, `left-right` so lanes
read as rows, and relations for the handoffs. For a board (`kanban`,
`story-map`), use `top-down` so lanes read as columns and leave `relations`
empty; members stack in declared order.

```sh
planr diagram render <file>.planr-diagram.json --json
```

For Mermaid input, pass the `.mmd` file directly. An edited Excalidraw scene is
a source branch of an existing generated set; rerender its manifest with
`--accept excalidraw` when the user chooses that branch.

## Inspect and revise

- `planr diagram inspect <input-or-manifest> --json` explains the current source,
  outputs, editability, fidelity, and drift without changing files.
- `planr diagram check <input-or-manifest> --json` verifies schema and manifest
  custody.
- `planr diagram rerender <manifest> --accept ir|mermaid|excalidraw --json`
  regenerates from the selected source branch.
- `planr diagram gallery [--type <type>] --json` lists grammars, aliases,
  primitives, and layout families. Read the
  [fidelity guide](references/diagram-fidelity.md) when choosing an editable
  projection or explaining an omitted one.

## Look before you hand over

Every manifest result carries a `quality` object — `status`, `failedChecks`,
`warningChecks`. Treat anything other than `pass` as unfinished work. An
`invalid` set returns no `nextAction`: restructure and render again rather than
opening the studio. A missing `quality` object means the report could not be
read, which `warnings` explains; that set is unverified, not verified.

A `pass` quality status is necessary, not sufficient. After every render, open
the PNG or SVG the command lists and check four signatures: a label that reads as
another node's caption, rectangles that overlap, a connector crossing the whole
canvas, and a node drawn below a step it precedes. Any `warning` check, in
particular `label-foreign-node`, names the first of these. When one appears,
restructure using the [layout heuristics](references/diagram-intent-to-ir.md)
(fewer relations per node, no back edge, no groups, shorter labels) and render
again before starting the studio. Report which signatures you checked.

After a successful render or rerender, run the returned `nextAction` to start
the native diagram studio (one SVG canvas, outline, pan/zoom, comments, and
exports). Keep that process alive, wait for its startup
JSON, open the returned URL with the host's native preview, and return the URL
to the user. Skip this only when the user explicitly requests files without a
preview or the host cannot open local URLs; in that case return the exact
self-contained HTML and manifest paths. The manifest is the studio input so
review pins remain bound to the verified diagram set. Treat an omitted Mermaid
or Excalidraw projection as a supported fidelity outcome only when the command
result explains why.

Report the selected grammar, manifest path, emitted files, validation status,
editable source, fidelity or omissions, and the clearest next action.
