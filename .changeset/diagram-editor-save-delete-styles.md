---
"@openplanr/artifact": patch
"planr-pipeline": patch
---

Diagram editor: Save now shows its solid primary fill while edits are pending; a group reset had made it white on the toolbar grey (1.11:1 light, 1.13:1 dark). A clean or saving Save is a neutral button at 50% opacity instead of a tinted one that looked active. Delete buttons are outlined in danger red with a soft red hover rather than a solid red fill (white on #fb7185 was 2.69:1 in dark), and hosts can set that red through the new `--planr-color-danger` custom property. Both rail headers are a fixed 44px, so the inspector header no longer shrinks when the inspector scrolls. Canvas labels use the editor's font instead of falling back to a serif where Inter is not installed; exported SVGs are unchanged.
