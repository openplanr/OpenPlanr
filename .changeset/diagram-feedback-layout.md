---
'@openplanr/artifact': patch
'planr-pipeline': patch
---

Diagram layout: a relation back to an earlier node no longer stretches its cycle into one layer per node. Layers follow the forward flow, and the back relation runs around the outside of the graph into the side of its target when no direct route is clear. In a top-down or bottom-up flow, a node that shares its only predecessor with its adjacent siblings is centred on that predecessor and a node linked one-to-one with its successor is centred over it; in every flow, connectors whose ports differ by less than 12 px are drawn straight, so chains read as one column. A group frame grows on its title side, or its title moves to a free gap, so no connector crosses the title. A relation that crosses a group boundary is labelled on its run between the frames, and relation labels keep clear of group and lane borders; the quality report gains a `label-frame-overlap` check that fails a label crossing a group or lane border. Renderer 1.4.0; committed sets keep verifying and change only when rerendered.
