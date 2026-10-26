---
'openplanr': patch
---

When no one can answer its questions, as in a headless run, the spec skill no longer asks. It picks the repository-backed or recommended default and records each choice as an `Assumption:` bullet under `## Notes for Decomposition`, naming the decision and the alternative not taken. A choice settled inside a functional requirement is recorded the same way. The question flow for interactive runs is unchanged.
