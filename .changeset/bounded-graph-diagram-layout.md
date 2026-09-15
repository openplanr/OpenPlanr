---
"@openplanr/artifact": patch
"planr-pipeline": patch
---

Keep long layered graph diagrams renderable. Layer sequences that outgrow a
readable flow axis, including large cycles and other strongly connected
components, now wrap into balanced bands with band-aware relation routing, so a
500-node ring renders as a compact scene instead of a 154,000-unit strip that
viewers reject. Every node, relation, direction, and label is preserved. Split
plans for large documents now satisfy the Protocol panel bounds while keeping
every primary item exactly once, and any scene wider or taller than the new
`MAX_DIAGRAM_SCENE_EXTENT` (16,384 units) fails early with
`E_DIAGRAM_RESOURCE_BUDGET_EXCEEDED` and a split repair. The diagram renderer
version is now 1.2.0; small diagrams render byte-identically.
