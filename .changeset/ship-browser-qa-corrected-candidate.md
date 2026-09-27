---
'planr-pipeline': patch
---

A SHIP run that needs browser QA can now record that evidence for its corrected candidate and close PASS. Recording used to fail with `E_BROWSER_QA_REPLAY_DIVERGED` because the corrected candidate's evidence was compared with the evidence recorded before the correction.
