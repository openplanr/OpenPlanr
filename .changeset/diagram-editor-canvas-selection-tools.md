---
"@openplanr/artifact": patch
"planr-pipeline": patch
---

Diagram editor: a selected object gets a solid 2px accent outline drawn 4px outside its bounds, with no glow and no dashes, so every shape keeps its own outline. The resize handle is drawn at 8px and bend handles at a 4px radius, each inside a transparent 24px target that takes the pointer. The canvas tools are 36px buttons in a 44px bar: the pressed mode tool (Select or Pan) is solid accent, Snap is a neutral toggle whose icon shows a slash when it is off, and Zoom out and Zoom in are minus and plus icons. Status without an action floats as an 11px caption over a canvas that now runs to the bottom edge; a status that offers Retry save or Compare revisions stays a bar. Canvas objects are named as the outline names them, so an unlabelled connector reads "Start → Process". The icon set adds `minus` and `snap-off`.
