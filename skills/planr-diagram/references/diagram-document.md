# Diagram document authoring contract

Use this self-contained contract to author a diagram from English intent. Do not
inspect the OpenPlanr installation, `node_modules`, pipeline source, schemas, or
fixtures. The public CLI accepts this digestless draft and adds the canonical
RFC 8785 digest before rendering.

Start from this shape:

```json
{
  "diagramId": "request-flow",
  "title": "Request flow",
  "summary": "How a request moves from intake to completion.",
  "audience": "mixed",
  "grammar": { "id": "sequence", "version": "1.0.0" },
  "layout": { "direction": "left-right", "detailTier": "balanced" },
  "theme": { "themeId": "openplanr-default", "mode": "auto" },
  "source": { "format": "english", "path": null, "digest": null },
  "nodes": [
    {
      "id": "request",
      "label": "Request",
      "kind": "primary-item",
      "description": "A new request enters the system.",
      "semanticPosition": null
    },
    {
      "id": "completion",
      "label": "Completion",
      "kind": "secondary-item",
      "description": "The verified result is returned.",
      "semanticPosition": null
    }
  ],
  "relations": [
    {
      "id": "request-to-completion",
      "from": "request",
      "to": "completion",
      "kind": "flow",
      "label": "produces",
      "weight": null
    }
  ],
  "events": [
    { "id": "start", "label": "Start", "order": 0, "at": null },
    { "id": "finish", "label": "Finish", "order": 1, "at": null }
  ],
  "emphasis": [
    { "targetId": "completion", "level": "primary" }
  ],
  "accessibility": {
    "title": "Request flow",
    "description": "A request moves from intake to a verified completion.",
    "readingOrder": ["request", "completion", "start", "request-to-completion", "finish"]
  }
}
```

The CLI supplies `kind`, schema and protocol versions, digest settings, the
document digest, and any omitted semantic collections. Include only primitives
allowed by the selected grammar. Every relation endpoint, collection member,
emphasis target, and accessibility reading-order entry must reference an item
ID in the document. IDs use lowercase letters, numbers, and hyphens. Express
meaning only; never add renderer coordinates.

Use the `emphasis` collection when an item needs primary or secondary visual
priority. `highlight` is not a diagram-document field. The renderer must either
represent every declared semantic primitive or mark the quality report invalid;
never remove groups, lanes, axes, annotations, or emphasis while reporting a
presentable result.

For a sequence diagram, use nodes as participants, relations as time-ordered
messages, and events as named phases. After participant IDs, interleave phase
event IDs and message relation IDs in `accessibility.readingOrder`. That order
is the canonical timeline used by the renderer and editable projections.

For a lane grammar, add a `lanes` collection of `{ "id", "label", "members" }`
entries whose `members` list node IDs. Every member must exist, and the
renderer draws each lane as a titled band holding those nodes.

Write the draft to `<slug>.planr-diagram.json`, then run:

```sh
planr diagram render <slug>.planr-diagram.json --json
```

If validation fails, use the returned diagnostics to correct the draft. Do not
open internal package code to interpret a public validation error.
