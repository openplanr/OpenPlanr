---
"@openplanr/artifact": patch
"planr-pipeline": patch
---

Diagram editor dialogs: the Delete, Connect, Layout and JSON dialogs keep their buttons in a right-aligned footer row with an 8px gap. Dialogs are at most 560px wide, with 20px padding and a 16/24 heading. The dialog and drawer scrim is one theme colour per scheme (light rgb(23 25 29 / 40%), dark rgb(5 6 8 / 64%), overridable through `--planr-color-scrim`) with no blur. In the compact layout the More menu hangs from the command bar instead of the window corner, and dialogs are capped by the editor's height rather than the window's, so a narrow or short embed keeps both inside the editor.
