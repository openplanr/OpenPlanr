---
"@openplanr/protocol": minor
"@openplanr/artifact": patch
"planr-pipeline": patch
---

Protocol 1.14 adds a successor artifact theme: `registries/artifact-theme.json` with `schemas/v1.14.0/artifact-theme.schema.json`. It uses the brand teal on light (#237a72, strong #1b5f59) and adds an `onPrimary` text colour to both palettes (#ffffff light, #07110f dark). The byte-preserved `registry/artifact-theme.json` and its v1.1.0 schema are unchanged. The generated review theme CSS and JSON now come from the successor and also set `--planr-color-on-primary`, so the light review shell and Diagram Studio use the brand teal. The diagram editor's built-in light accent and Save hover use the same values. White on the light accent rises from 4.89:1 to 5.12:1; the dark accent is unchanged. A selected Mermaid source tab keeps its fill on hover, and the review shell's Copied state uses the strong accent, so their text reaches 4.5:1 (it was 4.14:1 and 3.74:1).
