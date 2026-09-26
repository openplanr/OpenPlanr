---
"@openplanr/artifact": patch
"planr-pipeline": patch
---

Diagram editor: a move, resize or bend drag that ends on an edit the diagram rejects, such as resizing a node past its container, now reverts to the pre-drag state and keeps the rejection visible and announced. Editing continues; previously every later edit failed with "Finish or cancel the current gesture first." until a dialog was cancelled or the page reloaded. Escape now also cancels a session gesture that no pointer drag owns.
