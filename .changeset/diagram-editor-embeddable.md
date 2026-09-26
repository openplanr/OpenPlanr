---
"@openplanr/artifact": patch
"planr-pipeline": patch
---

Make the shared diagram editor embeddable: responsive breakpoints follow the editor's own width instead of the window, every element id is prefixed per mount so two editors can share one document, and clicks inside host panels, the review slot, the conflict panel and the source panel no longer reach the editor's action dispatcher.
