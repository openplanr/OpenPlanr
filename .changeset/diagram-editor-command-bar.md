---
"@openplanr/artifact": patch
"planr-pipeline": patch
---

Diagram editor: the command bar is one right-aligned cluster on a 16px gutter, in this order: the save state as plain 11px text in its tone colour, Undo, Redo, Inspector, Save, host actions and More. Arrange moves into More as "Auto layout…", the outline toggle is icon-only, and pressed toggles use a neutral fill instead of the accent. Both rail headers hold only underline tabs (Outline and Shapes; Properties, Review and host panels); the "Objects" and "Inspector" title rows are gone. Accessible names match the visible labels: the inspector toggle is "Inspector" (was "Properties") and the apply button is "Apply changes" (was "Apply properties"). Full-bleed tabs, outline rows, menu items and section summaries draw their focus ring inside their own box. The right rail is 288px wide (was 320px), and in the drawer layout the inspector no longer dims or blurs the canvas it edits.
