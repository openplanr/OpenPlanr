---
"openplanr": patch
"planr-pipeline": patch
"@openplanr/skill-runtime": patch
---

Prepare declared build dependencies before delegate scratch verification, support focused test-file checks, and retain per-attempt check evidence and phase timings. Required context stays complete, workspace dependencies remain inside scratch, and failed checks cannot be discarded by a zero-check retry.

Check Node/Git prerequisites and discover installed engines before collecting tasks. Record inspected dependency setup separately from delegate edits, retain the source baseline, and reject unacknowledged or later setup changes. Simplify the skill entrypoint and status presentation.

Separate run preparation, execution and recovery from command routing, and separate integration checks and file transactions while preserving pinned run helpers.

Allow each engine to use its permitted tools to inspect readable context. Claude shell restrictions remain in its adapter instead of blocking Codex file inspection through a shared prompt.
