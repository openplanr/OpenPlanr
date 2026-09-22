---
"@openplanr/protocol": minor
"planr-pipeline": minor
"@openplanr/artifact": minor
"openplanr": patch
---

Add portable editable diagram contracts and a shared deterministic edit kernel.

Protocol 1.13 pairs semantic content, authored presentation, original source and source correspondence in one validated bundle. The new `planr-pipeline/diagram-authoring` API compiles explicit commands, previews atomic transactions, separates semantic and presentation changes, reports affected dependencies, and constructs conditional undo/redo without overwriting unrelated edits. IDs are supplied by callers; copy, deletion, containment, geometry locks and connector attachments use the same rules in Node, browsers and Workers.

This is an additive foundation for editor and adapter implementations. Existing diagram rendering and review APIs remain supported. It does not add a canvas editor, persistence, company authorization or live collaboration. The CLI update carries the matching pipeline dependency.
