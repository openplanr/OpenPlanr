---
'openplanr': patch
'planr-pipeline': patch
'@openplanr/protocol': minor
---

The design skills now ship a smaller review stage and contract set. Their copy of the review stage leaves out link sharing, the hosted viewer and live rooms, and their scripts no longer bundle the sharing and hosted workspace contracts or the paste and workspace schemas. The studio, prototype, walkthrough and feedback rail work as before, and sharing still runs through the `openplanr` CLI.

`@openplanr/protocol` adds a `large-object-limits` entry point, so you can read the resource limits without loading the sharing contracts.
