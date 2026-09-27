---
'openplanr': patch
---

Positional artifact ids must now look like an artifact id such as `US-001` (an uppercase prefix, a hyphen and three or more digits). `planr <type> show|update`, `planr update`, `planr spec shape|show|status|destroy|attach-design|promote|sync`, `planr sprint refinement|diff|close|apply`, `planr template save`, `planr github push` and `planr linear push` reject anything else with `E_ARTIFACT_ID_INVALID` instead of printing another artifact for `.*`, resolving the bare prefix `SPEC` to the first spec, or crashing on `(`. Artifact, Gherkin, spec, managed-block and id-prefix lookups now match names literally.
